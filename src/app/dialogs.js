// A character's dialogs, opened from its row (cards.js): its Odyle history, where it was last
// seen and its PvP stats. Each view (history.js, places.js, pvp.js) loads with its first opening.
import { t } from '../i18n.js';
import { escape as esc } from '../model.js';
import { state } from './state.js';
import { pb } from './server.js';
import { modal, redraw } from './ui.js';
import { onData } from './actions.js';
import { historyPart, placesPart, pvpPart, demoPart } from './parts.js';
import { followCharacters } from './session.js';

// The history dialog (history.js): the period the reader picks (30 days at first, up to as long
// as the server keeps it), its chart, its weeks and its changes a page at a time. An answer of
// more than 1,000 changes is thinned, so its pages come from the server; otherwise from it.
const changesPerPage = 15;
let historyView = null;
export async function historyDialog(id, name) {
  historyView = { id, name, week: 1 };
  await showHistory(0, null, true);
}
async function showHistory(days = 0, used = null, opening = false) {
  const view = historyView,
    part = opening ? null : document.querySelector('#modal[open] .history-dialog'),
    asked = (view.ask = (view.ask || 0) + 1);
  part?.classList.add('is-loading');
  try {
    // The dialog (history.js) loads with its first opening; the demo's history with the demo.
    const [data] = await Promise.all([
      state.demo
        ? demoPart().then(sample => sample.demoHistory(state.members, view.id, days || 30))
        : pb.send('/api/odyle/history/' + view.id + (days ? '?days=' + days : '')),
      historyPart(),
    ]);
    const changes = await changesOf(view, data, 1);
    if (historyView !== view || view.ask !== asked) return;
    if (!state.demo && data.serverNow) state.serverOffset = Date.parse(data.serverNow) - Date.now();
    Object.assign(view, { data, changes, week: 1 });
    const body = historyHtml();
    if (part) redraw('.history-dialog', `<div class="history-dialog">${body}</div>`, used);
    else
      modal(
        esc(t('{name} · Odyle history', { name: view.name })),
        `<div class="history-dialog">${body}</div>`,
        'wide split',
      );
    historyPart.loaded().bindHistoryChart(document.querySelector('#modal .history-chart'));
    if (used?.dataset?.historyDays)
      document.querySelector(`#modal [data-history-days="${used.dataset.historyDays}"]`)?.focus();
  } finally {
    part?.classList.remove('is-loading');
  }
}
// A page of the changes: from the answer when it lists each one, else from the server.
async function changesOf(view, data, page) {
  if (!data.hourlyBefore) return historyPart.loaded().changesPage(data.readings, page, changesPerPage);
  return pb.send(`/api/odyle/history/${view.id}/changes?days=${data.days}&page=${page}&perPage=${changesPerPage}`);
}
const historyNow = () => Date.now() + state.serverOffset;
const historyHtml = () =>
  historyPart.loaded().historyBody({
    data: { days: 30, ...historyView.data },
    changes: historyView.changes,
    week: historyView.week,
    now: historyNow(),
    cost: state.room?.cost || state.perCube,
    resets: state.resets,
    clock: historyView.data.clock || state.clockRules,
  });
async function historyPage(page, used) {
  const view = historyView,
    part = document.querySelector('#modal .history-changes'),
    asked = (view.ask = (view.ask || 0) + 1);
  part?.classList.add('is-loading');
  try {
    const changes = await changesOf(view, view.data, page);
    if (historyView !== view || view.ask !== asked) return;
    view.changes = changes;
    redraw('.history-changes', historyPart.loaded().changesTable(changes, historyNow()), used);
  } finally {
    part?.classList.remove('is-loading');
  }
}
function historyWeek(page, used) {
  const view = historyView,
    now = historyNow(),
    cost = state.room?.cost || state.perCube,
    { ledgerTable, weeklyLedger } = historyPart.loaded();
  view.week = page;
  redraw(
    '.history-weeks',
    ledgerTable(
      weeklyLedger(view.data.readings, {
        now,
        cost,
        resets: state.resets,
        clock: view.data.clock || state.clockRules,
        character: view.data.character,
      }),
      { hourlyBefore: view.data.hourlyBefore, thinnedTo: view.data.thinnedTo, page },
    ),
    used,
  );
}

