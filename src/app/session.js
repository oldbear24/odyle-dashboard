// The sign-in and what keeps a signed-in tab current: renewing the token, the 5-second tick,
// the account's own realtime topic and its news, signing in with Discord and signing out.
import { t } from '../i18n.js';
import { escape as esc } from '../model.js';
import { icon } from '../icons.js';
import { visit, bare } from '../routes.js';
import { joinCode, forgetAllInvites } from '../invites.js';
import { forgetPairing } from '../readers.js';
import { applyCharacters, applySeen, applyContact } from '../live.js';
import { signInLink } from '../signin.js';
import { state, storage, remembered, forget, leaveRoomTopic, clearRoom } from './state.js';
import { pb, send } from './server.js';
import { app, toast, modal, failed } from './ui.js';
import { onAction } from './actions.js';
import { libraryPart, roomPart, tasksPart, accountPart, notificationsPart, pairingPart, quietly } from './parts.js';
import { shell, embedded, loadRoomList, loadWindowsRelease, renderAppLinks, renderConnection } from './shell.js';
import { announced, loadAnnouncement, reloadWhenIdle } from './notes.js';
import { reachedAchievements, forgetPages } from './pages.js';
import { show, go, dropNavigation, refreshPage, renderPage, loadingShell, currentPath } from './router.js';

// Tokens last seven days. An open dashboard renews its token every six hours and
// returns to the sign-in page once the server no longer accepts it. A refusal of a request
// sent with a token this browser has since replaced (Sign out everywhere: the account's news
// can come before the answer with the new token) is no such thing, so the token on hand is
// asked first; only its refusal signs out, and an unreachable server keeps the sign-in.
const renewEvery = 6 * 3600000;
let renewedAt = 0;
export async function expired() {
  try {
    await pb.collection('users').authRefresh();
    renewedAt = Date.now();
    return;
  } catch (error) {
    if (![401, 403].includes(error?.status)) return;
  }
  await logout();
  toast(t('Your sign-in expired. Sign in again with Discord.'));
}
export function failure(error) {
  if (error?.status === 401 && pb.authStore.token) return expired();
  failed(error);
}
// Only a refused token ends the sign-in. An unreachable server (a deploy, a restart,
// a network drop) keeps it: the page says so and tries again by itself.
let retryTimer,
  timer = 0,
  lastPulse = 0,
  lastCheck = 0;
// The account this tab runs as once its sign-in was renewed, and whether that is under way (#198).
let signedInAs = '',
  signingIn = false;
// The sign-in renewed: null, or the error that refused it.
export const renewal = () =>
  pb
    .collection('users')
    .authRefresh()
    .then(
      () => null,
      error => error,
    );
