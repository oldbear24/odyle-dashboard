import { t, tn, locale } from './i18n.js';
import { status, age, timestamp, escape as esc } from './model.js';

// The room's party explained (#27): who holds the party back, who is not counted and since
// when, and what the party had when last known. Built from readiness.js explain().

const cubeCount = cubes => tn(cubes, '{n} cube', '{n} cubes');
const player = c => c.characterName && c.characterName !== c.displayName ? `${c.displayName} · ${c.characterName}` : c.displayName;

// The lines under the room's numbers, as HTML.
export function partySummary(x, now, { estimated = false } = {}) {
  const lines = [];
  if (x.players.length >= 2 && x.lowest) {
    const spread = x.spread.map(s => t('{players} can do {cubes}', { players: tn(s.players, '{n} player', '{n} players'), cubes: cubeCount(s.cubes) })).join(', ');
    lines.push(`<p class="party-line bottleneck">${esc(t('{name} is the bottleneck', { name: player(x.lowest) }))} · ${esc(spread)}</p>`);
  }
  if (x.members) {
    const live = t('{live} of {all} players live', { live: x.players.length, all: x.members });
    const why = m => m.lastSeenAt ? t('last in game {age}', { age: age(m.lastSeenAt, now) }) : m.shared ? t('not read yet') : t('no character shared');
    const missing = x.missing.length ? ' · ' + t('Not counted: {names}', { names: x.missing.map(m => `${m.displayName} (${why(m)})`).join(', ') }) : '';
    lines.push(`<p class="party-line coverage">${esc(live + missing)}</p>`);
  }
  if (x.lastKnown) {
    const k = x.lastKnown, when = k.newest === k.oldest ? age(k.newest, now) : t('{newest} to {oldest}', { newest: age(k.newest, now), oldest: age(k.oldest, now) });
    const values = { cubes: cubeCount(k.cubes), name: player(k.lowest), value: Math.floor(k.value).toLocaleString(locale()), when };
    const text = estimated ? t('Last known, estimated with the Odyle clock: {cubes} · lowest {name} {value} · values from {when}', values) : t('Last known: {cubes} · lowest {name} {value} · values from {when}', values);
    lines.push(`<p class="party-line last-known">${esc(text)}${k.players < k.of ? ' · ' + esc(t('{n} of {all} players have a saved value', { n: k.players, all: k.of })) : ''}<span class="last-known-note">${esc(t('Not live: it does not count toward the party cubes.'))}</span></p>`);
  }
  return lines.length ? `<section class="party-explain" aria-label="${esc(t('Party summary'))}">${lines.join('')}</section>` : '';
}

// Why a character is not live, in words that also show on touch screens.
export function statusReason(c, now) {
  const state = status(c, now);
  if (state === 'live') return '';
  if (state === 'unknown') return t('No confirmed reading yet');
  if (state === 'offline') return c.lastSeenAt ? t('Last in game {age}', { age: age(c.lastSeenAt, now) }) : t('Never read in game');
  if (c.source === 'manual') return t('An old manual value');
  if (c.valid === false) return t('The reading ended: the game closed or another character was picked');
  return t('The reader has not been heard from for {n}s', { n: Math.floor((now - timestamp(c.lastSeenAt)) / 1000) });
}

// Cards closest to ready first: ready, live, stale, offline, then unread; the room's own
// order within each group, so nobody is ranked by value.
const order = { live: 1, stale: 2, offline: 3, unknown: 4 };
export function readyOrder(characters, now, cost) {
  const rank = c => { const state = status(c, now); return state === 'live' && c.value >= cost ? 0 : order[state]; };
  return characters.map((c, i) => [rank(c), i, c]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, , c]) => c);
}
