const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reading } = require('../backend/pb_hooks/lib/validation.cjs');
// Readiness is computed by the clients; the browser model is the reference implementation.
const model = () => import('../src/model.js');
const current = { sessionId: 'session', sequence: 5 };
const input = { sessionId: 'session', sequence: 6, source: 'packet', parserVersion: 'test-fixture-v1', confirmed: true, region: 'GLOBAL_EU', server: 'EU', characterName: 'Tester', value: 0 };
test('zero is confirmed while unknown stays unknown', async () => {
  const { status } = await model();
  assert.equal(reading(input, current, ['test-fixture-v1']).value, 0);
  const now = Date.now(), stamp = new Date(now).toISOString();
  assert.equal(status({ sharing: true, confirmed: true, value: 0, lastSeenAt: stamp, lastReadingAt: stamp }, now), 'live');
  assert.equal(status({ sharing: true, confirmed: false, value: 0, lastSeenAt: stamp }, now), 'unknown');
  assert.equal(status({ sharing: true, confirmed: false, value: 0, lastSeenAt: '', lastReadingAt: '' }, now), 'unknown');
});
test('an unchanged value stays live on presence; invalidated or silent readings do not', async () => {
  const { status } = await model();
  const now = Date.now(), iso = ms => new Date(now - ms).toISOString();
  assert.equal(status({ sharing: true, confirmed: true, valid: true, lastSeenAt: iso(0), lastReadingAt: iso(3600000) }, now), 'live');
  assert.equal(status({ sharing: true, confirmed: true, valid: false, lastSeenAt: iso(0), lastReadingAt: iso(0) }, now), 'stale');
  assert.equal(status({ sharing: true, confirmed: true, valid: true, lastSeenAt: iso(45000), lastReadingAt: iso(0) }, now), 'stale');
  assert.equal(status({ sharing: true, confirmed: true, lastSeenAt: iso(90000), lastReadingAt: iso(0) }, now), 'offline');
  assert.equal(status({ sharing: false, confirmed: true, valid: true, lastSeenAt: iso(0), lastReadingAt: iso(0) }, now), 'offline');
});
test('browser model handles PocketBase timestamps and escapes player-controlled text', async () => {
  const browser = await import('../src/model.js');
  const now = Date.parse('2026-10-12T12:00:00.000Z');
  const member = { sharing: true, confirmed: true, value: 0, lastSeenAt: '2026-10-12 12:00:00.000Z', lastReadingAt: '2026-10-12 11:59:15.000Z' };
  assert.equal(browser.status(member, now), 'live');
  assert.equal(browser.status({ ...member, valid: false }, now), 'stale');
  assert.equal(browser.status({ ...member, lastSeenAt: '2026-10-12 11:59:15.000Z' }, now), 'stale');
  assert.equal(browser.status({ sharing: true, confirmed: false, value: 0, lastReadingAt: '', lastSeenAt: '' }, now), 'unknown');
  assert.equal(browser.status({ ...member, source: 'manual', valid: true, lastReadingAt: member.lastSeenAt }, now), 'stale');
  assert.equal(browser.age(member.lastReadingAt, now), '45s ago');
  assert.equal(browser.age('2026-10-12 09:00:00.000Z', now), '3h ago');
  assert.equal(browser.escape('<img onerror="oops">'), '&lt;img onerror=&quot;oops&quot;&gt;');
});
test('wishlist dungeons are free text keyed regardless of case and spacing', () => {
  const { dungeon } = require('../backend/pb_hooks/lib/validation.cjs');
  assert.deepEqual(dungeon('  Fire   Temple '), { dungeon: 'Fire Temple', key: 'fire temple' });
  assert.equal(dungeon('FIRE\tTEMPLE').key, dungeon('fire temple').key);
  for (const bad of ['', '   ', 'x'.repeat(61), null, 42]) assert.throws(() => dungeon(bad));
});
test('reject stale sequence, wrong session, manual data, unknown adapters, fractional and unconfirmed values', () => {
  for (const change of [{ sequence: 5 }, { sessionId: 'old' }, { source: 'manual' }, { parserVersion: 'unverified' }, { value: -1 }, { value: 1.5 }, { value: null }, { confirmed: false }, { characterName: '' }, { region: 'KR' }]) assert.throws(() => reading({ ...input, ...change }, current, ['test-fixture-v1']));
});

test('production approves only the reference Global adapter', () => {
  const protocols = require('../backend/pb_hooks/lib/protocols.cjs');
  assert.deepEqual(protocols.verifiedAdapters, ['global-reference-v1']);
  assert.equal(reading({ ...input, parserVersion: 'global-reference-v1' }, current, protocols.verifiedAdapters).parserVersion, 'global-reference-v1');
  assert.throws(() => reading(input, current, protocols.verifiedAdapters), /not been validated/);
  assert.throws(() => reading({ ...input, parserVersion: 'reference-odyle-v1-unverified' }, current, protocols.verifiedAdapters), /not been validated/);
});
