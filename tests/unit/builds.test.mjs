import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildsRoute, buildTarget, buildPath, sharedPath, buildTitle } from '../../src/buildlinks.js';
import { pageOf, pageNav, pageTitle } from '../../src/routes.js';
import {
  catalogSlot,
  normalPlan,
  gearOf,
  buildProfile,
  toggleNode,
  fillBoard,
  setSkill,
  setGear,
  slotEntry,
  slotChoice,
  planFromProfile,
  buildGap,
  buildsPage,
  buildPage,
  copyName,
  slotEditor,
  slotDetails,
} from '../../src/builds.js';
import { statBreakdown } from '../../src/armorystats.js';

// A class's catalog as backend/odyle/buildcatalog.go answers it.
const catalog = {
  class: 'Chanter',
  characters: 12,
  boards: [
    {
      id: 71,
      name: 'Nezekan',
      icon: 'nez.png',
      total: 3,
      nodes: [
        { r: 3, c: 3, g: 'Unique', t: 'Stat', e: 'Attack +3' },
        { r: 3, c: 4, g: 'Rare', t: 'Stat', e: 'Boss Attack +3, Boss Defense +30' },
        { r: 4, c: 3, g: 'Rare', t: 'SkillLevel', e: 'Bolt +1' },
        { r: 8, c: 8, g: 'None', t: 'Start', n: 'Nezekan - Start' },
      ],
    },
  ],
  skills: [
    { name: 'Bolt', category: 'Active', icon: 'bolt.png', needLevel: 1, maxLevel: 15, bar: 9 },
    { name: 'Heal', category: 'Passive', icon: 'heal.png', needLevel: 10, maxLevel: 9, bar: 2 },
  ],
  slots: [
    {
      slot: 'MainHand',
      items: [
        {
          name: 'Rod A',
          grade: 'Unique',
          icon: 'rod.png',
          count: 7,
          category: 'Orb',
          kind: 'Weapon',
          itemLevel: 102,
          maxEnchant: 15,
          maxExceed: 5,
          enchant: 12,
          stoneSlots: 2,
          godSlots: 1,
          subCount: 4,
          main: [{ name: 'Attack', percent: false, min: 315, value: 630, perEnchant: 10 }],
          exceed: [{ name: 'Attack', percent: false, value: 0, perLevel: 20 }],
          set: {
            name: 'Primal Vigor',
            items: [
              { name: 'Rod A', grade: 'Unique' },
              { name: 'Orb B', grade: 'Unique' },
            ],
            bonuses: [{ count: 2, effects: ['Attack +50'] }],
          },
          sources: ['Crafting'],
          classes: [],
          tradable: false,
        },
      ],
      stones: [{ name: 'Attack', value: '+10', grade: 'Unique', icon: 'atk.png', count: 5 }],
      gods: [{ name: 'Fury', grade: 'Epic', desc: 'Hits harder', icon: 'fury.png', count: 3 }],
      rolled: [{ name: 'Combat Speed', percent: true, count: 6, low: 4, value: 9, high: 13 }],
      boosts: [{ name: 'Bolt', icon: 'bolt.png', count: 4, level: 2, high: 3 }],
    },
    {
      slot: 'SubHand',
      items: [
        {
          name: 'Orb B',
          grade: 'Unique',
          count: 3,
          itemLevel: 100,
          maxEnchant: 15,
          maxExceed: 0,
          main: [{ name: 'Defense', percent: false, value: 200, perEnchant: 5 }],
          exceed: [],
          set: { name: 'Primal Vigor', items: [], bonuses: [{ count: 2, effects: ['Attack +50'] }] },
          sources: [],
        },
      ],
      stones: [],
      gods: [],
      rolled: [],
      boosts: [],
    },
    {
      slot: 'Earring',
      items: [{ name: 'Ear X', grade: 'Legend', count: 9, main: [], exceed: [] }],
      stones: [],
      gods: [],
      rolled: [],
      boosts: [],
    },
  ],
};

