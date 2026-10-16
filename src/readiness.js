import { status } from './model.js';
// Party readiness, the reference rules: tests/readiness.test.cjs runs them against
// tests/readiness-vectors.json, which the Go and C# ports will share once a server or app
// feature needs them. Odyle cannot be pooled. Each player brings one character, their
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
