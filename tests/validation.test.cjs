const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reading, status } = require('../backend/pb_hooks/lib/validation.cjs');
const current = { sessionId: 'session', sequence: 5 };
const input = { sessionId: 'session', sequence: 6, source: 'packet', parserVersion: 'test-fixture-v1', confirmed: true, region: 'GLOBAL_EU', server: 'EU', characterName: 'Tester', value: 0 };
test('zero is confirmed while unknown stays unknown', () => {
  assert.equal(reading(input, current, ['test-fixture-v1']).value, 0);
  const now = Date.now(), stamp = new Date(now).toISOString();
  assert.equal(status({ sharing: true, confirmed: true, value: 0, lastSeenAt: stamp, lastReadingAt: stamp }, now), 'live');
  assert.equal(status({ sharing: true, confirmed: false, value: 0, lastSeenAt: stamp }, now), 'unknown');
  assert.equal(status({ sharing: true, confirmed: false, value: 0, lastSeenAt: '', lastReadingAt: '' }, now), 'unknown');
});
test('heartbeat cannot revive a stale reading', () => {
  const now = Date.now();
  assert.equal(status({ sharing: true, confirmed: true, lastSeenAt: new Date(now).toISOString(), lastReadingAt: new Date(now - 45000).toISOString() }, now), 'stale');
  assert.equal(status({ sharing: true, confirmed: true, lastSeenAt: new Date(now - 90000).toISOString(), lastReadingAt: new Date(now).toISOString() }, now), 'offline');
});
test('browser model handles PocketBase timestamps and escapes player-controlled text', async () => {
  const browser = await import('../src/model.js');
  const now = Date.parse('2026-10-12T12:00:00.000Z');
  const member = { sharing: true, confirmed: true, value: 0, lastSeenAt: '2026-10-12 12:00:00.000Z', lastReadingAt: '2026-10-12 11:59:15.000Z' };
  assert.equal(browser.status(member, now), 'stale');
  assert.equal(browser.status({ sharing: true, confirmed: false, value: 0, lastReadingAt: '', lastSeenAt: '' }, now), 'unknown');
  assert.equal(browser.status({ ...member, source: 'manual', valid: true, lastReadingAt: member.lastSeenAt }, now), 'stale');
  assert.equal(browser.age(member.lastReadingAt, now), '45s ago');
  assert.equal(browser.escape('<img onerror="oops">'), '&lt;img onerror=&quot;oops&quot;&gt;');
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
