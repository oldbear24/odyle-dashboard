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
test('a membership answer settles the cap, and readings that contradict it are flagged', async () => {
  const { capsOf, clockOf, clockLine, capMismatch, defaultClock } = await clock(), { useLanguage } = await import('../src/i18n.js');
  await useLanguage('en');
  // The answer wins over the readings, both ways.
  assert.deepEqual(capsOf({ answeredCap: 560 }, defaultClock), [560]);
  assert.deepEqual(capsOf({ answeredCap: 840, naturalMax: 300 }, defaultClock), [840]);
  assert.deepEqual(capsOf({ answeredCap: 0, naturalMax: 300 }, defaultClock), [560, 840]);
  const now = at('2026-10-15T05:00:00Z'), c = { parts: { base: 500, bonus: 0 }, lastReadingAt: '2026-10-15 04:30:00.000Z', naturalMax: 500 };
  // Without the membership the pool is full at 560, said without hedging.
  const without = clockOf({ ...c, answeredCap: 560 }, now, defaultClock);
  assert.deepEqual([without.cap, without.settled, without.fills.map(f => f.cap)], [560, true, [560]]);
  assert.doesNotMatch(clockLine(without, now, true), / at 560/);
  // With it, a pool that never passed 560 still counts up to 840.
  const member = clockOf({ ...c, answeredCap: 840 }, now, defaultClock);
  assert.deepEqual([member.cap, member.settled, member.fills.map(f => f.cap)], [840, true, [840]]);
  // A pool that held more than the answered cap contradicts "no membership"; the reading stays.
  assert.equal(capMismatch({ answeredCap: 560, naturalMax: 700 }), true);
  assert.equal(capMismatch({ answeredCap: 560, naturalMax: 560 }), false);
  assert.equal(capMismatch({ answeredCap: 0, naturalMax: 700 }), false);
  assert.equal(capMismatch({ answeredCap: 840, naturalMax: 300 }), false);
});
test('a card turns orange two days before the natural pool is full and red within the hour', async () => {
  const { clockOf, capLevel, defaultClock } = await clock();
  const now = at('2026-10-15T05:30:00Z'), c = { parts: { base: 500, bonus: 0 }, lastReadingAt: '2026-10-15 05:00:00.000Z', answeredCap: 560 };
  // 60 to go, four ticks: full at 13:00, seven and a half hours away.
  assert.equal(capLevel(clockOf(c, now, defaultClock), now), 'soon');
  // The next tick at 07:00 fills it: red from 06:00.
  const last = { ...c, parts: { base: 545, bonus: 0 } };
  assert.equal(capLevel(clockOf(last, now, defaultClock), now), 'soon');
  assert.equal(capLevel(clockOf(last, at('2026-10-15T06:00:00Z'), defaultClock), at('2026-10-15T06:00:00Z')), 'full');
  assert.equal(capLevel(clockOf({ ...c, parts: { base: 560, bonus: 0 } }, now, defaultClock), now), 'full');
  // 16 ticks to go fill it in 46½ hours, 17 in 49½.
  assert.equal(capLevel(clockOf({ ...c, parts: { base: 320, bonus: 0 } }, now, defaultClock), now), 'soon');
  assert.equal(capLevel(clockOf({ ...c, parts: { base: 305, bonus: 0 } }, now, defaultClock), now), '');
  // With the membership the same pool is far from its cap.
  assert.equal(capLevel(clockOf({ ...c, answeredCap: 840 }, now, defaultClock), now), '');
  // While the cap is open it goes by the smallest one.
  assert.equal(capLevel(clockOf({ ...c, answeredCap: 0, parts: { base: 560, bonus: 0 } }, now, defaultClock), now), 'full');
  assert.equal(capLevel(null, now), '');
});
