// Every page has its own URL: / (welcome or your rooms), /room/<id>, /tasks, /account,
// /demo, the armory's pages and #/join/<code> (an invite link), as paths where the backend
// serves the dashboard and as fragments elsewhere (routes.js). A reload or shared link opens
// the same page. The last signed-in page is remembered so a fresh visit resumes there.
// Each navigation has its number (state.navigation, the ticket): answers for an older one are
// dropped.
import { t } from '../i18n.js';
import { escape as esc } from '../model.js';
import { icon } from '../icons.js';
import { usesPaths, current, linked, visit, adoptHash, retitle, pageOf, pageTitle, pageNav } from '../routes.js';
import { joinCode, joinedMessage } from '../invites.js';
import { state, remember, forget, remembered, leaveRoomTopic, clearRoom } from './state.js';
import { pb, send } from './server.js';
import { toast, closeModal, updateAges } from './ui.js';
import { onAction } from './actions.js';
import { libraryPart, roomPart, tasksPart, accountPart } from './parts.js';
import { shell, renderReaderStatus } from './shell.js';
import { announced } from './notes.js';
import { armoryPage, armoryRender, stopArmory } from './armory.js';
import {
  changelogPage,
  changelogRender,
  privacyShow,
  privacyRender,
  timersPage,
  timersRender,
  loadTimers,
  achievementsPage,
  achievementsRender,
  loadAchievements,
  weekPage,
  weekRender,
  loadWeek,
  slotsPage,
  slotsRender,
  noteAchievements,
} from './pages.js';
import { welcome, inviteTrouble } from './welcome.js';
import { failure, watchOwnTopic } from './session.js';