const plan = {
  gear: [
    {
      slot: 'MainHand',
      name: 'Rod A',
      grade: 'Unique',
      enchant: 15,
      exceed: 2,
      stones: [{ name: 'Attack', value: '+10', grade: 'Unique' }],
      gods: [{ name: 'Fury', grade: 'Epic' }],
      sub: [{ name: 'Combat Speed', value: '13%' }],
      skills: [{ name: 'Bolt', level: 2 }],
    },
    {
      slot: 'SubHand',
      name: 'Orb B',
      grade: 'Unique',
      enchant: 10,
      exceed: 0,
      stones: [],
      gods: [],
      sub: [],
      skills: [],
    },
    {
      slot: 'Ring1',
      name: 'Gone Ring',
      grade: 'Epic',
      enchant: 3,
      exceed: 0,
      stones: [],
      gods: [],
      sub: [],
      skills: [],
    },
  ],
  skills: [
    { name: 'Bolt', level: 13, bar: true },
    { name: 'Old Skill', level: 4, bar: false },
  ],
  boards: [{ id: 71, nodes: ['3,3', '3,4', '4,3'] }],
  notes: 'Rotation',
};

test('build pages have paths of their own, which the router knows and names', () => {
  for (const path of [
    '/builds',
    '/builds/abc123def456ghi',
    '/builds/abc123def456ghi/skills',
    '/builds/shared/ABCDEFGHJKLMNPQR',
    '/builds/shared/ABCDEFGHJKLMNPQR/compare',
  ])
    assert.ok(buildsRoute.test(path), path);
  for (const path of [
    '/builds/',
    '/builds/short',
    '/builds/abc123def456ghi/titles',
    '/builds/shared/abcdefghjklmnpqr',
    '/builds/shared/ABCDEFGHJKLMNPQ1',
    '/builds/x/y/z',
  ])
    assert.ok(!buildsRoute.test(path), path);
  assert.deepEqual(buildTarget('/builds'), { list: true });
  assert.deepEqual(buildTarget('/builds/abc123def456ghi/daevanion'), { id: 'abc123def456ghi', tab: 'daevanion' });
  assert.deepEqual(buildTarget('/builds/shared/ABCDEFGHJKLMNPQR'), { code: 'ABCDEFGHJKLMNPQR', tab: '' });
  assert.equal(buildPath('abc123def456ghi', 'skills'), '/builds/abc123def456ghi/skills');
  assert.equal(buildPath('abc123def456ghi', 'nope'), '/builds/abc123def456ghi');
  assert.equal(sharedPath('ABCDEFGHJKLMNPQR', 'compare'), '/builds/shared/ABCDEFGHJKLMNPQR/compare');
  assert.equal(pageOf('/builds/abc123def456ghi/skills'), '/builds/abc123def456ghi/skills');
  assert.equal(pageOf('/builds/nope/nope/nope'), '');
  assert.equal(pageNav('/builds/shared/ABCDEFGHJKLMNPQR'), 'builds');
  assert.equal(pageTitle('/builds'), 'Your builds · Odyle');
  assert.equal(pageTitle('/builds/shared/ABCDEFGHJKLMNPQR'), 'A shared build · Odyle');
  assert.equal(pageTitle('/builds/abc123def456ghi', 'Kept title'), 'Kept title');
  assert.equal(buildTitle({ name: 'Boss build', class: 'Chanter' }), 'Boss build · Chanter build · Odyle');
});

