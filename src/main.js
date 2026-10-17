import { runReadiness, broughtBy, earliestClaim } from './runready.js';
import { defaultNotifications, dueReminders, quietAt, capAlertText } from './notify.js';
import { discordSettings as discordView, chosenTimes } from './discord.js';
import { defaultClock, clockOf, clockLine, capMismatch } from './clock.js';
import PocketBase, { LocalAuthStore } from 'pocketbase';
import { status, age, escape as esc, timestamp, classOf, regionLabel } from './model.js';
import { connectionLink } from './connection.js';
import { windowsApp } from './release.js';
import { defaults as resetDefaults, isDone, nextReset, remaining, dayName, resetHour, scopes, inScope, left, templatesForm } from './tasks.js';
import { icon } from './icons.js';
import { t, tn, detect, useLanguage, language, locale } from './i18n.js';
import { joinCode, rememberInvites, rememberInvite, forgetInvite, forgetInvites, forgetAllInvites, withCodes, inviteList, inviteDialogBody, inviteLanding, joinedMessage } from './invites.js';
import { historyChart, historyList, bindHistoryChart } from './history.js';
import { setupTracker } from './setup.js';
import { runsSection, startsIn, runEditForm, calendarFile, discordText, calendarOfRuns, nextRunsSection, roomGlance } from './runs.js';
import { wishProblem, runProblem, moved } from './forms.js';
import { inAppBrowser, signInLink } from './signin.js';
import { accountView } from './account.js';
import { applyRoomCharacters, applyCharacters, applySeen, applyContact, applyShared, applyMembership } from './live.js';
import { savedPairing, rememberPairing, forgetPairing, pairedWith, readerList, onlineReader, countdown, readerLabel, pairingSlot } from './pairing.js';
import { party as partyOf, explain, character as readinessOf } from './readiness.js';
import { partySummary, statusReason, readyOrder } from './partyview.js';
import { dungeonKey, entryOf, cubeCost, dungeonFacts, dungeonField } from './catalog.js';
import changelogText from '../CHANGELOG.md?raw';
import privacyText from '../docs/privacy.md?raw';
import { privacyPage } from './privacy.js';
import { parseChangelog } from './changelog.js';
import { whatsNew, updated, updatedNote } from './whatsnew.js';
import { armoryRoute, armoryTarget, armorySearch, armoryProfile, profilePath, findPath, officialPath, waiting, bookmarkLimit, readBookmarks, isBookmarked, addBookmark, removeBookmark, refreshBookmark } from './armory.js';
// The fonts come with the dashboard, so no visitor's address goes to a font service (#39).
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/manrope';
import './style.css';
import './accounts.css';
import './features.css';
import './layout.css';

