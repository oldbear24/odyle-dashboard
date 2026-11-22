// The character rows of Rooms & characters (library.js) and of a room (room.js): portraits,
// the row itself with its clock, what opens a character's dialogs (dialogs.js) and the switches
// that share characters with rooms. Loads with the first of those pages.
import { t, tn, locale } from '../i18n.js';
import { escape as esc, age, timestamp, classOf, regionLabel } from '../model.js';
import { icon } from '../icons.js';
import { link } from '../routes.js';
import { clockOf, clockLine, capMismatch, capLevel } from '../clock.js';
import { placeButton } from '../placeline.js';
import { pvpButton } from '../pvpline.js';
import { frameClass } from '../looks.js';
import { character as readinessOf } from '../readiness.js';
import { statusReason } from '../partyview.js';
import { classBadge, findPath, officialPath } from '../armorylinks.js';
import { findable } from '../regions.js';
import { startsIn } from '../runs.js';
import { applyShared } from '../live.js';
import { state } from './state.js';
import { pb, send, me } from './server.js';
import { toast, onAges } from './ui.js';
import { onData } from './actions.js';
import { libraryPart, roomPart } from './parts.js';
import { armoryImages } from './armory.js';
import { historyDialog, locationDialog, pvpDialog } from './dialogs.js';

const colors = ['jade', 'amber', 'blue', 'pink', 'violet'];
// The official game portrait (downloaded by the backend) sits over the initials,
// which remain as the fallback while it loads, if it fails or when there is none.
export function portrait(c, index, size = '') {
  const name = c.characterName || c.displayName,
    url = !state.demo && c.portrait ? pb.files.getURL(c, c.portrait) : '';
  const photo = url ? `<span class="portrait-photo"><img src="${esc(url)}" alt="" loading="lazy"></span>` : '';
  return `<span class="portrait ${colors[index % colors.length]} ${size}${frameClass(c.look)}">${esc(name.slice(0, 2).toUpperCase())}${photo}<span class="portrait-rune">${icon('diamond')}</span></span>`;
}
// The party shows only characters added (shared) to this room, the member's own
// included; their other characters wait in the add bar above the party.
export function flattened() {
  return state.members.flatMap(m => {
    const added = (m.characters || []).filter(c => c.shared ?? m.sharing);
    return added.length
      ? added.map(c => ({
          ...c,
          sharing: true,
          user: m.user,
          membershipId: m.id,
          role: m.role,
          displayName: m.displayName,
          look: m.look,
        }))
      : [{ ...m, id: '', characterName: '', confirmed: false, lastReadingAt: '', source: 'packet' }];
  });
}
// The Odyle clock of a character as its card shows it, without the time left to the next tick
// (the ages keep that current): what changes at a tick, and the cap flag (#199).
export function clockState(c, now) {
  const clock = clockOf(c, now, state.clockRules);
  return clock && [clock.total, clock.next, clock.full, clock.fills.map(f => f.at), capLevel(clock, now)];
}
// The runs' "in 2h 5m" and the cards' clock lines ("+15 in 2h 5m") count down in place.
onAges(now => {
  document.querySelectorAll('[data-starts]').forEach(el => {
    el.textContent = startsIn(timestamp(el.dataset.starts), now);
  });
  const clocks = document.querySelectorAll('[data-clock]'),
    list = clocks.length ? (state.room ? flattened() : state.characters) : [];
  clocks.forEach(el => {
    const c = list.find(x => x.id === el.dataset.clock),
      clock = c && clockOf(c, now, state.clockRules);
    if (clock) el.textContent = clockLine(clock, now, 'fresh' in el.dataset);
  });
});
// Column names over the character rows on wide screens.
export const listHead = () =>
  `<div class="party-head" aria-hidden="true"><span>${t('Character')}</span><span>${t('Status')}</span><span>${t('Odyle')}</span><span>${t('Regeneration')}</span><span>${t('Cubes')}</span><span></span></div>`;
