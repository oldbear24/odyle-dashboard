import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseValue,
  parseEffect,
  statGroup,
  statBreakdown,
  activeSets,
  tileFacts,
  gearSummary,
  sumEffects,
  skillBoostTotals,
  dollSlots,
  stoneValue,
  canonicalEffect,
} from '../../src/armorystats.js';
import { armoryProfile } from '../../src/armory.js';
import { tileMeters, tileLabel, tipFacts } from '../../src/armorydetail.js';
// Where stats come from and the gear summary (src/armorystats.js, src/armorydetail.js), on a profile
// shaped like those the armory keeps (backend/odyle/armory.go): lines as a Gladiator's at the level
// cap list them on PLAYNC's item pages, trimmed to a few items.
const vigor = {
  name: 'Primal Vigor',
  equipped: 3,
  items: [
    { name: 'Chalice of Vigor', grade: 'Unique', equipped: true },
    { name: 'Parchment of Vigor', grade: 'Unique', equipped: true },
    { name: 'Compass of Vigor', grade: 'Unique', equipped: true },
    { name: 'Bell of Vigor', grade: 'Unique', equipped: false },
    { name: 'Mirror of Vigor', grade: 'Unique', equipped: false },
  ],
  bonuses: [
    { count: 2, effects: ['Attack +5%', '+60 PvE Attack when HP is 70% or more'] },
    { count: 4, effects: ['+150 PvE Attack when HP is 70% or more'] },
  ],
};
const item = (slot, name, enchant, exceed, detail) => ({
  slot,
  name,
  grade: 'Unique',
  enchant,
  exceed,
  icon: '',
  detail: {
    category: '',
    kind: 'Equip',
    itemLevel: 86,
    maxEnchant: 15,
    maxExceed: 5,
    equipLevel: 45,
    race: 'All',
    classes: [],
    main: [],
    sub: [],
    subCount: 4,
    soulBind: '100',
    subSkills: [],
    stoneSlots: 4,
    stones: [],
    godSlots: 0,
    godStones: [],
    sources: [],
    skins: [],
    tradable: false,
    storable: true,
    ...detail,
  },
});
const profile = {
  v: 2,
  name: 'Nasmeshka',
  level: 45,
  class: 'Gladiator',
  combatPower: 240366,
  itemLevel: 3264,
  stats: [
    { type: 'STR', name: 'Might', value: 131, primary: true, effects: ['Attack increase +13.1%'] },
    { type: 'AGI', name: 'Precision', value: 74, primary: true, effects: [] },
    { type: 'Time', name: 'Time', deity: 'Siel', value: 76, primary: false, effects: ['Combat Speed +7.6%'] },
  ],
  gear: [
    item('MainHand', 'Splendent Wise Dragon Lord Greatsword', 15, 4, {
      category: 'Greatsword',
      itemLevel: 102,
      subCount: 5,
      godSlots: 1,
      main: [
        { name: 'Attack', min: '446', value: '604', extra: '174' },
        { name: 'Accuracy', value: '100' },
        { name: 'Critical Hit', value: '150' },
        { name: 'Attack', value: '0', extra: '40', exceed: true },
      ],
      sub: [
        { name: 'Weapon Damage Boost', value: '9.6%' },
        { name: 'Might', value: '32' },
        { name: 'Attack', value: '51' },
        { name: 'Combat Speed', value: '13%' },
        { name: 'Damage Boost', value: '7.3%' },
        { name: 'Status Effect Chance', value: '25.6%' },
      ],
      stones: [
        { name: 'Critical Hit', value: '+10', grade: 'Legend' },
        { name: 'HP', value: '+100', grade: 'Legend' },
        { name: 'Accuracy Bonus', value: '+15', grade: 'Unique' },
      ],
      godStones: [
        {
          name: "Theostone: Khrudgelmir's Silence",
          grade: 'Unique',
          desc: 'Has a 3% chance to inflict Seal for 4s on attack',
        },
      ],
    }),
    item('SubHand', 'Splendent Wise Dragon Lord Guard', 15, 3, {
      category: 'Guard',
      main: [{ name: 'Attack', value: '210', extra: '174' }],
      sub: [{ name: 'Combat Speed', value: '10.1%' }],
      stones: [
        { name: 'Defense', value: '+30', grade: 'Rare' },
        { name: 'Attack', value: '+10', grade: 'Unique' },
        { name: 'Damage Boost', value: '+100', grade: 'Unique' },
      ],
    }),
    item('Helmet', 'Nuakum Helm', 12, 0, {
      soulBind: '98.5',
      main: [
        { name: 'Defense', value: '477', extra: '300' },
        { name: 'HP', value: '215', extra: '241' },
      ],
      sub: [
        { name: 'Attack increase', value: '2.1%' },
        { name: 'Critical Hit', value: '39' },
      ],
      stones: [
        { name: 'Attack', value: '+5', grade: 'Legend' },
        { name: 'HP', value: '+50', grade: 'Rare' },
        { name: 'HP', value: '+50', grade: 'Rare' },
        { name: 'Critical Hit', value: '+7', grade: 'Rare' },
      ],
    }),
    item('Belt', 'Noble Belt', 10, 0, {
      maxEnchant: 10,
      maxExceed: 0,
      subCount: 0,
      stoneSlots: 0,
      main: [
        { name: 'Defense', value: '500', extra: '300' },
        { name: 'HP', value: '1,100', extra: '500' },
        { name: 'HP Potion Recovery increase', value: '30%' },
        { name: 'Odd line', value: 'n/a' },
      ],
    }),
    item('Bracelet1', 'Ascension Bracelet', 15, 0, {
      maxExceed: 0,
      subCount: 0,
      sub: [
        { name: 'Evasion', value: '12' },
        { name: 'Critical Hit', value: '9' },
        { name: 'MP', value: '26' },
        { name: 'Natural MP Regen', value: '9' },
      ],
      stones: [{ name: 'Attack', value: '+8', grade: 'Legend' }],
    }),
    item('Rune1', 'Clash Rune', 5, 0, {
      maxEnchant: 10,
      maxExceed: 0,
      subCount: 0,
      stoneSlots: 0,
      main: [{ name: 'PvE Damage Tolerance', value: '0.5%', extra: '2.5%' }],
    }),
    ...['Arcana1', 'Arcana2', 'Arcana3'].map((slot, i) =>
      item(slot, vigor.items[i].name, 5, 0, {
        maxEnchant: 5,
        maxExceed: 0,
        subCount: 0,
        stoneSlots: 0,
        main: [{ name: ['Time [Siel]', 'Life [Yustiel]', 'Freedom [Vaizel]'][i], value: '20', extra: '5' }],
        subSkills: [{ name: 'Overhead Slam', level: 4 - i, icon: '' }],
        set: vigor,
      }),
    ),
    { slot: 'Wings', name: 'Dark Veil Wings', grade: 'Unique', enchant: 0, exceed: 0 },
    { slot: 'Pet', name: 'Prissypaws', grade: '', enchant: 0, exceed: 0, level: 3 },
  ],
  skins: [],
  skills: [{ name: 'Overhead Slam', category: 'Active', level: 20, needLevel: 1, acquired: true, equipped: true }],
  titles: {
    owned: 256,
    total: 307,
    equipped: [
      {
        category: 'Attack',
        name: 'Unbound by Genus',
        grade: 'Unique',
        owned: 85,
        total: 106,
        effects: ['PvE Damage Boost +4.5%', 'Attack Bonus +34', 'Critical Hit +68'],
        stats: ['PvE Damage Boost +1%'],
      },
      {
        category: 'Etc',
        name: "Journey's Path",
        grade: 'Unique',
        owned: 81,
        total: 102,
        effects: ['Combat Speed +3%', 'HP +900'],
        stats: [],
      },
    ],
  },
  boards: [
    {
      id: 11,
      name: 'Nezekan',
      open: 68,
      total: 88,
      nodes: [],
      statEffects: [
        'HP +900',
        'Attack Bonus +30',
        'Critical Hit +50',
        'Cooldown Reduction +3%',
        'Multi-hit Chance +4.5%',
      ],
      skillEffects: ['Overhead Slam +1', 'Identify Weakness +2'],
    },
    {
      id: 12,
      name: 'Zikel',
      open: 66,
      total: 88,
      nodes: [],
      statEffects: ['HP +700', 'Attack Bonus +33', 'Cooldown -2.8%'],
      skillEffects: ['Overhead Slam +1'],
    },
  ],
};
const row = (b, name, percent = false) => b.rows.find(r => r.name === name && r.percent === percent);

