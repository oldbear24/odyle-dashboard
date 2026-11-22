// Pages, dialogs and actions that not every visit uses load the first time they are needed, and
// the rest while the browser is idle once the first page is drawn (lazy.js, prefetchParts). A
// part gone with a deploy loads the new build (reloadOnce); meanwhile its caller waits, so no
// error shows for a page that is going away.
//
// The parts of the signed-in dashboard (#192): Rooms & characters (library.js), a room
// (room.js), the checklist (tasks.js), the account page (account.js), the browser's
// notifications (notifications.js) and the pairing dialog (pairing.js), so the public pages
// (welcome, armory, timers) load none of them.
import { lazily, reloadOnce } from '../lazy.js';
import { tabStorage } from './state.js';

export function gone(error) {
  if (!reloadOnce(tabStorage, Date.now(), navigator.onLine !== false)) throw Object.assign(new Error('This part of Odyle could not load. Check your connection, then reload the page.'), { cause: error, part: true });
  location.reload(); return new Promise(() => { /* the new build takes over */ });
}
const lazyPart = load => lazily(load, gone);
export const whatsnewPart = lazyPart(() => import('../parts/whatsnew.js')), privacyPart = lazyPart(() => import('../parts/privacy.js')), helpPart = lazyPart(() => import('../help.js'));
export const armoryPart = lazyPart(() => import('../parts/armory.js')), cardPart = lazyPart(() => import('../parts/card.js')), cardImagePart = lazyPart(() => import('../cardimage.js'));
export const demoPart = lazyPart(() => import('../demo.js')), slotsPart = lazyPart(() => import('../parts/slots.js'));
export const historyPart = lazyPart(() => import('../history.js')), placesPart = lazyPart(() => import('../places.js')), pvpPart = lazyPart(() => import('../pvp.js')), invitesPart = lazyPart(() => import('../invitedialog.js'));
export const discordPart = lazyPart(() => import('../discord.js')), runToolsPart = lazyPart(() => import('../runtools.js'));
export const timersPart = lazyPart(() => import('../parts/timers.js')), achievementsPart = lazyPart(() => import('../parts/achievements.js')), weekPart = lazyPart(() => import('../parts/week.js'));
export const libraryPart = lazyPart(() => import('./library.js')), roomPart = lazyPart(() => import('./room.js')), tasksPart = lazyPart(() => import('./tasks.js'));
export const accountPart = lazyPart(() => import('./account.js')), notificationsPart = lazyPart(() => import('./notifications.js')), pairingPart = lazyPart(() => import('./pairing.js'));
// A part for work in the background (news, the tick): loaded without reloading the page when
// it cannot load, which would drop what a form holds; null then.
export async function quietly(part) { return part.loaded() || (await part.prefetch() ? part.loaded() : null); }
// Once the first page is drawn, the parts it did not need load one after another while the
// browser is idle, unless it asks to save data.
export function prefetchParts() {
  if (navigator.connection?.saveData || /2g/.test(navigator.connection?.effectiveType || '')) return;
  // What's new (it holds the whole changelog, which grows with every release) and the privacy notice come last.
  const queue = [timersPart, achievementsPart, weekPart, armoryPart, cardPart, libraryPart, roomPart, tasksPart, historyPart, placesPart, pvpPart, accountPart, notificationsPart, invitesPart, pairingPart, discordPart, runToolsPart, helpPart, demoPart, slotsPart, cardImagePart, whatsnewPart, privacyPart];
  const idle = next => (window.requestIdleCallback ? requestIdleCallback(next, { timeout: 5000 }) : setTimeout(next, 500));
  const next = () => queue.shift()?.prefetch().then(() => idle(next));
  idle(next);
}
