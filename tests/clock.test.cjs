const { test } = require('node:test');
const assert = require('node:assert/strict');
// The Odyle clock (src/clock.js): ticks at fixed UTC hours, a cap from the fullest natural
// pool, and the line cards show.
const clock = () => import('../src/clock.js');
const at = text => Date.parse(text);
test('ticks come at the UTC hours and a character counts under the cap it fits', async () => {
  const { ticksAfter, capOf, tickOf, defaultClock } = await clock();
  assert.deepEqual(ticksAfter(at('2026-10-14T22:30:00Z'), at('2026-10-15T05:00:00Z'), defaultClock.tickHours).map(ms => new Date(ms).toISOString()), ['2026-10-15T01:00:00.000Z', '2026-10-15T04:00:00.000Z']);
  // A tick at the reading's own hour has already happened.
  assert.deepEqual(ticksAfter(at('2026-10-15T04:00:00Z'), at('2026-10-15T07:00:00Z'), defaultClock.tickHours), [at('2026-10-15T07:00:00Z')]);
  assert.equal(capOf({}, defaultClock), 560);
  assert.equal(capOf({ naturalMax: 560 }, defaultClock), 560);
  assert.equal(capOf({ naturalMax: 600 }, defaultClock), 840);
  assert.equal(capOf({ naturalMax: 2000 }, defaultClock), 840);
  assert.equal(tickOf({ regenTick: 20 }, defaultClock), 20);
  assert.equal(tickOf({ regenTick: 0 }, defaultClock), 15);
});
test('the clock projects the natural pool from the last reading and says when it is full', async () => {
  const { clockOf, clockLine, defaultClock } = await clock(), { useLanguage } = await import('../src/i18n.js');
  await useLanguage('en');
  const c = { parts: { base: 500, bonus: 300 }, lastReadingAt: '2026-10-14 22:30:00.000Z', naturalMax: 500 }, now = at('2026-10-15T05:00:00Z');
  const projected = clockOf(c, now, defaultClock);
  assert.deepEqual({ ...projected, next: new Date(projected.next).toISOString(), fullAt: new Date(projected.fullAt).toISOString() },
    { base: 530, total: 830, cap: 560, tick: 15, next: '2026-10-15T07:00:00.000Z', fullAt: '2026-10-15T10:00:00.000Z', full: false, projected: true });
  assert.match(clockLine(projected, now, false), /^≈830 now if unspent · \+15 in 2h 0m · full ≈ /);
  // A character being read right now shows its own value, not an estimate.
  assert.match(clockLine(projected, now, true), /^\+15 in 2h 0m · full ≈ /);
  const full = clockOf({ ...c, parts: { base: 560, bonus: 0 } }, now, defaultClock);
  assert.equal(full.full, true); assert.equal(full.total, 560); assert.equal(full.projected, false);
  assert.equal(clockLine(full, now, true), 'natural pool full · each tick of 15 is lost');
  // Without the game's two numbers, or while superusers pause it, there is no clock.
  assert.equal(clockOf({ ...c, parts: null }, now, defaultClock), null);
  assert.equal(clockOf(c, now, { ...defaultClock, paused: true }), null);
  assert.equal(clockLine(null, now, false), '');
  await useLanguage('cs');
  assert.equal(clockLine(full, now, true), 'přirozená zásoba plná · každých 15 propadá');
  await useLanguage('en');
});
