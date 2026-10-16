import { status, timestamp } from './model.js';
// Party readiness, the reference rules: tests/readiness.test.cjs runs them against
// tests/readiness-vectors.json. The Windows app's mirror (Odyle.Core.PartyReadiness) runs a copy
// of the same cases, and the integration suite checks the copy matches; a Go port can share them
// once a server feature needs the rules. Odyle cannot be pooled. Each player brings one character, their
// best live one, and the party can only do as many cubes as its lowest player allows.
// Stale, offline and unread characters keep their saved values but count for nothing.

// One character: its state, whether its value is known, the cubes that value holds and
// whether it is ready (live with enough for a cube).
export function character(c, now, cost) {
  const state = status(c, now), known = Boolean(c.confirmed && c.lastReadingAt);
  return { state, known, cubes: known ? Math.floor(c.value / cost) : 0, ready: state === 'live' && c.value >= cost };
}
// The party of a room from the entries it shows: characters, and members without one
// (no characterName). It lists the characters, the live and the ready ones, each player's
// best live character (ties: the one listed first) and the lowest of those (ties: the
// player listed first), the cubes the party can do and the players it does not count
// yet: members other than viewers without a live character.
export function party(entries, now, cost) {
  const characters = entries.filter(c => c.characterName);
  const live = characters.filter(c => status(c, now) === 'live'), ready = live.filter(c => c.value >= cost);
  const players = Object.values(live.reduce((best, c) => (!best[c.user] || c.value > best[c.user].value ? { ...best, [c.user]: c } : best), {}));
  const lowest = players.reduce((low, c) => !low || c.value < low.value ? c : low, null), counted = new Set(players.map(c => c.user));
  const uncounted = [...new Set(entries.filter(c => c.role !== 'viewer').map(c => c.user))].filter(user => !counted.has(user));
  return { characters, live, ready, players, lowest, cubes: lowest ? Math.floor(lowest.value / cost) : 0, uncounted };
}
// What the room's numbers rest on (#27): the character each counted player brings, the
// members not counted with when they were last in game, how many players there are and
// how many cubes each counted player can do. While not everyone is live, the last known
// party from every player's best saved value (an estimate when valueOf projects one); it is
// kept apart from live readiness and never counts toward it.
export function explain(entries, now, cost, valueOf = c => c.value) {
  const result = party(entries, now, cost), seen = c => c.lastSeenAt ? timestamp(c.lastSeenAt) : 0;
  const users = [...new Set(entries.filter(c => c.role !== 'viewer').map(c => c.user))];
  const missing = result.uncounted.map(user => {
    const own = entries.filter(c => c.user === user && c.characterName), last = own.reduce((at, c) => Math.max(at, seen(c)), 0);
    return { user, displayName: entries.find(c => c.user === user).displayName, shared: own.length > 0, lastSeenAt: last ? new Date(last).toISOString() : '' };
  });
  const spread = Object.entries(result.players.reduce((counts, c) => { const cubes = Math.floor(c.value / cost); return { ...counts, [cubes]: (counts[cubes] || 0) + 1 }; }, {}))
    .map(([cubes, players]) => ({ cubes: Number(cubes), players })).sort((a, b) => b.cubes - a.cubes);
  let lastKnown = null;
  if (missing.length) {
    const best = Object.values(entries.filter(c => c.characterName && c.role !== 'viewer' && c.confirmed && c.lastReadingAt)
      .reduce((bestOf, c) => (!bestOf[c.user] || valueOf(c) > valueOf(bestOf[c.user]) ? { ...bestOf, [c.user]: c } : bestOf), {}));
    // Only when a player not counted has a saved value: otherwise it repeats the live numbers.
    if (best.some(c => result.uncounted.includes(c.user))) {
      const lowest = best.reduce((low, c) => valueOf(c) < valueOf(low) ? c : low), read = best.map(c => timestamp(c.lastReadingAt));
      lastKnown = { lowest, value: valueOf(lowest), cubes: Math.floor(valueOf(lowest) / cost), players: best.length, of: users.length, newest: new Date(Math.max(...read)).toISOString(), oldest: new Date(Math.min(...read)).toISOString() };
    }
  }
  return { ...result, counted: new Set(result.players.map(c => c.id)), missing, members: users.length, spread, lastKnown };
}
