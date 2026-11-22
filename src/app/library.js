// Rooms & characters (/ signed in): the runs you go to next, your rooms, your saved characters
// and which room sees which of them. Loads with the page (parts.js).
import { t } from '../i18n.js';
import { status, escape as esc, timestamp, regionLabel, weekDates, canonical, stable } from '../model.js';
import { icon } from '../icons.js';
import { periodStart } from '../tasks.js';
import { roomGlance, nextRunsSection } from '../runs.js';
import { rememberInvites, joinedMessage } from '../invites.js';
import { state, storage, leaveRoomTopic, clearRoom } from './state.js';
import { pb, send } from './server.js';
import { modal, ask, toast, closeModal, keepingDrafts, download } from './ui.js';
import { onData, onAction, onSubmit } from './actions.js';
import { runToolsPart } from './parts.js';
import { shell, appLink, readerButton, readerNow, loadWindowsRelease, renderAppLinks } from './shell.js';
import { announced } from './notes.js';
import { weekSeenKey } from './pages.js';
import { go, show } from './router.js';
import { inviteDialog } from './invites.js';
import { card, portrait, listHead, clockState, shareNewChip } from './cards.js';

let renderedLibrary = '';
export function libraryView() {
  const { rooms, characters } = state;
  shell(
    `<main class="dashboard"><section class="heading"><div><h1>${t('Rooms & characters')}<span class="mint">.</span></h1><p>${t('Welcome, {name}', { name: esc(pb.authStore.record.displayName) })} · ${t('All your rooms and characters, connected to your Discord account.')}</p></div><div class="heading-actions">${appLink('button secondary')}<button class="button secondary" data-action="desktop">${t('Pair Windows app')} ${icon('arrow')}</button></div></section>${nextRunsSection(state.nextRunsList, Date.now() + state.serverOffset)}${weekReadyNote()}<section class="party-section room-section"><div class="section-heading"><h2>${t('Your rooms')} <span>${rooms.length}</span></h2></div><div class="room-list">${roomItems()}</div><details class="room-setup"${rooms.length ? '' : ' open'}><summary>${icon('plus')} ${t('Create or join a room')}</summary><div class="welcome-grid"><form id="create-form" class="setup-card"><h2>${t('Create a private room')}</h2><p>${t('Keep your party together between sessions.')}</p><label>${t('Room name')}<input name="name" maxlength="60" placeholder="${esc(t('The evening expedition'))}" required></label><button class="button primary" type="submit">${t('Create room')} ${icon('arrow')}</button></form><form id="join-form" class="setup-card"><h2>${t('Join your friends')}</h2><p>${t('Paste the invite code, or just open the invite link your friend sent.')}</p><label>${t('Invite code')}<input name="code" class="code-input" autocomplete="off" placeholder="XXXX XXXX XXXX" maxlength="20" required></label><button class="button secondary" type="submit">${t('Join room')} ${icon('arrow')}</button></form></div></details></section><section class="party-section personal-characters"><div class="section-heading"><h2>${t('Your saved characters')} <span>${characters.length}</span></h2>${readerButton(`${icon('plus')} ${t('Connect reader')}`)}</div><div class="member-grid party-list">${characterCards()}</div></section><section class="party-section room-sharing"><div class="section-heading"><h2>${t('Room sharing')}</h2></div><div class="share-matrix">${sharingMatrix()}</div></section></main>`,
    'library',
  );
}
const roomItems = () =>
  state.rooms
    .map(
      r =>
        `<button class="room-item" data-room="${esc(r.id)}"><span class="setup-icon">${icon('diamond')}</span><span><strong>${esc(r.name)}</strong><small>${esc(roomGlance(r, Date.now() + state.serverOffset))}</small></span>${icon('arrow')}</button>`,
    )
    .join('') || `<p class="intro">${t('Create your first room, or join one with an invite.')}</p>`;
// The main character comes first; each keeps the portrait color of its place by age.
const ownCards = () =>
  state.characters
    .map((c, i) => [c, i])
    .sort(([a], [b]) => Boolean(b.main) - Boolean(a.main))
    .map(([c, i]) =>
      card(
        {
          ...c,
          sharing: true,
          role: 'reporter',
          displayName: pb.authStore.record.displayName,
          user: pb.authStore.record.id,
        },
        i,
      ),
    )
    .join('');