test('values and effect lines are read as PLAYNC writes them, and nothing else is guessed', () => {
  assert.deepEqual(parseValue('630'), { value: 630, percent: false });
  assert.deepEqual(parseValue('+10'), { value: 10, percent: false });
  assert.deepEqual(parseValue('1,100'), { value: 1100, percent: false });
  assert.deepEqual(parseValue('9.6%'), { value: 9.6, percent: true });
  assert.deepEqual(parseValue('-2.8%'), { value: -2.8, percent: true });
  assert.deepEqual(parseValue('−3'), { value: -3, percent: false });
  for (const bad of ['', 'n/a', '1.2.3', '12 %%', '1,10', null, undefined]) assert.equal(parseValue(bad), null, bad);
  assert.deepEqual(parseEffect('Attack Bonus +30'), { name: 'Attack Bonus', value: 30, percent: false });
  assert.deepEqual(parseEffect('Combat Speed +1.5%'), { name: 'Combat Speed', value: 1.5, percent: true });
  assert.deepEqual(parseEffect('Defense 630'), { name: 'Defense', value: 630, percent: false });
  assert.deepEqual(parseEffect('Multi-hit Chance +4.5%'), { name: 'Multi-hit Chance', value: 4.5, percent: true });
  assert.deepEqual(parseEffect('Cooldown -2.8%'), { name: 'Cooldown', value: -2.8, percent: true });
  assert.deepEqual(parseEffect('Time [Siel] +20'), { name: 'Time [Siel]', value: 20, percent: false });
  assert.deepEqual(parseEffect('  HP   +1,500 '), { name: 'HP', value: 1500, percent: false });
  for (const bad of [
    '+60 PvE Attack when HP is 70% or more',
    'Restores 1,500 MP when MP is 20% or less [Cooldown: 30s]',
    'Has a 3% chance to inflict Seal for 4s on attack',
    'Attack',
    '+5',
    '',
  ])
    assert.equal(parseEffect(bad), null, bad);
});

