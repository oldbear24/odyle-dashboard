import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  historyPoints,
  changeOver,
  powerChange,
  niceRange,
  chartGeometry,
  progressPanel,
  dayName,
} from '../../src/armoryhistory.js';
import { armoryProfile } from '../../src/armory.js';
import { useLanguage } from '../../src/i18n.js';
// How a character progressed (src/armoryhistory.js): the days the armory route sends
// (backend/odyle/armoryhistory.go), the oldest first.
const day = (n, combatPower, itemLevel = 1500) => ({
  day: new Date(Date.UTC(2026, 9, 1) + n * 86400000).toISOString().slice(0, 10),
  combatPower,
  itemLevel,
  level: 45,
});
// Six weeks, from 1 Oct 2026, one day in two.
const weeks = Array.from({ length: 22 }, (_, i) => day(i * 2, 100000 + i * 1000, 1500 + i * 4));

test('history points are the valid days, the oldest first', () => {
  const points = historyPoints([day(3, 120), { day: 'x', combatPower: 1 }, day(1, 100), null, day(2, 0)]);
  assert.deepEqual(
    points.map(p => [p.day, p.combatPower]),
    [
      ['2026-10-02', 100],
      ['2026-10-04', 120],
    ],
  );
  assert.deepEqual(historyPoints(undefined), []);
});

test('a change counts from the last day at least that long before, or from the first day', () => {
  const points = historyPoints(weeks);
  // The last day is 12 Nov; 30 days before it is 13 Oct, a day kept.
  const thirty = changeOver(points, 'combatPower', 30);
  assert.equal(thirty.since, '2026-10-13');
  assert.equal(thirty.full, true);
  assert.equal(thirty.from, 106000);
  assert.equal(thirty.to, 121000);
  assert.equal(thirty.delta, 15000);
  assert.ok(Math.abs(thirty.percent - (15000 / 106000) * 100) < 1e-9);
  // A shorter history counts from its first day.
  const short = changeOver(historyPoints(weeks.slice(0, 5)), 'combatPower', 30);
  assert.equal(short.full, false);
  assert.equal(short.since, '2026-10-01');
  assert.equal(short.delta, 4000);
  assert.equal(changeOver(historyPoints([day(0, 1)]), 'combatPower', 30), null);
});

test("the hero's line says the change in 30 days, or since the first day", async () => {
  await useLanguage('en');
  assert.equal(powerChange(weeks), '+14.2 % in 30 days');
  assert.equal(powerChange(weeks.slice(0, 5)), `+4.0 % since ${dayName('2026-10-01')}`);
  assert.equal(powerChange([day(0, 100), day(1, 90)]), `−10.0 % since ${dayName('2026-10-01')}`);
  assert.equal(powerChange([day(0, 100)]), '');
  assert.equal(powerChange(undefined), '');
  await useLanguage('cs');
  assert.equal(powerChange(weeks), '+14,2 % za 30 dní');
  assert.equal(powerChange(weeks.slice(0, 5)), '+4,0 % od 1. 10.');
  await useLanguage('en');
});

test('axes round out to clean steps and never go below zero', () => {
  assert.deepEqual(niceRange(100000, 121000), { low: 100000, high: 130000, ticks: [130000, 120000, 110000, 100000] });
  assert.deepEqual(niceRange(1588, 1671), { low: 1575, high: 1675, ticks: [1675, 1650, 1625, 1600, 1575] });
  assert.deepEqual(niceRange(1500, 1584), { low: 1500, high: 1600, ticks: [1600, 1550, 1500] });
  // A flat line gets room around it.
  const flat = niceRange(1500, 1500);
  assert.ok(flat.low < 1500 && flat.high > 1500);
  assert.equal(niceRange(1, 30).low, 0);
  for (const [min, max] of [
    [3, 97],
    [12345, 98765],
    [240000, 241000],
  ]) {
    const r = niceRange(min, max);
    assert.ok(r.low <= min && r.high >= max, `${min}–${max}: ${r.low}–${r.high}`);
  }
});