const characterCards = () =>
  (state.characters.length ? listHead() + ownCards() : '') ||
  `<div class="info-panel"><h3>${t('Every character gets its own reading.')}</h3><p>${t('Connect the Windows reader to read Odyle straight from the game. Values update live while the reader runs and stay saved when you leave a room or sign out.')}</p>${appLink('text-button', t('Download the Windows app'))}</div>`;
// One row per saved character, one switch per room: the account's whole sharing
// setup in one place. Viewer rooms cannot see shared characters.
function sharingMatrix() {
  const { rooms, characters } = state;
  if (!characters.length)
    return `<p class="intro">${t('Characters appear here once the Windows reader sees them in game.')}</p>`;
  if (!rooms.length) return `<p class="intro">${t('Create or join a room, then choose which characters it sees.')}</p>`;
  return (
    characters
      .map(
        (c, i) =>
          `<div class="share-row"><div class="share-character">${portrait(c, i, 'mini')}<div><strong>${esc(c.characterName)}</strong><small>${esc(c.server)} · ${esc(regionLabel(c.region))}</small></div></div><div class="share-rooms">${rooms
            .map(r => {
              const shared = r.sharedCharacters?.includes(c.id),
                viewer = r.role === 'viewer';
              return `<button class="share-chip ${shared ? 'on' : ''}" data-share="${esc(c.id)}" data-room-id="${esc(r.id)}" data-enabled="${!shared}" aria-pressed="${shared}" ${viewer ? 'disabled' : ''} title="${viewer ? esc(t('Viewers cannot share characters in this room')) : esc(shared ? t('Hide {name} in {room}', { name: c.characterName, room: r.name }) : t('Show {name} in {room}', { name: c.characterName, room: r.name }))}"><i></i>${esc(r.name)}</button>`;
            })
            .join('')}</div></div>`,
      )
      .join('') +
    `<div class="share-row share-new-row"><div class="share-character"><div><strong>${t('New characters')}</strong><small>${t('shared on their own where this is on')}</small></div></div><div class="share-rooms">${rooms.map(r => shareNewChip(r.id, r.name, r.shareNew, r.role === 'viewer')).join('')}</div></div><p class="share-note">${t('New characters start private, except in rooms where New characters is on. Switched-off characters keep their saved values.')}</p>`
  );
}
// A character saved meanwhile (by the Windows reader): offer the rooms that do not show it yet.
const prompted = new Set();
export async function newCharacterPrompt(c) {
  if (prompted.has(c.id) || state.demo) return;
  prompted.add(c.id);
  state.rooms = (await pb.send('/api/odyle/rooms')).rooms;
  const open = state.rooms.filter(r => r.role !== 'viewer' && !r.sharedCharacters?.includes(c.id));
  if (!open.length) return;
  modal(
    esc(t('New character {name} saved', { name: c.characterName })),
    `<p>${t('It starts private. Add it to your rooms?')}</p><div class="add-chips prompt-chips">${open.map(r => `<button class="add-chip" data-prompt-share="${esc(c.id)}" data-room-id="${esc(r.id)}">${icon('plus')}${esc(r.name)}</button>`).join('')}</div><div class="modal-actions"><button class="button secondary" data-action="close-dialog">${t('Not now')}</button></div>`,
  );
}
// Re-render only when the rooms, the characters or a readiness state changed; otherwise just
// refresh the "ago" labels, so hover, focus and open menus survive the periodic refresh.
function librarySignature() {
  const now = Date.now() + state.serverOffset;
  return canonical([
    stable([{ characters: state.characters }]),
    state.characters.map(c => status({ ...c, sharing: true }, now)),
    state.characters.map(c => clockState(c, now)),
    state.clockRules,
    state.rooms.map(r => [r.id, r.name, r.role, r.cost, r.sharedCharacters]),
    readerNow()?.name ?? null,
  ]);
}
export const libraryChanged = () => librarySignature() !== renderedLibrary;
export function renderSharing() {
  const el = document.querySelector('.share-matrix');
  if (el)
    keepingDrafts(() => {
      el.innerHTML = sharingMatrix();
    });
}
// Redraws the rooms, the saved characters and the sharing list without touching the room forms.
export function renderLibrary() {
  const grid = document.querySelector('.personal-characters .member-grid'),
    list = document.querySelector('.room-section .room-list');
  if (!grid || !list) return;
  keepingDrafts(() => {
    renderedLibrary = librarySignature();
    list.innerHTML = roomItems();
    grid.innerHTML = characterCards();
    const button = document.querySelector('.personal-characters .reader-button');
    if (button) button.outerHTML = readerButton(`${icon('plus')} ${t('Connect reader')}`);
    document.querySelector('.room-section h2 span').textContent = state.rooms.length;
    document.querySelector('.personal-characters h2 span').textContent = state.characters.length;
    renderSharing();
  });
}
export async function library(ticket) {
  await leaveRoomTopic();
  clearRoom();
  // The Windows app's newest release does not hold the page back: its links show GitHub's latest-release page until it comes (#186).
  loadWindowsRelease().then(() => {
    if (ticket === state.navigation) renderAppLinks();
  });
  const [list, characters, ahead] = await Promise.all([
    pb.send('/api/odyle/rooms'),
    pb.collection('characters').getFullList({ sort: 'created' }),
    pb.send('/api/odyle/upcoming?days=14', { requestKey: 'next-runs' }).catch(() => null),
  ]);
  if (ticket !== state.navigation) return;
  state.nextRunsList = ahead?.runs || [];
  Object.assign(state, {
    rooms: list.rooms,
    perCube: list.odylePerCube || state.perCube,
    clockRules: list.clock || state.clockRules,
    gameMaps: list.maps || state.gameMaps,
    classIcons: list.classIcons || state.classIcons,
    keptDays: list.kept || state.keptDays,
    notificationsSeen: list.notifications || state.notificationsSeen,
    characters,
    readers: list.readers || [],
    online: true,
  });
  if (list.serverNow) state.serverOffset = Date.parse(list.serverNow) - Date.now();
  announced(list);
  libraryView();
  renderedLibrary = librarySignature();
}
// After the weekly reset, Rooms & characters says the week before is summed up, until it is
// opened or put away (pages.js weekSeenKey).
const lastWeekStart = () => periodStart('weekly', Date.now() + state.serverOffset, state.resets) - 7 * 86400000;
function weekReadyNote() {
  const start = lastWeekStart(),
    key = new Date(start).toISOString().slice(0, 10);
  if (
    !state.characters.some(c => c.lastReadingAt && timestamp(c.lastReadingAt) >= start) ||
    storage.getItem(weekSeenKey) === key
  )
    return '';
  return `<div class="week-ready">${icon('chart')}<p><strong>${t('Your week in Odyle is ready')}</strong><span>${esc(weekDates(start, start + 7 * 86400000))} · ${t('Cubes, regeneration, what was lost at the cap and a picture to share.')}</span></p><div class="week-ready-actions"><button class="button primary" data-action="week-ready">${t('See your week')} ${icon('arrow')}</button><button class="text-button" data-action="week-later" data-week="${key}">${t('Not now')}</button></div></div>`;
}

