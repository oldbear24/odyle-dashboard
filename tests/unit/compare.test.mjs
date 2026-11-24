import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareSummary,
  compareItemFacts,
  compareSlot,
  compareGear,
  compareStats,
  compareBoards,
  compareSkills,
  compareSets,
  comparePage,
  comparePicker,
  comparePickerTop,
  comparePickerResults,
  compareServerOptions,
} from '../../src/compare.js';
import { armoryRoute, armoryTarget, comparePath, compareTitle, profilePath } from '../../src/armorylinks.js';
import { pageOf } from '../../src/routes.js';
import { useLanguage } from '../../src/i18n.js';
// Two characters side by side: src/compare.js.

const now = Date.parse('2026-11-23T12:00:00Z');
const images = '/api/odyle/armory-images/';
const set = equipped => ({
  name: 'Primal Vigor',
  equipped,
  items: [
    { name: 'Chalice of Vigor', grade: 'Unique', equipped: true },
    { name: 'Bell of Vigor', grade: 'Unique', equipped: equipped > 1 },
    { name: 'Horn of Vigor', grade: 'Unique', equipped: false },
  ],
  bonuses: [{ count: 2, effects: ['+60 PvE Attack'] }],
});
const detail = extra => ({
  category: 'Mace',
  itemLevel: 102,
  main: [],
  sub: [{ name: 'Combat Speed', value: '13%' }],
  subSkills: [{ name: 'Bolt', level: 2, icon: '' }],
  stoneSlots: 3,
  stones: [{ name: 'Attack', value: '+10', grade: 'Unique', icon: '' }],
  godSlots: 1,
  godStones: [],
  sources: [],
  skins: [],
  ...extra,
});
const left = {
  name: 'Ka<b>',
  level: 45,
  class: 'Chanter',
  race: 'Asmodians',
  server: 'Lumiel',
  combatPower: 126000,
  itemLevel: 1700,
  stats: [
    { type: 'STR', name: 'Might', value: 45, primary: true },
    { type: 'Justice', name: 'Justice', deity: 'Nezekan', value: 41, primary: false },
  ],
  gear: [
    { slot: 'MainHand', name: 'Kromede Rod', grade: 'Unique', enchant: 15, exceed: 3, detail: detail() },
    { slot: 'Helmet', name: 'Vakron Helm', grade: 'Legend', enchant: 5, exceed: 0 },
    {
      slot: 'Arcana1',
      name: 'Chalice of Vigor',
      grade: 'Unique',
      enchant: 0,
      exceed: 0,
      detail: detail({ set: set(2) }),
    },
    { slot: 'Pet', name: 'Pagati', grade: '', enchant: 0, exceed: 0, level: 3 },
  ],
  skills: [
    { name: 'Bolt', category: 'Active', level: 13, acquired: true, equipped: true, icon: '' },
    { name: 'Heal', category: 'Active', level: 4, acquired: true, equipped: true, icon: '' },
    { name: 'Rend', category: 'Active', level: 0, acquired: false, equipped: false, icon: '' },
  ],
  titles: { owned: 94, total: 304, equipped: [] },
  boards: [
    { id: 71, name: 'Nezekan', open: 12, total: 40 },
    { id: 72, name: 'Zikel', open: 3, total: 40 },
  ],
};
const right = {
  name: 'Mira',
  level: 45,
  class: 'Chanter',
  race: 'Elyos',
  server: 'Siel',
  combatPower: 204000,
  itemLevel: 1650,
  stats: [
    { type: 'STR', name: 'Might', value: 52, primary: true },
    { type: 'WIS', name: 'Willpower', value: 8, primary: true },
  ],
  gear: [
    {
      slot: 'MainHand',
      name: 'Kromede Rod',
      grade: 'Unique',
      enchant: 12,
      exceed: 3,
      detail: detail({ itemLevel: 110, stones: [], godStones: [{ name: 'Fury', grade: 'Epic' }] }),
    },
    { slot: 'Helmet', name: 'Dragon Helm', grade: 'Epic', enchant: 5, exceed: 1 },
    { slot: 'Necklace', name: 'Necklace of Wind', grade: 'Unique', enchant: 2, exceed: 0 },
    {
      slot: 'Arcana1',
      name: 'Chalice of Vigor',
      grade: 'Unique',
      enchant: 0,
      exceed: 0,
      detail: detail({ set: set(1) }),
    },
    { slot: 'Pet', name: 'Pagati', grade: '', enchant: 0, exceed: 0, level: 5 },
  ],
  skills: [
    { name: 'Bolt', category: 'Active', level: 16, acquired: true, equipped: true, icon: '' },
    { name: 'Shield', category: 'Active', level: 8, acquired: true, equipped: true, icon: '' },
  ],
  titles: { owned: 120, total: 304, equipped: [] },
  boards: [{ id: 71, name: 'Nezekan', open: 20, total: 40 }],
};
const at = (characterId, region = 'eu', serverId = 2304) => ({ region, serverId, characterId });
const leftAt = at('kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4='),
  rightAt = at('QXJtb3JlcklkMDAwMDAwMDAwMDAwMDAwMDAwMDA=', 'nae', 1101);