// Where a character was last seen and its kept places (places.js), on TH.GL's map, with the
// places a page at a time beside it. The open dialog follows the character: a newer place
// recentres the map, at most every 20 seconds and only while the latest place shows on the
// first page with its pin, so a map the viewer moved stays where they put it.
const placesPerPage = 12;
let placeView = null;
const placesAt = (id, page) => pb.send(`/api/odyle/locations/${id}?page=${page}&perPage=${placesPerPage}`);
export async function locationDialog(id, name) {
  // The dialog (places.js) loads with its first opening.
  const [data] = await Promise.all([placesAt(id, 1), placesPart()]);
  if (data.serverNow) state.serverOffset = Date.parse(data.serverNow) - Date.now();
  state.gameMaps = data.maps || state.gameMaps;
  const own = state.characters.some(c => c.id === id);
  placeView = { id, name, own, data, picked: null, shownAt: 0 };
  modal(esc(t('{name} · Location', { name })), `<div class="place-dialog">${placeBody()}</div>`, 'wide split');
  placeView.shownAt = Date.now();
}
const placeBody = () =>
  placesPart.loaded().locationBody({
    data: placeView.data,
    maps: state.gameMaps,
    name: placeView.name,
    own: placeView.own,
    now: Date.now() + state.serverOffset,
    picked: placeView.picked,
  });
function renderPlace() {
  const el = document.querySelector('#modal .place-dialog');
  if (!el || !placeView) return;
  el.innerHTML = placeBody();
  placeView.shownAt = Date.now();
}
async function placePage(page, used) {
  const view = placeView,
    part = document.querySelector('#modal .place-list'),
    asked = (view.ask = (view.ask || 0) + 1);
  part?.classList.add('is-loading');
  try {
    const data = await placesAt(view.id, page);
    if (placeView !== view || view.ask !== asked) return;
    // The latest place stays the one the dialog heard of last.
    view.data = { ...data, location: view.data.location };
    redraw(
      '.place-list',
      `<div class="place-list">${placesPart.loaded().placeList({ data: view.data, maps: state.gameMaps, now: Date.now() + state.serverOffset, picked: view.picked })}</div>`,
      used,
    );
  } finally {
    part?.classList.remove('is-loading');
  }
}
// Clicking into the embedded map moves focus out of the page: the pin no longer marks the place.
window.addEventListener('blur', () =>
  setTimeout(() => {
    const frame = document.activeElement;
    if (!frame?.matches?.('#modal .place-frame iframe')) return;
    frame.parentElement.classList.add('is-moved');
    frame.parentElement.querySelector('[data-place-back]')?.removeAttribute('hidden');
  }),
);
followCharacters(changed => {
  const c = placeView && changed.find(x => x.id === placeView.id && x.location?.at);
  if (!c || !document.querySelector('#modal .place-dialog') || c.location.at === placeView.data.location?.at) return;
  placeView.data = { ...placeView.data, location: c.location };
  if (
    placeView.picked === null &&
    (placeView.data.page || 1) === 1 &&
    !document.querySelector('#modal .place-frame.is-moved') &&
    Date.now() - placeView.shownAt > 20000
  )
    renderPlace();
});

// A character's PvP stats (pvp.js), for its owner and the rooms it is shared in while its player
// has PvP stats on: the counts of a period, the players it met (sorted and paged here) and its
// latest events, whose pages come from the server.
const pvpEventsPerPage = 12;
let pvpView = null;
const pvpAt = (id, days, page, only = false) =>
  pb.send(
    `/api/odyle/pvp/${id}?page=${page}&perPage=${pvpEventsPerPage}${days ? '&days=' + days : ''}${only ? '&only=events' : ''}`,
  );
