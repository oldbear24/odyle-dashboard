// The armory (armory.js): public, signed in or not. The servers come from the backend once;
// the region and server last searched are kept per browser. A profile still waiting for
// PLAYNC asks again when the backend says to, while it stays on screen. Its tabs have their
// own paths but show the profile already fetched; the Daevanion board shown is kept per page.
// A profile's player card (card.js) is a page of its own.
import { t } from '../i18n.js';
import { timestamp } from '../model.js';
import { retitle } from '../routes.js';
import { armoryTarget, armoryTitle, topTitle, profilePath, findPath } from '../armorylinks.js';
import { state, storage } from './state.js';
import { pb, send } from './server.js';
import { app, toast } from './ui.js';
import { onData, onAction, onSubmit } from './actions.js';
import { armoryPart, cardPart, cardImagePart } from './parts.js';
import { shell } from './shell.js';
import { go } from './router.js';
import { failure } from './session.js';

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
  const list = bookmarks(), name = armoryAnswer.profile.name, marked = armory.isBookmarked(list, armoryAnswer);
  if (!marked && list.length >= armory.bookmarkLimit) return toast(t('You can keep up to {n} bookmarks. Remove one first.', { n: armory.bookmarkLimit }));
  if (!keepBookmarks(marked ? armory.removeBookmark(list, `${armoryAnswer.region}/${armoryAnswer.serverId}/${armoryAnswer.characterId}`) : armory.addBookmark(list, armoryAnswer, new Date().toISOString()))) return;
  armoryRender(); toast(marked ? t('Removed {name} from your bookmarks.', { name }) : t('Bookmarked {name}. The armory page lists it.', { name }));
}
// The Upgrade tab's comparison of a profile with the strongest other characters of its class
// (backend/odyle/upgrades.go), kept here by profile for five minutes; one that did not load is
// asked for again after half a minute.
const armoryUpgrades = new Map();
const upgradeKey = answer => answer?.profile?.class ? `${answer.profile.class}|${answer.serverId}|${answer.characterId}` : '';
function armoryUpgrade() {
  const kept = armoryUpgrades.get(upgradeKey(armoryAnswer));
  return kept?.answer || (kept?.error ? { error: true } : null);
}
async function loadUpgrade(ticket) {
  const key = upgradeKey(armoryAnswer), kept = armoryUpgrades.get(key), since = Date.now() - (kept?.at || 0);
  if (armoryTab !== 'upgrade' || !key || kept?.loading || kept?.answer && since < 5 * 60000 || kept?.error && since < 30000) return;
  armoryUpgrades.set(key, { ...kept, loading: true });
  const { serverId, characterId, profile } = armoryAnswer;
  try { armoryUpgrades.set(key, { at: Date.now(), answer: await pb.send(`/api/odyle/armory/upgrades/${encodeURIComponent(profile.class)}`, { query: { serverId, characterId } }) }); }
  catch { armoryUpgrades.set(key, { at: Date.now(), answer: kept?.answer, error: !kept?.answer }); }
  if (ticket === state.navigation && armoryTab === 'upgrade' && upgradeKey(armoryAnswer) === key) armoryRender();
}
const armoryRefreshable = () => armoryAnswer?.state === 'fresh' && armoryAnswer.fetchedAt && Date.now() + state.serverOffset - timestamp(armoryAnswer.fetchedAt) > 15 * 60000;
// The armory's images (the game's icons, portraits) come from the backend (armoryimages.go).
export const armoryImages = () => pb.buildURL('/api/odyle/armory-images/');
// The top players page (armory.js armoryTop): the class it shows ('' for the first, null on the
// armory's other pages) and the backend's answer for it (backend/odyle/ranks.go).
let armoryTopClass = null, armoryTopAnswer = null;
export function armoryRender(searching = false) {
  const armory = armoryPart.loaded(); if (!armory) return;
  if (armoryTopClass !== null) { shell(armory.armoryTop(armoryTopAnswer, armoryImages(), armoryTopClass), 'armory'); return retitle(topTitle(armoryTopAnswer?.class || armoryTopClass)); }
  const chosen = armoryChosen || armoryChoice();
  const now = Date.now() + state.serverOffset, marks = bookmarks();
  shell(armoryAnswer ? armory.armoryProfile(armoryAnswer, now, armoryRefreshable(), armory.isBookmarked(marks, armoryAnswer), { tab: armoryTab, board: armoryBoard, images: armoryImages(), upgrade: armoryUpgrade() }) : armory.armorySearch(armoryServers || [], chosen, armoryResults, searching, marks, now, armoryImages()), 'armory');
  retitle(armoryTitle(armoryAnswer, armoryTab));
}
// While a profile waits for PLAYNC, it is asked for again when the backend says to.
function armoryPoll(path, ticket) {
  if (armoryAnswer && (armoryPart.loaded()?.waiting(armoryAnswer) || armoryAnswer.state === 'failed')) armoryTimer = setTimeout(() => { if (ticket === state.navigation) armoryPage(path, ticket).catch(failure); }, Math.max(2, armoryAnswer.retryAfter || 5) * 1000);
}
// Leaving the armory stops asking for a profile that waits.
export const stopArmory = () => clearTimeout(armoryTimer);
// A profile's player card (card.js): a page of its own, without the sidebar. The look shown
// is the saved one until its player tries another (cardLook), the picker on the tab last
// opened (cardTab); the card turns until the page is left (animateCard).
let cardLook = {}, cardTab = 'design', cardFlip = null;
function cardRender() {
  const cards = cardPart.loaded(), armory = armoryPart.loaded(); if (!cards || !armory) return;
  app.innerHTML = cards.cardPage(armoryAnswer, { images: armoryImages(), look: cardLook, tab: cardTab, status: armoryAnswer.profile ? '' : armory.lookupStatus(armoryAnswer, Date.now() + state.serverOffset, false) });
  retitle(cards.cardTitle(armoryAnswer));
  const turning = app.querySelector('.tcg');
  cardFlip = turning ? cards.animateCard(turning) : null;
}
// Another look tried on the card on screen, without drawing it again (it keeps turning).
export function cardPreview(form) {
  const cards = cardPart.loaded(); if (!cards) return;
  cardLook = cards.formLook(form);
  const look = cards.lookOf(armoryAnswer, cardLook), tcg = app.querySelector('.tcg'), page = app.querySelector('.card-page');
  if (tcg) {
    const turning = [...tcg.classList].filter(c => c.startsWith('is-'));
    tcg.className = [cards.cardClasses(look), ...turning].join(' ');
    tcg.querySelector('.tcg-body').innerHTML = cards.cardFaces(armoryAnswer, armoryImages(), look);
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
  catch (error) { if (ticket !== state.navigation) return; if (error?.status !== 404) throw error; armoryAnswer = armoryResults = null; armoryRender(); return toast(t(error.message)); }
  if (ticket !== state.navigation) return;
  // The same card again (a lookup still waiting for PLAYNC): drawn again only once its profile changed.
  const unchanged = same && armoryTab === 'card' && document.querySelector('.tcg') && JSON.stringify(answer.profile) === JSON.stringify(armoryAnswer.profile);
  state.online = true; armoryAnswer = answer; armoryTab = 'card';
  if (!unchanged) cardRender();
  armoryPoll(path, ticket);
}
// The top players of a class: what was fetched for it shows at once, the backend's answer then.
async function topShow(className, ticket) {
  armoryAnswer = armoryResults = null;
  if (armoryTopAnswer && className && armoryTopAnswer.class !== className) armoryTopAnswer = null;
  armoryRender();
  let answer;
  try { answer = await pb.send('/api/odyle/armory/top', { query: className ? { class: className } : {} }); }
  catch (error) { if (ticket !== state.navigation) return; if (error?.status !== 404) throw error; armoryTopAnswer = { classes: armoryTopAnswer?.classes || [], class: className, players: [], characters: 0 }; armoryRender(); return toast(t(error.message)); }
  if (ticket !== state.navigation) return;
  state.online = true; armoryTopAnswer = answer; armoryRender();
}
// A profile, or another tab of the profile on screen.
async function profileShow(path, target, ticket, refresh, armory) {
  const { region, serverId, characterId, tab } = target;
  const same = armoryAnswer && armoryAnswer.region === region && String(armoryAnswer.serverId) === serverId && armoryAnswer.characterId === characterId;
  // Another tab of the profile on screen: shown at once, from what was fetched.
  if (same && tab !== armoryTab && !refresh) { armoryTab = tab; armoryRender(); loadUpgrade(ticket).catch(failure); return armoryPoll(path, ticket); }
  if (!same) armoryBoard = '';
  armoryTab = tab;
  let answer;
  try { answer = await pb.send(`/api/odyle/armory/${region}/${serverId}/${characterId}`, refresh ? { query: { refresh: 1 } } : {}); }
  catch (error) { if (ticket !== state.navigation) return; if (error?.status !== 404) throw error; armoryAnswer = armoryResults = null; armoryRender(); return toast(t(error.message)); }
  if (ticket !== state.navigation) return;
  // The same profile again (a lookup's progress): only the status line changes, so an item
  // card open on hover or focus stays.
  const unchanged = same && !refresh && document.querySelector('.armory-status') && answer.partial === armoryAnswer.partial && JSON.stringify(answer.profile) === JSON.stringify(armoryAnswer.profile);
  state.online = true; armoryAnswer = answer;
  if (answer.profile && !answer.partial && armory.isBookmarked(bookmarks(), answer)) keepBookmarks(armory.refreshBookmark(bookmarks(), answer));
  if (unchanged) document.querySelector('.armory-status').outerHTML = armory.lookupStatus(answer, Date.now() + state.serverOffset, armoryRefreshable());
  else armoryRender();
  loadUpgrade(ticket).catch(failure);
  return armoryPoll(path, ticket);
}
// A search by name; exactly one character of that very name opens its profile instead.
async function findShow(target, ticket) {
  const { region, server, name } = target;
  armoryChosen = target;
  try { storage.setItem(armoryKey, JSON.stringify({ region, server })); } catch { /* storage full or blocked */ }
  armoryRender(true);
  let results;
  try { results = (await pb.send('/api/odyle/armory/search', { query: { name, server, region } })).results; }
  catch (error) { if (ticket !== state.navigation) return; armoryRender(); throw error; }
  if (ticket !== state.navigation) return;
  state.online = true;
  // Exactly one character of that very name: its profile, in place of the search.
  const exact = results.filter(hit => hit.name.toLowerCase() === name.toLowerCase());
  if (exact.length === 1) return go(profilePath(exact[0]), true);
  armoryResults = results; armoryRender();
}
export async function armoryPage(path, ticket, refresh = false) {
  clearTimeout(armoryTimer);
  // The armory's pages (armory.js) load with the first of them, beside the servers.
  const [armory] = await Promise.all([armoryPart(), armoryServers || pb.send('/api/odyle/armory/servers').then(answer => { armoryServers = answer.regions; })]);
  if (ticket !== state.navigation) return;
  const target = armoryTarget(path);
  armoryTopClass = target.top ? target.top.class : null;
  if (target.top) return topShow(target.top.class, ticket);
  if (target.card) return cardShow(path, target.card, ticket);
  if (target.profile) return profileShow(path, target.profile, ticket, refresh, armory);
  armoryAnswer = armoryResults = null;
  if (!target.find) { armoryChosen = null; return armoryRender(); }
  return findShow(target.find, ticket);
}

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
// Bookmarks changed in another tab redraw the armory page, but neither the card page (its own page) nor an open dialog (#199).
window.addEventListener('storage', e => { if (e.key === bookmarksKey && state.shown?.startsWith('/armory') && document.activeElement?.name !== 'name' && !document.querySelector('.card-page, #modal[open]')) armoryRender(); });

onData({
  cardTab: el => { cardTab = el.dataset.cardTab; return cardPart.loaded()?.openStudioTab(el.form, cardTab); },
  armoryUnmark: el => { keepBookmarks(armoryPart.loaded().removeBookmark(bookmarks(), el.dataset.armoryUnmark)); return armoryRender(); },
  armoryBoard: el => { armoryBoard = el.dataset.armoryBoard; armoryRender(); return document.querySelector(`[data-armory-board="${CSS.escape(armoryBoard)}"]`)?.focus(); },
});
onAction({
  'armory-refresh': () => armoryPage(state.shown, state.navigation, true),
  'armory-bookmark': () => toggleBookmark(),
  'card-flip': () => cardFlip?.(),
  'card-image': async () => { if (armoryAnswer?.profile) { const [{ saveCardImage }, cards] = await Promise.all([cardImagePart(), cardPart()]); await saveCardImage(armoryAnswer, cards.lookOf(armoryAnswer, cardLook), armoryImages()); toast(t('The card is saved as a picture in your downloads.')); } },
});
onSubmit({
  'armory-form': (form, data) => go(findPath(data.region, data.server, data.name.trim())),
  'card-form': async (form) => {
    if (!armoryAnswer) return;
    const look = cardPart.loaded().formLook(form);
    armoryAnswer.card = await send('card', { region: armoryAnswer.region, serverId: Number(armoryAnswer.serverId), characterId: armoryAnswer.characterId, ...look });
    // Save stays off until another look is tried, once this handler has let the button go.
    cardLook = {}; setTimeout(() => cardPreview(form)); toast(t('Card saved. Everyone who opens it sees this look.'));
  },
});
