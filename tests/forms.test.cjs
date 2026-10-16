const { test } = require('node:test');
const assert = require('node:assert/strict');
// Checks the wishlist and run forms make before sending (src/forms.js), in the server's
// own words; the server's checks are Go tests (backend/odyle).
const forms = () => import('../src/forms.js');
const window = 'A run can start from an hour ago up to 60 days ahead.', listed = 'Choose a dungeon from the list.';
test('dungeon names are required and, with a catalog, listed or already on the wishlist', async () => {
  const { dungeonProblem, wishProblem } = await forms();
  assert.equal(dungeonProblem('  Fire   temple ', ['Fire Temple']), '');
  for (const name of ['   ', '', undefined, 'x'.repeat(61)]) assert.equal(dungeonProblem(name, []), 'Dungeon is required (max 60 characters).');
  assert.equal(dungeonProblem('Anywhere', []), '');
  assert.equal(dungeonProblem('Nowhere', ['Fire Temple']), listed);
  assert.equal(dungeonProblem('old cave', ['Fire Temple'], ['Old Cave']), '');
  // An entry already on the wishlist can be joined although the catalog dropped it.
  const wishlist = [{ dungeon: 'Old Cave', users: ['u2'] }, { dungeon: 'Fire Temple', users: ['u1'] }];
  assert.equal(wishProblem('old cave', { catalog: ['Fire Temple'], wishlist, myId: 'u1' }), '');
  assert.equal(wishProblem('Nowhere', { catalog: ['Fire Temple'], wishlist, myId: 'u1' }), listed);
  // Up to 20 dungeons per member and 50 per room; repeating your own entry is no new one.
  const mine = Array.from({ length: 20 }, (_, i) => ({ dungeon: 'D' + i, users: ['u1'] }));
  assert.equal(wishProblem('d3', { wishlist: mine, myId: 'u1' }), '');
  assert.equal(wishProblem('New', { wishlist: mine, myId: 'u1' }), 'You can have up to 20 dungeons on a room\'s wishlist.');
  const full = Array.from({ length: 50 }, (_, i) => ({ dungeon: 'D' + i, users: ['u2'] }));
  assert.equal(wishProblem('D7', { wishlist: full, myId: 'u1' }), '');
  assert.equal(wishProblem('New', { wishlist: full, myId: 'u1' }), 'This room\'s wishlist is full (50 dungeons).');
});
test('runs start from an hour ago up to 60 days ahead, and a changed run keeps a start it did not move', async () => {
  const { runProblem, moved } = await forms(), { localInput, runWindow } = await import('../src/runs.js');
  const now = Date.parse('2026-10-15T12:00:30Z'), at = ms => localInput(now + ms), hour = 3600000, day = 86400000;
  // The bounds of the time input: whole minutes inside the server's window.
  assert.deepEqual(runWindow(now), { min: Date.parse('2026-10-15T11:01:00Z'), max: Date.parse('2026-12-14T12:00:00Z') });
  assert.equal(runProblem({ dungeon: 'Fire Temple', startsAt: at(hour) }, { now }), '');
  assert.equal(runProblem({ dungeon: 'Fire Temple', startsAt: '' }, { now }), 'Choose when the run starts.');
  assert.equal(runProblem({ dungeon: 'Fire Temple', startsAt: at(-2 * hour) }, { now }), window);
  assert.equal(runProblem({ dungeon: 'Fire Temple', startsAt: at(61 * day) }, { now }), window);
  assert.equal(runProblem({ dungeon: 'Nowhere', startsAt: at(hour) }, { now, catalog: ['Fire Temple'] }), listed);
  assert.equal(runProblem({ dungeon: 'Fire Temple', startsAt: at(hour) }, { now, runs: Array(20).fill({}) }), 'A room can plan up to 20 runs at a time.');
  // A run that started two hours ago keeps its time and its dungeon, even one the catalog dropped.
  const run = { dungeon: 'Old Cave', startsAt: new Date(now - 2 * hour).toISOString() }, start = localInput(now - 2 * hour);
  assert.equal(moved(run, start), false); assert.equal(moved(run, at(hour)), true);
  assert.equal(runProblem({ dungeon: 'old  cave', startsAt: start }, { now, catalog: ['Fire Temple'], run, runs: Array(20).fill({}) }), '');
  assert.equal(runProblem({ dungeon: 'Old Cave', startsAt: at(-3 * hour) }, { now, run }), window);
  assert.equal(runProblem({ dungeon: 'Nowhere', startsAt: start }, { now, catalog: ['Fire Temple'], run }), listed);
});
test('form problems read in Czech', async () => {
  const { runProblem } = await forms(), { useLanguage } = await import('../src/i18n.js');
  try { await useLanguage('cs'); assert.equal(runProblem({ dungeon: 'Fire Temple', startsAt: '' }, { now: Date.now() }), 'Vyber, kdy run začíná.'); }
  finally { await useLanguage('en'); }
});
