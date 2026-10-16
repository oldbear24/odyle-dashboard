const { test } = require('node:test');
const assert = require('node:assert/strict');
// The Odyle clock (src/clock.js): ticks at fixed UTC hours, the caps a character may have
// from its fullest natural pool, and the line cards show.
const clock = () => import('../src/clock.js');
const at = text => Date.parse(text);
test('ticks come at the UTC hours and a character counts under the caps it fits', async () => {
  const { ticksAfter, capsOf, tickOf, defaultClock } = await clock();
  assert.deepEqual(ticksAfter(at('2026-10-14T22:30:00Z'), at('2026-10-15T05:00:00Z'), defaultClock.tickHours).map(ms => new Date(ms).toISOString()), ['2026-10-15T01:00:00.000Z', '2026-10-15T04:00:00.000Z']);
  // A tick at the reading's own hour has already happened.
  assert.deepEqual(ticksAfter(at('2026-10-15T04:00:00Z'), at('2026-10-15T07:00:00Z'), defaultClock.tickHours), [at('2026-10-15T07:00:00Z')]);
  assert.deepEqual(capsOf({}, defaultClock), [560, 840]);
  assert.deepEqual(capsOf({ naturalMax: 560 }, defaultClock), [560, 840]);
  assert.deepEqual(capsOf({ naturalMax: 600 }, defaultClock), [840]);
  assert.deepEqual(capsOf({ naturalMax: 2000 }, defaultClock), [840]);
  assert.equal(tickOf({ regenTick: 20 }, defaultClock), 20);
  assert.equal(tickOf({ regenTick: 0 }, defaultClock), 15);
});
test('the clock projects the natural pool from the last reading and says when it is full', async () => {
  const { clockOf, clockLine, defaultClock } = await clock(), { useLanguage } = await import('../src/i18n.js');
  await useLanguage('en');
  const c = { parts: { base: 500, bonus: 300 }, lastReadingAt: '2026-10-14 22:30:00.000Z', naturalMax: 600 }, now = at('2026-10-15T05:00:00Z');
  const iso = list => list.map(f => ({ ...f, at: new Date(f.at).toISOString() }));
  const projected = clockOf(c, now, defaultClock);
  assert.deepEqual({ ...projected, next: new Date(projected.next).toISOString(), fills: iso(projected.fills) },
    { base: 530, total: 830, cap: 840, tick: 15, next: '2026-10-15T07:00:00.000Z', fills: [{ cap: 840, at: '2026-10-17T19:00:00.000Z' }], full: false, settled: true, projected: true });
  assert.match(clockLine(projected, now, false), /^≈830 now if unspent · \+15 in 2h 0m · full ≈ [^/]+$/);
  // A character being read right now shows its own value, not an estimate.
  assert.match(clockLine(projected, now, true), /^\+15 in 2h 0m · full ≈ /);
  // Until its pool held more than 560 the cap is open: the estimate stops at 560 and both caps get a time.
  const open = clockOf({ ...c, naturalMax: 500 }, now, defaultClock);
  assert.deepEqual([open.cap, open.settled, iso(open.fills).map(f => [f.cap, f.at])], [560, false, [[560, '2026-10-15T10:00:00.000Z'], [840, '2026-10-17T19:00:00.000Z']]]);
  assert.match(clockLine(open, now, true), /^\+15 in 2h 0m · full ≈ .+ at 560 \/ .+ at 840$/);
  const reached = clockOf({ ...c, naturalMax: 500, lastReadingAt: '2026-10-13 00:30:00.000Z' }, now, defaultClock);
  assert.deepEqual([reached.base, reached.full], [560, true]);
  assert.match(clockLine(reached, now, true), /^natural pool at 560: full if its cap is 560 · full ≈ .+ at 840$/);
  const full = clockOf({ ...c, parts: { base: 840, bonus: 0 }, naturalMax: 840 }, now, defaultClock);
  assert.deepEqual([full.full, full.settled, full.total, full.projected], [true, true, 840, false]);
  assert.equal(clockLine(full, now, true), 'natural pool full · each tick of 15 is lost');
  // Without the game's two numbers, or while superusers pause it, there is no clock.
  assert.equal(clockOf({ ...c, parts: null }, now, defaultClock), null);
  assert.equal(clockOf(c, now, { ...defaultClock, paused: true }), null);
  assert.equal(clockLine(null, now, false), '');
  await useLanguage('cs');
  assert.equal(clockLine(full, now, true), 'přirozená zásoba plná · každých 15 propadá');
  assert.match(clockLine(reached, now, true), /^přirozená zásoba 560: plná, pokud je strop 560 · plno ≈ .+ při 840$/);
  await useLanguage('en');
});
