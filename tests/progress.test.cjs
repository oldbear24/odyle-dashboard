const { test } = require('node:test');
const assert = require('node:assert/strict');
// Achievements (src/achievements.js) and your week in Odyle (src/week.js): what the pages show
// of the account's own progress, and what its week to share says.
const at = text => Date.parse(text);
// Days are named in the reader's own zone by the middle of the game's daily period.
const local = (text, options) => new Date(at(text) + 43200000).toLocaleDateString('en-GB', options);
const dates = `${local('2026-10-28T07:00:00Z', { day: 'numeric', month: 'short' })} – ${local('2026-11-03T07:00:00Z', { day: 'numeric', month: 'short', year: 'numeric' })}`;
const clock = { tickHours: [1, 4, 7, 10, 13, 16, 19, 22], tick: 15, caps: [560, 840], paused: false };
const point = (when, value, kind = '', delta = null, base = null) => ({ at: when.replace('T', ' ').replace('Z', '.000Z'), value, kind, delta, parts: base === null ? null : { base, bonus: value - base } });
const week = {
  week: { from: '2026-10-28 07:00:00.000Z', until: '2026-11-04 07:00:00.000Z', back: 0, weeks: 3, complete: false, previousKept: true },
  resets: { dailyResetHour: 7, weeklyResetDay: 'wednesday' }, clock, odylePerCube: 40,
  achievements: [{ id: 'first-cube', at: '2026-10-30 12:00:00.000Z' }],
  characters: [{ id: 'c1', characterName: '<i>Kaelen</i>', server: 'Lumiel', className: 'Templar', level: 45, main: true, answeredCap: 840, regenTick: 15, readings: [
    point('2026-10-20T10:00:00Z', 500, 'snapshot', null, 300),
    point('2026-10-27T10:00:00Z', 420, 'spend', -80, 220),
    point('2026-10-28T08:00:00Z', 600, 'snapshot', null, 400),
    point('2026-10-29T10:00:00Z', 615, 'regen', 15, 415),
    point('2026-10-30T12:00:00Z', 535, 'spend', -80, 335),
    point('2026-10-30T13:00:00Z', 495, 'spend', -40, 295),
    point('2026-11-01T09:00:00Z', 535, 'item', 40, 295),
  ] }],
};

test('the week sums up its own characters beside the week before', async () => {
  const { weekSummary, weekText, weekDates } = await import('../src/week.js'), { useLanguage } = await import('../src/i18n.js');
  await useLanguage('en');
  const s = weekSummary(week, at('2026-11-02T12:00:00Z'));
  assert.deepEqual([s.total.spent, s.total.cubes, s.total.regen, s.total.items, s.total.capped, s.total.lost], [120, 3, 15, 40, true, 0]);
  assert.deepEqual([s.previous.spent, s.previous.cubes], [80, 2]);
  // The 28th, 29th, 30th and 1st; the 30th spent the most.
  assert.equal(s.days, 4);
  assert.deepEqual(s.best, { day: at('2026-10-30T07:00:00Z'), spent: 120, cubes: 3 });
  assert.equal(weekDates(s.from, s.until), dates);
  const text = weekText(s, 'https://odyle.example/');
  assert.ok(text.startsWith(`**My week in Odyle** (${dates})\n`), text);
  assert.match(text, /3 cubes opened · 120 Odyle spent/);
  assert.match(text, /\+15 Odyle regenerated · 💧 no tick lost at the cap/);
  assert.match(text, /4 days with the reader · 🏆 1 achievement/);
  assert.match(text, /\nOdyle for your whole party: https:\/\/odyle\.example\/$/);
  // Without the week before kept there is nothing to compare with.
  assert.equal(weekSummary({ ...week, week: { ...week.week, previousKept: false } }, at('2026-11-02T12:00:00Z')).previous, null);
});