test('a build shows as an armory profile: items with their stats at the levels chosen, sets, skills and open nodes', () => {
  assert.equal(catalogSlot('Earring2'), 'Earring');
  assert.equal(catalogSlot('Arcana3'), 'Arcana3');
  const p = buildProfile({ name: 'Boss build', class: 'Chanter', plan }, catalog);
  assert.equal(p.name, 'Boss build');
  assert.deepEqual(
    p.gear.map(g => g.slot),
    ['MainHand', 'SubHand', 'Ring1'],
  );
  const rod = p.gear[0];
  assert.equal(rod.icon, 'rod.png');
  assert.deepEqual(rod.detail.main, [
    { name: 'Attack', min: '315', value: '630', extra: '150' },
    { name: 'Attack', value: '', extra: '40', exceed: true },
  ]);
  assert.deepEqual(rod.detail.stones, [{ name: 'Attack', value: '+10', grade: 'Unique', icon: 'atk.png' }]);
  assert.deepEqual(rod.detail.godStones, [{ name: 'Fury', grade: 'Epic', desc: 'Hits harder', icon: 'fury.png' }]);
  assert.deepEqual(rod.detail.subSkills, [{ name: 'Bolt', level: 2, icon: 'bolt.png' }]);
  // Both pieces of the set are in the build.
  assert.equal(rod.detail.set.equipped, 2);
  assert.deepEqual(
    rod.detail.set.items.map(i => i.equipped),
    [true, true],
  );
  // An item the catalog no longer lists keeps its name, without details.
  assert.deepEqual(p.gear[2], {
    slot: 'Ring1',
    name: 'Gone Ring',
    grade: 'Epic',
    enchant: 3,
    exceed: 0,
    icon: '',
    detail: null,
  });
  // The stats the armory works out: the rod's attack with its enchantment and exceed, stones, the set.
  const rows = statBreakdown(p).rows;
  const attack = rows.find(r => r.name === 'Attack' && !r.percent);
  assert.deepEqual(attack.by.gear, { low: 465, high: 780 });
  assert.deepEqual(attack.by.exceed, { low: 40, high: 40 });
  assert.deepEqual(attack.by.stones, { low: 10, high: 10 });
  assert.deepEqual(attack.by.sets, { low: 50, high: 50 });
  assert.ok(rows.some(r => r.name === 'Boss Defense' && r.by.boards.high === 30));
  // Every skill of the class, at the plan's level (0: not learned), and the plan's others.
  assert.deepEqual(
    p.skills.map(s => [s.name, s.level, s.acquired, s.equipped]),
    [
      ['Bolt', 13, true, true],
      ['Heal', 0, false, false],
      ['Old Skill', 4, true, false],
    ],
  );
  const board = p.boards[0];
  assert.equal(board.open, 3);
  assert.equal(board.nodes.find(n => n.t === 'Start').o, true);
  assert.deepEqual(board.statEffects, ['Attack +3', 'Boss Attack +3', 'Boss Defense +30']);
  assert.deepEqual(board.skillEffects, ['Bolt +1']);
  // Without a catalog (still loading) the gear keeps its names.
  assert.deepEqual(
    buildProfile({ plan }, null).gear.map(g => g.detail),
    [null, null, null],
  );
  assert.deepEqual(normalPlan(null), { gear: [], skills: [], boards: [], notes: '' });
});

test('a plan changes by clicking: nodes, whole boards, skills and slots', () => {
  let p = toggleNode(plan, 71, '3,3');
  assert.deepEqual(p.boards, [{ id: 71, nodes: ['3,4', '4,3'] }]);
  p = toggleNode(p, '71', '3,3');
  assert.deepEqual(p.boards, [{ id: 71, nodes: ['3,4', '4,3', '3,3'] }]);
  assert.deepEqual(toggleNode({}, 5, '1,1').boards, [{ id: 5, nodes: ['1,1'] }]);
  assert.deepEqual(toggleNode({ boards: [{ id: 5, nodes: ['1,1'] }] }, 5, '1,1').boards, []);
  assert.deepEqual(fillBoard({}, catalog.boards[0], true).boards, [{ id: 71, nodes: ['3,3', '3,4', '4,3'] }]);
  assert.deepEqual(fillBoard(plan, catalog.boards[0], false).boards, []);
  // On the bar, a skill not learned is learned; at level 0 it leaves the bar and the plan.
  assert.deepEqual(setSkill({}, 'Heal', { bar: true }).skills, [{ name: 'Heal', level: 1, bar: true }]);
  assert.deepEqual(
    setSkill(plan, 'Bolt', { level: 14 }).skills.find(s => s.name === 'Bolt'),
    { name: 'Bolt', level: 14, bar: true },
  );
  assert.equal(
    setSkill(plan, 'Bolt', { level: 0 }).skills.some(s => s.name === 'Bolt'),
    false,
  );
  assert.equal(setSkill(plan, 'Bolt', { level: 99 }).skills.find(s => s.name === 'Bolt').level, 50);
  assert.deepEqual(
    setGear(plan, 'Ring1', null).gear.map(g => g.slot),
    ['MainHand', 'SubHand'],
  );
  assert.equal(setGear({}, 'Helmet', { name: 'Hat', grade: 'Rare' }).gear[0].slot, 'Helmet');
});