// The page draws at once (#186): its frame from the sign-in this browser keeps, with a loading
// state, then its data, fetched while the sign-in is renewed (renewing, when it already started).
export async function authenticated(renewing = null) {
  clearTimeout(retryTimer);
  signingIn = true;
  try {
    // A visit without a page in its URL resumes the last page of this browser.
    if (bare()) visit(remembered().path || '/', true);
    if (!app.childElementCount) loadingShell();
    renewing ||= renewal();
    const page = show(true).then(
        () => null,
        error => error,
      ),
      ticket = state.navigation,
      refused = await renewing;
    if (refused) {
      // The page's own answers go nowhere: a newer navigation leaves them behind.
      dropNavigation();
      return [401, 403].includes(refused?.status) ? logout() : unreachable();
    }
    renewedAt = Date.now();
    state.online = true;
    signedInAs = pb.authStore.record?.id || '';
    clearInterval(timer);
    lastPulse = lastCheck = Date.now();
    timer = setInterval(tick, 5000);
    // A page refused with the token from before the renewal loads again with the new one.
    const trouble = await page;
    if (trouble?.status === 401 && ticket === state.navigation) await show(true).catch(failure);
    else if (trouble) failure(trouble);
  } finally {
    signingIn = false;
  }
  if (!state.roomsKnown)
    loadRoomList().catch(() => {
      /* the switch lists the rooms with the next library visit */
    });
  // Rooms and snapshots carry the announcement; other pages fetch it.
  loadAnnouncement().catch(() => {
    /* the next minute tries again */
  });
}
// News that needs a fetch waits in a hidden tab, which fetches once when it is shown again (tick).
export function later() {
  if (!document.hidden) return false;
  lastPulse = 0;
  return true;
}
// Realtime pushes changes and heartbeats (room.js openRoom, watchOwnTopic), so a page fetches its
// data again only every five minutes, in case something was missed, and every 15 seconds
// while realtime is down. A health check every 15 seconds keeps the connection label
// right while realtime is down or a request failed (a connected realtime stream shows
// the server answers), and the 5-second tick redraws ages and live/stale states. A hidden
// tab only renews its sign-in and keeps run reminders; news it cannot apply in place
// waits (later), and the tab catches up as soon as it is shown.
async function tick() {
  if (!document.hidden)
    loadAnnouncement().catch(() => {
      /* the next minute tries again */
    });
  if (state.busy || state.demo) return;
  quietly(notificationsPart)
    .then(notices => notices?.remindRuns())
    .catch(() => {
      /* the next tick tries again */
    });
  try {
    if (Date.now() - renewedAt >= renewEvery) {
      renewedAt = Date.now();
      await pb.collection('users').authRefresh();
    }
    if (document.hidden) return;
    if (Date.now() - lastPulse >= (state.live ? 300000 : 15000)) {
      lastPulse = lastCheck = Date.now();
      await refreshPage();
    } else if ((!state.live || !state.online) && Date.now() - lastCheck >= 15000) {
      lastCheck = Date.now();
      const back = !state.online;
      await pb.health.check();
      state.online = true;
      // Back after an outage: whatever happened meanwhile.
      if (back) {
        lastPulse = Date.now();
        await refreshPage();
      }
    }
    renderPage();
  } catch (error) {
    if (error?.status === 401) return expired();
    state.online = false;
  } finally {
    renderConnection();
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return reloadWhenIdle();
  if (timer) tick();
  pairingPart.loaded()?.tabShown();
});
function unreachable() {
  clearInterval(timer);
  timer = 0;
  state.online = false;
  shell(
    `<main class="welcome"><div class="eyebrow"><span class="tiny-diamond"></span> ${t('STILL SIGNED IN')}</div><h1>${t('The Odyle server is out of reach')}<span class="mint">.</span></h1><p class="intro">${t('Your sign-in is kept. The dashboard tries again every ten seconds and opens your page as soon as the server answers.')}</p><button class="button secondary" data-action="retry">${t('Try again now')} ${icon('arrow')}</button></main>`,
  );
  retryTimer = setTimeout(() => authenticated().catch(failure), 10000);
}
// The Discord window opens within the click, before anything is awaited, as browsers
// block windows opened later (the SDK opens its own the same way); null when blocked.
function signInWindow() {
  const width = Math.min(1024, window.innerWidth),
    height = Math.min(768, window.innerHeight);
  try {
    return window.open(
      '',
      'popup_window',
      `width=${width},height=${height},top=${(window.innerHeight - height) / 2},left=${(window.innerWidth - width) / 2},resizable,menubar=no`,
    );
  } catch {
    return null;
  }
}
// This page's link to open in another browser when the Discord window cannot work here
// (why: 'blocked', 'interrupted', 'app' or nothing). An invite link keeps its code.
function signInElsewhere(why = '') {
  const here = signInLink(location.href),
    joining = Boolean(joinCode(currentPath()));
  const reason = {
    blocked: t('The Discord sign-in window could not open here.'),
    interrupted: t('The sign-in was interrupted before Discord answered.'),
    app: t('Discord sign-in often fails in browsers built into other apps.'),
  }[why];
  modal(
    t('Open Odyle in your browser'),
    `<p>${reason ? reason + ' ' : ''}${t('Open this link in Safari, Chrome or another browser and sign in there.')}${joining ? ' ' + t('The link keeps your invite: you join the room right after signing in.') : ''}</p><div class="link-copy"><input class="link-field" readonly value="${esc(here)}" aria-label="${esc(t('Link to this page'))}"><button class="button primary" data-copy="${esc(here)}" data-copied="${esc(t('Link copied.'))}">${icon('copy')} ${t('Copy link')}</button></div><p class="signin-tip">${t('In an app, its ⋯ or ⋮ menu or the share button usually has Open in browser.')}${why === 'blocked' ? ' ' + t('On a computer, allow pop-ups for this site and try again.') : ''}</p>`,
  );
}
async function discordLogin() {
  const popup = signInWindow();
  if (!popup) return signInElsewhere('blocked');
  document.querySelector('.signin-help')?.removeAttribute('hidden');
  let auth;
  try {
    auth = await pb.collection('users').authWithOAuth2({
      provider: 'discord',
      createData: { displayName: 'Adventurer' },
      urlCallback: url => {
        popup.location.href = url;
      },
    });
  } catch (error) {
    popup.close();
    const methods = await pb.collection('users').listAuthMethods();
    if (!methods.oauth2?.providers?.some(p => p.name === 'discord'))
      return toast(t('Discord sign-in needs backend configuration. See docs/discord-setup.md.'));
    // The page lost its realtime connection while Discord had the window, as a phone does with pages in the background.
    if (error?.originalError?.message === 'realtime connection interrupted') return signInElsewhere('interrupted');
    throw error;
  }
  popup.close();
  // The Discord name replaces the placeholder of a new account; the profile route checks it.
  if (auth.record.displayName === 'Adventurer' && auth.meta?.name) {
    try {
      pb.authStore.save(
        pb.authStore.token,
        (await send('profile', { displayName: String(auth.meta.name).slice(0, 40) })).record,
      );
    } catch {
      /* keeps Adventurer; Account & data renames it */
    }
  }
  await authenticated();
}
export async function logout() {
  // Invite codes stay usable for up to a week and pairing codes for five minutes; a shared computer must not keep them.
  signedInAs = '';
  await leaveRoomTopic();
  await unwatchOwnTopic();
  clearInterval(timer);
  timer = 0;
  clearTimeout(retryTimer);
  pairingPart.loaded()?.stopPairing();
  pb.authStore.clear();
  forget();
  forgetAllInvites(storage);
  forgetPairing(storage);
  clearRoom();
  Object.assign(state, { rooms: [], roomsKnown: false, characters: [], readers: [], account: null, online: false });
  tasksPart.loaded()?.forgetTasks();
  // The account's achievements and week stay with it, not with the next one signing in here.
  forgetPages();
  await go('/', true);
}