export function currentPath() {
  return pageOf(current()) || '/';
}
let reloadTimer;
export async function show(force = false) {
  const path = currentPath();
  if (path === state.shown && !force) return;
  state.shown = path;
  const ticket = ++state.navigation;
  clearTimeout(reloadTimer);
  try {
    await showPage(path, ticket);
  } catch (error) {
    // A page that failed before it drew anything (a deploy, a restart, a dropped network)
    // would leave an empty page, or the previous page with buttons for what was closed.
    if (ticket !== state.navigation || state.drawn === ticket || error?.status === 401) throw error;
    pageFailed(error);
  }
}
// A navigation that is no longer the page's: its answers go nowhere.
export function dropNavigation() {
  state.navigation++;
  state.shown = null;
  clearTimeout(reloadTimer);
}
// A page that could not load says why and loads again in ten seconds, or with Try again now.
function pageFailed(error) {
  state.shown = null;
  state.drawn = state.navigation;
  // A part of the page that stayed gone after an update (gone) says so; other failures without an
  // answer, or with a server error, are the server's.
  const why =
    error?.part || (error?.status >= 400 && error.status < 500)
      ? t(error.message || 'Request could not be completed.')
      : t('The Odyle server did not answer.');
  shell(
    `<main class="welcome"><div class="eyebrow"><span class="tiny-diamond"></span> ${t('NOT LOADED')}</div><h1>${t('This page could not be loaded')}<span class="mint">.</span></h1><p class="intro">${esc(why)} ${t('The dashboard tries again in ten seconds.')}</p><button class="button secondary" data-action="reload-page">${t('Try again now')} ${icon('arrow')}</button></main>`,
  );
  reloadTimer = setTimeout(() => show().catch(failure), 10000);
}
// The public pages: each leaves the room it had open (and the armory's profile that waits).
const publicPages = { '/changelog': changelogPage, '/privacy': privacyShow, '/timers': timersPage };
async function showPage(path, ticket) {
  // A path that names no page shows as the page it opens.
  if (usesPaths() && current() !== path) visit(path, true);
  retitle(pageTitle(path, document.title));
  if (path === '/demo') {
    await leaveRoomTopic();
    return (await roomPart()).demoSession(ticket);
  }
  if (path.startsWith('/armory')) {
    await leaveRoomTopic();
    clearRoom();
    return armoryPage(path, ticket);
  }
  if (publicPages[path]) {
    stopArmory();
    await leaveRoomTopic();
    clearRoom();
    return publicPages[path](ticket);
  }
  if (path === '/achievements') {
    stopArmory();
    await leaveRoomTopic();
    clearRoom();
    if (pb.authStore.isValid)
      watchOwnTopic().catch(() => {
        /* fetched again with the page */
      });
    return achievementsPage(ticket);
  }
  if (path === '/slots' && pb.authStore.isValid) {
    stopArmory();
    await leaveRoomTopic();
    clearRoom();
    return slotsPage(ticket);
  }
  stopArmory();
  const code = joinCode(path);
  if (!pb.authStore.isValid) {
    await leaveRoomTopic();
    clearRoom();
    return welcome(code);
  }
  if (code) return joinPage(code, ticket);
  remember(path);
  watchOwnTopic().catch(() => {
    /* without realtime pages fetch every 15 seconds */
  });
  const id = path.startsWith('/room/') ? path.slice(6) : '';
  try {
    await signedInPage(path, id, ticket);
  } catch (error) {
    if (ticket !== state.navigation || !id || ![400, 403, 404].includes(error.status)) throw error;
    forget(id);
    await go('/', true);
    toast(t('That room is not available to your account.'));
  }
}
// The pages of the signed-in dashboard, which load with their first visit (parts.js).
async function signedInPage(path, id, ticket) {
  if (path === '/tasks') await (await tasksPart()).tasksPage(ticket);
  else if (path === '/account') await (await accountPart()).accountPage(ticket);
  else if (path === '/week') await weekPage(ticket);
  else if (id) await (await roomPart()).openRoom(id, ticket);
  else await (await libraryPart()).library(ticket);
}
// An invite link: join, then open the room in place of the link and say as what. A
// link that does not join stays, with what it opens and why (inviteTrouble).
async function joinPage(code, ticket) {
  let result;
  try {
    result = await send('join', { code });
  } catch (error) {
    if (ticket !== state.navigation) return;
    if (error?.status === 401) throw error;
    return await inviteTrouble(code, error, ticket);
  }
  if (ticket !== state.navigation) return;
  await go('/room/' + result.room.id, true);
  return toast(joinedMessage(result));
}
export function go(path, replace = false) {
  visit(path, replace);
  return show(path === state.shown);
}
window.addEventListener('hashchange', () => {
  adoptHash();
  show().catch(failure);
});
window.addEventListener('popstate', () => {
  if (usesPaths()) show().catch(failure);
});
// With paths, a link to a page of the dashboard opens it in place, as fragments do without.
document.addEventListener('click', e => {
  const a = e.target.closest?.('a[href]');
  if (
    !a ||
    e.defaultPrevented ||
    e.button !== 0 ||
    e.metaKey ||
    e.ctrlKey ||
    e.shiftKey ||
    e.altKey ||
    a.target ||
    a.hasAttribute('download')
  )
    return;
  const path = linked(a.href);
  if (!path || pageOf(path) !== path) return;
  e.preventDefault();
  go(path).catch(failure);
});