const answer = (target, profile, extra = {}) => ({
  ...target,
  server: profile?.server || 'Lumiel',
  profile,
  classIcon: '',
  fetchedAt: new Date(now - 3600000).toISOString(),
  state: 'fresh',
  retryAfter: 0,
  ...extra,
});

test('a comparison has a path of its own, shareable and named after both characters', () => {
  const path = comparePath(leftAt, rightAt);
  assert.equal(
    path,
    '/armory/eu/2304/kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=/compare/nae/1101/QXJtb3JlcklkMDAwMDAwMDAwMDAwMDAwMDAwMDA=',
  );
  assert.ok(armoryRoute.test(path));
  assert.equal(pageOf(path), path);
  assert.deepEqual(armoryTarget(path), {
    compare: [
      { region: 'eu', serverId: '2304', characterId: leftAt.characterId },
      { region: 'nae', serverId: '1101', characterId: rightAt.characterId },
    ],
  });
  assert.ok(path.startsWith(profilePath(leftAt) + '/compare/'));
  for (const bad of [
    profilePath(leftAt) + '/compare',
    profilePath(leftAt) + '/compare/xx/1101/' + rightAt.characterId,
    profilePath(leftAt) + '/compare/nae/3101/' + rightAt.characterId,
    path + '/skills',
    profilePath(leftAt) + '/card/compare/nae/1101/' + rightAt.characterId,
  ])
    assert.ok(!armoryRoute.test(bad), bad);
  assert.equal(compareTitle(answer(leftAt, left), answer(rightAt, right)), 'Ka<b> vs Mira · Odyle Armory');
  assert.equal(
    compareTitle(answer(leftAt, left), answer(rightAt, null, { server: 'Siel' })),
    'Ka<b> vs a character on Siel · Odyle Armory',
  );
});

test('the overview says who is ahead by combat power, item level, nodes, titles and skills', () => {
  assert.deepEqual(compareSummary(left, right), [
    { key: 'combatPower', a: 126000, b: 204000, better: 'b' },
    { key: 'itemLevel', a: 1700, b: 1650, better: 'a' },
    { key: 'nodes', a: 15, b: 20, better: 'b' },
    { key: 'titles', a: 94, b: 120, better: 'b' },
    { key: 'skills', a: 2, b: 2, better: '' },
  ]);
});

