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
import { onData, onAction, onSubmit, onChange } from './actions.js';
import { armoryPart, cardPart, cardImagePart } from './parts.js';
import { shell } from './shell.js';
import { go } from './router.js';
import { failure } from './session.js';
import { compareShow, compareShown, compareRender, leaveCompare } from './compare.js';
import { aiAccess, aiAllowed, aiShow, aiRender, askAbout } from './armoryai.js';

let armoryServers = null,
  armoryAnswer = null,
  armoryResults = null,
  armoryChosen = null,
  armoryTimer = 0,
  armoryTab = '',
  armoryBoard = '';
export const armoryKey = 'odyle.armory';
export function armoryChoice() {
  try {
    return JSON.parse(storage.getItem(armoryKey)) || {};
  } catch {
    return {};
  }
}
// Bookmarked characters (#72), in this browser only: no account needed, nothing sent anywhere.
const bookmarksKey = 'odyle.armory.bookmarks';
export const bookmarks = () => armoryPart.loaded()?.readBookmarks(storage.getItem(bookmarksKey)) || [];
function keepBookmarks(list) {
  try {
    storage.setItem(bookmarksKey, JSON.stringify(list));
    return true;
  } catch {
    toast(t('This browser does not let Odyle keep bookmarks.'));
    return false;
  }
}
function toggleBookmark() {
  const armory = armoryPart.loaded();
  if (!armory || !armoryAnswer?.profile) return;
  const list = bookmarks(),
    name = armoryAnswer.profile.name,
    marked = armory.isBookmarked(list, armoryAnswer);
  if (!marked && list.length >= armory.bookmarkLimit)
    return toast(t('You can keep up to {n} bookmarks. Remove one first.', { n: armory.bookmarkLimit }));
  if (
    !keepBookmarks(
      marked
        ? armory.removeBookmark(list, `${armoryAnswer.region}/${armoryAnswer.serverId}/${armoryAnswer.characterId}`)
        : armory.addBookmark(list, armoryAnswer, new Date().toISOString()),
    )
  )
    return;
  armoryRender();
  toast(
    marked
      ? t('Removed {name} from your bookmarks.', { name })
      : t('Bookmarked {name}. The armory page lists it.', { name }),
  );
}
// The Upgrade tab's comparison of a profile with other characters of its class
// (backend/odyle/upgrades.go): its next step or the strongest, as last chosen in this browser.
// Kept here by profile and group for five minutes; one that did not load is asked for again after
// half a minute.
const armoryUpgrades = new Map(),
  upgradeGroupKey = 'odyle.armory.upgradeGroup';
let armoryUpgradeGroup = storage.getItem(upgradeGroupKey) === 'top' ? 'top' : 'next';
const upgradeKey = answer =>
  answer?.profile?.class
    ? `${answer.profile.class}|${answer.serverId}|${answer.characterId}|${armoryUpgradeGroup}`
    : '';
function armoryUpgrade() {
  const kept = armoryUpgrades.get(upgradeKey(armoryAnswer));
  return kept?.answer || (kept?.error ? { error: true } : null);
}
async function loadUpgrade(ticket) {
  const key = upgradeKey(armoryAnswer),
    kept = armoryUpgrades.get(key),
    since = Date.now() - (kept?.at || 0);
  if (
    armoryTab !== 'upgrade' ||
    !key ||
    kept?.loading ||
    (kept?.answer && since < 5 * 60000) ||
    (kept?.error && since < 30000)
  )
    return;
  armoryUpgrades.set(key, { ...kept, loading: true });
  const { serverId, characterId, profile } = armoryAnswer;
  try {
    armoryUpgrades.set(key, {
      at: Date.now(),
      answer: await pb.send(`/api/odyle/armory/upgrades/${encodeURIComponent(profile.class)}`, {
        query: { serverId, characterId, group: armoryUpgradeGroup },
      }),
    });
  } catch {
    armoryUpgrades.set(key, { at: Date.now(), answer: kept?.answer, error: !kept?.answer });
  }
  if (ticket === state.navigation && armoryTab === 'upgrade' && upgradeKey(armoryAnswer) === key && !picking())
    armoryRender();
}
// Whether the Compare picker (compare.js) is open over the page: drawing the page again would
// close it, so the page is drawn once the picker closes instead (unless that leaves the page).
let pickerWait = false;
function picking() {
  const dialog = document.querySelector('#modal[open]');
  if (!dialog?.querySelector('.compare-picker')) return false;
  if (!pickerWait) {
    const ticket = state.navigation;
    pickerWait = true;
    dialog.addEventListener(
      'close',
      () => {
        pickerWait = false;
        if (ticket === state.navigation) armoryRender();
      },
      { once: true },
    );
  }
  return true;
}
const armoryRefreshable = () =>
  armoryAnswer?.state === 'fresh' &&
  armoryAnswer.fetchedAt &&
  Date.now() + state.serverOffset - timestamp(armoryAnswer.fetchedAt) > 15 * 60000;
