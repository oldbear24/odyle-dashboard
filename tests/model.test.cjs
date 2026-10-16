const { test } = require('node:test');
const assert = require('node:assert/strict');
// Readiness is computed by the clients; the browser model is the reference implementation.
// The backend's checks of readings, dungeons and tasks are Go tests (backend/odyle).
const model = () => import('../src/model.js');
test('zero is confirmed while unknown stays unknown', async () => {
  const { status } = await model();
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

test('class and level read as the official search lists them (#25)', async () => {
  const { classOf } = await model();
  assert.equal(classOf({ className: 'Chanter', level: 45 }), 'Chanter · Lv 45');
  assert.equal(classOf({ className: '', level: 12 }), 'Lv 12');
  assert.equal(classOf({ className: 'Templar', level: 0 }), 'Templar');
  for (const c of [{}, null, undefined, { level: 0 }]) assert.equal(classOf(c), '');
});