test('each slot says what differs: item, item level, enchantment, exceed, stones and level', () => {
  const facts = compareItemFacts(left.gear[0]);
  assert.deepEqual(facts, {
    name: 'Kromede Rod',
    grade: 'Unique',
    enchant: 15,
    exceed: 3,
    level: 0,
    itemLevel: 102,
    stones: 1,
    stoneSlots: 4,
    sub: ['Combat Speed 13%', 'Bolt +2'],
    set: '',
  });
  // An item without its page from PLAYNC has no item level or stones to compare.
  assert.equal(compareItemFacts(left.gear[1]).itemLevel, null);
  assert.equal(compareItemFacts(null), null);
  const weapon = compareSlot('MainHand', left.gear[0], right.gear[0]);
  assert.equal(weapon.same, true);
  assert.equal(weapon.only, '');
  assert.deepEqual(weapon.better, { itemLevel: 'b', enchant: 'a', exceed: '', stones: '', level: '' });
  const helmet = compareSlot('Helmet', left.gear[1], right.gear[1]);
  assert.equal(helmet.same, false);
  assert.deepEqual(helmet.better, { itemLevel: '', enchant: '', exceed: 'b', stones: '', level: '' });
  const necklace = compareSlot('Necklace', undefined, right.gear[2]);
  assert.equal(necklace.only, 'b');
  assert.equal(necklace.a, null);
  assert.deepEqual(Object.values(necklace.better), ['', '', '', '', '']);
  assert.equal(compareSlot('Pet', left.gear[3], right.gear[4]).better.level, 'b');
});

test("gear follows the paper doll's groups and order, leaving out slots both leave empty", () => {
  const groups = compareGear(left, right);
  assert.deepEqual(
    groups.map(g => [g.group, g.rows.map(r => r.slot)]),
    [
      ['armour', ['MainHand', 'Helmet']],
      ['accessories', ['Necklace']],
      ['arcana', ['Arcana1']],
      ['companions', ['Pet']],
    ],
  );
  // A slot PLAYNC adds later goes with the accessories.
  const later = compareGear({ gear: [{ slot: 'Brooch', name: 'Pin', grade: 'Rare' }] }, { gear: [] });
  assert.deepEqual(
    later.map(g => [g.group, g.rows.map(r => r.slot)]),
    [['accessories', ['Brooch']]],
  );
});

test('stats, boards, skill bars and sets line up by name, with the side ahead', () => {
  assert.deepEqual(compareStats(left, right), {
    primary: [
      { name: 'Might', deity: '', primary: true, a: 45, b: 52, better: 'b' },
      { name: 'Willpower', deity: '', primary: true, a: null, b: 8, better: '' },
    ],
    deity: [{ name: 'Justice', deity: 'Nezekan', primary: false, a: 41, b: null, better: '' }],
  });
  assert.deepEqual(compareBoards(left, right), [
    { name: 'Nezekan', a: { open: 12, total: 40 }, b: { open: 20, total: 40 }, better: 'b' },
    { name: 'Zikel', a: { open: 3, total: 40 }, b: null, better: '' },
  ]);
  assert.deepEqual(compareSkills(left, right), {
    both: [{ name: 'Bolt', icon: '', a: 13, b: 16, better: 'b' }],
    onlyA: [{ name: 'Heal', icon: '', level: 4 }],
    onlyB: [{ name: 'Shield', icon: '', level: 8 }],
  });
  assert.deepEqual(compareSets(left, right), [
    {
      name: 'Primal Vigor',
      total: 3,
      a: { equipped: 2, pieces: ['Chalice of Vigor', 'Bell of Vigor'], bonuses: 1 },
      b: { equipped: 1, pieces: ['Chalice of Vigor'], bonuses: 0 },
      better: 'a',
    },
  ]);
});