// The armory's images (the game's icons, portraits) come from the backend (armoryimages.go).
export const armoryImages = () => pb.buildURL('/api/odyle/armory-images/');
// The regions with their servers, once fetched, and the profile on screen (app/compare.js).
export const armoryRegions = () => armoryServers || [];
export const armoryShown = () => armoryAnswer;
// The top players page (armory.js armoryTop): the class it shows ('' for the first, null on the
// armory's other pages) and the backend's answer for it (backend/odyle/ranks.go).
let armoryTopClass = null,
  armoryTopAnswer = null,
  armoryAi = false;
export function armoryRender(searching = false) {
  const armory = armoryPart.loaded();
  if (!armory) return;
  if (armoryAi) return aiRender();
  if (compareShown()) return compareRender();
  if (armoryTopClass !== null) {
    shell(armory.armoryTop(armoryTopAnswer, armoryImages(), armoryTopClass), 'armory');
    return retitle(topTitle(armoryTopAnswer?.class || armoryTopClass));
  }
  const chosen = armoryChosen || armoryChoice();
  const now = Date.now() + state.serverOffset,
    marks = bookmarks();
  shell(
    armoryAnswer
      ? armory.armoryProfile(armoryAnswer, now, armoryRefreshable(), armory.isBookmarked(marks, armoryAnswer), {
          tab: armoryTab,
          board: armoryBoard,
          images: armoryImages(),
          upgrade: armoryUpgrade(),
          upgradeGroup: armoryUpgradeGroup,
          ai: aiAllowed(),
        })
      : armory.armorySearch(
          armoryServers || [],
          chosen,
          armoryResults,
          searching,
          marks,
          now,
          armoryImages(),
          aiAllowed(),
        ),
    'armory',
  );
  armory.bindProgress(document.querySelector('.growth-chart'));
  retitle(armoryTitle(armoryAnswer, armoryTab));
}
// While a profile waits for PLAYNC, it is asked for again when the backend says to.
function armoryPoll(path, ticket) {
  if (armoryAnswer && (armoryPart.loaded()?.waiting(armoryAnswer) || armoryAnswer.state === 'failed'))
    armoryTimer = setTimeout(
      () => {
        if (ticket === state.navigation) armoryPage(path, ticket).catch(failure);
      },
      Math.max(2, armoryAnswer.retryAfter || 5) * 1000,
    );
}
// Leaving the armory stops asking for a profile or a comparison that waits.
export const stopArmory = () => {
  clearTimeout(armoryTimer);
  leaveCompare();
};
// A profile's player card (card.js): a page of its own, without the sidebar. The look shown
// is the saved one until its player tries another (cardLook), the picker on the tab last
// opened (cardTab); the card turns until the page is left (animateCard).
let cardLook = {},
  cardTab = 'design',
  cardFlip = null;