test('the week page shows its numbers, escapes names and offers to share', async () => {
  const { weekView } = await import('../src/week.js'), { useLanguage } = await import('../src/i18n.js');
  await useLanguage('en');
  const html = weekView({ data: week, now: at('2026-11-02T12:00:00Z'), canShare: true });
  assert.ok(html.includes(`<h1>${dates}<span class="mint">`));
  assert.match(html, /≈3<\/strong><small>\+1 vs the week before/);
  assert.match(html, /&lt;i&gt;Kaelen&lt;\/i&gt;/);
  assert.doesNotMatch(html, /<i>Kaelen/);
  assert.match(html, /data-action="week-share"/);
  assert.match(html, /data-week-back="1"/);
  assert.match(html, /data-week-back="-1" disabled/);
  assert.ok(html.includes(`Biggest day: ${local('2026-10-30T07:00:00Z', { weekday: 'long' })}, 120 Odyle spent`));
  assert.match(html, /First cube/);
  assert.doesNotMatch(weekView({ data: week, now: at('2026-11-02T12:00:00Z'), canShare: false }), /data-action="week-share"/);
  assert.match(weekView({ data: { ...week, characters: [] }, now: at('2026-11-02T12:00:00Z') }), /No readings in this week/);
  assert.match(weekView({ data: null, now: 0, failed: true }), /could not be loaded/);
});

const catalog = [
  { id: 'first-cube', group: 'odyle', counter: 'spends', goal: 1, spins: 1 },
  { id: 'cube-hunter', group: 'odyle', counter: 'spent', goal: 1000, spins: 2, reward: 'badge-crate' },
  { id: 'lucky-find', group: 'secret', counter: 'slots', goal: 1, reward: 'badge-key', secret: true },
  { id: 'jackpot', group: 'secret', counter: 'legendary', goal: 1, reward: 'badge-jackpot', secret: true },
];
const items = [{ id: 'badge-crate', kind: 'badge', rarity: 'rare', name: 'Cube crate', value: '📦' }, { id: 'badge-key', kind: 'badge', rarity: 'rare', name: 'Secret key', value: '🗝️' }, { id: 'badge-jackpot', kind: 'badge', rarity: 'legendary', name: 'Jackpot', value: '🎰' }];

test('achievements show progress, hide secrets until reached and offer to wear what they gave', async () => {
  const { achievementsView, standing, reachedText } = await import('../src/achievements.js'), { useLanguage } = await import('../src/i18n.js');
  await useLanguage('en');
  const data = { catalog, items, counts: { spends: 3, spent: 720, slots: 1 }, unlocked: { 'first-cube': '2026-10-30 12:00:00.000Z', 'lucky-find': '2026-11-02 10:00:00.000Z' }, seen: '2026-11-01 00:00:00.000Z', owned: ['badge-key'], equipped: { badge: 'badge-key' }, found: true, noWasteDays: 5 };
  assert.deepEqual(standing(data), { reached: 2, total: 4, spins: 1, items: 1, rewards: 3 });
  const html = achievementsView({ data, signedIn: true });
  assert.match(html, /720 of 1,000/);
  assert.match(html, /aria-valuenow="720"/);
  // The key was reached after the last look: new, worn, and its secret told.
  assert.match(html, /<span class="ach-new">New<\/span><span class="ach-sign" aria-hidden="true">🗝️/);
  assert.match(html, /data-wear-item="" data-kind="badge">Take off/);
  // The jackpot stays a secret, its item too.
  assert.equal((html.match(/Secret achievement/g) || []).length, 1);
  assert.doesNotMatch(html, /🎰/);
  assert.match(html, /href="#\/slots"/);
  const out = achievementsView({ data: { catalog, items, noWasteDays: 5 }, signedIn: false });
  assert.match(out, /data-action="discord"/);
  assert.match(out, /4 achievements to reach/);
  assert.doesNotMatch(out, /data-wear-item/);
  assert.equal(reachedText([{ id: 'first-cube', spins: 1 }, { id: 'cube-hunter', spins: 2, reward: 'badge-crate' }]), 'Achievements reached: First cube, Cube hunter · +3 spins · +1 item for your name');
  assert.equal(reachedText([{ id: 'jackpot', spins: 0, reward: 'badge-jackpot' }]), 'Achievement reached: Jackpot · +1 item for your name');
});