test('the compare page shows both characters, escaped, with every difference marked', () => {
  const sides = [
    { target: leftAt, answer: answer(leftAt, left), error: '' },
    { target: rightAt, answer: answer(rightAt, right), error: '' },
  ];
  const html = comparePage(sides, { images, now });
  assert.ok(html.includes('Ka&lt;b&gt;') && !html.includes('Ka<b>'));
  assert.match(html, /<main class="dashboard armory armory-compare">/);
  assert.match(html, /data-action="compare-swap"/);
  assert.match(html, /data-compare-change="0"[\s\S]*data-compare-change="1"/);
  assert.match(html, /<a href="#\/armory\/nae\/1101\/QXJtb3JlcklkMDAwMDAwMDAwMDAwMDAwMDAwMDA=">Mira<\/a>/);
  // The overview: Mira is ahead by 78,000 combat power, Ka by 50 item levels; skills are even.
  assert.match(
    html,
    /Combat power<\/th><td><span>126,000<\/span><\/td><td class="is-better"><span>204,000<\/span><small class="compare-gap">\+78,000<\/small>/,
  );
  assert.match(
    html,
    /Item level<\/th><td class="is-better"><span>1,700<\/span><small class="compare-gap">\+50<\/small>/,
  );
  assert.match(html, /Skills learned<\/th><td><span>2<\/span><\/td><td><span>2<\/span><\/td>/);
  // Gear: the same rod, Ka's better enchanted and Mira's of a higher item level, with its card on focus.
  const weapon = html.split('<li class="compare-slot ')[1];
  assert.match(weapon, /^is-same/);
  assert.match(weapon, /Same item/);
  assert.match(weapon, /<span class="compare-chip is-better">\+15<\/span>/);
  assert.match(weapon, /<span class="compare-chip is-better">item level 110<\/span>/);
  assert.match(weapon, /Combat Speed 13% · Bolt \+2/);
  assert.match(weapon, /tabindex="0" aria-label="Ka&lt;b&gt;, Main hand: \+15 Kromede Rod"/);
  assert.match(weapon, /class="armory-tip"/);
  assert.match(html, /Different item[\s\S]*Only Mira[\s\S]*Set: Primal Vigor/);
  // Stats, boards, skill bars and sets.
  assert.match(
    html,
    /Might<\/th><td><span>45<\/span><\/td><td class="is-better"><span>52<\/span><small class="compare-gap">\+7<\/small>/,
  );
  assert.match(html, /Justice <small>Nezekan<\/small><\/th><td><span>41<\/span><\/td><td class="is-none">—<\/td>/);
  assert.match(html, /Nezekan<\/th><td><span>12 \/ 40<\/span>/);
  assert.match(
    html,
    /Only on the skill bar of Ka&lt;b&gt;[\s\S]*Heal[\s\S]*Only on the skill bar of Mira[\s\S]*Shield/,
  );
  assert.match(
    html,
    /Primal Vigor<\/th><td class="is-better"><span>2 pieces <small>\/ 3<\/small><\/span><small class="compare-pieces">Chalice of Vigor, Bell of Vigor<\/small>/,
  );
});

test('a side still waiting for PLAYNC shows its lookup, and the comparison fills in once it is kept', async () => {
  const sides = [
    { target: leftAt, answer: answer(leftAt, left), error: '' },
    {
      target: rightAt,
      answer: answer(rightAt, null, { server: 'Siel', state: 'queued', position: 2, wait: 9 }),
      error: '',
    },
  ];
  const html = comparePage(sides, { images, now });
  assert.match(html, /<h2>A character on Siel<\/h2>/);
  assert.match(html, /data-compare-status="1"><div class="armory-status is-waiting"/);
  assert.match(html, /Fetching from PLAYNC · about 9 s, 2 characters ahead/);
  assert.match(html, /The comparison fills in by itself once the armory keeps both characters\./);
  assert.ok(!html.includes('compare-summary'));
  // One PLAYNC does not list, and one not answered yet.
  const missing = comparePage(
    [
      { target: leftAt, answer: null, error: '' },
      { target: rightAt, answer: null, error: 'PLAYNC does not list this character.' },
    ],
    { images, now },
  );
  assert.match(
    missing,
    /data-compare-status="0"><div class="armory-status is-waiting"[^>]*><span class="armory-spinner"[^>]*><\/span><span>Loading…/,
  );
  assert.match(missing, /is-failed[\s\S]*PLAYNC does not list this character\./);
  try {
    await useLanguage('cs');
    assert.match(comparePage(sides, { images, now }), /Porovnání postav/);
  } finally {
    await useLanguage('en');
  }
});