export async function pvpDialog(id, name) {
  pvpView = { id, name, own: state.characters.some(c => c.id === id), sort: 'total', page: 1 };
  await showPvp(0, null, true);
}
const pvpHtml = () =>
  pvpPart.loaded().pvpBody({
    data: pvpView.data,
    name: pvpView.name,
    own: pvpView.own,
    now: Date.now() + state.serverOffset,
    sort: pvpView.sort,
    page: pvpView.page,
  });
async function showPvp(days = 0, used = null, opening = false) {
  const view = pvpView,
    part = opening ? null : document.querySelector('#modal[open] .pvp-dialog'),
    asked = (view.ask = (view.ask || 0) + 1);
  part?.classList.add('is-loading');
  try {
    // The dialog (pvp.js) loads with its first opening.
    const [data] = await Promise.all([pvpAt(view.id, days, 1), pvpPart()]);
    if (pvpView !== view || view.ask !== asked) return;
    if (data.serverNow) state.serverOffset = Date.parse(data.serverNow) - Date.now();
    Object.assign(view, { data, page: 1 });
    if (part) redraw('.pvp-dialog', `<div class="pvp-dialog">${pvpHtml()}</div>`, used);
    else modal(esc(t('{name} · PvP', { name: view.name })), `<div class="pvp-dialog">${pvpHtml()}</div>`, 'wide split');
    if (used?.dataset?.pvpDays) document.querySelector(`#modal [data-pvp-days="${used.dataset.pvpDays}"]`)?.focus();
  } finally {
    part?.classList.remove('is-loading');
  }
}
async function pvpEventsPage(page, used) {
  const view = pvpView,
    part = document.querySelector('#modal .pvp-events'),
    asked = (view.ask = (view.ask || 0) + 1);
  part?.classList.add('is-loading');
  try {
    const events = await pvpAt(view.id, view.data.days, page, true);
    if (pvpView !== view || view.ask !== asked) return;
    view.data = {
      ...view.data,
      events: events.events,
      page: events.page,
      pages: events.pages,
      total: events.total,
      perPage: events.perPage,
    };
    redraw(
      '.pvp-events',
      `<div class="pvp-events">${pvpPart.loaded().eventsTable({ data: view.data, now: Date.now() + state.serverOffset })}</div>`,
      used,
    );
  } finally {
    part?.classList.remove('is-loading');
  }
}
// The players table again: another page of it, or another order from its first page.
function pvpPlayers(change, used) {
  Object.assign(pvpView, change);
  redraw(
    '.pvp-players-slot',
    `<div class="pvp-players-slot">${pvpPart.loaded().playersTable({ data: pvpView.data, sort: pvpView.sort, page: pvpView.page, now: Date.now() + state.serverOffset })}</div>`,
    used,
  );
  if (used?.dataset?.pvpSort) document.querySelector(`#modal [data-pvp-sort="${used.dataset.pvpSort}"]`)?.focus();
}

onData({
  historyDays: el => historyView && showHistory(Number(el.dataset.historyDays), el),
  historyPage: el => historyView && historyPage(Number(el.dataset.historyPage), el),
  historyWeek: el => historyView && historyWeek(Number(el.dataset.historyWeek), el),
  place: el => {
    if (!placeView) return;
    placeView.picked = placesPart.loaded().placesOf(placeView.data)[Number(el.dataset.place)] || null;
    return renderPlace();
  },
  placePage: el => placeView && placePage(Number(el.dataset.placePage), el),
  pvpDays: el => pvpView && showPvp(Number(el.dataset.pvpDays), el),
  pvpPage: el => pvpView && pvpEventsPage(Number(el.dataset.pvpPage), el),
  pvpPlayers: el => pvpView && pvpPlayers({ page: Number(el.dataset.pvpPlayers) }, el),
  pvpSort: el => pvpView && pvpPlayers({ sort: el.dataset.pvpSort, page: 1 }, el),
});
onData({ placeBack: () => placeView && renderPlace() }, true);
