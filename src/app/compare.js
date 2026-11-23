// Two armory characters side by side (compare.js): /armory/<left>/compare/<right>. Each side is
// fetched through the armory's profile route and, while it waits for PLAYNC, asked for again
// when the backend says to, as a profile is (app/armory.js); profiles fetched here are kept
// for the page so trading places or picking again shows them at once. The picker, opened by a
// profile's Compare or a side's "Pick another", lists the browser's bookmarks, the strongest
// characters of the class and a search like the armory's own.
import { t } from '../i18n.js';
import { escape as esc } from '../model.js';
import { retitle } from '../routes.js';
import { comparePath, compareTitle } from '../armorylinks.js';
import { state, storage } from './state.js';
import { pb } from './server.js';
import { app, modal, redraw, closeModal } from './ui.js';
import { onData, onAction, onSubmit, onChange } from './actions.js';
import { armoryPart } from './parts.js';
import { shell } from './shell.js';
import { go } from './router.js';
import { failure } from './session.js';
import { armoryImages, armoryRegions, armoryShown, armoryChoice, armoryKey, bookmarks } from './armory.js';

const keyOf = at => `${at.region}/${at.serverId}/${at.characterId}`;
// The two sides on screen ({ target, key, answer, error }), null while no comparison is.
let sides = null;
const timers = [0, 0],
  kept = new Map();

// The last profiles fetched here, at most 20.
function keep(key, answer) {
  kept.delete(key);
  kept.set(key, answer);
  if (kept.size > 20) kept.delete(kept.keys().next().value);
}
export const compareShown = () => sides !== null;
export function stopCompare() {
  timers.forEach(clearTimeout);
}
// Leaving the comparison for another armory page or anywhere else.
export function leaveCompare() {
  stopCompare();
  sides = null;
}

export function compareRender() {
  const compare = armoryPart.loaded();
  if (!compare || !sides) return;
  const html = compare.comparePage(sides, { images: armoryImages(), now: Date.now() + state.serverOffset }),
    shown = app.querySelector('main.armory-compare');
  // An open picker stays open: only the page under it is drawn again.
  if (shown && document.querySelector('#modal[open]')) shown.outerHTML = html;
  else shell(html, 'armory');
  retitle(compareTitle(sides[0].answer, sides[1].answer));
}

// A side waiting for PLAYNC is asked for again when the backend says to.
function poll(index, ticket) {
  const answer = sides?.[index]?.answer;
  if (answer && (armoryPart.loaded()?.waiting(answer) || answer.state === 'failed'))
    timers[index] = setTimeout(
      () => {
        if (ticket === state.navigation) loadSide(index, ticket).catch(failure);
      },
      Math.max(2, answer.retryAfter || 5) * 1000,
    );
}

async function loadSide(index, ticket) {
  const side = sides[index],
    { region, serverId, characterId } = side.target;
  let answer;
  try {
    answer = await pb.send(`/api/odyle/armory/${region}/${serverId}/${characterId}`);
  } catch (error) {
    if (ticket !== state.navigation || sides?.[index] !== side) return;
    if (error?.status !== 404) throw error;
    side.answer = null;
    side.error = error.message;
    return compareRender();
  }
  if (ticket !== state.navigation || sides?.[index] !== side) return;
  state.online = true;
  // The same profile again (a lookup's progress): only its status line changes, so an item
  // card open on hover or focus stays.
  const status = app.querySelector(`[data-compare-status="${index}"]`),
    unchanged =
      status &&
      side.answer &&
      answer.partial === side.answer.partial &&
      JSON.stringify(answer.profile) === JSON.stringify(side.answer.profile);
  side.answer = answer;
  side.error = '';
  keep(side.key, answer);
  if (unchanged) status.innerHTML = armoryPart.loaded().lookupStatus(answer, Date.now() + state.serverOffset, false);
  else compareRender();
  poll(index, ticket);
}

// The comparison a path names: what was fetched of either side shows at once, then both
// profiles as the backend answers them.
export async function compareShow(target, ticket) {
  stopCompare();
  sides = target.map(at => ({ target: at, key: keyOf(at), answer: kept.get(keyOf(at)) || null, error: '' }));
  compareRender();
  await Promise.all([0, 1].map(index => loadSide(index, ticket)));
}