test('stats are grouped by the stats panel first, then by words in their names', () => {
  assert.equal(statGroup('Might', profile.stats), 'primary');
  assert.equal(statGroup('Time [Siel]', profile.stats), 'deity');
  assert.equal(statGroup('Space [Israphel]', profile.stats), 'deity');
  assert.equal(statGroup('Attack Bonus'), 'offence');
  assert.equal(statGroup('Critical Hit'), 'offence');
  assert.equal(statGroup('Critical Hit Resist'), 'defence');
  assert.equal(statGroup('PvE Damage Tolerance'), 'defence');
  assert.equal(statGroup('HP'), 'defence');
  assert.equal(statGroup('MP'), 'utility');
  assert.equal(statGroup('Natural MP Regen'), 'utility');
  assert.equal(statGroup('HP Potion Recovery increase'), 'utility');
  assert.equal(statGroup('Something new'), 'utility');
});

test('a stone of a percentage stat is in hundredths of a percent, and Cooldown is Cooldown Reduction', () => {
  assert.equal(stoneValue('Damage Boost', '+100'), '+1%');
  assert.equal(stoneValue('Critical Damage Boost', '+30'), '+0.3%');
  assert.equal(stoneValue('Front Attack Damage Boost', '10'), '+0.1%');
  assert.equal(stoneValue('PvE Damage Tolerance', '-25'), '-0.25%');
  assert.equal(stoneValue('Damage Boost', '+1.5%'), '+1.5%');
  assert.equal(stoneValue('Attack', '+5'), '+5');
  assert.equal(stoneValue('Power Shard Damage Bonus', '+40'), '+40');
  assert.equal(stoneValue('Damage Boost', undefined), undefined);
  assert.deepEqual(canonicalEffect(parseEffect('Cooldown -7.4%')), {
    name: 'Cooldown Reduction',
    value: 7.4,
    percent: true,
  });
  assert.deepEqual(canonicalEffect(parseEffect('Cooldown Reduction +3%')), {
    name: 'Cooldown Reduction',
    value: 3,
    percent: true,
  });
  assert.equal(canonicalEffect(null), null);
});

