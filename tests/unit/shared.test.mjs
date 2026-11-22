import { test } from 'node:test';
import assert from 'node:assert/strict';
import { number, escape } from '../../src/model.js';
import { periodChoices, periodSwitch } from '../../src/pager.js';
import { templatesForm } from '../../src/tasks.js';

test("number() shows counts in the reader's language and anything else as 0", () => {
  assert.equal(number(1234), (1234).toLocaleString('en-GB'));
  assert.equal(number('56'), '56');
  for (const value of [undefined, null, '', 'x', NaN]) assert.equal(number(value), '0');
});

test('the period switch of the history and PvP dialogs', () => {
  assert.deepEqual(periodChoices([7, 30], 90), [7, 30, 90]);
  assert.deepEqual(periodChoices([7, 30], 30), [7, 30]);
  assert.deepEqual(periodChoices([7, 30], 3), [3]);
  assert.equal(periodSwitch([3], 3, 'data-x', String), '');
  const html = periodSwitch([7, 30], 30, 'data-x', d => `${d} d`);
  assert.match(html, /data-x="7" aria-pressed="false">7 d</);
  assert.match(html, /data-x="30" aria-pressed="true">30 d</);
});

test('the Global list escapes task names with the shared escape', () => {
  const html = templatesForm([{ title: '<b>"Fish" & chips\'</b>', cadence: 'daily' }], [], '');
  assert.ok(html.includes(escape('<b>"Fish" & chips\'</b>')));
  assert.ok(!html.includes('<b>"Fish"'));
});
