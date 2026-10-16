import { t } from './i18n.js';
import { timestamp } from './model.js';
import { localInput } from './runs.js';
// Checks the wishlist and run forms make before sending, so a mistake shows in the form
// at once instead of after a round trip. Each answers the server's own message, or ''.
// The server checks everything again (backend validation.go and accounts.go); these
// spare a request, they decide nothing.
const hour = 3600000, day = 86400000;
// Dungeon names match as the server matches them: trimmed, inner spaces collapsed, any case.
const key = name => String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
// A dungeon name is required; with a dungeon catalog it must be listed, unless it names
// something that already exists (a wishlist entry, the run's own dungeon).
export function dungeonProblem(name, catalog = [], existing = []) {
  const typed = key(name), trimmed = String(name ?? '').trim();
  if (!trimmed || [...trimmed].length > 60) return t('Dungeon is required (max 60 characters).');
  if (catalog.length && ![...catalog, ...existing].some(d => key(d) === typed)) return t('Choose a dungeon from the list.');
  return '';
}
// Adding a dungeon to the wishlist: up to 20 per member and 50 per room.
export function wishProblem(name, { catalog = [], wishlist = [], myId = '' }) {
  const problem = dungeonProblem(name, catalog, wishlist.map(w => w.dungeon));
  if (problem) return problem;
  const entry = wishlist.find(w => key(w.dungeon) === key(name));
  if (entry?.users.includes(myId)) return '';
  if (wishlist.filter(w => w.users.includes(myId)).length >= 20) return t('You can have up to 20 dungeons on a room\'s wishlist.');
  if (!entry && wishlist.length >= 50) return t('This room\'s wishlist is full (50 dungeons).');
  return '';
}
// Whether the start typed into a run's change form differs from its start (the form shows whole minutes).
export const moved = (run, value) => value !== localInput(timestamp(run.startsAt));
// Planning a run, or changing `run`: a dungeon, a start from an hour ago up to 60 days
// ahead (a changed run's start only when it moved) and up to 20 runs per room.
export function runProblem({ dungeon, startsAt }, { now, catalog = [], runs = [], run = null }) {
  const problem = dungeonProblem(dungeon, catalog, run ? [run.dungeon] : []);
  if (problem) return problem;
  const at = new Date(startsAt || '').getTime();
  if (Number.isNaN(at)) return t('Choose when the run starts.');
  if ((!run || moved(run, startsAt)) && (at < now - hour || at > now + 60 * day)) return t('A run can start from an hour ago up to 60 days ahead.');
  if (!run && runs.length >= 20) return t('A room can plan up to 20 runs at a time.');
  return '';
}
