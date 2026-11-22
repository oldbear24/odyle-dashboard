// A room (/room/<id>) and the demo workspace: its party, board, planned runs and wishlist, kept
// current by the room's realtime topics, and Room settings. Loads with the page (parts.js).
import { t, tn, locale, language } from '../i18n.js';
import { status, escape as esc, timestamp, canonical, stable } from '../model.js';
import { icon } from '../icons.js';
import { address } from '../routes.js';
import { clockOf } from '../clock.js';
import { runReadiness, broughtBy, earliestClaim, callable } from '../runready.js';
import { weekLine, runsSection, discordText, runParty } from '../runs.js';
import { wishProblem, runProblem, moved } from '../forms.js';
import { applyRoomCharacters, applySeen, applyShared, applyMembership } from '../live.js';
import { party as partyOf, explain, character as readinessOf } from '../readiness.js';
import { partySummary, readyOrder, byPlayer, inGame } from '../partyview.js';
import { dungeonKey, entryOf, cubeCost, dungeonFacts, dungeonField } from '../catalog.js';
import { boardSection, boardForm } from '../board.js';
import { featureOn, featuresForm, changedFeatures } from '../roomfeatures.js';
import { setupTracker } from '../setup.js';
import { lookName } from '../looks.js';
import { forgetInvites } from '../invites.js';
import { state, storage, forget, clearRoom, leaveRoomTopic } from './state.js';
import { pb, send, me, owner, manager, mine } from './server.js';
import {
  toast,
  modal,
  ask,
  formError,
  closeModal,
  signInPrompt,
  keepingDrafts,
  updateAges,
  copyText,
  download,
} from './ui.js';
import { onData, onAction, onSubmit, onChange } from './actions.js';
import { demoPart, discordPart, runToolsPart } from './parts.js';
import { shell, roleName, appLink, readerNow, loadRoomList, renderConnection } from './shell.js';
import { announced } from './notes.js';
import { go, renderPage } from './router.js';
import { failure, later, charactersChanged } from './session.js';
import { card, flattened, listHead, clockState, shareNewChip } from './cards.js';

// Whether the room owner left a part of the room on (roomfeatures.js): board, runs, wishlist, week.
const on = feature => featureOn(state.room, feature);
// Only live characters on the room page, a choice of this browser.
const liveOnlyKey = 'odyle.liveOnly',
  liveOnly = () => storage.getItem(liveOnlyKey) === 'on';
function addBar() {
  if (me()?.role === 'viewer')
    return `<div class="sharing-bar"><span>${t('Viewers cannot add characters to this room.')}</span></div>`;
  const missing = mine().filter(c => !c.shared);
  const chips = () =>
    `<div class="add-chips">${missing.map(c => `<button class="add-chip" data-share="${esc(c.id)}" data-enabled="true" title="${esc(t('Add {name} to this room', { name: c.characterName }))}">${icon('plus')}${esc(c.characterName)}</button>`).join('')}${missing.length > 1 ? `<button class="text-button" data-action="add-all">${t('Add all')}</button>` : ''}</div>`;
  // No character saved yet: the steps that get one into the party (#52). With characters saved,
  // the chips below add them.
  if (!mine().length)
    return setupTracker(
      { paired: state.readers.length > 0, online: Boolean(readerNow()), saved: mine().length > 0, shared: false },
      {
        install: `${appLink('button secondary small', t('Download the Windows app'))}<button class="button secondary small" data-action="reading">${t('Pair Windows app')}</button>`,
        add: chips(),
      },
    );
  if (!missing.length) return '';
  return `<div class="sharing-bar"><span>${t('Not in this room')}</span>${chips()}</div>`;
}
// Re-render only when the room data or a readiness state changed; otherwise just refresh the "ago" labels,
// so hover, focus and open menus survive the periodic refresh.
let rendered = '';
function signature() {
  const now = Date.now() + state.serverOffset,
    party = flattened();
  return canonical([
    state.room,
    stable(state.members),
    state.board,
    state.wishlist,
    state.runs,
    state.dungeons,
    state.catalog,
    party.map(c => status(c, now)),
    party.map(c => clockState(c, now)),
    state.clockRules,
    readerNow()?.name ?? null,
  ]);
}
export function renderDashboard() {
  if (signature() === rendered) updateAges();
  else dashboard();
}
// Accounts with a live character in this room, for the dots on the wishlist and runs.
function liveUsers(now) {
  return new Set(partyOf(flattened(), now, state.room?.cost || state.perCube).live.map(c => c.user));
}
// The line under a dungeon the catalog lists: its cost and the cubes of it the room's
// party can open now (catalog.js, readiness.js), the party worked out once per cost.
function dungeonInfo(now) {
  const entries = flattened(),
    parties = new Map(),
    cost = state.room?.cost || state.perCube;
  const party = at => {
    if (!parties.has(at)) parties.set(at, partyOf(entries, now, at));
    return parties.get(at);
  };
  return name => dungeonFacts(entryOf(state.catalog, name), { perCube: cost, party });
}
// How long a dungeon has been on the wishlist, from its first entry.
const wanted = (since, now) => {
  const days = Math.floor((now - timestamp(since)) / 86400000);
  return since && days >= 1 ? tn(days, 'wanted for {n} day', 'wanted for {n} days') : t('added today');
};
// What members still need to run, most wanted first. A dot marks members with a
// live character in this room, so the party sees what it could run right now.
function wishlistSection(now) {
  const { catalog, wishlist, members } = state,
    myId = pb.authStore.record?.id,
    viewer = me()?.role === 'viewer';
  const name = id => (id === myId ? t('You') : members.find(m => m.user === id)?.displayName || t('Member'));
  const live = liveUsers(now),
    facts = dungeonInfo(now);
  // With a dungeon catalog the form offers the listed dungeons you are not on yet; otherwise it suggests the entries others added.
  const choices = catalog.filter(
      d => !wishlist.some(w => dungeonKey(w.dungeon) === dungeonKey(d.name) && w.users.includes(myId)),
    ),
    suggestions = wishlist.filter(w => !w.users.includes(myId)).map(w => w.dungeon);
  const form = viewer
    ? `<p class="wish-note">${t('Viewers can see the wishlist but cannot add dungeons.')}</p>`
    : `<form id="wish-form" class="wish-form">${dungeonField({ catalog, choices, suggestions, list: 'wish-suggestions', placeholder: catalog.length ? t('Choose a dungeon you still need to run') : t('Add a dungeon you still need to run'), perCube: state.room?.cost || state.perCube })}<button class="button primary" type="submit">${icon('plus')} ${t('Add')}</button></form>`;
  const rows = wishlist
    .map(w => {
      // Runs need a dungeon the catalog lists, when there is one; Plan picks it in the run form.
      const yours = w.users.includes(myId),
        count = w.users.length,
        listed = entryOf(catalog, w.dungeon),
        plannable = !catalog.length || listed;
      const people = w.users
        .map(
          u =>
            `<span class="wish-person ${live.has(u) ? 'live' : ''}"${live.has(u) ? ` title="${esc(t('Live in this room now'))}"` : ''}><i></i>${esc(name(u))}${live.has(u) ? `<span class="sr-only"> (${t('live')})</span>` : ''}</span>`,
        )
        .join('');
      const actions = state.demo
        ? ''
        : (yours
            ? `<button data-wish="${esc(w.dungeon)}" data-wanted="false" title="${esc(t('Take yourself off {dungeon}', { dungeon: w.dungeon }))}">${t('Remove me')}</button>`
            : viewer
              ? ''
              : `<button data-wish="${esc(w.dungeon)}" data-wanted="true">${icon('plus')} ${t('Need it too')}</button>`) +
          (viewer || !plannable || !on('runs')
            ? ''
            : `<button data-plan-wish="${esc(listed?.name ?? w.dungeon)}" title="${esc(t('Plan a run of {dungeon}', { dungeon: w.dungeon }))}">${icon('calendar')} ${t('Plan')}</button>`) +
          (manager()
            ? `<button class="remove" data-clear-wish="${esc(w.dungeon)}" title="${esc(t('Clear {dungeon} for everyone', { dungeon: w.dungeon }))}">${t('Clear')}</button>`
            : '');
      return `<div class="wish-row ${yours ? 'mine' : ''}"><div class="wish-name"><strong>${esc(w.dungeon)}</strong><small>${esc(tn(count, '{n} member needs it', '{n} members need it'))} · ${esc(wanted(w.since, now))}</small>${facts(w.dungeon)}</div><div class="wish-people">${people}</div><div class="wish-actions">${actions}</div></div>`;
    })
    .join('');
  return `<section class="party-section wishlist"><div class="section-heading"><h2>${t('Dungeon wishlist')} <span>${wishlist.length}</span></h2><span class="refresh-label">${t('Most wanted first')}</span></div><div class="wish-panel">${form}${rows ? `<div class="wish-list">${rows}</div>` : `<p class="wish-empty">${t('Nothing on the wishlist yet. Add the dungeons you still need so the party can plan its next run.')}</p>`}</div></section>`;
}
// Run now: a call starts its run in about ten minutes, and the server takes one call per room
// every half hour (backend runs.go callLead, callGap); the form waits as long.
const callLead = 10 * 60000,
  callWait = 21 * 60000;
