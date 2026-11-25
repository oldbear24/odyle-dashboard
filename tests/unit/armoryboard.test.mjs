import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statCode, boardNodes, boardSummary, nodeStep } from '../../src/armoryboard.js';

test('a stat node shows the stat in a few letters, PvE, PvP or Boss above them', () => {
  assert.deepEqual(
    [
      'Attack Bonus',
      'Defense Bonus',
      'HP',
      'Critical Hit Resist',
      'PvE Critical Hit Resist',
      'pvp attack',
      'Boss Damage Tolerance',
      'Multi-hit Chance',
      'Healing Boost',
      'Status-effect power gain',
      '',
    ].map(statCode),
    [
      { prefix: '', code: 'ATK' },
      { prefix: '', code: 'DEF' },
      { prefix: '', code: 'HP' },
      { prefix: '', code: 'C.RES' },
      { prefix: 'PvE', code: 'C.RES' },
      { prefix: 'PvP', code: 'ATK' },
      { prefix: 'Boss', code: 'D.TOL' },
      { prefix: '', code: 'MULTI' },
      { prefix: '', code: 'HB' },
      { prefix: '', code: 'SEPG' },
      { prefix: '', code: '?' },
    ],
  );
});

const skills = [
  { name: 'Rending Blow', level: 12, icon: 'ICON_GL_SKILL_001.png', acquired: true, equipped: true },
  { name: 'Keen Strike', level: 3, icon: 'ICON_GL_SKILL_002.png', acquired: true, equipped: false },
];
const board = {
  nodes: [
    { r: 6, c: 7, g: 'Common', t: 'Stat', o: true, e: 'Attack Bonus +3' },
    { r: 6, c: 9, g: 'Common', t: 'Stat', e: 'Attack Bonus +3' },
    { r: 6, c: 11, g: 'Common', t: 'Stat', o: true, e: 'Attack Bonus +3' },
    { r: 7, c: 5, g: 'Legend', t: 'SkillLevel', o: true, e: 'Rending Blow +1' },
    { r: 7, c: 8, g: 'Legend', t: 'SkillLevel', e: 'rending blow +1' },
    { r: 8, c: 8, g: 'None', t: 'Start', n: 'Nezekan - Start' },
    { r: 9, c: 6, g: 'Rare', t: 'Stat', o: true, e: 'Boss Attack +3, Boss Defense +30' },
    { r: 9, c: 7, g: 'Unique', t: 'Stat', o: true, e: 'Combat Speed +1.5%' },
    { r: 9, c: 8, g: 'Unique', t: 'Stat', o: true, e: 'Combat Speed +1.5%' },
    { r: 10, c: 3, g: 'Rare', t: 'SkillLevel', o: true, e: 'Zikel Blessing +1' },
    { r: 10, c: 4, g: 'Common', t: 'Stat', o: true, e: 'HP +1,100' },
  ],
};

test("a board's nodes say what each gives and which of the character's skills it raises", () => {
  const nodes = boardNodes(board, skills);
  assert.deepEqual(nodes[0], {
    row: 6,
    col: 7,
    grade: 'Common',
    kind: 'stat',
    open: true,
    name: '',
    effects: ['Attack Bonus +3'],
    stats: [{ name: 'Attack Bonus', value: 3, percent: false, prefix: '', code: 'ATK', text: 'Attack Bonus +3' }],
    skill: null,
  });
  assert.equal(nodes[1].open, false);
  // A skill node names the skill as the profile lists it, whatever the case.
  assert.deepEqual(nodes[3].skill, { name: 'Rending Blow', levels: 1, of: skills[0] });
  assert.equal(nodes[4].skill.of, skills[0]);
  assert.deepEqual(nodes[9].skill, { name: 'Zikel Blessing', levels: 1, of: null });
  assert.deepEqual(
    [nodes[5].kind, nodes[5].name, nodes[5].stats, nodes[5].skill],
    ['start', 'Nezekan - Start', [], null],
  );
  // Two effects of one node are two stats; a value keeps its thousands.
  assert.deepEqual(
    nodes[6].stats.map(s => [s.prefix, s.code, s.value]),
    [
      ['Boss', 'ATK', 3],
      ['Boss', 'DEF', 30],
    ],
  );
  assert.equal(nodes[10].stats[0].value, 1100);
  assert.deepEqual(boardNodes({}, skills), []);
  assert.deepEqual(boardNodes({ nodes: [{ r: 1, c: 1, t: 'Stat', e: 'Restores 1,500 MP' }] })[0].stats, []);
});

test("a board's list counts each stat's and skill's nodes, open of all, and adds up the open ones", () => {
  const { stats, skills: raised } = boardSummary(boardNodes(board, skills));
  assert.deepEqual(
    stats.map(s => [s.name, s.prefix, s.code, s.open, s.total, s.value, s.percent]),
    [
      ['Attack Bonus', '', 'ATK', 2, 3, 6, false],
      ['Combat Speed', '', 'SPD', 2, 2, 3, true],
      ['Boss Attack', 'Boss', 'ATK', 1, 1, 3, false],
      ['Boss Defense', 'Boss', 'DEF', 1, 1, 30, false],
      ['HP', '', 'HP', 1, 1, 1100, false],
    ],
  );
  assert.deepEqual(
    raised.map(s => [s.name, s.open, s.total, s.levels, s.of?.icon]),
    [
      ['Rending Blow', 1, 2, 1, 'ICON_GL_SKILL_001.png'],
      ['Zikel Blessing', 1, 1, 1, undefined],
    ],
  );
  assert.deepEqual(boardSummary([]), { stats: [], skills: [] });
});

test('the arrow keys move to the nearest node that way, past gaps in its row or column', () => {
  // . A . B
  // C . D .
  // . . . E
  const nodes = [
    { row: 1, col: 2 },
    { row: 1, col: 4 },
    { row: 2, col: 1 },
    { row: 2, col: 3 },
    { row: 3, col: 4 },
  ];
  const step = (from, key) => nodeStep(nodes, from, key);
  assert.equal(step(0, 'ArrowRight'), 1);
  assert.equal(step(1, 'ArrowRight'), -1);
  assert.equal(step(0, 'ArrowLeft'), 2);
  assert.equal(step(2, 'ArrowRight'), 3);
  assert.equal(step(0, 'ArrowDown'), 2);
  assert.equal(step(1, 'ArrowDown'), 4);
  assert.equal(step(4, 'ArrowUp'), 1);
  assert.equal(step(3, 'ArrowUp'), 0);
  assert.equal(step(3, 'Home'), 0);
  assert.equal(step(0, 'End'), 4);
  assert.equal(step(0, 'Enter'), -1);
  assert.equal(nodeStep([], 0, 'Home'), -1);
});
