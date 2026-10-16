const { test } = require('node:test');
const assert = require('node:assert/strict');
// The browser module decides when a checked task resets; the server only stores doneAt
// (its check of task titles and cadences is a Go test, backend/odyle).
const tasks = () => import('../src/tasks.js');
const at = iso => Date.parse(iso);
test('daily and weekly periods follow the Global reset hour and weekday', async () => {
  const { periodStart, nextReset } = await tasks();
  // Tuesday 2026-10-13: before 07:00 UTC the day still belongs to Monday's reset.
  assert.equal(periodStart('daily', at('2026-10-13T06:59:59Z')), at('2026-10-12T07:00:00Z'));
  assert.equal(periodStart('daily', at('2026-10-13T07:00:00Z')), at('2026-10-13T07:00:00Z'));
  assert.equal(nextReset('daily', at('2026-10-13T12:00:00Z')), at('2026-10-14T07:00:00Z'));
  // Weekly reset on Wednesday 07:00 UTC: Wednesday 06:59 still counts to last week.
  assert.equal(periodStart('weekly', at('2026-10-14T06:59:59Z')), at('2026-10-07T07:00:00Z'));
  assert.equal(periodStart('weekly', at('2026-10-14T07:00:00Z')), at('2026-10-14T07:00:00Z'));
  assert.equal(periodStart('weekly', at('2026-10-20T23:00:00Z')), at('2026-10-14T07:00:00Z'));
  assert.equal(nextReset('weekly', at('2026-10-20T23:00:00Z')), at('2026-10-21T07:00:00Z'));
  // Server settings move both: midnight UTC with a Monday weekly reset.
  const resets = { dailyResetHour: 0, weeklyResetDay: 'monday' };
  assert.equal(periodStart('daily', at('2026-10-13T23:30:00Z'), resets), at('2026-10-13T00:00:00Z'));
  assert.equal(nextReset('daily', at('2026-10-13T23:30:00Z'), resets), at('2026-10-14T00:00:00Z'));
  assert.equal(periodStart('weekly', at('2026-10-18T23:30:00Z'), resets), at('2026-10-12T00:00:00Z'));
  // Unknown settings fall back to the Global defaults.
  assert.equal(periodStart('weekly', at('2026-10-14T07:00:00Z'), { dailyResetHour: 'x', weeklyResetDay: 'someday' }), at('2026-10-14T07:00:00Z'));
  assert.equal(periodStart('daily', at('2026-10-14T06:00:00Z'), {}), at('2026-10-13T07:00:00Z'));
});
test('a task stays done until the reset after it was checked', async () => {
  const { isDone, remaining, dayName, resetHour } = await tasks();
  const checked = { cadence: 'daily', doneAt: '2026-10-13 10:00:00.000Z' };
  assert.equal(isDone(checked, at('2026-10-14T06:59:00Z')), true);
  assert.equal(isDone(checked, at('2026-10-14T07:00:00Z')), false);
  assert.equal(isDone({ ...checked, cadence: 'weekly' }, at('2026-10-14T06:59:00Z')), true);
  assert.equal(isDone({ ...checked, cadence: 'weekly' }, at('2026-10-14T07:00:00Z')), false);
  assert.equal(isDone({ ...checked, cadence: 'weekly', doneAt: '2026-10-14 07:00:00.000Z' }, at('2026-10-20T23:00:00Z')), true);
  assert.equal(isDone({ cadence: 'daily', doneAt: '' }, at('2026-10-13T10:00:00Z')), false);
  assert.equal(remaining(30000), 'under a minute'); assert.equal(remaining(4 * 60000), '4m');
  assert.equal(remaining(5 * 3600000 + 12 * 60000), '5h 12m'); assert.equal(remaining(2 * 86400000 + 3 * 3600000), '2d 3h');
  assert.equal(dayName(), 'Wednesday'); assert.equal(dayName({ weeklyResetDay: 'monday' }), 'Monday'); assert.equal(dayName({ weeklyResetDay: 'funday' }), 'Wednesday');
  assert.equal(resetHour({ dailyResetHour: 0 }), 0); assert.equal(resetHour({ dailyResetHour: 24 }), 7); assert.equal(resetHour(undefined), 7);
});

test('each character keeps its own lists and the Global list adds what a list lacks (#38)', async () => {
  const { scopes, inScope, left, templatesForm } = await tasks();
  const now = at('2026-10-13T12:00:00Z');
  const list = [
    { id: 'a', title: 'Daily dungeon', cadence: 'daily', character: '', doneAt: '' },
    { id: 'b', title: 'Daily dungeon', cadence: 'daily', character: 'alt', doneAt: '2026-10-13 08:00:00.000Z' },
    { id: 'c', title: 'Nightmare', cadence: 'weekly', character: 'alt', doneAt: '' },
    { id: 'd', title: 'Older task', cadence: 'weekly', doneAt: '' },
  ];
  assert.deepEqual(scopes([{ id: 'alt', characterName: 'Alt', server: 'Lumiel' }]), [{ id: '', name: 'Account' }, { id: 'alt', name: 'Alt', server: 'Lumiel' }]);
  assert.deepEqual(list.filter(task => inScope(task, '')).map(task => task.id), ['a', 'd']);
  assert.deepEqual([left(list, now, undefined, ''), left(list, now, undefined, 'alt'), left(list, now)], [2, 1, 3]);
  const form = templatesForm([{ title: 'Nightmare', cadence: 'weekly' }, { title: 'Daily <dungeon>', cadence: 'daily' }, { title: 'daily dungeon', cadence: 'daily' }], list, 'alt');
  assert.match(form, /value="Nightmare" checked disabled/);
  assert.match(form, /value="daily dungeon" checked disabled/);
  assert.match(form, /value="Daily &lt;dungeon&gt;" >/);
  assert.ok(form.indexOf('Daily <') < 0 && form.indexOf('<legend>Daily</legend>') < form.indexOf('<legend>Weekly</legend>'));
});
