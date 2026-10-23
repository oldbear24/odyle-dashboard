const { test } = require('node:test');
const assert = require('node:assert/strict');
// The run's party (src/runs.js): the waitlist beyond the dungeon's party size, the make-up by class
// roles, and who a call to a run now invites (src/runready.js callable).
const catalog = [{ name: 'Fire Temple', cost: 0, partySize: 4, category: '', unconfirmed: false }];
const roles = [{ class: 'Templar', role: 'tank' }, { class: 'Cleric', role: 'healer' }, { class: 'Chanter', role: 'support' }, { class: 'Ranger', role: 'damage' }];
test('those going beyond the party size wait for a place, first come first', async () => {
  const { runParty, goingCountOf, discordText } = await import('../src/runs.js');
  const run = { dungeon: 'fire  temple', startsAt: '2026-10-14 19:00:00.000Z', attendees: ['a', 'b', 'c', 'd', 'e', 'f'] };
  assert.deepEqual(runParty(run, catalog), { party: ['a', 'b', 'c', 'd'], waiting: ['e', 'f'], size: 4 });
  assert.equal(goingCountOf(run, catalog), '4/4 going · 2 waiting');
  assert.equal(goingCountOf({ ...run, attendees: ['a', 'b'] }, catalog), '2/4 going');
  assert.deepEqual(runParty({ ...run, dungeon: 'Ice Temple' }, catalog).waiting, [], 'no party size: everyone goes');
  assert.equal(goingCountOf({ ...run, dungeon: 'Ice Temple' }, catalog), '6 going');
  assert.match(discordText(run, { going: ['A', 'B', 'C', 'D'], waiting: ['E', 'F'], partySize: 4 }), / · Going \(4\/4\): A, B, C, D · Waiting for a place \(2\): E, F$/);
});
test('a full run offers the waitlist, lists who waits and counts its party only', async () => {
  const { runsSection } = await import('../src/runs.js'), { runReadiness } = await import('../src/runready.js');
  const now = Date.parse('2026-10-14T12:00:00Z'), seen = new Date(now - 5000).toISOString();
  const member = (user, className) => ({ id: user, user, role: 'reporter', characterName: user, className, value: 100, confirmed: true, valid: true, source: 'packet', sharing: true, lastSeenAt: seen, lastReadingAt: seen });
  const entries = [member('a', 'Templar'), member('b', 'Ranger'), member('c', 'Ranger'), member('d', ''), member('e', 'Cleric')];
  const run = { id: 'r1', dungeon: 'Fire Temple', startsAt: '2026-10-14 19:00:00.000Z', note: '', planner: 'a', attendees: ['a', 'b', 'c', 'd', 'e'] };
  const html = runsSection({ runs: [run], members: entries.map(c => ({ user: c.user, displayName: c.user.toUpperCase(), role: 'reporter' })), myId: 'me', viewer: false, owner: false, live: new Set(), now, suggestions: [], catalog, demo: false, roles,
    readiness: r => runReadiness(r, entries, now, 40, { tickHours: [], tick: 15, caps: [560], paused: true }) });
  assert.match(html, /Join the waitlist/);
  assert.match(html, /Waiting for a place: E/);
  assert.match(html, /4 of 4 can claim a cube at the start/);
  // The Cleric waits, so the party has no healer.
  assert.match(html, /<small class="run-makeup">Make-up: Templar · 2× Ranger · 1 class unknown · <b class="run-missing">no healer<\/b><\/small>/);
  assert.match(html, /data-call-run title="Starts in about 10 minutes/);
  assert.match(runsSection({ runs: [], members: [], myId: 'me', viewer: false, owner: false, live: new Set(), now, suggestions: [], demo: false, called: true }), /data-call-run disabled title="The party was called less than 30 minutes ago/);
});
test('the make-up counts classes by role and names a missing tank or healer once three go', async () => {
  const { makeUp, makeUpLine } = await import('../src/runs.js');
  const c = className => ({ className });
  assert.deepEqual(makeUp([c('Ranger'), c('Cleric'), c('Templar'), c('Ranger')], roles), { classes: [{ name: 'Templar', n: 1, role: 'tank' }, { name: 'Cleric', n: 1, role: 'healer' }, { name: 'Ranger', n: 2, role: 'damage' }], unknown: 0, missing: [] });
  assert.deepEqual(makeUp([c('Ranger'), c('Bard'), null], roles).missing, ['tank', 'healer']);
  assert.deepEqual(makeUp([c('Ranger'), c('Ranger')], roles).missing, [], 'two going miss nothing yet');
  assert.deepEqual(makeUp([c('Ranger'), c('Ranger'), c('Ranger')], []).missing, [], 'no roles kept: nothing is missing');
  assert.equal(makeUp([null, c('')], roles), null);
  assert.equal(makeUpLine([null], roles), '');
  assert.equal(makeUpLine([c('Bard'), c('Templar')], roles), '<small class="run-makeup">Make-up: Templar · Bard</small>');
});
test('a call invites the players who play now or hold a cube by the start, never viewers or the caller', async () => {
  const { callable } = await import('../src/runready.js');
  const now = Date.parse('2026-10-15T12:00:00Z'), ago = s => new Date(now - s * 1000).toISOString();
  const c = (user, value, seen, extra = {}) => ({ id: user, user, role: 'reporter', characterName: user, value, confirmed: true, valid: true, source: 'packet', sharing: true, lastSeenAt: ago(seen), lastReadingAt: ago(seen), ...extra });
  const entries = [c('me', 300, 5), c('live', 10, 5), c('rich', 400, 7200), c('poor', 10, 7200), c('watcher', 400, 5, { role: 'viewer' }), { user: 'empty', role: 'reporter', characterName: '' }];
  assert.deepEqual(callable(entries, 'me', now, now + 600000, 40, { tickHours: [], tick: 15, caps: [560], paused: false }), ['live', 'rich']);
});