test('every stat is summed per source, a weapon attack as a range, flat and percent apart', () => {
  const b = statBreakdown(profile);
  const attack = row(b, 'Attack');
  // Weapon 446 ~ 604 plus 174, the guard 210 + 174; the weapon's exceed line 40; soul binding 51;
  // stones 10, 5, 8.
  assert.deepEqual(attack.by.gear, { low: 446 + 174 + 210 + 174, high: 604 + 174 + 210 + 174 });
  assert.deepEqual(attack.by.exceed, { low: 40, high: 40 });
  assert.deepEqual(attack.by.soul, { low: 51, high: 51 });
  assert.deepEqual(attack.by.stones, { low: 23, high: 23 });
  assert.deepEqual(attack.total, { low: 1044 + 51 + 23, high: 1202 + 51 + 23 });
  assert.equal(attack.group, 'offence');
  // The set's 2-piece bonus counts once though three pieces list it; its conditional line is left out.
  assert.deepEqual(row(b, 'Attack', true).by, { sets: { low: 5, high: 5 } });
  // Soul binding 13 + 10.1, the title 3, and Time 76 gives 7.6.
  assert.deepEqual(row(b, 'Combat Speed', true).total, { low: 33.7, high: 33.7 });
  assert.deepEqual(Object.keys(row(b, 'Combat Speed', true).by).sort(), ['soul', 'stats', 'titles']);
  // Might 131 gives Attack increase 13.1 % beside the helmet's 2.1 %.
  assert.deepEqual(row(b, 'Attack increase', true).by, {
    soul: { low: 2.1, high: 2.1 },
    stats: { low: 13.1, high: 13.1 },
  });
  // A soulstone's +100 is 1 %, beside the weapon's soul binding 7.3 %; no flat Damage Boost.
  assert.deepEqual(row(b, 'Damage Boost', true).by, { soul: { low: 7.3, high: 7.3 }, stones: { low: 1, high: 1 } });
  assert.equal(row(b, 'Damage Boost'), undefined);
  // The title worn gives PvE Damage Boost +4.5 % when worn and +1 % of its own.
  assert.equal(row(b, 'PvE Damage Boost', true).by.titles.high, 5.5);
  const crit = row(b, 'Critical Hit');
  assert.deepEqual(Object.fromEntries(Object.entries(crit.by).map(([k, v]) => [k, v.high])), {
    gear: 150,
    soul: 48,
    stones: 17,
    boards: 50,
    titles: 68,
  });
  assert.equal(crit.total.high, 333);
  assert.equal(row(b, 'HP').total.high, 215 + 241 + 1100 + 500 + 100 + 50 + 50 + 900 + 700 + 900);
  assert.equal(row(b, 'Attack Bonus').total.high, 30 + 33 + 34);
  assert.equal(row(b, 'PvE Damage Tolerance', true).total.high, 3);
  // A board's "Cooldown -2.8%" is Cooldown Reduction, beside the other board's +3 %.
  assert.equal(row(b, 'Cooldown', true), undefined);
  assert.deepEqual(row(b, 'Cooldown Reduction', true).total, { low: 5.8, high: 5.8 });
  // Primary and deity stats total what the stats panel shows: the rest of it is "other", and a stat
  // no source gives has a row all the same; percentages never name one.
  assert.equal(row(b, 'Might').character, 131);
  assert.deepEqual(row(b, 'Might').by, { soul: { low: 32, high: 32 }, other: { low: 99, high: 99 } });
  assert.equal(row(b, 'Might').total.high, 131);
  assert.equal(row(b, 'Might').over, false);
  assert.deepEqual(row(b, 'Precision').by, { other: { low: 74, high: 74 } });
  assert.equal(row(b, 'Time [Siel]').character, 76);
  assert.deepEqual(row(b, 'Time [Siel]').by, { gear: { low: 25, high: 25 }, other: { low: 51, high: 51 } });
  assert.equal(row(b, 'Life [Yustiel]').character, null);
  assert.equal(row(b, 'Life [Yustiel]').by.other, undefined);
  assert.equal(row(b, 'Attack').character, null);
  // Sources above the panel's value (a profile read while the character changed) are kept, and said.
  const over = statBreakdown({ ...profile, stats: [{ ...profile.stats[0], value: 20 }] });
  assert.deepEqual(row(over, 'Might').by, { soul: { low: 32, high: 32 } });
  assert.equal(row(over, 'Might').over, true);
  // Groups in order, flat before percent, the largest first.
  const groups = b.rows.map(r => r.group);
  assert.deepEqual([...new Set(groups)], ['primary', 'offence', 'defence', 'utility', 'deity']);
  const offence = b.rows.filter(r => r.group === 'offence');
  assert.equal(offence[0].name, 'Attack');
  assert.ok(offence.findIndex(r => r.percent) > offence.findLastIndex(r => !r.percent));
  // What is no stat line is listed, each once, and the theostones apart.
  assert.deepEqual(b.skipped, [
    { source: 'gear', text: 'Odd line n/a' },
    { source: 'sets', text: '+60 PvE Attack when HP is 70% or more' },
  ]);
  assert.deepEqual(
    b.godstones.map(s => [s.slot, s.name]),
    [['MainHand', "Theostone: Khrudgelmir's Silence"]],
  );
});