test('the geometry puts the days on one time axis and each measure on its own', () => {
  const g = chartGeometry(historyPoints(weeks));
  assert.equal(g.days[0].x, 0);
  assert.equal(g.days.at(-1).x, 100);
  assert.equal(g.days[0].power, 100);
  assert.ok(g.days.at(-1).power > 0 && g.days.at(-1).power < 100);
  assert.ok(g.days.every(d => d.item >= 0 && d.item <= 100));
});

test('the Progress panel shows tiles, two charts with a summary and the table of days', async () => {
  await useLanguage('en');
  const html = progressPanel(weeks);
  assert.match(html, /<h2 id="armory-growth-title">Progress<\/h2>/);
  const oct1 = dayName('2026-10-01'),
    nov12 = dayName('2026-11-12');
  assert.ok(html.includes(`22 days kept since ${oct1}`));
  assert.match(
    html,
    /Combat power, last 30 days<\/span><strong class="is-up">\+15,000 CP<\/strong><small>\+14\.2 %<\/small>/,
  );
  assert.ok(
    html.includes(`Item level since ${oct1}</span><strong class="is-up">+84</strong><small>1,500 → 1,584</small>`),
  );
  assert.ok(html.includes(`Highest combat power</span><strong>121,000</strong><small>on ${nov12}</small>`));
  assert.ok(
    html.includes(
      `role="group" aria-label="Combat power from 100,000 on ${oct1} to 121,000 on ${nov12}; item level from 1,500 to 1,584.`,
    ),
  );
  assert.doesNotMatch(html, /NaN/);
  assert.equal((html.match(/class="growth-plot /g) || []).length, 2);
  assert.equal((html.match(/<tr><th scope="row">/g) || []).length, 22);
  // The newest day leads the table.
  assert.ok(html.includes(`<tbody><tr><th scope="row">${nov12}</th><td>121,000</td>`));
  // No numbers on every point: one end dot a chart.
  assert.equal((html.match(/class="growth-dot"/g) || []).length, 2);
});

test('with fewer than two days the panel says the history starts now', async () => {
  await useLanguage('en');
  for (const history of [[], [day(0, 100000)], undefined]) {
    const html = progressPanel(history);
    assert.match(html, /The history of this character starts with this reading\./);
    assert.doesNotMatch(html, /growth-chart/);
  }
});

test("the profile's Gear & stats tab leads with the panel, and the hero shows the change", async () => {
  await useLanguage('en');
  const answer = {
    region: 'eu',
    serverId: 2304,
    characterId: 'abc',
    server: 'Fregion',
    state: 'fresh',
    fetchedAt: '2026-11-12T10:00:00.000Z',
    profile: { name: 'Hero', level: 45, class: 'Chanter', combatPower: 121000, itemLevel: 1584, gear: [], stats: [] },
    history: weeks,
  };
  const html = armoryProfile(answer, Date.parse('2026-11-12T12:00:00Z'), false);
  assert.match(html, /<dd class="armory-power-change">\+14\.2 % in 30 days<\/dd>/);
  assert.ok(html.indexOf('armory-growth') < html.indexOf('armory-loadout'));
  // Not on the other tabs; no change line without history.
  const skills = armoryProfile(
    {
      ...answer,
      profile: { ...answer.profile, skills: [{ name: 'Bolt', category: 'Active', level: 1, acquired: true }] },
    },
    Date.parse('2026-11-12T12:00:00Z'),
    false,
    false,
    { tab: 'skills' },
  );
  assert.doesNotMatch(skills, /armory-growth/);
  assert.doesNotMatch(armoryProfile({ ...answer, history: undefined }, Date.now(), false), /armory-power-change/);
});

test('days name the year only when it is not the last day’s', async () => {
  await useLanguage('en');
  assert.doesNotMatch(dayName('2026-11-03'), /2026/);
  assert.match(dayName('2025-12-30', '2026-01-02'), /2025/);
  await useLanguage('cs');
  assert.equal(dayName('2026-11-03'), '3. 11.');
  await useLanguage('en');
});
