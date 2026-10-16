const { test } = require('node:test');
const assert = require('node:assert/strict');
// Run readiness (src/runready.js): the attendees' characters, cubes at the run's cost and at its start.
const now = Date.parse('2026-10-15T12:00:00Z');
const ago = seconds => new Date(now - seconds * 1000).toISOString();
const rules = { tickHours: [1, 4, 7, 10, 13, 16, 19, 22], tick: 15, caps: [560, 840], paused: false };
const c = (id, user, value, extra = {}) => ({ id, user, displayName: user, role: 'reporter', characterName: id, value, confirmed: true, valid: true, source: 'packet', sharing: true, lastSeenAt: ago(5), lastReadingAt: ago(60), ...extra });
const entries = [
  c('main', 'anna', 300), c('alt', 'anna', 90),
  c('kael', 'kaelen', 35, { parts: { base: 35, bonus: 0 }, lastSeenAt: ago(3600), lastReadingAt: ago(3600) }),
  c('nyx', 'nyx', 50, { lastSeenAt: ago(7200) }),
];
test('each attendee brings their pick, else their best live character, else their best saved one', async () => {
  const { broughtBy } = await import('../src/runready.js');
  assert.deepEqual([broughtBy('anna', entries, now).character.id, broughtBy('anna', entries, now, 'alt').character.id, broughtBy('anna', entries, now, 'gone').character.id], ['main', 'alt', 'main']);
  assert.equal(broughtBy('anna', entries, now, 'alt').picked, true);
  assert.equal(broughtBy('kaelen', entries, now).character.id, 'kael', 'a saved value when nothing is live');
  assert.equal(broughtBy('ghost', entries, now).character, null);
});
test('a run counts its attendees at its own cost, now and at its start', async () => {
  const { runReadiness, earliestClaim } = await import('../src/runready.js');
  // Kaelen holds 35 of 40 now; the 13:00 tick brings 15 more before a 14:30 start.
  const run = { startsAt: '2026-10-15 14:30:00.000Z', attendees: ['anna', 'kaelen', 'nyx'], picks: { anna: 'alt' } };
  const x = runReadiness(run, entries, now, 40, rules);
  assert.deepEqual(x.rows.map(r => [r.user, r.character.id, r.picked, r.state, r.cubes, r.cubesAtStart, r.claims]), [
    ['anna', 'alt', true, 'live', 2, 2, true], ['kaelen', 'kael', false, 'offline', 0, 1, true], ['nyx', 'nyx', false, 'offline', 1, 1, true]]);
  assert.deepEqual([x.claim, x.of], [3, 3]);
  // Before the tick nobody has a cube for Kaelen yet; an 80-Odyle dungeon is out of reach for two.
  assert.equal(runReadiness({ ...run, startsAt: '2026-10-15 12:30:00.000Z' }, entries, now, 40, rules).claim, 2);
  assert.deepEqual(runReadiness(run, entries, now, 80, rules).rows.map(r => r.claims), [true, false, false]);
  // When can everyone go: Kaelen reaches 40 at 13:00; a player without a value never does.
  assert.equal(new Date(earliestClaim([entries[0], entries[2], entries[3]], now, 40, rules)).toISOString(), '2026-10-15T13:00:00.000Z');
  assert.equal(earliestClaim([entries[0]], now, 40, rules), now);
  assert.equal(earliestClaim([entries[0], null], now, 40, rules), null);
  assert.equal(earliestClaim([entries[3]], now, 80, rules), null, 'without the two numbers the clock cannot project');
});