test('a profile without details, or with odd lines, breaks nothing', () => {
  assert.deepEqual(statBreakdown(null), { rows: [], skipped: [], godstones: [] });
  assert.deepEqual(statBreakdown({ gear: [{ slot: 'Helmet', name: 'x' }] }).rows, []);
  const odd = statBreakdown({
    gear: [
      item('MainHand', 'x', 0, 0, {
        main: [
          { name: 'Attack', min: '10%', value: '20' },
          { name: 'Attack', value: '20', extra: '5%' },
          { name: 'Zero', value: '0' },
        ],
      }),
    ],
  });
  assert.deepEqual(odd.rows, []);
  assert.equal(odd.skipped.length, 2);
});

test('sets count each once, with the bonuses on and the next one', () => {
  const [set] = activeSets(profile.gear);
  assert.equal(set.name, 'Primal Vigor');
  assert.equal(set.equipped, 3);
  assert.equal(set.pieces, 5);
  assert.deepEqual(
    set.active.map(b => b.count),
    [2],
  );
  assert.equal(set.next.count, 4);
  assert.equal(set.missing, 1);
  const full = activeSets([{ detail: { set: { ...vigor, equipped: 5 } } }])[0];
  assert.equal(full.next, null);
  assert.equal(full.missing, 0);
});