export function card(c, index, counted = null, cost = state.room?.cost || state.perCube) {
  const { room, demo } = state;
  const now = Date.now() + state.serverOffset,
    { state: reading, known, cubes, ready } = readinessOf(c, now, cost),
    fresh = reading === 'live';
  // The Windows app read the character without its Odyle record, which comes at level 22 (odyle-windows#6).
  const locked = c.odyleLocked && !known;
  const labels = { live: t('Live'), stale: t('Stale'), unknown: t('No reading'), offline: t('Offline') },
    self = c.user === pb.authStore.record?.id && !demo;
  const history =
    c.id && c.characterName && (known || !demo)
      ? `<button data-history="${esc(c.id)}" data-name="${esc(c.characterName)}" class="icon-only" title="${esc(t('Odyle history of {name}', { name: c.characterName }))}">${icon('chart')}<span class="sr-only">${t('History')}</span></button>`
      : '';
  const action =
    self && room && c.id
      ? `<button class="remove" data-share="${esc(c.id)}" data-enabled="false" data-name="${esc(c.characterName)}" ${c.role === 'viewer' ? 'disabled' : ''} title="${esc(t('Hide {name} from this room. Its saved values stay on your account.', { name: c.characterName }))}">${t('Hide')}</button>`
      : self && !room
        ? `${c.id ? mainToggle(c) : ''}<button data-character="${esc(c.id || '')}" data-action="reading">${t('Reader')}</button>${c.id ? `<button class="remove" data-delete-character="${esc(c.id)}" data-name="${esc(c.characterName)}" title="${esc(t('Delete {name} from your account', { name: c.characterName }))}">${t('Delete')}</button>` : ''}`
        : '';
  // The profile itself once the daily lookup found the character on PLAYNC, else a search by name.
  const armoryPath =
    officialPath(c) || (c.characterName && findable(c) ? findPath(c.region, c.server, c.characterName) : '');
  const armory =
    !demo && armoryPath
      ? `<a class="card-link icon-only" href="${esc(link(armoryPath))}" title="${esc(t('Gear and stats of {name} on PLAYNC', { name: c.characterName }))}">${icon('search')}<span class="sr-only">${t('Armory')}</span></a>`
      : '';
  // A packet reading needs no label; samples, old manual values and characters waiting for the game say so.
  const source = demo
    ? t('Sample')
    : c.source === 'packet'
      ? ''
      : c.source === 'manual'
        ? t('Legacy manual')
        : t('Waiting for game');
  // The player's name, look (#107) and crown head their group (room.js playerGroups).
  const where = [c.server, regionLabel(c.region)].filter(Boolean).join(' ');
  const meta = [classOf(c), where].filter(Boolean).map(esc).join(' · '),
    clock = known && clockOf(c, now, state.clockRules);
  // Where the character was last seen, when its player shares it (places.js).
  const place = demo ? '' : placeButton(c, state.gameMaps, now) + pvpButton(c);
  const counts = counted?.has(c.id)
    ? `<span class="counts-for" title="${esc(t('Counts for {name}', { name: c.displayName }))}">${icon('diamond')}${t('counts')}</span>`
    : '';
  const changed = `${source ? `${source} · ` : ''}${known ? `${t('changed')} <span data-age="${esc(c.lastReadingAt)}">${age(c.lastReadingAt, now)}</span>` : t('Not confirmed')}`;
  // Orange two days before the natural pool is full, red once it is or within the hour.
  const level = capLevel(clock, now),
    flag =
      level === 'soon'
        ? [t('Nearly full'), t('Its natural pool is full within two days: spend Odyle before regeneration is lost.')]
        : level
          ? [
              !clock.full
                ? t('Full within the hour')
                : clock.settled
                  ? t('Full')
                  : t('Full at {cap}?', { cap: clock.cap.toLocaleString(locale()) }),
              t('Its natural pool is full, or will be within the hour: each tick after that is lost.'),
            ]
          : null;
  return (
    `<article class="member-card ${ready ? 'is-ready' : ''} ${reading === 'offline' ? 'is-offline' : ''} ${c.main ? 'is-main' : ''} ${level ? `cap-${level}` : ''}"><div class="row-id">${portrait(c, index)}<div class="card-id"><div class="member-name"><span class="name-text">${esc(c.characterName || c.displayName)}</span>${c.main ? `<span class="main-label" title="${esc(t('Main character of {name}', { name: c.displayName }))}">${icon('star')}<span class="main-word">${t('Main')}</span></span>` : ''}</div><div class="member-meta"${classOf(c) ? ` title="${esc(t('Class and level from PLAYNC, checked daily'))}"` : ''}>${demo ? '' : classBadge(armoryImages(), state.classIcons[c.className], c.className)}${meta}</div>${place}</div></div>` +
    `<div class="row-state"><span class="status ${reading}"><i></i>${labels[reading]}</span>${c.characterName && !fresh ? `<span class="status-why">${esc(statusReason(c, now))}</span>` : ''}</div>` +
    `<div class="row-energy"><div class="energy"><strong>${known ? c.value.toLocaleString(locale()) : '—'}</strong><span>${t('Odyle')}</span></div><div class="energy-track"><i style="width:${known ? Math.min(100, (c.value / (cost * 8)) * 100) : 0}%"></i></div>${known && c.parts ? `<div class="energy-split">${esc(t('natural {base} · items {bonus}', { base: c.parts.base.toLocaleString(locale()), bonus: c.parts.bonus.toLocaleString(locale()) }))}</div>` : ''}<div class="row-changed">${locked ? t('No Odyle yet · it unlocks at level 22') : changed}</div></div>` +
    `<div class="row-clock">${flag ? `<span class="cap-flag" title="${esc(flag[1])}">${icon('alert')}${esc(flag[0])}</span>` : ''}${clock ? `<div class="energy-clock" data-clock="${esc(c.id)}"${fresh ? ' data-fresh' : ''}>${esc(clockLine(clock, now, fresh))}</div>` : ''}${self && capMismatch(c) ? `<div class="energy-clock cap-mismatch">${esc(t('Its natural pool held {max}, more than {cap}: has the membership started? Account & data → Membership.', { max: c.naturalMax.toLocaleString(locale()), cap: c.answeredCap.toLocaleString(locale()) }))}</div>` : ''}</div>` +
    `<div class="row-cubes cube-line">${known ? `<span><strong>${cubes}</strong> ${esc(tn(cubes, 'cube', 'cubes'))}</span>` : `<span>${locked ? t('No Odyle yet') : t('No confirmed reading')}</span>`}<span class="readiness ${ready ? 'ready' : ''}">${ready ? t('Ready') : fresh ? t('Low energy') : known ? t('last saved') : ''}</span>${counts}</div>` +
    `<div class="card-actions">${armory}${history}${action}</div></article>`
  );
}
// The star on a saved character in the library: marks it as the account's main, or clears the mark.
const mainToggle = c =>
  `<button class="icon-only main-toggle" data-main-character="${esc(c.id)}" data-name="${esc(c.characterName)}" data-main="${!c.main}" aria-pressed="${Boolean(c.main)}" title="${esc(c.main ? t('{name} is your main character. Click to unmark it.', { name: c.characterName }) : t('Make {name} your main character', { name: c.characterName }))}">${icon('star')}<span class="sr-only">${t('Main character')}</span></button>`;