test("the slot editor offers the slot's items and what goes with the one chosen, and reads the choice back", () => {
  const choice = slotChoice(plan.gear[0]);
  assert.deepEqual(choice, {
    item: 'Rod A|Unique',
    enchant: 15,
    exceed: 2,
    level: 0,
    stones: ['Attack|+10|Unique'],
    gods: ['Fury|Epic'],
    sub: ['Combat Speed|13%'],
    skills: ['Bolt|2'],
  });
  const html = slotEditor('MainHand', catalog, choice, '/img/');
  assert.match(html, /value="Rod A\|Unique" checked/);
  assert.match(html, /worn by 7/);
  // Enchantment up to its limit, exceed, two stone slots, a theostone, soul binding (one more line
  // than PLAYNC's count) and a raised skill.
  assert.equal((html.match(/name="enchant"/g) || []).length, 1);
  assert.match(html, /<option value="15" selected>\+15<\/option>/);
  assert.equal((html.match(/name="stone"/g) || []).length, 2);
  assert.equal((html.match(/name="god"/g) || []).length, 1);
  assert.equal((html.match(/name="sub"/g) || []).length, 5);
  assert.match(html, /Combat Speed 13% \(highest seen\)/);
  assert.match(html, /<option value="Bolt\|3"/);
  assert.match(slotDetails('MainHand', catalog, slotChoice(null)), /stays empty/);
  // An earring (no stones known) offers no stone slots; the pair shares the slot's items.
  assert.match(slotEditor('Earring2', catalog, slotChoice(null)), /value="Ear X\|Legend"/);

  const entry = slotEntry(
    {
      item: 'Rod A|Unique',
      enchant: '20',
      exceed: '3',
      level: null,
      stones: ['Attack|+10|Unique', ''],
      gods: ['Fury|Epic'],
      sub: ['Combat Speed|9%', ''],
      skills: ['Bolt|3'],
    },
    catalog,
    'MainHand',
  );
  assert.deepEqual(entry, {
    slot: 'MainHand',
    name: 'Rod A',
    grade: 'Unique',
    enchant: 15,
    exceed: 3,
    stones: [{ name: 'Attack', value: '+10', grade: 'Unique' }],
    gods: [{ name: 'Fury', grade: 'Epic' }],
    sub: [{ name: 'Combat Speed', value: '9%' }],
    skills: [{ name: 'Bolt', level: 3 }],
  });
  assert.equal(slotEntry({ item: '' }, catalog, 'MainHand'), null);
});

test('a build made from an armory profile takes its gear, learned skills and open nodes', () => {
  const answer = {
    region: 'eu',
    serverId: '2304',
    characterId: 'kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=',
    profile: {
      name: 'Kai',
      class: 'Chanter',
      gear: [
        {
          slot: 'MainHand',
          name: 'Rod A',
          grade: 'Unique',
          enchant: 15,
          exceed: 1,
          detail: {
            stones: [{ name: 'Attack', value: '+10', grade: 'Unique', icon: 'x.png' }],
            godStones: [{ name: 'Fury', grade: 'Epic', desc: 'long text' }],
            sub: [{ name: 'Combat Speed', value: '13%' }],
            subSkills: [{ name: 'Bolt', level: 2, icon: 'b.png' }],
          },
        },
        { slot: 'Pet', name: 'Pagati', grade: '', enchant: 0, exceed: 0, level: 3 },
        { slot: 'Costume', name: 'Not a slot', grade: 'Rare' },
      ],
      skills: [
        { name: 'Bolt', level: 13, acquired: true, equipped: true },
        { name: 'Heal', level: 0, acquired: false, equipped: false },
      ],
      boards: [
        {
          id: 71,
          nodes: [
            { r: 8, c: 8, t: 'Start', o: true },
            { r: 3, c: 3, t: 'Stat', o: true },
            { r: 3, c: 4, t: 'Stat' },
          ],
        },
        { id: 72, nodes: [{ r: 8, c: 8, t: 'Start', o: true }] },
      ],
    },
  };
  const made = planFromProfile(answer);
  assert.equal(made.name, "Kai's build");
  assert.equal(made.class, 'Chanter');
  assert.deepEqual(made.plan.gear, [
    {
      slot: 'MainHand',
      name: 'Rod A',
      grade: 'Unique',
      enchant: 15,
      exceed: 1,
      stones: [{ name: 'Attack', value: '+10', grade: 'Unique' }],
      gods: [{ name: 'Fury', grade: 'Epic' }],
      sub: [{ name: 'Combat Speed', value: '13%' }],
      skills: [{ name: 'Bolt', level: 2 }],
    },
    {
      slot: 'Pet',
      name: 'Pagati',
      grade: '',
      enchant: 0,
      exceed: 0,
      level: 3,
      stones: [],
      gods: [],
      sub: [],
      skills: [],
    },
  ]);
  assert.deepEqual(made.plan.skills, [{ name: 'Bolt', level: 13, bar: true }]);
  assert.deepEqual(made.plan.boards, [{ id: 71, nodes: ['3,3'] }]);
  assert.deepEqual(made.plan.from, { region: 'eu', serverId: 2304, characterId: answer.characterId, name: 'Kai' });
});