test('the picker lists bookmarks, the strongest of the class and a search, never the character itself', () => {
  const base = { ...leftAt, name: 'Ka', class: 'Chanter' };
  const mark = {
    ...rightAt,
    name: 'Mira',
    class: 'Chanter',
    classIcon: '',
    level: 45,
    server: 'Siel',
    combatPower: 204000,
    itemLevel: 1650,
    portrait: '',
  };
  const regions = [
    { region: 'GLOBAL_NA', elyos: ['Siel'], asmodian: ['Israphel'] },
    { region: 'GLOBAL_EU', elyos: ['Nezakan'], asmodian: ['Lumiel'] },
  ];
  const view = {
    base,
    bookmarks: [{ ...leftAt, name: 'Ka', class: 'Chanter', server: 'Lumiel' }, mark],
    top: null,
    results: null,
    regions,
    chosen: { region: 'GLOBAL_EU', server: 'Lumiel' },
    images,
  };
  const html = comparePicker(view);
  assert.match(html, /Pick a character to put next to Ka\./);
  assert.equal(html.match(/data-compare-pick=/g).length, 1);
  assert.match(html, /data-compare-pick="nae\/1101\/QXJtb3JlcklkMDAwMDAwMDAwMDAwMDAwMDAwMDA="/);
  assert.match(html, /204,000 CP/);
  assert.match(html, /Strongest Chanter characters[\s\S]*Loading the top players…/);
  assert.match(html, /<form id="compare-search"/);
  assert.match(html, /<option value="GLOBAL_EU" selected>Europe<\/option>/);
  assert.match(html, /<option selected>Lumiel<\/option>/);
  // The top players, the first 20 others; a class without others says so.
  const players = Array.from({ length: 25 }, (_, i) => ({
    ...rightAt,
    characterId: 'Q' + 'x'.repeat(10) + i,
    name: 'P' + i,
    place: i + 1,
    combatPower: 1000 - i,
  }));
  const top = comparePickerTop({ ...view, top: { players: [{ ...leftAt, name: 'Ka' }, ...players] } });
  assert.equal(top.match(/data-compare-pick=/g).length, 20);
  assert.ok(!top.includes('>Ka<'));
  assert.match(
    comparePickerTop({ ...view, top: { players: [{ ...leftAt, name: 'Ka' }] } }),
    /Odyle knows no other Chanter character yet\./,
  );
  assert.equal(comparePickerTop({ ...view, base: { ...base, class: '' } }), '');
  // The search: waiting, its hits, and none.
  assert.match(comparePickerResults({ ...view, searching: true }), /Searching…/);
  assert.match(comparePickerResults({ ...view, results: [mark] }), /data-compare-pick="nae\/1101\//);
  assert.match(
    comparePickerResults({ ...view, results: [] }),
    /PLAYNC lists no character of that name on this server\./,
  );
  // Searched on every server of the region, it says so.
  assert.match(
    comparePickerResults({ ...view, chosen: { region: 'GLOBAL_EU', server: '' }, results: [] }),
    /PLAYNC lists no character with that name in this region\./,
  );
  // Any server first (since 1.2.0), then each race's.
  assert.equal(
    compareServerOptions(regions[0], 'Siel'),
    '<option value="" >Any server</option><optgroup label="Elyos"><option selected>Siel</option></optgroup><optgroup label="Asmodians"><option >Israphel</option></optgroup>',
  );
  assert.match(compareServerOptions(regions[0]), /^<option value="" selected>Any server<\/option>/);
});
