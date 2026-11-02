import { runReadiness, broughtBy, earliestClaim, callable } from './runready.js';
import { defaultNotifications, dueReminders, quietAt, capAlertText } from './notify.js';
import { defaultClock, clockOf, clockLine, capMismatch, capLevel } from './clock.js';
import PocketBase, { LocalAuthStore } from 'pocketbase';
import { status, age, escape as esc, timestamp, classOf, regionLabel, weekDates } from './model.js';
import { connectionLink } from './connection.js';
import { windowsApp } from './release.js';
import { defaults as resetDefaults, isDone, nextReset, remaining, dayName, resetHour, scopes, inScope, left, templatesForm, periodStart } from './tasks.js';
import { icon } from './icons.js';
import { t, tn, detect, useLanguage, language, locale } from './i18n.js';
import { joinCode, rememberInvites, rememberInvite, forgetInvite, forgetInvites, forgetAllInvites, inviteLanding, joinedMessage } from './invites.js';
import { placeButton } from './placeline.js';
import { setupTracker } from './setup.js';
import { lookName, frameClass } from './looks.js';
import { weekLine, runsSection, startsIn, discordText, nextRunsSection, roomGlance, runParty } from './runs.js';
import { wishProblem, runProblem, moved } from './forms.js';
import { inAppBrowser, signInLink } from './signin.js';
import { applyRoomCharacters, applyCharacters, applySeen, applyContact, applyShared, applyMembership } from './live.js';
import { forgetPairing, readerList, onlineReader, readerLabel } from './readers.js';
import { party as partyOf, explain, character as readinessOf } from './readiness.js';
import { partySummary, statusReason, readyOrder, byPlayer, inGame } from './partyview.js';
import { dungeonKey, entryOf, cubeCost, dungeonFacts, dungeonField } from './catalog.js';
import { updated, updatedNote } from './updatenote.js';
import { usesPaths, link, address, current, linked, visit, adoptHash, bare, retitle } from './routes.js';
import { boardSection, boardForm } from './board.js';
import { featureOn, featuresForm, changedFeatures } from './roomfeatures.js';
import { armoryRoute, armoryTarget, armoryTitle, classBadge, profilePath, findPath, officialPath } from './armorylinks.js';
import { lazily, reloadOnce } from './lazy.js';
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
// Pages, dialogs and actions that not every visit uses load the first time they are needed, and
// the rest while the browser is idle once the first page is drawn (lazy.js, prefetchParts). A
// part gone with a deploy loads the new build (reloadOnce); meanwhile its caller waits, so no
// error shows for a page that is going away.
const tabStorage = (() => { try { return window.sessionStorage; } catch { return null; } })();
function gone(error) {
  if (!reloadOnce(tabStorage, Date.now(), navigator.onLine !== false)) throw Object.assign(new Error('This part of Odyle could not load. Check your connection, then reload the page.'), { cause: error });
  location.reload(); return new Promise(() => { /* the new build takes over */ });
}
const lazyPart = load => lazily(load, gone);
const whatsnewPart = lazyPart(() => import('./parts/whatsnew.js')), privacyPart = lazyPart(() => import('./parts/privacy.js')), helpPart = lazyPart(() => import('./help.js'));
const armoryPart = lazyPart(() => import('./parts/armory.js')), cardPart = lazyPart(() => import('./parts/card.js')), cardImagePart = lazyPart(() => import('./cardimage.js'));
const accountPart = lazyPart(() => import('./account.js')), pairingPart = lazyPart(() => import('./pairing.js')), demoPart = lazyPart(() => import('./demo.js')), slotsPart = lazyPart(() => import('./parts/slots.js'));
const historyPart = lazyPart(() => import('./history.js')), placesPart = lazyPart(() => import('./places.js')), invitesPart = lazyPart(() => import('./invitedialog.js'));
const discordPart = lazyPart(() => import('./discord.js')), runToolsPart = lazyPart(() => import('./runtools.js'));
const timersPart = lazyPart(() => import('./parts/timers.js')), achievementsPart = lazyPart(() => import('./parts/achievements.js')), weekPart = lazyPart(() => import('./parts/week.js'));
// Once the first page is drawn, the parts it did not need load one after another while the
// browser is idle, unless it asks to save data.
function prefetchParts() {
  if (navigator.connection?.saveData || /2g/.test(navigator.connection?.effectiveType || '')) return;
  const queue = [whatsnewPart, timersPart, achievementsPart, weekPart, armoryPart, cardPart, historyPart, placesPart, accountPart, invitesPart, pairingPart, discordPart, runToolsPart, helpPart, privacyPart, demoPart, slotsPart, cardImagePart];
  const idle = next => (window.requestIdleCallback ? requestIdleCallback(next, { timeout: 5000 }) : setTimeout(next, 500));
  const next = () => queue.shift()?.prefetch().then(() => idle(next));
  idle(next);
}
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
// Each class's role in a party from the snapshot (#45), for the make-up of planned runs.
let classRoles = [];
// The game's maps as superusers named them (location sharing, places.js).
let gameMaps = [];
// The classes' emblems by class name (backend/odyle/classes.go), with the room list and rooms.
let classIcons = {};
// How long the server keeps the Odyle history and the places (Game settings), for the help.
let keptDays = { historyDays: 30, locationDays: 30 };
// The party's week (#42): what the characters shared in the room spent since the weekly reset.
let roomWeek = null;
// The room's information board (board.js): its text, who wrote it last and when, or null.
let board = null;
const hiddenAnnouncementKey = 'odyle.announcement.hidden';
let timer = 0;
const me = () => members.find(m => m.user === pb.authStore.record?.id);
const owner = () => demo || room?.owner === pb.authStore.record?.id;
// The owner or an officer (#43): invites, every run, clearing the wishlist for everyone and Discord reminders.
const manager = () => owner() || me()?.role === 'officer';
// Whether the room owner left a part of the room on (roomfeatures.js): board, runs, wishlist, week.
const on = feature => featureOn(room, feature);
const mine = () => me()?.characters || [];
const roleName = role => role === 'owner' ? t('leader') : role === 'officer' ? t('officer') : role === 'viewer' ? t('viewer') : t('player');
const colors = ['jade', 'amber', 'blue', 'pink', 'violet'];
// The official game portrait (downloaded by the backend) sits over the initials,
// which remain as the fallback while it loads, if it fails or when there is none.
function portrait(c, index, size = '') {
  const name = c.characterName || c.displayName, url = !demo && c.portrait ? pb.files.getURL(c, c.portrait) : '';
  const photo = url ? `<span class="portrait-photo"><img src="${esc(url)}" alt="" loading="lazy"></span>` : '';
  return `<span class="portrait ${colors[index % colors.length]} ${size}${frameClass(c.look)}">${esc(name.slice(0, 2).toUpperCase())}${photo}<span class="portrait-rune">${icon('diamond')}</span></span>`;
}
// The main character comes first; each keeps the portrait color of its place by age.
const ownCards = () => characters.map((c, i) => [c, i]).sort(([a], [b]) => Boolean(b.main) - Boolean(a.main)).map(([c, i]) => card({ ...c, sharing: true, role: 'reporter', displayName: pb.authStore.record.displayName, user: pb.authStore.record.id }, i)).join('');
// The pages, as links (they open in a new tab too): in the sidebar on wide screens, in the bar
// at the bottom on phones (with the short name). Dialogs sit in the account menu.
const pages = () => [['overview', 'grid', t('Party')], ['library', 'people', t('Rooms & characters'), t('Rooms')], ['tasks', 'check', t('Tasks')], ['week', 'chart', t('My week')], ['achievements', 'trophy', t('Achievements')], ['timers', 'clock', t('Timers')], ['armory', 'search', t('Armory')]];
// The bar at the bottom of phones has room for these four and the account; the other pages are
// in the account menu there (phoneItems).
const phonePages = ['overview', 'library', 'tasks', 'armory'];
const navItem = (action, active, name, label) => `<a href="${navHref(action)}" data-action="${action}" class="nav-item ${active === action ? 'active' : ''}"${active === action ? ' aria-current="page"' : ''}>${icon(name)}<span class="nav-label">${label}</span>${badgeOf(action)}</a>`;
// The count beside a page in the navigation: tasks left, achievements reached since the last look.
const badgeOf = action => action === 'tasks' ? taskBadge() : action === 'achievements' ? achievementBadge() : '';
// Where a navigation item leads: the open (or last) room, the library, the checklist, the armory, the account.
function navHref(action) {
  const signedIn = pb.authStore.isValid && !demo;
  if (action === 'overview') return link(demo ? '/demo' : room ? '/room/' + room.id : signedIn && remembered().room ? '/room/' + remembered().room : '/');
  const path = { library: '/', tasks: signedIn ? '/tasks' : '/', week: signedIn ? '/week' : '/', achievements: '/achievements', timers: '/timers', armory: '/armory', account: signedIn ? '/account' : '/' }[action];
  return path ? link(path) : '';
}
const bottomNav = active => `<nav class="bottom-nav" aria-label="${esc(t('Pages'))}">${[...pages().filter(([action]) => phonePages.includes(action)).map(([action, name, label, short]) => [action, name, short || label]), ['account', 'user', t('Account')]].map(([action, name, label]) => `<a href="${navHref(action)}" data-action="${action}" class="${active === action ? 'active' : ''}"${active === action ? ' aria-current="page"' : ''}>${icon(name)}<span>${label}</span>${action === 'tasks' ? taskBadge() : ''}</a>`).join('')}</nav>`;
const connectionLabel = () => `<i></i>${demo ? t('Demo workspace') : online ? t('Connected') : t('Not connected')}`;
// The room switch: the room on screen (or the last one), the account's other rooms and the
// way to a new one. The library brings the list; other pages fetch it once (loadRoomList).
function roomSwitch() {
  const mark = name => `<span class="room-mark">${esc((name || '·').slice(0, 1).toUpperCase())}</span>`;
  if (demo) return `<div class="room-switch is-static">${mark(room?.name)}<span class="room-switch-text"><small>${t('Room')}</small><strong>${esc(room?.name || '')}</strong></span></div>`;
  if (!pb.authStore.isValid) return '';
  const id = room?.id || remembered().room, name = room?.name || rooms.find(r => r.id === id)?.name || '';
  const options = rooms.map(r => `<a href="${esc(link('/room/' + r.id))}" class="menu-item room-option ${r.id === room?.id ? 'active' : ''}"${r.id === room?.id ? ' aria-current="page"' : ''}>${mark(r.name)}<span><strong>${esc(r.name)}</strong><small>${esc(roleName(r.role))}</small></span></a>`).join('');
  return `<details class="room-switch"><summary title="${esc(t('Switch room'))}">${mark(name)}<span class="room-switch-text"><small>${t('Room')}</small><strong>${esc(name || t('Choose a room'))}</strong></span>${icon('chevron')}</summary><div class="menu">${options}<button class="menu-item" data-action="new-room">${icon('plus')}<span>${t('Create or join a room')}</span></button></div></details>`;
}
function renderRoomSwitch() { document.querySelectorAll('.room-switch').forEach(el => { if (!el.open) el.outerHTML = roomSwitch(); }); }
let roomsKnown = false;
async function loadRoomList() { const list = await pb.send('/api/odyle/rooms', { requestKey: 'room-list' }); rooms = list.rooms || []; gameMaps = list.maps || gameMaps; classIcons = list.classIcons || classIcons; keptDays = list.kept || keptDays; roomsKnown = true; renderRoomSwitch(); noteAchievements(list); }
// The account menu behind the avatar: the account page, pairing, invites, help, what's new and
// signing out. Signed out (or in the demo) the same place offers help and the way back.
function accountMenu() {
  const connection = `<span class="connection ${online || demo ? 'connected' : ''}">${connectionLabel()}</span>`, help = `<button class="menu-item" data-action="help">${icon('shield')}<span>${t('Reader & privacy')}</span></button>`;
  if (demo || !pb.authStore.isValid) return `<div class="account-guest">${phoneItems()}${help}${connection}${demo ? `<button class="button secondary" data-action="exit-demo">${t('Leave the demo')}</button>` : ''}</div>`;
  const name = pb.authStore.record?.displayName || '', item = (action, glyph, label) => `<button class="menu-item" data-action="${action}">${icon(glyph)}<span>${label}</span></button>`;
  return `<details class="account-menu"><summary title="${esc(t('Account menu'))}"><span class="avatar">${esc(name.slice(0, 1).toUpperCase() || 'O')}</span><span class="account-text"><strong>${esc(name)}</strong>${connection}</span><span class="sr-only">${t('Account menu')}</span>${icon('chevron')}</summary><div class="menu">${readerItem()}<a class="menu-item" href="${link('/account')}" data-action="account">${icon('user')}<span>${t('Account & data')}</span></a>${phoneItems()}${item('desktop', 'download', t('Pair Windows app'))}${item('invite', 'plus', t('Invitations'))}${help}<a class="menu-item" href="${link('/changelog')}">${icon('info')}<span>${t('What\'s new')}</span></a>${item('logout', 'out', t('Sign out'))}</div></details>`;
}
// Phones have no sidebar: the pages the bar at the bottom has no room for are in the account
// menu (signed out, beside it), hidden on wide screens, where the sidebar lists them.
const phoneItems = () => pages().filter(([action]) => !phonePages.includes(action)).map(([action, glyph, label]) => `<a class="menu-item phone-only" href="${navHref(action)}" data-action="${action}">${icon(glyph)}<span>${label}</span>${badgeOf(action)}</a>`).join('');
// Phones have no sidebar: the account menu says which PC reads, or offers to connect one.
const readerItem = () => { const reader = readerNow(); return `<button class="menu-item menu-reader ${reader ? 'reader-online' : ''}" data-action="reading">${reader ? `<i></i><span>${esc(readerLabel(reader.name))}</span>` : `${icon('plus')}<span>${t('Connect reader')}</span>`}</button>`; };
// An open menu closes on a click outside it, on a chosen item and on Escape.
document.addEventListener('click', event => document.querySelectorAll('details.room-switch[open], details.account-menu[open]').forEach(menu => { if (!menu.contains(event.target) || event.target.closest('.menu-item')) menu.open = false; }));
document.addEventListener('keydown', event => { if (event.key === 'Escape') document.querySelectorAll('details.room-switch[open], details.account-menu[open]').forEach(menu => { menu.open = false; }); });
// An armory item's or skill's card, open while its tile has focus, closes on Escape too.
document.addEventListener('keydown', event => { if (event.key === 'Escape' && document.activeElement?.matches('.armory-gear-slot, .armory-skill')) document.activeElement.blur(); });
// The card picker's tabs follow the arrow keys, Home and End.
document.addEventListener('keydown', event => {
  const tab = event.target.closest?.('[data-card-tab]'), tabs = tab ? [...tab.parentElement.children] : [];
  const to = { ArrowLeft: tabs.indexOf(tab) - 1, ArrowRight: tabs.indexOf(tab) + 1, Home: 0, End: tabs.length - 1 }[event.key];
  if (!tab || to === undefined || event.altKey || event.ctrlKey || event.metaKey) return;
  event.preventDefault(); const next = tabs[(to + tabs.length) % tabs.length];
  cardTab = next.dataset.cardTab; cardPart.loaded()?.openStudioTab(tab.form, cardTab); next.focus();
});
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
  const home = cls => `<a href="${link('/')}" class="${cls}" aria-label="${esc(t('Odyle home'))}"><span class="brand-symbol">${icon('diamond')}</span><span class="brand-name">odyle<span class="brand-dot">.</span></span></a>`;
  app.innerHTML = `<button class="skip-link" data-action="skip">${t('Skip to content')}</button><aside class="sidebar">${home('brand')}${roomSwitch()}<nav aria-label="${esc(t('Pages'))}">${pages().map(([action, name, label]) => navItem(action, active, name, label)).join('')}</nav><div class="sidebar-foot">${reader}${accountMenu()}</div></aside><header class="topbar">${home('brand brand-mini')}${roomSwitch()}${accountMenu()}</header><div class="main">${announcementBar()}${updateNote()}${content}<footer><span>Odyle <a class="version-link" href="${link('/changelog')}" title="${esc(t('What\'s new'))}">${esc(__APP_VERSION__)}</a></span><span>${t('Unofficial fan project')} · <a class="footer-link" href="${link('/privacy')}">${t('Privacy')}</a></span></footer></div>${bottomNav(active)}<div id="toast" role="status" aria-live="polite"></div><dialog id="modal" aria-labelledby="modal-title"></dialog>`;
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
  shell(`<main class="welcome"><div class="eyebrow"><span class="tiny-diamond"></span> ${t('BUILT FOR YOUR NEXT RUN')}</div><h1>${t('Good runs start<br>with a ready party<span class="mint">.</span>')}</h1><p class="intro">${t('Sign in with Discord. Save the Odyle of every character.<br class="desktop-only"> Create a private room and bring your friends together.')}</p>${code ? inviteLanding(previewed(code)) : ''}${embedded() ? `<p class="join-note in-app-note">${icon('alert')}<span>${t('This page is open in a browser built into another app, where Discord sign-in often fails.')}</span><button class="text-button" data-action="open-elsewhere">${t('Open in your browser')} ${icon('arrow')}</button></p>` : ''}<div class="discord-card"><div class="setup-icon">${icon('people')}</div><h2>${t('One account. Every adventure.')}</h2><p>${t('Your rooms and character readings stay with your Discord account, even after you close the app.')}</p><button class="button discord-button" data-action="discord">${t('Continue with Discord')} ${icon('arrow')}</button><small>${t('First sign-in creates your account. No separate password.')}</small><p class="signin-help" hidden>${t('Continue in the Discord window that opened. Nothing happened?')} <button class="text-button" data-action="open-elsewhere">${t('Open in your browser')}</button></p></div><button class="text-button" data-action="demo">${t('Explore the demo workspace')} ${icon('arrow')}</button><button class="text-button" data-action="armory">${t('Look up a character in the armory')} ${icon('arrow')}</button><button class="text-button" data-action="timers">${t('AION 2 timers: resets and Odyle ticks')} ${icon('arrow')}</button><button class="text-button" data-action="achievements">${t('Achievements to collect')} ${icon('arrow')}</button><p class="welcome-note">${t('No game account needed. No public directory. Just your party.')} <a href="${link('/privacy')}">${t('Privacy')}</a></p>${scopeNote()}</main>`);
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
  shell(`<main class="dashboard"><section class="heading"><div><h1>${t('Rooms & characters')}<span class="mint">.</span></h1><p>${t('Welcome, {name}', { name: esc(pb.authStore.record.displayName) })} · ${t('All your rooms and characters, connected to your Discord account.')}</p></div><div class="heading-actions">${appLink('button secondary')}<button class="button secondary" data-action="desktop">${t('Pair Windows app')} ${icon('arrow')}</button></div></section>${nextRunsSection(nextRunsList, Date.now() + serverOffset)}${weekReadyNote()}<section class="party-section room-section"><div class="section-heading"><h2>${t('Your rooms')} <span>${rooms.length}</span></h2></div><div class="room-list">${roomItems()}</div><details class="room-setup"${rooms.length ? '' : ' open'}><summary>${icon('plus')} ${t('Create or join a room')}</summary><div class="welcome-grid"><form id="create-form" class="setup-card"><h2>${t('Create a private room')}</h2><p>${t('Keep your party together between sessions.')}</p><label>${t('Room name')}<input name="name" maxlength="60" placeholder="${esc(t('The evening expedition'))}" required></label><button class="button primary" type="submit">${t('Create room')} ${icon('arrow')}</button></form><form id="join-form" class="setup-card"><h2>${t('Join your friends')}</h2><p>${t('Paste the invite code, or just open the invite link your friend sent.')}</p><label>${t('Invite code')}<input name="code" class="code-input" autocomplete="off" placeholder="XXXX XXXX XXXX" maxlength="20" required></label><button class="button secondary" type="submit">${t('Join room')} ${icon('arrow')}</button></form></div></details></section><section class="party-section personal-characters"><div class="section-heading"><h2>${t('Your saved characters')} <span>${characters.length}</span></h2>${readerButton(`${icon('plus')} ${t('Connect reader')}`)}</div><div class="member-grid party-list">${characterCards()}</div></section><section class="party-section room-sharing"><div class="section-heading"><h2>${t('Room sharing')}</h2></div><div class="share-matrix">${sharingMatrix()}</div></section></main>`, 'library');
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
function flattened() { return members.flatMap(m => { const added = (m.characters || []).filter(c => c.shared ?? m.sharing); return added.length ? added.map(c => ({ ...c, sharing: true, user: m.user, membershipId: m.id, role: m.role, displayName: m.displayName, look: m.look })) : [{ ...m, id: '', characterName: '', confirmed: false, lastReadingAt: '', source: 'packet' }]; }); }
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
function signature() { const now = Date.now() + serverOffset; return canonical([room, stable(members), board, wishlist, runs, dungeons, catalog, flattened().map(c => status(c, now)), readerNow()?.name ?? null]); }
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
      + (viewer || !plannable || !on('runs') ? '' : `<button data-plan-wish="${esc(listed?.name ?? w.dungeon)}" title="${esc(t('Plan a run of {dungeon}', { dungeon: w.dungeon }))}">${icon('calendar')} ${t('Plan')}</button>`)
      + (manager() ? `<button class="remove" data-clear-wish="${esc(w.dungeon)}" title="${esc(t('Clear {dungeon} for everyone', { dungeon: w.dungeon }))}">${t('Clear')}</button>` : '');
    return `<div class="wish-row ${mine ? 'mine' : ''}"><div class="wish-name"><strong>${esc(w.dungeon)}</strong><small>${esc(tn(count, '{n} member needs it', '{n} members need it'))} · ${esc(wanted(w.since, now))}</small>${facts(w.dungeon)}</div><div class="wish-people">${people}</div><div class="wish-actions">${actions}</div></div>`;
  }).join('');
  return `<section class="party-section wishlist"><div class="section-heading"><h2>${t('Dungeon wishlist')} <span>${wishlist.length}</span></h2><span class="refresh-label">${t('Most wanted first')}</span></div><div class="wish-panel">${form}${rows ? `<div class="wish-list">${rows}</div>` : `<p class="wish-empty">${t('Nothing on the wishlist yet. Add the dungeons you still need so the party can plan its next run.')}</p>`}</div></section>`;
}
// Run now: a call starts its run in about ten minutes, and the server takes one call per room
// every half hour (backend accounts.go callLead, callGap); the form waits as long.
const callLead = 10 * 60000, callWait = 21 * 60000;
// Run now asks first: who the call tells (runready.js callable, as the server counts them).
function callDialog(form, data) {
  const now = Date.now() + serverOffset, start = now + callLead;
  const problem = runProblem({ ...data, startsAt: new Date(start).toISOString() }, { now, catalog: dungeons, runs }); if (problem) return formError(form, problem);
  const n = callable(flattened(), pb.authStore.record?.id, now, start, entryOf(catalog, data.dungeon)?.cost || room?.cost || perCube, clockRules).length;
  modal(esc(t('Call the party to {dungeon}?', { dungeon: data.dungeon })), `<p>${esc(n ? tn(n, 'The run starts in about 10 minutes. The {n} player who plays now or holds a cube is told on the dashboard, in Odyle for Windows and by push, unless it is their quiet hours.', 'The run starts in about 10 minutes. The {n} players who play now or hold a cube are told on the dashboard, in Odyle for Windows and by push, unless it is their quiet hours.') : t('Nobody else plays now or holds a cube. The run is planned anyway and starts in about 10 minutes.'))}</p><button class="button primary" data-confirm-call="${esc(data.dungeon)}" data-note="${esc(data.note || '')}">${icon('bolt')} ${t('Call the party')}</button><button class="button secondary" data-action="close-dialog">${t('Not now')}</button>`);
}
function plannedRuns(now) {
  const suggestions = [...new Set(wishlist.map(w => w.dungeon))], entries = flattened(), cost = room?.cost || perCube;
  // A run counts at its dungeon's own cost when the catalog has one.
  const costOf = r => entryOf(catalog, r.dungeon)?.cost || cost;
  const players = [...new Set(entries.filter(c => c.role !== 'viewer').map(c => c.user))].map(user => broughtBy(user, entries, now).character);
  return runsSection({ runs, members, myId: pb.authStore.record?.id || (demo ? 'dave' : ''), viewer: me()?.role === 'viewer', owner: manager(), live: liveUsers(now), now, suggestions, catalog, perCube: cost, facts: dungeonInfo(now), demo, discord: room?.discordReminders,
    readiness: r => runReadiness(r, entries, now, costOf(r), clockRules), costOf, maintenance, start: clockRules.paused ? null : earliestClaim(players, now, cost, clockRules),
    roles: classRoles, called: runs.some(r => r.called && timestamp(r.startsAt) > now - callWait) });
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
  keepingDrafts(() => shell(`<main class="dashboard tasks-page"><section class="heading"><div><h1>${t('Daily & weekly')}<span class="mint">.</span></h1><p>${esc(t('Your own checklist, saved to your account. Tasks uncheck themselves at the daily reset, {hour}:00 UTC ({local} your time), and at the weekly reset on {day}.', { hour: String(resetHour(resets)).padStart(2, '0'), local, day: t(dayName(resets)) }))} <a class="footer-link" href="${link('/timers')}">${t('All timers')}</a></p></div><span class="refresh-label"><i></i>${t('Private to you')}</span></section>${taskScopes(now)}<div class="task-grid">${taskPanel('daily', now)}${taskPanel('weekly', now)}</div></main>`, 'tasks'));
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
function clearRoom() { room = null; members = []; board = null; wishlist = []; runs = []; dungeons = []; catalog = []; classRoles = []; demo = false; }
// The armory (armory.js): public, signed in or not. The servers come from the backend once;
// the region and server last searched are kept per browser. A profile still waiting for
// PLAYNC asks again when the backend says to, while it stays on screen. Its tabs have their
// own paths but show the profile already fetched; the Daevanion board shown is kept per page.
let armoryServers = null, armoryAnswer = null, armoryResults = null, armoryChosen = null, armoryTimer = 0, armoryTab = '', armoryBoard = '';
const armoryKey = 'odyle.armory';
function armoryChoice() { try { return JSON.parse(storage.getItem(armoryKey)) || {}; } catch { return {}; } }
// Bookmarked characters (#72), in this browser only: no account needed, nothing sent anywhere.
const bookmarksKey = 'odyle.armory.bookmarks';
const bookmarks = () => armoryPart.loaded()?.readBookmarks(storage.getItem(bookmarksKey)) || [];
function keepBookmarks(list) {
  try { storage.setItem(bookmarksKey, JSON.stringify(list)); return true; }
  catch { toast(t('This browser does not let Odyle keep bookmarks.')); return false; }
}
function toggleBookmark() {
  const armory = armoryPart.loaded(); if (!armory || !armoryAnswer?.profile) return;
  const list = bookmarks(), name = armoryAnswer.profile.name, on = armory.isBookmarked(list, armoryAnswer);
  if (!on && list.length >= armory.bookmarkLimit) return toast(t('You can keep up to {n} bookmarks. Remove one first.', { n: armory.bookmarkLimit }));
  if (!keepBookmarks(on ? armory.removeBookmark(list, `${armoryAnswer.region}/${armoryAnswer.serverId}/${armoryAnswer.characterId}`) : armory.addBookmark(list, armoryAnswer, new Date().toISOString()))) return;
  armoryRender(); toast(on ? t('Removed {name} from your bookmarks.', { name }) : t('Bookmarked {name}. The armory page lists it.', { name }));
}
const armoryRefreshable = () => armoryAnswer?.state === 'fresh' && armoryAnswer.fetchedAt && Date.now() + serverOffset - timestamp(armoryAnswer.fetchedAt) > 15 * 60000;
// The armory's images (the game's icons, portraits) come from the backend (armoryimages.go).
const armoryImages = () => pb.buildURL('/api/odyle/armory-images/');
function armoryRender(searching = false) {
  const armory = armoryPart.loaded(); if (!armory) return;
  const chosen = armoryChosen || armoryChoice();
  const now = Date.now() + serverOffset, marks = bookmarks();
  shell(armoryAnswer ? armory.armoryProfile(armoryAnswer, now, armoryRefreshable(), armory.isBookmarked(marks, armoryAnswer), { tab: armoryTab, board: armoryBoard, images: armoryImages() }) : armory.armorySearch(armoryServers || [], chosen, armoryResults, searching, marks, now, armoryImages()), 'armory');
  retitle(armoryTitle(armoryAnswer, armoryTab));
}
// While a profile waits for PLAYNC, it is asked for again when the backend says to.
function armoryPoll(path, ticket) {
  if (armoryAnswer && (armoryPart.loaded()?.waiting(armoryAnswer) || armoryAnswer.state === 'failed')) armoryTimer = setTimeout(() => { if (ticket === navigation) armoryPage(path, ticket).catch(failure); }, Math.max(2, armoryAnswer.retryAfter || 5) * 1000);
}
// A profile's player card (card.js): a page of its own, without the sidebar. The look shown
// is the saved one until its player tries another (cardLook), the picker on the tab last
// opened (cardTab); the card turns until the page is left (animateCard).
let cardLook = {}, cardTab = 'design', cardFlip = null;
function cardRender() {
  const cards = cardPart.loaded(), armory = armoryPart.loaded(); if (!cards || !armory) return;
  app.innerHTML = cards.cardPage(armoryAnswer, { images: armoryImages(), look: cardLook, tab: cardTab, status: armoryAnswer.profile ? '' : armory.lookupStatus(armoryAnswer, Date.now() + serverOffset, false) });
  retitle(cards.cardTitle(armoryAnswer));
  const card = app.querySelector('.tcg');
  cardFlip = card ? cards.animateCard(card) : null;
}
// Another look tried on the card on screen, without drawing it again (it keeps turning).
function cardPreview(form) {
  const cards = cardPart.loaded(); if (!cards) return;
  cardLook = cards.formLook(form);
  const look = cards.lookOf(armoryAnswer, cardLook), card = app.querySelector('.tcg'), page = app.querySelector('.card-page');
  if (card) {
    const turning = [...card.classList].filter(c => c.startsWith('is-'));
    card.className = [cards.cardClasses(look), ...turning].join(' ');
    card.querySelector('.tcg-body').innerHTML = cards.cardFaces(armoryAnswer, armoryImages(), look);
  }
  if (page) page.className = 'card-page design-' + look.design;
  cards.studioAbout(form);
  const save = form.querySelector('[type="submit"]'); if (save) save.disabled = cards.sameLook(look, cards.lookOf(armoryAnswer));
}
async function cardShow(path, target, ticket) {
  const { region, serverId, characterId } = target;
  const same = armoryAnswer && armoryAnswer.region === region && String(armoryAnswer.serverId) === serverId && armoryAnswer.characterId === characterId;
  if (!same) cardLook = {};
  let answer;
  // The card's page (card.js) loads with it.
  try { [answer] = await Promise.all([pb.send(`/api/odyle/armory/${region}/${serverId}/${characterId}`), cardPart()]); }
  catch (error) { if (ticket !== navigation) return; if (error?.status !== 404) throw error; armoryAnswer = armoryResults = null; armoryRender(); return toast(t(error.message)); }
  if (ticket !== navigation) return;
  // The same card again (a lookup still waiting for PLAYNC): drawn again only once its profile changed.
  const unchanged = same && armoryTab === 'card' && document.querySelector('.tcg') && JSON.stringify(answer.profile) === JSON.stringify(armoryAnswer.profile);
  online = true; armoryAnswer = answer; armoryTab = 'card';
  if (!unchanged) cardRender();
  armoryPoll(path, ticket);
}
async function armoryPage(path, ticket, refresh = false) {
  clearTimeout(armoryTimer);
  // The armory's pages (armory.js) load with the first of them, beside the servers.
  const [armory] = await Promise.all([armoryPart(), armoryServers || pb.send('/api/odyle/armory/servers').then(answer => { armoryServers = answer.regions; })]);
  if (ticket !== navigation) return;
  const target = armoryTarget(path);
  if (target.card) return cardShow(path, target.card, ticket);
  if (target.profile) {
    const { region, serverId, characterId, tab } = target.profile;
    const same = armoryAnswer && armoryAnswer.region === region && String(armoryAnswer.serverId) === serverId && armoryAnswer.characterId === characterId;
    // Another tab of the profile on screen: shown at once, from what was fetched.
    if (same && tab !== armoryTab && !refresh) { armoryTab = tab; armoryRender(); return armoryPoll(path, ticket); }
    if (!same) armoryBoard = '';
    armoryTab = tab;
    let answer;
    try { answer = await pb.send(`/api/odyle/armory/${region}/${serverId}/${characterId}`, refresh ? { query: { refresh: 1 } } : {}); }
    catch (error) { if (ticket !== navigation) return; if (error?.status !== 404) throw error; armoryAnswer = armoryResults = null; armoryRender(); return toast(t(error.message)); }
    if (ticket !== navigation) return;
    // The same profile again (a lookup's progress): only the status line changes, so an item
    // card open on hover or focus stays.
    const unchanged = same && !refresh && document.querySelector('.armory-status') && answer.partial === armoryAnswer.partial && JSON.stringify(answer.profile) === JSON.stringify(armoryAnswer.profile);
    online = true; armoryAnswer = answer;
    if (answer.profile && !answer.partial && armory.isBookmarked(bookmarks(), answer)) keepBookmarks(armory.refreshBookmark(bookmarks(), answer));
    if (unchanged) document.querySelector('.armory-status').outerHTML = armory.lookupStatus(answer, Date.now() + serverOffset, armoryRefreshable());
    else armoryRender();
    return armoryPoll(path, ticket);
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
// The privacy notice (#/privacy, privacy.js), open to anyone; its text loads with it.
const privacyRender = () => { const notice = privacyPart.loaded(); if (notice) shell(notice.privacyNotice(), 'privacy'); };
async function privacyShow(ticket) { await privacyPart(); if (ticket === navigation) privacyRender(); }
// What's new (#/changelog): the changelog, which loads with the page, and the newest Windows
// release's changes.
function changelogRender() {
  const news = whatsnewPart.loaded(); if (!news) return;
  const app = windowsApp(windowsRelease);
  shell(news.whatsNew(news.changelog, __APP_VERSION__, app.version ? { ...app, changes: windowsRelease?.latest?.changes || [] } : null), 'changelog');
}
async function changelogPage(ticket) {
  await whatsnewPart(); if (ticket !== navigation) return;
  seenVersion(); changelogRender();
  await loadWindowsRelease();
  if (ticket === navigation) changelogRender();
}
// The timers (/timers, timers.js): the game's resets, the Odyle clock and the dungeon catalog,
// open to anyone. While the page is shown its countdowns tick every second, it is drawn again
// once one of them passes and the rules are fetched again every ten minutes.
let timersGame = null, timersAt = 0, timersFailed = false, timersTimer = 0, timersDrawn = '';
const timersNow = () => Date.now() + serverOffset;
function timersRender() {
  const timers = timersPart.loaded(); if (!timers) return;
  const now = timersNow();
  timersDrawn = JSON.stringify(timers.timerTargets(timersGame, now));
  shell(timers.timersView({ game: timersGame, now, signedIn: pb.authStore.isValid && !demo, failed: timersFailed }), 'timers');
}
async function loadTimers() {
  timersAt = Date.now();
  try {
    const game = await pb.send('/api/odyle/game', { requestKey: 'timers' });
    timersGame = game; timersFailed = false;
    if (game.serverNow) serverOffset = Date.parse(game.serverNow) - Date.now();
    if (!online) { online = true; renderConnection(); }
  } catch (error) { timersFailed = !timersGame; throw error; }
}
async function timersPage(ticket) {
  // The page (timers.js) loads with its first visit.
  await timersPart(); if (ticket !== navigation) return;
  timersRender();
  clearInterval(timersTimer); timersTimer = setInterval(timersTick, 1000);
  try { await loadTimers(); } finally { if (ticket === navigation) timersRender(); }
}
function timersTick() {
  if (shown !== '/timers') { clearInterval(timersTimer); timersTimer = 0; return; }
  const timers = timersPart.loaded();
  if (document.hidden) return;
  const stale = Date.now() - timersAt > (timersGame ? 600000 : 15000);
  if (stale) loadTimers().then(() => { if (shown === '/timers') timersRender(); }).catch(() => { if (shown === '/timers' && !timersGame) timersRender(); });
  if (!timersGame || !timers) return;
  const now = timersNow();
  if (JSON.stringify(timers.timerTargets(timersGame, now)) !== timersDrawn) return timersRender();
  document.querySelectorAll('[data-timer]').forEach(el => { el.textContent = timers.timerText(Number(el.dataset.timer) - now); });
}
// Achievements (/achievements, achievements.js): signed in the account's own, brought up to date
// and marked seen; signed out what there is to reach. The navigation counts those reached since
// the last look (from the rooms list and the account's news).
let achievementsData = null, achievementsFailed = false, achievementsNew = 0;
const achievementBadge = () => achievementsNew > 0 && pb.authStore.isValid && !demo ? `<span class="nav-badge" aria-hidden="true">${achievementsNew}</span><span class="sr-only"> (${esc(t('{n} new', { n: achievementsNew }))})</span>` : '';
function renderAchievementBadge() { document.querySelectorAll('a[data-action="achievements"]').forEach(el => { el.querySelector('.nav-badge')?.remove(); el.querySelector('.sr-only')?.remove(); el.insertAdjacentHTML('beforeend', achievementBadge()); }); }
function noteAchievements(list) { if (list?.achievements && shown !== '/achievements') { achievementsNew = list.achievements.new || 0; renderAchievementBadge(); } }
function achievementsRender() { const page = achievementsPart.loaded(); if (page) shell(page.achievementsView({ data: achievementsData, signedIn: pb.authStore.isValid && !demo, failed: achievementsFailed }), 'achievements'); }
async function loadAchievements() {
  const signedIn = pb.authStore.isValid && !demo;
  try {
    achievementsData = signedIn ? await send('achievements') : await pb.send('/api/odyle/achievements', { requestKey: 'achievements' });
    achievementsFailed = false;
    if (signedIn) { achievementsNew = 0; renderAchievementBadge(); }
  } catch (error) { achievementsFailed = !achievementsData; throw error; }
}
async function achievementsPage(ticket) {
  if (achievementsData && Boolean(achievementsData.counts) !== (pb.authStore.isValid && !demo)) achievementsData = null;
  // The page (achievements.js) loads with its first visit, or with the first achievement reached.
  await achievementsPart(); if (ticket !== navigation) return;
  achievementsRender();
  try { await loadAchievements(); } finally { if (ticket === navigation) achievementsRender(); }
}
// Achievements reached meanwhile: a message of their own (beside the page's, which it never
// hides), the count in the navigation and, on the page, the page again.
let achievementTimer = 0;
function achievementNotice(text) {
  let el = document.querySelector('#achievement-toast');
  if (!el) {
    el = document.createElement('div'); el.id = 'achievement-toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    el.addEventListener('click', () => el.classList.remove('show')); document.body.append(el);
  }
  el.innerHTML = `<span class="achievement-toast-sign" aria-hidden="true">🏆</span><p>${esc(text)}</p><a href="${link('/achievements')}">${t('See')}</a>`;
  el.classList.add('show'); clearTimeout(achievementTimer); achievementTimer = setTimeout(() => el.classList.remove('show'), 8000);
}
async function reachedAchievements(notices) {
  achievementNotice((await achievementsPart()).reachedText(notices));
  if (shown === '/achievements') { if (!later()) { await loadAchievements(); achievementsRender(); } return; }
  achievementsNew += notices.length; renderAchievementBadge();
}
// Your week in Odyle (/week, week.js): the account's reset week, this one or one before (weekBack;
// the server picks the week before while this one is under two days old). Its picture and text
// to share are made here and go nowhere unless the player posts them.
let weekData = null, weekFailed = false, weekBack = null;
const canShareFiles = () => { try { return typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([''], 'week.png', { type: 'image/png' })] }); } catch { return false; } };
function weekRender() { const week = weekPart.loaded(); if (week) shell(week.weekView({ data: weekData, now: Date.now() + serverOffset, failed: weekFailed, canShare: canShareFiles() }), 'week'); }
async function loadWeek() {
  try {
    weekData = await pb.send('/api/odyle/week', { requestKey: 'week', query: weekBack === null ? {} : { week: weekBack } });
    weekBack = weekData.week.back; weekFailed = false;
    if (weekData.serverNow) serverOffset = Date.parse(weekData.serverNow) - Date.now();
    if (weekData.week.back >= 1) seenWeek(weekData.week.from);
  } catch (error) { weekFailed = !weekData; throw error; }
}
async function weekPage(ticket) {
  await leaveRoomTopic(); clearRoom();
  if (weekData && weekData.week.back !== weekBack) weekData = null;
  // The page (week.js) loads with its first visit.
  await weekPart(); if (ticket !== navigation) return;
  weekRender();
  try { await loadWeek(); } finally { if (ticket === navigation) weekRender(); }
}
// After the weekly reset, Rooms & characters says the week before is summed up, until it is
// opened or put away (odyle.weekSeen: the start of the last week seen, as a date).
const weekSeenKey = 'odyle.weekSeen';
const lastWeekStart = () => periodStart('weekly', Date.now() + serverOffset, resets) - 7 * 86400000;
function seenWeek(from) { try { storage.setItem(weekSeenKey, new Date(timestamp(from)).toISOString().slice(0, 10)); } catch { /* storage blocked */ } }
function weekReadyNote() {
  const start = lastWeekStart(), key = new Date(start).toISOString().slice(0, 10);
  if (!characters.some(c => c.lastReadingAt && timestamp(c.lastReadingAt) >= start) || storage.getItem(weekSeenKey) === key) return '';
  return `<div class="week-ready" role="status">${icon('chart')}<p><strong>${t('Your week in Odyle is ready')}</strong><span>${esc(weekDates(start, start + 7 * 86400000))} · ${t('Cubes, regeneration, what was lost at the cap and a picture to share.')}</span></p><div class="week-ready-actions"><button class="button primary" data-action="week-ready">${t('See your week')} ${icon('arrow')}</button><button class="text-button" data-action="week-later" data-week="${key}">${t('Not now')}</button></div></div>`;
}
const saveBlob = (blob, name) => { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000); };
async function weekPicture() {
  const { weekSummary, weekImage } = weekPart.loaded(), summary = weekSummary(weekData, Date.now() + serverOffset), blob = await weekImage(summary, address('/'));
  if (!blob) throw new Error('This browser could not draw the picture.');
  return { summary, blob };
}
// The slot machine (#107, slots.js): the logo clicked seven times within three seconds opens it.
let slotState = null, slotSpinning = false, slotLast = null, logoClicks = [];
// The machine's sounds, on unless this browser turned them off (sounds.js).
const slotSoundKey = 'odyle.slotSound', slotSound = () => { try { return storage.getItem(slotSoundKey) !== 'off'; } catch { return true; } };
function slotsRender() { const machine = slotsPart.loaded(); if (machine) shell(machine.slotsView({ state: slotState, spinning: slotSpinning, last: slotLast, name: pb.authStore.record?.displayName || '', sound: slotSound() }), 'slots'); }
async function slotsPage(ticket) {
  slotLast = null; await slotsPart(); if (ticket !== navigation) return; slotsRender();
  const state = await send('slots');
  if (ticket !== navigation) return;
  slotState = state; slotsRender();
}
async function spinSlot() {
  const machine = slotsPart.loaded();
  if (!machine || slotSpinning || !slotState || slotState.spins < 1) return;
  slotSpinning = true; slotLast = null; slotsRender();
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches, sound = slotSound();
  if (sound && !still) machine.playSpin(1400);
  try {
    const [result] = await Promise.all([send('slot-spin'), new Promise(done => setTimeout(done, still ? 0 : 1400))]);
    slotState = result; slotLast = { won: result.won, duplicate: result.duplicate, lost: Boolean(result.lost), seed: Math.floor(Math.random() * 64) };
    if (sound) { if (result.lost) machine.playLose(); else machine.playWin(result.won?.rarity); }
  } finally { slotSpinning = false; if (shown === '/slots') slotsRender(); }
}
document.addEventListener('click', e => {
  if (!e.target.closest?.('a.brand') || !pb.authStore.isValid || demo) return;
  const now = Date.now(); logoClicks = [...logoClicks.filter(at => now - at < 3000), now];
  if (logoClicks.length >= 7) { logoClicks = []; e.preventDefault(); go('/slots'); }
});
async function tasksPage(ticket) {
  await leaveRoomTopic(); clearRoom(); editingTask = '';
  await refreshTasks(); if (ticket !== navigation) return; tasksView();
}
// The account page redraws when its apps change or go online, late or offline; ages tick in place.
const contactState = at => { const quiet = Date.now() + serverOffset - timestamp(at); return quiet < 45000 ? 'online' : quiet < 90000 ? 'late' : 'offline'; };
const accountSignature = () => canonical([account?.account, account?.characters, account?.apps.map(a => [a.sessionId, a.character, a.device, contactState(a.lastContactAt)]), account?.devices?.map(d => [d.id, d.name])]);
function accountRender() { const page = accountPart.loaded(); if (!page || !account) return; renderedAccount = accountSignature(); keepingDrafts(() => shell(page.accountView({ ...account, notifications: account.notifications || defaultNotifications, reminders: reminderState(), push: { state: pushHere, devices: account.push?.devices || [] }, now: Date.now() + serverOffset, calendarLink }), 'account')); }
// The calendar feed's address, shown once after it was made (#35).
let calendarLink = '';
async function refreshAccount() {
  const data = await pb.send('/api/odyle/account');
  if (shown !== '/account') return;
  account = data; serverOffset = Date.parse(data.serverNow) - Date.now(); online = true;
  await checkPush().catch(() => { pushHere = 'unsupported'; });
}
async function accountPage(ticket) {
  await leaveRoomTopic(); clearRoom();
  await Promise.all([refreshAccount(), accountPart()]); if (ticket !== navigation) return; accountRender();
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
  // The parts of the room its owner left on (Room settings → Room features).
  const columns = (on('runs') ? plannedRuns(now) : '') + (on('wishlist') ? wishlistSection(now) : '');
  const hidden = actual.length - shown.length, actions = `${demo ? `<span class="demo-tag">${t('Sample data')}</span>` : ''}${manager() ? `<button class="button primary" data-action="invite">${icon('plus')} ${t('Invite')}</button>` : ''}<button class="button secondary" data-action="room-settings">${icon('gear')} ${owner() ? t('Settings') : t('Room')}</button>`;
  // Room changes redraw the whole page; keep half-typed wishlist and run entries and their focus.
  keepingDrafts(() => shell(`<main class="dashboard room-page"><section class="heading"><div><h1>${esc(room.name)}</h1><p>${esc(tn(members.length, '{n} member', '{n} members'))} · ${esc(tn(actual.length, '{n} character in this room', '{n} characters in this room'))} · ${esc(t('{cost} Odyle per cube', { cost: room.cost }))}${focus && focus.cost !== room.cost ? ' · ' + esc(t('next run {dungeon}: {cost} Odyle per cube', focus)) : ''}</p>${demo || !on('week') ? '' : weekLine(roomWeek)}</div><div class="heading-actions">${actions}</div></section>${on('board') ? boardSection(board, { canEdit: manager(), name: id => id === pb.authStore.record?.id ? t('You') : members.find(m => m.user === id)?.displayName || '', now }) : ''}${partySummary(explained, now, { estimated, focus })}<section class="party-section"><div class="section-heading"><h2>${t('Party characters')} <span>${actual.length}</span></h2><span class="section-tools"><button class="chip-toggle" data-action="live-only" aria-pressed="${liveOnly()}">${t('Live only')}</button></span></div>${demo ? '' : addBar()}<div class="member-grid party-list">${shown.length ? listHead() : ''}${playerGroups(shown, now, counted, cost)}${liveOnly() && hidden ? `<p class="wish-note live-only-note">${esc(tn(hidden, '{n} character not live is hidden', '{n} characters not live are hidden'))}</p>` : ''}</div></section>${columns ? `<div class="room-columns">${columns}</div>` : ''}</main>`));
}
// The party's characters grouped by the player whose account owns them, under that player's
// name, look, leader crown and character count; the owner removes a player from here. Players
// in one party or one force in the game stand together in a band (inGame).
function playerGroups(shown, now, counted, cost) {
  let index = 0;
  const players = list => tn(list.length, '{n} player', '{n} players');
  const band = (kind, label, count, inner) => `<div class="game-band is-${kind}" role="group" aria-label="${esc(label)}"><p class="band-label">${icon(kind === 'force' ? 'shield' : 'people')}<span>${esc(label)}</span><span class="band-count">${esc(count)}</span></p>${inner}</div>`;
  const party = p => band('party', t('In one party in game'), players(p.players), p.players.map(section).join(''));
  return inGame(byPlayer(shown, demo ? null : pb.authStore.record?.id), now).map(item => item.force
    ? band('force', t('In one force in game'), players(item.parts.flatMap(p => p.players || [p.player])), item.parts.map(p => p.party ? party(p) : section(p.player)).join(''))
    : item.party ? party(item) : section(item.player)).join('');
  function section(group) {
    const p = group[0], ready = group.filter(c => readinessOf(c, now, cost).ready).length, you = p.user === pb.authStore.record?.id && !demo;
    const leader = p.role === 'owner' ? `<span class="leader-label" title="${esc(t('Room leader'))}">${icon('crown')}<span class="sr-only">${t('leader')}</span></span>` : '';
    const remove = owner() && p.membershipId && p.role !== 'owner' && !demo ? `<button class="remove" data-remove="${esc(p.membershipId)}" data-name="${esc(p.displayName)}" title="${esc(t('Remove {name} from this room', { name: p.displayName }))}">${t('Remove')}</button>` : '';
    const count = [tn(group.length, '{n} character', '{n} characters'), ready ? tn(ready, '{n} ready', '{n} ready') : ''].filter(Boolean).join(' · ');
    const head = `<div class="group-head"><span class="group-name">${lookName(p.displayName, p.look)}</span>${leader}${you ? `<span class="group-you">${t('You')}</span>` : ''}<span class="group-count">${esc(count)}</span>${remove ? `<span class="card-actions">${remove}</span>` : ''}</div>`;
    return `<section class="party-group" aria-label="${esc(p.displayName)}">${head}${group.map(c => card(c, index++, counted, cost)).join('')}</section>`;
  }
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
    : self && !room ? `${c.id ? mainToggle(c) : ''}<button data-character="${esc(c.id || '')}" data-action="reading">${t('Reader')}</button>${c.id ? `<button class="remove" data-delete-character="${esc(c.id)}" data-name="${esc(c.characterName)}" title="${esc(t('Delete {name} from your account', { name: c.characterName }))}">${t('Delete')}</button>` : ''}` : '';
  // The profile itself once the daily lookup found the character on PLAYNC, else a search by name.
  const armoryPath = officialPath(c) || (c.characterName && /^[A-Za-z]{2,20}$/.test(c.server || '') && /^GLOBAL_(NAW?|EU|SA|ASIA)$/.test(c.region || '') ? findPath(c.region, c.server, c.characterName) : '');
  const armory = !demo && armoryPath ? `<a class="card-link icon-only" href="${esc(link(armoryPath))}" title="${esc(t('Gear and stats of {name} on PLAYNC', { name: c.characterName }))}">${icon('search')}<span class="sr-only">${t('Armory')}</span></a>` : '';
  // A packet reading needs no label; samples, old manual values and characters waiting for the game say so.
  const source = demo ? t('Sample') : c.source === 'packet' ? '' : c.source === 'manual' ? t('Legacy manual') : t('Waiting for game');
  // The player's name, look (#107) and crown head their group (playerGroups).
  const where = [c.server, regionLabel(c.region)].filter(Boolean).join(' ');
  const meta = [classOf(c), where].filter(Boolean).map(esc).join(' · '), clock = known && clockOf(c, now, clockRules);
  // Where the character was last seen, when its player shares it (places.js).
  const place = demo ? '' : placeButton(c, gameMaps, now);
  const counts = counted?.has(c.id) ? `<span class="counts-for" title="${esc(t('Counts for {name}', { name: c.displayName }))}">${icon('diamond')}${t('counts')}</span>` : '';
  const changed = `${source ? `${source} · ` : ''}${known ? `${t('changed')} <span data-age="${esc(c.lastReadingAt)}">${age(c.lastReadingAt, now)}</span>` : t('Not confirmed')}`;
  // Orange two days before the natural pool is full, red once it is or within the hour.
  const level = capLevel(clock, now), flag = level === 'soon' ? [t('Nearly full'), t('Its natural pool is full within two days: spend Odyle before regeneration is lost.')]
    : level ? [!clock.full ? t('Full within the hour') : clock.settled ? t('Full') : t('Full at {cap}?', { cap: clock.cap.toLocaleString(locale()) }), t('Its natural pool is full, or will be within the hour: each tick after that is lost.')] : null;
  return `<article class="member-card ${ready ? 'is-ready' : ''} ${state === 'offline' ? 'is-offline' : ''} ${c.main ? 'is-main' : ''} ${level ? `cap-${level}` : ''}"><div class="row-id">${portrait(c, index)}<div class="card-id"><div class="member-name"><span class="name-text">${esc(c.characterName || c.displayName)}</span>${c.main ? `<span class="main-label" title="${esc(t('Main character of {name}', { name: c.displayName }))}">${icon('star')}<span class="main-word">${t('Main')}</span></span>` : ''}</div><div class="member-meta"${classOf(c) ? ` title="${esc(t('Class and level from PLAYNC, checked daily'))}"` : ''}>${demo ? '' : classBadge(armoryImages(), classIcons[c.className], c.className)}${meta}</div>${place}</div></div>`
    + `<div class="row-state"><span class="status ${state}"><i></i>${labels[state]}</span>${c.characterName && !fresh ? `<span class="status-why">${esc(statusReason(c, now))}</span>` : ''}</div>`
    + `<div class="row-energy"><div class="energy"><strong>${known ? c.value.toLocaleString(locale()) : '—'}</strong><span>${t('Odyle')}</span></div><div class="energy-track"><i style="width:${known ? Math.min(100, c.value / (cost * 8) * 100) : 0}%"></i></div>${known && c.parts ? `<div class="energy-split">${esc(t('natural {base} · items {bonus}', { base: c.parts.base.toLocaleString(locale()), bonus: c.parts.bonus.toLocaleString(locale()) }))}</div>` : ''}<div class="row-changed">${locked ? t('No Odyle yet · it unlocks at level 22') : changed}</div></div>`
    + `<div class="row-clock">${flag ? `<span class="cap-flag" title="${esc(flag[1])}">${icon('alert')}${esc(flag[0])}</span>` : ''}${clock ? `<div class="energy-clock">${esc(clockLine(clock, now, fresh))}</div>` : ''}${self && capMismatch(c) ? `<div class="energy-clock cap-mismatch">${esc(t('Its natural pool held {max}, more than {cap}: has the membership started? Account & data → Membership.', { max: c.naturalMax.toLocaleString(locale()), cap: c.answeredCap.toLocaleString(locale()) }))}</div>` : ''}</div>`
    + `<div class="row-cubes cube-line">${known ? `<span><strong>${cubes}</strong> ${esc(tn(cubes, 'cube', 'cubes'))}</span>` : `<span>${locked ? t('No Odyle yet') : t('No confirmed reading')}</span>`}<span class="readiness ${ready ? 'ready' : ''}">${ready ? t('Ready') : fresh ? t('Low energy') : known ? t('last saved') : ''}</span>${counts}</div>`
    + `<div class="card-actions">${armory}${history}${action}</div></article>`;
}
// The star on a saved character in the library: marks it as the account's main, or clears the mark.
const mainToggle = c => `<button class="icon-only main-toggle" data-main-character="${esc(c.id)}" data-name="${esc(c.characterName)}" data-main="${!c.main}" aria-pressed="${Boolean(c.main)}" title="${esc(c.main ? t('{name} is your main character. Click to unmark it.', { name: c.characterName }) : t('Make {name} your main character', { name: c.characterName }))}">${icon('star')}<span class="sr-only">${t('Main character')}</span></button>`;
let toastTimer;
function toast(message) { const el = document.querySelector('#toast'); if (!el) return; el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 6000); }
// A failed form also says why inside the form, next to what has to change, for screen
// readers (role=alert) and for anyone who missed the toast.
function formError(form, message) { form.querySelector('.form-error')?.remove(); form.insertAdjacentHTML('beforeend', `<p class="form-error" role="alert">${esc(message)}</p>`); }
// Backend and SDK errors arrive in English; t() shows them in the page's language.
const failed = error => toast(t(error?.message || 'Request could not be completed.'));
// The dialog keeps its title and close button in view: only its body scrolls. The same dialog
// drawn again (a countdown, a saved change) keeps where its reader scrolled to. `wide` is
// true or the dialog's classes.
function modal(title, body, wide = false) {
  const el = document.querySelector('#modal'), again = el.open && el.dataset.title === title ? el.querySelector('.modal-body')?.scrollTop || 0 : 0;
  el.className = wide === true ? 'wide' : wide || ''; el.dataset.title = title;
  el.innerHTML = `<div class="modal-head"><h2 id="modal-title">${title}</h2><button data-action="close-dialog" class="close-button" aria-label="${esc(t('Close dialog'))}">×</button></div><div class="modal-body">${body}</div>`;
  if (!el.open) el.showModal();
  if (again) el.querySelector('.modal-body').scrollTop = again;
}
// Draws a part of the open dialog again (html is the whole part) and puts the focus back on
// the pager button the reader used, or on the page number when that button now leads nowhere.
function redraw(selector, html, used) {
  const part = document.querySelector('#modal ' + selector);
  if (!part) return;
  const step = used?.closest?.('.pager') ? `.pager-step.${used.classList.contains('newer') ? 'newer' : 'older'}${used.classList.contains('edge') ? '.edge' : ':not(.edge)'}` : '';
  part.outerHTML = html;
  const fresh = document.querySelector('#modal ' + selector);
  if (!step || !fresh) return;
  const again = fresh.querySelector(step), at = fresh.querySelector('.pager-at');
  if (again && !again.disabled) again.focus(); else if (at) { at.tabIndex = -1; at.focus(); }
}
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
  // The dialog (invitedialog.js) loads with its first opening.
  const dialog = await invitesPart(); if (!room || !manager()) return;
  const id = room.id, now = Date.now() + serverOffset, draw = ++inviteDraws, askedAt = Date.now();
  modal(t('Invite another Discord account'), dialog.inviteDialogBody(listed ? dialog.withCodes(storage, id, listed, now) : null, address('/'), now));
  if (listed) return;
  const answer = (await pb.send('/api/odyle/invites/' + id)).invites;
  if (draw === inviteDraws) drawInvites(id, answer, askedAt);
}
function drawInvites(id, listed, since) {
  const slot = document.querySelector('#modal[open] .invite-list'), now = Date.now() + serverOffset, dialog = invitesPart.loaded(); inviteDraws++;
  if (slot && dialog && room?.id === id) slot.innerHTML = dialog.inviteList(dialog.withCodes(storage, id, listed, now, since), address('/'), now);
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
// Owners rename the room, change roles, turn its features on and off, hand it over, remove
// members and close it; other members can leave. Every change asks the server and redraws
// this dialog.
function roomSettings() {
  if (demo) return signInPrompt(t('This workspace uses sample data. Sign in with Discord to manage your own rooms.'));
  // The Discord reminders (discord.js) load with the dialog's first opening.
  if (!discordPart.loaded()) { const id = room?.id; discordPart().then(() => { if (id && room?.id === id) roomSettings(); }, failure); return; }
  // One section per subject; the one that cannot be undone comes last.
  const section = (title, body, cls = '') => `<section class="modal-section ${cls}">${title ? `<h3 class="modal-sub">${title}</h3>` : ''}${body}</section>`;
  // New characters this member saves can reach this room by themselves.
  const newOnes = section(t('Your new characters'), `<p>${t('Characters you save from now on start private. With this on, they are shared in this room by themselves.')}</p><div class="share-rooms">${shareNewChip(room.id, room.name, me()?.shareNew, me()?.role === 'viewer', t('Share them in this room'))}</div>`);
  // Officers keep the Discord reminders too.
  const discordSection = me()?.role === 'officer' ? section('', discordSettings()) : room.discordReminders ? section(t('Discord reminders'), `<p>${t('The room owner posts planned runs to a Discord channel 15 minutes before they start.')}</p>`) : '';
  if (!owner()) return modal(esc(room.name), newOnes + discordSection + section(t('Leave this room'), `<p>${esc(t('You are a {role} in this room. Leaving removes your access, your wishlist entries and your place on planned runs; your characters stay on your account.', { role: roleName(me()?.role) }))}</p><button class="button danger" data-action="leave-room">${t('Leave this room')}</button>`, 'danger-zone'), true);
  const myId = pb.authStore.record?.id, listed = [...members].sort((a, b) => (b.user === myId) - (a.user === myId));
  const rows = listed.map(m => m.user === myId ? `<div class="member-row"><div><strong>${esc(m.displayName)}</strong><small>${t('Leader (you)')}</small></div></div>`
    : `<div class="member-row"><div><strong>${esc(m.displayName)}</strong></div><select data-role="${esc(m.id)}" aria-label="${esc(t('Role of {name}', { name: m.displayName }))}"><option value="reporter" ${m.role === 'reporter' ? 'selected' : ''}>${t('Player')}</option><option value="officer" ${m.role === 'officer' ? 'selected' : ''}>${t('Officer')}</option><option value="viewer" ${m.role === 'viewer' ? 'selected' : ''}>${t('Viewer')}</option></select><button data-transfer="${esc(m.id)}" data-name="${esc(m.displayName)}">${t('Make leader')}</button><button class="remove" data-remove="${esc(m.id)}" data-name="${esc(m.displayName)}">${t('Remove')}</button></div>`).join('');
  modal(t('Room settings'), section(t('Room name'), `<form id="rename-form" class="rename-form"><label><span class="sr-only">${t('Room name')}</span><input name="name" maxlength="60" required value="${esc(room.name)}"></label><button class="button secondary" type="submit">${t('Rename')}</button></form>`)
    + section(`${t('Members')} <span class="modal-count">${members.length}</span>`, `<p>${t('Players share characters and plan runs; officers also invite, change any run and keep the Discord reminders; viewers only watch. A member made viewer stops sharing here.')}</p><div class="member-rows">${rows}</div>`)
    + section('', featuresForm(room)) + section('', discordSettings()) + newOnes
    + section(t('Close this room'), `<p>${t('This deletes the room with its wishlist and planned runs for every member. Characters stay on their accounts. It cannot be undone.')}</p><button class="button danger" data-action="close-room">${t('Close this room')}</button>`, 'danger-zone'), true);
}
// Room features the owner chose to change, while Room settings asks before planned runs go.
let pendingFeatures = null;
async function saveFeatures(features) {
  const id = room.id, result = await send('room-features', { roomId: id, features });
  // Planned runs turned off took the room's runs with them; what comes back on arrives with the next snapshot.
  if (changedRoom(id, () => { room = result.room; if (features.runs === false) runs = []; })) roomSettings();
  toast(result.cancelled ? tn(result.cancelled, 'Room features saved. {n} planned run was cancelled.', 'Room features saved. {n} planned runs were cancelled.') : t('Room features saved.'));
}
// The owner connects a Discord channel and chooses when runs are posted there (discord.js).
const discordSettings = () => discordPart.loaded().discordSettings(room, Date.now() + serverOffset, remindersPaused, !on('runs'));
// The history dialog (history.js): the period the reader picks (30 days at first, up to as long
// as the server keeps it), its chart, its weeks and its changes a page at a time. An answer of
// more than 1,000 changes is thinned, so its pages come from the server; otherwise from it.
const changesPerPage = 15;
let historyView = null;
async function historyDialog(id, name) {
  historyView = { id, name, week: 1 };
  await showHistory(0, null, true);
}
async function showHistory(days = 0, used = null, opening = false) {
  const view = historyView, part = opening ? null : document.querySelector('#modal[open] .history-dialog'), ask = view.ask = (view.ask || 0) + 1;
  part?.classList.add('is-loading');
  try {
    // The dialog (history.js) loads with its first opening; the demo's history with the demo.
    const [data] = await Promise.all([demo ? demoPart().then(sample => sample.demoHistory(members, view.id, days || 30)) : pb.send('/api/odyle/history/' + view.id + (days ? '?days=' + days : '')), historyPart()]);
    const changes = await changesOf(view, data, 1);
    if (historyView !== view || view.ask !== ask) return;
    if (!demo && data.serverNow) serverOffset = Date.parse(data.serverNow) - Date.now();
    Object.assign(view, { data, changes, week: 1 });
    const body = historyHtml();
    if (part) redraw('.history-dialog', `<div class="history-dialog">${body}</div>`, used); else modal(esc(t('{name} · Odyle history', { name: view.name })), `<div class="history-dialog">${body}</div>`, 'wide split');
    historyPart.loaded().bindHistoryChart(document.querySelector('#modal .history-chart'));
    if (used?.dataset?.historyDays) document.querySelector(`#modal [data-history-days="${used.dataset.historyDays}"]`)?.focus();
  } finally { part?.classList.remove('is-loading'); }
}
// A page of the changes: from the answer when it lists each one, else from the server.
async function changesOf(view, data, page) {
  if (!data.hourlyBefore) return historyPart.loaded().changesPage(data.readings, page, changesPerPage);
  return pb.send(`/api/odyle/history/${view.id}/changes?days=${data.days}&page=${page}&perPage=${changesPerPage}`);
}
const historyNow = () => Date.now() + serverOffset;
const historyHtml = () => historyPart.loaded().historyBody({ data: { days: 30, ...historyView.data }, changes: historyView.changes, week: historyView.week, now: historyNow(), cost: room?.cost || perCube, resets, clock: historyView.data.clock || clockRules });
async function historyPage(page, used) {
  const view = historyView, part = document.querySelector('#modal .history-changes'), ask = view.ask = (view.ask || 0) + 1;
  part?.classList.add('is-loading');
  try {
    const changes = await changesOf(view, view.data, page);
    if (historyView !== view || view.ask !== ask) return;
    view.changes = changes;
    redraw('.history-changes', historyPart.loaded().changesTable(changes, historyNow()), used);
  } finally { part?.classList.remove('is-loading'); }
}
function historyWeek(page, used) {
  const view = historyView, now = historyNow(), cost = room?.cost || perCube, { ledgerTable, weeklyLedger } = historyPart.loaded();
  view.week = page;
  redraw('.history-weeks', ledgerTable(weeklyLedger(view.data.readings, { now, cost, resets, clock: view.data.clock || clockRules, character: view.data.character }), { hourlyBefore: view.data.hourlyBefore, thinnedTo: view.data.thinnedTo, page }), used);
}
// Where a character was last seen and its kept places (places.js), on TH.GL's map, with the
// places a page at a time beside it. The open dialog follows the character: a newer place
// recentres the map, at most every 20 seconds and only while the latest place shows on the
// first page with its pin, so a map the viewer moved stays where they put it.
const placesPerPage = 12;
let placeView = null;
const placesAt = (id, page) => pb.send(`/api/odyle/locations/${id}?page=${page}&perPage=${placesPerPage}`);
async function locationDialog(id, name) {
  // The dialog (places.js) loads with its first opening.
  const [data] = await Promise.all([placesAt(id, 1), placesPart()]);
  if (data.serverNow) serverOffset = Date.parse(data.serverNow) - Date.now();
  gameMaps = data.maps || gameMaps;
  const own = characters.some(c => c.id === id);
  placeView = { id, name, own, data, picked: null, shownAt: 0 };
  modal(esc(t('{name} · Location', { name })), `<div class="place-dialog">${placeBody()}</div>`, 'wide split');
  placeView.shownAt = Date.now();
}
const placeBody = () => placesPart.loaded().locationBody({ data: placeView.data, maps: gameMaps, name: placeView.name, own: placeView.own, now: Date.now() + serverOffset, picked: placeView.picked });
function renderPlace() {
  const el = document.querySelector('#modal .place-dialog');
  if (!el || !placeView) return;
  el.innerHTML = placeBody(); placeView.shownAt = Date.now();
}
async function placePage(page, used) {
  const view = placeView, part = document.querySelector('#modal .place-list'), ask = view.ask = (view.ask || 0) + 1;
  part?.classList.add('is-loading');
  try {
    const data = await placesAt(view.id, page);
    if (placeView !== view || view.ask !== ask) return;
    // The latest place stays the one the dialog heard of last.
    view.data = { ...data, location: view.data.location };
    redraw('.place-list', `<div class="place-list">${placesPart.loaded().placeList({ data: view.data, maps: gameMaps, now: Date.now() + serverOffset, picked: view.picked })}</div>`, used);
  } finally { part?.classList.remove('is-loading'); }
}
// Clicking into the embedded map moves focus out of the page: the pin no longer marks the place.
window.addEventListener('blur', () => setTimeout(() => {
  const frame = document.activeElement;
  if (!frame?.matches?.('#modal .place-frame iframe')) return;
  frame.parentElement.classList.add('is-moved'); frame.parentElement.querySelector('[data-place-back]')?.removeAttribute('hidden');
}));
function followPlace(changed) {
  const c = placeView && changed.find(x => x.id === placeView.id && x.location?.at);
  if (!c || !document.querySelector('#modal .place-dialog') || c.location.at === placeView.data.location?.at) return;
  placeView.data = { ...placeView.data, location: c.location };
  if (placeView.picked === null && (placeView.data.page || 1) === 1 && !document.querySelector('#modal .place-frame.is-moved') && Date.now() - placeView.shownAt > 20000) renderPlace();
}
// The pairing dialog (Pair Windows app, Connect reader; pairing.js). It shows this
// browser's unused connection link again, or asks for one, with a countdown to its
// expiry; an account whose reader is online sees that reader first. While it is open, the
// account's news (or, without realtime, a look every ten seconds) tells it when the PC
// paired and what it reads. When pairing is paused, it says so and keeps the downloads.
let pairing = null, pairingTimer = 0;
async function desktopDialog(another = false) {
  if (!pb.authStore.isValid || demo) return toast(t('Sign in with Discord to connect your reader.'));
  // The dialog (pairing.js) loads with its first opening.
  const [data, , dialog] = await Promise.all([pairingAccount(), loadWindowsRelease(), pairingPart()]), now = Date.now() + serverOffset;
  const p = pairing = { user: pb.authStore.record.id, step: 'loading', account: data, checkedAt: Date.now() };
  const saved = dialog.savedPairing(storage, p.user, now), paired = saved && dialog.pairedWith(data?.devices, saved), online = onlineReader(readerList(data), now);
  // A link used since this browser asked for it: the PC it paired.
  if (paired) { forgetPairing(storage); Object.assign(p, { step: 'paired', device: paired.id }); }
  else if (online && !another) Object.assign(p, { step: 'online', reader: online });
  const view = pairingView(p);
  modal(t('Connect your packet reader'), `<div class="pairing-slot" data-shown="${esc(pairingShown(view))}">${dialog.pairingSlot(view)}</div>${dialog.downloadPanel(windowsApp(windowsRelease))}<div class="info-panel"><h3>${t('How it works')}</h3><p>${t('Start the reader before you log into your character. It detects the character, reads the Odyle snapshot from the game and sends the value again only when it changes. Nothing is injected and no raw traffic leaves your PC.')}</p></div>${scopeNote()}`);
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
  const dialog = pairingPart.loaded(), saved = dialog.savedPairing(storage, p.user, Date.now() + serverOffset);
  if (saved && !dialog.pairedWith(p.account?.devices, saved)) { showLink(p, saved); return renderPairing(); }
  forgetPairing(storage); Object.assign(p, { step: 'loading' }); renderPairing();
  try { const pair = await send('desktop-code'); if (pairing !== p) return; dialog.rememberPairing(storage, p.user, pair); showLink(p, pair); }
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
  el.dataset.shown = shown; el.innerHTML = pairingPart.loaded().pairingSlot(view);
}
function stopPairing() { clearInterval(pairingTimer); pairingTimer = 0; pairing = null; }
// Waiting for the PC to pair, or for its first character.
const pairingWaits = p => p.step === 'link' || p.step === 'expired' || (p.step === 'paired' && !pairingReading(p));
function pairingTick() {
  if (!pairing || !document.querySelector('#modal[open] .pairing-slot')) return stopPairing();
  if (pairing.step === 'link') {
    const left = timestamp(pairing.pair.expiresAt) - Date.now() - serverOffset, el = document.querySelector('#modal [data-pair-expires]');
    if (left <= 0) { forgetPairing(storage); pairing.step = 'expired'; renderPairing(); } else if (el) el.textContent = pairingPart.loaded().countdown(left);
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
      const paired = p.step !== 'paired' && p.pair && pairingPart.loaded().pairedWith(data.devices, p.pair);
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
  room = snapshot.room; remindersPaused = Boolean(snapshot.remindersPaused); maintenance = snapshot.maintenance || null; classRoles = snapshot.classRoles || []; gameMaps = snapshot.maps || gameMaps; classIcons = snapshot.classIcons || classIcons; roomWeek = snapshot.week || null; board = snapshot.board || null; perCube = room.cost; clockRules = snapshot.clock || clockRules; members = snapshot.members; wishlist = snapshot.wishlist || []; runs = snapshot.runs || []; dungeons = snapshot.dungeons || []; catalog = snapshot.catalog || dungeons.map(name => ({ name, cost: 0 })); readers = snapshot.readers || readers; serverOffset = Date.parse(snapshot.serverNow) - Date.now(); online = true;
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
  rooms = list.rooms; perCube = list.odylePerCube || perCube; clockRules = list.clock || clockRules; gameMaps = list.maps || gameMaps; classIcons = list.classIcons || classIcons; keptDays = list.kept || keptDays; notificationsSeen = list.notifications || notificationsSeen; notificationsSeen = list.notifications || notificationsSeen; characters = mine; readers = list.readers || []; online = true; if (list.serverNow) serverOffset = Date.parse(list.serverNow) - Date.now(); announced(list); libraryView(); renderedLibrary = librarySignature();
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
  if (Array.isArray(data?.characters)) followPlace(data.characters);
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
  const library = !room && !['/tasks', '/account', '/timers', '/achievements', '/week'].includes(shown);
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
    if (Array.isArray(data.characters)) followPlace(data.characters);
    if (data.seen) applySeen(data.seen, characters);
    // Cap alerts of the account's characters (the job checked the quiet hours).
    if (Array.isArray(data.capAlerts)) await showCapAlerts(data.capAlerts);
    if (Array.isArray(data.partyReady)) await showPartyReady(data.partyReady);
    if (Array.isArray(data.invites)) await showInvites(data.invites);
    if (Array.isArray(data.achievements) && data.achievements.length) await reachedAchievements(data.achievements);
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
  else if (shown === '/timers') await loadTimers();
  else if (shown === '/achievements') await loadAchievements();
  else if (shown === '/week') await loadWeek();
  else if (shown?.startsWith('/armory') || shown === '/changelog' || shown === '/privacy') await pb.health.check(); // nothing of the account to fetch
  else {
    const [list, mine] = await Promise.all([pb.send('/api/odyle/rooms'), pb.collection('characters').getFullList({ sort: 'created' })]);
    if (!room) { rooms = list.rooms; roomsKnown = true; characters = mine; readers = list.readers || []; perCube = list.odylePerCube || perCube; clockRules = list.clock || clockRules; gameMaps = list.maps || gameMaps; classIcons = list.classIcons || classIcons; keptDays = list.kept || keptDays; notificationsSeen = list.notifications || notificationsSeen; if (list.serverNow) serverOffset = Date.parse(list.serverNow) - Date.now(); announced(list); noteAchievements(list); }
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
  if (shown === '/timers') return timersRender();
  if (shown === '/achievements') return achievementsRender();
  if (shown === '/week' && pb.authStore.isValid) return weekRender();
  if (shown === '/slots' && pb.authStore.isValid) return slotsRender();
  if (shown === '/privacy') return privacyRender();
  if (room) return dashboard();
  if (shown === '/tasks') return tasksView();
  if (shown === '/account' && account) return accountRender();
  if (pb.authStore.isValid) return libraryView();
  welcome(joinCode(shown || ''));
}

// Every page has its own URL: / (welcome or your rooms), /room/<id>, /tasks, /account,
// /demo, the armory's pages and #/join/<code> (an invite link), as paths where the backend
// serves the dashboard and as fragments elsewhere (routes.js). A reload or shared link opens
// the same page. The last signed-in page is remembered so a fresh visit resumes there.
let shown = null, navigation = 0;
const memoryKey = 'odyle.location';
function remembered() { try { return JSON.parse(storage.getItem(memoryKey)) || {}; } catch { return {}; } }
function remember(path) { try { storage.setItem(memoryKey, JSON.stringify({ path, room: path.startsWith('/room/') ? path.slice(6) : remembered().room })); } catch { /* storage full or blocked */ } }
function forget(id) { try { if (!id) storage.removeItem(memoryKey); else if (remembered().room === id) storage.setItem(memoryKey, JSON.stringify({ path: '/' })); } catch { /* storage blocked */ } }
// The page a route names, or '' for none.
function pageOf(route) { if (armoryRoute.test(route)) return route; const match = route.match(/^(\/(?:room\/[A-Za-z0-9]{1,40}|join\/[A-Za-z0-9-]{4,24}|demo|tasks|account|changelog|privacy|slots|timers|achievements|week)?)$/); return match ? match[1] : ''; }
function currentPath() { return pageOf(current()) || '/'; }
// The title of a page in the tab, as the backend names it (backend/odyle/pages.go); the
// armory names its profiles once they are fetched (armoryRender).
function pageTitle(path) {
  if (path.startsWith('/armory')) return armoryTarget(path).profile || armoryTarget(path).card ? document.title : armoryTitle(null);
  return { '/changelog': t("What's new in Odyle"), '/privacy': t('Privacy · Odyle'), '/demo': t('Demo party room · Odyle'), '/timers': t('AION 2 timers: daily and weekly reset, Odyle regeneration · Odyle'), '/achievements': t('Achievements · Odyle'), '/week': t('Your week in Odyle') }[path] || t('Odyle — Party command');
}
async function show(force = false) {
  const path = currentPath();
  if (path === shown && !force) return;
  shown = path; const ticket = ++navigation;
  // A path that names no page shows as the page it opens.
  if (usesPaths() && current() !== path) visit(path, true);
  retitle(pageTitle(path));
  if (path === '/demo') { await leaveRoomTopic(); return demoSession(ticket); }
  if (path.startsWith('/armory')) { await leaveRoomTopic(); clearRoom(); return armoryPage(path, ticket); }
  if (path === '/changelog') { clearTimeout(armoryTimer); await leaveRoomTopic(); clearRoom(); return changelogPage(ticket); }
  if (path === '/privacy') { clearTimeout(armoryTimer); await leaveRoomTopic(); clearRoom(); return privacyShow(ticket); }
  if (path === '/timers') { clearTimeout(armoryTimer); await leaveRoomTopic(); clearRoom(); return timersPage(ticket); }
  if (path === '/achievements') { clearTimeout(armoryTimer); await leaveRoomTopic(); clearRoom(); if (pb.authStore.isValid) watchOwnTopic().catch(() => { /* fetched again with the page */ }); return achievementsPage(ticket); }
  if (path === '/slots' && pb.authStore.isValid) { clearTimeout(armoryTimer); await leaveRoomTopic(); clearRoom(); return slotsPage(ticket); }
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
  try { if (path === '/tasks') await tasksPage(ticket); else if (path === '/account') await accountPage(ticket); else if (path === '/week') await weekPage(ticket); else if (id) await openRoom(id, ticket); else await library(ticket); }
  catch (error) {
    if (ticket !== navigation || !id || ![400, 403, 404].includes(error.status)) throw error;
    forget(id); await go('/', true); toast(t('That room is not available to your account.'));
  }
}
function go(path, replace = false) {
  visit(path, replace);
  return show(path === shown);
}
window.addEventListener('hashchange', () => { adoptHash(); show().catch(failure); });
window.addEventListener('popstate', () => { if (usesPaths()) show().catch(failure); });
// With paths, a link to a page of the dashboard opens it in place, as fragments do without.
document.addEventListener('click', e => {
  const a = e.target.closest?.('a[href]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target || a.hasAttribute('download')) return;
  const path = linked(a.href);
  if (!path || pageOf(path) !== path) return;
  e.preventDefault();
  go(path).catch(failure);
});

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
  if (bare()) visit(remembered().path || '/', true);
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
  // The account's achievements and week stay with it, not with the next one signing in here.
  achievementsData = null; achievementsNew = 0; weekData = null; weekBack = null;
  await go('/', true);
}
// The demo workspace (demo.js), drawn again with the page's language.
async function demoSession(ticket = navigation) {
  const { demoRoom } = await demoPart(); if (ticket !== navigation) return;
  clearRoom(); demo = true; ({ room, members, wishlist, classRoles, runs, board } = demoRoom(Date.now()));
  dashboard();
}
app.addEventListener('submit', async e => {
  e.preventDefault(); if (busy) return; busy = true;
  const form = e.target, data = Object.fromEntries(new FormData(form)), button = form.querySelector('[type="submit"]'); button.disabled = true; form.querySelector('.form-error')?.remove();
  try {
    if (form.id === 'create-form') { const result = await send('create', { name: data.name }); rememberInvites(storage, result.room.id, result.invites, Date.now() + serverOffset); await go('/room/' + result.room.id); await inviteDialog(result.invites); }
    else if (form.id === 'armory-form') await go(findPath(data.region, data.server, data.name.trim()));
    else if (form.id === 'card-form' && armoryAnswer) {
      const look = cardPart.loaded().formLook(form);
      armoryAnswer.card = await send('card', { region: armoryAnswer.region, serverId: Number(armoryAnswer.serverId), characterId: armoryAnswer.characterId, ...look });
      // Save stays off until another look is tried, once this handler has let the button go.
      cardLook = {}; setTimeout(() => cardPreview(form)); toast(t('Card saved. Everyone who opens it sees this look.'));
    }
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
      // Planned from the wishlist (and still that dungeon): its members are invited (#45).
      const fromWish = Boolean(form.dataset.fromWish) && form.dataset.fromWish === data.dungeon;
      const id = room.id, result = await send('plan', { roomId: id, dungeon: data.dungeon, startsAt: new Date(data.startsAt).toISOString(), note: data.note, ...(fromWish ? { fromWish: true } : {}) }); form.reset(); delete form.dataset.fromWish; changedRoom(id, () => { runs = result.runs; });
    }
    else if (form.id === 'run-edit-form') {
      const run = runs.find(r => r.id === data.runId); if (!run) return formError(form, t('This run is no longer planned.'));
      const problem = runProblem(data, { now: Date.now() + serverOffset, catalog: dungeons, run }); if (problem) return formError(form, problem);
      // An unchanged start is not sent: the form shows whole minutes, and a run that started over an hour ago keeps its time.
      const changes = { roomId: room.id, id: run.id, dungeon: data.dungeon, note: data.note, link: data.link || '', ...(moved(run, data.startsAt) ? { startsAt: new Date(data.startsAt).toISOString() } : {}) };
      const result = await send('plan', changes); closeModal(); changedRoom(changes.roomId, () => { runs = result.runs; }); toast(t('Run updated.'));
    }
    else if (form.id === 'discord-options-form') {
      const times = (await discordPart()).chosenTimes(form);
      if (times.error) { formError(form, times.error); return; }
      const id = room.id, result = await send('discord-webhook', { roomId: id, ...times });
      if (changedRoom(id, () => { room = result.room; })) roomSettings();
      toast(t('Discord reminder settings saved.'));
    }
    else if (form.id === 'discord-form') {
      // A new connection takes the times chosen above it.
      const times = (await discordPart()).chosenTimes(document.getElementById('discord-options-form') || form);
      if (times.error) { formError(form, times.error); return; }
      const id = room.id, result = await send('discord-webhook', { roomId: id, webhook: data.webhook, language: language(), ...times }); if (changedRoom(id, () => { room = result.room; })) roomSettings(); toast(t('Discord reminders are on. Check the channel for the test message.')); }
    else if (form.id === 'task-edit-form') { applyTasks(await send('task', { id: form.dataset.id, title: data.title })); editingTask = ''; tasksView(); }
    else if (form.id === 'features-form') {
      const changes = changedFeatures(form, room);
      if (!Object.keys(changes).length) { toast(t('Room features saved.')); return; }
      // Turning planned runs off cancels the runs the room lists, so it asks first.
      if (changes.runs === false && runs.length) { pendingFeatures = changes; ask(t('Turn planned runs off?'), esc(tn(runs.length, 'The {n} run planned in this room is cancelled for everyone, and its Discord posts say so.', 'The {n} runs planned in this room are cancelled for everyone, and their Discord posts say so.')), t('Turn planned runs off'), { action: 'confirm-features' }, 'room-settings'); return; }
      await saveFeatures(changes);
    }
    else if (form.id === 'board-form') {
      const id = room.id, result = await send('board', { roomId: id, text: data.text ?? '' }); closeModal(); changedRoom(id, () => { board = result.board; });
      toast(result.board ? t('Board saved. Every member of the room sees it.') : t('Board cleared.'));
    }
    else if (form.id === 'rename-form') { const id = room.id, result = await send('rename', { roomId: id, name: data.name }); rooms = rooms.map(r => r.id === id ? { ...r, name: result.room.name } : r); if (changedRoom(id, () => { room = result.room; })) roomSettings(); toast(t('Room renamed.')); }
    else if (form.id === 'notifications-form') {
      const leads = new FormData(form).getAll('lead').map(Number);
      if (!leads.length || leads.length > 3) { formError(form, t('Choose one to three reminder times.')); return; }
      const result = await send('notifications', { channels: { tray: Boolean(data.tray), browser: Boolean(data.browser), push: Boolean(data.push), discord: Boolean(data.discord) }, leadMinutes: leads, kinds: { ...(account.notifications || defaultNotifications).kinds, runs: Boolean(data.runs), cap: Boolean(data.cap), tasks: Boolean(data.tasks), ready: Boolean(data.ready) }, capTicks: Number(data.capTicks ?? 1), quiet: { from: data.quietFrom || '', to: data.quietTo || '', timeZone: data.quietFrom || data.quietTo ? data.timeZone : '' } });
      account.notifications = result.notifications; upcomingAt = 0; accountRender(); toast(t('Notifications saved.'));
    }
    else if (form.id === 'location-form') {
      const result = await send('location-sharing', { enabled: data.shareLocation === 'on' });
      account.shareLocation = result.shareLocation; accountRender();
      toast(result.shareLocation ? t('Saved: your rooms see where your characters were last seen.') : t('Saved: location sharing is off, and the saved places are deleted.'));
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
    if (el.dataset.cardTab) { cardTab = el.dataset.cardTab; return cardPart.loaded()?.openStudioTab(el.form, cardTab); }
    if (el.dataset.copy) return toast(await copyText(el.dataset.copy) ? el.dataset.copied || t('Code copied.') : t('Copying is blocked here. Select the text and copy it yourself.'));
    if (el.dataset.history) return await historyDialog(el.dataset.history, el.dataset.name);
    if (el.dataset.location) return await locationDialog(el.dataset.location, el.dataset.name);
    if (el.dataset.place && placeView) { placeView.picked = placesPart.loaded().placesOf(placeView.data)[Number(el.dataset.place)] || null; return renderPlace(); }
    if (el.dataset.placePage && placeView) return await placePage(Number(el.dataset.placePage), el);
    if (el.matches('[data-place-back]') && placeView) return renderPlace();
    if (el.dataset.historyDays && historyView) return await showHistory(Number(el.dataset.historyDays), el);
    if (el.dataset.historyPage && historyView) return await historyPage(Number(el.dataset.historyPage), el);
    if (el.dataset.historyWeek && historyView) return historyWeek(Number(el.dataset.historyWeek), el);
    if (el.dataset.armoryUnmark) { keepBookmarks(armoryPart.loaded().removeBookmark(bookmarks(), el.dataset.armoryUnmark)); return armoryRender(); }
    if (el.dataset.armoryBoard) { armoryBoard = el.dataset.armoryBoard; armoryRender(); return document.querySelector(`[data-armory-board="${CSS.escape(armoryBoard)}"]`)?.focus(); }
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
    if (el.dataset.mainCharacter) {
      const main = el.dataset.main === 'true';
      el.disabled = true;
      try { await send('main-character', { characterId: el.dataset.mainCharacter, main }); } finally { el.disabled = false; }
      characters = characters.map(c => ({ ...c, main: c.id === el.dataset.mainCharacter ? main : main ? false : c.main }));
      toast(main ? t('{name} is your main character.', { name: el.dataset.name }) : t('No main character.'));
      return renderLibrary();
    }
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
    if (el.dataset.slotEquip !== undefined && el.dataset.kind) { slotState = await send('slot-equip', { kind: el.dataset.kind, id: el.dataset.slotEquip }); return slotsRender(); }
    if (el.dataset.weekBack !== undefined && weekData) { weekBack = Math.max(0, Number(el.dataset.weekBack)); el.disabled = true; await loadWeek(); return weekRender(); }
    if (el.dataset.wearItem !== undefined && el.dataset.kind && achievementsData) {
      const worn = await send('slot-equip', { kind: el.dataset.kind, id: el.dataset.wearItem });
      achievementsData = { ...achievementsData, owned: worn.owned, equipped: worn.equipped }; achievementsRender();
      return toast(el.dataset.wearItem ? t('Worn next to your name in your rooms.') : t('Taken off.'));
    }
    if (el.dataset.copyCalendar) { await navigator.clipboard.writeText(el.dataset.copyCalendar).then(() => toast(t('Calendar link copied.')), () => toast(t('Copy the link from the field.'))); return; }
    if (el.dataset.planWish) {
      const form = document.querySelector('#run-form'); if (!form) return;
      form.elements.dungeon.value = el.dataset.planWish; form.dataset.fromWish = el.dataset.planWish; form.scrollIntoView({ behavior: 'smooth', block: 'center' }); return form.elements.startsAt.focus();
    }
    // Going with one of several characters shared here asks which one first.
    if (el.dataset.run && el.dataset.going === 'true' && !el.dataset.character && mine().filter(c => c.shared).length > 1) {
      const run = runs.find(r => r.id === el.dataset.run);
      return modal(esc(t('Going to {dungeon} with', { dungeon: run?.dungeon || '' })), `<p>${t('Pick the character you bring. The run counts its cubes.')}</p><div class="add-chips pick-chips">${mine().filter(c => c.shared).map(c => `<button class="add-chip" data-run="${esc(el.dataset.run)}" data-going="true" data-character="${esc(c.id)}">${esc(c.characterName)} · ${esc(c.value.toLocaleString(locale()))}</button>`).join('')}<button class="add-chip" data-run="${esc(el.dataset.run)}" data-going="true" data-character="any">${t('Any: my best')}</button></div>`);
    }
    if (el.dataset.useStart) { const input = document.querySelector('#run-form [name="startsAt"]'); if (input) { input.value = el.dataset.useStart; input.focus(); } return; }
    if (el.dataset.callRun !== undefined) {
      if (demo) return signInPrompt(t('This workspace uses sample data. Sign in with Discord to plan runs with your party.'));
      const form = el.closest('form'); form.querySelector('.form-error')?.remove();
      return callDialog(form, Object.fromEntries(new FormData(form)));
    }
    if (el.dataset.confirmCall !== undefined) {
      const id = room.id; let result; el.disabled = true; try { result = await send('plan', { roomId: id, dungeon: el.dataset.confirmCall, note: el.dataset.note || '', call: true }); } finally { el.disabled = false; }
      closeModal(); document.querySelector('#run-form')?.reset(); changedRoom(id, () => { runs = result.runs; });
      const called = result.runs.filter(r => r.called && r.planner === pb.authStore.record?.id).at(-1); // the latest start: this call
      return toast(called?.invited?.length ? tn(called.invited.length, 'The party is called: {n} player can come now.', 'The party is called: {n} players can come now.') : t('The run is planned. Nobody else can come now.'));
    }
    if (el.dataset.cantRun) {
      const id = room.id; let result; el.disabled = true; try { result = await send('plan', { roomId: id, id: el.dataset.cantRun, cant: el.dataset.cant === 'true' }); } finally { el.disabled = false; }
      return changedRoom(id, () => { runs = result.runs; });
    }
    if (el.dataset.run) {
      const id = room.id; let result; el.disabled = true; try { result = await send('plan', { roomId: id, id: el.dataset.run, going: el.dataset.going === 'true', ...(el.dataset.character && el.dataset.character !== 'any' ? { character: el.dataset.character } : {}) }); } finally { el.disabled = false; }
      if (el.dataset.character) closeModal();
      return changedRoom(id, () => { runs = result.runs; });
    }
    if (el.dataset.editRun) { const { runEditForm } = await runToolsPart(), r = runs.find(x => x.id === el.dataset.editRun); if (r) modal(esc(t('Change {dungeon}', { dungeon: r.dungeon })), runEditForm(r, { suggestions: [...new Set(wishlist.map(w => w.dungeon))], catalog, perCube: room?.cost || perCube }, Date.now() + serverOffset)); return; }
    if (el.dataset.copyRun) {
      const r = runs.find(x => x.id === el.dataset.copyRun); if (!r) return;
      const names = ids => ids.map(u => members.find(m => m.user === u)?.displayName).filter(Boolean), { party, waiting } = runParty(r, catalog);
      const text = discordText(r, { going: names(party), waiting: names(waiting), partySize: entryOf(catalog, r.dungeon)?.partySize || 0, link: address('/room/' + room.id), event: r.link || '' });
      return toast(await copyText(text) ? t('Copied for Discord: paste it in any channel.') : t('Copying is blocked here. Select the text and copy it yourself.'));
    }
    if (el.dataset.calendarRun) {
      const { calendarFile } = await runToolsPart(), r = runs.find(x => x.id === el.dataset.calendarRun); if (!r) return;
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
      case 'calendar-on': { const made = await send('calendar', { enabled: true }); calendarLink = location.origin + made.path; account.calendar = made.calendar; accountRender(); break; }
      case 'calendar-off': { const made = await send('calendar', { enabled: false }); calendarLink = ''; account.calendar = made.calendar; accountRender(); toast(t('Calendar feed stopped.')); break; }
      case 'slot-spin': await spinSlot(); break;
      case 'slot-sound': { try { storage.setItem(slotSoundKey, slotSound() ? 'off' : 'on'); } catch { /* storage blocked: stays on */ } slotsRender(); break; }
      case 'calendar-all': { const { calendarOfRuns } = await runToolsPart(); download(calendarOfRuns(nextRunsList, Date.now() + serverOffset), 'odyle-runs.ics', 'text/calendar'); break; }
      case 'new-room': { await go('/'); const setup = document.querySelector('.room-setup'); if (setup) { setup.open = true; setup.querySelector('input')?.focus(); } break; }
      case 'tasks': await go('/tasks'); break;
      case 'armory': closeModal(); await go('/armory'); break;
      case 'timers': closeModal(); await go('/timers'); break;
      case 'achievements': closeModal(); await go('/achievements'); break;
      case 'week-ready': weekBack = 1; await go('/week'); break;
      case 'week-later': { try { storage.setItem(weekSeenKey, el.dataset.week); } catch { /* storage blocked */ } document.querySelector('.week-ready')?.remove(); break; }
      case 'week-image': { const { summary, blob } = await weekPicture(); saveBlob(blob, weekPart.loaded().weekImageName(summary)); toast(t('The picture of your week is in your downloads.')); break; }
      case 'week-copy': { const { weekText, weekSummary } = weekPart.loaded(); toast(await copyText(weekText(weekSummary(weekData, Date.now() + serverOffset), address('/'))) ? t('Copied. Paste it in Discord.') : t('Copying is blocked here. Select the text and copy it yourself.')); break; }
      case 'week-share': {
        const { summary, blob } = await weekPicture();
        const { weekImageName, weekText } = weekPart.loaded();
        try { await navigator.share({ files: [new File([blob], weekImageName(summary), { type: 'image/png' })], text: weekText(summary, address('/')) }); }
        catch (error) { if (error?.name !== 'AbortError') throw error; }
        break;
      }
      case 'armory-refresh': await armoryPage(shown, navigation, true); break;
      case 'armory-bookmark': toggleBookmark(); break;
      case 'card-flip': cardFlip?.(); break;
      case 'card-image': if (armoryAnswer?.profile) { const [{ saveCardImage }, cards] = await Promise.all([cardImagePart(), cardPart()]); await saveCardImage(armoryAnswer, cards.lookOf(armoryAnswer, cardLook), armoryImages()); toast(t('The card is saved as a picture in your downloads.')); } break;
      case 'account': if (!pb.authStore.isValid || demo) await go('/'); else await go('/account'); break;
      case 'demo': await go('/demo'); break;
      case 'exit-demo': await go('/'); break;
      case 'close-dialog': closeModal(); break;
      case 'invite': await inviteDialog(); break;
      case 'room-settings': roomSettings(); break;
      case 'confirm-features': if (pendingFeatures) { const changes = pendingFeatures; pendingFeatures = null; await saveFeatures(changes); } break;
      case 'edit-board': if (demo) return signInPrompt(t('This workspace uses sample data. Sign in with Discord to keep an information board in your own room.')); modal(t('Information board'), boardForm(board)); document.querySelector('#board-text')?.focus(); break;
      case 'clear-board': ask(t('Clear the board?'), t('Every member stops seeing it. You can write a new one at any time.'), t('Clear the board'), { action: 'confirm-clear-board' }, 'edit-board'); break;
      case 'confirm-clear-board': { const id = room.id, result = await send('board', { roomId: id, text: '' }); closeModal(); changedRoom(id, () => { board = result.board; }); toast(t('Board cleared.')); break; }
      case 'reading': await desktopDialog(); break;
      case 'pair-another': if (pairing) await openLink(pairing); break;
      case 'new-pairing': if (pairing) { forgetPairing(storage); await openLink(pairing); } break;
      case 'add-all': { const id = room.id, result = await send('sharing', { roomId: id, enabled: true }); changedRoom(id, () => applyShared(me(), result.sharedCharacters)); break; }
      case 'desktop': await desktopDialog(true); break;
      case 'hide-update-note': seenVersion(); break;
      case 'skip': { const main = document.querySelector('.main main'); if (main) { main.setAttribute('tabindex', '-1'); main.focus(); } break; }
      case 'hide-announcement': storage.setItem(hiddenAnnouncementKey, announcement?.text || ''); renderAnnouncement(); break;
      case 'help': modal(t('Saved characters, fresh readings'), (await helpPart()).helpBody({ historyDays: keptDays.historyDays, scope: scopeText() })); break;
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
// A run planned from the wishlist invites those who wanted its dungeon (#45).
async function showInvites(invites) {
  const settings = account?.notifications || notificationsSeen || defaultNotifications;
  if (!settings.kinds.runs || !settings.channels.browser || reminderState() !== 'on') return;
  for (const n of invites) {
    // A call to a run now (Run now) says so, with its start in local time.
    if (n.now) await notice(t('{by} calls the party to {dungeon}', { by: n.by, dungeon: n.dungeon }), { body: t('{room} · starts {time}', { room: n.room, time: new Date(timestamp(n.startsAt)).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) }), tag: 'invite-' + n.runId, icon: 'icon-192.png', requireInteraction: true });
    else await notice(t('{by} invites you to {dungeon}', { by: n.by, dungeon: n.dungeon }), { body: t('{room} · {when}', { room: n.room, when: new Date(timestamp(n.startsAt)).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }), tag: 'invite-' + n.runId, icon: 'icon-192.png' });
  }
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
  if (el.closest?.('#card-form')) return cardPreview(el.form);
  if (el.id === 'language-select') {
    // A dictionary gone with a deploy loads the new build, in the language asked for (gone).
    try { await useLanguage(el.value); } catch (error) { storage.setItem(languageKey, el.value); return Promise.resolve(error).then(gone).catch(failure); }
    document.documentElement.lang = language(); retitle(pageTitle(currentPath())); storage.setItem(languageKey, language());
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
// An armory image the backend does not keep (yet) leaves its frame empty.
app.addEventListener('error', e => { if (e.target.matches?.('img.armory-img')) { e.target.parentElement?.classList.add('is-empty'); e.target.remove(); } }, true);
// The page language is ready before the first page is drawn; without its dictionary it stays English.
// The service worker keeps the dashboard's files for visits without a connection and
// shows run reminders; development builds go without it.
if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => { /* runs without offline files */ });
adoptHash();
useLanguage(detect(storage.getItem(languageKey), navigator.languages || [navigator.language])).catch(() => useLanguage('en')).then(() => {
  document.documentElement.lang = language(); retitle(pageTitle(currentPath()));
  if (pb.authStore.isValid) return authenticated().catch(failure);
  loadAnnouncement(true).catch(() => { /* an older backend or no connection: no banner */ });
  return show().catch(failure);
}).then(prefetchParts);