// Whether the characters this account saves from now on are shared in a room by themselves;
// the switch is labelled with the room's name, or with what it does inside the room.
export function shareNewChip(roomId, name, shared, viewer, label = name) {
  return `<button class="share-chip ${shared ? 'on' : ''}" data-share-new="${esc(roomId)}" data-enabled="${!shared}" aria-pressed="${Boolean(shared)}" ${viewer ? 'disabled' : ''} title="${viewer ? esc(t('Viewers cannot share characters in this room')) : esc(shared ? t('New characters are shared in {room} by themselves', { room: name }) : t('Share new characters in {room} by themselves', { room: name }))}"><i></i>${esc(label)}</button>`;
}

// What a share switch changed: the open room draws it from the answer (room.js changedRoom),
// Rooms & characters its sharing list (library.js).
const changedRoom = (id, update) => roomPart.loaded()?.changedRoom(id, update);
const renderSharing = () => libraryPart.loaded()?.renderSharing();
onData({
  history: el => historyDialog(el.dataset.history, el.dataset.name),
  location: el => locationDialog(el.dataset.location, el.dataset.name),
  pvp: el => pvpDialog(el.dataset.pvp, el.dataset.name),
  shareNew: async el => {
    const roomId = el.dataset.shareNew,
      enabled = el.dataset.enabled === 'true',
      target = state.rooms.find(r => r.id === roomId) || (state.room?.id === roomId ? state.room : null);
    el.disabled = true;
    try {
      await send('share-new', { roomId, enabled });
    } finally {
      el.disabled = false;
    }
    state.rooms = state.rooms.map(r => (r.id === roomId ? { ...r, shareNew: enabled } : r));
    if (state.room?.id === roomId && me()) {
      me().shareNew = enabled;
      roomPart.loaded()?.roomSettings();
    } else renderSharing();
    return toast(
      enabled
        ? t('New characters you save will be shared in {room}.', { room: target?.name || '' })
        : t('New characters start private in {room} again.', { room: target?.name || '' }),
    );
  },
  promptShare: async el => {
    const roomId = el.dataset.roomId;
    el.disabled = true;
    const result = await send('sharing', { roomId, characterId: el.dataset.promptShare, enabled: true });
    state.rooms = state.rooms.map(r =>
      r.id === roomId ? { ...r, sharedCharacters: result.sharedCharacters, sharing: true } : r,
    );
    if (state.room?.id === roomId) changedRoom(roomId, () => applyShared(me(), result.sharedCharacters));
    else if (!state.room) renderSharing();
    el.classList.add('done');
    el.setAttribute('aria-pressed', 'true');
    el.innerHTML = icon('tick') + esc(el.textContent);
  },
  share: async el => {
    const roomId = el.dataset.roomId || state.room.id;
    el.disabled = true;
    const enabled = el.dataset.enabled === 'true',
      name = el.dataset.name;
    let result;
    try {
      result = await send('sharing', { roomId, characterId: el.dataset.share, enabled });
    } finally {
      el.disabled = false;
    }
    if (state.room) {
      changedRoom(roomId, () => applyShared(me(), result.sharedCharacters));
      if (!enabled && name)
        toast(t('{name} was removed from this room. Its saved values stay on your account.', { name }));
      return;
    }
    state.rooms = state.rooms.map(r =>
      r.id === roomId
        ? { ...r, sharedCharacters: result.sharedCharacters, sharing: result.sharedCharacters.length > 0 }
        : r,
    );
    return renderSharing();
  },
});
