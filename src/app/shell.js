// The frame every page draws in (shell): on wide screens the sidebar with the room switch, the
// pages, the reader and the account menu; on phones a bar at the top (room switch, account
// menu) and one at the bottom (pages). Also the connection label, the reader button, the
// Windows app's links and what Odyle is, which several pages show.
import { t } from '../i18n.js';
import { escape as esc } from '../model.js';
import { icon } from '../icons.js';
import { link } from '../routes.js';
import { windowsApp } from '../release.js';
import { onlineReader, readerLabel } from '../readers.js';
import { inAppBrowser } from '../signin.js';
import { state, remembered } from './state.js';
import { pb } from './server.js';
import { app, announce, modal, toast, badgeOf } from './ui.js';
import { onAction } from './actions.js';
import { helpPart, pairingPart } from './parts.js';
import { announcementBar, updateNote, appVersion } from './notes.js';
import { noteAchievements } from './pages.js';

export const roleName = role => role === 'owner' ? t('leader') : role === 'officer' ? t('officer') : role === 'viewer' ? t('viewer') : t('player');
// The pages, as links (they open in a new tab too): in the sidebar on wide screens, in the bar
// at the bottom on phones (with the short name). Dialogs sit in the account menu.
const pages = () => [['overview', 'grid', t('Party')], ['library', 'people', t('Rooms & characters'), t('Rooms')], ['tasks', 'check', t('Tasks')], ['week', 'chart', t('My week')], ['achievements', 'trophy', t('Achievements')], ['timers', 'clock', t('Timers')], ['armory', 'search', t('Armory')]];
// The bar at the bottom of phones has room for these four and the account; the other pages are
// in the account menu there (phoneItems).
const phonePages = ['overview', 'library', 'tasks', 'armory'];
const navItem = (action, active, name, label) => `<a href="${navHref(action)}" data-action="${action}" class="nav-item ${active === action ? 'active' : ''}"${active === action ? ' aria-current="page"' : ''}>${icon(name)}<span class="nav-label">${label}</span>${badgeOf(action)}</a>`;
// Where a navigation item leads: the open (or last) room, the library, the checklist, the armory, the account.
function navHref(action) {
  const signedIn = pb.authStore.isValid && !state.demo;
  if (action === 'overview') return link(state.demo ? '/demo' : state.room ? '/room/' + state.room.id : signedIn && remembered().room ? '/room/' + remembered().room : '/');
  const path = { library: '/', tasks: signedIn ? '/tasks' : '/', week: signedIn ? '/week' : '/', achievements: '/achievements', timers: '/timers', armory: '/armory', account: signedIn ? '/account' : '/' }[action];
  return path ? link(path) : '';
}
const bottomNav = active => `<nav class="bottom-nav" aria-label="${esc(t('Pages'))}">${[...pages().filter(([action]) => phonePages.includes(action)).map(([action, name, label, short]) => [action, name, short || label]), ['account', 'user', t('Account')]].map(([action, name, label]) => `<a href="${navHref(action)}" data-action="${action}" class="${active === action ? 'active' : ''}"${active === action ? ' aria-current="page"' : ''}>${icon(name)}<span>${label}</span>${action === 'tasks' ? badgeOf('tasks') : ''}</a>`).join('')}</nav>`;
const connectionLabel = () => `<i></i>${state.demo ? t('Demo workspace') : state.online ? t('Connected') : t('Not connected')}`;
// The room switch: the room on screen (or the last one), the account's other rooms and the
// way to a new one. The library brings the list; other pages fetch it once (loadRoomList).
function roomSwitch() {
  const mark = name => `<span class="room-mark">${esc((name || '·').slice(0, 1).toUpperCase())}</span>`;
  const { room, rooms } = state;
  if (state.demo) return `<div class="room-switch is-static">${mark(room?.name)}<span class="room-switch-text"><small>${t('Room')}</small><strong>${esc(room?.name || '')}</strong></span></div>`;
  if (!pb.authStore.isValid) return '';
  const id = room?.id || remembered().room, name = room?.name || rooms.find(r => r.id === id)?.name || '';
  const options = rooms.map(r => `<a href="${esc(link('/room/' + r.id))}" class="menu-item room-option ${r.id === room?.id ? 'active' : ''}"${r.id === room?.id ? ' aria-current="page"' : ''}>${mark(r.name)}<span><strong>${esc(r.name)}</strong><small>${esc(roleName(r.role))}</small></span></a>`).join('');
  return `<details class="room-switch"><summary title="${esc(t('Switch room'))}">${mark(name)}<span class="room-switch-text"><small>${t('Room')}</small><strong>${esc(name || t('Choose a room'))}</strong></span>${icon('chevron')}</summary><div class="menu">${options}<button class="menu-item" data-action="new-room">${icon('plus')}<span>${t('Create or join a room')}</span></button></div></details>`;
}
function renderRoomSwitch() { document.querySelectorAll('.room-switch').forEach(el => { if (!el.open) el.outerHTML = roomSwitch(); }); }
export async function loadRoomList() { const list = await pb.send('/api/odyle/rooms', { requestKey: 'room-list' }); state.rooms = list.rooms || []; state.gameMaps = list.maps || state.gameMaps; state.classIcons = list.classIcons || state.classIcons; state.keptDays = list.kept || state.keptDays; state.roomsKnown = true; renderRoomSwitch(); noteAchievements(list); }
// The account menu behind the avatar: the account page, pairing, invites, help, what's new and
// signing out. Signed out (or in the demo) the same place offers help and the way back.
function accountMenu() {
  const connection = `<span class="connection ${state.online || state.demo ? 'connected' : ''}">${connectionLabel()}</span>`, help = `<button class="menu-item" data-action="help">${icon('shield')}<span>${t('Reader & privacy')}</span></button>`;
  if (state.demo || !pb.authStore.isValid) return `<div class="account-guest">${phoneItems()}${help}${connection}${state.demo ? `<button class="button secondary" data-action="exit-demo">${t('Leave the demo')}</button>` : ''}</div>`;
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

// The PC that reads for this account now, or the way to connect a reader: an account
// whose reader is online is not asked to pair again (its dialog offers another PC).
export const readerNow = () => onlineReader(state.readers, Date.now() + state.serverOffset);
export function readerButton(connect) {
  const reader = readerNow();
  return reader ? `<button class="button secondary reader-button reader-online" data-action="reading" title="${esc(t('Show the reader or pair another PC'))}"><i></i>${esc(readerLabel(reader.name))}</button>` : `<button class="button secondary reader-button" data-action="reading">${connect}</button>`;
}
// The reader in the sidebar: the PC that reads for the account, or the way to connect one.
export function renderReaderStatus() { const el = document.querySelector('.sidebar-foot .reader-button'); if (el) el.outerHTML = readerButton(`${icon('plus')} ${t('Connect reader')}`); document.querySelectorAll('.menu-reader').forEach(item => { item.outerHTML = readerItem(); }); }

// The connection state follows every refresh, not only full redraws.
// A lost connection, and its return, are read out (#199).
let saidOnline = null;
export function renderConnection() {
  document.querySelectorAll('.connection').forEach(el => { el.classList.toggle('connected', state.online || state.demo); el.innerHTML = connectionLabel(); });
  if (state.demo || saidOnline === state.online) return;
  if (saidOnline !== null || !state.online) announce(state.online ? t('Connected to the Odyle server again.') : t('The connection to the Odyle server was lost. The dashboard keeps trying.'), !state.online);
  saidOnline = state.online;
}

// Every page draws through shell(), which notes the navigation (show) it drew for.
export function shell(content, active = 'overview') {
  state.drawn = state.navigation;
  const reader = pb.authStore.isValid && !state.demo ? readerButton(`${icon('plus')} ${t('Connect reader')}`) : '';
  const home = cls => `<a href="${link('/')}" class="${cls}" aria-label="${esc(t('Odyle home'))}"><span class="brand-symbol">${icon('diamond')}</span><span class="brand-name">odyle<span class="brand-dot">.</span></span></a>`;
  app.innerHTML = `<button class="skip-link" data-action="skip">${t('Skip to content')}</button><aside class="sidebar">${home('brand')}${roomSwitch()}<nav aria-label="${esc(t('Pages'))}">${pages().map(([action, name, label]) => navItem(action, active, name, label)).join('')}</nav><div class="sidebar-foot">${reader}${accountMenu()}</div></aside><header class="topbar">${home('brand brand-mini')}${roomSwitch()}${accountMenu()}</header><div class="main">${announcementBar()}${updateNote()}${content}<footer><span>Odyle <a class="version-link" href="${link('/changelog')}" title="${esc(t('What\'s new'))}">${esc(appVersion)}</a></span><span>${t('Unofficial fan project')} · <a class="footer-link" href="${link('/privacy')}">${t('Privacy')}</a></span></footer></div>${bottomNav(active)}<dialog id="modal" aria-labelledby="modal-title"></dialog>`;
}

// Browsers built into other apps often cannot finish the Discord sign-in (signin.js); an
// installed web app looks like one but is not.
const standalone = () => navigator.standalone === true || Boolean(window.matchMedia?.('(display-mode: standalone)').matches);
export const embedded = () => inAppBrowser(navigator.userAgent, standalone());
// What Odyle is and what its reader does, where players decide to use it: the welcome
// page, the pairing dialog and Reader & privacy.
export const scopeText = () => t("Odyle is an unofficial fan project, not affiliated with or endorsed by NCSOFT. The Windows reader only listens to your own game connection: it never reads game memory, changes or sends game traffic or automates play, and it reads no damage numbers, HP or skills. It reads your character's PvP kills, assists and deaths, with the names of the players in them, only after you turn on PvP stats. It also sends the names of the other players in your party and force to Odyle's armory, which looks up their public PLAYNC profiles, until you turn that off under Account & data. NCSOFT's rules ban unauthorized programs, so use Odyle at your own risk.");
export const scopeNote = () => `<p class="scope-note">${icon('shield')}<span>${scopeText()}</span></p>`;

// Links to the Windows app's newest release: version and package links when the
// backend knows them, GitHub's stable latest-release page otherwise.
export async function loadWindowsRelease() {
  if (Date.now() - state.windowsReleaseAt < 600000) return;
  state.windowsReleaseAt = Date.now();
  try { state.windowsRelease = await pb.send('/api/odyle/windows-release'); } catch { /* the latest-release page link works without it */ }
}
export function appLink(className, text = t('Windows app')) {
  const release = windowsApp(state.windowsRelease);
  return `<a class="${className} app-link" href="${esc(release.url)}" target="_blank" rel="noopener noreferrer" title="${esc(t('Latest release of the Odyle Windows app on GitHub'))}">${icon('download')} ${text}<span class="app-version">${release.version ? ` ${esc(release.version)}` : ''}</span></a>`;
}
// The release came after the page was drawn: its links lead to it now.
export function renderAppLinks() {
  const release = windowsApp(state.windowsRelease);
  document.querySelectorAll('a.app-link').forEach(a => { a.href = release.url; a.querySelector('.app-version').textContent = release.version ? ' ' + release.version : ''; });
}

// The pairing dialog (pairing.js) loads with its first opening; an account whose reader is
// online sees that reader first, unless it asked to pair another PC (desktop).
async function desktopDialog(another) {
  if (!pb.authStore.isValid || state.demo) return toast(t('Sign in with Discord to connect your reader.'));
  return (await pairingPart()).desktopDialog(another);
}
onAction({
  reading: () => desktopDialog(false),
  desktop: () => desktopDialog(true),
  skip: () => { const main = document.querySelector('.main main'); if (main) { main.setAttribute('tabindex', '-1'); main.focus(); } },
  help: async () => modal(t('Saved characters, fresh readings'), (await helpPart()).helpBody({ historyDays: state.keptDays.historyDays, scope: scopeText() })),
});
