import PocketBase, { LocalAuthStore } from 'pocketbase';
import { status, age, escape as esc, timestamp } from './model.js';
import { connectionLink } from './connection.js';
import { windowsApp } from './release.js';
import { defaults as resetDefaults, isDone, nextReset, remaining, dayName, resetHour } from './tasks.js';
import { icon } from './icons.js';
import { t, tn, detect, useLanguage, language, locale } from './i18n.js';
import { inviteLink, joinCode, savedInvites, rememberInvites, forgetInvites, forgetAllInvites } from './invites.js';
import { historyChart, historyList, bindHistoryChart } from './history.js';
import { runsSection, startsIn, runEditForm, calendarFile } from './runs.js';
import { accountView } from './account.js';
import { applyRoomCharacters, applyCharacters, applySeen, applyContact } from './live.js';
import './style.css';
import './accounts.css';
import './features.css';

const backend = import.meta.env.VITE_POCKETBASE_URL || (import.meta.env.DEV ? 'http://127.0.0.1:8090' : window.location.origin);
// Persisted in localStorage: the sign-in is shared by every tab of this browser and survives restarts.
const pb = new PocketBase(backend, new LocalAuthStore('odyle.account'));
pb.autoCancellation(false);
// localStorage can be missing or throw (private modes, blocked storage); every use goes through this.
const storage = (() => { try { const s = window.localStorage; s.getItem('odyle.probe'); return s; } catch { return { getItem: () => null, setItem() {}, removeItem() {} }; } })();
const languageKey = 'odyle.language';
const app = document.querySelector('#app');
let room = null, members = [], wishlist = [], runs = [], dungeons = [], rooms = [], characters = [], demo = false, online = false, invites = [];
let serverOffset = 0, lastPulse = 0, lastCheck = 0, renewedAt = 0, busy = false, roomTopics = [], perCube = 40;
// The newest Windows app release as the backend last reported it; refreshed every ten minutes at most.
let windowsRelease = null, windowsReleaseAt = 0;
let tasks = [], resets = { ...resetDefaults }, renderedTasks = '';
let account = null, renderedAccount = '';
// The message superusers set under Server controls, refreshed every minute at most. Hiding
// it lasts until the text changes.
let announcement = null, announcementAt = 0;
const hiddenAnnouncementKey = 'odyle.announcement.hidden';
let timer;
const me = () => members.find(m => m.user === pb.authStore.record?.id);
const owner = () => demo || room?.owner === pb.authStore.record?.id;
const mine = () => me()?.characters || [];
const roleName = role => role === 'owner' ? t('leader') : role === 'viewer' ? t('viewer') : t('player');
const colors = ['jade', 'amber', 'blue', 'pink', 'violet'];
// The official game portrait (downloaded by the backend) sits over the initials,
// which remain as the fallback while it loads, if it fails or when there is none.
function portrait(c, index, size = '') {
  const name = c.characterName || c.displayName, url = !demo && c.portrait ? pb.files.getURL(c, c.portrait) : '';
  const photo = url ? `<span class="portrait-photo"><img src="${esc(url)}" alt="" loading="lazy"></span>` : '';
  return `<span class="portrait ${colors[index % colors.length]} ${size}">${esc(name.slice(0, 2).toUpperCase())}${photo}<span class="portrait-rune">${icon('diamond')}</span></span>`;
}
const ownCards = () => characters.map((c, i) => card({ ...c, sharing: true, role: 'reporter', displayName: pb.authStore.record.displayName, user: pb.authStore.record.id }, i)).join('');
const navItem = (action, active, name, label, marker = '') => `<button data-action="${action}" class="nav-item ${active === action ? 'active' : ''}"${active === action ? ' aria-current="page"' : ''}>${icon(name)} ${label}${marker}</button>`;
const connectionLabel = () => `<i></i>${demo ? t('Demo workspace') : online ? t('Connected') : t('Not connected')}`;
function announcementBar() {
  if (!announcement || storage.getItem(hiddenAnnouncementKey) === announcement.text) return '<div class="announcement-slot"></div>';
  const warning = announcement.level === 'warning';
  return `<div class="announcement-slot"><div class="announcement ${warning ? 'warning' : 'info'}" role="${warning ? 'alert' : 'status'}">${icon(warning ? 'alert' : 'info')}<p>${esc(announcement.text)}</p><button class="close-button" data-action="hide-announcement" aria-label="${esc(t('Hide this message'))}" title="${esc(t('Hide this message'))}">×</button></div></div>`;
}
function renderAnnouncement() { const el = document.querySelector('.announcement-slot'); if (el) el.outerHTML = announcementBar(); }
async function loadAnnouncement(force = false) {
  if (!force && Date.now() - announcementAt < 60000) return;
  announcementAt = Date.now();
  const next = (await pb.send('/api/odyle/announcement')).announcement || null;
  if (JSON.stringify(next) !== JSON.stringify(announcement)) { announcement = next; renderAnnouncement(); }
}
// The topbar's connection state follows every refresh, not only full redraws.
function renderConnection() { const el = document.querySelector('.topbar .connection'); if (!el) return; el.classList.toggle('connected', online || demo); el.innerHTML = connectionLabel(); }
function shell(content, active = 'overview') {
  // A message shown right before a redraw (saved, signed out everywhere…) stays on screen.
  const message = document.querySelector('#toast.show')?.textContent;
  app.innerHTML = `<aside class="sidebar"><a href="#/" class="brand" aria-label="${esc(t('Odyle home'))}"><span class="brand-symbol">${icon('diamond')}</span><span>odyle<span class="brand-dot">.</span></span></a><div class="workspace-label">${t('PARTY COMMAND')}</div><nav>${navItem('overview', active, 'grid', t('Overview'), ' <span class="nav-marker"></span>')}${navItem('library', active, 'people', t('My rooms & characters'))}${navItem('tasks', active, 'check', t('Daily & weekly'))}${navItem('invite', '', 'plus', t('Invitations'))}${navItem('account', active, 'user', t('Account & data'))}${navItem('help', '', 'shield', t('Reader & privacy'))}</nav><div class="sidebar-bottom"><span class="game-mark">A<span>2</span></span><div>AION 2 <span>${t('Global · Community tool')}</span></div></div></aside><div class="main"><header class="topbar"><span class="breadcrumb">${t('Workspace')} <span>/</span> <strong>${esc(room?.name || (pb.authStore.isValid ? t('My account') : t('Welcome')))}</strong></span><div class="topbar-right"><span class="connection ${online || demo ? 'connected' : ''}">${connectionLabel()}</span><button class="avatar" data-action="session" aria-label="${esc(t('Session details'))}">${esc((pb.authStore.record?.displayName || 'O').slice(0, 1).toUpperCase())}</button></div></header>${announcementBar()}${content}<footer><span>${icon('shield')} ${t('Your characters, saved. Your party, private.')}</span><span>Odyle Party <span class="muted">/ ${esc(__APP_VERSION__)} · ${t('Live packet readings')}</span></span></footer></div><div id="toast" role="status" aria-live="polite"></div><dialog id="modal"></dialog>`;
  if (message) { const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('show'); }
}
function welcome(joining = false) {
  shell(`<main class="welcome"><div class="eyebrow"><span class="tiny-diamond"></span> ${t('BUILT FOR YOUR NEXT RUN')}</div><h1>${t('Good runs start<br>with a ready party<span class="mint">.</span>')}</h1><p class="intro">${t('Sign in with Discord. Save the Odyle of every character.<br class="desktop-only"> Create a private room and bring your friends together.')}</p>${joining ? `<p class="join-note">${icon('link')} ${t('You were invited to a room. Sign in with Discord and you join it right away.')}</p>` : ''}<div class="discord-card"><div class="setup-icon">${icon('people')}</div><h2>${t('One account. Every adventure.')}</h2><p>${t('Your rooms and character readings stay with your Discord account, even after you close the app.')}</p><button class="button discord-button" data-action="discord">${t('Continue with Discord')} ${icon('arrow')}</button><small>${t('First sign-in creates your account. No separate password.')}</small></div><button class="text-button" data-action="demo">${t('Explore the demo workspace')} ${icon('arrow')}</button><p class="welcome-note">${t('No game account needed. No public directory. Just your party.')}</p></main>`);
}
function libraryView() {
  shell(`<main class="dashboard"><section class="heading"><div><div class="eyebrow"><span class="tiny-diamond"></span> ${t('YOUR ADVENTURE, SAVED')}</div><h1>${t('Welcome, {name}', { name: esc(pb.authStore.record.displayName) })}<span class="mint">.</span></h1><p>${t('All your rooms and characters, connected to your Discord account.')}</p></div><div class="heading-actions">${appLink('button secondary')}<button class="button secondary" data-action="desktop">${t('Pair Windows app')} ${icon('arrow')}</button></div></section><section class="party-section room-section"><div class="section-heading"><h2>${t('Your rooms')} <span>${rooms.length}</span></h2></div><div class="room-list">${roomItems()}</div></section><section class="party-section room-sharing"><div class="section-heading"><h2>${t('Room sharing')}</h2></div><div class="share-matrix">${sharingMatrix()}</div></section><div class="welcome-grid"><form id="create-form" class="setup-card"><h2>${t('Create a private room')}</h2><p>${t('Keep your party together between sessions.')}</p><label>${t('Room name')}<input name="name" maxlength="60" placeholder="${esc(t('The evening expedition'))}" required></label><button class="button primary" type="submit">${t('Create room')} ${icon('arrow')}</button></form><form id="join-form" class="setup-card"><h2>${t('Join your friends')}</h2><p>${t('Paste the invite code, or just open the invite link your friend sent.')}</p><label>${t('Invite code')}<input name="code" class="code-input" autocomplete="off" placeholder="XXXX XXXX XXXX" maxlength="20" required></label><button class="button secondary" type="submit">${t('Join room')} ${icon('arrow')}</button></form></div><section class="party-section personal-characters"><div class="section-heading"><h2>${t('Your saved characters')} <span>${characters.length}</span></h2><button class="button secondary" data-action="reading">${icon('plus')} ${t('Connect reader')}</button></div><div class="member-grid">${characterCards()}</div></section></main>`, 'library');
}
const roomItems = () => rooms.map(r => `<button class="room-item" data-room="${esc(r.id)}"><span class="setup-icon">${icon('diamond')}</span><span><strong>${esc(r.name)}</strong><small>${esc(roleName(r.role))} · ${esc(t('{cost} Odyle per cube', { cost: r.cost }))}</small></span>${icon('arrow')}</button>`).join('') || `<p class="intro">${t('Create your first room, or join one with an invite.')}</p>`;
const characterCards = () => ownCards() || `<div class="info-panel"><h3>${t('Every character gets its own reading.')}</h3><p>${t('Connect the Windows reader to read Odyle straight from the game. Values update live while the reader runs and stay saved when you leave a room or sign out.')}</p>${appLink('text-button', t('Download the Windows app'))}</div>`;
// Links to the Windows app's newest release: version and package links when the
// backend knows them, GitHub's stable latest-release page otherwise.
async function loadWindowsRelease() {
  if (Date.now() - windowsReleaseAt < 600000) return;
  windowsReleaseAt = Date.now();
  try { windowsRelease = await pb.send('/api/odyle/windows-release'); } catch { /* the latest-release page link works without it */ }
}
function appLink(className, text = t('Windows app')) {
  const app = windowsApp(windowsRelease);
  return `<a class="${className}" href="${esc(app.url)}" target="_blank" rel="noopener noreferrer" title="${esc(t('Latest release of the Odyle Windows app on GitHub'))}">${icon('download')} ${text}${app.version ? ` ${esc(app.version)}` : ''}</a>`;
}
function downloadPanel() {
  const app = windowsApp(windowsRelease), find = kind => app.packages.find(p => p.kind === kind);
  const installer = find('installer'), small = find('small'), bundled = find('self-contained'), armSmall = find('arm64-small'), armBundled = find('arm64-self-contained');
  const released = app.publishedAt ? ` · ${t('released {date}', { date: new Date(app.publishedAt).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' }) })}` : '';
  const link = (cls, href, label, title = '') => `<a class="${cls}" href="${esc(href)}" target="_blank" rel="noopener noreferrer"${title ? ` title="${esc(title)}"` : ''}>${label}</a>`;
  const runtime = t('Needs the .NET 10 Desktop Runtime; Windows offers it if it is missing.');
  // The installer is the easiest start; the ZIPs remain for a folder of your choice and for ARM PCs.
  const primary = installer ? link('button secondary', installer.url, `${icon('download')} ${esc(t('Download the installer · {size}', { size: installer.size }))}`) + `<small>${t('Installs for your Windows account without administrator rights and includes the runtime.')}</small>`
    : small ? link('button secondary', small.url, `${icon('download')} ${esc(t('Download for Windows x64 · {size}', { size: small.size }))}`) + `<small>${runtime}</small>`
      : link('button secondary', app.url, `${icon('download')} ${t('Open the latest release')}`);
  const more = [installer && small ? link('text-button', small.url, esc(t('ZIP for Windows x64 · {size}', { size: small.size })), runtime) : '', bundled ? link('text-button', bundled.url, esc(t('Self-contained package · {size}', { size: bundled.size }))) : '',
    armSmall ? link('text-button', armSmall.url, esc(t('Windows on ARM · {size}', { size: armSmall.size })), runtime) : '', armBundled ? link('text-button', armBundled.url, esc(t('Windows on ARM, self-contained · {size}', { size: armBundled.size }))) : ''];
  return `<div class="info-panel app-panel"><h3>${app.version ? esc(t('Odyle {version} for Windows', { version: app.version })) : t('Odyle for Windows')}</h3><p>${app.version ? `${t('The newest release')}${esc(released)}.` : t('The newest release is on GitHub.')} ${t('Once installed, the app updates itself from new releases.')}</p>${primary}<div class="app-links">${more.join('')}${link('text-button', app.url, `${app.version ? t('Release notes') : t('All releases')} ${icon('arrow')}`)}</div></div>`;
}
// One row per saved character, one switch per room: the account's whole sharing
// setup in one place. Viewer rooms cannot see shared characters.
function sharingMatrix() {
  if (!characters.length) return `<p class="intro">${t('Characters appear here once the Windows reader sees them in game.')}</p>`;
  if (!rooms.length) return `<p class="intro">${t('Create or join a room, then choose which characters it sees.')}</p>`;
  return characters.map((c, i) => `<div class="share-row"><div class="share-character">${portrait(c, i, 'mini')}<div><strong>${esc(c.characterName)}</strong><small>${esc(c.server)} · ${esc(c.region.replace('GLOBAL_', ''))}</small></div></div><div class="share-rooms">${rooms.map(r => {
    const on = r.sharedCharacters?.includes(c.id), viewer = r.role === 'viewer';
    return `<button class="share-chip ${on ? 'on' : ''}" data-share="${esc(c.id)}" data-room-id="${esc(r.id)}" data-enabled="${!on}" aria-pressed="${on}" ${viewer ? 'disabled' : ''} title="${viewer ? esc(t('Viewers cannot share characters in this room')) : esc(on ? t('Hide {name} in {room}', { name: c.characterName, room: r.name }) : t('Show {name} in {room}', { name: c.characterName, room: r.name }))}"><i></i>${esc(r.name)}</button>`;
  }).join('')}</div></div>`).join('') + `<p class="share-note">${t('New characters start private in every room. Switched-off characters keep their saved values.')}</p>`;
}
// The party shows only characters added (shared) to this room, the member's own
// included; their other characters wait in the add bar above the party.
function flattened() { return members.flatMap(m => { const added = (m.characters || []).filter(c => c.shared ?? m.sharing); return added.length ? added.map(c => ({ ...c, sharing: true, user: m.user, membershipId: m.id, role: m.role, displayName: m.displayName })) : [{ ...m, id: '', characterName: '', confirmed: false, lastReadingAt: '', source: 'packet' }]; }); }
function addBar() {
  if (me()?.role === 'viewer') return `<div class="sharing-bar"><span>${t('Viewers cannot add characters to this room.')}</span></div>`;
  if (!mine().length) return `<div class="sharing-bar"><span>${t('Save a character with the Windows app to add it here.')}</span><button class="button secondary" data-action="reading">${t('Connect reader')}</button></div>`;
  const missing = mine().filter(c => !c.shared);
  if (!missing.length) return '';
  return `<div class="sharing-bar"><span>${t('Not in this room')}</span><div class="add-chips">${missing.map(c => `<button class="add-chip" data-share="${esc(c.id)}" data-enabled="true" title="${esc(t('Add {name} to this room', { name: c.characterName }))}">${icon('plus')}${esc(c.characterName)}</button>`).join('')}${missing.length > 1 ? `<button class="text-button" data-action="add-all">${t('Add all')}</button>` : ''}</div></div>`;
}
// Re-render only when the room data or a readiness state changed; otherwise just refresh the "ago" labels,
// so hover, focus and open menus survive the periodic refresh.
let rendered = '', renderedLibrary = '';
const stable = list => list.map(({ lastSeenAt, updated, characters, ...rest }) => ({ ...rest, characters: characters?.map(({ lastSeenAt: _seen, updated: _updated, ...c }) => c) }));
// Hook responses list record fields in a different order each time; sort keys so identical data compares equal.
const canonical = value => JSON.stringify(value, (key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : v);
function signature() { const now = Date.now() + serverOffset; return canonical([room, stable(members), wishlist, runs, dungeons, flattened().map(c => status(c, now))]); }
function updateAges() {
  const now = Date.now() + serverOffset;
  document.querySelectorAll('[data-age]').forEach(el => { el.textContent = age(el.dataset.age, now); });
  document.querySelectorAll('[data-starts]').forEach(el => { el.textContent = startsIn(timestamp(el.dataset.starts), now); });
}
function renderDashboard() { if (signature() === rendered) updateAges(); else dashboard(); }
function librarySignature() { const now = Date.now() + serverOffset; return canonical([stable([{ characters }]), characters.map(c => status({ ...c, sharing: true }, now)), rooms.map(r => [r.id, r.name, r.role, r.cost, r.sharedCharacters])]); }
function renderSharing() { const el = document.querySelector('.share-matrix'); if (el) el.innerHTML = sharingMatrix(); }
// Redraws the rooms, the saved characters and the sharing list without touching the room forms.
function renderLibrary() {
  const grid = document.querySelector('.personal-characters .member-grid'), list = document.querySelector('.room-section .room-list'); if (!grid || !list) return;
  renderedLibrary = librarySignature(); list.innerHTML = roomItems(); grid.innerHTML = characterCards();
  document.querySelector('.room-section h2 span').textContent = rooms.length; document.querySelector('.personal-characters h2 span').textContent = characters.length; renderSharing();
}
// Accounts with a live character in this room, for the dots on the wishlist and runs.
function liveUsers(now) { return new Set(flattened().filter(c => c.characterName && status(c, now) === 'live').map(c => c.user)); }
// What members still need to run, most wanted first. A dot marks members with a
// live character in this room, so the party sees what it could run right now.
function wishlistSection(now) {
  const myId = pb.authStore.record?.id, viewer = me()?.role === 'viewer';
  const name = id => id === myId ? t('You') : members.find(m => m.user === id)?.displayName || t('Member');
  const live = liveUsers(now);
  // With a dungeon catalog the suggestions are the listed dungeons; otherwise the entries others added.
  const suggestions = dungeons.length ? dungeons.filter(d => !wishlist.some(w => w.dungeon.toLowerCase() === d.toLowerCase() && w.users.includes(myId))) : wishlist.filter(w => !w.users.includes(myId)).map(w => w.dungeon);
  const form = viewer ? `<p class="wish-note">${t('Viewers can see the wishlist but cannot add dungeons.')}</p>` : `<form id="wish-form" class="wish-form"><input name="dungeon" maxlength="60" list="wish-suggestions" autocomplete="off" placeholder="${esc(dungeons.length ? t('Choose a dungeon you still need to run') : t('Add a dungeon you still need to run'))}" aria-label="${esc(t('Dungeon'))}" required><datalist id="wish-suggestions">${suggestions.map(d => `<option value="${esc(d)}">`).join('')}</datalist><button class="button primary" type="submit">${icon('plus')} ${t('Add')}</button></form>`;
  const rows = wishlist.map(w => {
    const mine = w.users.includes(myId), count = w.users.length;
    const people = w.users.map(u => `<span class="wish-person ${live.has(u) ? 'live' : ''}"${live.has(u) ? ` title="${esc(t('Live in this room now'))}"` : ''}><i></i>${esc(name(u))}</span>`).join('');
    const actions = demo ? '' : (mine ? `<button data-wish="${esc(w.dungeon)}" data-wanted="false" title="${esc(t('Take yourself off {dungeon}', { dungeon: w.dungeon }))}">${t('Remove me')}</button>` : viewer ? '' : `<button data-wish="${esc(w.dungeon)}" data-wanted="true">${icon('plus')} ${t('Need it too')}</button>`)
      + (viewer ? '' : `<button data-plan-wish="${esc(w.dungeon)}" title="${esc(t('Plan a run of {dungeon}', { dungeon: w.dungeon }))}">${icon('calendar')} ${t('Plan')}</button>`)
      + (owner() ? `<button class="remove" data-clear-wish="${esc(w.dungeon)}" title="${esc(t('Clear {dungeon} for everyone', { dungeon: w.dungeon }))}">${t('Clear')}</button>` : '');
    return `<div class="wish-row ${mine ? 'mine' : ''}"><div class="wish-name"><strong>${esc(w.dungeon)}</strong><small>${esc(tn(count, '{n} member needs it', '{n} members need it'))}</small></div><div class="wish-people">${people}</div><div class="wish-actions">${actions}</div></div>`;
  }).join('');
  return `<section class="party-section wishlist"><div class="section-heading"><h2>${t('Dungeon wishlist')} <span>${wishlist.length}</span></h2><span class="refresh-label">${t('Most wanted first')}</span></div><div class="wish-panel">${form}${rows ? `<div class="wish-list">${rows}</div>` : `<p class="wish-empty">${t('Nothing on the wishlist yet. Add the dungeons you still need so the party can plan its next run.')}</p>`}</div></section>`;
}
function plannedRuns(now) {
  const suggestions = dungeons.length ? dungeons : [...new Set(wishlist.map(w => w.dungeon))];
  return runsSection({ runs, members, myId: pb.authStore.record?.id || (demo ? 'dave' : ''), viewer: me()?.role === 'viewer', owner: owner(), live: liveUsers(now), now, suggestions, demo, discord: room?.discordReminders });
}
// Full redraws keep a half-typed form entry (wishlist, run, task forms) and its focus.
function keepingDrafts(render) {
  const drafts = [...document.querySelectorAll('form[id] input[name]:not([type=hidden])')].filter(i => i.value || i === document.activeElement).map(i => ({ selector: `#${i.form.id} [name="${i.name}"]`, value: i.value, focused: i === document.activeElement, start: i.selectionStart, end: i.selectionEnd }));
  render();
  for (const d of drafts) { const input = document.querySelector(d.selector); if (!input) continue; input.value = d.value; if (d.focused) { input.focus(); if (input.setSelectionRange && d.start !== null) try { input.setSelectionRange(d.start, d.end); } catch { /* inputs without a text selection */ } } }
}
// Personal daily and weekly checklists. A task counts as done while it was checked
// after the current reset (07:00 UTC and Wednesday by default; the server names
// both from odyle_settings), so the lists clear by themselves and nothing is deleted.
let editingTask = '';
function taskPanel(cadence, now) {
  const list = tasks.filter(task => task.cadence === cadence), done = list.filter(task => isDone(task, now, resets)), at = nextReset(cadence, now, resets), label = cadence === 'daily' ? t('Daily') : t('Weekly');
  const when = new Date(at).toLocaleString(locale(), cadence === 'weekly' ? { weekday: 'long', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' });
  const rows = list.map((task, index) => {
    const checked = isDone(task, now, resets), name = esc(task.title);
    if (task.id === editingTask) return `<form id="task-edit-form" class="task-row task-edit" data-id="${esc(task.id)}"><input name="title" maxlength="60" autocomplete="off" required value="${name}" aria-label="${esc(t('New name of {task}', { task: task.title }))}"><button class="button primary" type="submit">${t('Save')}</button><button class="button secondary" type="button" data-action="cancel-task-edit">${t('Cancel')}</button></form>`;
    const move = (direction, glyph, label, hidden) => `<button class="task-tool" data-move-task="${esc(task.id)}" data-move="${direction}" title="${esc(label)}" aria-label="${esc(label)}" ${hidden ? 'disabled' : ''}>${glyph}</button>`;
    const tools = `<span class="task-tools">${move('up', '↑', t('Move {task} up', { task: task.title }), index === 0)}${move('down', '↓', t('Move {task} down', { task: task.title }), index === list.length - 1)}<button class="task-tool" data-edit-task="${esc(task.id)}" title="${esc(t('Rename {task}', { task: task.title }))}" aria-label="${esc(t('Rename {task}', { task: task.title }))}">✎</button></span>`;
    return `<div class="task-row ${checked ? 'done' : ''}"><label class="task-main"><input type="checkbox" data-task="${esc(task.id)}" ${checked ? 'checked' : ''}><span class="task-box">${icon('tick')}</span><span class="task-text"><strong>${esc(task.title)}</strong><small>${checked ? `${t('Done')} <span data-age="${esc(task.doneAt)}">${age(task.doneAt, now)}</span>` : cadence === 'daily' ? t('Still to do today') : t('Still to do this week')}</small></span></label>${tools}<button class="task-remove" data-remove-task="${esc(task.id)}" title="${esc(t('Remove {task}', { task: task.title }))}" aria-label="${esc(t('Remove {task}', { task: task.title }))}">×</button></div>`;
  }).join('');
  const empty = cadence === 'daily' ? t('No daily tasks yet. Add what you run every day; it unchecks itself at the daily reset.') : t('No weekly tasks yet. Add what you clear once a week; it unchecks itself at the weekly reset.');
  return `<section class="party-section task-panel"><div class="section-heading"><h2>${label} <span>${done.length} / ${list.length}</span></h2><span class="refresh-label">${t('Resets in')} <span data-reset="${cadence}">${remaining(at - now)}</span> · ${esc(when)}</span></div><div class="wish-panel"><div class="task-progress"><i style="width:${list.length ? done.length / list.length * 100 : 0}%"></i></div>${rows ? `<div class="task-list">${rows}</div>` : `<p class="wish-empty">${empty}</p>`}<form id="task-form-${cadence}" class="wish-form"><input name="title" maxlength="60" autocomplete="off" placeholder="${esc(cadence === 'daily' ? t('Add a daily task') : t('Add a weekly task'))}" aria-label="${esc(cadence === 'daily' ? t('Daily task') : t('Weekly task'))}" required><button class="button primary" type="submit">${icon('plus')} ${t('Add')}</button></form></div></section>`;
}
function tasksSignature() { const now = Date.now() + serverOffset; return canonical([tasks.map(task => [task.id, task.title, task.cadence, isDone(task, now, resets)]), resets, editingTask]); }
function tasksView() {
  renderedTasks = tasksSignature(); const now = Date.now() + serverOffset;
  const local = new Date(nextReset('daily', now, resets)).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  keepingDrafts(() => shell(`<main class="dashboard tasks-page"><section class="heading"><div><div class="eyebrow"><span class="tiny-diamond"></span> ${t('EVERY RESET, READY')}</div><h1>${t('Daily & weekly')}<span class="mint">.</span></h1><p>${esc(t('Your own checklist, saved to your account. Tasks uncheck themselves at the daily reset, {hour}:00 UTC ({local} your time), and at the weekly reset on {day}.', { hour: String(resetHour(resets)).padStart(2, '0'), local, day: t(dayName(resets)) }))}</p></div><span class="refresh-label"><i></i>${t('Private to you')}</span></section><div class="task-grid">${taskPanel('daily', now)}${taskPanel('weekly', now)}</div></main>`, 'tasks'));
}
function updateResets() { const now = Date.now() + serverOffset; document.querySelectorAll('[data-reset]').forEach(el => { el.textContent = remaining(nextReset(el.dataset.reset, now, resets) - now); }); }
function renderTasks() { if (tasksSignature() === renderedTasks) { updateAges(); updateResets(); } else tasksView(); }
function applyTasks(data) { tasks = data.tasks || []; if (data.resets) resets = data.resets; }
async function refreshTasks() {
  const data = await pb.send('/api/odyle/tasks');
  if (shown !== '/tasks') return; // navigated elsewhere while loading
  applyTasks(data); if (data.serverNow) serverOffset = Date.parse(data.serverNow) - Date.now(); online = true;
}
function clearRoom() { room = null; members = []; wishlist = []; runs = []; dungeons = []; demo = false; invites = []; }
async function tasksPage(ticket) {
  await leaveRoomTopic(); clearRoom(); editingTask = '';
  await refreshTasks(); if (ticket !== navigation) return; tasksView();
}
// The account page redraws when its apps change or go online, late or offline; ages tick in place.
const contactState = at => { const quiet = Date.now() + serverOffset - timestamp(at); return quiet < 45000 ? 'online' : quiet < 90000 ? 'late' : 'offline'; };
const accountSignature = () => canonical([account?.account, account?.characters, account?.apps.map(a => [a.sessionId, a.character, a.device, contactState(a.lastContactAt)]), account?.devices?.map(d => [d.id, d.name])]);
function accountRender() { renderedAccount = accountSignature(); keepingDrafts(() => shell(accountView({ ...account, reminders: reminderState(), now: Date.now() + serverOffset }), 'account')); }
async function refreshAccount() {
  const data = await pb.send('/api/odyle/account');
  if (shown !== '/account') return;
  account = data; serverOffset = Date.parse(data.serverNow) - Date.now(); online = true;
}
async function accountPage(ticket) {
  await leaveRoomTopic(); clearRoom();
  await refreshAccount(); if (ticket !== navigation) return; accountRender();
}
function dashboard() {
  rendered = signature();
  const now = Date.now() + serverOffset, party = flattened(), actual = party.filter(c => c.characterName);
  const live = actual.filter(c => status(c, now) === 'live'), ready = live.filter(c => c.value >= room.cost);
  // Odyle cannot be pooled. Each player brings one character (their best fresh one),
  // and the party can only do as many cubes as its lowest player allows.
  const players = Object.values(live.reduce((best, c) => (!best[c.user] || c.value > best[c.user].value ? { ...best, [c.user]: c } : best), {}));
  const lowest = players.reduce((low, c) => !low || c.value < low.value ? c : low, null), cubes = lowest ? Math.floor(lowest.value / room.cost) : 0;
  const lowestName = lowest ? esc(lowest.displayName) + (lowest.characterName === lowest.displayName ? '' : ` · ${esc(lowest.characterName)}`) : '';
  // Room changes redraw the whole page; keep half-typed wishlist and run entries and their focus.
  keepingDrafts(() => shell(`<main class="dashboard"><section class="heading"><div><div class="eyebrow"><span class="tiny-diamond"></span> ${t('YOUR NEXT ADVENTURE')}</div><h1>${t('Party overview')}<span class="mint">.</span></h1><p>${esc(tn(members.length, '{n} member', '{n} members'))} · ${esc(tn(actual.length, '{n} character in this room', '{n} characters in this room'))} · ${t('Every last confirmed value stays saved.')}</p></div><div class="heading-actions">${demo ? `<span class="demo-tag">${t('Sample data')}</span>` : ''}<button class="button secondary" data-action="room-settings">${icon('gear')} ${owner() ? t('Room settings') : t('Room')}</button>${owner() ? `<button class="button primary" data-action="invite">${icon('plus')} ${t('Invite a friend')}</button>` : ''}</div></section><section class="stats"><article><div class="stat-caption">${t('CHARACTER READINESS')} ${icon('people')}</div><div class="stat-number">${ready.length}<span>/ ${actual.length}</span></div><div class="stat-detail"><span class="mint">${t('Fresh characters with enough for a cube')}</span></div><div class="mini-track"><i style="width:${actual.length ? ready.length / actual.length * 100 : 0}%"></i></div></article><article><div class="stat-caption">${t('LOWEST PLAYER ODYLE')} ${icon('bolt')}</div><div class="stat-number">${lowest ? lowest.value.toLocaleString(locale()) : '—'}<span class="unit">${t('energy')}</span></div><div class="stat-detail">${lowest ? `${lowestName} · ${esc(tn(players.length, 'best character of {n} player', 'best character of each of {n} players'))}` : t('No current readings; old values stay on their cards')}</div></article><article><div class="stat-caption">${t('PARTY CUBES')} ${icon('diamond')}</div><div class="stat-number">${cubes}<span class="unit">${esc(tn(cubes, 'cube', 'cubes'))}</span></div><div class="stat-detail">${esc(t('Lowest count in the room · {cost} Odyle per cube', { cost: room.cost }))}</div></article></section>${demo ? '' : addBar()}<section class="party-section"><div class="section-heading"><h2>${t('Party characters')} <span>${actual.length}</span></h2><span class="refresh-label"><i></i>${demo ? t('Illustrative readings') : t('Live room updates')}</span></div><div class="member-grid">${party.map((c, i) => card(c, i)).join('')}<button class="empty-card" data-action="invite"><span class="empty-plus">${icon('plus')}</span><strong>${t('A spot for your next ally')}</strong><span>${t('Invite another Discord account')}</span></button></div></section>${wishlistSection(now)}${plannedRuns(now)}<section class="lower-grid"><article class="info-panel"><div class="info-heading"><span class="setup-icon">${icon('shield')}</span><div><h3>${t('Your data. Your call.')}</h3><p>${t('Account-owned characters. Room-scoped sharing.')}</p></div></div><p>${t('All characters keep their last confirmed Odyle. You choose which characters each room sees. Older values remain visible with their timestamp, while readiness uses only fresh readings.')}</p><button class="text-button" data-action="library">${t('My rooms & characters')} ${icon('arrow')}</button></article><article class="next-panel"><div class="eyebrow">${t('BEFORE YOU HEAD OUT')}</div><h3>${t('Check the character you’re taking.')}</h3><p>${esc(tn(ready.length, '{n} character can currently claim a cube at {cost} Odyle.', '{n} characters can currently claim a cube at {cost} Odyle.', { cost: room.cost }))} ${t('A stale value remains stored but does not count as ready.')}</p><button class="button secondary" data-action="${demo ? 'help' : 'reading'}">${demo ? t('How readings work') : t('Connect packet reader')} ${icon('arrow')}</button></article></section></main>`));
}
function card(c, index) {
  const now = Date.now() + serverOffset, state = status(c, now), fresh = state === 'live', known = c.confirmed && c.lastReadingAt, cost = room?.cost || perCube, cubes = known ? Math.floor(c.value / cost) : 0, ready = fresh && c.value >= cost;
  const labels = { live: t('Live'), stale: t('Stale'), unknown: t('No reading'), offline: t('Offline') }, self = c.user === pb.authStore.record?.id && !demo;
  const history = c.id && c.characterName && (known || !demo) ? `<button data-history="${esc(c.id)}" data-name="${esc(c.characterName)}" title="${esc(t('Odyle history of {name}', { name: c.characterName }))}">${t('History')}</button>` : '';
  const action = self && room && c.id ? `<button class="remove" data-share="${esc(c.id)}" data-enabled="false" data-name="${esc(c.characterName)}" ${c.role === 'viewer' ? 'disabled' : ''} title="${esc(t('Hide {name} from this room. Its saved values stay on your account.', { name: c.characterName }))}">${t('Remove from room')}</button>`
    : self && !room ? `<button data-character="${esc(c.id || '')}" data-action="reading">${t('Reader')}</button>${c.id ? `<button class="remove" data-delete-character="${esc(c.id)}" data-name="${esc(c.characterName)}" title="${esc(t('Delete {name} from your account', { name: c.characterName }))}">${t('Delete')}</button>` : ''}`
      : owner() && c.membershipId && c.role !== 'owner' && !demo ? `<button class="remove" data-remove="${esc(c.membershipId)}" data-name="${esc(c.displayName)}">${t('Remove member')}</button>` : '';
  const source = demo ? t('Sample') : c.source === 'packet' ? t('Packet') : c.source === 'manual' ? t('Legacy manual') : t('Waiting for game');
  return `<article class="member-card ${ready ? 'is-ready' : ''} ${state === 'offline' ? 'is-offline' : ''}"><div class="card-top">${portrait(c, index)}<div class="card-id"><div class="member-name"><span class="name-text">${esc(c.characterName || c.displayName)}</span>${c.role === 'owner' ? `<span class="leader-label">${t('LEADER')}</span>` : ''}</div><div class="member-server">${esc(c.displayName)} <span>·</span> ${esc(c.server || t('No characters in this room'))} ${esc((c.region || '').replace('GLOBAL_', ''))}</div></div><span class="status ${state}"><i></i>${labels[state]}</span></div><div class="energy"><strong>${known ? c.value.toLocaleString(locale()) : '—'}</strong><span>${t('Odyle Energy')}</span></div><div class="energy-track"><i style="width:${known ? Math.min(100, c.value / (cost * 8) * 100) : 0}%"></i></div><div class="cube-line">${icon('diamond')}<span>${known ? `<strong>${cubes}</strong> ${esc(tn(cubes, 'cube', 'cubes'))}${fresh ? '' : ` · ${t('last saved')}`}` : t('No confirmed reading')}</span><span class="readiness ${ready ? 'ready' : ''}">${ready ? t('Ready') : fresh ? t('Low energy') : '—'}</span></div><div class="card-footer"><span>${source} · ${known ? `${t('changed')} <span data-age="${esc(c.lastReadingAt)}">${age(c.lastReadingAt, now)}</span>` : t('Not confirmed')}</span><span class="card-actions">${history}${action}</span></div></article>`;
}
let toastTimer;
function toast(message) { const el = document.querySelector('#toast'); if (!el) return; el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 6000); }
// A failed form also says why inside the form, next to what has to change, for screen
// readers (role=alert) and for anyone who missed the toast.
function formError(form, message) { form.querySelector('.form-error')?.remove(); form.insertAdjacentHTML('beforeend', `<p class="form-error" role="alert">${esc(message)}</p>`); }
// Backend and SDK errors arrive in English; t() shows them in the page's language.
const failed = error => toast(t(error?.message || 'Request could not be completed.'));
function modal(title, body, wide = false) { const el = document.querySelector('#modal'); el.className = wide ? 'wide' : ''; el.innerHTML = `<div class="modal-head"><h2>${title}</h2><button data-action="close-dialog" class="close-button" aria-label="${esc(t('Close dialog'))}">×</button></div>${body}`; if (!el.open) el.showModal(); }
const closeModal = () => document.querySelector('#modal')?.close();
const signInPrompt = text => modal(t('Sign in to continue'), `<p>${text}</p><button class="button discord-button" data-action="exit-demo">${t('Sign in with Discord')}</button>`);
function ask(title, text, button, data) { modal(title, `<p>${text}</p><button class="button danger" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}>${button}</button><button class="button secondary" data-action="close-dialog">${t('Keep it')}</button>`); }
function inviteDialog() {
  if (demo) return signInPrompt(t('This workspace uses sample data. Sign in with Discord to create a persistent room.'));
  if (!room || !owner()) return toast(t('Open a room you own to invite friends.'));
  if (!invites.length) invites = savedInvites(storage, room.id);
  modal(t('Invite another Discord account'), `<p>${t('Send a friend the invite link, or the code to enter under Join your friends. Codes expire after 30 minutes; membership remains until they leave or you remove them.')}</p>${invites.map(i => `<div class="invite-row"><div><span>${i.role === 'reporter' ? t('PLAYER INVITE') : t('VIEWER INVITE')}</span><strong>${esc(i.code.match(/.{1,4}/g).join(' '))}</strong><small>${esc(t('Expires {time}', { time: new Date(i.expiresAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) }))}</small></div><div class="invite-actions"><button class="invite-link" data-copy="${esc(inviteLink(location.href, i.code))}" data-copied="${esc(t('Invite link copied.'))}">${icon('link')} ${t('Copy link')}</button><button class="icon-button" data-copy="${esc(i.code)}" aria-label="${esc(t('Copy code'))}" title="${esc(t('Copy code'))}">${icon('copy')}</button></div></div>`).join('')}<button class="button primary" data-action="generate-invites">${invites.length ? t('Revoke codes & generate new invites') : t('Generate invite codes')}</button>`);
}
// Owners rename the room, change roles, hand it over, remove members and close it;
// other members can leave. Every change asks the server and redraws this dialog.
function roomSettings() {
  if (demo) return signInPrompt(t('This workspace uses sample data. Sign in with Discord to manage your own rooms.'));
  if (!owner()) return modal(esc(room.name), `<p>${esc(t('You are a {role} in this room. Leaving removes your access, your wishlist entries and your place on planned runs; your characters stay on your account.', { role: roleName(me()?.role) }))}</p>${room.discordReminders ? `<p>${t('The room owner posts planned runs to a Discord channel 15 minutes before they start.')}</p>` : ''}<button class="button danger" data-action="leave-room">${t('Leave this room')}</button>`);
  const myId = pb.authStore.record?.id;
  const rows = members.map(m => m.user === myId ? `<div class="member-row"><div><strong>${esc(m.displayName)}</strong><small>${t('Leader (you)')}</small></div></div>`
    : `<div class="member-row"><div><strong>${esc(m.displayName)}</strong><small>${esc(roleName(m.role))}</small></div><select data-role="${esc(m.id)}" aria-label="${esc(t('Role of {name}', { name: m.displayName }))}"><option value="reporter" ${m.role === 'reporter' ? 'selected' : ''}>${t('Player')}</option><option value="viewer" ${m.role === 'viewer' ? 'selected' : ''}>${t('Viewer')}</option></select><button data-transfer="${esc(m.id)}" data-name="${esc(m.displayName)}">${t('Make leader')}</button><button class="remove" data-remove="${esc(m.id)}" data-name="${esc(m.displayName)}">${t('Remove')}</button></div>`).join('');
  modal(t('Room settings'), `<form id="rename-form" class="rename-form"><label>${t('Room name')}<input name="name" maxlength="60" required value="${esc(room.name)}"></label><button class="button secondary" type="submit">${t('Rename')}</button></form><h3 class="modal-sub">${t('Members')}</h3><p>${t('Players share characters and plan runs; viewers only watch. A member made viewer stops sharing here.')}</p><div class="member-rows">${rows}</div>${discordSettings()}<div class="modal-actions"><button class="button primary" data-action="invite">${icon('plus')} ${t('Invite a friend')}</button><button class="button danger" data-action="close-room">${t('Close this room')}</button></div>`);
}
// The owner connects a Discord channel: each planned run is posted there 15 minutes
// before it starts. The webhook URL never comes back from the server.
function discordSettings() {
  const on = room.discordReminders;
  return `<h3 class="modal-sub">${t('Discord reminders')}</h3><p>${on ? t('Reminders are on: each planned run is posted to your Discord channel 15 minutes before it starts.') : t('Post each planned run to a Discord channel 15 minutes before it starts. In Discord, open the channel settings → Integrations → Webhooks, create one and paste its URL here.')}</p><form id="discord-form" class="rename-form"><label>${on ? t('Replace the webhook URL') : t('Webhook URL')}<input name="webhook" type="url" autocomplete="off" required placeholder="https://discord.com/api/webhooks/…"></label><button class="button secondary" type="submit">${on ? t('Replace') : t('Connect')}</button></form>${on ? `<button class="text-button" data-action="discord-off">${t('Stop Discord reminders')}</button>` : ''}`;
}
// Demo characters get a made-up history so the chart can be tried without signing in.
function demoHistory(id) {
  const c = members.flatMap(m => m.characters || []).find(x => x.id === id), now = Date.now(), readings = [];
  let value = Math.max(0, (c?.value || 100) - 90);
  for (let i = 12; i >= 0; i--) { readings.push({ value, at: new Date(now - i * 5 * 3600000 - 600000).toISOString() }); value = i ? Math.max(0, value + [15, 20, -40, 10, 25, 5][i % 6]) : c?.value || value; }
  readings[readings.length - 1].value = c?.value || value;
  return { readings };
}
async function historyDialog(id, name) {
  const data = demo ? demoHistory(id) : await pb.send('/api/odyle/history/' + id);
  if (!demo && data.serverNow) serverOffset = Date.parse(data.serverNow) - Date.now();
  const now = Date.now() + serverOffset, cost = room?.cost || perCube;
  modal(esc(t('{name} · Odyle history', { name })), `<p>${t('Every change in the last 30 days. A value holds until the next change; the line marks one cube.')}</p>${historyChart(data.readings, { now, cost })}${data.readings.length ? historyList(data.readings) : ''}`, true);
  bindHistoryChart(document.querySelector('#modal .history-chart'));
}
async function desktopDialog() {
  if (!pb.authStore.isValid || demo) return toast(t('Sign in with Discord to connect your reader.'));
  const [pair] = await Promise.all([send('desktop-code'), loadWindowsRelease()]), link = connectionLink(backend, pair.code);
  modal(t('Connect your packet reader'), `<p>${t('Copy this link, then click <strong>Paste link & connect</strong> in the Windows app. The reader starts by itself and follows the character you log in with.')}</p><button class="button primary" data-copy="${esc(link)}" data-copied="${esc(t('Connection link copied.'))}">${icon('copy')} ${t('Copy connection link')}</button><p>${t('The link expires in five minutes and works once. The app then stays paired, even after weeks switched off, until you disconnect it or sign out everywhere. The app requires Npcap.')}</p>${downloadPanel()}<div class="info-panel"><h3>${t('How it works')}</h3><p>${t('Start the reader before you log into your character. It detects the character, reads the Odyle snapshot from the game and sends the value again only when it changes. Nothing is injected and no raw traffic leaves your PC.')}</p></div>`);
}
async function send(action, body = {}) {
  const data = await pb.send('/api/odyle/' + action, { method: 'POST', body });
  if (data.serverNow) serverOffset = Date.parse(data.serverNow) - Date.now(); return data;
}
async function refreshRoom() {
  const id = room.id, snapshot = await pb.send('/api/odyle/snapshot/' + id);
  if (room?.id !== id) return; // navigated elsewhere while loading
  room = snapshot.room; perCube = room.cost; members = snapshot.members; wishlist = snapshot.wishlist || []; runs = snapshot.runs || []; dungeons = snapshot.dungeons || []; serverOffset = Date.parse(snapshot.serverNow) - Date.now(); online = true;
  characters = me()?.characters || characters;
  if (!document.querySelector('#modal')?.open) renderDashboard();
}
async function leaveRoomTopic() { const stops = roomTopics; roomTopics = []; for (const stop of stops) await stop().catch(() => { /* already gone */ }); }
async function library(ticket) {
  await leaveRoomTopic(); clearRoom();
  const [list, mine] = await Promise.all([pb.send('/api/odyle/rooms'), pb.collection('characters').getFullList({ sort: 'created' }), loadWindowsRelease()]);
  if (ticket !== navigation) return;
  rooms = list.rooms; perCube = list.odylePerCube || perCube; characters = mine; online = true; if (list.serverNow) serverOffset = Date.parse(list.serverNow) - Date.now(); libraryView(); renderedLibrary = librarySignature();
}
async function openRoom(id, ticket) {
  await leaveRoomTopic();
  clearRoom(); room = { id }; rendered = ''; await refreshRoom();
  if (ticket !== navigation) return;
  // The room's changes and its readers' heartbeats (backend/odyle/realtime.go). Without
  // realtime the room is fetched every 15 seconds instead.
  const topics = [];
  try {
    topics.push(await pb.realtime.subscribe('odyle.room.' + id, data => roomNews(id, data).catch(failure)));
    topics.push(await pb.realtime.subscribe('odyle.presence.' + id, data => roomPresence(id, data)));
  } catch { live = false; }
  if (ticket !== navigation) { for (const stop of topics) await stop().catch(() => { /* already gone */ }); return; }
  roomTopics = topics;
}
// News of the open room: changed characters are applied in place, anything else fetches
// the snapshot again, and a member who was removed leaves the room.
async function roomNews(id, data) {
  if (room?.id !== id) return;
  if (data?.removed) return leftRoom(id);
  if (Array.isArray(data?.characters) && applyRoomCharacters(members, data.characters)) { characters = me()?.characters || characters; return renderPage(); }
  try { await refreshRoom(); }
  catch (error) { if ([403, 404].includes(error.status)) return leftRoom(id); online = false; renderConnection(); }
}
async function leftRoom(id) { forget(id); await go('/', true); toast(t('Your access to this room ended. Your characters are still saved.')); }
function roomPresence(id, data) {
  if (room?.id !== id || !data?.seen) return;
  applySeen(data.seen, ...members.map(m => m.characters));
  renderPage();
}
// The account's own topic while signed in: its characters, rooms, tasks and Windows apps
// changed, or its readers sent heartbeats. A page fetches its data again when the
// realtime connection comes back, as news may have been missed meanwhile.
let ownTopic = null, ownTopicUser = '', connectTopic = null, live = false, connects = 0, disconnected;
async function watchOwnTopic() {
  const id = pb.authStore.record?.id;
  if (!id || ownTopicUser === id) return;
  await unwatchOwnTopic(); ownTopicUser = id;
  try {
    connects = pb.realtime.isConnected ? 1 : 0;
    connectTopic = await pb.realtime.subscribe('PB_CONNECT', () => {
      clearTimeout(disconnected); live = true;
      if (connects++ > 0) refreshPage().then(renderPage, () => { online = false; renderConnection(); });
    });
    ownTopic = await pb.realtime.subscribe('odyle.user.' + id, data => ownNews(data));
    if (pb.realtime.isConnected) live = true;
  } catch { ownTopicUser = ''; live = false; }
}
async function unwatchOwnTopic() {
  const stops = [ownTopic, connectTopic].filter(Boolean);
  ownTopic = connectTopic = null; ownTopicUser = ''; live = false;
  for (const stop of stops) await stop().catch(() => { /* already gone */ });
}
// A connection that stays away for three seconds counts as lost: pages fetch every 15 seconds until it is back.
pb.realtime.onDisconnect = active => { if (active.length) { clearTimeout(disconnected); disconnected = setTimeout(() => { live = false; }, 3000); } };
async function ownNews(data) {
  if (demo || !data) return;
  const library = !room && shown !== '/tasks' && shown !== '/account';
  try {
    // The open room hears of its own changes on its topic.
    if (data.refresh) { if (!room) await refreshPage(); }
    else if (Array.isArray(data.characters) && !applyCharacters(characters, data.characters) && library) await refreshPage();
    if (data.seen) applySeen(data.seen, characters);
    if (data.contact) applyContact(data.contact, account?.apps);
    renderPage();
  } catch (error) { if (error?.status === 401) return expired(); online = false; renderConnection(); }
}
// The current page's data, fetched again.
async function refreshPage() {
  if (room) await refreshRoom();
  else if (shown === '/tasks') await refreshTasks();
  else if (shown === '/account') await refreshAccount();
  else {
    const [list, mine] = await Promise.all([pb.send('/api/odyle/rooms'), pb.collection('characters').getFullList({ sort: 'created' })]);
    if (!room) { rooms = list.rooms; characters = mine; perCube = list.odylePerCube || perCube; if (list.serverNow) serverOffset = Date.parse(list.serverNow) - Date.now(); }
  }
  online = true;
}
// Redraws what changed on the current page; ages and live/stale states tick in place.
function renderPage() {
  if (demo || document.querySelector('#modal')?.open) return;
  if (room) renderDashboard();
  else if (document.querySelector('.tasks-page')) renderTasks();
  else if (document.querySelector('.account-page')) { if (accountSignature() !== renderedAccount) accountRender(); else updateAges(); }
  else if (document.querySelector('.personal-characters') && librarySignature() !== renderedLibrary) renderLibrary();
  else updateAges();
}
// Redraws the current page, for example after the language changed.
function rerender() {
  if (demo) return demoSession();
  if (room) return dashboard();
  if (shown === '/tasks') return tasksView();
  if (shown === '/account' && account) return accountRender();
  if (pb.authStore.isValid) return libraryView();
  welcome(Boolean(joinCode(shown || '')));
}

// Every page has its own URL: #/ (welcome or your rooms), #/room/<id>, #/tasks,
// #/account, #/demo and #/join/<code> (an invite link). Hash routes keep the
// relative-base build working from any static host, and a reload or shared link opens
// the same page. The last signed-in page is remembered so a fresh visit resumes there.
let shown = null, navigation = 0;
const memoryKey = 'odyle.location';
function remembered() { try { return JSON.parse(storage.getItem(memoryKey)) || {}; } catch { return {}; } }
function remember(path) { try { storage.setItem(memoryKey, JSON.stringify({ path, room: path.startsWith('/room/') ? path.slice(6) : remembered().room })); } catch { /* storage full or blocked */ } }
function forget(id) { try { if (!id) storage.removeItem(memoryKey); else if (remembered().room === id) storage.setItem(memoryKey, JSON.stringify({ path: '/' })); } catch { /* storage blocked */ } }
function currentPath() { const match = location.hash.match(/^#(\/(?:room\/[A-Za-z0-9]{1,40}|join\/[A-Za-z0-9-]{4,24}|demo|tasks|account)?)$/); return match ? match[1] : '/'; }
async function show(force = false) {
  const path = currentPath();
  if (path === shown && !force) return;
  shown = path; const ticket = ++navigation;
  if (path === '/demo') { await leaveRoomTopic(); return demoSession(); }
  const code = joinCode(path);
  if (!pb.authStore.isValid) { await leaveRoomTopic(); clearRoom(); return welcome(Boolean(code)); }
  if (code) {
    // An invite link: join, then open the room in place of the link.
    try { const result = await send('join', { code }); if (ticket !== navigation) return; toast(t('You are in {room}.', { room: result.room.name })); return await go('/room/' + result.room.id, true); }
    catch (error) { if (ticket !== navigation) return; await go('/', true); return failed(error); }
  }
  remember(path);
  watchOwnTopic().catch(() => { /* without realtime pages fetch every 15 seconds */ });
  const id = path.startsWith('/room/') ? path.slice(6) : '';
  try { if (path === '/tasks') await tasksPage(ticket); else if (path === '/account') await accountPage(ticket); else if (id) await openRoom(id, ticket); else await library(ticket); }
  catch (error) {
    if (ticket !== navigation || !id || ![400, 403, 404].includes(error.status)) throw error;
    forget(id); await go('/', true); toast(t('That room is not available to your account.'));
  }
}
function go(path, replace = false) {
  if (location.hash !== '#' + path) { if (replace) history.replaceState(null, '', '#' + path); else location.hash = path; }
  return show(path === shown);
}
window.addEventListener('hashchange', () => show().catch(failure));

// Tokens last seven days. An open dashboard renews its token every six hours and
// returns to the sign-in page once the server no longer accepts it.
const renewEvery = 6 * 3600000;
async function expired() { await logout(); toast(t('Your sign-in expired. Sign in again with Discord.')); }
function failure(error) { if (error?.status === 401 && pb.authStore.token) return expired(); failed(error); }
// Only a refused token ends the sign-in. An unreachable server (a deploy, a restart,
// a network drop) keeps it: the page says so and tries again by itself.
let retryTimer;
async function authenticated() {
  clearTimeout(retryTimer);
  try { await pb.collection('users').authRefresh(); }
  catch (error) { return [401, 403].includes(error?.status) ? logout() : unreachable(); }
  renewedAt = Date.now(); online = true;
  // A visit without a page in its URL resumes the last page of this browser.
  if (!/^#\//.test(location.hash)) history.replaceState(null, '', '#' + (remembered().path || '/'));
  clearInterval(timer); lastPulse = lastCheck = Date.now();
  // Realtime pushes changes and heartbeats (openRoom, watchOwnTopic), so a page fetches its
  // data again only every five minutes, in case something was missed, and every 15
  // seconds while realtime is down. In between, a health check every 15 seconds keeps the
  // connection label right, and the 5-second tick redraws ages and live/stale states.
  timer = setInterval(async () => {
    loadAnnouncement().catch(() => { /* the next minute tries again */ });
    if (busy || demo) return;
    remindRuns().catch(() => { /* the next tick tries again */ });
    try {
      if (Date.now() - renewedAt >= renewEvery) { renewedAt = Date.now(); await pb.collection('users').authRefresh(); }
      if (Date.now() - lastPulse >= (live ? 300000 : 15000)) { lastPulse = lastCheck = Date.now(); await refreshPage(); }
      else if (Date.now() - lastCheck >= 15000) {
        lastCheck = Date.now(); const back = !online;
        await pb.health.check(); online = true;
        // Back after an outage: whatever happened meanwhile.
        if (back) { lastPulse = Date.now(); await refreshPage(); }
      }
      renderPage();
    } catch (error) { if (error?.status === 401) return expired(); online = false; }
    finally { renderConnection(); }
  }, 5000);
  await show(true).catch(failure);
}
function unreachable() {
  clearInterval(timer); online = false;
  shell(`<main class="welcome"><div class="eyebrow"><span class="tiny-diamond"></span> ${t('STILL SIGNED IN')}</div><h1>${t('The Odyle server is out of reach')}<span class="mint">.</span></h1><p class="intro">${t('Your sign-in is kept. The dashboard tries again every ten seconds and opens your page as soon as the server answers.')}</p><button class="button secondary" data-action="retry">${t('Try again now')} ${icon('arrow')}</button></main>`);
  retryTimer = setTimeout(() => authenticated().catch(failure), 10000);
}
async function discordLogin() {
  let auth;
  // The SDK opens its popup immediately; keep this call within the click gesture.
  try { auth = await pb.collection('users').authWithOAuth2({ provider: 'discord', createData: { displayName: 'Adventurer' } }); }
  catch (error) {
    const methods = await pb.collection('users').listAuthMethods();
    if (!methods.oauth2?.providers?.some(p => p.name === 'discord')) return toast(t('Discord sign-in needs backend configuration. See docs/discord-setup.md.'));
    throw error;
  }
  // The Discord name replaces the placeholder of a new account; the profile route checks it.
  if (auth.record.displayName === 'Adventurer' && auth.meta?.name) {
    try { pb.authStore.save(pb.authStore.token, (await send('profile', { displayName: String(auth.meta.name).slice(0, 40) })).record); } catch { /* keeps Adventurer; Account & data renames it */ }
  }
  await authenticated();
}
async function logout() {
  // Invite codes stay usable for 30 minutes; a shared computer must not keep them.
  await leaveRoomTopic(); await unwatchOwnTopic(); clearInterval(timer); clearTimeout(retryTimer); pb.authStore.clear(); forget(); forgetAllInvites(storage); clearRoom(); rooms = []; characters = []; tasks = []; account = null; online = false;
  await go('/', true);
}
function demoSession() {
  clearRoom(); demo = true; room = { id: 'demo', owner: 'demo', name: t('The evening expedition'), cost: 40 }; const now = Date.now();
  members = [{ id: 'd1', user: 'dave', displayName: 'DaveCZ', role: 'owner', sharing: true, characters: [
    { id: 'c1', characterName: 'DaveCZ', server: 'Atreia', region: 'GLOBAL_EU', source: 'packet', value: 265, confirmed: true, valid: true, lastSeenAt: new Date(now).toISOString(), lastReadingAt: new Date(now - 3000).toISOString() },
    { id: 'c2', characterName: 'DaveAlt', server: 'Atreia', region: 'GLOBAL_EU', source: 'packet', value: 80, confirmed: true, valid: false, lastSeenAt: new Date(now).toISOString(), lastReadingAt: new Date(now - 120000).toISOString() },
  ] }, { id: 'd2', user: 'lumina', displayName: 'Lumina', role: 'reporter', sharing: true, characters: [{ id: 'c3', characterName: 'Lumina', server: 'Atreia', region: 'GLOBAL_EU', source: 'packet', value: 180, confirmed: true, valid: true, lastSeenAt: new Date(now).toISOString(), lastReadingAt: new Date(now - 9000).toISOString() }] },
  { id: 'd3', user: 'kaelen', displayName: 'Kaelen', role: 'reporter', sharing: true, characters: [{ id: 'c4', characterName: 'Kaelen', server: 'Atreia', region: 'GLOBAL_EU', source: 'packet', value: 35, confirmed: true, valid: true, lastSeenAt: new Date(now).toISOString(), lastReadingAt: new Date(now - 12000).toISOString() }] },
  { id: 'd4', user: 'nyx', displayName: 'Nyx', role: 'reporter', sharing: false, characters: [] }];
  wishlist = [{ key: 'fire temple', dungeon: 'Fire Temple', users: ['dave', 'lumina', 'kaelen'] }, { key: 'draupnir cave', dungeon: 'Draupnir Cave', users: ['lumina', 'nyx'] }, { key: 'udas temple (hard)', dungeon: 'Udas Temple (Hard)', users: ['kaelen'] }];
  runs = [{ id: 'r1', dungeon: 'Fire Temple', startsAt: new Date(Math.ceil((now + 3600000) / 1800000) * 1800000).toISOString(), note: t('Bring potions'), planner: 'dave', attendees: ['dave', 'lumina'] }];
  dashboard();
}
app.addEventListener('submit', async e => {
  e.preventDefault(); if (busy) return; busy = true;
  const form = e.target, data = Object.fromEntries(new FormData(form)), button = form.querySelector('[type="submit"]'); button.disabled = true; form.querySelector('.form-error')?.remove();
  try {
    if (form.id === 'create-form') { const result = await send('create', { name: data.name }); rememberInvites(storage, result.room.id, result.invites); await go('/room/' + result.room.id); invites = result.invites; inviteDialog(); }
    else if (form.id === 'join-form') { const result = await send('join', { code: data.code }); await go('/room/' + result.room.id); }
    else if (form.id === 'wish-form') {
      if (demo) return signInPrompt(t('This workspace uses sample data. Sign in with Discord to keep a dungeon wishlist in your own room.'));
      await send('wishlist', { roomId: room.id, dungeon: data.dungeon, wanted: true }); form.reset(); await refreshRoom();
    }
    else if (form.id === 'run-form') {
      if (demo) return signInPrompt(t('This workspace uses sample data. Sign in with Discord to plan runs with your party.'));
      const startsAt = new Date(data.startsAt);
      if (Number.isNaN(startsAt.getTime())) return formError(form, t('Choose when the run starts.'));
      await send('plan', { roomId: room.id, dungeon: data.dungeon, startsAt: startsAt.toISOString(), note: data.note }); form.reset(); await refreshRoom();
    }
    else if (form.id === 'run-edit-form') {
      const startsAt = new Date(data.startsAt);
      if (Number.isNaN(startsAt.getTime())) return formError(form, t('Choose when the run starts.'));
      await send('plan', { roomId: room.id, id: data.runId, dungeon: data.dungeon, startsAt: startsAt.toISOString(), note: data.note }); closeModal(); await refreshRoom(); toast(t('Run updated.'));
    }
    else if (form.id === 'discord-form') { await send('discord-webhook', { roomId: room.id, webhook: data.webhook, language: language() }); await refreshRoom(); roomSettings(); toast(t('Discord reminders are on. Check the channel for the test message.')); }
    else if (form.id === 'task-edit-form') { applyTasks(await send('task', { id: form.dataset.id, title: data.title })); editingTask = ''; tasksView(); }
    else if (form.id === 'rename-form') { await send('rename', { roomId: room.id, name: data.name }); await refreshRoom(); roomSettings(); toast(t('Room renamed.')); }
    else if (form.id === 'profile-form') {
      const result = await send('profile', { displayName: data.displayName });
      pb.authStore.save(pb.authStore.token, result.record); account.account.displayName = result.record.displayName; accountRender(); toast(t('Display name saved.'));
    }
    else if (form.id.startsWith('task-form-')) { applyTasks(await send('task', { title: data.title, cadence: form.id.slice(10) })); form.reset(); tasksView(); }
  } catch (error) { if (error?.status === 401 && pb.authStore.token) expired(); else if (form.isConnected) formError(form, t(error?.message || 'Request could not be completed.')); else failed(error); }
  finally { busy = false; if (button.isConnected) button.disabled = false; }
});
app.addEventListener('click', async e => {
  const el = e.target.closest('button, .brand'); if (!el) return;
  try {
    if (el.matches('.brand')) { e.preventDefault(); return await go('/'); }
    if (el.dataset.room) return await go('/room/' + el.dataset.room);
    if (el.dataset.copy) { await navigator.clipboard.writeText(el.dataset.copy); return toast(el.dataset.copied || t('Code copied.')); }
    if (el.dataset.history) return await historyDialog(el.dataset.history, el.dataset.name);
    if (el.dataset.remove) return ask(esc(t('Remove {name}?', { name: el.dataset.name || t('this member') })), t('Their saved characters stay on their account. This removes their access to this room.'), t('Remove member'), { 'confirm-remove': el.dataset.remove });
    if (el.dataset.transfer) return ask(esc(t('Make {name} the leader?', { name: el.dataset.name })), esc(t('{name} becomes the owner of {room}. You stay in the room as a player and can leave it afterwards.', { name: el.dataset.name, room: room.name })), t('Hand over the room'), { 'confirm-transfer': el.dataset.transfer });
    if (el.dataset.share) {
      const roomId = el.dataset.roomId || room.id; el.disabled = true;
      const enabled = el.dataset.enabled === 'true', name = el.dataset.name;
      let result; try { result = await send('sharing', { roomId, characterId: el.dataset.share, enabled }); } finally { el.disabled = false; }
      if (room) { await refreshRoom(); if (!enabled && name) toast(t('{name} was removed from this room. Its saved values stay on your account.', { name })); return; }
      rooms = rooms.map(r => r.id === roomId ? { ...r, sharedCharacters: result.sharedCharacters, sharing: result.sharedCharacters.length > 0 } : r);
      return renderSharing();
    }
    if (el.dataset.forgetDevice) return ask(esc(t('Remove {name}?', { name: el.dataset.name })), t('This PC stops reading for your account within a minute and needs a new connection link to pair again. Other browsers and PCs stay signed in.'), t('Remove PC'), { 'confirm-forget-device': el.dataset.forgetDevice });
    if (el.dataset.confirmForgetDevice) { await send('forget-device', { deviceId: el.dataset.confirmForgetDevice }); closeModal(); await refreshAccount(); accountRender(); return toast(t('The PC was unpaired.')); }
    if (el.dataset.deleteCharacter) return ask(esc(t('Delete {name}?', { name: el.dataset.name })), t('Its saved Odyle, history and portrait are deleted and every room stops listing it. If the Windows app sees it in game again, it saves it as a new character.'), t('Delete character'), { 'confirm-delete-character': el.dataset.deleteCharacter });
    if (el.dataset.confirmDeleteCharacter) { await send('delete-character', { characterId: el.dataset.confirmDeleteCharacter }); closeModal(); toast(t('Character deleted.')); return await show(true); }
    if (el.dataset.editTask) { editingTask = el.dataset.editTask; tasksView(); return document.querySelector('#task-edit-form input')?.select(); }
    if (el.dataset.moveTask) { el.disabled = true; applyTasks(await send('task', { id: el.dataset.moveTask, move: el.dataset.move })); tasksView(); return document.querySelector(`[data-move-task="${el.dataset.moveTask}"][data-move="${el.dataset.move}"]:not(:disabled)`)?.focus(); }
    if (el.dataset.removeTask) { el.disabled = true; try { applyTasks(await send('task', { id: el.dataset.removeTask, remove: true })); tasksView(); } finally { el.disabled = false; } return; }
    if (el.dataset.wish) {
      el.disabled = true; try { await send('wishlist', { roomId: room.id, dungeon: el.dataset.wish, wanted: el.dataset.wanted === 'true' }); } finally { el.disabled = false; }
      return await refreshRoom();
    }
    if (el.dataset.planWish) {
      const form = document.querySelector('#run-form'); if (!form) return;
      form.elements.dungeon.value = el.dataset.planWish; form.scrollIntoView({ behavior: 'smooth', block: 'center' }); return form.elements.startsAt.focus();
    }
    if (el.dataset.run) {
      el.disabled = true; try { await send('plan', { roomId: room.id, id: el.dataset.run, going: el.dataset.going === 'true' }); } finally { el.disabled = false; }
      return await refreshRoom();
    }
    if (el.dataset.editRun) { const r = runs.find(x => x.id === el.dataset.editRun); if (r) modal(esc(t('Change {dungeon}', { dungeon: r.dungeon })), runEditForm(r, dungeons.length ? dungeons : [...new Set(wishlist.map(w => w.dungeon))])); return; }
    if (el.dataset.calendarRun) {
      const r = runs.find(x => x.id === el.dataset.calendarRun); if (!r) return;
      const going = r.attendees.map(u => members.find(m => m.user === u)?.displayName).filter(Boolean);
      return download(calendarFile(r, { room: room.name, going, now: Date.now() + serverOffset }), `odyle-${r.dungeon.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'run'}.ics`, 'text/calendar');
    }
    if (el.dataset.cancelRun) return ask(esc(t('Cancel {dungeon}?', { dungeon: el.dataset.name })), t('The run disappears for everyone who planned to go.'), t('Cancel run'), { 'confirm-cancel-run': el.dataset.cancelRun });
    if (el.dataset.confirmCancelRun) { await send('plan', { roomId: room.id, id: el.dataset.confirmCancelRun, remove: true }); closeModal(); return await refreshRoom(); }
    if (el.dataset.clearWish) return ask(t('Clear from the wishlist?'), t('This takes <strong>{dungeon}</strong> off the wishlist for every member, for example after the party ran it. Anyone can add it again.', { dungeon: esc(el.dataset.clearWish) }), t('Clear for everyone'), { 'confirm-clear': el.dataset.clearWish });
    if (el.dataset.confirmClear) { await send('wishlist', { roomId: room.id, dungeon: el.dataset.confirmClear, wanted: false, everyone: true }); closeModal(); return await refreshRoom(); }
    if (el.dataset.confirmRemove) { await send('revoke', { roomId: room.id, memberId: el.dataset.confirmRemove }); closeModal(); return await refreshRoom(); }
    if (el.dataset.confirmTransfer) { await send('transfer', { roomId: room.id, memberId: el.dataset.confirmTransfer }); closeModal(); await refreshRoom(); return toast(t('You handed the room over. You are now a player in it.')); }
    switch (el.dataset.action) {
      case 'discord': await discordLogin(); break;
      case 'retry': await authenticated(); break;
      case 'cancel-task-edit': editingTask = ''; tasksView(); break;
      case 'discord-off': await send('discord-webhook', { roomId: room.id, webhook: '' }); await refreshRoom(); roomSettings(); toast(t('Discord reminders are off.')); break;
      case 'reminders': await toggleReminders(); accountRender(); break;
      case 'overview': room ? dashboard() : await go(pb.authStore.isValid && remembered().room ? '/room/' + remembered().room : '/'); break;
      case 'library': await go('/'); break;
      case 'tasks': await go('/tasks'); break;
      case 'account': if (!pb.authStore.isValid || demo) await go('/'); else await go('/account'); break;
      case 'demo': await go('/demo'); break;
      case 'exit-demo': await go('/'); break;
      case 'close-dialog': closeModal(); break;
      case 'invite': inviteDialog(); break;
      case 'room-settings': roomSettings(); break;
      case 'reading': await desktopDialog(); break;
      case 'add-all': await send('sharing', { roomId: room.id, enabled: true }); await refreshRoom(); break;
      case 'generate-invites': invites = (await send('invites', { roomId: room.id })).invites; rememberInvites(storage, room.id, invites); inviteDialog(); break;
      case 'desktop': await desktopDialog(); break;
      case 'hide-announcement': storage.setItem(hiddenAnnouncementKey, announcement?.text || ''); renderAnnouncement(); break;
      case 'help': modal(t('Saved characters, fresh readings'), [
        t('Sign in with Discord to create your account. Rooms and all character readings persist across sign-outs and room changes.'),
        t('Each character is shared per room: choose them under My rooms & characters → Room sharing, or inside the room: add one from the bar above the party and take it out with Remove from room on its card. Friends only see the characters you linked to that room. A viewer invite grants read-only room access.'),
        t('Each room keeps a dungeon wishlist and planned runs: add the dungeons you still need, join an entry with Need it too, plan a run with a time and join it with Going. The room owner can clear an entry for everyone.'),
        t('Daily & weekly is your own checklist: add the tasks you run every day or week and tick them off. They uncheck themselves at the daily and weekly reset of the Global service, so nothing is deleted and nothing needs re-adding.'),
        t('The Windows app is a free download from its GitHub releases; My rooms & characters links the newest version, and an installed app updates itself from new releases. It pairs once with a one-time link, stays paired until you disconnect it and reads game packets locally. Raw game traffic stays on your PC. Only normalized readings from a validated adapter may be shared.'),
        t('The Windows app sends Odyle when it first reads it and whenever it changes; each change is kept for 30 days as the character’s history. A reading counts as live while the app reports the game connection; 45 seconds without that it turns stale and stays saved. Readings are decoded from the Global game stream by the reference adapter; manual entry is disabled.'),
        t('Account & data lets you download everything stored for you, sign out everywhere and delete your account.'),
      ].map(p => `<p>${p}</p>`).join('')); break;
      case 'session': if (!pb.authStore.isValid || demo) await go('/'); else modal(t('Your Discord account'), `<p>${esc(pb.authStore.record.displayName)} · ${t('Rooms and characters remain saved after sign-out.')}</p><div class="modal-actions"><button class="button secondary" data-action="account">${t('Account & data')}</button><button class="button secondary" data-action="library">${t('My rooms & characters')}</button><button class="button secondary" data-action="tasks">${t('Daily & weekly tasks')}</button><button class="button secondary" data-action="desktop">${t('Pair Windows app')}</button></div><button class="text-button" data-action="logout">${t('Sign out of this browser')}</button>`); break;
      case 'leave-room': ask(esc(t('Leave {room}?', { room: room.name })), t('You lose access to this room, your wishlist entries and your place on planned runs. Your characters stay on your account; you need a new invite to come back.'), t('Leave room'), { action: 'confirm-leave' }); break;
      case 'close-room': ask(esc(t('Close {room}?', { room: room.name })), t('This deletes the room with its wishlist and planned runs for every member. Characters stay on their accounts. It cannot be undone.'), t('Close room for everyone'), { action: 'confirm-close' }); break;
      case 'confirm-leave': case 'confirm-close': { const id = room.id, closing = el.dataset.action === 'confirm-close'; await send(closing ? 'close' : 'leave', { roomId: id }); closeModal(); forget(id); if (closing) forgetInvites(storage, id); await go('/'); toast(closing ? t('Room closed. Your saved characters are retained.') : t('You left the room. Your saved characters are retained.')); break; }
      case 'export': download(JSON.stringify(await pb.send('/api/odyle/export'), null, 2), `odyle-data-${new Date().toISOString().slice(0, 10)}.json`, 'application/json'); break;
      case 'sign-out-everywhere': ask(t('Sign out everywhere?'), t('Every other browser and every paired Windows app loses access and must sign in or pair again. This browser stays signed in.'), t('Sign out everywhere'), { action: 'confirm-sign-out-everywhere' }); break;
      // The new token ends every realtime sign-in of the account, this browser's too: subscribe again with it.
      case 'confirm-sign-out-everywhere': { const data = await send('sign-out-everywhere'); pb.authStore.save(data.token, data.record); await unwatchOwnTopic(); closeModal(); toast(t('Signed out everywhere else. Pair your Windows app again to keep reading.')); await show(true); break; }
      case 'delete-account': modal(t('Delete your account?'), `<p>${t('Your characters, their history, your memberships, wishlist entries and tasks are deleted for good. Rooms you own pass to their longest-standing player, or close if there is none. Download your data first if you want to keep it.')}</p><label>${esc(t('Type {name} to confirm', { name: pb.authStore.record.displayName }))}<input id="delete-confirm" autocomplete="off"></label><button class="button danger" data-action="confirm-delete-account">${t('Delete account for good')}</button><button class="button secondary" data-action="close-dialog">${t('Keep it')}</button>`); break;
      case 'confirm-delete-account': {
        if (document.querySelector('#delete-confirm')?.value.trim() !== pb.authStore.record.displayName) return toast(t('Type your display name exactly as shown to confirm.'));
        await send('delete-account', { confirm: true }); closeModal(); await logout(); toast(t('Your account was deleted.')); break;
      }
      case 'logout': await logout(); break;
    }
  } catch (error) { failure(error); }
});
function download(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type })), link = document.createElement('a');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// Browser reminders of the runs this account is going to: a notification 15 minutes
// before each one starts while a dashboard tab is open. The choice belongs to this browser.
const remindersKey = 'odyle.reminders', remindedKey = 'odyle.reminded';
const notifications = () => 'Notification' in window;
function reminderState() { if (!notifications()) return 'unsupported'; if (Notification.permission === 'denied') return 'blocked'; return storage.getItem(remindersKey) === 'on' && Notification.permission === 'granted' ? 'on' : 'off'; }
async function toggleReminders() {
  if (reminderState() === 'on') { storage.setItem(remindersKey, 'off'); return toast(t('Run reminders are off in this browser.')); }
  if (!notifications()) return toast(t('This browser cannot show notifications.'));
  if (await Notification.requestPermission() !== 'granted') return toast(t('Notifications are blocked for this site. Allow them in the browser settings.'));
  storage.setItem(remindersKey, 'on'); upcomingAt = 0; toast(t('Run reminders are on in this browser.'));
}
let upcomingAt = 0;
async function remindRuns() {
  if (reminderState() !== 'on' || demo || !pb.authStore.isValid || Date.now() - upcomingAt < 60000) return;
  upcomingAt = Date.now();
  const data = await pb.send('/api/odyle/upcoming'), now = Date.parse(data.serverNow) || Date.now();
  let done; try { done = JSON.parse(storage.getItem(remindedKey)) || {}; } catch { done = {}; }
  for (const r of data.runs) {
    // One notification per run and start time, also across tabs and reloads.
    const at = timestamp(r.startsAt), key = r.id + '@' + r.startsAt;
    if (done[key] || at <= now || at - now > 15 * 60000) continue;
    done[key] = at;
    const title = t('{dungeon} starts {time}', { dungeon: r.dungeon, time: startsIn(at, now) }), options = { body: [r.room, r.note].filter(Boolean).join(' · '), tag: key, icon: 'icon-192.png' };
    try { const worker = await navigator.serviceWorker?.getRegistration(); if (worker) await worker.showNotification(title, options); else new Notification(title, options); } catch { /* permission withdrawn meanwhile */ }
  }
  for (const key in done) if (done[key] < now - 86400000) delete done[key];
  try { storage.setItem(remindedKey, JSON.stringify(done)); } catch { /* storage full or blocked */ }
}
app.addEventListener('change', async e => {
  const el = e.target;
  if (el.id === 'language-select') {
    try { await useLanguage(el.value); } catch (error) { return failure(error); }
    document.documentElement.lang = language(); document.title = t('Odyle — Party command'); storage.setItem(languageKey, language()); return rerender();
  }
  if (el.matches?.('select[data-role]')) {
    try { await send('role', { roomId: room.id, memberId: el.dataset.role, role: el.value }); await refreshRoom(); roomSettings(); toast(t('Role changed.')); }
    catch (error) { failure(error); roomSettings(); }
    return;
  }
  // Ticking a task saves the time it was done; it shows as done until the next reset.
  if (!el.matches?.('input[data-task]')) return;
  const id = el.dataset.task, done = el.checked; el.disabled = true;
  try { applyTasks(await send('task', { id, done })); tasksView(); document.querySelector(`input[data-task="${id}"]`)?.focus(); }
  catch (error) { el.checked = !done; el.disabled = false; failure(error); }
});
app.addEventListener('click', e => { if (e.target.closest('#toast')) e.target.closest('#toast').classList.remove('show'); });
// A closed dialog may have held back room changes (rename, roles); draw them now.
app.addEventListener('close', e => { if (e.target.id === 'modal' && room && !demo) renderDashboard(); }, true);
// A picture that fails to load (removed meanwhile, server unreachable) uncovers the initials.
app.addEventListener('error', e => { if (e.target.matches?.('.portrait img')) e.target.closest('.portrait-photo').remove(); }, true);
// The page language is ready before the first page is drawn; without its dictionary it stays English.
// The service worker keeps the dashboard's files for visits without a connection and
// shows run reminders; development builds go without it.
if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => { /* runs without offline files */ });
useLanguage(detect(storage.getItem(languageKey), navigator.languages || [navigator.language])).catch(() => useLanguage('en')).then(() => {
  document.documentElement.lang = language(); document.title = t('Odyle — Party command');
  loadAnnouncement(true).catch(() => { /* an older backend or no connection: no banner */ });
  if (pb.authStore.isValid) authenticated().catch(failure);
  else show().catch(failure);
});
