import { status, timestamp } from './model.js';
import { clockOf, ticksAfter } from './clock.js';

// Run readiness (#29): the party of a planned run is its attendees, each with one character:
// the one they picked when they joined, else their best character shared in the room (live
// first, else the fullest saved one). Cubes count at the run's own cost. Before the start, the
// Odyle clock projects each character to the start (natural regeneration only, an estimate).

// The value a character is expected to hold at a moment: its value now if live and the moment
// is now, else the clock's projection from its last reading, else its last saved value.
export function valueAt(c, at, now, rules) {
  if (at <= now && status(c, now) === 'live') return c.value;
  return clockOf(c, at, rules)?.total ?? c.value;
}

// The character an attendee brings: their pick, else their best live one, else their best known one.
export function broughtBy(user, entries, now, pick = '') {
  const own = entries.filter(c => c.user === user && c.characterName);
  const picked = pick && own.find(c => c.id === pick);
  if (picked) return { character: picked, picked: true };
  const best = list => list.reduce((top, c) => !top || c.value > top.value ? c : top, null);
  const live = best(own.filter(c => status(c, now) === 'live'));
  return { character: live || best(own.filter(c => c.confirmed && c.lastReadingAt)), picked: false };
}

// Each attendee with their character, its state, cubes now and at the start, and how many can
// claim a cube at the start (live and enough now, or expected to have enough by then).
export function runReadiness(run, entries, now, cost, rules) {
  const start = timestamp(run.startsAt), at = Math.max(start, now);
  const rows = run.attendees.map(user => {
    const { character, picked } = broughtBy(user, entries, now, run.picks?.[user]);
    if (!character) return { user, character: null, picked: false, state: 'unknown', cubes: 0, cubesAtStart: 0, claims: false };
    const state = status(character, now), later = valueAt(character, at, now, rules);
    return { user, character, picked, state, cubes: Math.floor(character.value / cost), cubesAtStart: Math.floor(later / cost), claims: later >= cost };
  });
  return { rows, claim: rows.filter(r => r.claims).length, of: rows.length };
}

// The earliest moment, now or a regeneration tick in the next week, at which every player's
// best character is expected to hold a cube; null when someone never gets there (or has no
// value at all).
export function earliestClaim(players, now, cost, rules) {
  if (!players.length || players.some(c => !c)) return null;
  const moments = [now, ...ticksAfter(now, now + 7 * 86400000, rules?.tickHours || [])];
  return moments.find(at => players.every(c => valueAt(c, at, now, rules) >= cost)) ?? null;
}