onData({
  room: el => go('/room/' + el.dataset.room),
  mainCharacter: async el => {
    const main = el.dataset.main === 'true';
    el.disabled = true;
    try {
      await send('main-character', { characterId: el.dataset.mainCharacter, main });
    } finally {
      el.disabled = false;
    }
    state.characters = state.characters.map(c => ({
      ...c,
      main: c.id === el.dataset.mainCharacter ? main : main ? false : c.main,
    }));
    toast(main ? t('{name} is your main character.', { name: el.dataset.name }) : t('No main character.'));
    return renderLibrary();
  },
  deleteCharacter: el =>
    ask(
      esc(t('Delete {name}?', { name: el.dataset.name })),
      t(
        'Its saved Odyle, history and portrait are deleted and every room stops listing it. If the Windows app sees it in game again, it saves it as a new character.',
      ),
      t('Delete character'),
      { 'confirm-delete-character': el.dataset.deleteCharacter },
    ),
  confirmDeleteCharacter: async el => {
    await send('delete-character', { characterId: el.dataset.confirmDeleteCharacter });
    closeModal();
    toast(t('Character deleted.'));
    return await show(true);
  },
});
onAction({
  'calendar-all': async () => {
    const { calendarOfRuns } = await runToolsPart();
    download(calendarOfRuns(state.nextRunsList, Date.now() + state.serverOffset), 'odyle-runs.ics', 'text/calendar');
  },
});
onSubmit({
  'create-form': async (form, data) => {
    const result = await send('create', { name: data.name });
    rememberInvites(storage, result.room.id, result.invites, Date.now() + state.serverOffset);
    await go('/room/' + result.room.id);
    await inviteDialog(result.invites);
  },
  'join-form': async (form, data) => {
    const result = await send('join', { code: data.code });
    toast(joinedMessage(result));
    await go('/room/' + result.room.id);
  },
});