function cardRender() {
  const cards = cardPart.loaded(),
    armory = armoryPart.loaded();
  if (!cards || !armory) return;
  app.innerHTML = cards.cardPage(armoryAnswer, {
    images: armoryImages(),
    look: cardLook,
    tab: cardTab,
    status: armoryAnswer.profile ? '' : armory.lookupStatus(armoryAnswer, Date.now() + state.serverOffset, false),
  });
  retitle(cards.cardTitle(armoryAnswer));
  const turning = app.querySelector('.tcg');
  cardFlip = turning ? cards.animateCard(turning) : null;
}
// Another look tried on the card on screen, without drawing it again (it keeps turning).
export function cardPreview(form) {
  const cards = cardPart.loaded();
  if (!cards) return;
  cardLook = cards.formLook(form);
  const look = cards.lookOf(armoryAnswer, cardLook),
    tcg = app.querySelector('.tcg'),
    page = app.querySelector('.card-page');
  if (tcg) {
    const turning = [...tcg.classList].filter(c => c.startsWith('is-'));
    tcg.className = [cards.cardClasses(look), ...turning].join(' ');
    tcg.querySelector('.tcg-body').innerHTML = cards.cardFaces(armoryAnswer, armoryImages(), look);
  }
  if (page) page.className = 'card-page design-' + look.design;
  cards.studioAbout(form);
  const save = form.querySelector('[type="submit"]');
  if (save) save.disabled = cards.sameLook(look, cards.lookOf(armoryAnswer));
}
async function cardShow(path, target, ticket) {
  const { region, serverId, characterId } = target;
  const same =
    armoryAnswer &&
    armoryAnswer.region === region &&
    String(armoryAnswer.serverId) === serverId &&
    armoryAnswer.characterId === characterId;
  if (!same) cardLook = {};
  let answer;
  // The card's page (card.js) loads with it.
  try {
    [answer] = await Promise.all([pb.send(`/api/odyle/armory/${region}/${serverId}/${characterId}`), cardPart()]);
  } catch (error) {
    if (ticket !== state.navigation) return;
    if (error?.status !== 404) throw error;
    armoryAnswer = armoryResults = null;
    armoryRender();
    return toast(t(error.message));
  }
  if (ticket !== state.navigation) return;
  // The same card again (a lookup still waiting for PLAYNC): drawn again only once its profile changed.
  const unchanged =
    same &&
    armoryTab === 'card' &&
    document.querySelector('.tcg') &&
    JSON.stringify(answer.profile) === JSON.stringify(armoryAnswer.profile);
  state.online = true;
  armoryAnswer = answer;
  armoryTab = 'card';
  if (!unchanged) cardRender();
  armoryPoll(path, ticket);
}
// The top players of a class: what was fetched for it shows at once, the backend's answer then.
async function topShow(className, ticket) {
  armoryAnswer = armoryResults = null;
  if (armoryTopAnswer && className && armoryTopAnswer.class !== className) armoryTopAnswer = null;
  armoryRender();
  let answer;
  try {
    answer = await pb.send('/api/odyle/armory/top', { query: className ? { class: className } : {} });
  } catch (error) {
    if (ticket !== state.navigation) return;
    if (error?.status !== 404) throw error;
    armoryTopAnswer = { classes: armoryTopAnswer?.classes || [], class: className, players: [], characters: 0 };
    armoryRender();
    return toast(t(error.message));
  }
  if (ticket !== state.navigation) return;
  state.online = true;
  armoryTopAnswer = answer;
  armoryRender();
}
// A profile, or another tab of the profile on screen.
async function profileShow(path, target, ticket, refresh, armory) {
  const { region, serverId, characterId, tab } = target;
  const same =
    armoryAnswer &&
    armoryAnswer.region === region &&
    String(armoryAnswer.serverId) === serverId &&
    armoryAnswer.characterId === characterId;
  // Another tab of the profile on screen: shown at once, from what was fetched.
  if (same && tab !== armoryTab && !refresh) {
    armoryTab = tab;
    armoryRender();
    loadUpgrade(ticket).catch(failure);
    return armoryPoll(path, ticket);
  }
  if (!same) armoryBoard = '';
  armoryTab = tab;
  let answer;
  try {
    answer = await pb.send(
      `/api/odyle/armory/${region}/${serverId}/${characterId}`,
      refresh ? { query: { refresh: 1 } } : {},
    );
  } catch (error) {
    if (ticket !== state.navigation) return;
    if (error?.status !== 404) throw error;
    armoryAnswer = armoryResults = null;
    armoryRender();
    return toast(t(error.message));
  }
  if (ticket !== state.navigation) return;
  // The same profile again (a lookup's progress), on its own page (not back from a comparison,
  // whose sides have status lines too): only the status line changes, so an item card open on
  // hover or focus stays. While the Compare picker is open over it, the page waits to be drawn
  // again, so the picker stays.
  const status = document.querySelector('main.armory-profile .armory-status');
  const unchanged =
    same &&
    !refresh &&
    status &&
    answer.partial === armoryAnswer.partial &&
    JSON.stringify(answer.profile) === JSON.stringify(armoryAnswer.profile);
  state.online = true;
  armoryAnswer = answer;
  if (answer.profile && !answer.partial && armory.isBookmarked(bookmarks(), answer))
    keepBookmarks(armory.refreshBookmark(bookmarks(), answer));
  if (unchanged) status.outerHTML = armory.lookupStatus(answer, Date.now() + state.serverOffset, armoryRefreshable());
  else if (!(status && picking())) armoryRender();
  loadUpgrade(ticket).catch(failure);
  return armoryPoll(path, ticket);
}
// A search: the text typed (a name or part of one, perhaps with its server or region) in the region
// chosen, on the server chosen or every server; exactly one character of that very name opens its
// profile instead.
async function findShow(target, ticket) {
  const { region, server, name } = target;
  armoryChosen = target;
  try {
    storage.setItem(armoryKey, JSON.stringify({ region, server }));
  } catch {
    /* storage full or blocked */
  }
  armoryRender(true);
  let answer;
  try {
    answer = await pb.send('/api/odyle/armory/search', {
      query: server ? { q: name, server, region } : { q: name, region },
    });
  } catch (error) {
    if (ticket !== state.navigation) return;
    armoryRender();
    throw error;
  }
  if (ticket !== state.navigation) return;
  state.online = true;
  // Exactly one character of that very name: its profile, in place of the search.
  const named = (answer.query?.name || name).toLowerCase(),
    exact = answer.results.filter(hit => hit.name.toLowerCase() === named);
  if (exact.length === 1) return go(profilePath(exact[0]), true);
  armoryResults = answer.results;
  armoryRender();
}
// Whether the signed-in account may ask the AI, asked once a session: the page shows the way to it then.
function aiLink(ticket) {
  if (aiAllowed() || !pb.authStore.isValid) return;
  aiAccess()
    .then(status => {
      if (status?.allowed && ticket === state.navigation && !armoryAi) armoryRender();
    })
    .catch(() => {});
}
export async function armoryPage(path, ticket, refresh = false) {
  clearTimeout(armoryTimer);
  // The armory's pages (armory.js) load with the first of them, beside the servers.
  const [armory] = await Promise.all([
    armoryPart(),
    armoryServers ||
      pb.send('/api/odyle/armory/servers').then(answer => {
        armoryServers = answer.regions;
      }),
  ]);
  if (ticket !== state.navigation) return;
  const target = armoryTarget(path);
  armoryTopClass = target.top ? target.top.class : null;
  armoryAi = Boolean(target.ai);
  if (target.ai) {
    leaveCompare();
    return aiShow(ticket);
  }
  aiLink(ticket);
  if (target.compare) return compareShow(target.compare, ticket);
  leaveCompare();
  if (target.top) return topShow(target.top.class, ticket);
  if (target.card) return cardShow(path, target.card, ticket);
  if (target.profile) return profileShow(path, target.profile, ticket, refresh, armory);
  armoryAnswer = armoryResults = null;
  if (!target.find) {
    armoryChosen = null;
    return armoryRender();
  }
  return findShow(target.find, ticket);
}