test('a tile shows enchantment, exceed, stones and soul binding lines, of what the item can hold', () => {
  const [weapon, , helmet, belt, bracelet] = profile.gear;
  assert.deepEqual(tileFacts(helmet), {
    enchant: 12,
    maxEnchant: 15,
    exceed: 0,
    maxExceed: 5,
    stones: 4,
    stoneSlots: 4,
    godStones: 0,
    godSlots: 0,
    soulLines: 2,
    soulSlots: 4,
  });
  // A weapon lists one line more than PLAYNC's count, a bracelet lines with a count of 0: no "of".
  assert.equal(tileFacts(weapon).soulSlots, 0);
  assert.equal(tileFacts(bracelet).soulSlots, 0);
  assert.equal(tileFacts(belt).stoneSlots, 0);
  assert.equal(tileFacts({ slot: 'Wings', name: 'x' }), null);
  const html = tileMeters(helmet);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /width:80%/);
  assert.match(html, /\+12\/15/);
  assert.match(html, /✦0\/5/);
  assert.match(html, /is-stones is-full">(<i class="is-on"><\/i>){4}<\/span>/);
  assert.match(html, /◈2/);
  assert.match(tileMeters(weapon), /is-enchant is-full/);
  assert.match(tileMeters(bracelet), /is-stones"><i class="is-on"><\/i>(<i><\/i>){3}<\/span>/);
  assert.equal(tileMeters({ slot: 'Pet', name: 'x' }), '');
  assert.equal(tileLabel(helmet), 'enchantment +12 of 15, exceed 0 of 5, 4 of 4 stones, 2 soul binding lines');
  assert.deepEqual(tipFacts(helmet), [['Soul binding lines', '2 / 4']]);
  assert.deepEqual(tipFacts(weapon), [['Soul binding lines', '6']]);
  assert.deepEqual(tipFacts(belt), []);
});

test('the gear summary counts enchantment, stones, soul binding, empty slots and sets', () => {
  const s = gearSummary(profile);
  assert.equal(s.items, 9);
  assert.equal(s.enchantable, 9);
  // 15+15+12+10+15+5+5+5+5 of 15+15+15+10+15+10+5+5+5.
  assert.equal(s.averageEnchant, 87 / 9);
  assert.equal(s.enchantShare, 87 / 95);
  assert.equal(s.atMax, 7);
  assert.equal(s.exceedable, 3);
  assert.equal(s.exceed, 7);
  assert.equal(s.maxExceed, 15);
  assert.equal(s.stones, 3 + 3 + 4 + 1);
  assert.equal(s.stoneSlots, 16);
  assert.equal(s.godStones, 1);
  assert.equal(s.godSlots, 1);
  assert.equal(s.soulLines, 6 + 1 + 2 + 4);
  // The rate of the items that roll soul binding: the weapon, the guard and the helmet.
  assert.equal(s.soulRate, (100 + 100 + 98.5) / 3);
  assert.equal(s.empty.length, dollSlots.length - 9);
  assert.ok(s.empty.includes('Torso') && !s.empty.includes('Helmet') && !s.empty.includes('Wings'));
  assert.equal(s.sets.length, 1);
  assert.equal(gearSummary({ gear: [] }).detailed, 0);
});

test('board effects and skill levels add up across boards and items', () => {
  const totals = sumEffects(profile.boards.flatMap(b => b.statEffects));
  assert.deepEqual(totals[0], { name: 'HP', percent: false, value: 1600 });
  assert.deepEqual(
    totals.find(r => r.name === 'Attack Bonus'),
    { name: 'Attack Bonus', percent: false, value: 63 },
  );
  assert.ok(totals.findIndex(r => r.percent) > totals.findLastIndex(r => !r.percent));
  assert.deepEqual(skillBoostTotals(profile), [
    { name: 'Overhead Slam', gear: 9, boards: 2, total: 11 },
    { name: 'Identify Weakness', gear: 0, boards: 2, total: 2 },
  ]);
});

test('the profile shows the summary, the tiles, where stats come from, board totals and skill levels', () => {
  const answer = { region: 'eu', serverId: 1316, characterId: 'abc=', server: 'Bakarma', profile, fetchedAt: '' };
  const gear = armoryProfile(answer, Date.now(), false, false, {});
  assert.match(gear, /class="gear-summary"/);
  assert.match(gear, /Average enchantment/);
  assert.match(gear, /1 piece to the 4-piece bonus/);
  assert.match(gear, /<h2>Where stats come from<\/h2>/);
  assert.match(gear, /<th scope="col">Soul binding<\/th>/);
  // Weapon attack as its range in the total.
  assert.match(gear, /1,118–1,276/);
  assert.doesNotMatch(gear, /<small>PLAYNC shows/);
  // The exceed lines, what stats give and the rest of a primary stat have columns of their own, and
  // Might totals the 131 PLAYNC shows.
  assert.match(gear, /<th scope="col">Exceed<\/th>/);
  assert.match(gear, /<th scope="col">From stats<\/th>/);
  assert.match(gear, /<th scope="col">Other sources<\/th>/);
  assert.match(gear, /<th scope="row">Might<\/th>(?:(?!<\/tr>).)*<td class="stat-total" data-label="Total">131<\/td>/);
  assert.match(gear, /Theostone: Khrudgelmir&#39;s Silence/);
  assert.match(gear, /1 effect not counted|2 effects not counted/);
  assert.match(gear, /aria-label="Helmet: \+12 Nuakum Helm, enchantment \+12 of 15/);
  assert.match(gear, /<dt>Soul binding lines<\/dt><dd>2 \/ 4<\/dd>/);
  const boards = armoryProfile(answer, Date.now(), false, false, { tab: 'daevanion' });
  assert.match(boards, /All boards together/);
  assert.match(boards, /<span>HP<\/span><b>\+1,600<\/b>/);
  const skills = armoryProfile(answer, Date.now(), false, false, { tab: 'skills' });
  assert.match(skills, /Skill levels from gear and Daevanion/);
  assert.match(skills, /Gear adds 9 skill levels, Daevanion 4\./);
});