// The current page's data, fetched again.
export async function refreshPage() {
  const { shown } = state;
  if (state.room) await (await roomPart()).refreshRoom();
  else if (shown === '/tasks') await (await tasksPart()).refreshTasks();
  else if (shown === '/account') await (await accountPart()).refreshAccount();
  else if (shown === '/timers') await loadTimers();
  else if (shown === '/achievements') await loadAchievements();
  else if (shown === '/week') await loadWeek();
  else if (shown === null || shown.startsWith('/armory') || shown === '/changelog' || shown === '/privacy')
    await pb.health.check(); // nothing of the account to fetch (null: a page that failed to load, pageFailed)
  else await refreshLists();
  state.online = true;
}
// The account's rooms and characters, for Rooms & characters and the room switch.
async function refreshLists() {
  const [list, characters] = await Promise.all([
    pb.send('/api/odyle/rooms'),
    pb.collection('characters').getFullList({ sort: 'created' }),
  ]);
  if (state.room) return;
  Object.assign(state, {
    rooms: list.rooms,
    roomsKnown: true,
    characters,
    charactersKnown: true,
    readers: list.readers || [],
    perCube: list.odylePerCube || state.perCube,
    clockRules: list.clock || state.clockRules,
    gameMaps: list.maps || state.gameMaps,
    classIcons: list.classIcons || state.classIcons,
    keptDays: list.kept || state.keptDays,
    notificationsSeen: list.notifications || state.notificationsSeen,
  });
  if (list.serverNow) state.serverOffset = Date.parse(list.serverNow) - Date.now();
  announced(list);
  noteAchievements(list);
}
// Redraws what changed on the current page; ages and live/stale states tick in place.
export function renderPage() {
  if (state.demo || document.querySelector('#modal')?.open) return;
  if (state.room) roomPart.loaded()?.renderDashboard();
  else if (document.querySelector('.tasks-page')) tasksPart.loaded()?.renderTasks();
  else if (document.querySelector('.account-page')) accountPart.loaded()?.renderAccount();
  else if (document.querySelector('.personal-characters') && libraryPart.loaded()?.libraryChanged())
    libraryPart.loaded().renderLibrary();
  else updateAges();
  renderReaderStatus();
}
// Redraws the current page, for example after the language changed.
export function rerender() {
  const { shown } = state;
  if (state.demo) return roomPart.loaded()?.demoSession();
  if (shown === null) return show().catch(failure);
  if (shown?.startsWith('/armory')) return armoryRender();
  const view = {
    '/changelog': changelogRender,
    '/timers': timersRender,
    '/achievements': achievementsRender,
    '/privacy': privacyRender,
  }[shown];
  if (view) return view();
  if (shown === '/week' && pb.authStore.isValid) return weekRender();
  if (shown === '/slots' && pb.authStore.isValid) return slotsRender();
  if (state.room) return roomPart.loaded()?.dashboard();
  if (shown === '/tasks') return tasksPart.loaded()?.tasksView();
  if (shown === '/account' && state.account) return accountPart.loaded()?.accountRender();
  if (pb.authStore.isValid) return libraryPart.loaded()?.libraryView();
  welcome(joinCode(shown || ''));
}
// The frame of the page and a loading state, before any answer came (#186).
export function loadingShell() {
  shell(
    `<main class="dashboard loading-page" aria-busy="true"><p class="loading-note" role="status"><span class="loading-spinner" aria-hidden="true"></span>${t('Loading your page…')}</p><div class="loading-lines" aria-hidden="true"><i></i><i></i><i></i><i></i></div></main>`,
    pageNav(currentPath()),
  );
}

// The navigation and the buttons that lead to a page.
onAction({
  'reload-page': () => show(),
  overview: () =>
    state.room
      ? roomPart.loaded()?.dashboard()
      : go(pb.authStore.isValid && remembered().room ? '/room/' + remembered().room : '/'),
  library: () => go('/'),
  'new-room': async () => {
    await go('/');
    const setup = document.querySelector('.room-setup');
    if (setup) {
      setup.open = true;
      setup.querySelector('input')?.focus();
    }
  },
  tasks: () => go('/tasks'),
  armory: async () => {
    closeModal();
    await go('/armory');
  },
  timers: async () => {
    closeModal();
    await go('/timers');
  },
  achievements: async () => {
    closeModal();
    await go('/achievements');
  },
  account: () => (!pb.authStore.isValid || state.demo ? go('/') : go('/account')),
  demo: () => go('/demo'),
  'exit-demo': () => go('/'),
  'close-dialog': () => closeModal(),
});