// An armory item's or skill's card, open while its tile has focus, closes on Escape too.
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.activeElement?.matches('.armory-gear-slot, .armory-skill, .armory-node'))
    document.activeElement.blur();
});
// A Daevanion board is one stop of the Tab key: the arrow keys, Home and End move between its
// nodes (armoryboard.js nodeStep), and the board's stop stays on the node last moved to.
document.addEventListener('keydown', event => {
  const node = event.target.closest?.('.armory-node');
  if (!node || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const nodes = [...node.parentElement.querySelectorAll(':scope > .armory-node')];
  const to = armoryPart.loaded()?.nodeStep(
    nodes.map(n => ({ row: Number(n.style.gridRowStart), col: Number(n.style.gridColumnStart) })),
    nodes.indexOf(node),
    event.key,
  );
  if (to === undefined || to < 0) return;
  event.preventDefault();
  node.tabIndex = -1;
  nodes[to].tabIndex = 0;
  nodes[to].focus();
});
// The card picker's tabs follow the arrow keys, Home and End.
document.addEventListener('keydown', event => {
  const tab = event.target.closest?.('[data-card-tab]'),
    tabs = tab ? [...tab.parentElement.children] : [];
  const to = { ArrowLeft: tabs.indexOf(tab) - 1, ArrowRight: tabs.indexOf(tab) + 1, Home: 0, End: tabs.length - 1 }[
    event.key
  ];
  if (!tab || to === undefined || event.altKey || event.ctrlKey || event.metaKey) return;
  event.preventDefault();
  const next = tabs[(to + tabs.length) % tabs.length];
  cardTab = next.dataset.cardTab;
  cardPart.loaded()?.openStudioTab(tab.form, cardTab);
  next.focus();
});
// Bookmarks changed in another tab redraw the armory page, but neither the card page (its own page) nor an open dialog (#199).
window.addEventListener('storage', e => {
  if (
    e.key === bookmarksKey &&
    state.shown?.startsWith('/armory') &&
    document.activeElement?.name !== 'name' &&
    !document.querySelector('.card-page, #modal[open]')
  )
    armoryRender();
});

// ---------------------------------------------------------------- Suggestions

// The search box's suggestions (backend/odyle/armoryfind.go): the characters Odyle knows whose name
// holds the text, asked a quarter of a second after it last changed; an answer to older text is
// dropped. The arrow keys move through them, Enter opens the one picked and Escape closes them.
let suggestTimer = 0,
  suggested = [],
  suggestActive = -1,
  suggestFor = '';
const searchBox = () => document.querySelector('#armory-form input[name="name"]');
function showSuggestions() {
  const input = searchBox(),
    list = document.getElementById('armory-suggestions'),
    armory = armoryPart.loaded();
  if (!input || !list || !armory) return;
  const open = suggested.length > 0 && document.activeElement === input;
  list.innerHTML = open ? armory.suggestionList(suggested, armoryImages(), suggestActive) : '';
  list.hidden = !open;
  input.setAttribute('aria-expanded', String(open));
  if (open && suggestActive >= 0) input.setAttribute('aria-activedescendant', 'armory-suggestion-' + suggestActive);
  else input.removeAttribute('aria-activedescendant');
}
function closeSuggestions() {
  clearTimeout(suggestTimer);
  suggested = [];
  suggestActive = -1;
  suggestFor = '';
  showSuggestions();
}
async function suggest(text, region) {
  suggestFor = text;
  if (text.trim().length < 2) {
    suggested = [];
    suggestActive = -1;
    return showSuggestions();
  }
  let results = [];
  try {
    results = (await pb.send('/api/odyle/armory/suggest', { query: { q: text, region } })).results || [];
  } catch {
    /* no suggestions this time */
  }
  if (suggestFor !== text) return;
  suggested = results;
  suggestActive = -1;
  showSuggestions();
}
document.addEventListener('input', e => {
  if (e.target !== searchBox()) return;
  clearTimeout(suggestTimer);
  const text = e.target.value,
    region = e.target.form?.elements.region?.value || '';
  suggestTimer = setTimeout(() => suggest(text, region), 250);
});
document.addEventListener('keydown', e => {
  if (e.target !== searchBox() || !suggested.length || document.getElementById('armory-suggestions')?.hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = suggested.length;
    suggestActive = e.key === 'ArrowDown' ? (suggestActive + 1) % n : (suggestActive - 1 + n) % n;
    showSuggestions();
  } else if (e.key === 'Enter' && suggestActive >= 0) {
    e.preventDefault();
    const hit = suggested[suggestActive];
    closeSuggestions();
    go(profilePath(hit)).catch(failure);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeSuggestions();
  }
});
// A press on a suggestion keeps the focus in the box, so the list stays until the link opens.
document.addEventListener('mousedown', e => {
  if (e.target.closest?.('#armory-suggestions')) e.preventDefault();
});
document.addEventListener('focusin', e => {
  if (e.target === searchBox() && suggested.length) showSuggestions();
});
document.addEventListener('focusout', e => {
  if (e.target === searchBox()) setTimeout(() => document.activeElement !== searchBox() && showSuggestions(), 100);
});

onChange({
  // The search lists the servers of the region chosen, any server first.
  armoryRegion: el => {
    const region = armoryServers?.find(r => r.region === el.value),
      server = el.form?.elements.server;
    if (server && region) server.innerHTML = armoryPart.loaded().serverOptions(region, server.value);
  },
});
onData({
  cardTab: el => {
    cardTab = el.dataset.cardTab;
    return cardPart.loaded()?.openStudioTab(el.form, cardTab);
  },
  armoryUnmark: el => {
    keepBookmarks(armoryPart.loaded().removeBookmark(bookmarks(), el.dataset.armoryUnmark));
    return armoryRender();
  },
  // The Upgrade tab's group: the next step or the strongest.
  armoryUpgradeGroup: el => {
    armoryUpgradeGroup = el.dataset.armoryUpgradeGroup === 'top' ? 'top' : 'next';
    try {
      storage.setItem(upgradeGroupKey, armoryUpgradeGroup);
    } catch {
      /* storage full or blocked */
    }
    armoryRender();
    loadUpgrade(state.navigation).catch(failure);
    return document.querySelector(`[data-armory-upgrade-group="${armoryUpgradeGroup}"]`)?.focus();
  },
  armoryBoard: el => {
    armoryBoard = el.dataset.armoryBoard;
    armoryRender();
    return document.querySelector(`[data-armory-board="${CSS.escape(armoryBoard)}"]`)?.focus();
  },
});
onAction({
  'armory-refresh': () => armoryPage(state.shown, state.navigation, true),
  'ai-ask-about': () => askAbout(armoryAnswer),
  // The Upgrade tab's: the AI's plan for this character, its question waiting to be asked.
  'ai-upgrade-plan': () =>
    askAbout(armoryAnswer, t('What should {name} upgrade first?', { name: armoryAnswer?.profile?.name || '' })),
  'armory-bookmark': () => toggleBookmark(),
  'card-flip': () => cardFlip?.(),
  'card-image': async () => {
    if (armoryAnswer?.profile) {
      const [{ saveCardImage }, cards] = await Promise.all([cardImagePart(), cardPart()]);
      await saveCardImage(armoryAnswer, cards.lookOf(armoryAnswer, cardLook), armoryImages());
      toast(t('The card is saved as a picture in your downloads.'));
    }
  },
});
onSubmit({
  'armory-form': (form, data) => {
    closeSuggestions();
    return go(findPath(data.region, data.server || '', data.name.trim()));
  },
  'card-form': async form => {
    if (!armoryAnswer) return;
    const look = cardPart.loaded().formLook(form);
    armoryAnswer.card = await send('card', {
      region: armoryAnswer.region,
      serverId: Number(armoryAnswer.serverId),
      characterId: armoryAnswer.characterId,
      ...look,
    });
    // Save stays off until another look is tried, once this handler has let the button go.
    cardLook = {};
    setTimeout(() => cardPreview(form));
    toast(t('Card saved. Everyone who opens it sees this look.'));
  },
});
