const { test } = require('node:test');
const assert = require('node:assert/strict');
// The timers page (src/timers.js): countdowns, the weekly maintenance, the natural pool's
// ticks and fill times, all from the game rules the server keeps.
const timers = () => import('../src/timers.js');
const at = text => Date.parse(text);
const game = { resets: { dailyResetHour: 7, weeklyResetDay: 'wednesday' }, clock: { tickHours: [1, 4, 7, 10, 13, 16, 19, 22], tick: 15, caps: [560, 840], paused: false }, maintenance: { day: 'wednesday', hour: 2, hours: 5 }, odylePerCube: 40, catalog: [{ name: '<b>Fire Temple</b>', cost: 80, partySize: 4, category: 'Dungeons', unconfirmed: true }, { name: 'Ruins', cost: 0, partySize: 0, category: '', unconfirmed: false }] };

test('countdowns read as clocks and the maintenance window holds or comes next', async () => {
  const { timerText, maintenanceWindow } = await timers(), { useLanguage } = await import('../src/i18n.js');
  await useLanguage('en');
  assert.deepEqual([0, -5000, 3661000, 59999, 90061000].map(timerText), ['00:00:00', '00:00:00', '01:01:01', '00:00:59', '1d 01:01:01']);
  const window = game.maintenance, iso = w => w && { from: new Date(w.from).toISOString(), to: new Date(w.to).toISOString(), now: w.now };
  // Wednesday before, during and after the window, and a Thursday.
  assert.deepEqual(iso(maintenanceWindow(at('2026-10-14T01:00:00Z'), window)), { from: '2026-10-14T02:00:00.000Z', to: '2026-10-14T07:00:00.000Z', now: false });
  assert.deepEqual(iso(maintenanceWindow(at('2026-10-14T03:00:00Z'), window)), { from: '2026-10-14T02:00:00.000Z', to: '2026-10-14T07:00:00.000Z', now: true });
  assert.deepEqual(iso(maintenanceWindow(at('2026-10-14T07:00:00Z'), window)), { from: '2026-10-21T02:00:00.000Z', to: '2026-10-21T07:00:00.000Z', now: false });
  assert.deepEqual(iso(maintenanceWindow(at('2026-10-15T12:00:00Z'), window)), { from: '2026-10-21T02:00:00.000Z', to: '2026-10-21T07:00:00.000Z', now: false });
  assert.equal(maintenanceWindow(at('2026-10-15T12:00:00Z'), null), null);
  assert.equal(maintenanceWindow(at('2026-10-15T12:00:00Z'), { day: '', hour: 0, hours: 0 }), null);
});

test('the natural pool fills tick by tick and a paused clock shows no regeneration', async () => {
  const { clockRules, fillsAt, perDay, capWord, timerTargets } = await timers();
  const rules = clockRules(game.clock);
  assert.equal(perDay(rules), 120);
  // 840 at 15 a tick is 56 ticks, seven days of eight; 560 is 38 ticks.
  assert.equal(new Date(fillsAt(at('2026-10-14T22:30:00Z'), 840, rules)).toISOString(), '2026-10-21T22:00:00.000Z');
  assert.equal(new Date(fillsAt(at('2026-10-14T22:30:00Z'), 560, rules)).toISOString(), '2026-10-19T16:00:00.000Z');
  assert.deepEqual([capWord(840, [560, 840]), capWord(560, [560, 840]), capWord(500, [500])], ['with the membership', 'without the membership', '']);
  assert.equal(clockRules({ ...game.clock, paused: true }), null);
  assert.deepEqual(clockRules({}), { tickHours: [1, 4, 7, 10, 13, 16, 19, 22], tick: 15, caps: [560, 840] });
  const targets = timerTargets(game, at('2026-10-14T03:00:00Z'));
  assert.deepEqual(Object.fromEntries(Object.entries(targets).map(([k, v]) => [k, new Date(v).toISOString()])), { daily: '2026-10-14T07:00:00.000Z', weekly: '2026-10-14T07:00:00.000Z', tick: '2026-10-14T04:00:00.000Z', maintenance: '2026-10-14T07:00:00.000Z' });
  assert.equal(timerTargets({ ...game, clock: { paused: true }, maintenance: null }, at('2026-10-14T03:00:00Z')).tick, null);
});

test('the page shows the countdowns, escapes dungeon names and leads players in', async () => {
  const { timersView } = await timers(), { useLanguage } = await import('../src/i18n.js');
  await useLanguage('en');
  const now = at('2026-10-14T03:00:00Z');
  const html = timersView({ game, now, signedIn: false });
  assert.match(html, /data-timer="\d+"/);
  assert.equal((html.match(/class="timer-card/g) || []).length, 4);
  assert.match(html, /Maintenance under way/);
  assert.match(html, /&lt;b&gt;Fire Temple&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>Fire Temple/);
  // 120 a day buys 1.5 cubes of 80 and 3 of 40; a pool of 840 holds 10 and 21.
  assert.match(html, /<td>1\.5<\/td><td>10<\/td>/);
  assert.match(html, /<td>3<\/td><td>21<\/td>/);
  assert.match(html, /data-action="discord"/);
  assert.match(html, /<ol class="tick-strip"><li class="is-next">/);
  const signedIn = timersView({ game, now, signedIn: true });
  assert.doesNotMatch(signedIn, /data-action="discord"/);
  const paused = timersView({ game: { ...game, clock: { ...game.clock, paused: true }, maintenance: null, catalog: [] }, now });
  assert.match(paused, /The Odyle clock is paused/);
  assert.equal((paused.match(/class="timer-card/g) || []).length, 2);
  assert.doesNotMatch(paused, /timers-table/);
  assert.match(timersView({ game: null, now, failed: true }), /could not be loaded/);
});