test('compared with a character, a build lists the items to get, the levels and stones to add, the nodes and skills', () => {
  const build = buildProfile({ class: 'Chanter', plan }, catalog);
  const character = {
    gear: [
      { slot: 'MainHand', name: 'Rod A', grade: 'Unique', enchant: 12, exceed: 2, detail: { stones: [] } },
      { slot: 'SubHand', name: 'Other Orb', grade: 'Epic', enchant: 15 },
      { slot: 'Ring1', name: 'Gone Ring', grade: 'Epic', enchant: 5 },
    ],
    boards: [
      {
        id: 71,
        nodes: [
          { r: 3, c: 3, o: true },
          { r: 3, c: 4 },
          { r: 4, c: 3 },
        ],
      },
    ],
    skills: [{ name: 'Bolt', level: 10, equipped: false }],
  };
  const gap = buildGap(build, character);
  assert.deepEqual(
    gap.gear.map(g => [g.slot, g.kind, g.enchant, g.exceed, g.stones]),
    [
      ['MainHand', 'polish', 3, 0, 1],
      ['SubHand', 'item', undefined, undefined, undefined],
    ],
  );
  assert.deepEqual(
    gap.boards.map(b => [b.id, b.missing, b.known]),
    [[71, 2, true]],
  );
  assert.deepEqual(gap.skills, [
    { name: 'Bolt', icon: 'bolt.png', want: 13, have: 10, bar: true },
    { name: 'Old Skill', icon: '', want: 4, have: 0, bar: false },
  ]);
  assert.equal(gap.done, false);
  assert.equal(buildGap(buildProfile({ plan: {} }, catalog), character).done, true);
});