// The account's own topic while signed in: its characters, rooms, tasks and Windows apps
// changed, or its readers sent heartbeats. A page fetches its data again when the
// realtime connection comes back, as news may have been missed meanwhile.
let ownTopic = null,
  ownTopicUser = '',
  connectTopic = null,
  connects = 0,
  disconnected;
const startedReaders = new Set();
// The task badge in the navigation; the checklist page loads the tasks itself (tasks.js).
const primeTasks = () => quietly(tasksPart).then(tasks => tasks?.primeTasks());
export async function watchOwnTopic() {
  const id = pb.authStore.record?.id;
  if (!id || ownTopicUser === id) return;
  await unwatchOwnTopic();
  ownTopicUser = id;
  try {
    connects = pb.realtime.isConnected ? 1 : 0;
    connectTopic = await pb.realtime.subscribe('PB_CONNECT', () => {
      clearTimeout(disconnected);
      state.live = true;
      if (connects++ > 0 && !later())
        refreshPage().then(renderPage, () => {
          state.online = false;
          renderConnection();
        });
    });
    ownTopic = await pb.realtime.subscribe('odyle.user.' + id, data => ownNews(data));
    if (state.shown !== '/tasks') primeTasks();
    if (pb.realtime.isConnected) state.live = true;
  } catch {
    ownTopicUser = '';
    state.live = false;
  }
}
export async function unwatchOwnTopic() {
  const stops = [ownTopic, connectTopic].filter(Boolean);
  ownTopic = connectTopic = null;
  ownTopicUser = '';
  state.live = false;
  for (const stop of stops)
    await stop().catch(() => {
      /* already gone */
    });
}
// A connection that stays away for three seconds counts as lost: pages fetch every 15 seconds until it is back.
pb.realtime.onDisconnect = active => {
  if (active.length) {
    clearTimeout(disconnected);
    disconnected = setTimeout(() => {
      state.live = false;
    }, 3000);
  }
};
// Characters changed in the account's or the room's news, for the dialogs that follow one (places).
const followers = [];
export const followCharacters = follow => {
  followers.push(follow);
};
export const charactersChanged = changed => {
  for (const follow of followers) follow(changed);
};
// On My rooms & characters, a character saved meanwhile (by the reader) is offered to the rooms
// that do not show it yet (library.js).
async function offerNew(known) {
  for (const c of state.characters.filter(x => !known.has(x.id) && x.characterName))
    await (await quietly(libraryPart))?.newCharacterPrompt(c);
}
async function ownNews(data) {
  if (state.demo || !data) return;
  const library = !state.room && !['/tasks', '/account', '/timers', '/achievements', '/week'].includes(state.shown);
  try {
    // News for everyone: a changed announcement shows at once, and a new Windows release
    // refreshes the download links and says so.
    announced(data);
    if (data.release?.version) {
      state.windowsReleaseAt = 0;
      await loadWindowsRelease();
      renderAppLinks();
      toast(
        t('Odyle for Windows {version} is out. Running apps update themselves.', { version: data.release.version }),
      );
    }
    // The open room hears of its own changes on its topic.
    // On My rooms & characters, a character saved meanwhile (by the reader) is offered to the rooms
    // that do not show it yet, after fetching again: rooms that share new characters have it now.
    const known = new Set(state.characters.map(c => c.id)),
      offer = async () => {
        if (library && known.size + state.rooms.length) await offerNew(known);
      };
    if (data.refresh) {
      if (state.shown !== '/tasks') primeTasks();
      if (!state.room && !later()) {
        await refreshPage();
        await offer();
      }
    } else if (
      Array.isArray(data.characters) &&
      !applyCharacters(state.characters, data.characters) &&
      library &&
      !later()
    ) {
      await refreshPage();
      await offer();
    }
    if (Array.isArray(data.characters)) charactersChanged(data.characters);
    if (data.seen) applySeen(data.seen, state.characters);
    await notify(data);
    if (Array.isArray(data.achievements) && data.achievements.length) await reachedAchievements(data.achievements);
    // Notification settings saved in another tab or app.
    // An open dialog (a typed confirmation) stays; the page is drawn again once it closes (#199).
    if (data.notifications) {
      notificationsPart.loaded()?.remindAgain();
      state.notificationsSeen = data.notifications;
      if (state.account) {
        state.account.notifications = data.notifications;
        if (state.shown === '/account' && !later()) accountPart.loaded()?.newsArrived();
      }
    }
    if (data.contact) {
      applyContact(data.contact, state.account?.apps);
      applyContact(data.contact, state.readers);
      // A reader started since the room was fetched: the snapshot names its PC (other pages hear of it as news).
      const started = Object.keys(data.contact).filter(
        id => !state.readers.some(r => r.sessionId === id) && !startedReaders.has(id),
      );
      if (state.room && started.length && !later()) {
        started.forEach(id => startedReaders.add(id));
        await (await roomPart()).refreshRoom();
      }
    }
    // An open pairing dialog looks whether its PC paired or reads now; a hidden tab looks once it is shown.
    if (data.refresh || data.characters) pairingPart.loaded()?.pairingNews();
    renderPage();
  } catch (error) {
    if (error?.status === 401) return expired();
    state.online = false;
    renderConnection();
  }
}
// Cap alerts of the account's characters (the job checked the quiet hours), parties ready and
// run invitations, as notifications of this browser (notifications.js).
async function notify(data) {
  const kinds = [
    ['capAlerts', 'showCapAlerts'],
    ['partyReady', 'showPartyReady'],
    ['invites', 'showInvites'],
  ].filter(([key]) => Array.isArray(data[key]));
  if (!kinds.length) return;
  const notices = await quietly(notificationsPart);
  for (const [key, call] of kinds) await notices?.[call](data[key]);
}
// Signing out or in another tab of this browser (#198). The SDK's auth store has already taken
// the change from localStorage (its own storage listener came first); its onChange also fires for
// this tab's renewals and sign-ins, so the storage event, which only other tabs cause, decides.
window.addEventListener('storage', e => {
  if (e.key !== 'odyle.account' && e.key !== null) return;
  const user = pb.authStore.isValid ? pb.authStore.record?.id || '' : '';
  if (!user) {
    if (signedInAs || timer) logout().then(() => toast(t('You signed out in another tab.')), failure);
    return;
  }
  if (signedInAs && signedInAs !== user) return location.reload(); // another account took over
  if (!signedInAs && !timer && !signingIn) authenticated().catch(failure);
});

onAction({
  discord: () => discordLogin(),
  retry: () => authenticated(),
  'open-elsewhere': () => signInElsewhere(embedded() ? 'app' : ''),
  logout: () => logout(),
});