// ---------------------------------------------------------------- The picker

// What the picker shows: the character kept (base, with its name and class), the side the
// pick takes (0 left, 1 right), the strongest of base's class and the search's results.
let picker = null;
const tops = new Map();
function pickerView() {
  return {
    ...picker,
    bookmarks: bookmarks(),
    regions: armoryRegions(),
    images: armoryImages(),
  };
}
function drawPicker(part = '') {
  const compare = armoryPart.loaded();
  if (!compare || !picker) return;
  if (part === 'top' && document.querySelector('#modal[open] .compare-picker'))
    return redraw('.compare-picker-top', compare.comparePickerTop(pickerView()));
  if (part === 'results' && document.querySelector('#modal[open] .compare-picker'))
    return redraw('.compare-picker-results', compare.comparePickerResults(pickerView()));
  if (part) return;
  modal(
    esc(picker.base.name ? t('Compare {name} with…', { name: picker.base.name }) : t('Compare with…')),
    compare.comparePicker(pickerView()),
    'wide',
  );
}
// The strongest of the class, kept for a minute.
async function loadTop(className) {
  const known = tops.get(className);
  if (known && Date.now() - known.at < 60000) {
    picker.top = known.answer;
    return drawPicker('top');
  }
  let answer;
  try {
    answer = await pb.send('/api/odyle/armory/top', { query: { class: className } });
    tops.set(className, { at: Date.now(), answer });
  } catch {
    answer = { error: true };
  }
  if (picker?.base.class !== className) return;
  picker.top = answer;
  drawPicker('top');
}
async function openPicker(base, side) {
  await armoryPart();
  picker = { base, side, top: null, results: null, searching: false, chosen: armoryChoice() };
  drawPicker();
  document.querySelector('#modal .compare-picker button, #modal .compare-picker select')?.focus();
  if (base.class) await loadTop(base.class);
}
const baseOf = answer => ({
  region: answer.region,
  serverId: answer.serverId,
  characterId: answer.characterId,
  name: answer.profile?.name || '',
  class: answer.profile?.class || '',
});

onAction({
  // A profile's Compare: the profile stays on the left.
  'armory-compare': () => {
    const answer = armoryShown();
    if (!answer?.profile) return;
    keep(keyOf(answer), answer);
    return openPicker(baseOf(answer), 1);
  },
  'compare-swap': () => sides && go(comparePath(sides[1].target, sides[0].target)),
});
onData({
  // Another character for one side: the other side stays.
  compareChange: el => {
    if (!sides) return;
    const index = Number(el.dataset.compareChange),
      other = sides[1 - index];
    return openPicker(other.answer ? baseOf(other.answer) : { ...other.target, name: '', class: '' }, index);
  },
  comparePick: el => {
    if (!picker) return;
    const [region, serverId, ...id] = el.dataset.comparePick.split('/'),
      pick = { region, serverId, characterId: id.join('/') };
    const path = picker.side === 0 ? comparePath(pick, picker.base) : comparePath(picker.base, pick);
    picker = null;
    closeModal();
    return go(path);
  },
});
onChange({
  // The picker's search lists the servers of the region chosen.
  compareRegion: el => {
    const region = armoryRegions().find(r => r.region === el.value),
      server = el.form?.elements.server;
    if (server) server.innerHTML = armoryPart.loaded().compareServerOptions(region);
  },
});
onSubmit({
  'compare-search': async (form, data) => {
    if (!picker) return;
    const { region, server } = data,
      name = data.name.trim();
    picker.chosen = { region, server };
    try {
      storage.setItem(armoryKey, JSON.stringify({ region, server }));
    } catch {
      /* storage full or blocked */
    }
    picker.searching = true;
    drawPicker('results');
    try {
      picker.results = (await pb.send('/api/odyle/armory/search', { query: { name, server, region } })).results;
    } finally {
      if (picker) {
        picker.searching = false;
        drawPicker('results');
      }
    }
  },
});