// Run now asks first: who the call tells (runready.js callable, as the server counts them).
function callDialog(form, data) {
  const now = Date.now() + state.serverOffset,
    start = now + callLead;
  const problem = runProblem(
    { ...data, startsAt: new Date(start).toISOString() },
    { now, catalog: state.dungeons, runs: state.runs },
  );
  if (problem) return formError(form, problem);
  const n = callable(
    flattened(),
    pb.authStore.record?.id,
    now,
    start,
    entryOf(state.catalog, data.dungeon)?.cost || state.room?.cost || state.perCube,
    state.clockRules,
  ).length;
  modal(
    esc(t('Call the party to {dungeon}?', { dungeon: data.dungeon })),
    `<p>${esc(n ? tn(n, 'The run starts in about 10 minutes. The {n} player who plays now or holds a cube is told on the dashboard, in Odyle for Windows and by push, unless it is their quiet hours.', 'The run starts in about 10 minutes. The {n} players who play now or hold a cube are told on the dashboard, in Odyle for Windows and by push, unless it is their quiet hours.') : t('Nobody else plays now or holds a cube. The run is planned anyway and starts in about 10 minutes.'))}</p><button class="button primary" data-confirm-call="${esc(data.dungeon)}" data-note="${esc(data.note || '')}">${icon('bolt')} ${t('Call the party')}</button><button class="button secondary" data-action="close-dialog">${t('Not now')}</button>`,
  );
}
function plannedRuns(now) {
  const { runs, catalog, clockRules } = state,
    suggestions = [...new Set(state.wishlist.map(w => w.dungeon))],
    entries = flattened(),
    cost = state.room?.cost || state.perCube;
  // A run counts at its dungeon's own cost when the catalog has one.
  const costOf = r => entryOf(catalog, r.dungeon)?.cost || cost;
  const players = [...new Set(entries.filter(c => c.role !== 'viewer').map(c => c.user))].map(
    user => broughtBy(user, entries, now).character,
  );
  return runsSection({
    runs,
    members: state.members,
    myId: pb.authStore.record?.id || (state.demo ? 'dave' : ''),
    viewer: me()?.role === 'viewer',
    owner: manager(),
    live: liveUsers(now),
    now,
    suggestions,
    catalog,
    perCube: cost,
    facts: dungeonInfo(now),
    demo: state.demo,
    discord: state.room?.discordReminders,
    readiness: r => runReadiness(r, entries, now, costOf(r), clockRules),
    costOf,
    maintenance: state.maintenance,
    start: clockRules.paused ? null : earliestClaim(players, now, cost, clockRules),
    roles: state.classRoles,
    called: runs.some(r => r.called && timestamp(r.startsAt) > now - callWait),
  });
}
export function dashboard() {
  // A room whose snapshot has not come yet has nothing to draw: a redraw meanwhile (the 5-second
  // tick, news, a language change) would draw an empty room, and keep a load that fails from
  // saying so (router.js show).
  if (state.room?.loading) return;
  rendered = signature();
  const { room, members, demo } = state;
  // Odyle cannot be pooled. Each player brings one character (their best fresh one),
  // and the party can only do as many cubes as its lowest player allows (readiness.js).
  // Saved values of characters not live are projected by the Odyle clock for the last known party.
  const now = Date.now() + state.serverOffset,
    party = flattened(),
    estimate = c => (status(c, now) === 'live' ? c.value : (clockOf(c, now, state.clockRules)?.total ?? c.value));
  // The numbers count at the cost of the room's next run (or one still under way) when the
  // catalog lists its dungeon (#12): what the party can do there.
  const next = state.runs
      .filter(r => timestamp(r.startsAt) > now - 3 * 3600000)
      .sort((a, b) => timestamp(a.startsAt) - timestamp(b.startsAt))[0],
    listed = next && entryOf(state.catalog, next.dungeon);
  const focus = listed ? { dungeon: next.dungeon, cost: cubeCost(listed, room.cost) } : null,
    cost = focus?.cost || room.cost;
  const explained = explain(party, now, cost, estimate),
    { characters: actual, counted } = explained;
  const estimated = Boolean(
    explained.lastKnown && clockOf(explained.lastKnown.lowest, now, state.clockRules)?.projected,
  );
  const listedNow = readyOrder(actual, now, cost).filter(c => !liveOnly() || status(c, now) === 'live');
  // The parts of the room its owner left on (Room settings → Room features).
  const columns = (on('runs') ? plannedRuns(now) : '') + (on('wishlist') ? wishlistSection(now) : '');
  const hidden = actual.length - listedNow.length,
    actions = `${demo ? `<span class="demo-tag">${t('Sample data')}</span>` : ''}${manager() ? `<button class="button primary" data-action="invite">${icon('plus')} ${t('Invite')}</button>` : ''}<button class="button secondary" data-action="room-settings">${icon('gear')} ${owner() ? t('Settings') : t('Room')}</button>`;
  // Room changes redraw the whole page; keep half-typed wishlist and run entries and their focus.
  keepingDrafts(() =>
    shell(
      `<main class="dashboard room-page"><section class="heading"><div><h1>${esc(room.name)}</h1><p>${esc(tn(members.length, '{n} member', '{n} members'))} · ${esc(tn(actual.length, '{n} character in this room', '{n} characters in this room'))} · ${esc(t('{cost} Odyle per cube', { cost: room.cost }))}${focus && focus.cost !== room.cost ? ' · ' + esc(t('next run {dungeon}: {cost} Odyle per cube', focus)) : ''}</p>${demo || !on('week') ? '' : weekLine(state.roomWeek)}</div><div class="heading-actions">${actions}</div></section>${on('board') ? boardSection(state.board, { canEdit: manager(), name: id => (id === pb.authStore.record?.id ? t('You') : members.find(m => m.user === id)?.displayName || ''), now }) : ''}${partySummary(explained, now, { estimated, focus })}<section class="party-section"><div class="section-heading"><h2>${t('Party characters')} <span>${actual.length}</span></h2><span class="section-tools"><button class="chip-toggle" data-action="live-only" aria-pressed="${liveOnly()}">${t('Live only')}</button></span></div>${demo ? '' : addBar()}<div class="member-grid party-list">${listedNow.length ? listHead() : ''}${playerGroups(listedNow, now, counted, cost)}${liveOnly() && hidden ? `<p class="wish-note live-only-note">${esc(tn(hidden, '{n} character not live is hidden', '{n} characters not live are hidden'))}</p>` : ''}</div></section>${columns ? `<div class="room-columns">${columns}</div>` : ''}</main>`,
    ),
  );
}
// The party's characters grouped by the player whose account owns them, under that player's
// name, look, leader crown and character count; the owner removes a player from here. Players
// in one party or one force in the game stand together in a band (inGame).
function playerGroups(listed, now, counted, cost) {
  let index = 0;
  const players = list => tn(list.length, '{n} player', '{n} players');
  const band = (kind, label, count, inner) =>
    `<div class="game-band is-${kind}" role="group" aria-label="${esc(label)}"><p class="band-label">${icon(kind === 'force' ? 'shield' : 'people')}<span>${esc(label)}</span><span class="band-count">${esc(count)}</span></p>${inner}</div>`;
  const party = p => band('party', t('In one party in game'), players(p.players), p.players.map(section).join(''));
  return inGame(byPlayer(listed, state.demo ? null : pb.authStore.record?.id), now)
    .map(item =>
      item.force
        ? band(
            'force',
            t('In one force in game'),
            players(item.parts.flatMap(p => p.players || [p.player])),
            item.parts.map(p => (p.party ? party(p) : section(p.player))).join(''),
          )
        : item.party
          ? party(item)
          : section(item.player),
    )
    .join('');
  function section(group) {
    const p = group[0],
      ready = group.filter(c => readinessOf(c, now, cost).ready).length,
      you = p.user === pb.authStore.record?.id && !state.demo;
    const leader =
      p.role === 'owner'
        ? `<span class="leader-label" title="${esc(t('Room leader'))}">${icon('crown')}<span class="sr-only">${t('leader')}</span></span>`
        : '';
    const remove =
      owner() && p.membershipId && p.role !== 'owner' && !state.demo
        ? `<button class="remove" data-remove="${esc(p.membershipId)}" data-name="${esc(p.displayName)}" title="${esc(t('Remove {name} from this room', { name: p.displayName }))}">${t('Remove')}</button>`
        : '';
    const count = [
      tn(group.length, '{n} character', '{n} characters'),
      ready ? tn(ready, '{n} ready', '{n} ready') : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const head = `<div class="group-head"><span class="group-name">${lookName(p.displayName, p.look)}</span>${leader}${you ? `<span class="group-you">${t('You')}</span>` : ''}<span class="group-count">${esc(count)}</span>${remove ? `<span class="card-actions">${remove}</span>` : ''}</div>`;
    return `<section class="party-group" aria-label="${esc(p.displayName)}">${head}${group.map(c => card(c, index++, counted, cost)).join('')}</section>`;
  }
}

// One snapshot request at a time: news arriving while one loads, or a change this page
// drew from its own answer meanwhile (changedRoom), loads it once more afterwards, so an
// older answer never replaces newer state.
let roomLoad = null,
  roomAgain = false,
  roomEdits = 0;
export function refreshRoom() {
  roomAgain = true;
  if (!roomLoad)
    roomLoad = loadRooms().finally(() => {
      roomLoad = null;
    });
  return roomLoad;
}
async function loadRooms() {
  while (roomAgain && state.room) {
    roomAgain = false;
    await loadRoom();
  }
}
async function loadRoom() {
  const id = state.room.id,
    edits = roomEdits;
  let snapshot;
  try {
    snapshot = await pb.send('/api/odyle/snapshot/' + id);
  } catch (error) {
    if (state.room?.id === id) throw error;
    return;
  } // a room left meanwhile is no news
  if (state.room?.id !== id) return; // navigated elsewhere while loading
  if (edits !== roomEdits) {
    roomAgain = true;
    return;
  } // older than a change drawn meanwhile
  const catalog = snapshot.catalog || [];
  Object.assign(state, {
    room: snapshot.room,
    remindersPaused: Boolean(snapshot.remindersPaused),
    maintenance: snapshot.maintenance || null,
    classRoles: snapshot.classRoles || [],
    gameMaps: snapshot.maps || state.gameMaps,
    classIcons: snapshot.classIcons || state.classIcons,
    roomWeek: snapshot.week || null,
    board: snapshot.board || null,
    perCube: snapshot.room.cost,
    clockRules: snapshot.clock || state.clockRules,
    members: snapshot.members,
    wishlist: snapshot.wishlist || [],
    runs: snapshot.runs || [],
    dungeons: catalog.map(d => d.name),
    catalog,
    readers: snapshot.readers || state.readers,
    serverOffset: Date.parse(snapshot.serverNow) - Date.now(),
    online: true,
  });
  state.characters = me()?.characters || state.characters;
  announced(snapshot);
  if (!document.querySelector('#modal')?.open) renderDashboard();
}
// A change this page made in the room: the route's answer carries the new state, which
// is drawn at once instead of fetching the snapshot again (realtime still tells the
// room's members, this tab too, which then fetches it once). An answer for a room no
// longer open (the page moved on while it was on its way) is not applied: false.
export function changedRoom(id, update) {
  if (!state.room || state.room.id !== id) return false;
  roomEdits++;
  update();
  state.characters = me()?.characters || state.characters;
  if (!document.querySelector('#modal')?.open) renderDashboard();
  return true;
}
export async function openRoom(id, ticket) {
  await leaveRoomTopic();
  clearRoom();
  state.room = { id, loading: true }; // until its snapshot replaces it (loadRoom)
  rendered = '';
  await refreshRoom();
  if (ticket !== state.navigation) return;
  if (!state.rooms.some(r => r.id === id))
    loadRoomList().catch(() => {
      /* the switch keeps the rooms it knows */
    });
  // The room's changes and its readers' heartbeats (backend/odyle/realtime.go). Without
  // realtime the room is fetched every 15 seconds instead.
  const topics = [];
  try {
    topics.push(await pb.realtime.subscribe('odyle.room.' + id, data => roomNews(id, data).catch(failure)));
    topics.push(await pb.realtime.subscribe('odyle.presence.' + id, data => roomPresence(id, data)));
  } catch {
    state.live = false;
  }
  if (ticket !== state.navigation) {
    for (const stop of topics)
      await stop().catch(() => {
        /* already gone */
      });
    return;
  }
  state.roomTopics = topics;
}
// News of the open room: changed characters are applied in place, anything else fetches
// the snapshot again, and a member who was removed leaves the room.
async function roomNews(id, data) {
  if (state.room?.id !== id) return;
  if (data?.removed) return leftRoom(id);
  if (Array.isArray(data?.characters)) charactersChanged(data.characters);
  if (Array.isArray(data?.characters) && applyRoomCharacters(state.members, data.characters)) {
    state.characters = me()?.characters || state.characters;
    return renderPage();
  }
  if (later()) return;
  try {
    await refreshRoom();
  } catch (error) {
    if ([403, 404].includes(error.status)) return leftRoom(id);
    state.online = false;
    renderConnection();
  }
}
async function leftRoom(id) {
  forget(id);
  await go('/', true);
  toast(t('Your access to this room ended. Your characters are still saved.'));
}
function roomPresence(id, data) {
  if (state.room?.id !== id || !data?.seen) return;
  applySeen(data.seen, ...state.members.map(m => m.characters));
  renderPage();
}
// The demo workspace (demo.js), drawn again with the page's language.
export async function demoSession(ticket = state.navigation) {
  const { demoRoom } = await demoPart();
  if (ticket !== state.navigation) return;
  clearRoom();
  state.demo = true;
  const { room, members, wishlist, classRoles, runs, board } = demoRoom(Date.now());
  Object.assign(state, { room, members, wishlist, classRoles, runs, board });
  dashboard();
}

// Owners rename the room, change roles, turn its features on and off, hand it over, remove
// members and close it; other members can leave. Every change asks the server and redraws
// this dialog.
export function roomSettings() {
  if (state.demo)
    return signInPrompt(t('This workspace uses sample data. Sign in with Discord to manage your own rooms.'));
  const { room, members } = state;
  // The Discord reminders (discord.js) load with the dialog's first opening.
  if (!discordPart.loaded()) {
    const id = room?.id;
    discordPart().then(() => {
      if (id && state.room?.id === id) roomSettings();
    }, failure);
    return;
  }
  // One section per subject; the one that cannot be undone comes last.
  const section = (title, body, cls = '') =>
    `<section class="modal-section ${cls}">${title ? `<h3 class="modal-sub">${title}</h3>` : ''}${body}</section>`;
  // New characters this member saves can reach this room by themselves.
  const newOnes = section(
    t('Your new characters'),
    `<p>${t('Characters you save from now on start private. With this on, they are shared in this room by themselves.')}</p><div class="share-rooms">${shareNewChip(room.id, room.name, me()?.shareNew, me()?.role === 'viewer', t('Share them in this room'))}</div>`,
  );
  // Officers keep the Discord reminders too.
  const discordSection =
    me()?.role === 'officer'
      ? section('', discordSettings())
      : room.discordReminders
        ? section(
            t('Discord reminders'),
            `<p>${t('The room owner posts planned runs to a Discord channel 15 minutes before they start.')}</p>`,
          )
        : '';
  if (!owner())
    return modal(
      esc(room.name),
      newOnes +
        discordSection +
        section(
          t('Leave this room'),
          `<p>${esc(t('You are a {role} in this room. Leaving removes your access, your wishlist entries and your place on planned runs; your characters stay on your account.', { role: roleName(me()?.role) }))}</p><button class="button danger" data-action="leave-room">${t('Leave this room')}</button>`,
          'danger-zone',
        ),
      true,
    );
  const myId = pb.authStore.record?.id,
    listed = [...members].sort((a, b) => (b.user === myId) - (a.user === myId));
  const rows = listed
    .map(m =>
      m.user === myId
        ? `<div class="member-row"><div><strong>${esc(m.displayName)}</strong><small>${t('Leader (you)')}</small></div></div>`
        : `<div class="member-row"><div><strong>${esc(m.displayName)}</strong></div><select data-role="${esc(m.id)}" aria-label="${esc(t('Role of {name}', { name: m.displayName }))}"><option value="reporter" ${m.role === 'reporter' ? 'selected' : ''}>${t('Player')}</option><option value="officer" ${m.role === 'officer' ? 'selected' : ''}>${t('Officer')}</option><option value="viewer" ${m.role === 'viewer' ? 'selected' : ''}>${t('Viewer')}</option></select><button data-transfer="${esc(m.id)}" data-name="${esc(m.displayName)}">${t('Make leader')}</button><button class="remove" data-remove="${esc(m.id)}" data-name="${esc(m.displayName)}">${t('Remove')}</button></div>`,
    )
    .join('');
  modal(
    t('Room settings'),
    section(
      t('Room name'),
      `<form id="rename-form" class="rename-form"><label><span class="sr-only">${t('Room name')}</span><input name="name" maxlength="60" required value="${esc(room.name)}"></label><button class="button secondary" type="submit">${t('Rename')}</button></form>`,
    ) +
      section(
        `${t('Members')} <span class="modal-count">${members.length}</span>`,
        `<p>${t('Players share characters and plan runs; officers also invite, change any run and keep the Discord reminders; viewers only watch. A member made viewer stops sharing here.')}</p><div class="member-rows">${rows}</div>`,
      ) +
      section('', featuresForm(room)) +
      section('', discordSettings()) +
      newOnes +
      section(
        t('Close this room'),
        `<p>${t('This deletes the room with its wishlist and planned runs for every member. Characters stay on their accounts. It cannot be undone.')}</p><button class="button danger" data-action="close-room">${t('Close this room')}</button>`,
        'danger-zone',
      ),
    true,
  );
}
// Room features the owner chose to change, while Room settings asks before planned runs go.
let pendingFeatures = null;
async function saveFeatures(features) {
  const id = state.room.id,
    result = await send('room-features', { roomId: id, features });
  // Planned runs turned off took the room's runs with them; what comes back on arrives with the next snapshot.
  if (
    changedRoom(id, () => {
      state.room = result.room;
      if (features.runs === false) state.runs = [];
    })
  )
    roomSettings();
  toast(
    result.cancelled
      ? tn(
          result.cancelled,
          'Room features saved. {n} planned run was cancelled.',
          'Room features saved. {n} planned runs were cancelled.',
        )
      : t('Room features saved.'),
  );
}
// The owner connects a Discord channel and chooses when runs are posted there (discord.js).
const discordSettings = () =>
  discordPart.loaded().discordSettings(state.room, Date.now() + state.serverOffset, state.remindersPaused, !on('runs'));

// A run's answers: the room's runs as the server sends them back.
async function planned(el, body) {
  const id = state.room.id;
  let result;
  el.disabled = true;
  try {
    result = await send('plan', { roomId: id, ...body });
  } finally {
    el.disabled = false;
  }
  changedRoom(id, () => {
    state.runs = result.runs;
  });
  return result;
}
// Going with one of several characters shared here asks which one first.
function goingWith(el) {
  const run = state.runs.find(r => r.id === el.dataset.run);
  return modal(
    esc(t('Going to {dungeon} with', { dungeon: run?.dungeon || '' })),
    `<p>${t('Pick the character you bring. The run counts its cubes.')}</p><div class="add-chips pick-chips">${mine()
      .filter(c => c.shared)
      .map(
        c =>
          `<button class="add-chip" data-run="${esc(el.dataset.run)}" data-going="true" data-character="${esc(c.id)}">${esc(c.characterName)} · ${esc(c.value.toLocaleString(locale()))}</button>`,
      )
      .join(
        '',
      )}<button class="add-chip" data-run="${esc(el.dataset.run)}" data-going="true" data-character="any">${t('Any: my best')}</button></div>`,
  );
}
onData({
  remove: el =>
    ask(
      esc(t('Remove {name}?', { name: el.dataset.name || t('this member') })),
      t('Their saved characters stay on their account. This removes their access to this room.'),
      t('Remove member'),
      { 'confirm-remove': el.dataset.remove },
    ),
  transfer: el =>
    ask(
      esc(t('Make {name} the leader?', { name: el.dataset.name })),
      esc(
        t('{name} becomes the owner of {room}. You stay in the room as a player and can leave it afterwards.', {
          name: el.dataset.name,
          room: state.room.name,
        }),
      ),
      t('Hand over the room'),
      { 'confirm-transfer': el.dataset.transfer },
    ),
  wish: async el => {
    const id = state.room.id;
    let result;
    el.disabled = true;
    try {
      result = await send('wishlist', { roomId: id, dungeon: el.dataset.wish, wanted: el.dataset.wanted === 'true' });
    } finally {
      el.disabled = false;
    }
    return changedRoom(id, () => {
      state.wishlist = result.wishlist;
    });
  },
  planWish: el => {
    const form = document.querySelector('#run-form');
    if (!form) return;
    form.elements.dungeon.value = el.dataset.planWish;
    form.dataset.fromWish = el.dataset.planWish;
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return form.elements.startsAt.focus();
  },
  run: async el => {
    if (el.dataset.going === 'true' && !el.dataset.character && mine().filter(c => c.shared).length > 1)
      return goingWith(el);
    const id = state.room.id;
    let result;
    el.disabled = true;
    try {
      result = await send('plan', {
        roomId: id,
        id: el.dataset.run,
        going: el.dataset.going === 'true',
        ...(el.dataset.character && el.dataset.character !== 'any' ? { character: el.dataset.character } : {}),
      });
    } finally {
      el.disabled = false;
    }
    if (el.dataset.character) closeModal();
    return changedRoom(id, () => {
      state.runs = result.runs;
    });
  },
  useStart: el => {
    const input = document.querySelector('#run-form [name="startsAt"]');
    if (input) {
      input.value = el.dataset.useStart;
      input.focus();
    }
  },
  cantRun: async el => {
    await planned(el, { id: el.dataset.cantRun, cant: el.dataset.cant === 'true' });
  },
  editRun: async el => {
    const { runEditForm } = await runToolsPart(),
      r = state.runs.find(x => x.id === el.dataset.editRun);
    if (r)
      modal(
        esc(t('Change {dungeon}', { dungeon: r.dungeon })),
        runEditForm(
          r,
          {
            suggestions: [...new Set(state.wishlist.map(w => w.dungeon))],
            catalog: state.catalog,
            perCube: state.room?.cost || state.perCube,
          },
          Date.now() + state.serverOffset,
        ),
      );
  },
  copyRun: async el => {
    const r = state.runs.find(x => x.id === el.dataset.copyRun);
    if (!r) return;
    const names = ids => ids.map(u => state.members.find(m => m.user === u)?.displayName).filter(Boolean),
      { party, waiting } = runParty(r, state.catalog);
    const text = discordText(r, {
      going: names(party),
      waiting: names(waiting),
      partySize: entryOf(state.catalog, r.dungeon)?.partySize || 0,
      link: address('/room/' + state.room.id),
      event: r.link || '',
    });
    return toast(
      (await copyText(text))
        ? t('Copied for Discord: paste it in any channel.')
        : t('Copying is blocked here. Select the text and copy it yourself.'),
    );
  },
  calendarRun: async el => {
    const { calendarFile } = await runToolsPart(),
      r = state.runs.find(x => x.id === el.dataset.calendarRun);
    if (!r) return;
    const going = r.attendees.map(u => state.members.find(m => m.user === u)?.displayName).filter(Boolean);
    return download(
      calendarFile(r, { room: state.room.name, going, now: Date.now() + state.serverOffset }),
      `odyle-${
        r.dungeon
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || 'run'
      }.ics`,
      'text/calendar',
    );
  },
  cancelRun: el =>
    el.dataset.missed
      ? ask(
          esc(t('{dungeon} did not happen?', { dungeon: el.dataset.name })),
          t('The run disappears for everyone. The wishlist stays as it is.'),
          t('Didn’t happen'),
          { 'confirm-cancel-run': el.dataset.cancelRun },
        )
      : ask(
          esc(t('Cancel {dungeon}?', { dungeon: el.dataset.name })),
          t('The run disappears for everyone who planned to go.'),
          t('Cancel run'),
          { 'confirm-cancel-run': el.dataset.cancelRun },
        ),
  runDone: async el => {
    await planned(el, { id: el.dataset.runDone, done: true });
    return toast(t('{dungeon} done: it left the wishlist of everyone who went.', { dungeon: el.dataset.name }));
  },
  runAgain: async el => {
    // The same local time a week later, also across a daylight saving change.
    const next = new Date(timestamp(el.dataset.at));
    next.setDate(next.getDate() + 7);
    await planned(el, { id: el.dataset.runAgain, again: true, startsAt: next.toISOString() });
    return toast(
      t('{dungeon} is planned again for {when}, with you going.', {
        dungeon: el.dataset.name,
        when: next.toLocaleString(locale(), {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }),
      }),
    );
  },
  confirmCancelRun: async el => {
    const id = state.room.id,
      result = await send('plan', { roomId: id, id: el.dataset.confirmCancelRun, remove: true });
    closeModal();
    return changedRoom(id, () => {
      state.runs = result.runs;
    });
  },
  clearWish: el =>
    ask(
      t('Clear from the wishlist?'),
      t(
        'This takes <strong>{dungeon}</strong> off the wishlist for every member, for example after the party ran it. Anyone can add it again.',
        { dungeon: esc(el.dataset.clearWish) },
      ),
      t('Clear for everyone'),
      { 'confirm-clear': el.dataset.clearWish },
    ),
  confirmClear: async el => {
    const id = state.room.id,
      result = await send('wishlist', { roomId: id, dungeon: el.dataset.confirmClear, wanted: false, everyone: true });
    closeModal();
    return changedRoom(id, () => {
      state.wishlist = result.wishlist;
    });
  },
  confirmRemove: async el => {
    await send('revoke', { roomId: state.room.id, memberId: el.dataset.confirmRemove });
    closeModal();
    return await refreshRoom();
  },
  confirmRole: async el => {
    const id = state.room.id,
      { membership } = await send('role', { roomId: id, memberId: el.dataset.confirmRole, role: el.dataset.newRole });
    // A member this page does not list yet (joined since the last snapshot) comes with the room fetched again.
    let listed = true;
    if (
      changedRoom(id, () => {
        listed = applyMembership(state.members, membership);
      })
    ) {
      if (!listed) await refreshRoom();
      roomSettings();
    }
    return toast(t('Role changed.'));
  },
  confirmTransfer: async el => {
    await send('transfer', { roomId: state.room.id, memberId: el.dataset.confirmTransfer });
    closeModal();
    await refreshRoom();
    return toast(t('You handed the room over. You are now a player in it.'));
  },
});
onData(
  {
    callRun: el => {
      if (state.demo)
        return signInPrompt(t('This workspace uses sample data. Sign in with Discord to plan runs with your party.'));
      const form = el.closest('form');
      form.querySelector('.form-error')?.remove();
      return callDialog(form, Object.fromEntries(new FormData(form)));
    },
    confirmCall: async el => {
      const id = state.room.id;
      let result;
      el.disabled = true;
      try {
        result = await send('plan', {
          roomId: id,
          dungeon: el.dataset.confirmCall,
          note: el.dataset.note || '',
          call: true,
        });
      } finally {
        el.disabled = false;
      }
      closeModal();
      document.querySelector('#run-form')?.reset();
      changedRoom(id, () => {
        state.runs = result.runs;
      });
      const called = result.runs.filter(r => r.called && r.planner === pb.authStore.record?.id).at(-1); // the latest start: this call
      return toast(
        called?.invited?.length
          ? tn(
              called.invited.length,
              'The party is called: {n} player can come now.',
              'The party is called: {n} players can come now.',
            )
          : t('The run is planned. Nobody else can come now.'),
      );
    },
  },
  true,
);
// Leaving or closing the room.
async function leaveOrClose(el) {
  const id = state.room.id,
    closing = el.dataset.action === 'confirm-close';
  await send(closing ? 'close' : 'leave', { roomId: id });
  closeModal();
  forget(id);
  if (closing) forgetInvites(storage, id);
  await go('/');
  toast(
    closing
      ? t('Room closed. Your saved characters are retained.')
      : t('You left the room. Your saved characters are retained.'),
  );
}
onAction({
  'discord-off': () =>
    ask(
      t('Stop Discord reminders?'),
      t(
        'Planned runs are no longer posted to your Discord channel. Odyle forgets the webhook URL; to turn reminders on again, paste one from Discord.',
      ),
      t('Stop reminders'),
      { action: 'confirm-discord-off' },
    ),
  'confirm-discord-off': async () => {
    const id = state.room.id,
      result = await send('discord-webhook', { roomId: id, webhook: '' });
    if (
      changedRoom(id, () => {
        state.room = result.room;
      })
    )
      roomSettings();
    toast(t('Discord reminders are off.'));
  },
  'live-only': () => {
    storage.setItem(liveOnlyKey, liveOnly() ? 'off' : 'on');
    dashboard();
  },
  'room-settings': () => roomSettings(),
  'confirm-features': async () => {
    if (pendingFeatures) {
      const changes = pendingFeatures;
      pendingFeatures = null;
      await saveFeatures(changes);
    }
  },
  'edit-board': () => {
    if (state.demo)
      return signInPrompt(
        t('This workspace uses sample data. Sign in with Discord to keep an information board in your own room.'),
      );
    modal(t('Information board'), boardForm(state.board));
    document.querySelector('#board-text')?.focus();
  },
  'clear-board': () =>
    ask(
      t('Clear the board?'),
      t('Every member stops seeing it. You can write a new one at any time.'),
      t('Clear the board'),
      { action: 'confirm-clear-board' },
      'edit-board',
    ),
  'confirm-clear-board': async () => {
    const id = state.room.id,
      result = await send('board', { roomId: id, text: '' });
    closeModal();
    changedRoom(id, () => {
      state.board = result.board;
    });
    toast(t('Board cleared.'));
  },
  'add-all': async () => {
    const id = state.room.id,
      characterIds = mine()
        .filter(c => !c.shared)
        .map(c => c.id),
      result = await send('sharing', { roomId: id, characterIds, enabled: true });
    changedRoom(id, () => applyShared(me(), result.sharedCharacters));
  },
  'leave-room': () =>
    ask(
      esc(t('Leave {room}?', { room: state.room.name })),
      t(
        'You lose access to this room, your wishlist entries and your place on planned runs. Your characters stay on your account; you need a new invite to come back.',
      ),
      t('Leave room'),
      { action: 'confirm-leave' },
    ),
  'close-room': () =>
    ask(
      esc(t('Close {room}?', { room: state.room.name })),
      t(
        'This deletes the room with its wishlist and planned runs for every member. Characters stay on their accounts. It cannot be undone.',
      ),
      t('Close room for everyone'),
      { action: 'confirm-close' },
    ),
  'confirm-leave': leaveOrClose,
  'confirm-close': leaveOrClose,
});

// Room settings and the forms of the room page.
async function savedDiscord(id, body, message) {
  const result = await send('discord-webhook', { roomId: id, ...body });
  if (
    changedRoom(id, () => {
      state.room = result.room;
    })
  )
    roomSettings();
  toast(message());
}
onSubmit({
  'wish-form': async (form, data) => {
    if (state.demo)
      return signInPrompt(
        t('This workspace uses sample data. Sign in with Discord to keep a dungeon wishlist in your own room.'),
      );
    const problem = wishProblem(data.dungeon, {
      catalog: state.dungeons,
      wishlist: state.wishlist,
      myId: pb.authStore.record?.id,
    });
    if (problem) return formError(form, problem);
    const id = state.room.id,
      result = await send('wishlist', { roomId: id, dungeon: data.dungeon, wanted: true });
    form.reset();
    changedRoom(id, () => {
      state.wishlist = result.wishlist;
    });
  },
  'run-form': async (form, data) => {
    if (state.demo)
      return signInPrompt(t('This workspace uses sample data. Sign in with Discord to plan runs with your party.'));
    const problem = runProblem(data, {
      now: Date.now() + state.serverOffset,
      catalog: state.dungeons,
      runs: state.runs,
    });
    if (problem) return formError(form, problem);
    // Planned from the wishlist (and still that dungeon): its members are invited (#45).
    const fromWish = Boolean(form.dataset.fromWish) && form.dataset.fromWish === data.dungeon;
    const id = state.room.id,
      result = await send('plan', {
        roomId: id,
        dungeon: data.dungeon,
        startsAt: new Date(data.startsAt).toISOString(),
        note: data.note,
        ...(fromWish ? { fromWish: true } : {}),
      });
    form.reset();
    delete form.dataset.fromWish;
    changedRoom(id, () => {
      state.runs = result.runs;
    });
  },
  'run-edit-form': async (form, data) => {
    const run = state.runs.find(r => r.id === data.runId);
    if (!run) return formError(form, t('This run is no longer planned.'));
    const problem = runProblem(data, { now: Date.now() + state.serverOffset, catalog: state.dungeons, run });
    if (problem) return formError(form, problem);
    // An unchanged start is not sent: the form shows whole minutes, and a run that started over an hour ago keeps its time.
    const changes = {
      roomId: state.room.id,
      id: run.id,
      dungeon: data.dungeon,
      note: data.note,
      link: data.link || '',
      ...(moved(run, data.startsAt) ? { startsAt: new Date(data.startsAt).toISOString() } : {}),
    };
    const result = await send('plan', changes);
    closeModal();
    changedRoom(changes.roomId, () => {
      state.runs = result.runs;
    });
    toast(t('Run updated.'));
  },
  'discord-options-form': async form => {
    const times = (await discordPart()).chosenTimes(form);
    if (times.error) {
      formError(form, times.error);
      return;
    }
    await savedDiscord(state.room.id, times, () => t('Discord reminder settings saved.'));
  },
  'discord-form': async (form, data) => {
    // A new connection takes the times chosen above it.
    const times = (await discordPart()).chosenTimes(document.getElementById('discord-options-form') || form);
    if (times.error) {
      formError(form, times.error);
      return;
    }
    await savedDiscord(state.room.id, { webhook: data.webhook, language: language(), ...times }, () =>
      t('Discord reminders are on. Check the channel for the test message.'),
    );
  },
  'features-form': async form => {
    const changes = changedFeatures(form, state.room);
    if (!Object.keys(changes).length) {
      toast(t('Room features saved.'));
      return;
    }
    // Turning planned runs off cancels the runs the room lists, so it asks first.
    if (changes.runs === false && state.runs.length) {
      pendingFeatures = changes;
      ask(
        t('Turn planned runs off?'),
        esc(
          tn(
            state.runs.length,
            'The {n} run planned in this room is cancelled for everyone, and its Discord posts say so.',
            'The {n} runs planned in this room are cancelled for everyone, and their Discord posts say so.',
          ),
        ),
        t('Turn planned runs off'),
        { action: 'confirm-features' },
        'room-settings',
      );
      return;
    }
    await saveFeatures(changes);
  },
  'board-form': async (form, data) => {
    const id = state.room.id,
      result = await send('board', { roomId: id, text: data.text ?? '' });
    closeModal();
    changedRoom(id, () => {
      state.board = result.board;
    });
    toast(result.board ? t('Board saved. Every member of the room sees it.') : t('Board cleared.'));
  },
  'rename-form': async (form, data) => {
    const id = state.room.id,
      result = await send('rename', { roomId: id, name: data.name });
    state.rooms = state.rooms.map(r => (r.id === id ? { ...r, name: result.room.name } : r));
    if (
      changedRoom(id, () => {
        state.room = result.room;
      })
    )
      roomSettings();
    toast(t('Room renamed.'));
  },
});
// A role change asks first; keeping the role closes the dialog with nothing changed.
onChange({
  role: el => {
    if (!el.matches('select[data-role]')) return;
    const name = state.members.find(m => m.id === el.dataset.role)?.displayName || t('this member'),
      data = { 'confirm-role': el.dataset.role, 'new-role': el.value };
    if (el.value === 'viewer')
      return ask(
        esc(t('Make {name} a viewer?', { name })),
        esc(
          t(
            'Viewers only watch: the characters {name} shares here leave the party, and have to be added again after a change back to player.',
            { name },
          ),
        ),
        t('Make viewer'),
        data,
      );
    if (el.value === 'officer')
      return ask(
        esc(t('Make {name} an officer?', { name })),
        esc(
          t(
            '{name} can then invite people, change or cancel any run, clear a dungeon off everyone’s wishlist and keep the Discord reminders. Renaming and closing the room, roles and handing it over stay with you.',
            { name },
          ),
        ),
        t('Make officer'),
        data,
      );
    return ask(
      esc(t('Make {name} a player?', { name })),
      esc(t('{name} can then add characters to this room, plan runs and join them.', { name })),
      t('Make player'),
      data,
    );
  },
});