test('the pages: the list with a form for a new build, a build its player edits, and a shared one', () => {
  const list = buildsPage(
    {
      builds: [
        {
          id: 'abc123def456ghi',
          name: 'Boss <b>build</b>',
          class: 'Chanter',
          share: 'ABCDEFGHJKLMNPQR',
          updated: '2026-11-20 10:00:00.000Z',
          gear: 3,
          nodes: 1,
          bar: 2,
          from: { name: 'Kai' },
        },
      ],
      classes: [{ name: 'Chanter', icon: 'class_icon_chanter.png' }],
      limit: 50,
    },
    Date.parse('2026-11-21T10:00:00Z'),
    '/img/',
  );
  assert.match(list, /id="build-new-form"/);
  assert.match(list, /<option value="Chanter">Chanter<\/option>/);
  assert.match(list, /Boss &lt;b&gt;build&lt;\/b&gt;/);
  assert.match(list, /<span>3 items<\/span><span>1 node<\/span><span>2 skills on the bar<\/span>/);
  assert.match(
    list,
    /class="build-card-mark" aria-hidden="true"><img class="class-icon" src="\/img\/class_icon_chanter.png"/,
  );
  // Each card has a button that copies it, beside (not inside) its link.
  assert.match(
    list,
    /<\/a><button type="button" class="build-card-copy" data-build-copy="abc123def456ghi" title="Make a copy of Boss &lt;b&gt;build&lt;\/b&gt;"/,
  );
  const full = buildsPage({ builds: [{ id: 'abc123def456ghi', name: 'A', class: 'Chanter' }], classes: [], limit: 1 });
  assert.match(full, /data-build-copy="abc123def456ghi" [^>]*disabled/);
  assert.match(list, /Shared/);
  assert.match(list, /from Kai/);
  assert.match(buildsPage({ builds: [], classes: [], limit: 50 }), /knows no class yet/);

  const build = { id: 'abc123def456ghi', name: 'Boss build', class: 'Chanter', plan, share: '' };
  const edit = buildPage(build, { editable: true, catalog, signedIn: true, saving: 'saved' });
  assert.match(edit, /data-build-slot="MainHand"/);
  assert.match(edit, /data-action="build-share"/);
  assert.match(edit, /data-action="build-duplicate"/);
  assert.match(edit, /data-build-notes/);
  assert.match(edit, /build-save-slot/);
  assert.match(edit, /12 Chanters the armory keeps/);
  const skills = buildPage(build, { editable: true, catalog, tab: 'skills', signedIn: true });
  assert.match(skills, /data-build-bar="Bolt" aria-pressed="true"/);
  assert.match(skills, /data-build-level="Heal" data-step="-1" aria-label="Lower Heal" disabled/);
  const boards = buildPage(build, { editable: true, catalog, tab: 'daevanion', signedIn: true });
  assert.match(boards, /role="button" aria-pressed="true" data-build-node="3,3"/);
  assert.match(boards, /data-build-fill="71"/);
  assert.doesNotMatch(boards, /data-build-node="8,8"/, 'the start node stays open');

  const shared = { name: 'Boss build', class: 'Chanter', plan, code: 'ABCDEFGHJKLMNPQR' };
  const reader = buildPage(shared, { catalog, signedIn: true });
  assert.match(reader, /data-action="build-save-copy"/);
  assert.doesNotMatch(
    reader,
    /data-build-slot|data-build-notes|data-action="build-share"|data-action="build-duplicate"/,
  );
  assert.match(reader, /\/builds\/shared\/ABCDEFGHJKLMNPQR\/skills/);
  assert.match(buildPage(shared, { catalog, signedIn: false }), /data-action="build-sign-in"/);
  const own = buildPage({ ...shared, mine: true, id: 'abc123def456ghi' }, { catalog, signedIn: true });
  assert.match(own, /Edit this build/);
  assert.match(own, /data-action="build-duplicate"/);
  assert.match(buildPage(shared, { catalog: null }), /Loading what the armory knows/);
  assert.match(buildPage(shared, { catalog: { error: true } }), /did not load/);
  // Compare: nothing to compare with, then a character's profile.
  assert.match(buildPage(build, { catalog, tab: 'compare', compareChoices: [] }), /not made from a character/);
  const compare = buildPage(build, {
    catalog,
    tab: 'compare',
    compareChoices: [{ key: 'eu/2304/x', label: 'Kai (made from)' }],
    compareWith: 'eu/2304/x',
    compare: {
      region: 'eu',
      serverId: 2304,
      characterId: 'kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=',
      profile: { name: 'Kai', class: 'Chanter', gear: [], boards: [], skills: [] },
    },
  });
  assert.match(compare, /What <a [^>]+>Kai<\/a> still needs/);
  assert.match(compare, /Get the item/);
});

test('an item at no enchantment shows its values as the catalog has them', () => {
  const g = gearOf({ slot: 'SubHand', name: 'Orb B', grade: 'Unique', enchant: 0, exceed: 0 }, catalog);
  assert.deepEqual(g.detail.main, [{ name: 'Defense', value: '200' }]);
  assert.equal(g.detail.set.name, 'Primal Vigor');
});

test("a copy is named after its build, within a name's 60 characters", () => {
  assert.equal(copyName('Raid healer'), 'Raid healer (copy)');
  assert.equal(copyName('  Raid healer '), 'Raid healer (copy)');
  const long = copyName('Tank for Kromede with a very long name indeed, and more!!');
  assert.equal(long, 'Tank for Kromede with a very long name indeed, and m… (copy)');
  assert.equal(long.length, 60);
  // Characters outside the basic plane count twice, as the backend counts them, and stay whole.
  const wide = copyName('🐉'.repeat(40));
  assert.ok(wide.length <= 60 && !/\uD83D(?!\uDC09)/.test(wide), wide);
});