const backend = import.meta.env.VITE_POCKETBASE_URL || (import.meta.env.DEV ? 'http://127.0.0.1:8090' : window.location.origin);
// Persisted in localStorage: the sign-in is shared by every tab of this browser and survives restarts.
const pb = new PocketBase(backend, new LocalAuthStore('odyle.account'));
pb.autoCancellation(false);
// localStorage can be missing or throw (private modes, blocked storage); every use goes through this.
const storage = (() => { try { const s = window.localStorage; s.getItem('odyle.probe'); return s; } catch { return { getItem: () => null, setItem() {}, removeItem() {} }; } })();
const languageKey = 'odyle.language';
const app = document.querySelector('#app');
let room = null, members = [], wishlist = [], runs = [], dungeons = [], catalog = [], rooms = [], characters = [], demo = false, online = false;
let serverOffset = 0, lastPulse = 0, lastCheck = 0, renewedAt = 0, busy = false, roomTopics = [], perCube = 40, clockRules = defaultClock;
// The newest Windows app release as the backend last reported it; refreshed every ten minutes at most.
let windowsRelease = null, windowsReleaseAt = 0;
// The runs you go to in the next two weeks, for Rooms & characters (#51).
let nextRunsList = [];
let tasks = [], resets = { ...resetDefaults }, renderedTasks = '', taskCharacters = [], taskTemplates = [], taskLimit = 40, tasksKnown = false;
let account = null, renderedAccount = '';
// The account's own Windows readers (readers in GET /rooms and the snapshot), kept current
// by the heartbeats on its own topic: buttons name the PC that reads instead of asking to
// connect one.
let readers = [];
// The message superusers set under Server controls, refreshed every minute at most: from
// the rooms list or a room snapshot, which carry it, or on its own when neither came in
// that minute. Hiding it lasts until the text changes.
let announcement = null, announcementAt = 0;
// Whether the operator paused Discord reminders (the snapshot says so; Room settings tells the owner, #49).
let remindersPaused = false;
// The game's weekly maintenance window from the snapshot (#47); runs inside it say so.
let maintenance = null;
const hiddenAnnouncementKey = 'odyle.announcement.hidden';
let timer = 0;
const me = () => members.find(m => m.user === pb.authStore.record?.id);
const owner = () => demo || room?.owner === pb.authStore.record?.id;
// The owner or an officer (#43): invites, every run, clearing the wishlist for everyone and Discord reminders.
const manager = () => owner() || me()?.role === 'officer';
const mine = () => me()?.characters || [];
const roleName = role => role === 'owner' ? t('leader') : role === 'officer' ? t('officer') : role === 'viewer' ? t('viewer') : t('player');
const colors = ['jade', 'amber', 'blue', 'pink', 'violet'];
// The official game portrait (downloaded by the backend) sits over the initials,
// which remain as the fallback while it loads, if it fails or when there is none.
function portrait(c, index, size = '') {
  const name = c.characterName || c.displayName, url = !demo && c.portrait ? pb.files.getURL(c, c.portrait) : '';
  const photo = url ? `<span class="portrait-photo"><img src="${esc(url)}" alt="" loading="lazy"></span>` : '';
  return `<span class="portrait ${colors[index % colors.length]} ${size}">${esc(name.slice(0, 2).toUpperCase())}${photo}<span class="portrait-rune">${icon('diamond')}</span></span>`;
}
const ownCards = () => characters.map((c, i) => card({ ...c, sharing: true, role: 'reporter', displayName: pb.authStore.record.displayName, user: pb.authStore.record.id }, i)).join('');
// The pages, as links (they open in a new tab too): in the sidebar on wide screens, in the bar
// at the bottom on phones (with the short name). Dialogs sit in the account menu.
const pages = () => [['overview', 'grid', t('Party')], ['library', 'people', t('Rooms & characters'), t('Rooms')], ['tasks', 'check', t('Tasks')], ['armory', 'search', t('Armory')]];
const navItem = (action, active, name, label) => `<a href="${navHref(action)}" data-action="${action}" class="nav-item ${active === action ? 'active' : ''}"${active === action ? ' aria-current="page"' : ''}>${icon(name)}<span class="nav-label">${label}</span>${action === 'tasks' ? taskBadge() : ''}</a>`;
// Where a navigation item leads: the open (or last) room, the library, the checklist, the armory, the account.
function navHref(action) {
  const signedIn = pb.authStore.isValid && !demo;
  if (action === 'overview') return demo ? '#/demo' : room ? '#/room/' + room.id : signedIn && remembered().room ? '#/room/' + remembered().room : '#/';
  return { library: '#/', tasks: signedIn ? '#/tasks' : '#/', armory: '#/armory', account: signedIn ? '#/account' : '#/' }[action] || '';
}
const bottomNav = active => `<nav class="bottom-nav" aria-label="${esc(t('Pages'))}">${[...pages().map(([action, name, label, short]) => [action, name, short || label]), ['account', 'user', t('Account')]].map(([action, name, label]) => `<a href="${navHref(action)}" data-action="${action}" class="${active === action ? 'active' : ''}"${active === action ? ' aria-current="page"' : ''}>${icon(name)}<span>${label}</span>${action === 'tasks' ? taskBadge() : ''}</a>`).join('')}</nav>`;
const connectionLabel = () => `<i></i>${demo ? t('Demo workspace') : online ? t('Connected') : t('Not connected')}`;
// The room switch: the room on screen (or the last one), the account's other rooms and the
// way to a new one. The library brings the list; other pages fetch it once (loadRoomList).
function roomSwitch() {
  const mark = name => `<span class="room-mark">${esc((name || '·').slice(0, 1).toUpperCase())}</span>`;
  if (demo) return `<div class="room-switch is-static">${mark(room?.name)}<span class="room-switch-text"><small>${t('Room')}</small><strong>${esc(room?.name || '')}</strong></span></div>`;
  if (!pb.authStore.isValid) return '';
  const id = room?.id || remembered().room, name = room?.name || rooms.find(r => r.id === id)?.name || '';
  const options = rooms.map(r => `<a href="#/room/${esc(r.id)}" class="menu-item room-option ${r.id === room?.id ? 'active' : ''}"${r.id === room?.id ? ' aria-current="page"' : ''}>${mark(r.name)}<span><strong>${esc(r.name)}</strong><small>${esc(roleName(r.role))}</small></span></a>`).join('');
  return `<details class="room-switch"><summary title="${esc(t('Switch room'))}">${mark(name)}<span class="room-switch-text"><small>${t('Room')}</small><strong>${esc(name || t('Choose a room'))}</strong></span>${icon('chevron')}</summary><div class="menu">${options}<button class="menu-item" data-action="new-room">${icon('plus')}<span>${t('Create or join a room')}</span></button></div></details>`;
}
function renderRoomSwitch() { document.querySelectorAll('.room-switch').forEach(el => { if (!el.open) el.outerHTML = roomSwitch(); }); }
let roomsKnown = false;
async function loadRoomList() { const list = await pb.send('/api/odyle/rooms', { requestKey: 'room-list' }); rooms = list.rooms || []; roomsKnown = true; renderRoomSwitch(); }
// The account menu behind the avatar: the account page, pairing, invites, help, what's new and
// signing out. Signed out (or in the demo) the same place offers help and the way back.
function accountMenu() {
  const connection = `<span class="connection ${online || demo ? 'connected' : ''}">${connectionLabel()}</span>`, help = `<button class="menu-item" data-action="help">${icon('shield')}<span>${t('Reader & privacy')}</span></button>`;
  if (demo || !pb.authStore.isValid) return `<div class="account-guest">${help}${connection}${demo ? `<button class="button secondary" data-action="exit-demo">${t('Leave the demo')}</button>` : ''}</div>`;
  const name = pb.authStore.record?.displayName || '', item = (action, glyph, label) => `<button class="menu-item" data-action="${action}">${icon(glyph)}<span>${label}</span></button>`;
  return `<details class="account-menu"><summary title="${esc(t('Account menu'))}"><span class="avatar">${esc(name.slice(0, 1).toUpperCase() || 'O')}</span><span class="account-text"><strong>${esc(name)}</strong>${connection}</span><span class="sr-only">${t('Account menu')}</span>${icon('chevron')}</summary><div class="menu">${readerItem()}<a class="menu-item" href="#/account" data-action="account">${icon('user')}<span>${t('Account & data')}</span></a>${item('desktop', 'download', t('Pair Windows app'))}${item('invite', 'plus', t('Invitations'))}${help}<a class="menu-item" href="#/changelog">${icon('info')}<span>${t('What\'s new')}</span></a>${item('logout', 'out', t('Sign out'))}</div></details>`;
}
// Phones have no sidebar: the account menu says which PC reads, or offers to connect one.
const readerItem = () => { const reader = readerNow(); return `<button class="menu-item menu-reader ${reader ? 'reader-online' : ''}" data-action="reading">${reader ? `<i></i><span>${esc(readerLabel(reader.name))}</span>` : `${icon('plus')}<span>${t('Connect reader')}</span>`}</button>`; };
// An open menu closes on a click outside it, on a chosen item and on Escape.
document.addEventListener('click', event => document.querySelectorAll('details.room-switch[open], details.account-menu[open]').forEach(menu => { if (!menu.contains(event.target) || event.target.closest('.menu-item')) menu.open = false; }));
document.addEventListener('keydown', event => { if (event.key === 'Escape') document.querySelectorAll('details.room-switch[open], details.account-menu[open]').forEach(menu => { menu.open = false; }); });
// After an update the dashboard says so once (whatsnew.js). A browser that never had the
// dashboard open starts at this version; one that did, but from before What's new, hears of it.
const seenKey = 'odyle.seenVersion';
try { if (!storage.getItem(seenKey)) storage.setItem(seenKey, storage.getItem('odyle.location') || storage.getItem('odyle.account') ? 'earlier' : __APP_VERSION__); } catch { /* storage blocked */ }
const updateNote = () => shown !== '/changelog' && updated(storage.getItem(seenKey), __APP_VERSION__) ? updatedNote(__APP_VERSION__) : '';
function seenVersion() { try { storage.setItem(seenKey, __APP_VERSION__); } catch { /* storage blocked */ } document.querySelector('.update-note')?.remove(); }
function announcementBar() {
  if (!announcement || storage.getItem(hiddenAnnouncementKey) === announcement.text) return '<div class="announcement-slot"></div>';
  const warning = announcement.level === 'warning';
  return `<div class="announcement-slot"><div class="announcement ${warning ? 'warning' : 'info'}" role="${warning ? 'alert' : 'status'}">${icon(warning ? 'alert' : 'info')}<p>${esc(announcement.text)}</p><button class="close-button" data-action="hide-announcement" aria-label="${esc(t('Hide this message'))}" title="${esc(t('Hide this message'))}">×</button></div></div>`;
}
function renderAnnouncement() { const el = document.querySelector('.announcement-slot'); if (el) el.outerHTML = announcementBar(); }
async function loadAnnouncement(force = false) {
  if (!force && Date.now() - announcementAt < 60000) return;
  announcementAt = Date.now();
  showAnnouncement((await pb.send('/api/odyle/announcement')).announcement || null);
  // Signed out nothing else asks the server; its answer shows it is reachable.
  if (!online && !pb.authStore.isValid) { online = true; renderConnection(); }
}
function announced(data) { if (data && 'announcement' in data) { announcementAt = Date.now(); showAnnouncement(data.announcement || null); } }
function showAnnouncement(next) { if (JSON.stringify(next) !== JSON.stringify(announcement)) { announcement = next; renderAnnouncement(); } }
// The connection state follows every refresh, not only full redraws.
function renderConnection() { document.querySelectorAll('.connection').forEach(el => { el.classList.toggle('connected', online || demo); el.innerHTML = connectionLabel(); }); }
// The reader in the sidebar: the PC that reads for the account, or the way to connect one.
function renderReaderStatus() { const el = document.querySelector('.sidebar-foot .reader-button'); if (el) el.outerHTML = readerButton(`${icon('plus')} ${t('Connect reader')}`); document.querySelectorAll('.menu-reader').forEach(item => { item.outerHTML = readerItem(); }); }
// Wide screens: the sidebar with the room switch, the pages, the reader and the account menu.
// Phones: a bar at the top (room switch, account menu) and one at the bottom (pages).
function shell(content, active = 'overview') {
  // A message shown right before a redraw (saved, signed out everywhere…) stays on screen.
  const message = document.querySelector('#toast.show')?.textContent, reader = pb.authStore.isValid && !demo ? readerButton(`${icon('plus')} ${t('Connect reader')}`) : '';
  const home = cls => `<a href="#/" class="${cls}" aria-label="${esc(t('Odyle home'))}"><span class="brand-symbol">${icon('diamond')}</span><span class="brand-name">odyle<span class="brand-dot">.</span></span></a>`;
  app.innerHTML = `<button class="skip-link" data-action="skip">${t('Skip to content')}</button><aside class="sidebar">${home('brand')}${roomSwitch()}<nav aria-label="${esc(t('Pages'))}">${pages().map(([action, name, label]) => navItem(action, active, name, label)).join('')}</nav><div class="sidebar-foot">${reader}${accountMenu()}</div></aside><header class="topbar">${home('brand brand-mini')}${roomSwitch()}${accountMenu()}</header><div class="main">${announcementBar()}${updateNote()}${content}<footer><span>Odyle <a class="version-link" href="#/changelog" title="${esc(t('What\'s new'))}">${esc(__APP_VERSION__)}</a></span><span>${t('Unofficial fan project')} · <a class="footer-link" href="#/privacy">${t('Privacy')}</a></span></footer></div>${bottomNav(active)}<div id="toast" role="status" aria-live="polite"></div><dialog id="modal" aria-labelledby="modal-title"></dialog>`;
  if (message) { const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('show'); }
}
// Browsers built into other apps often cannot finish the Discord sign-in (signin.js); an
// installed web app looks like one but is not.
const standalone = () => navigator.standalone === true || Boolean(window.matchMedia?.('(display-mode: standalone)').matches);
const embedded = () => inAppBrowser(navigator.userAgent, standalone());
// What Odyle is and what its reader does, where players decide to use it: the welcome
// page, the pairing dialog and Reader & privacy.
const scopeText = () => t("Odyle is an unofficial fan project, not affiliated with or endorsed by NCSOFT. The Windows reader only listens to your own game connection: it never reads game memory, changes or sends game traffic, automates play or collects combat data. NCSOFT's rules ban unauthorized programs, so use Odyle at your own risk.");
const scopeNote = () => `<p class="scope-note">${icon('shield')}<span>${scopeText()}</span></p>`;
// The welcome page; an invite link (code) adds its card, filled in from the preview.
function welcome(code = '') {
  shell(`<main class="welcome"><div class="eyebrow"><span class="tiny-diamond"></span> ${t('BUILT FOR YOUR NEXT RUN')}</div><h1>${t('Good runs start<br>with a ready party<span class="mint">.</span>')}</h1><p class="intro">${t('Sign in with Discord. Save the Odyle of every character.<br class="desktop-only"> Create a private room and bring your friends together.')}</p>${code ? inviteLanding(previewed(code)) : ''}${embedded() ? `<p class="join-note in-app-note">${icon('alert')}<span>${t('This page is open in a browser built into another app, where Discord sign-in often fails.')}</span><button class="text-button" data-action="open-elsewhere">${t('Open in your browser')} ${icon('arrow')}</button></p>` : ''}<div class="discord-card"><div class="setup-icon">${icon('people')}</div><h2>${t('One account. Every adventure.')}</h2><p>${t('Your rooms and character readings stay with your Discord account, even after you close the app.')}</p><button class="button discord-button" data-action="discord">${t('Continue with Discord')} ${icon('arrow')}</button><small>${t('First sign-in creates your account. No separate password.')}</small><p class="signin-help" hidden>${t('Continue in the Discord window that opened. Nothing happened?')} <button class="text-button" data-action="open-elsewhere">${t('Open in your browser')}</button></p></div><button class="text-button" data-action="demo">${t('Explore the demo workspace')} ${icon('arrow')}</button><button class="text-button" data-action="armory">${t('Look up a character in the armory')} ${icon('arrow')}</button><p class="welcome-note">${t('No game account needed. No public directory. Just your party.')} <a href="#/privacy">${t('Privacy')}</a></p>${scopeNote()}</main>`);
  if (code && !previewed(code)) previewInvite(code);
}
// What the invite link on screen opens (invites.js inviteLanding), asked once per code:
// the public preview takes the code in the body, so it never lands in a server log.
let preview = { code: '', answer: null };
const previewed = code => preview.code === code ? preview.answer : null;
async function previewInvite(code, again = false) {
  if (!again && previewed(code)) return preview.answer;
  try { preview = { code, answer: await send('invite-preview', { code }) }; } catch { return null; /* the general note stays */ }
  const slot = document.querySelector('.invite-landing');
  if (slot && joinCode(currentPath()) === code) slot.outerHTML = inviteLanding(preview.answer, pb.authStore.isValid);
  return preview.answer;
}
// An invite link that did not join stays on screen: what it opens and why it failed, or
// that it expired or does not work, instead of an empty library.
async function inviteTrouble(code, error, ticket) {
  await leaveRoomTopic(); clearRoom();
  const answer = await previewInvite(code, true); if (ticket !== navigation) return;
  const why = !answer || answer.state === 'valid' ? `<p class="invite-problem" role="alert">${esc(t(error?.message || 'Request could not be completed.'))}</p>` : '';
  shell(`<main class="welcome invite-page"><div class="eyebrow"><span class="tiny-diamond"></span> ${t('ROOM INVITE')}</div><h1>${t('This invite did not work')}<span class="mint">.</span></h1>${inviteLanding(answer, true)}${why}<div class="invite-page-actions"><button class="button primary" data-action="library">${t('My rooms & characters')} ${icon('arrow')}</button></div></main>`, 'library');
}
function libraryView() {
  shell(`<main class="dashboard"><section class="heading"><div><h1>${t('Rooms & characters')}<span class="mint">.</span></h1><p>${t('Welcome, {name}', { name: esc(pb.authStore.record.displayName) })} · ${t('All your rooms and characters, connected to your Discord account.')}</p></div><div class="heading-actions">${appLink('button secondary')}<button class="button secondary" data-action="desktop">${t('Pair Windows app')} ${icon('arrow')}</button></div></section>${nextRunsSection(nextRunsList, Date.now() + serverOffset)}<section class="party-section room-section"><div class="section-heading"><h2>${t('Your rooms')} <span>${rooms.length}</span></h2></div><div class="room-list">${roomItems()}</div><details class="room-setup"${rooms.length ? '' : ' open'}><summary>${icon('plus')} ${t('Create or join a room')}</summary><div class="welcome-grid"><form id="create-form" class="setup-card"><h2>${t('Create a private room')}</h2><p>${t('Keep your party together between sessions.')}</p><label>${t('Room name')}<input name="name" maxlength="60" placeholder="${esc(t('The evening expedition'))}" required></label><button class="button primary" type="submit">${t('Create room')} ${icon('arrow')}</button></form><form id="join-form" class="setup-card"><h2>${t('Join your friends')}</h2><p>${t('Paste the invite code, or just open the invite link your friend sent.')}</p><label>${t('Invite code')}<input name="code" class="code-input" autocomplete="off" placeholder="XXXX XXXX XXXX" maxlength="20" required></label><button class="button secondary" type="submit">${t('Join room')} ${icon('arrow')}</button></form></div></details></section><section class="party-section personal-characters"><div class="section-heading"><h2>${t('Your saved characters')} <span>${characters.length}</span></h2>${readerButton(`${icon('plus')} ${t('Connect reader')}`)}</div><div class="member-grid party-list">${characterCards()}</div></section><section class="party-section room-sharing"><div class="section-heading"><h2>${t('Room sharing')}</h2></div><div class="share-matrix">${sharingMatrix()}</div></section></main>`, 'library');
}
const roomItems = () => rooms.map(r => `<button class="room-item" data-room="${esc(r.id)}"><span class="setup-icon">${icon('diamond')}</span><span><strong>${esc(r.name)}</strong><small>${esc(roomGlance(r, Date.now() + serverOffset))}</small></span>${icon('arrow')}</button>`).join('') || `<p class="intro">${t('Create your first room, or join one with an invite.')}</p>`;
const characterCards = () => (characters.length ? listHead() + ownCards() : '') || `<div class="info-panel"><h3>${t('Every character gets its own reading.')}</h3><p>${t('Connect the Windows reader to read Odyle straight from the game. Values update live while the reader runs and stay saved when you leave a room or sign out.')}</p>${appLink('text-button', t('Download the Windows app'))}</div>`;
// The PC that reads for this account now, or the way to connect a reader: an account
// whose reader is online is not asked to pair again (its dialog offers another PC).
const readerNow = () => onlineReader(readers, Date.now() + serverOffset);
function readerButton(connect) {
  const reader = readerNow();
  return reader ? `<button class="button secondary reader-button reader-online" data-action="reading" title="${esc(t('Show the reader or pair another PC'))}"><i></i>${esc(readerLabel(reader.name))}</button>` : `<button class="button secondary reader-button" data-action="reading">${connect}</button>`;
}
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
  return characters.map((c, i) => `<div class="share-row"><div class="share-character">${portrait(c, i, 'mini')}<div><strong>${esc(c.characterName)}</strong><small>${esc(c.server)} · ${esc(regionLabel(c.region))}</small></div></div><div class="share-rooms">${rooms.map(r => {
    const on = r.sharedCharacters?.includes(c.id), viewer = r.role === 'viewer';
    return `<button class="share-chip ${on ? 'on' : ''}" data-share="${esc(c.id)}" data-room-id="${esc(r.id)}" data-enabled="${!on}" aria-pressed="${on}" ${viewer ? 'disabled' : ''} title="${viewer ? esc(t('Viewers cannot share characters in this room')) : esc(on ? t('Hide {name} in {room}', { name: c.characterName, room: r.name }) : t('Show {name} in {room}', { name: c.characterName, room: r.name }))}"><i></i>${esc(r.name)}</button>`;
  }).join('')}</div></div>`).join('') + `<div class="share-row share-new-row"><div class="share-character"><div><strong>${t('New characters')}</strong><small>${t('shared on their own where this is on')}</small></div></div><div class="share-rooms">${rooms.map(r => shareNewChip(r.id, r.name, r.shareNew, r.role === 'viewer')).join('')}</div></div><p class="share-note">${t('New characters start private, except in rooms where New characters is on. Switched-off characters keep their saved values.')}</p>`;
}
// Whether the characters this account saves from now on are shared in a room by themselves;
// the switch is labelled with the room's name, or with what it does inside the room.
function shareNewChip(roomId, name, on, viewer, label = name) {
  return `<button class="share-chip ${on ? 'on' : ''}" data-share-new="${esc(roomId)}" data-enabled="${!on}" aria-pressed="${Boolean(on)}" ${viewer ? 'disabled' : ''} title="${viewer ? esc(t('Viewers cannot share characters in this room')) : esc(on ? t('New characters are shared in {room} by themselves', { room: name }) : t('Share new characters in {room} by themselves', { room: name }))}"><i></i>${esc(label)}</button>`;
}
// A character saved meanwhile (by the Windows reader): offer the rooms that do not show it yet.
const prompted = new Set();
async function newCharacterPrompt(c) {
  if (prompted.has(c.id) || demo) return;
  prompted.add(c.id);
  rooms = (await pb.send('/api/odyle/rooms')).rooms;
  const open = rooms.filter(r => r.role !== 'viewer' && !r.sharedCharacters?.includes(c.id));
  if (!open.length) return;
  modal(esc(t('New character {name} saved', { name: c.characterName })), `<p>${t('It starts private. Add it to your rooms?')}</p><div class="add-chips prompt-chips">${open.map(r => `<button class="add-chip" data-prompt-share="${esc(c.id)}" data-room-id="${esc(r.id)}">${icon('plus')}${esc(r.name)}</button>`).join('')}</div><div class="modal-actions"><button class="button secondary" data-action="close-dialog">${t('Not now')}</button></div>`);
}
// The party shows only characters added (shared) to this room, the member's own
// included; their other characters wait in the add bar above the party.
function flattened() { return members.flatMap(m => { const added = (m.characters || []).filter(c => c.shared ?? m.sharing); return added.length ? added.map(c => ({ ...c, sharing: true, user: m.user, membershipId: m.id, role: m.role, displayName: m.displayName })) : [{ ...m, id: '', characterName: '', confirmed: false, lastReadingAt: '', source: 'packet' }]; }); }
function addBar() {
  if (me()?.role === 'viewer') return `<div class="sharing-bar"><span>${t('Viewers cannot add characters to this room.')}</span></div>`;
  const missing = mine().filter(c => !c.shared);
  const chips = () => `<div class="add-chips">${missing.map(c => `<button class="add-chip" data-share="${esc(c.id)}" data-enabled="true" title="${esc(t('Add {name} to this room', { name: c.characterName }))}">${icon('plus')}${esc(c.characterName)}</button>`).join('')}${missing.length > 1 ? `<button class="text-button" data-action="add-all">${t('Add all')}</button>` : ''}</div>`;
  // No character saved yet: the steps that get one into the party (#52). With characters saved,
  // the chips below add them.
  if (!mine().length) return setupTracker({ paired: readers.length > 0, online: Boolean(readerNow()), saved: mine().length > 0, shared: false }, {
    install: `${appLink('button secondary small', t('Download the Windows app'))}<button class="button secondary small" data-action="reading">${t('Pair Windows app')}</button>`, add: chips() });
  if (!missing.length) return '';
  return `<div class="sharing-bar"><span>${t('Not in this room')}</span>${chips()}</div>`;
}
// Re-render only when the room data or a readiness state changed; otherwise just refresh the "ago" labels,
// so hover, focus and open menus survive the periodic refresh.
let rendered = '', renderedLibrary = '';
const stable = list => list.map(({ lastSeenAt, updated, characters, ...rest }) => ({ ...rest, characters: characters?.map(({ lastSeenAt: _seen, updated: _updated, ...c }) => c) }));
// Hook responses list record fields in a different order each time; sort keys so identical data compares equal.
const canonical = value => JSON.stringify(value, (key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : v);
function signature() { const now = Date.now() + serverOffset; return canonical([room, stable(members), wishlist, runs, dungeons, catalog, flattened().map(c => status(c, now)), readerNow()?.name ?? null]); }
function updateAges() {
  const now = Date.now() + serverOffset;
  document.querySelectorAll('[data-age]').forEach(el => { el.textContent = age(el.dataset.age, now); });
  document.querySelectorAll('[data-starts]').forEach(el => { el.textContent = startsIn(timestamp(el.dataset.starts), now); });
}
function renderDashboard() { if (signature() === rendered) updateAges(); else dashboard(); }
function librarySignature() { const now = Date.now() + serverOffset; return canonical([stable([{ characters }]), characters.map(c => status({ ...c, sharing: true }, now)), rooms.map(r => [r.id, r.name, r.role, r.cost, r.sharedCharacters]), readerNow()?.name ?? null]); }
function renderSharing() { const el = document.querySelector('.share-matrix'); if (el) el.innerHTML = sharingMatrix(); }
// Redraws the rooms, the saved characters and the sharing list without touching the room forms.
function renderLibrary() {
  const grid = document.querySelector('.personal-characters .member-grid'), list = document.querySelector('.room-section .room-list'); if (!grid || !list) return;
  renderedLibrary = librarySignature(); list.innerHTML = roomItems(); grid.innerHTML = characterCards();
  const button = document.querySelector('.personal-characters .reader-button'); if (button) button.outerHTML = readerButton(`${icon('plus')} ${t('Connect reader')}`);
  document.querySelector('.room-section h2 span').textContent = rooms.length; document.querySelector('.personal-characters h2 span').textContent = characters.length; renderSharing();
}
// Accounts with a live character in this room, for the dots on the wishlist and runs.
function liveUsers(now) { return new Set(partyOf(flattened(), now, room?.cost || perCube).live.map(c => c.user)); }
// The line under a dungeon the catalog lists: its cost and the cubes of it the room's
// party can open now (catalog.js, readiness.js), the party worked out once per cost.
function dungeonInfo(now) {
  const entries = flattened(), parties = new Map(), cost = room?.cost || perCube;
  const party = at => { if (!parties.has(at)) parties.set(at, partyOf(entries, now, at)); return parties.get(at); };
  return name => dungeonFacts(entryOf(catalog, name), { perCube: cost, party });
}
// How long a dungeon has been on the wishlist, from its first entry.
const wanted = (since, now) => { const days = Math.floor((now - timestamp(since)) / 86400000); return since && days >= 1 ? tn(days, 'wanted for {n} day', 'wanted for {n} days') : t('added today'); };
// What members still need to run, most wanted first. A dot marks members with a
// live character in this room, so the party sees what it could run right now.
function wishlistSection(now) {
  const myId = pb.authStore.record?.id, viewer = me()?.role === 'viewer';
  const name = id => id === myId ? t('You') : members.find(m => m.user === id)?.displayName || t('Member');
  const live = liveUsers(now), facts = dungeonInfo(now);
  // With a dungeon catalog the form offers the listed dungeons you are not on yet; otherwise it suggests the entries others added.
  const choices = catalog.filter(d => !wishlist.some(w => dungeonKey(w.dungeon) === dungeonKey(d.name) && w.users.includes(myId))), suggestions = wishlist.filter(w => !w.users.includes(myId)).map(w => w.dungeon);
  const form = viewer ? `<p class="wish-note">${t('Viewers can see the wishlist but cannot add dungeons.')}</p>` : `<form id="wish-form" class="wish-form">${dungeonField({ catalog, choices, suggestions, list: 'wish-suggestions', placeholder: catalog.length ? t('Choose a dungeon you still need to run') : t('Add a dungeon you still need to run'), perCube: room?.cost || perCube })}<button class="button primary" type="submit">${icon('plus')} ${t('Add')}</button></form>`;
  const rows = wishlist.map(w => {
    // Runs need a dungeon the catalog lists, when there is one; Plan picks it in the run form.
    const mine = w.users.includes(myId), count = w.users.length, listed = entryOf(catalog, w.dungeon), plannable = !catalog.length || listed;
    const people = w.users.map(u => `<span class="wish-person ${live.has(u) ? 'live' : ''}"${live.has(u) ? ` title="${esc(t('Live in this room now'))}"` : ''}><i></i>${esc(name(u))}${live.has(u) ? `<span class="sr-only"> (${t('live')})</span>` : ''}</span>`).join('');
    const actions = demo ? '' : (mine ? `<button data-wish="${esc(w.dungeon)}" data-wanted="false" title="${esc(t('Take yourself off {dungeon}', { dungeon: w.dungeon }))}">${t('Remove me')}</button>` : viewer ? '' : `<button data-wish="${esc(w.dungeon)}" data-wanted="true">${icon('plus')} ${t('Need it too')}</button>`)
      + (viewer || !plannable ? '' : `<button data-plan-wish="${esc(listed?.name ?? w.dungeon)}" title="${esc(t('Plan a run of {dungeon}', { dungeon: w.dungeon }))}">${icon('calendar')} ${t('Plan')}</button>`)
      + (manager() ? `<button class="remove" data-clear-wish="${esc(w.dungeon)}" title="${esc(t('Clear {dungeon} for everyone', { dungeon: w.dungeon }))}">${t('Clear')}</button>` : '');
    return `<div class="wish-row ${mine ? 'mine' : ''}"><div class="wish-name"><strong>${esc(w.dungeon)}</strong><small>${esc(tn(count, '{n} member needs it', '{n} members need it'))} · ${esc(wanted(w.since, now))}</small>${facts(w.dungeon)}</div><div class="wish-people">${people}</div><div class="wish-actions">${actions}</div></div>`;
  }).join('');
  return `<section class="party-section wishlist"><div class="section-heading"><h2>${t('Dungeon wishlist')} <span>${wishlist.length}</span></h2><span class="refresh-label">${t('Most wanted first')}</span></div><div class="wish-panel">${form}${rows ? `<div class="wish-list">${rows}</div>` : `<p class="wish-empty">${t('Nothing on the wishlist yet. Add the dungeons you still need so the party can plan its next run.')}</p>`}</div></section>`;
}
function plannedRuns(now) {
  const suggestions = [...new Set(wishlist.map(w => w.dungeon))], entries = flattened(), cost = room?.cost || perCube;
  // A run counts at its dungeon's own cost when the catalog has one.
  const costOf = r => entryOf(catalog, r.dungeon)?.cost || cost;
  const players = [...new Set(entries.filter(c => c.role !== 'viewer').map(c => c.user))].map(user => broughtBy(user, entries, now).character);
  return runsSection({ runs, members, myId: pb.authStore.record?.id || (demo ? 'dave' : ''), viewer: me()?.role === 'viewer', owner: manager(), live: liveUsers(now), now, suggestions, catalog, perCube: cost, facts: dungeonInfo(now), demo, discord: room?.discordReminders,
    readiness: r => runReadiness(r, entries, now, costOf(r), clockRules), costOf, maintenance, start: clockRules.paused ? null : earliestClaim(players, now, cost, clockRules) });
}
// Full redraws keep a half-typed form entry, a picked dungeon (wishlist, run, task forms) or a
// changed checkbox, and the focus; what the user did not change shows what the redraw brings.
function keepingDrafts(render) {
  const ticked = i => i.type === 'checkbox' || i.type === 'radio';
  const changed = i => ticked(i) ? i.checked !== i.defaultChecked : Boolean(i.value) && i.value !== (i.defaultValue ?? '');
  const drafts = [...document.querySelectorAll('form[id] input[name]:not([type=hidden]), form[id] select[name]')].filter(i => changed(i) || i === document.activeElement).map(i => ({ selector: `#${i.form.id} [name="${i.name}"]` + (ticked(i) ? `[value="${CSS.escape(i.value)}"]` : ''), ticked: ticked(i), checked: i.checked, value: i.value, focused: i === document.activeElement, start: i.selectionStart, end: i.selectionEnd }));
  render();
  for (const d of drafts) {
    const input = document.querySelector(d.selector); if (!input || (input.options && ![...input.options].some(o => o.value === d.value))) continue;
    if (d.ticked) input.checked = d.checked; else input.value = d.value;
    if (d.focused) { input.focus(); if (input.setSelectionRange && d.start !== null) try { input.setSelectionRange(d.start, d.end); } catch { /* inputs without a text selection */ } }
  }
}
// Personal daily and weekly checklists. A task counts as done while it was checked
// after the current reset (07:00 UTC and Wednesday by default; the server names
// both from odyle_settings), so the lists clear by themselves and nothing is deleted.
let editingTask = '';
// The list shown (the account's, or a character's), kept per browser.
const taskScopeKey = 'odyle.taskScope';
function taskScope() { let id = ''; try { id = storage.getItem(taskScopeKey) || ''; } catch { /* storage blocked */ } return taskCharacters.some(c => c.id === id) ? id : ''; }
function taskPanel(cadence, now) {
  const scope = taskScope(), list = tasks.filter(task => task.cadence === cadence && inScope(task, scope)), done = list.filter(task => isDone(task, now, resets)), at = nextReset(cadence, now, resets), label = cadence === 'daily' ? t('Daily') : t('Weekly');
  const when = new Date(at).toLocaleString(locale(), cadence === 'weekly' ? { weekday: 'long', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' });
  const rows = list.map((task, index) => {
    const checked = isDone(task, now, resets), name = esc(task.title);
    if (task.id === editingTask) return `<form id="task-edit-form" class="task-row task-edit" data-id="${esc(task.id)}"><input name="title" maxlength="60" autocomplete="off" required value="${name}" aria-label="${esc(t('New name of {task}', { task: task.title }))}"><button class="button primary" type="submit">${t('Save')}</button><button class="button secondary" type="button" data-action="cancel-task-edit">${t('Cancel')}</button></form>`;
    const move = (direction, glyph, label, hidden) => `<button class="task-tool" data-move-task="${esc(task.id)}" data-move="${direction}" title="${esc(label)}" aria-label="${esc(label)}" ${hidden ? 'disabled' : ''}>${glyph}</button>`;
    const tools = `<span class="task-tools">${move('up', '↑', t('Move {task} up', { task: task.title }), index === 0)}${move('down', '↓', t('Move {task} down', { task: task.title }), index === list.length - 1)}<button class="task-tool" data-edit-task="${esc(task.id)}" title="${esc(t('Rename {task}', { task: task.title }))}" aria-label="${esc(t('Rename {task}', { task: task.title }))}">✎</button></span>`;
    return `<div class="task-row ${checked ? 'done' : ''}"><label class="task-main"><input type="checkbox" data-task="${esc(task.id)}" ${checked ? 'checked' : ''}><span class="task-box">${icon('tick')}</span><span class="task-text"><strong>${esc(task.title)}</strong><small>${checked ? `${t('Done')} <span data-age="${esc(task.doneAt)}">${age(task.doneAt, now)}</span>` : cadence === 'daily' ? t('Still to do today') : t('Still to do this week')}</small></span></label>${tools}<button class="task-remove" data-remove-task="${esc(task.id)}" data-name="${name}" title="${esc(t('Remove {task}', { task: task.title }))}" aria-label="${esc(t('Remove {task}', { task: task.title }))}">×</button></div>`;
  }).join('');
  const empty = cadence === 'daily' ? t('No daily tasks yet. Add what you run every day; it unchecks itself at the daily reset.') : t('No weekly tasks yet. Add what you clear once a week; it unchecks itself at the weekly reset.');
  return `<section class="party-section task-panel"><div class="section-heading"><h2>${label} <span>${done.length} / ${list.length}</span></h2><span class="refresh-label">${t('Resets in')} <span data-reset="${cadence}">${remaining(at - now)}</span> · ${esc(when)}</span></div><div class="wish-panel"><div class="task-progress"><i style="width:${list.length ? done.length / list.length * 100 : 0}%"></i></div>${rows ? `<div class="task-list">${rows}</div>` : `<p class="wish-empty">${empty}</p>`}<form id="task-form-${cadence}" class="wish-form"><input name="title" maxlength="60" autocomplete="off" placeholder="${esc(cadence === 'daily' ? t('Add a daily task') : t('Add a weekly task'))}" aria-label="${esc(cadence === 'daily' ? t('Daily task') : t('Weekly task'))}" required><button class="button primary" type="submit">${icon('plus')} ${t('Add')}</button></form></div></section>`;
}
function tasksSignature() { const now = Date.now() + serverOffset; return canonical([tasks.map(task => [task.id, task.title, task.cadence, task.character || '', isDone(task, now, resets)]), resets, editingTask, taskCharacters.map(c => [c.id, c.characterName]), taskTemplates, taskScope()]); }
// The lists to switch between, each with what is left in it, the size of the shown one and the Global list.
function taskScopes(now) {
  const scope = taskScope(), shown = tasks.filter(task => inScope(task, scope)).length;
  const tabs = taskCharacters.length ? `<div class="task-scopes" role="group" aria-label="${esc(t('Lists'))}">${scopes(taskCharacters).map(s => { const n = left(tasks, now, resets, s.id); return `<button class="chip-toggle" data-task-scope="${esc(s.id)}" aria-pressed="${s.id === scope}">${esc(s.name)}${n ? ` <span class="scope-left">${esc(t('{n} left', { n }))}</span>` : ''}</button>`; }).join('')}</div>` : '';
  const global = taskTemplates.length ? `<button class="button secondary small" data-action="task-templates">${icon('plus')} ${t('Add from the Global list')}</button>` : '';
  return `<div class="task-toolbar">${tabs}<span class="task-size">${esc(t('{n} of {limit} tasks in this list', { n: shown, limit: taskLimit }))}</span>${global}</div>`;
}
function tasksView() {
  renderedTasks = tasksSignature(); const now = Date.now() + serverOffset;
  const local = new Date(nextReset('daily', now, resets)).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  keepingDrafts(() => shell(`<main class="dashboard tasks-page"><section class="heading"><div><h1>${t('Daily & weekly')}<span class="mint">.</span></h1><p>${esc(t('Your own checklist, saved to your account. Tasks uncheck themselves at the daily reset, {hour}:00 UTC ({local} your time), and at the weekly reset on {day}.', { hour: String(resetHour(resets)).padStart(2, '0'), local, day: t(dayName(resets)) }))}</p></div><span class="refresh-label"><i></i>${t('Private to you')}</span></section>${taskScopes(now)}<div class="task-grid">${taskPanel('daily', now)}${taskPanel('weekly', now)}</div></main>`, 'tasks'));
}
function updateResets() { const now = Date.now() + serverOffset; document.querySelectorAll('[data-reset]').forEach(el => { el.textContent = remaining(nextReset(el.dataset.reset, now, resets) - now); }); }
function renderTasks() { if (tasksSignature() === renderedTasks) { updateAges(); updateResets(); } else tasksView(); }
function applyTasks(data) {
  tasks = data.tasks || []; if (data.resets) resets = data.resets;
  if (Array.isArray(data.characters)) taskCharacters = data.characters;
  if (Array.isArray(data.templates)) taskTemplates = data.templates;
  if (data.limit) taskLimit = data.limit;
  tasksKnown = true; renderTaskBadge();
}
// The navigation says how many tasks are left in all lists, once the checklist was fetched.
const taskBadge = () => { const n = tasksKnown && !demo ? left(tasks, Date.now() + serverOffset, resets) : 0; return n ? `<span class="nav-badge" aria-hidden="true">${n}</span><span class="sr-only"> (${esc(t('{n} left', { n }))})</span>` : ''; };
function renderTaskBadge() {
  document.querySelectorAll('[data-action="tasks"]').forEach(el => { el.querySelectorAll('.nav-badge, .nav-badge + .sr-only').forEach(x => x.remove()); el.insertAdjacentHTML('beforeend', taskBadge()); });
}
// Fetched once a session, for the badge, without opening the page.
async function primeTasks() { try { applyTasks(await pb.send('/api/odyle/tasks', { requestKey: 'prime-tasks' })); } catch { /* the badge waits */ } }
async function refreshTasks() {
  const data = await pb.send('/api/odyle/tasks');
  if (shown !== '/tasks') return; // navigated elsewhere while loading
  applyTasks(data); if (data.serverNow) serverOffset = Date.parse(data.serverNow) - Date.now(); online = true;
}
function clearRoom() { room = null; members = []; wishlist = []; runs = []; dungeons = []; catalog = []; demo = false; }
// The armory (armory.js): public, signed in or not. The servers come from the backend once;
// the region and server last searched are kept per browser. A profile still waiting for
// PLAYNC asks again when the backend says to, while it stays on screen.
let armoryServers = null, armoryAnswer = null, armoryResults = null, armoryChosen = null, armoryTimer = 0;
const armoryKey = 'odyle.armory';
function armoryChoice() { try { return JSON.parse(storage.getItem(armoryKey)) || {}; } catch { return {}; } }
// Bookmarked characters (#72), in this browser only: no account needed, nothing sent anywhere.
const bookmarksKey = 'odyle.armory.bookmarks';
const bookmarks = () => readBookmarks(storage.getItem(bookmarksKey));
function keepBookmarks(list) {
  try { storage.setItem(bookmarksKey, JSON.stringify(list)); return true; }
  catch { toast(t('This browser does not let Odyle keep bookmarks.')); return false; }
}
function toggleBookmark() {
  if (!armoryAnswer?.profile) return;
  const list = bookmarks(), name = armoryAnswer.profile.name, on = isBookmarked(list, armoryAnswer);
  if (!on && list.length >= bookmarkLimit) return toast(t('You can keep up to {n} bookmarks. Remove one first.', { n: bookmarkLimit }));
  if (!keepBookmarks(on ? removeBookmark(list, `${armoryAnswer.region}/${armoryAnswer.serverId}/${armoryAnswer.characterId}`) : addBookmark(list, armoryAnswer, new Date().toISOString()))) return;
  armoryRender(); toast(on ? t('Removed {name} from your bookmarks.', { name }) : t('Bookmarked {name}. The armory page lists it.', { name }));
}
const armoryRefreshable = () => armoryAnswer?.state === 'fresh' && armoryAnswer.fetchedAt && Date.now() + serverOffset - timestamp(armoryAnswer.fetchedAt) > 15 * 60000;
function armoryRender(searching = false) {
  const chosen = armoryChosen || armoryChoice();
  const now = Date.now() + serverOffset, marks = bookmarks();
  shell(armoryAnswer ? armoryProfile(armoryAnswer, now, armoryRefreshable(), isBookmarked(marks, armoryAnswer)) : armorySearch(armoryServers || [], chosen, armoryResults, searching, marks, now), 'armory');
}
async function armoryPage(path, ticket, refresh = false) {
  clearTimeout(armoryTimer);
  if (!armoryServers) armoryServers = (await pb.send('/api/odyle/armory/servers')).regions;
  if (ticket !== navigation) return;
  const target = armoryTarget(path);
  if (target.profile) {
    const { region, serverId, characterId } = target.profile;
    let answer;
    try { answer = await pb.send(`/api/odyle/armory/${region}/${serverId}/${characterId}`, refresh ? { query: { refresh: 1 } } : {}); }
    catch (error) { if (ticket !== navigation) return; if (error?.status !== 404) throw error; armoryAnswer = armoryResults = null; armoryRender(); return toast(t(error.message)); }
    if (ticket !== navigation) return;
    online = true; armoryAnswer = answer;
    if (answer.profile && isBookmarked(bookmarks(), answer)) keepBookmarks(refreshBookmark(bookmarks(), answer));
    armoryRender();
    if (waiting(answer) || answer.state === 'failed') armoryTimer = setTimeout(() => { if (ticket === navigation) armoryPage(path, ticket).catch(failure); }, Math.max(2, answer.retryAfter || 5) * 1000);
    return;
  }
  armoryAnswer = armoryResults = null;
  if (!target.find) { armoryChosen = null; return armoryRender(); }
  const { region, server, name } = target.find;
  armoryChosen = target.find;
  try { storage.setItem(armoryKey, JSON.stringify({ region, server })); } catch { /* storage full or blocked */ }
  armoryRender(true);
  let results;
  try { results = (await pb.send('/api/odyle/armory/search', { query: { name, server, region } })).results; }
  catch (error) { if (ticket !== navigation) return; armoryRender(); throw error; }
  if (ticket !== navigation) return;
  online = true;
  // Exactly one character of that very name: its profile, in place of the search.
  const exact = results.filter(hit => hit.name.toLowerCase() === name.toLowerCase());
  if (exact.length === 1) return go(profilePath(exact[0]), true);
  armoryResults = results; armoryRender();
}
// The privacy notice (#/privacy, privacy.js), open to anyone.
const privacyRender = () => shell(privacyPage(privacyText), 'privacy');
// What's new (#/changelog): the bundled changelog and the newest Windows release's changes.
const changelog = parseChangelog(changelogText);
function changelogRender() {
  const app = windowsApp(windowsRelease);
  shell(whatsNew(changelog, __APP_VERSION__, app.version ? { ...app, changes: windowsRelease?.latest?.changes || [] } : null), 'changelog');
}
async function changelogPage(ticket) {
  seenVersion(); changelogRender();
  await loadWindowsRelease();
  if (ticket === navigation) changelogRender();
}
async function tasksPage(ticket) {
  await leaveRoomTopic(); clearRoom(); editingTask = '';
  await refreshTasks(); if (ticket !== navigation) return; tasksView();
}
// The account page redraws when its apps change or go online, late or offline; ages tick in place.
const contactState = at => { const quiet = Date.now() + serverOffset - timestamp(at); return quiet < 45000 ? 'online' : quiet < 90000 ? 'late' : 'offline'; };
const accountSignature = () => canonical([account?.account, account?.characters, account?.apps.map(a => [a.sessionId, a.character, a.device, contactState(a.lastContactAt)]), account?.devices?.map(d => [d.id, d.name])]);
function accountRender() { renderedAccount = accountSignature(); keepingDrafts(() => shell(accountView({ ...account, notifications: account.notifications || defaultNotifications, reminders: reminderState(), push: { state: pushHere, devices: account.push?.devices || [] }, now: Date.now() + serverOffset }), 'account')); }
async function refreshAccount() {
  const data = await pb.send('/api/odyle/account');
  if (shown !== '/account') return;
  account = data; serverOffset = Date.parse(data.serverNow) - Date.now(); online = true;
  await checkPush().catch(() => { pushHere = 'unsupported'; });
}
async function accountPage(ticket) {
  await leaveRoomTopic(); clearRoom();
  await refreshAccount(); if (ticket !== navigation) return; accountRender();
}
function dashboard() {
  rendered = signature();
  // Odyle cannot be pooled. Each player brings one character (their best fresh one),
  // and the party can only do as many cubes as its lowest player allows (readiness.js).
  // Saved values of characters not live are projected by the Odyle clock for the last known party.
  const now = Date.now() + serverOffset, party = flattened(), estimate = c => status(c, now) === 'live' ? c.value : clockOf(c, now, clockRules)?.total ?? c.value;
  // The numbers count at the cost of the room's next run (or one still under way) when the
  // catalog lists its dungeon (#12): what the party can do there.
  const next = runs.filter(r => timestamp(r.startsAt) > now - 3 * 3600000).sort((a, b) => timestamp(a.startsAt) - timestamp(b.startsAt))[0], listed = next && entryOf(catalog, next.dungeon);
  const focus = listed ? { dungeon: next.dungeon, cost: cubeCost(listed, room.cost) } : null, cost = focus?.cost || room.cost;
  const explained = explain(party, now, cost, estimate), { characters: actual, counted } = explained;
  const estimated = Boolean(explained.lastKnown && clockOf(explained.lastKnown.lowest, now, clockRules)?.projected);
  const shown = readyOrder(actual, now, cost).filter(c => !liveOnly() || status(c, now) === 'live');
  const hidden = actual.length - shown.length, actions = `${demo ? `<span class="demo-tag">${t('Sample data')}</span>` : ''}${manager() ? `<button class="button primary" data-action="invite">${icon('plus')} ${t('Invite')}</button>` : ''}<button class="button secondary" data-action="room-settings">${icon('gear')} ${owner() ? t('Settings') : t('Room')}</button>`;
  // Room changes redraw the whole page; keep half-typed wishlist and run entries and their focus.
  keepingDrafts(() => shell(`<main class="dashboard room-page"><section class="heading"><div><h1>${esc(room.name)}</h1><p>${esc(tn(members.length, '{n} member', '{n} members'))} · ${esc(tn(actual.length, '{n} character in this room', '{n} characters in this room'))} · ${esc(t('{cost} Odyle per cube', { cost: room.cost }))}${focus && focus.cost !== room.cost ? ' · ' + esc(t('next run {dungeon}: {cost} Odyle per cube', focus)) : ''}</p></div><div class="heading-actions">${actions}</div></section>${partySummary(explained, now, { estimated, focus })}<section class="party-section"><div class="section-heading"><h2>${t('Party characters')} <span>${actual.length}</span></h2><span class="section-tools"><button class="chip-toggle" data-action="live-only" aria-pressed="${liveOnly()}">${t('Live only')}</button></span></div>${demo ? '' : addBar()}<div class="member-grid party-list">${shown.length ? listHead() : ''}${shown.map((c, i) => card(c, i, counted, cost)).join('')}${liveOnly() && hidden ? `<p class="wish-note live-only-note">${esc(tn(hidden, '{n} character not live is hidden', '{n} characters not live are hidden'))}</p>` : ''}</div></section><div class="room-columns">${plannedRuns(now)}${wishlistSection(now)}</div></main>`));
}
// Column names over the character rows on wide screens.
const listHead = () => `<div class="party-head" aria-hidden="true"><span>${t('Character')}</span><span>${t('Status')}</span><span>${t('Odyle')}</span><span>${t('Regeneration')}</span><span>${t('Cubes')}</span><span></span></div>`;
// Only live characters on the room page, a choice of this browser.
const liveOnlyKey = 'odyle.liveOnly', liveOnly = () => storage.getItem(liveOnlyKey) === 'on';
function card(c, index, counted = null, cost = room?.cost || perCube) {
  const now = Date.now() + serverOffset, { state, known, cubes, ready } = readinessOf(c, now, cost), fresh = state === 'live';
  // The Windows app read the character without its Odyle record, which comes at level 22 (odyle-windows#6).
  const locked = c.odyleLocked && !known;
  const labels = { live: t('Live'), stale: t('Stale'), unknown: t('No reading'), offline: t('Offline') }, self = c.user === pb.authStore.record?.id && !demo;
  const history = c.id && c.characterName && (known || !demo) ? `<button data-history="${esc(c.id)}" data-name="${esc(c.characterName)}" class="icon-only" title="${esc(t('Odyle history of {name}', { name: c.characterName }))}">${icon('chart')}<span class="sr-only">${t('History')}</span></button>` : '';
  const action = self && room && c.id ? `<button class="remove" data-share="${esc(c.id)}" data-enabled="false" data-name="${esc(c.characterName)}" ${c.role === 'viewer' ? 'disabled' : ''} title="${esc(t('Hide {name} from this room. Its saved values stay on your account.', { name: c.characterName }))}">${t('Hide')}</button>`
    : self && !room ? `<button data-character="${esc(c.id || '')}" data-action="reading">${t('Reader')}</button>${c.id ? `<button class="remove" data-delete-character="${esc(c.id)}" data-name="${esc(c.characterName)}" title="${esc(t('Delete {name} from your account', { name: c.characterName }))}">${t('Delete')}</button>` : ''}`
      : owner() && c.membershipId && c.role !== 'owner' && !demo ? `<button class="remove" data-remove="${esc(c.membershipId)}" data-name="${esc(c.displayName)}" title="${esc(t('Remove {name} from this room', { name: c.displayName }))}">${t('Remove')}</button>` : '';
  // The profile itself once the daily lookup found the character on PLAYNC, else a search by name.
  const armoryPath = officialPath(c) || (c.characterName && /^[A-Za-z]{2,20}$/.test(c.server || '') && /^GLOBAL_(NAW?|EU|SA|ASIA)$/.test(c.region || '') ? findPath(c.region, c.server, c.characterName) : '');
  const armory = !demo && armoryPath ? `<a class="card-link icon-only" href="#${esc(armoryPath)}" title="${esc(t('Gear and stats of {name} on PLAYNC', { name: c.characterName }))}">${icon('search')}<span class="sr-only">${t('Armory')}</span></a>` : '';
  // A packet reading needs no label; samples, old manual values and characters waiting for the game say so.
  const source = demo ? t('Sample') : c.source === 'packet' ? '' : c.source === 'manual' ? t('Legacy manual') : t('Waiting for game');
  const player = room && c.displayName && c.displayName !== c.characterName ? c.displayName : '', where = [c.server, regionLabel(c.region)].filter(Boolean).join(' ');
  const meta = [player, classOf(c), where].filter(Boolean).map(esc).join(' · '), clock = known && clockOf(c, now, clockRules);
  const leader = c.role === 'owner' && room ? `<span class="leader-label" title="${esc(t('Room leader'))}">${icon('crown')}<span class="sr-only">${t('leader')}</span></span>` : '';
  const counts = counted?.has(c.id) ? `<span class="counts-for" title="${esc(t('Counts for {name}', { name: c.displayName }))}">${icon('diamond')}${t('counts')}</span>` : '';
  const changed = `${source ? `${source} · ` : ''}${known ? `${t('changed')} <span data-age="${esc(c.lastReadingAt)}">${age(c.lastReadingAt, now)}</span>` : t('Not confirmed')}`;
  return `<article class="member-card ${ready ? 'is-ready' : ''} ${state === 'offline' ? 'is-offline' : ''}"><div class="row-id">${portrait(c, index)}<div class="card-id"><div class="member-name"><span class="name-text">${esc(c.characterName || c.displayName)}</span>${leader}</div><div class="member-meta"${classOf(c) ? ` title="${esc(t('Class and level from PLAYNC, checked daily'))}"` : ''}>${meta}</div></div></div>`
    + `<div class="row-state"><span class="status ${state}"><i></i>${labels[state]}</span>${c.characterName && !fresh ? `<span class="status-why">${esc(statusReason(c, now))}</span>` : ''}</div>`
    + `<div class="row-energy"><div class="energy"><strong>${known ? c.value.toLocaleString(locale()) : '—'}</strong><span>${t('Odyle')}</span></div><div class="energy-track"><i style="width:${known ? Math.min(100, c.value / (cost * 8) * 100) : 0}%"></i></div>${known && c.parts ? `<div class="energy-split">${esc(t('natural {base} · items {bonus}', { base: c.parts.base.toLocaleString(locale()), bonus: c.parts.bonus.toLocaleString(locale()) }))}</div>` : ''}<div class="row-changed">${locked ? t('No Odyle yet · it unlocks at level 22') : changed}</div></div>`
    + `<div class="row-clock">${clock ? `<div class="energy-clock">${esc(clockLine(clock, now, fresh))}</div>` : ''}${self && capMismatch(c) ? `<div class="energy-clock cap-mismatch">${esc(t('Its natural pool held {max}, more than {cap}: has the membership started? Account & data → Membership.', { max: c.naturalMax.toLocaleString(locale()), cap: c.answeredCap.toLocaleString(locale()) }))}</div>` : ''}</div>`
    + `<div class="row-cubes cube-line">${known ? `<span><strong>${cubes}</strong> ${esc(tn(cubes, 'cube', 'cubes'))}</span>` : `<span>${locked ? t('No Odyle yet') : t('No confirmed reading')}</span>`}<span class="readiness ${ready ? 'ready' : ''}">${ready ? t('Ready') : fresh ? t('Low energy') : known ? t('last saved') : ''}</span>${counts}</div>`
    + `<div class="card-actions">${armory}${history}${action}</div></article>`;
}
let toastTimer;
function toast(message) { const el = document.querySelector('#toast'); if (!el) return; el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 6000); }
// A failed form also says why inside the form, next to what has to change, for screen
// readers (role=alert) and for anyone who missed the toast.
function formError(form, message) { form.querySelector('.form-error')?.remove(); form.insertAdjacentHTML('beforeend', `<p class="form-error" role="alert">${esc(message)}</p>`); }
// Backend and SDK errors arrive in English; t() shows them in the page's language.
const failed = error => toast(t(error?.message || 'Request could not be completed.'));
function modal(title, body, wide = false) { const el = document.querySelector('#modal'); el.className = wide ? 'wide' : ''; el.innerHTML = `<div class="modal-head"><h2 id="modal-title">${title}</h2><button data-action="close-dialog" class="close-button" aria-label="${esc(t('Close dialog'))}">×</button></div>${body}`; if (!el.open) el.showModal(); }
const closeModal = () => document.querySelector('#modal')?.close();
const signInPrompt = text => modal(t('Sign in to continue'), `<p>${text}</p><button class="button discord-button" data-action="exit-demo">${t('Sign in with Discord')}</button>`);
// Asks before a change; Keep it closes the dialog, or goes back to the one named.
function ask(title, text, button, data, back = 'close-dialog') { modal(title, `<p>${text}</p><button class="button danger" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}>${button}</button><button class="button secondary" data-action="${back}">${t('Keep it')}</button>`); }
// The owner's invite dialog: the room's open links as the server lists them (or as an
// answer just carried them), each with its link where this browser made it, and the form
// for a new one (invites.js). Anyone else is told who can invite (invitePicker). Each
// listing drawn counts, so a slower one asked for before a link was made or revoked
// does not draw over that change.
let inviteDraws = 0;
async function inviteDialog(listed) {
  if (demo) return signInPrompt(t('This workspace uses sample data. Sign in with Discord to create a persistent room.'));
  if (!pb.authStore.isValid) return signInPrompt(t('Sign in with Discord to create a room and invite your friends.'));
  if (!room || !manager()) return invitePicker();
  const id = room.id, now = Date.now() + serverOffset, draw = ++inviteDraws, askedAt = Date.now();
  modal(t('Invite another Discord account'), inviteDialogBody(listed ? withCodes(storage, id, listed, now) : null, location.href, now));
  if (listed) return;
  const answer = (await pb.send('/api/odyle/invites/' + id)).invites;
  if (draw === inviteDraws) drawInvites(id, answer, askedAt);
}
function drawInvites(id, listed, since) {
  const slot = document.querySelector('#modal[open] .invite-list'), now = Date.now() + serverOffset; inviteDraws++;
  if (slot && room?.id === id) slot.innerHTML = inviteList(withCodes(storage, id, listed, now, since), location.href, now);
}
// Invitations outside a room you lead: the rooms you lead to choose from (the only one
// opens at once), or who can invite instead of a dead end.
async function invitePicker() {
  if (room) {
    const leader = members.find(m => m.role === 'owner')?.displayName;
    return modal(t('Invite friends'), `<p>${esc(leader ? t('Only the leader of {room}, {name}, can invite to it. Ask them for an invite link.', { room: room.name, name: leader }) : t('Only the room’s leader can invite to it. Ask them for an invite link.'))}</p><button class="button secondary" data-action="close-dialog">${t('Got it')}</button>`);
  }
  const listed = (await pb.send('/api/odyle/rooms')).rooms || [], led = listed.filter(r => r.role === 'owner' || r.role === 'officer');
  if (led.length === 1) return openInvites(led[0].id);
  if (!led.length) return modal(t('Invite friends'), `<p>${listed.length ? t('Only a room’s leader can invite to it. Ask the leader of your room for an invite link, or create a room of your own.') : t('Create a room first, then invite your friends to it.')}</p><button class="button primary" data-action="library">${t('My rooms & characters')} ${icon('arrow')}</button>`);
  modal(t('Invite to which room?'), `<p>${t('Choose a room you lead. Friends you invite join only that room.')}</p><div class="room-list room-picker">${led.map(r => `<button class="room-item" data-invite-room="${esc(r.id)}"><span class="setup-icon">${icon('diamond')}</span><span><strong>${esc(r.name)}</strong><small>${esc(roleName(r.role))}</small></span>${icon('arrow')}</button>`).join('')}</div>`);
}
async function openInvites(id) { closeModal(); await go('/room/' + id); if (room?.id === id) await inviteDialog(); }
// Owners rename the room, change roles, hand it over, remove members and close it;
// other members can leave. Every change asks the server and redraws this dialog.
function roomSettings() {
  if (demo) return signInPrompt(t('This workspace uses sample data. Sign in with Discord to manage your own rooms.'));
  // One section per subject; the one that cannot be undone comes last.
  const section = (title, body, cls = '') => `<section class="modal-section ${cls}">${title ? `<h3 class="modal-sub">${title}</h3>` : ''}${body}</section>`;
  // New characters this member saves can reach this room by themselves.
  const newOnes = section(t('Your new characters'), `<p>${t('Characters you save from now on start private. With this on, they are shared in this room by themselves.')}</p><div class="share-rooms">${shareNewChip(room.id, room.name, me()?.shareNew, me()?.role === 'viewer', t('Share them in this room'))}</div>`);
  // Officers keep the Discord reminders too.
  const discordPart = me()?.role === 'officer' ? section('', discordSettings()) : room.discordReminders ? section(t('Discord reminders'), `<p>${t('The room owner posts planned runs to a Discord channel 15 minutes before they start.')}</p>`) : '';
  if (!owner()) return modal(esc(room.name), newOnes + discordPart + section(t('Leave this room'), `<p>${esc(t('You are a {role} in this room. Leaving removes your access, your wishlist entries and your place on planned runs; your characters stay on your account.', { role: roleName(me()?.role) }))}</p><button class="button danger" data-action="leave-room">${t('Leave this room')}</button>`, 'danger-zone'), true);
  const myId = pb.authStore.record?.id, listed = [...members].sort((a, b) => (b.user === myId) - (a.user === myId));
  const rows = listed.map(m => m.user === myId ? `<div class="member-row"><div><strong>${esc(m.displayName)}</strong><small>${t('Leader (you)')}</small></div></div>`
    : `<div class="member-row"><div><strong>${esc(m.displayName)}</strong></div><select data-role="${esc(m.id)}" aria-label="${esc(t('Role of {name}', { name: m.displayName }))}"><option value="reporter" ${m.role === 'reporter' ? 'selected' : ''}>${t('Player')}</option><option value="officer" ${m.role === 'officer' ? 'selected' : ''}>${t('Officer')}</option><option value="viewer" ${m.role === 'viewer' ? 'selected' : ''}>${t('Viewer')}</option></select><button data-transfer="${esc(m.id)}" data-name="${esc(m.displayName)}">${t('Make leader')}</button><button class="remove" data-remove="${esc(m.id)}" data-name="${esc(m.displayName)}">${t('Remove')}</button></div>`).join('');
  modal(t('Room settings'), section(t('Room name'), `<form id="rename-form" class="rename-form"><label><span class="sr-only">${t('Room name')}</span><input name="name" maxlength="60" required value="${esc(room.name)}"></label><button class="button secondary" type="submit">${t('Rename')}</button></form>`)
    + section(`${t('Members')} <span class="modal-count">${members.length}</span>`, `<p>${t('Players share characters and plan runs; officers also invite, change any run and keep the Discord reminders; viewers only watch. A member made viewer stops sharing here.')}</p><div class="member-rows">${rows}</div>`)
    + section('', discordSettings()) + newOnes
    + section(t('Close this room'), `<p>${t('This deletes the room with its wishlist and planned runs for every member. Characters stay on their accounts. It cannot be undone.')}</p><button class="button danger" data-action="close-room">${t('Close this room')}</button>`, 'danger-zone'), true);
}
// The owner connects a Discord channel and chooses when runs are posted there (discord.js).
const discordSettings = () => discordView(room, Date.now() + serverOffset, remindersPaused);
// Demo characters get a made-up history so the chart can be tried without signing in.
function demoHistory(id) {
  const c = members.flatMap(m => m.characters || []).find(x => x.id === id), now = Date.now(), readings = [];
  let value = Math.max(0, (c?.value || 100) - 90);
  for (let i = 12; i >= 0; i--) { readings.push({ value, at: new Date(now - i * 5 * 3600000 - 600000).toISOString() }); value = i ? Math.max(0, value + [15, 20, -40, 10, 25, 5][i % 6]) : c?.value || value; }
  readings[readings.length - 1].value = c?.value || value;
  return { readings };
}
// The history in the dialog, for Show all.
let shownHistory = null;
async function historyDialog(id, name) {
  const data = demo ? demoHistory(id) : await pb.send('/api/odyle/history/' + id);
  if (!demo && data.serverNow) serverOffset = Date.parse(data.serverNow) - Date.now();
  const now = Date.now() + serverOffset, cost = room?.cost || perCube;
  modal(esc(t('{name} · Odyle history', { name })), `<p>${data.hourlyBefore ? t('The last 30 days: the newest 1,000 changes, and before them the last change of each hour. A value holds until the next change; the line marks one cube.') : t('Every change in the last 30 days. A value holds until the next change; the line marks one cube.')}</p>${historyChart(data.readings, { now, cost })}${data.readings.length ? `<div class="history-rows">${historyList(data.readings, 12, data.hourlyBefore)}</div>` : ''}`, true);
  shownHistory = data;
  bindHistoryChart(document.querySelector('#modal .history-chart'));
}
// The pairing dialog (Pair Windows app, Connect reader; pairing.js). It shows this
// browser's unused connection link again, or asks for one, with a countdown to its
// expiry; an account whose reader is online sees that reader first. While it is open, the
// account's news (or, without realtime, a look every ten seconds) tells it when the PC
// paired and what it reads. When pairing is paused, it says so and keeps the downloads.
let pairing = null, pairingTimer = 0;
async function desktopDialog(another = false) {
  if (!pb.authStore.isValid || demo) return toast(t('Sign in with Discord to connect your reader.'));
  const [data] = await Promise.all([pairingAccount(), loadWindowsRelease()]), now = Date.now() + serverOffset;
  const p = pairing = { user: pb.authStore.record.id, step: 'loading', account: data, checkedAt: Date.now() };
  const saved = savedPairing(storage, p.user, now), paired = saved && pairedWith(data?.devices, saved), online = onlineReader(readerList(data), now);
  // A link used since this browser asked for it: the PC it paired.
  if (paired) { forgetPairing(storage); Object.assign(p, { step: 'paired', device: paired.id }); }
  else if (online && !another) Object.assign(p, { step: 'online', reader: online });
  const view = pairingView(p);
  modal(t('Connect your packet reader'), `<div class="pairing-slot" data-shown="${esc(pairingShown(view))}">${pairingSlot(view)}</div>${downloadPanel()}<div class="info-panel"><h3>${t('How it works')}</h3><p>${t('Start the reader before you log into your character. It detects the character, reads the Odyle snapshot from the game and sends the value again only when it changes. Nothing is injected and no raw traffic leaves your PC.')}</p></div>${scopeNote()}`);
  clearInterval(pairingTimer); pairingTimer = setInterval(pairingTick, 1000);
  if (p.step === 'loading') await openLink(p);
}
// The account's PCs and readers; null when the server cannot tell now.
async function pairingAccount() {
  try { const data = await pb.send('/api/odyle/account'); serverOffset = Date.parse(data.serverNow) - Date.now(); readers = readerList(data); return data; }
  catch (error) { if (error?.status === 401) throw error; return null; }
}
// This browser's link while it is unused, else a new one.
async function openLink(p) {
  const saved = savedPairing(storage, p.user, Date.now() + serverOffset);
  if (saved && !pairedWith(p.account?.devices, saved)) { showLink(p, saved); return renderPairing(); }
  forgetPairing(storage); Object.assign(p, { step: 'loading' }); renderPairing();
  try { const pair = await send('desktop-code'); if (pairing !== p) return; rememberPairing(storage, p.user, pair); showLink(p, pair); }
  catch (error) { if (error?.status === 401) { stopPairing(); return expired(); } if (pairing !== p) return; Object.assign(p, { step: 'refused', problem: error?.message || 'Request could not be completed.' }); }
  renderPairing();
}
function showLink(p, pair) {
  try { Object.assign(p, { step: 'link', pair, link: connectionLink(backend, pair.code) }); }
  catch (error) { Object.assign(p, { step: 'refused', problem: error.message }); }
}
const pairingReading = p => p.account?.apps?.find(a => a.device === p.device && a.character)?.character || '';
function pairingView(p) {
  if (p.step === 'link') return { step: 'link', link: p.link, left: timestamp(p.pair.expiresAt) - Date.now() - serverOffset };
  if (p.step === 'refused') return { step: 'refused', problem: p.problem, paused: p.problem === 'Pairing new PCs is paused for now. Try again later.' };
  if (p.step === 'paired') return { step: 'paired', pc: p.account?.devices?.find(d => d.id === p.device)?.name || '', character: pairingReading(p) };
  if (p.step === 'online') return { step: 'online', pc: p.reader.name, character: p.reader.character };
  return { step: p.step };
}
// What the slot shows, without the countdown that pairingTick keeps current in place.
const pairingShown = v => JSON.stringify({ ...v, left: undefined });
// A check that finds nothing new (`changed` only) leaves the slot alone, so focus, a
// selected link and a screen reader's last announcement stay.
function renderPairing(changed = false) {
  const el = document.querySelector('#modal[open] .pairing-slot'); if (!el || !pairing) return;
  const view = pairingView(pairing), shown = pairingShown(view);
  if (changed && el.dataset.shown === shown) return;
  el.dataset.shown = shown; el.innerHTML = pairingSlot(view);
}
function stopPairing() { clearInterval(pairingTimer); pairingTimer = 0; pairing = null; }
// Waiting for the PC to pair, or for its first character.
const pairingWaits = p => p.step === 'link' || p.step === 'expired' || (p.step === 'paired' && !pairingReading(p));
function pairingTick() {
  if (!pairing || !document.querySelector('#modal[open] .pairing-slot')) return stopPairing();
  if (pairing.step === 'link') {
    const left = timestamp(pairing.pair.expiresAt) - Date.now() - serverOffset, el = document.querySelector('#modal [data-pair-expires]');
    if (left <= 0) { forgetPairing(storage); pairing.step = 'expired'; renderPairing(); } else if (el) el.textContent = countdown(left);
  }
  if (!live && !document.hidden && pairingWaits(pairing) && Date.now() - pairing.checkedAt >= 10000) checkPairing();
}
// Asks the account page's data whether the link paired a PC and what that PC reads; news
// arriving meanwhile asks once more afterwards.
async function checkPairing() {
  const p = pairing; if (!p || !pairingWaits(p)) return;
  if (p.checking) { p.again = true; return; }
  p.checking = true;
  try {
    do {
      p.again = false; p.checkedAt = Date.now();
      const data = await pairingAccount(); if (pairing !== p) return; if (!data) continue;
      p.account = data;
      const paired = p.step !== 'paired' && p.pair && pairedWith(data.devices, p.pair);
      if (paired) { forgetPairing(storage); Object.assign(p, { step: 'paired', device: paired.id }); }
      renderPairing(true);
    } while (p.again);
  } catch (error) { if (error?.status === 401) { stopPairing(); expired(); } }
  finally { p.checking = false; }
}
async function send(action, body = {}) {
  const data = await pb.send('/api/odyle/' + action, { method: 'POST', body });
  if (data.serverNow) serverOffset = Date.parse(data.serverNow) - Date.now(); return data;
}
// One snapshot request at a time: news arriving while one loads, or a change this page
// drew from its own answer meanwhile (changedRoom), loads it once more afterwards, so an
// older answer never replaces newer state.
let roomLoad = null, roomAgain = false, roomEdits = 0;
function refreshRoom() {
  roomAgain = true;
  if (!roomLoad) roomLoad = loadRooms().finally(() => { roomLoad = null; });
  return roomLoad;
}
async function loadRooms() { while (roomAgain && room) { roomAgain = false; await loadRoom(); } }
async function loadRoom() {
  const id = room.id, edits = roomEdits;
  let snapshot;
  try { snapshot = await pb.send('/api/odyle/snapshot/' + id); }
  catch (error) { if (room?.id === id) throw error; return; } // a room left meanwhile is no news
  if (room?.id !== id) return; // navigated elsewhere while loading
  if (edits !== roomEdits) { roomAgain = true; return; } // older than a change drawn meanwhile
  room = snapshot.room; remindersPaused = Boolean(snapshot.remindersPaused); maintenance = snapshot.maintenance || null; perCube = room.cost; clockRules = snapshot.clock || clockRules; members = snapshot.members; wishlist = snapshot.wishlist || []; runs = snapshot.runs || []; dungeons = snapshot.dungeons || []; catalog = snapshot.catalog || dungeons.map(name => ({ name, cost: 0 })); readers = snapshot.readers || readers; serverOffset = Date.parse(snapshot.serverNow) - Date.now(); online = true;
  characters = me()?.characters || characters; announced(snapshot);
  if (!document.querySelector('#modal')?.open) renderDashboard();
}
// A change this page made in the room: the route's answer carries the new state, which
// is drawn at once instead of fetching the snapshot again (realtime still tells the
// room's members, this tab too, which then fetches it once). An answer for a room no
// longer open (the page moved on while it was on its way) is not applied: false.
function changedRoom(id, update) {
  if (!room || room.id !== id) return false;
  roomEdits++; update(); characters = me()?.characters || characters;
  if (!document.querySelector('#modal')?.open) renderDashboard();
  return true;
}
// News that needs a fetch waits in a hidden tab, which fetches once when it is shown again (tick).
function later() { if (!document.hidden) return false; lastPulse = 0; return true; }
async function leaveRoomTopic() { const stops = roomTopics; roomTopics = []; for (const stop of stops) await stop().catch(() => { /* already gone */ }); }
async function library(ticket) {
  await leaveRoomTopic(); clearRoom();
  const [list, mine, ahead] = await Promise.all([pb.send('/api/odyle/rooms'), pb.collection('characters').getFullList({ sort: 'created' }), pb.send('/api/odyle/upcoming?days=14', { requestKey: 'next-runs' }).catch(() => null), loadWindowsRelease()]);
  if (ticket !== navigation) return;
  nextRunsList = ahead?.runs || [];
  rooms = list.rooms; perCube = list.odylePerCube || perCube; clockRules = list.clock || clockRules; notificationsSeen = list.notifications || notificationsSeen; notificationsSeen = list.notifications || notificationsSeen; characters = mine; readers = list.readers || []; online = true; if (list.serverNow) serverOffset = Date.parse(list.serverNow) - Date.now(); announced(list); libraryView(); renderedLibrary = librarySignature();
}
async function openRoom(id, ticket) {
  await leaveRoomTopic();
  clearRoom(); room = { id }; rendered = ''; await refreshRoom();
  if (ticket !== navigation) return;
  if (!rooms.some(r => r.id === id)) loadRoomList().catch(() => { /* the switch keeps the rooms it knows */ });
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
  if (later()) return;
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
const startedReaders = new Set();
async function watchOwnTopic() {
  const id = pb.authStore.record?.id;
  if (!id || ownTopicUser === id) return;
  await unwatchOwnTopic(); ownTopicUser = id;
  try {
    connects = pb.realtime.isConnected ? 1 : 0;
    connectTopic = await pb.realtime.subscribe('PB_CONNECT', () => {
      clearTimeout(disconnected); live = true;
      if (connects++ > 0 && !later()) refreshPage().then(renderPage, () => { online = false; renderConnection(); });
    });
    ownTopic = await pb.realtime.subscribe('odyle.user.' + id, data => ownNews(data));
    // The task badge; the checklist page loads the tasks itself.
    if (shown !== '/tasks') primeTasks();
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
    // News for everyone: a changed announcement shows at once, and a new Windows release
    // refreshes the download links and says so.
    announced(data);
    if (data.release?.version) { windowsReleaseAt = 0; await loadWindowsRelease(); toast(t('Odyle for Windows {version} is out. Running apps update themselves.', { version: data.release.version })); }
    // The open room hears of its own changes on its topic.
    // On My rooms & characters, a character saved meanwhile (by the reader) is offered to the rooms
    // that do not show it yet, after fetching again: rooms that share new characters have it now.
    const known = new Set(characters.map(c => c.id)), offer = async () => { if (library && known.size + rooms.length) for (const c of characters.filter(c => !known.has(c.id) && c.characterName)) await newCharacterPrompt(c); };
    if (data.refresh) { if (shown !== '/tasks') primeTasks(); if (!room && !later()) { await refreshPage(); await offer(); } }
    else if (Array.isArray(data.characters) && !applyCharacters(characters, data.characters) && library && !later()) { await refreshPage(); await offer(); }
    if (data.seen) applySeen(data.seen, characters);
    // Cap alerts of the account's characters (the job checked the quiet hours).
    if (Array.isArray(data.capAlerts)) await showCapAlerts(data.capAlerts);
    if (Array.isArray(data.partyReady)) await showPartyReady(data.partyReady);
    // Notification settings saved in another tab or app.
    if (data.notifications) { upcomingAt = 0; notificationsSeen = data.notifications; if (account) { account.notifications = data.notifications; if (shown === '/account' && !later()) accountRender(); } }
    if (data.contact) {
      applyContact(data.contact, account?.apps); applyContact(data.contact, readers);
      // A reader started since the room was fetched: the snapshot names its PC (other pages hear of it as news).
      const started = Object.keys(data.contact).filter(id => !readers.some(r => r.sessionId === id) && !startedReaders.has(id));
      if (room && started.length && !later()) { started.forEach(id => startedReaders.add(id)); await refreshRoom(); }
    }
    // An open pairing dialog looks whether its PC paired or reads now; a hidden tab looks once it is shown.
    if (pairing && (data.refresh || data.characters)) { if (document.hidden) pairing.missed = true; else checkPairing(); }
    renderPage();
  } catch (error) { if (error?.status === 401) return expired(); online = false; renderConnection(); }
}
// The current page's data, fetched again.
async function refreshPage() {
  if (room) await refreshRoom();
  else if (shown === '/tasks') await refreshTasks();
  else if (shown === '/account') await refreshAccount();
  else if (shown?.startsWith('/armory') || shown === '/changelog' || shown === '/privacy') await pb.health.check(); // nothing of the account to fetch
  else {
    const [list, mine] = await Promise.all([pb.send('/api/odyle/rooms'), pb.collection('characters').getFullList({ sort: 'created' })]);
    if (!room) { rooms = list.rooms; roomsKnown = true; characters = mine; readers = list.readers || []; perCube = list.odylePerCube || perCube; clockRules = list.clock || clockRules; notificationsSeen = list.notifications || notificationsSeen; if (list.serverNow) serverOffset = Date.parse(list.serverNow) - Date.now(); announced(list); }
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
  renderReaderStatus();
}
// Redraws the current page, for example after the language changed.
function rerender() {
  if (demo) return demoSession();
  if (shown?.startsWith('/armory')) return armoryRender();
  if (shown === '/changelog') return changelogRender();
  if (shown === '/privacy') return privacyRender();
  if (room) return dashboard();
  if (shown === '/tasks') return tasksView();
  if (shown === '/account' && account) return accountRender();
  if (pb.authStore.isValid) return libraryView();
  welcome(joinCode(shown || ''));
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
function currentPath() { const armory = location.hash.slice(1); if (armoryRoute.test(armory)) return armory; const match = location.hash.match(/^#(\/(?:room\/[A-Za-z0-9]{1,40}|join\/[A-Za-z0-9-]{4,24}|demo|tasks|account|changelog|privacy)?)$/); return match ? match[1] : '/'; }
async function show(force = false) {
  const path = currentPath();
  if (path === shown && !force) return;
  shown = path; const ticket = ++navigation;
  if (path === '/demo') { await leaveRoomTopic(); return demoSession(); }
  if (path.startsWith('/armory')) { await leaveRoomTopic(); clearRoom(); return armoryPage(path, ticket); }
  if (path === '/changelog') { clearTimeout(armoryTimer); await leaveRoomTopic(); clearRoom(); return changelogPage(ticket); }
  if (path === '/privacy') { clearTimeout(armoryTimer); await leaveRoomTopic(); clearRoom(); return privacyRender(); }
  clearTimeout(armoryTimer);
  const code = joinCode(path);
  if (!pb.authStore.isValid) { await leaveRoomTopic(); clearRoom(); return welcome(code); }
  if (code) {
    // An invite link: join, then open the room in place of the link and say as what. A
    // link that does not join stays, with what it opens and why (inviteTrouble).
    let result;
    try { result = await send('join', { code }); }
    catch (error) { if (ticket !== navigation) return; if (error?.status === 401) throw error; return await inviteTrouble(code, error, ticket); }
    if (ticket !== navigation) return;
    await go('/room/' + result.room.id, true); return toast(joinedMessage(result));
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
// returns to the sign-in page once the server no longer accepts it. A refusal of a request
// sent with a token this browser has since replaced (Sign out everywhere: the account's news
// can come before the answer with the new token) is no such thing, so the token on hand is
// asked first; only its refusal signs out, and an unreachable server keeps the sign-in.
const renewEvery = 6 * 3600000;
async function expired() {
  try { await pb.collection('users').authRefresh(); renewedAt = Date.now(); return; }
  catch (error) { if (![401, 403].includes(error?.status)) return; }
  await logout(); toast(t('Your sign-in expired. Sign in again with Discord.'));
}
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
  timer = setInterval(tick, 5000);
  await show(true).catch(failure);
  if (!roomsKnown) loadRoomList().catch(() => { /* the switch lists the rooms with the next library visit */ });
  // Rooms and snapshots carry the announcement; other pages fetch it.
  loadAnnouncement().catch(() => { /* the next minute tries again */ });
}
// Realtime pushes changes and heartbeats (openRoom, watchOwnTopic), so a page fetches its
// data again only every five minutes, in case something was missed, and every 15 seconds
// while realtime is down. A health check every 15 seconds keeps the connection label
// right while realtime is down or a request failed (a connected realtime stream shows
// the server answers), and the 5-second tick redraws ages and live/stale states. A hidden
// tab only renews its sign-in and keeps run reminders; news it cannot apply in place
// waits (later), and the tab catches up as soon as it is shown.
async function tick() {
  if (!document.hidden) loadAnnouncement().catch(() => { /* the next minute tries again */ });
  if (busy || demo) return;
  remindRuns().catch(() => { /* the next tick tries again */ });
  try {
    if (Date.now() - renewedAt >= renewEvery) { renewedAt = Date.now(); await pb.collection('users').authRefresh(); }
    if (document.hidden) return;
    if (Date.now() - lastPulse >= (live ? 300000 : 15000)) { lastPulse = lastCheck = Date.now(); await refreshPage(); }
    else if ((!live || !online) && Date.now() - lastCheck >= 15000) {
      lastCheck = Date.now(); const back = !online;
      await pb.health.check(); online = true;
      // Back after an outage: whatever happened meanwhile.
      if (back) { lastPulse = Date.now(); await refreshPage(); }
    }
    renderPage();
  } catch (error) { if (error?.status === 401) return expired(); online = false; }
  finally { renderConnection(); }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (timer) tick();
  if (pairing?.missed) { pairing.missed = false; checkPairing(); }
});
function unreachable() {
  clearInterval(timer); timer = 0; online = false;
  shell(`<main class="welcome"><div class="eyebrow"><span class="tiny-diamond"></span> ${t('STILL SIGNED IN')}</div><h1>${t('The Odyle server is out of reach')}<span class="mint">.</span></h1><p class="intro">${t('Your sign-in is kept. The dashboard tries again every ten seconds and opens your page as soon as the server answers.')}</p><button class="button secondary" data-action="retry">${t('Try again now')} ${icon('arrow')}</button></main>`);
  retryTimer = setTimeout(() => authenticated().catch(failure), 10000);
}
// The Discord window opens within the click, before anything is awaited, as browsers
// block windows opened later (the SDK opens its own the same way); null when blocked.
function signInWindow() {
  const width = Math.min(1024, window.innerWidth), height = Math.min(768, window.innerHeight);
  try { return window.open('', 'popup_window', `width=${width},height=${height},top=${(window.innerHeight - height) / 2},left=${(window.innerWidth - width) / 2},resizable,menubar=no`); } catch { return null; }
}
// This page's link to open in another browser when the Discord window cannot work here
// (why: 'blocked', 'interrupted', 'app' or nothing). An invite link keeps its code.
function signInElsewhere(why = '') {
  const link = signInLink(location.href), joining = Boolean(joinCode(currentPath()));
  const reason = { blocked: t('The Discord sign-in window could not open here.'), interrupted: t('The sign-in was interrupted before Discord answered.'), app: t('Discord sign-in often fails in browsers built into other apps.') }[why];
  modal(t('Open Odyle in your browser'), `<p>${reason ? reason + ' ' : ''}${t('Open this link in Safari, Chrome or another browser and sign in there.')}${joining ? ' ' + t('The link keeps your invite: you join the room right after signing in.') : ''}</p><div class="link-copy"><input class="link-field" readonly value="${esc(link)}" aria-label="${esc(t('Link to this page'))}"><button class="button primary" data-copy="${esc(link)}" data-copied="${esc(t('Link copied.'))}">${icon('copy')} ${t('Copy link')}</button></div><p class="signin-tip">${t('In an app, its ⋯ or ⋮ menu or the share button usually has Open in browser.')}${why === 'blocked' ? ' ' + t('On a computer, allow pop-ups for this site and try again.') : ''}</p>`);
}
async function discordLogin() {
  const popup = signInWindow();
  if (!popup) return signInElsewhere('blocked');
  document.querySelector('.signin-help')?.removeAttribute('hidden');
  let auth;
  try { auth = await pb.collection('users').authWithOAuth2({ provider: 'discord', createData: { displayName: 'Adventurer' }, urlCallback: url => { popup.location.href = url; } }); }
  catch (error) {
    popup.close();
    const methods = await pb.collection('users').listAuthMethods();
    if (!methods.oauth2?.providers?.some(p => p.name === 'discord')) return toast(t('Discord sign-in needs backend configuration. See docs/discord-setup.md.'));
    // The page lost its realtime connection while Discord had the window, as a phone does with pages in the background.
    if (error?.originalError?.message === 'realtime connection interrupted') return signInElsewhere('interrupted');
    throw error;
  }
  popup.close();
  // The Discord name replaces the placeholder of a new account; the profile route checks it.
  if (auth.record.displayName === 'Adventurer' && auth.meta?.name) {
    try { pb.authStore.save(pb.authStore.token, (await send('profile', { displayName: String(auth.meta.name).slice(0, 40) })).record); } catch { /* keeps Adventurer; Account & data renames it */ }
  }
  await authenticated();
}
async function logout() {
  // Invite codes stay usable for up to a week and pairing codes for five minutes; a shared computer must not keep them.
  await leaveRoomTopic(); await unwatchOwnTopic(); clearInterval(timer); timer = 0; clearTimeout(retryTimer); stopPairing(); pb.authStore.clear(); forget(); forgetAllInvites(storage); forgetPairing(storage); clearRoom(); rooms = []; roomsKnown = false; characters = []; readers = []; tasks = []; account = null; online = false;
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
    if (form.id === 'create-form') { const result = await send('create', { name: data.name }); rememberInvites(storage, result.room.id, result.invites, Date.now() + serverOffset); await go('/room/' + result.room.id); await inviteDialog(result.invites); }
    else if (form.id === 'armory-form') await go(findPath(data.region, data.server, data.name.trim()));
    else if (form.id === 'join-form') { const result = await send('join', { code: data.code }); toast(joinedMessage(result)); await go('/room/' + result.room.id); }
    else if (form.id === 'invite-form') {
      const result = await send('invite-create', { roomId: room.id, role: data.role, expiresIn: Number(data.expiresIn), maxUses: Number(data.maxUses), label: data.label });
      rememberInvite(storage, room.id, result.invite, Date.now() + serverOffset); form.elements.label.value = '';
      drawInvites(room.id, result.invites); document.querySelector(`#modal [data-invite="${CSS.escape(result.invite.id)}"] .invite-link`)?.focus(); toast(t('Invite link made. Copy it and send it to your friend.'));
    }
    else if (form.id === 'wish-form') {
      if (demo) return signInPrompt(t('This workspace uses sample data. Sign in with Discord to keep a dungeon wishlist in your own room.'));
      const problem = wishProblem(data.dungeon, { catalog: dungeons, wishlist, myId: pb.authStore.record?.id }); if (problem) return formError(form, problem);
      const id = room.id, result = await send('wishlist', { roomId: id, dungeon: data.dungeon, wanted: true }); form.reset(); changedRoom(id, () => { wishlist = result.wishlist; });
    }
    else if (form.id === 'run-form') {
      if (demo) return signInPrompt(t('This workspace uses sample data. Sign in with Discord to plan runs with your party.'));
      const problem = runProblem(data, { now: Date.now() + serverOffset, catalog: dungeons, runs }); if (problem) return formError(form, problem);
      const id = room.id, result = await send('plan', { roomId: id, dungeon: data.dungeon, startsAt: new Date(data.startsAt).toISOString(), note: data.note }); form.reset(); changedRoom(id, () => { runs = result.runs; });
    }
    else if (form.id === 'run-edit-form') {
      const run = runs.find(r => r.id === data.runId); if (!run) return formError(form, t('This run is no longer planned.'));
      const problem = runProblem(data, { now: Date.now() + serverOffset, catalog: dungeons, run }); if (problem) return formError(form, problem);
      // An unchanged start is not sent: the form shows whole minutes, and a run that started over an hour ago keeps its time.
      const changes = { roomId: room.id, id: run.id, dungeon: data.dungeon, note: data.note, ...(moved(run, data.startsAt) ? { startsAt: new Date(data.startsAt).toISOString() } : {}) };
      const result = await send('plan', changes); closeModal(); changedRoom(changes.roomId, () => { runs = result.runs; }); toast(t('Run updated.'));
    }
    else if (form.id === 'discord-options-form') {
      const times = chosenTimes(form);
      if (times.error) { formError(form, times.error); return; }
      const id = room.id, result = await send('discord-webhook', { roomId: id, ...times });
      if (changedRoom(id, () => { room = result.room; })) roomSettings();
      toast(t('Discord reminder settings saved.'));
    }
    else if (form.id === 'discord-form') {
      // A new connection takes the times chosen above it.
      const times = chosenTimes(document.getElementById('discord-options-form') || form);
      if (times.error) { formError(form, times.error); return; }
      const id = room.id, result = await send('discord-webhook', { roomId: id, webhook: data.webhook, language: language(), ...times }); if (changedRoom(id, () => { room = result.room; })) roomSettings(); toast(t('Discord reminders are on. Check the channel for the test message.')); }
    else if (form.id === 'task-edit-form') { applyTasks(await send('task', { id: form.dataset.id, title: data.title })); editingTask = ''; tasksView(); }
    else if (form.id === 'rename-form') { const id = room.id, result = await send('rename', { roomId: id, name: data.name }); rooms = rooms.map(r => r.id === id ? { ...r, name: result.room.name } : r); if (changedRoom(id, () => { room = result.room; })) roomSettings(); toast(t('Room renamed.')); }
    else if (form.id === 'notifications-form') {
      const leads = new FormData(form).getAll('lead').map(Number);
      if (!leads.length || leads.length > 3) { formError(form, t('Choose one to three reminder times.')); return; }
      const result = await send('notifications', { channels: { tray: Boolean(data.tray), browser: Boolean(data.browser), push: Boolean(data.push), discord: Boolean(data.discord) }, leadMinutes: leads, kinds: { ...(account.notifications || defaultNotifications).kinds, runs: Boolean(data.runs), cap: Boolean(data.cap), tasks: Boolean(data.tasks), ready: Boolean(data.ready) }, capTicks: Number(data.capTicks ?? 1), quiet: { from: data.quietFrom || '', to: data.quietTo || '', timeZone: data.quietFrom || data.quietTo ? data.timeZone : '' } });
      account.notifications = result.notifications; upcomingAt = 0; accountRender(); toast(t('Notifications saved.'));
    }
    else if (form.id === 'membership-form') {
      const result = await send('membership', { membership: data.membership || '' });
      account.membership = result.membership; accountRender();
      toast(result.membership === 'yes' ? t('Saved: the Odyle clock counts with the membership cap.') : result.membership === 'no' ? t('Saved: the Odyle clock counts with the cap without the membership.') : t('Saved: the Odyle clock goes by your readings again.'));
    }
    else if (form.id === 'profile-form') {
      const result = await send('profile', { displayName: data.displayName });
      pb.authStore.save(pb.authStore.token, result.record); account.account.displayName = result.record.displayName; accountRender(); toast(t('Display name saved.'));
    }
    else if (form.id.startsWith('task-form-')) { const scope = taskScope(); applyTasks(await send('task', { title: data.title, cadence: form.id.slice(10), ...(scope ? { characterId: scope } : {}) })); form.reset(); tasksView(); }
    else if (form.id === 'task-templates-form') {
      const titles = [...form.querySelectorAll('input[name="template"]:checked:not(:disabled)')].map(input => input.value), scope = taskScope();
      if (!titles.length) { formError(form, t('Choose tasks from the Global list.')); return; }
      applyTasks(await send('task', { templates: titles, ...(scope ? { characterId: scope } : {}) })); closeModal(); tasksView();
      toast(tn(titles.length, '{n} task added.', '{n} tasks added.'));
    }
  } catch (error) { if (error?.status === 401 && pb.authStore.token) expired(); else if (form.isConnected) formError(form, t(error?.message || 'Request could not be completed.')); else failed(error); }
  finally { busy = false; if (button.isConnected) button.disabled = false; }
});
app.addEventListener('click', async e => {
  const el = e.target.closest('button, .brand'); if (!el) return;
  try {
    if (el.matches('.brand')) { e.preventDefault(); return await go('/'); }
    if (el.dataset.room) return await go('/room/' + el.dataset.room);
    if (el.dataset.copy) return toast(await copyText(el.dataset.copy) ? el.dataset.copied || t('Code copied.') : t('Copying is blocked here. Select the text and copy it yourself.'));
    if (el.dataset.history) return await historyDialog(el.dataset.history, el.dataset.name);
    if (el.matches('[data-history-all]')) { const rows = document.querySelector('#modal .history-rows'); if (rows && shownHistory) rows.innerHTML = historyList(shownHistory.readings, Infinity, shownHistory.hourlyBefore); return; }
    if (el.dataset.armoryUnmark) { keepBookmarks(removeBookmark(bookmarks(), el.dataset.armoryUnmark)); return armoryRender(); }
    if (el.dataset.remove) return ask(esc(t('Remove {name}?', { name: el.dataset.name || t('this member') })), t('Their saved characters stay on their account. This removes their access to this room.'), t('Remove member'), { 'confirm-remove': el.dataset.remove });
    if (el.dataset.transfer) return ask(esc(t('Make {name} the leader?', { name: el.dataset.name })), esc(t('{name} becomes the owner of {room}. You stay in the room as a player and can leave it afterwards.', { name: el.dataset.name, room: room.name })), t('Hand over the room'), { 'confirm-transfer': el.dataset.transfer });
    if (el.dataset.shareNew) {
      const roomId = el.dataset.shareNew, enabled = el.dataset.enabled === 'true', target = rooms.find(r => r.id === roomId) || (room?.id === roomId ? room : null); el.disabled = true;
      try { await send('share-new', { roomId, enabled }); } finally { el.disabled = false; }
      rooms = rooms.map(r => r.id === roomId ? { ...r, shareNew: enabled } : r);
      if (room?.id === roomId && me()) { me().shareNew = enabled; roomSettings(); } else renderSharing();
      return toast(enabled ? t('New characters you save will be shared in {room}.', { room: target?.name || '' }) : t('New characters start private in {room} again.', { room: target?.name || '' }));
    }
    if (el.dataset.promptShare) {
      const roomId = el.dataset.roomId; el.disabled = true;
      const result = await send('sharing', { roomId, characterId: el.dataset.promptShare, enabled: true });
      rooms = rooms.map(r => r.id === roomId ? { ...r, sharedCharacters: result.sharedCharacters, sharing: true } : r);
      if (room?.id === roomId) changedRoom(roomId, () => applyShared(me(), result.sharedCharacters)); else if (!room) renderSharing();
      el.classList.add('done'); el.setAttribute('aria-pressed', 'true'); el.innerHTML = icon('tick') + el.textContent;
      return;
    }
    if (el.dataset.share) {
      const roomId = el.dataset.roomId || room.id; el.disabled = true;
      const enabled = el.dataset.enabled === 'true', name = el.dataset.name;
      let result; try { result = await send('sharing', { roomId, characterId: el.dataset.share, enabled }); } finally { el.disabled = false; }
      if (room) { changedRoom(roomId, () => applyShared(me(), result.sharedCharacters)); if (!enabled && name) toast(t('{name} was removed from this room. Its saved values stay on your account.', { name })); return; }
      rooms = rooms.map(r => r.id === roomId ? { ...r, sharedCharacters: result.sharedCharacters, sharing: result.sharedCharacters.length > 0 } : r);
      return renderSharing();
    }
    if (el.dataset.forgetDevice) return ask(esc(t('Remove {name}?', { name: el.dataset.name })), t('This PC stops reading for your account within a minute and needs a new connection link to pair again. Other browsers and PCs stay signed in.'), t('Remove PC'), { 'confirm-forget-device': el.dataset.forgetDevice });
    if (el.dataset.confirmForgetDevice) { await send('forget-device', { deviceId: el.dataset.confirmForgetDevice }); closeModal(); await refreshAccount(); accountRender(); return toast(t('The PC was unpaired.')); }
    if (el.dataset.deleteCharacter) return ask(esc(t('Delete {name}?', { name: el.dataset.name })), t('Its saved Odyle, history and portrait are deleted and every room stops listing it. If the Windows app sees it in game again, it saves it as a new character.'), t('Delete character'), { 'confirm-delete-character': el.dataset.deleteCharacter });
    if (el.dataset.confirmDeleteCharacter) { await send('delete-character', { characterId: el.dataset.confirmDeleteCharacter }); closeModal(); toast(t('Character deleted.')); return await show(true); }
    if (el.dataset.taskScope !== undefined) { try { storage.setItem(taskScopeKey, el.dataset.taskScope); } catch { /* storage blocked */ } editingTask = ''; tasksView(); return document.querySelector(`[data-task-scope="${el.dataset.taskScope}"]`)?.focus(); }
    if (el.dataset.editTask) { editingTask = el.dataset.editTask; tasksView(); return document.querySelector('#task-edit-form input')?.select(); }
    if (el.dataset.moveTask) { el.disabled = true; applyTasks(await send('task', { id: el.dataset.moveTask, move: el.dataset.move })); tasksView(); return document.querySelector(`[data-move-task="${el.dataset.moveTask}"][data-move="${el.dataset.move}"]:not(:disabled)`)?.focus(); }
    if (el.dataset.removeTask) return ask(esc(t('Remove {task}?', { task: el.dataset.name })), t('It leaves your checklist for good. You can add it again at any time.'), t('Remove task'), { 'confirm-remove-task': el.dataset.removeTask });
    if (el.dataset.confirmRemoveTask) { applyTasks(await send('task', { id: el.dataset.confirmRemoveTask, remove: true })); closeModal(); return tasksView(); }
    if (el.dataset.wish) {
      const id = room.id; let result; el.disabled = true; try { result = await send('wishlist', { roomId: id, dungeon: el.dataset.wish, wanted: el.dataset.wanted === 'true' }); } finally { el.disabled = false; }
      return changedRoom(id, () => { wishlist = result.wishlist; });
    }
    if (el.dataset.planWish) {
      const form = document.querySelector('#run-form'); if (!form) return;
      form.elements.dungeon.value = el.dataset.planWish; form.scrollIntoView({ behavior: 'smooth', block: 'center' }); return form.elements.startsAt.focus();
    }
    // Going with one of several characters shared here asks which one first.
    if (el.dataset.run && el.dataset.going === 'true' && !el.dataset.character && mine().filter(c => c.shared).length > 1) {
      const run = runs.find(r => r.id === el.dataset.run);
      return modal(esc(t('Going to {dungeon} with', { dungeon: run?.dungeon || '' })), `<p>${t('Pick the character you bring. The run counts its cubes.')}</p><div class="add-chips pick-chips">${mine().filter(c => c.shared).map(c => `<button class="add-chip" data-run="${esc(el.dataset.run)}" data-going="true" data-character="${esc(c.id)}">${esc(c.characterName)} · ${esc(c.value.toLocaleString(locale()))}</button>`).join('')}<button class="add-chip" data-run="${esc(el.dataset.run)}" data-going="true" data-character="any">${t('Any: my best')}</button></div>`);
    }
    if (el.dataset.useStart) { const input = document.querySelector('#run-form [name="startsAt"]'); if (input) { input.value = el.dataset.useStart; input.focus(); } return; }
    if (el.dataset.cantRun) {
      const id = room.id; let result; el.disabled = true; try { result = await send('plan', { roomId: id, id: el.dataset.cantRun, cant: el.dataset.cant === 'true' }); } finally { el.disabled = false; }
      return changedRoom(id, () => { runs = result.runs; });
    }
    if (el.dataset.run) {
      const id = room.id; let result; el.disabled = true; try { result = await send('plan', { roomId: id, id: el.dataset.run, going: el.dataset.going === 'true', ...(el.dataset.character && el.dataset.character !== 'any' ? { character: el.dataset.character } : {}) }); } finally { el.disabled = false; }
      if (el.dataset.character) closeModal();
      return changedRoom(id, () => { runs = result.runs; });
    }
    if (el.dataset.editRun) { const r = runs.find(x => x.id === el.dataset.editRun); if (r) modal(esc(t('Change {dungeon}', { dungeon: r.dungeon })), runEditForm(r, { suggestions: [...new Set(wishlist.map(w => w.dungeon))], catalog, perCube: room?.cost || perCube }, Date.now() + serverOffset)); return; }
    if (el.dataset.copyRun) {
      const r = runs.find(x => x.id === el.dataset.copyRun); if (!r) return;
      const going = r.attendees.map(u => members.find(m => m.user === u)?.displayName).filter(Boolean);
      const text = discordText(r, { going, partySize: entryOf(catalog, r.dungeon)?.partySize || 0, link: `${location.origin}${location.pathname}#/room/${room.id}` });
      return toast(await copyText(text) ? t('Copied for Discord: paste it in any channel.') : t('Copying is blocked here. Select the text and copy it yourself.'));
    }
    if (el.dataset.calendarRun) {
      const r = runs.find(x => x.id === el.dataset.calendarRun); if (!r) return;
      const going = r.attendees.map(u => members.find(m => m.user === u)?.displayName).filter(Boolean);
      return download(calendarFile(r, { room: room.name, going, now: Date.now() + serverOffset }), `odyle-${r.dungeon.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'run'}.ics`, 'text/calendar');
    }
    if (el.dataset.cancelRun && el.dataset.missed) return ask(esc(t('{dungeon} did not happen?', { dungeon: el.dataset.name })), t('The run disappears for everyone. The wishlist stays as it is.'), t('Didn’t happen'), { 'confirm-cancel-run': el.dataset.cancelRun });
    if (el.dataset.cancelRun) return ask(esc(t('Cancel {dungeon}?', { dungeon: el.dataset.name })), t('The run disappears for everyone who planned to go.'), t('Cancel run'), { 'confirm-cancel-run': el.dataset.cancelRun });
    if (el.dataset.runDone) {
      const id = room.id; el.disabled = true; let result; try { result = await send('plan', { roomId: id, id: el.dataset.runDone, done: true }); } finally { el.disabled = false; }
      changedRoom(id, () => { runs = result.runs; });
      return toast(t('{dungeon} done: it left the wishlist of everyone who went.', { dungeon: el.dataset.name }));
    }
    if (el.dataset.runAgain) {
      // The same local time a week later, also across a daylight saving change.
      const next = new Date(timestamp(el.dataset.at)); next.setDate(next.getDate() + 7);
      const id = room.id; el.disabled = true; let result; try { result = await send('plan', { roomId: id, id: el.dataset.runAgain, again: true, startsAt: next.toISOString() }); } finally { el.disabled = false; }
      changedRoom(id, () => { runs = result.runs; });
      return toast(t('{dungeon} is planned again for {when}, with you going.', { dungeon: el.dataset.name, when: next.toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }));
    }
    if (el.dataset.confirmCancelRun) { const id = room.id, result = await send('plan', { roomId: id, id: el.dataset.confirmCancelRun, remove: true }); closeModal(); return changedRoom(id, () => { runs = result.runs; }); }
    if (el.dataset.clearWish) return ask(t('Clear from the wishlist?'), t('This takes <strong>{dungeon}</strong> off the wishlist for every member, for example after the party ran it. Anyone can add it again.', { dungeon: esc(el.dataset.clearWish) }), t('Clear for everyone'), { 'confirm-clear': el.dataset.clearWish });
    if (el.dataset.confirmClear) { const id = room.id, result = await send('wishlist', { roomId: id, dungeon: el.dataset.confirmClear, wanted: false, everyone: true }); closeModal(); return changedRoom(id, () => { wishlist = result.wishlist; }); }
    if (el.dataset.confirmRemove) { await send('revoke', { roomId: room.id, memberId: el.dataset.confirmRemove }); closeModal(); return await refreshRoom(); }
    if (el.dataset.confirmRole) {
      const id = room.id, { membership } = await send('role', { roomId: id, memberId: el.dataset.confirmRole, role: el.dataset.newRole });
      // A member this page does not list yet (joined since the last snapshot) comes with the room fetched again.
      let listed = true;
      if (changedRoom(id, () => { listed = applyMembership(members, membership); })) { if (!listed) await refreshRoom(); roomSettings(); }
      return toast(t('Role changed.'));
    }
    // A link already sent stops working when revoked, so revoking asks first; Keep it goes back to the links.
    if (el.dataset.revokeInvite) return ask(t('Revoke this invite link?'), t('It stops working at once, also for anyone you already sent it to. Members who joined with it stay in the room.'), t('Revoke link'), { 'confirm-revoke-invite': el.dataset.revokeInvite }, 'invite');
    if (el.dataset.confirmRevokeInvite) {
      const id = el.dataset.confirmRevokeInvite, result = await send('invite-revoke', { roomId: room.id, inviteId: id });
      forgetInvite(storage, room.id, id); await inviteDialog(result.invites); return toast(t('Invite link revoked.'));
    }
    if (el.dataset.inviteRoom) return await openInvites(el.dataset.inviteRoom);
    if (el.dataset.confirmTransfer) { await send('transfer', { roomId: room.id, memberId: el.dataset.confirmTransfer }); closeModal(); await refreshRoom(); return toast(t('You handed the room over. You are now a player in it.')); }
    switch (el.dataset.action) {
      case 'discord': await discordLogin(); break;
      case 'retry': await authenticated(); break;
      case 'cancel-task-edit': editingTask = ''; tasksView(); break;
      case 'task-templates': { const scope = taskScope(), name = scopes(taskCharacters).find(s => s.id === scope)?.name || t('Account'); modal(esc(t('Add to {list}', { list: name })), `<p>${t('Tasks of the game the server keeps for everyone. Each is added once; you can rename or remove it later.')}</p>${templatesForm(taskTemplates, tasks, scope)}`); break; }
      case 'discord-off': ask(t('Stop Discord reminders?'), t('Planned runs are no longer posted to your Discord channel. Odyle forgets the webhook URL; to turn reminders on again, paste one from Discord.'), t('Stop reminders'), { action: 'confirm-discord-off' }); break;
      case 'confirm-discord-off': { const id = room.id, result = await send('discord-webhook', { roomId: id, webhook: '' }); if (changedRoom(id, () => { room = result.room; })) roomSettings(); toast(t('Discord reminders are off.')); break; }
      case 'open-elsewhere': signInElsewhere(embedded() ? 'app' : ''); break;
      case 'reminders': await toggleReminders(); accountRender(); break;
      case 'live-only': storage.setItem(liveOnlyKey, liveOnly() ? 'off' : 'on'); dashboard(); break;
      case 'push-on': await pushOn(); accountRender(); break;
      case 'push-off': await pushOff(); accountRender(); break;
      case 'push-test': { const result = await send('push-test', {}); account.push = result.push; toast(tn(result.sent, 'Sent a test to {n} device.', 'Sent a test to {n} devices.')); break; }
      case 'overview': room ? dashboard() : await go(pb.authStore.isValid && remembered().room ? '/room/' + remembered().room : '/'); break;
      case 'library': await go('/'); break;
      case 'calendar-all': download(calendarOfRuns(nextRunsList, Date.now() + serverOffset), 'odyle-runs.ics', 'text/calendar'); break;
      case 'new-room': { await go('/'); const setup = document.querySelector('.room-setup'); if (setup) { setup.open = true; setup.querySelector('input')?.focus(); } break; }
      case 'tasks': await go('/tasks'); break;
      case 'armory': closeModal(); await go('/armory'); break;
      case 'armory-refresh': await armoryPage(shown, navigation, true); break;
      case 'armory-bookmark': toggleBookmark(); break;
      case 'account': if (!pb.authStore.isValid || demo) await go('/'); else await go('/account'); break;
      case 'demo': await go('/demo'); break;
      case 'exit-demo': await go('/'); break;
      case 'close-dialog': closeModal(); break;
      case 'invite': await inviteDialog(); break;
      case 'room-settings': roomSettings(); break;
      case 'reading': await desktopDialog(); break;
      case 'pair-another': if (pairing) await openLink(pairing); break;
      case 'new-pairing': if (pairing) { forgetPairing(storage); await openLink(pairing); } break;
      case 'add-all': { const id = room.id, result = await send('sharing', { roomId: id, enabled: true }); changedRoom(id, () => applyShared(me(), result.sharedCharacters)); break; }
      case 'desktop': await desktopDialog(true); break;
      case 'hide-update-note': seenVersion(); break;
      case 'skip': { const main = document.querySelector('.main main'); if (main) { main.setAttribute('tabindex', '-1'); main.focus(); } break; }
      case 'hide-announcement': storage.setItem(hiddenAnnouncementKey, announcement?.text || ''); renderAnnouncement(); break;
      case 'help': modal(t('Saved characters, fresh readings'), [
        t('Sign in with Discord to create your account. Rooms and all character readings persist across sign-outs and room changes.'),
        t('Each character is shared per room: choose them under My rooms & characters → Room sharing, or inside the room: add one from the bar above the party and take it out with Remove from room on its card. Friends only see the characters you linked to that room. A viewer invite grants read-only room access.'),
        t('Each room keeps a dungeon wishlist and planned runs: add the dungeons you still need, join an entry with Need it too, plan a run with a time and join it with Going. The room owner can clear an entry for everyone.'),
        t('Daily & weekly is your own checklist: add the tasks you run every day or week and tick them off. They uncheck themselves at the daily and weekly reset of the Global service, so nothing is deleted and nothing needs re-adding.'),
        t('The Windows app is a free download from its GitHub releases; My rooms & characters links the newest version, and an installed app updates itself from new releases. It pairs once with a one-time link, stays paired until you disconnect it and reads game packets locally. Raw game traffic stays on your PC. Only normalized readings from a validated adapter may be shared.'),
        t('The Windows app sends Odyle when it first reads it and whenever it changes; each change is kept for 30 days as the character’s history. A reading counts as live while the app reports the game connection; 45 seconds without that it turns stale and stays saved. Readings are decoded from the Global game stream by the reference adapter; manual entry is disabled.'),
        t('Account & data lets you download everything stored for you, sign out everywhere and delete your account.'),
        scopeText(),
        `${t('What Odyle keeps and how long:')} <a href="#/privacy">${t('Privacy notice')}</a> · <a href="https://github.com/oldbear24/odyle-dashboard/issues" target="_blank" rel="noopener">${t('Report a problem or ask')}</a>`,
      ].map(p => `<p>${p}</p>`).join('')); break;
      case 'leave-room': ask(esc(t('Leave {room}?', { room: room.name })), t('You lose access to this room, your wishlist entries and your place on planned runs. Your characters stay on your account; you need a new invite to come back.'), t('Leave room'), { action: 'confirm-leave' }); break;
      case 'close-room': ask(esc(t('Close {room}?', { room: room.name })), t('This deletes the room with its wishlist and planned runs for every member. Characters stay on their accounts. It cannot be undone.'), t('Close room for everyone'), { action: 'confirm-close' }); break;
      case 'confirm-leave': case 'confirm-close': { const id = room.id, closing = el.dataset.action === 'confirm-close'; await send(closing ? 'close' : 'leave', { roomId: id }); closeModal(); forget(id); if (closing) forgetInvites(storage, id); await go('/'); toast(closing ? t('Room closed. Your saved characters are retained.') : t('You left the room. Your saved characters are retained.')); break; }
      case 'export': download(JSON.stringify(await pb.send('/api/odyle/export'), null, 2), `odyle-data-${new Date().toISOString().slice(0, 10)}.json`, 'application/json'); break;
      case 'sign-out-everywhere': ask(t('Sign out everywhere?'), t('Every other browser and every paired Windows app loses access and must sign in or pair again. This browser stays signed in.'), t('Sign out everywhere'), { action: 'confirm-sign-out-everywhere' }); break;
      // The new token ends every realtime sign-in of the account, this browser's too: subscribe again with it.
      case 'confirm-sign-out-everywhere': { const data = await send('sign-out-everywhere'); pb.authStore.save(data.token, data.record); forgetPairing(storage); closeModal(); toast(t('Signed out everywhere else. Pair your Windows app again to keep reading.')); await unwatchOwnTopic(); await show(true); break; }
      case 'delete-account': modal(t('Delete your account?'), `<p>${t('Your characters, their history, your memberships, wishlist entries and tasks are deleted for good. Rooms you own pass to their longest-standing player, or close if there is none. Download your data first if you want to keep it.')}</p><label>${esc(t('Type {name} to confirm', { name: pb.authStore.record.displayName }))}<input id="delete-confirm" autocomplete="off"></label><button class="button danger" data-action="confirm-delete-account">${t('Delete account for good')}</button><button class="button secondary" data-action="close-dialog">${t('Keep it')}</button>`); break;
      case 'confirm-delete-account': {
        if (document.querySelector('#delete-confirm')?.value.trim() !== pb.authStore.record.displayName) return toast(t('Type your display name exactly as shown to confirm.'));
        await send('delete-account', { confirm: true }); closeModal(); await logout(); toast(t('Your account was deleted.')); break;
      }
      case 'logout': await logout(); break;
    }
  } catch (error) { failure(error); }
});
// The clipboard API is missing or refused in some browsers (in-app ones, plain HTTP); a
// selected text field copies there. False when neither works.
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* tried below */ }
  const field = document.createElement('textarea');
  field.value = text; field.readOnly = true; field.style.cssText = 'position:fixed;top:0;opacity:0';
  (document.querySelector('#modal[open]') || document.body).append(field); field.select();
  try { return document.execCommand('copy'); } catch { return false; } finally { field.remove(); }
}
function download(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type })), link = document.createElement('a');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// Browser reminders of the runs this account is going to, at the account's reminder times
// (Account & data → Notifications) while a dashboard tab is open and this browser may show
// notifications; none in the quiet hours.
const remindedKey = 'odyle.reminded';
const notifications = () => 'Notification' in window;
function reminderState() { if (!notifications()) return 'unsupported'; if (Notification.permission === 'denied') return 'blocked'; return Notification.permission === 'granted' ? 'on' : 'off'; }
async function toggleReminders() {
  if (!notifications()) return toast(t('This browser cannot show notifications.'));
  if (await Notification.requestPermission() !== 'granted') return toast(t('Notifications are blocked for this site. Allow them in the browser settings.'));
  upcomingAt = 0; toast(t('This browser shows your notifications now.'));
}
// A notification in this browser, through the service worker when there is one.
async function notice(title, options) {
  try { const worker = await navigator.serviceWorker?.getRegistration(); if (worker) await worker.showNotification(title, options); else new Notification(title, options); } catch { /* permission withdrawn meanwhile */ }
}
// Cap alerts show where the account wants them in browsers, once per alert across its open tabs.
async function showCapAlerts(alerts) {
  const settings = account?.notifications || notificationsSeen || defaultNotifications;
  if (!settings.kinds.cap || !settings.channels.browser || reminderState() !== 'on') return;
  for (const alert of alerts) { const { title, body } = capAlertText(alert); await notice(title, { body, tag: 'cap-' + alert.characterId + '-' + alert.state, icon: 'icon-192.png' }); }
}
// Everyone going to a run can claim a cube (#48): one notice per run and start, like a push.
async function showPartyReady(notices) {
  const settings = account?.notifications || notificationsSeen || defaultNotifications;
  if (settings.kinds.ready === false || !settings.channels.browser || reminderState() !== 'on') return;
  for (const n of notices) await notice(t('{dungeon}: the party is ready', { dungeon: n.dungeon }), { body: t('All {n} going can claim a cube · {room}', { n: n.of, room: n.room }), tag: 'ready-' + n.runId + '@' + n.startsAt, icon: 'icon-192.png' });
}
let upcomingAt = 0, notificationsSeen = null;
// Web Push on this device (backend push.go): the browser subscribes at its push service with
// the server's key, and the server keeps the subscription for the account. pushHere is
// unsupported, unavailable (no key or no service worker), blocked, on or off.
let pushHere = 'unsupported';
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && notifications();
async function checkPush() {
  if (!pushSupported()) return (pushHere = 'unsupported');
  const registration = await navigator.serviceWorker.getRegistration();
  if (!account?.push?.publicKey || !registration) return (pushHere = 'unavailable');
  if (Notification.permission === 'denied') return (pushHere = 'blocked');
  return (pushHere = await registration.pushManager.getSubscription() ? 'on' : 'off');
}
// "Edge on Windows", "Chrome on Android": how the account page names this device.
function deviceName() {
  const ua = navigator.userAgent, browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const system = /Android/.test(ua) ? 'Android' : /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return system ? browser + ' on ' + system : browser;
}
async function pushSubscribed(subscription) {
  const json = subscription.toJSON(), result = await send('push-subscribe', { endpoint: json.endpoint, keys: json.keys, language: language(), device: deviceName() });
  account.push = result.push;
}
async function pushOn() {
  if (await Notification.requestPermission() !== 'granted') { pushHere = 'blocked'; return toast(t('Notifications are blocked for this site. Allow them in the browser settings.')); }
  const registration = await navigator.serviceWorker.ready, key = Uint8Array.from(atob(account.push.publicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  let subscription = await registration.pushManager.getSubscription();
  // A subscription made with another server key is renewed.
  try { subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }); }
  catch { await subscription?.unsubscribe(); subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }); }
  await pushSubscribed(subscription); pushHere = 'on'; toast(t('Push notifications are on for this device.'));
}
async function pushOff() {
  const subscription = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
  if (subscription) { account.push = (await send('push-unsubscribe', { endpoint: subscription.endpoint })).push; await subscription.unsubscribe(); }
  pushHere = 'off'; toast(t('Push notifications are off for this device.'));
}
async function remindRuns() {
  if (reminderState() !== 'on' || demo || !pb.authStore.isValid || Date.now() - upcomingAt < 60000) return;
  upcomingAt = Date.now();
  const data = await pb.send('/api/odyle/upcoming'), now = Date.parse(data.serverNow) || Date.now(), settings = data.notifications || defaultNotifications;
  notificationsSeen = settings;
  if (!settings.kinds.runs || !settings.channels.browser) return;
  let done; try { done = JSON.parse(storage.getItem(remindedKey)) || {}; } catch { done = {}; }
  for (const { run: r, at, key, marks } of dueReminders(data.runs, now, settings.leadMinutes, done)) {
    // One notification per run, start time and reminder time, also across tabs and reloads.
    for (const key of marks) done[key] = at;
    if (quietAt(settings, now)) continue;
    const title = t('{dungeon} starts {time}', { dungeon: r.dungeon, time: startsIn(at, now) }), options = { body: [r.room, r.note].filter(Boolean).join(' · '), tag: key, icon: 'icon-192.png' };
    await notice(title, options);
  }
  for (const key in done) if (done[key] < now - 86400000) delete done[key];
  try { storage.setItem(remindedKey, JSON.stringify(done)); } catch { /* storage full or blocked */ }
}
app.addEventListener('change', async e => {
  const el = e.target;
  if (el.id === 'language-select') {
    try { await useLanguage(el.value); } catch (error) { return failure(error); }
    document.documentElement.lang = language(); document.title = t('Odyle — Party command'); storage.setItem(languageKey, language());
    // Push messages are written in the language of the device that asked for them.
    if (pushHere === 'on') (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription().then(s => s && pushSubscribed(s)).catch(() => { /* kept in the old language */ });
    return rerender();
  }
  // A role change asks first; keeping the role closes the dialog with nothing changed.
  if (el.matches?.('select[data-role]')) {
    const name = members.find(m => m.id === el.dataset.role)?.displayName || t('this member'), data = { 'confirm-role': el.dataset.role, 'new-role': el.value };
    if (el.value === 'viewer') return ask(esc(t('Make {name} a viewer?', { name })), esc(t('Viewers only watch: the characters {name} shares here leave the party, and have to be added again after a change back to player.', { name })), t('Make viewer'), data);
    if (el.value === 'officer') return ask(esc(t('Make {name} an officer?', { name })), esc(t('{name} can then invite people, change or cancel any run, clear a dungeon off everyone’s wishlist and keep the Discord reminders. Renaming and closing the room, roles and handing it over stay with you.', { name })), t('Make officer'), data);
    return ask(esc(t('Make {name} a player?', { name })), esc(t('{name} can then add characters to this room, plan runs and join them.', { name })), t('Make player'), data);
  }
  // Ticking a task saves the time it was done; it shows as done until the next reset.
  if (!el.matches?.('input[data-task]')) return;
  const id = el.dataset.task, done = el.checked; el.disabled = true;
  try { applyTasks(await send('task', { id, done })); tasksView(); document.querySelector(`input[data-task="${id}"]`)?.focus(); }
  catch (error) { el.checked = !done; el.disabled = false; failure(error); }
});
app.addEventListener('click', e => { if (e.target.closest('#toast')) e.target.closest('#toast').classList.remove('show'); });
window.addEventListener('storage', e => { if (e.key === bookmarksKey && shown?.startsWith('/armory') && document.activeElement?.name !== 'name') armoryRender(); });
app.addEventListener('focusin', e => { if (e.target.matches?.('.link-field')) e.target.select(); });
// A closed dialog may have held back room changes (rename, roles); draw them now. A closed
// pairing dialog stops following its link.
app.addEventListener('close', e => { if (e.target.id !== 'modal') return; stopPairing(); if (room && !demo) renderDashboard(); }, true);
// A picture that fails to load (removed meanwhile, server unreachable) uncovers the initials.
app.addEventListener('error', e => { if (e.target.matches?.('.portrait img')) e.target.closest('.portrait-photo').remove(); }, true);
// The page language is ready before the first page is drawn; without its dictionary it stays English.
// The service worker keeps the dashboard's files for visits without a connection and
// shows run reminders; development builds go without it.
if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => { /* runs without offline files */ });
useLanguage(detect(storage.getItem(languageKey), navigator.languages || [navigator.language])).catch(() => useLanguage('en')).then(() => {
  document.documentElement.lang = language(); document.title = t('Odyle — Party command');
  if (pb.authStore.isValid) return authenticated().catch(failure);
  loadAnnouncement(true).catch(() => { /* an older backend or no connection: no banner */ });
  show().catch(failure);
});
