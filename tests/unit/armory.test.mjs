import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  armoryProfile,
  slotLabel,
  gradeClass,
  lookupLine,
  waiting,
  playncPage,
  armorySearch,
  addBookmark,
  lookupStatus,
  profileTabs,
  armoryTop,
  readBookmarks,
  removeBookmark,
  refreshBookmark,
  isBookmarked,
  bookmarkKey,
} from '../../src/armory.js';
import {
  armoryRoute,
  armoryTarget,
  profilePath,
  findPath,
  topPath,
  classBadge,
  imageUrl,
  officialPath,
} from '../../src/armorylinks.js';
import {
  upgradePlan,
  upgradeSlot,
  slotAdvice,
  slotWeight,
  mainStatsOf,
  ladderOf,
  planParts,
  gradeRank,
  rolledValue,
} from '../../src/upgrade.js';
// The armory page (#67): src/armory.js.
const now = Date.parse('2026-10-16T12:00:00Z');
// A profile as the backend keeps it (backend/odyle/armory.go), with an item's details, skills,
// titles, skins and a board's nodes.
const detail = {
  category: 'Mace',
  kind: 'Equip',
  itemLevel: 102,
  maxEnchant: 15,
  maxExceed: 5,
  equipLevel: 45,
  race: 'All',
  classes: ['Chanter'],
  main: [
    { name: 'Attack', min: '315', value: '630', extra: '174' },
    { name: 'Attack', value: '0', extra: '40', exceed: true },
  ],
  sub: [{ name: 'Combat Speed', value: '13%' }],
  subCount: 2,
  soulBind: '63.8',
  subSkills: [{ name: 'Bolt', level: 2, icon: 'ICON_EL_SKILL_004.png' }],
  stoneSlots: 2,
  stones: [{ name: 'Attack', value: '+10', grade: 'Unique', icon: 'Icon_Stone.png' }],
  godSlots: 1,
  godStones: [],
  set: {
    name: 'Primal Vigor',
    equipped: 2,
    items: [
      { name: 'Chalice of Vigor', grade: 'Unique', equipped: true },
      { name: 'Bell of Vigor', grade: 'Unique', equipped: false },
    ],
    bonuses: [
      { count: 2, effects: ['+60 PvE Attack'] },
      { count: 4, effects: ['+150 PvE Attack'] },
    ],
  },
  desc: '',
  sources: ['Crafting'],
  skins: ['Golden Vow (Mace)'],
  tradable: false,
  storable: true,
};
const profile = {
  v: 2,
  name: 'Ka<b>',
  level: 45,
  class: 'Chanter',
  race: 'Asmodians',
  gender: 'Female',
  server: 'Lumiel',
  title: 'Golden Glow',
  titleGrade: 'Unique',
  combatPower: 107458,
  itemLevel: 1671,
  portrait: 'portrait-0123456789abcdef0123456789abcdef.png',
  stats: [
    { type: 'STR', name: 'Might', value: 45, primary: true, effects: ['Attack increase +4.5%'] },
    { type: 'Justice', name: 'Justice', deity: 'Nezekan', value: 41, primary: false, effects: [] },
  ],
  gear: [
    {
      slot: 'MainHand',
      name: 'Enraged Kromede Rod',
      grade: 'Unique',
      enchant: 15,
      exceed: 3,
      icon: 'Icon_WP_MA_0078_T05.png',
      detail,
    },
    { slot: 'Helmet', name: 'Vakron Helm', grade: 'Legend', enchant: 0, exceed: 0 },
    { slot: 'Arcana3', name: 'Compass', grade: 'Legend', enchant: 0, exceed: 0 },
    { slot: 'Pet', name: 'Pagati', grade: '', enchant: 0, exceed: 0, level: 3 },
  ],
  skins: [
    { slot: 'EarringL', name: 'Gilded Wings (Earrings)', grade: 'Unique', icon: '' },
    { slot: 'MaceMain', name: 'Eternal Sun (Mace)', grade: 'Special', icon: '' },
  ],
  skills: [
    {
      name: 'Bolt',
      category: 'Active',
      level: 13,
      needLevel: 1,
      acquired: true,
      equipped: true,
      icon: 'ICON_CL_SKILL_001.png',
    },
    { name: 'Absolution', category: 'Dp', level: 0, needLevel: 22, acquired: false, equipped: false, icon: '' },
  ],
  titles: {
    owned: 94,
    total: 304,
    equipped: [
      {
        category: 'Attack',
        name: 'Guardian of Altgard',
        grade: 'Legend',
        owned: 36,
        total: 105,
        effects: ['PvE Damage Boost +3%'],
        stats: ['PvE Attack +4'],
      },
      { category: 'Etc', name: '', grade: '', owned: 27, total: 101, effects: [], stats: [] },
    ],
  },
  boards: [
    {
      id: 71,
      name: 'Nezekan',
      open: 12,
      total: 40,
      icon: '',
      nodes: [
        { r: 3, c: 3, g: 'Unique', t: 'Stat', o: true, e: 'Combat Speed +1.5%' },
        { r: 4, c: 5, g: 'Rare', t: 'SkillLevel', e: 'Bolt +1' },
      ],
      statEffects: ['Combat Speed +1.5%'],
      skillEffects: ['Bolt +1'],
    },
    { id: 74, name: 'Triniel', open: 0, total: 116, icon: '', nodes: [], statEffects: [], skillEffects: [] },
  ],
};
const images = '/api/odyle/armory-images/';
const answer = extra => ({
  region: 'eu',
  serverId: 2304,
  characterId: 'kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=',
  server: 'Lumiel',
  profile,
  fetchedAt: new Date(now - 2 * 3600000).toISOString(),
  error: '',
  state: 'fresh',
  position: 0,
  wait: 0,
  retryAfter: 0,
  lookupError: '',
  ...extra,
});

test('armory paths say what they show', async () => {
  const profileAt = profilePath({
    region: 'eu',
    serverId: 2304,
    characterId: 'kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=',
  });
  for (const path of [
    '/armory',
    profileAt,
    profileAt + '/skills',
    profileAt + '/appearance',
    profileAt + '/upgrade',
    '/armory/top',
    '/armory/top/Chanter',
    findPath('GLOBAL_EU', 'Lumiel', 'Ka'),
    findPath('GLOBAL_NA', 'Siel', 'Žluťoučký'),
    findPath('GLOBAL_NAW', 'Siel', 'Ka'),
  ])
    assert.ok(armoryRoute.test(path), path);
  for (const path of [
    '/armory/',
    '/armory/xx/2304/kdPX-_ocYSqMloiCy7IXZ0CDm',
    '/armory/eu/2304/short',
    '/armory/find/GLOBAL_XX/Lumiel/Ka',
    '/armory/eu/2304/a/b',
    profileAt + '/gear',
    profileAt + '/',
    '/armory/top/Chanter/x',
    '/armory/top/',
    '/armory/top/<b>',
  ])
    assert.ok(!armoryRoute.test(path), path);
  assert.deepEqual(
    [armoryTarget('/armory/top'), armoryTarget('/armory/top/Chanter')],
    [{ top: { class: '' } }, { top: { class: 'Chanter' } }],
  );
  assert.deepEqual(
    [topPath(), topPath('Chanter'), topPath('<b>')],
    ['/armory/top', '/armory/top/Chanter', '/armory/top'],
  );
  assert.deepEqual(armoryTarget(profileAt), {
    profile: { region: 'eu', serverId: '2304', characterId: 'kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=', tab: '' },
  });
  assert.deepEqual(armoryTarget(profileAt + '/daevanion').profile.tab, 'daevanion');
  assert.deepEqual(armoryTarget(profileAt + '/upgrade').profile.tab, 'upgrade');
  assert.equal(
    profilePath({ region: 'eu', serverId: 2304, characterId: 'abc' }, 'titles'),
    '/armory/eu/2304/abc/titles',
  );
  assert.equal(profilePath({ region: 'eu', serverId: 2304, characterId: 'abc' }, 'nonsense'), '/armory/eu/2304/abc');
  assert.deepEqual(armoryTarget(findPath('GLOBAL_NA', 'Siel', 'Žluťoučký')), {
    find: { region: 'GLOBAL_NA', server: 'Siel', name: 'Žluťoučký' },
  });
  assert.deepEqual(armoryTarget('/armory'), { search: true });
});

test('a profile shows its gear, power and stats, escaped, with where its lookup stands', async () => {
  assert.deepEqual(['MainHand', 'Earring2', 'Arcana3', 'Mystery', 'EarringL', 'MaceMain', 'OrbSub'].map(slotLabel), [
    'Main hand',
    'Earring',
    'Arcana 3',
    'Mystery',
    'Earring',
    'Main hand',
    'Off hand',
  ]);
  assert.deepEqual(['Unique', 'legend', 'weird', undefined].map(gradeClass), [
    'grade-unique',
    'grade-legend',
    'grade-common',
    'grade-common',
  ]);
  const html = armoryProfile(answer(), now, false, false, { images });
  assert.match(html, /<h1>Ka&lt;b&gt;<\/h1>/);
  assert.match(html, /<p class="armory-eyebrow">Lumiel · Europe<\/p>/);
  assert.match(html, /<span>Level 45<\/span><span>Chanter<\/span><span>Asmodians<\/span><span>Female<\/span>/);
  assert.match(html, /<dt>Combat power<\/dt><dd><strong>107,458<\/strong>/);
  assert.match(html, /<dt>Item level<\/dt><dd><strong>1,671<\/strong>/);
  assert.match(html, /<dt>Daevanion<\/dt><dd><strong>8 %<\/strong><small>12 of 156 nodes<\/small>/);
  assert.match(html, /<dt>Titles<\/dt><dd><strong>94<\/strong><small>of 304<\/small>/);
  assert.match(html, /<dt>Skills<\/dt><dd><strong>1<\/strong><small>of 2 learned<\/small>/);
  // Images come from the Odyle server only, by the names it keeps them under.
  assert.match(
    html,
    /<img class="armory-img " src="\/api\/odyle\/armory-images\/portrait-0123456789abcdef0123456789abcdef.png"/,
  );
  assert.doesNotMatch(html, /playnccdn|profileimg/);
  assert.match(
    html,
    new RegExp(
      `href="${playncPage(answer()).replace(/[.?+]/g, '\\$&')}" target="_blank" rel="noopener noreferrer">Official page ↗`,
    ),
  );
  assert.equal(
    playncPage(answer()),
    'https://aion2.plaync.com/en-us/characters/2304/kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4%3D?region=eu',
  );
  // The paper doll: every slot, empty ones said so; weapons and arcana name their type.
  assert.match(
    html,
    /<small>Main hand · Mace<\/small><strong>Enraged Kromede Rod<\/strong><span>item level 102<\/span><span class="gear-meters"/,
  );
  assert.match(html, /<small>Helmet<\/small><strong>Vakron Helm<\/strong><span>Legend<\/span>/);
  assert.match(html, /<small>Shoulders<\/small><strong>Empty<\/strong>/);
  assert.match(html, /<b class="armory-enchant">\+15<\/b><i class="armory-exceed">✦3<\/i>/);
  assert.match(html, /Arcana 3/);
  assert.match(
    html,
    /<b class="armory-enchant">Lv 3<\/b><\/span><span class="armory-gear-text"><small>Pet<\/small><strong>Pagati<\/strong>/,
  );
  // The item's card: its facts, stats, soul binding, stones (empty slots too) and set.
  assert.match(html, /<strong>\+15 Enraged Kromede Rod<\/strong><small>Unique · Mace<\/small>/);
  assert.match(html, /<dt>Enchantment<\/dt><dd>\+15 \/ 15<\/dd>/);
  assert.match(html, /<dt>Exceed<\/dt><dd>3 \/ 5<\/dd>/);
  assert.match(
    html,
    /<li><span>Attack<\/span><b>315 ~ 630 <em>\(\+174\)<\/em><\/b><\/li><li class="is-exceed"><span>Attack<\/span><b>40<\/b><\/li>/,
  );
  assert.match(html, /<h4>Soul binding <em>63.8%<\/em><\/h4>/);
  assert.match(html, /<span>Bolt<\/span><b>\+2<\/b>/);
  assert.match(
    html,
    /<h4>Manastone engraving<\/h4><ul class="armory-stones"><li class="grade-unique"><img [^>]*Icon_Stone.png[^>]*><span>Attack \+10<\/span><\/li><li class="is-open"><i class="armory-stone-art"><\/i><span>Empty slot<\/span><\/li><\/ul>/,
  );
  assert.match(html, /<h4>Theostone engraving<\/h4><ul class="armory-stones"><li class="is-open">/);
  assert.match(html, /<h4>Set: Primal Vigor <span>2 \/ 2<\/span><\/h4>/);
  assert.match(
    html,
    /<li class="is-on"><b>2 pieces<\/b><span>\+60 PvE Attack<\/span><\/li><li class=""><b>4 pieces<\/b>/,
  );
  assert.match(
    html,
    /<span>Skin: Golden Vow \(Mace\)<\/span><span>How to obtain: Crafting<\/span><span>Not tradable<\/span>/,
  );
  assert.match(html, /<small>2 pieces: \+60 PvE Attack<\/small>/);
  // Stats with what they give.
  assert.match(html, /<span>Might<\/span><strong>45<\/strong><\/div><ul><li>Attack increase \+4.5%<\/li><\/ul>/);
  assert.match(html, /Justice<small>Nezekan<\/small>/);
  assert.match(html, /Data from PLAYNC 2h ago/);
  // The tabs, the first one shown.
  assert.match(
    html,
    /<nav class="armory-tabs"[^>]*><a href="#\/armory\/eu\/2304\/kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=" aria-current="page">Gear &amp; stats<\/a><a href="#\/armory\/eu\/2304\/kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=\/skills">Skills<\/a><a [^>]*>Daevanion<\/a><a [^>]*>Titles<\/a><a [^>]*>Appearance<\/a><a [^>]*>Upgrade<\/a><\/nav>/,
  );
  assert.doesNotMatch(html, /armory-refresh/);
  assert.match(armoryProfile(answer(), now, true), /data-action="armory-refresh"/);
  // Waiting for PLAYNC: the kept copy stays, with the queue.
  const queued = answer({ state: 'queued', position: 3, wait: 17, retryAfter: 15 });
  assert.equal(lookupLine(queued, now), 'Fetching from PLAYNC · about 17 s, 3 characters ahead');
  assert.ok(waiting(queued) && !waiting(answer()));
  assert.equal(lookupLine(answer({ state: 'queued', position: 0, wait: 3 }), now), 'Fetching from PLAYNC · about 3 s');
  assert.equal(
    lookupLine(answer({ state: 'failed', lookupError: 'PLAYNC refused the lookup for now.', retryAfter: 590 }), now),
    'PLAYNC did not answer (PLAYNC refused the lookup for now.). Odyle tries again in 10 min.',
  );
  assert.equal(
    lookupLine(answer({ state: 'paused', profile: null, fetchedAt: '' }), now),
    'The armory is paused for now. Try again later.',
  );
  // Not kept yet: the page waits for it.
  const first = armoryProfile(answer({ profile: null, fetchedAt: '', state: 'fetching', retryAfter: 2 }), now, false);
  assert.match(first, /A character on Lumiel/);
  assert.match(first, /armory-spinner/);
});

test('a class shows its emblem where the server keeps one: profile, search, bookmarks', async () => {
  assert.equal(
    classBadge(images, 'class_icon_chanter.png', 'Chanter'),
    '<img class="class-icon" src="/api/odyle/armory-images/class_icon_chanter.png" alt="" title="Chanter" loading="lazy" decoding="async" draggable="false">',
  );
  assert.deepEqual(
    [classBadge(images, '', 'Chanter'), classBadge(images, '../x.png', 'Chanter'), classBadge(images, undefined)],
    ['', '', ''],
  );
  const shown = answer({ classIcon: 'class_icon_chanter.png' });
  assert.match(
    armoryProfile(shown, now, false, false, { images }),
    /<span>Level 45<\/span><span><img class="class-icon" src="\/api\/odyle\/armory-images\/class_icon_chanter.png" alt="" title="Chanter"[^>]*>Chanter<\/span><span>Asmodians<\/span>/,
  );
  assert.match(armoryProfile(answer(), now, false, false, { images }), /<span>Level 45<\/span><span>Chanter<\/span>/);
  const regions = [{ region: 'GLOBAL_EU', elyos: ['Siel'], asmodian: ['Lumiel'] }];
  const hits = [
    {
      name: 'Ka',
      level: 45,
      race: 2,
      server: 'Lumiel',
      serverId: 2304,
      region: 'eu',
      characterId: 'kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=',
      class: 'Chanter',
      classIcon: 'class_icon_chanter.png',
    },
    {
      name: 'Kb',
      level: 12,
      race: 1,
      server: 'Lumiel',
      serverId: 2304,
      region: 'eu',
      characterId: 'QXJtb3JlcklkMDAwMDAwMDAwMDAwMDAwMDAwMDA=',
      class: '',
      classIcon: '',
    },
  ];
  const page = armorySearch(regions, {}, hits, false, addBookmark([], shown, 'now'), now, images);
  assert.match(
    page,
    /<span>Level 45 · <img class="class-icon" [^>]*title="Chanter"[^>]*>Chanter · Asmodians · Lumiel<\/span>/,
  );
  assert.match(page, /<span>Level 12 · Elyos · Lumiel<\/span>/);
  assert.match(
    page,
    /<strong>Ka&lt;b&gt;<\/strong><span><img class="class-icon" [^>]*>Level 45 · Chanter · Lumiel<\/span>/,
  );
});

test('a running lookup shows its step and a progress bar, and the profile read so far', async () => {
  const running = (progress, extra = {}) => answer({ state: 'fetching', retryAfter: 2, progress, ...extra });
  assert.equal(
    lookupLine(running({ step: 'profile', done: 1, total: 2, percent: 3 }), now),
    'Reading the character page…',
  );
  assert.equal(
    lookupLine(running({ step: 'images', done: 12, total: 1200, percent: 20 }), now),
    'Downloading icons · 12 of 1,200',
  );
  assert.equal(
    lookupLine(running({ step: 'items', done: 5, total: 20, percent: 40 }), now),
    'Reading item details · 5 of 20',
  );
  assert.equal(
    lookupLine(running({ step: 'boards', done: 0, total: 4, percent: 90 }), now),
    'Reading Daevanion boards · 0 of 4',
  );
  assert.equal(lookupLine(running(null), now), 'Fetching from PLAYNC now…');
  const status = lookupStatus(running({ step: 'items', done: 5, total: 20, percent: 40 }), now, false);
  assert.match(
    status,
    /<div class="armory-status is-waiting" role="status"><span class="armory-spinner" aria-hidden="true"><\/span><span>Reading item details · 5 of 20<span class="armory-track armory-progress" role="progressbar" aria-label="Lookup progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="40"><i style="width:40%"><\/i><\/span><\/span><\/div>/,
  );
  assert.match(
    lookupStatus(running({ step: 'items', percent: 250 }), now, false),
    /aria-valuenow="100"><i style="width:100%">/,
  );
  // Queued, kept or failed: no bar.
  for (const extra of [
    { state: 'queued', position: 1, wait: 50, progress: null },
    {},
    { state: 'failed', lookupError: 'x', retryAfter: 600 },
  ])
    assert.doesNotMatch(lookupStatus(answer(extra), now, false), /progressbar/);
  // The profile read so far: items and boards say their details are on their way.
  const partial = {
    ...profile,
    gear: profile.gear.map(({ detail: _, ...g }) => g),
    boards: profile.boards.map(b => ({ ...b, nodes: [], statEffects: [], skillEffects: [] })),
  };
  const reading = running(
    { step: 'items', done: 0, total: 2, percent: 20 },
    { profile: partial, partial: true, fetchedAt: '' },
  );
  const gear = armoryProfile(reading, now, false, false, { images });
  assert.match(
    gear,
    /<small>Main hand<\/small><strong>Enraged Kromede Rod<\/strong><span>Unique · exceed 3<\/span>[\s\S]*?Odyle is reading this item's details from PLAYNC…/,
  );
  assert.match(gear, /progressbar/);
  assert.match(
    armoryProfile(reading, now, false, false, { images, tab: 'daevanion' }),
    /Odyle is reading this board from PLAYNC…/,
  );
  // Kept without them, the profile says PLAYNC gave none.
  const kept = armoryProfile(answer({ profile: partial }), now, false, false, { images, tab: 'daevanion' });
  assert.match(kept, /PLAYNC did not list this board's nodes\./);
  assert.doesNotMatch(armoryProfile(answer({ profile: partial }), now, false, false, { images }), /reading this item/);
});

test("a profile's tabs show its skills, Daevanion boards, titles and appearance", async () => {
  const view = (tab, extra = {}) => armoryProfile(answer(), now, false, false, { images, tab, ...extra });
  const skills = view('skills');
  assert.match(skills, /aria-current="page">Skills<\/a>/);
  assert.match(skills, /<h2>Active skills <span>1 \/ 1<\/span><\/h2>/);
  assert.match(
    skills,
    /<li class="armory-skill is-equipped" tabindex="0" aria-label="Bolt, Level 13, On the skill bar">/,
  );
  assert.match(skills, /<dt>From gear<\/dt><dd>\+2<\/dd><\/div><div><dt>From Daevanion<\/dt><dd>\+1<\/dd>/);
  assert.match(skills, /<h2>Stigma skills <span>0 \/ 1<\/span><\/h2>/);
  assert.match(skills, /armory-skill is-locked" tabindex="0" aria-label="Absolution, Level 0, Not learned yet"/);
  // Daevanion: the first board with open nodes, its nodes from its first row and column on.
  const boards = view('daevanion');
  assert.match(boards, /data-armory-board="71" aria-pressed="true"/);
  assert.match(boards, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\);grid-template-rows:repeat\(2,auto\)/);
  assert.match(
    boards,
    /<span class="armory-node grade-unique is-stat is-open" style="grid-row:1;grid-column:1" title="Combat Speed \+1.5%"><\/span>/,
  );
  assert.match(
    boards,
    /<span class="armory-node grade-rare is-skilllevel" style="grid-row:2;grid-column:3" title="Bolt \+1 · closed"><\/span>/,
  );
  assert.match(boards, /<h4>Skill effect<\/h4><ul><li>Bolt \+1<\/li><\/ul>/);
  assert.match(view('daevanion', { board: '74' }), /No node of this board is open yet\./);
  // Titles: the one worn in each category, with what it gives.
  const titles = view('titles');
  assert.match(titles, /<strong>94 <small>\/ 304<\/small><\/strong>/);
  assert.match(
    titles,
    /<span>Offensive<\/span><small>36 \/ 105<\/small>[\s\S]*<strong class="grade-legend">Guardian of Altgard<\/strong><h4>When worn<\/h4><ul><li>PvE Damage Boost \+3%<\/li><\/ul><h4>Title stats<\/h4>/,
  );
  assert.match(titles, /<span>Other<\/span>[\s\S]*No title worn/);
  const appearance = view('appearance');
  assert.match(appearance, /<h2>Skins <span>2<\/span><\/h2>/);
  assert.match(appearance, /<small>Earring<\/small><strong>Gilded Wings \(Earrings\)<\/strong>/);
  assert.match(appearance, /<small>Main hand<\/small><strong>Eternal Sun \(Mace\)<\/strong>/);
  // A profile kept before the armory kept everything shows its gear and stats only.
  const old = {
    name: 'Old',
    level: 45,
    combatPower: 1,
    itemLevel: 1,
    stats: [],
    gear: [{ slot: 'MainHand', name: 'Rod', grade: 'Unique', enchant: 15, exceed: 3 }],
    boards: [{ name: 'Nezekan', open: 12, total: 40 }],
  };
  assert.deepEqual(
    profileTabs({ ...old, skills: [], skins: [], titles: {} }).map(([key]) => key),
    ['', 'daevanion'],
  );
  const shown = armoryProfile(answer({ profile: old }), now, false, false, { images, tab: 'skills' });
  assert.match(shown, /aria-current="page">Gear &amp; stats/);
  assert.match(shown, /<small>Main hand<\/small><strong>Rod<\/strong><span>Unique · exceed 3<\/span>/);
  assert.match(shown, /<span class="armory-icon {2}grade-unique is-empty"/);
  // Only names the backend keeps images under become addresses.
  assert.deepEqual(
    ['a.png', 'portrait-x.jpg', '../x.png', 'x.gif', '', null, 'a b.png'].map(name => imageUrl(images, name)),
    [images + 'a.png', images + 'portrait-x.jpg', '', '', '', '', ''],
  );
});

// What a group of stronger Chanters wears (backend/odyle/upgrades.go): the next step of this one.
const strongest = (name, combatPower, n) => ({
  name,
  level: 45,
  server: 'Siel',
  region: 'nae',
  serverId: 1101,
  characterId: `VG9wVG9wVG9wVG9wVG9w${n}A==`,
  combatPower,
  itemLevel: 1800,
  portrait: '',
});
const rung = (name, grade, itemLevel, count, extra = {}) => ({
  name,
  grade,
  icon: '',
  category: '',
  count,
  enchant: 0,
  exceed: 0,
  itemLevel,
  maxEnchant: 0,
  maxExceed: 0,
  main: [],
  sources: [],
  ...extra,
});
const slotOf = (slot, players, items, ladder, extra = {}) => ({
  slot,
  players,
  items,
  grade: ladder[0]?.grade || '',
  itemLevel: ladder[0]?.itemLevel || 0,
  enchant: 0,
  exceed: 0,
  stones: 0,
  stoneSlots: 0,
  stoneNames: [],
  stoneGrade: '',
  popular: [...ladder].sort((a, b) => b.count - a.count).slice(0, 3),
  ladder,
  rolledItems: 0,
  rolled: [],
  boostItems: 0,
  boosts: [],
  ...extra,
});
const dragonLord = rung('Dragon Lord Mace', 'Mythic', 120, 4, {
  icon: 'Icon_Mace.png',
  enchant: 15,
  maxEnchant: 15,
  maxExceed: 5,
  main: [{ name: 'Attack', percent: false, value: 1000 }],
  sources: ['Crafting', "Dragon Lord's Refuge"],
});
const reference = {
  class: 'Chanter',
  group: 'next',
  excluded: 2,
  sample: 10,
  players: [strongest('Top<i>', 150000, 1), strongest('Second', 120000, 2), strongest('Third', 110000, 3)],
  combatPowers: [150000, 120000, 110000],
  combatPower: { median: 120000, low: 110000, high: 150000 },
  itemLevel: { median: 1750, low: 1600, high: 1800 },
  slots: [
    slotOf(
      'MainHand',
      10,
      10,
      [
        dragonLord,
        rung('Enraged Kromede Rod', 'Unique', 102, 5, { enchant: 15, exceed: 5, maxEnchant: 15, maxExceed: 5 }),
        rung('Old Rod', 'Legend', 80, 1),
      ],
      { enchant: 15, exceed: 5 },
    ),
    slotOf('Helmet', 10, 10, [
      rung('Nuakum Helm', 'Unique', 86, 8, { enchant: 12, sources: ['Expedition'] }),
      rung('Vakron Helm', 'Legend', 70, 2),
    ]),
    slotOf('Earring', 10, 20, [rung('Berk Earrings', 'Unique', 54, 20, { enchant: 10, sources: ['Expedition'] })]),
    slotOf(
      'Ring',
      10,
      20,
      [rung('Kromede Ring', 'Unique', 86, 18, { enchant: 13, exceed: 2, maxEnchant: 15, maxExceed: 5 })],
      {
        enchant: 13,
        exceed: 2,
        stoneGrade: 'Unique',
        stoneNames: [
          { name: 'Attack', count: 30 },
          { name: 'Critical Hit', count: 20 },
        ],
        rolledItems: 18,
        rolled: [
          { name: 'Critical Hit', percent: false, count: 12, value: 40 },
          { name: 'Accuracy', percent: false, count: 3, value: 80 },
        ],
      },
    ),
    slotOf('Arcana1', 10, 10, [rung('Chalice of Vigor', 'Unique', 80, 9, { set: 'Primal Vigor', enchant: 4 })], {
      enchant: 4,
      boostItems: 9,
      boosts: [
        { name: 'Bolt', icon: '', count: 9, level: 4 },
        { name: 'Storm', icon: '', count: 5, level: 2 },
      ],
    }),
    slotOf(
      'Arcana2',
      10,
      10,
      [
        rung('Parchment of Vigor', 'Unique', 80, 6, { set: 'Primal Vigor', enchant: 4 }),
        rung('Parchment of Magic', 'Unique', 80, 4, { set: 'Magic Armor', enchant: 4 }),
      ],
      { enchant: 4 },
    ),
    slotOf('Arcana3', 1, 1, [rung('Compass', 'Legend', 0, 1)]),
  ],
  sets: [
    {
      name: 'Primal Vigor',
      players: 10,
      pieces: 3,
      bonuses: [
        { count: 2, effects: ['+60 PvE Attack'] },
        { count: 4, effects: ['+150 PvE Attack'] },
      ],
    },
    { name: 'Magic Armor', players: 6, pieces: 2, bonuses: [] },
  ],
  boards: [
    { name: 'Nezekan', players: 10, open: 30, total: 40 },
    { name: 'Triniel', players: 10, open: 20, total: 116 },
  ],
  skills: [
    { name: 'Bolt', category: 'Active', icon: '', players: 10, level: 15 },
    { name: 'Heal', category: 'Active', icon: '', players: 8, level: 9 },
    { name: 'Absolution', category: 'Dp', icon: '', players: 6, level: 10 },
    { name: 'Seldom', category: 'Active', icon: '', players: 0, level: 1 },
  ],
  arcanaPlayers: 10,
  arcanaSkills: [
    { name: 'Bolt', icon: '', count: 10, level: 8 },
    { name: 'Storm', icon: '', count: 6, level: 3 },
  ],
  gearPlayers: 10,
  gearSkills: [{ name: 'Bolt', icon: '', count: 8, level: 2 }],
  builtAt: '2026-10-16T11:55:00.000Z',
};
// The profile with two rings and two arcana of another set, and a skill learned but off its bar.
const ring = (slot, enchant, extra) => ({
  slot,
  name: 'Kromede Ring',
  grade: 'Unique',
  enchant,
  exceed: 0,
  icon: '',
  detail: {
    itemLevel: 86,
    maxEnchant: 15,
    maxExceed: 5,
    main: [{ name: 'Attack', value: '50', extra: String(enchant * 3) }],
    sub: [],
    stoneSlots: 3,
    stones: [],
    subSkills: [],
    ...extra,
  },
});
const magic = (slot, name, skill) => ({
  slot,
  name,
  grade: 'Unique',
  enchant: 4,
  exceed: 0,
  icon: '',
  detail: {
    itemLevel: 80,
    maxEnchant: 5,
    main: [],
    sub: [],
    stoneSlots: 0,
    stones: [],
    subSkills: [skill],
    set: {
      name: 'Magic Armor',
      equipped: 2,
      items: [],
      bonuses: [
        { count: 2, effects: ['Magic +1'] },
        { count: 4, effects: ['Magic +2'] },
      ],
    },
  },
});
const upgraded = {
  ...profile,
  gear: [
    ...profile.gear.filter(g => g.slot !== 'Arcana3'),
    ring('Ring1', 10, { stones: [{ name: 'Attack', grade: 'Legend' }] }),
    ring('Ring2', 15, {
      stones: [{}, {}, {}].map(() => ({ name: 'Attack', grade: 'Unique' })),
      sub: [{ name: 'Critical Hit', value: '40' }],
    }),
    magic('Arcana1', 'Chalice of Magic', { name: 'Bolt', level: 3 }),
    magic('Arcana2', 'Parchment of Magic', { name: 'Heal', level: 1 }),
    profile.gear.find(g => g.slot === 'Arcana3'),
  ],
  skills: [
    ...profile.skills,
    { name: 'Heal', category: 'Active', level: 5, acquired: true, equipped: false, icon: '' },
  ],
};

test('the upgrade plan says what to do in each slot to catch up with the group', async () => {
  assert.deepEqual(
    ['MainHand', 'Earring2', 'Ring1', 'Bracelet2', 'Rune1', 'Arcana3', 'Pet', 'Wings'].map(upgradeSlot),
    ['MainHand', 'Earring', 'Ring', 'Bracelet', 'Rune', 'Arcana3', '', 'Wings'],
  );
  assert.deepEqual(['Common', 'Legend', 'Mythic', 'Special', undefined].map(gradeRank), [1, 3, 6, 0, 0]);
  assert.deepEqual(['MainHand', 'Helmet', 'Bracelet', 'Arcana2', 'Wings'].map(slotWeight), [1.6, 1, 0.7, 0.6, 0.5]);
  // Main stats: value and extra summed, an exceed line's extra too; a share and a number apart.
  assert.deepEqual([...mainStatsOf(detail)], [['Attack|', 844]]);
  const plan = upgradePlan(upgraded, reference);
  const row = slot => plan.rows.find(r => (r.item?.slot || r.slot) === slot);
  // The main hand: a good share of them moved on to the Dragon Lord Mace, so a new item, not more
  // enchanting; what it adds as they have it.
  const main = row('MainHand');
  assert.equal(main.next.name, 'Dragon Lord Mace');
  assert.equal(main.goal, null);
  assert.deepEqual(
    main.actions.map(a => [a.kind, a.itemLevel, a.grade, a.stats, Math.round(a.value)]),
    [['replace', { from: 102, to: 120 }, 2, [{ name: 'Attack', percent: false, value: 156 }], 96]],
  );
  assert.equal(main.state, 'big');
  // The helmet without details: its own rung's item level.
  assert.deepEqual(
    row('Helmet').actions.map(a => [a.kind, a.target.name, a.itemLevel, a.grade]),
    [['replace', 'Nuakum Helm', { from: 70, to: 86 }, 1]],
  );
  // A ring worth keeping: enchanted as far as they take it (what that adds, from what its
  // enchantment adds now), its empty stone slots, a stone below their grade, the stat most roll.
  assert.deepEqual(
    row('Ring1').actions.map(a => [a.kind, Math.round(a.value)]),
    [
      ['enchant', 9],
      ['stones', 4],
      ['reroll', 3],
      ['stoneGrade', 1],
    ],
  );
  const ringActions = row('Ring1').actions;
  assert.deepEqual(
    [ringActions[0].from, ringActions[0].to, ringActions[0].max, ringActions[0].stats],
    [10, 13, 15, [{ name: 'Attack', percent: false, value: 9 }]],
  );
  assert.deepEqual(ringActions[1].names, ['Attack', 'Critical Hit']);
  assert.deepEqual(ringActions[2].stats, [
    { name: 'Critical Hit', percent: false, theirs: 40, mine: null, share: 12 / 18 },
  ]);
  // The other ring is at its enchantment's limit: exceed levels next.
  assert.deepEqual(
    row('Ring2').actions.map(a => [a.kind, a.from, a.to, a.max, a.after]),
    [['exceed', 0, 2, 5, false]],
  );
  // No earrings: both places to fill.
  assert.deepEqual(
    plan.rows.filter(r => r.ref.slot === 'Earring').map(r => [r.actions[0].kind, r.score]),
    [
      ['fill', 100],
      ['fill', 100],
    ],
  );
  // The plan: one step for both earrings, the skill most keep on their bar, the boards behind.
  const steps = part => plan.steps[part].map(s => [s.kind, s.slot, s.entries.length, Math.round(s.value)]);
  assert.deepEqual(planParts, ['quick', 'gear', 'enchant', 'polish', 'goal']);
  assert.deepEqual(steps('quick'), [
    ['fill', 'Earring', 2, 150],
    ['skill', '', 1, 5],
    ['stones', 'Ring', 1, 4],
  ]);
  assert.deepEqual(steps('gear'), [
    ['replace', 'MainHand', 1, 96],
    ['replace', 'Helmet', 1, 52],
  ]);
  assert.deepEqual(steps('enchant'), [
    ['enchant', 'Ring', 1, 9],
    ['exceed', 'Ring', 1, 8],
  ]);
  assert.deepEqual(steps('polish'), [
    ['reroll', 'Ring', 1, 3],
    ['stoneGrade', 'Ring', 1, 1],
  ]);
  assert.deepEqual(
    plan.steps.goal.map(s => [s.kind, s.entries[0].action.board?.name]),
    [
      ['board', 'Triniel'],
      ['board', 'Nezekan'],
    ],
  );
  // The arcana: they wear 3 Primal Vigor and 2 Magic Armor; this one 2 Magic Armor (and the main
  // hand's 2 Primal Vigor), with the next bonus of each; both arcana are of the other set.
  assert.deepEqual(
    plan.arcana.usual.map(s => [s.name, s.pieces]),
    [
      ['Primal Vigor', 3],
      ['Magic Armor', 2],
    ],
  );
  assert.deepEqual(
    plan.arcana.sets.map(s => [s.name, s.mine, s.on.map(b => b.count), s.next?.count]),
    [
      ['Primal Vigor', 2, [2], 4],
      ['Magic Armor', 2, [2], 4],
    ],
  );
  assert.deepEqual(
    plan.arcana.swaps.map(s => [s.slot, s.from.name, s.to.name]),
    [
      ['Arcana1', 'Chalice of Magic', 'Chalice of Vigor'],
      ['Arcana2', 'Parchment of Magic', 'Parchment of Vigor'],
    ],
  );
  assert.deepEqual(
    plan.arcana.places[0].boosts.map(b => [b.name, b.level, b.mine, b.share]),
    [
      ['Bolt', 4, 3, 1],
      ['Storm', 2, 0, 5 / 9],
    ],
  );
  // The skills arcana and other gear raise, summed: theirs against this one's.
  assert.deepEqual(
    plan.boosts.arcana.map(b => [b.name, b.players, b.level, b.mine]),
    [
      ['Bolt', 10, 8, 3],
      ['Storm', 6, 3, 0],
      ['Heal', 0, 0, 1],
    ],
  );
  assert.deepEqual(
    plan.boosts.gear.map(b => [b.name, b.level, b.mine]),
    [['Bolt', 2, 2]],
  );
  assert.deepEqual([plan.group, plan.sample, plan.excluded], ['next', 10, 2]);
  // Its place: below the three named, among ten.
  assert.deepEqual([plan.place, plan.below], [4, false]);
  assert.deepEqual(
    [plan.combatPower.mine, plan.combatPower.gap, plan.itemLevel.gap],
    [107458, 120000 - 107458, 1750 - 1671],
  );
  assert.deepEqual(
    plan.skills.map(s => [s.name, s.equipped, s.acquired, s.mine]),
    [
      ['Bolt', true, true, 13],
      ['Heal', false, true, 5],
      ['Absolution', false, false, 0],
    ],
  );
  // A backend without ladders: the items worn most, the highest item level first.
  const old = { ...reference.slots[0], ladder: undefined };
  assert.deepEqual(
    ladderOf(old).map(r => r.name),
    ['Dragon Lord Mace', 'Enraged Kromede Rod', 'Old Rod'],
  );
  assert.equal(slotAdvice(upgraded.gear[0], old, 10).next.name, 'Dragon Lord Mace');
  // Few of them moved on: the best they wear is a goal, and the item is taken further.
  const few = {
    ...reference.slots[0],
    items: 100,
    ladder: [{ ...dragonLord, count: 5 }, ...reference.slots[0].ladder.slice(1)],
  };
  const kept = slotAdvice({ ...upgraded.gear[0], exceed: 3 }, few, 10);
  assert.deepEqual(
    kept.actions.map(a => [a.kind, a.target?.name || a.to || a.empty]),
    [
      ['exceed', 5],
      ['stones', 1],
      ['goal', 'Dragon Lord Mace'],
    ],
  );
  // Too few to compare with; an empty place few of the group fill counts for nothing.
  assert.equal(upgradePlan(profile, { ...reference, sample: 2 }), null);
  assert.equal(upgradePlan(profile, null), null);
  assert.equal(slotAdvice(null, reference.slots[6], 10).score, 0);
  // Some items come in two grades under one name: the Unique one is a step up from the Legend one.
  const belts = slotOf('Belt', 10, 10, [
    rung('Noble Belt', 'Unique', 65, 9, { enchant: 10 }),
    rung('Noble Belt', 'Legend', 36, 1),
  ]);
  assert.deepEqual(
    slotAdvice(
      { slot: 'Belt', name: 'Noble Belt', grade: 'Legend', enchant: 0, detail: { itemLevel: 36, maxEnchant: 10 } },
      belts,
      10,
    ).actions.map(a => [a.kind, a.itemLevel]),
    [['replace', { from: 36, to: 65 }]],
  );
  // Rolled stats: values as PLAYNC writes them.
  assert.deepEqual(['13%', '+120', '1,200', '-2.5%', '?', undefined].map(rolledValue), [
    { value: 13, percent: true },
    { value: 120, percent: false },
    { value: 1200, percent: false },
    { value: -2.5, percent: true },
    null,
    null,
  ]);
});

test('the upgrade tab shows the plan, the arcana, the skills gear raises, every slot, boards and skill bars', async () => {
  const view = (upgrade, upgradeGroup = 'next', p = upgraded) =>
    armoryProfile(answer({ profile: p }), now, false, false, { images, tab: 'upgrade', upgrade, upgradeGroup });
  assert.ok(profileTabs(profile).some(([key]) => key === 'upgrade'));
  assert.ok(
    !profileTabs({ ...profile, class: '' }).some(([key]) => key === 'upgrade'),
    'nothing to compare without a class',
  );
  const html = view(reference);
  assert.match(
    html,
    /<a href="#\/armory\/eu\/2304\/kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=\/upgrade" aria-current="page">Upgrade<\/a>/,
  );
  // The group: the next step, chosen; the strongest a button away.
  assert.match(
    html,
    /<div class="upgrade-groups" role="group" aria-label="Compare with"><button type="button" class="is-active" data-armory-upgrade-group="next" aria-pressed="true">The next step<\/button><button type="button" class="" data-armory-upgrade-group="top" aria-pressed="false">The strongest<\/button><\/div>/,
  );
  assert.match(
    html,
    /<p>Compared with 10 Chanter characters a step above, from every Global region: what they did that this character has not yet\.<\/p>/,
  );
  assert.match(
    html,
    /<dt>Combat power<\/dt><dd><strong>107,458<\/strong><small>their median 120,000 \(−12,542\)<\/small>/,
  );
  assert.match(html, /<dt>The next step<\/dt><dd><strong>110,000–150,000<\/strong><small>combat power<\/small>/);
  assert.match(html, /2 characters left out: their combat power does not match their item level\./);
  assert.match(
    html,
    /<summary>The strongest 3 of them<\/summary><ol class="upgrade-players"><li><a href="#\/armory\/nae\/1101\/VG9wVG9wVG9wVG9wVG9w1A=="><span class="armory-mini" aria-hidden="true">TO<\/span><strong>Top&lt;i&gt;<\/strong>/,
  );
  assert.doesNotMatch(html, /Top<i>/);
  // The plan, part by part.
  const part = name =>
    html.match(new RegExp(`<div class="upgrade-part is-${name}">([\\s\\S]*?)</ol>(?:<details|</div>)`))?.[1] || '';
  assert.match(part('quick'), /<h3>Quick wins <span>3<\/span><\/h3>/);
  assert.match(
    part('quick'),
    /<li class="upgrade-step is-big is-fill"><div class="upgrade-step-head"><small>Earring · 2×<\/small><h4>Fill it: Berk Earrings<\/h4><span class="upgrade-badge">Big upgrade<\/span><\/div>[\s\S]*?<strong>Empty<\/strong>[\s\S]*?<strong>Berk Earrings<\/strong><small>100 % of them · usually \+10 · item level 54<\/small>[\s\S]*?<li>How to obtain: Expedition<\/li>/,
  );
  assert.match(
    part('quick'),
    /<h4>Engrave 2 empty stone slots<\/h4>[\s\S]*?<li>They engrave: Attack, Critical Hit<\/li>/,
  );
  assert.match(
    part('quick'),
    /<h4>Put Heal on your skill bar<\/h4>[\s\S]*?<li>80 % of them keep it on their bar, level 9; yours is level 5<\/li>/,
  );
  assert.match(
    part('gear'),
    /<small>Main hand<\/small><h4>Replace with Dragon Lord Mace<\/h4>[\s\S]*?<strong>\+15 Enraged Kromede Rod<\/strong><small>Unique · item level 102<\/small>[\s\S]*?<strong>Dragon Lord Mace<\/strong><small>40 % of them · usually \+15 · item level 120<\/small>/,
  );
  assert.match(
    part('gear'),
    /<li>Item level 102 → 120 \(\+18\)<\/li><li>Grade Unique → Mythic<\/li><li>As they have it: Attack \+156<\/li><li>They enchant it to \+15 of \+15<\/li><li>How to obtain: Crafting, Dragon Lord&#39;s Refuge<\/li>/,
  );
  assert.match(part('gear'), /src="\/api\/odyle\/armory-images\/Icon_Mace.png"/);
  assert.match(
    part('enchant'),
    /<h4>Enchant \+10 → \+13<\/h4>[\s\S]*?<span class="upgrade-meter" role="img" aria-label="Enchantment \+10 → \+13 of \+15">(<i class="is-have"><\/i>){10}(<i class="is-to"><\/i>){3}(<i><\/i>){2}<\/span><b>\+10 → \+13<\/b>[\s\S]*?<li>About Attack \+9<\/li>/,
  );
  assert.match(part('enchant'), /<h4>Exceed 0 → 2<\/h4>/);
  assert.match(
    part('polish'),
    /<h4>Reroll the soul binding<\/h4>[\s\S]*?<li>Critical Hit: none → 40 \(67 % of them\)<\/li>/,
  );
  assert.match(part('polish'), /<h4>Better stones<\/h4>[\s\S]*?<li>1 stone below their usual Unique<\/li>/);
  assert.match(part('goal'), /<h4>Open more of Nezekan<\/h4>[\s\S]*?<li>12 of 40 nodes · they open 30<\/li>/);
  // The arcana: their sets, this one's, the bonuses, the swaps and each arcana's skills.
  assert.match(
    html,
    /<h3>They wear<\/h3><ul class="upgrade-chips"><li><b>3×<\/b> Primal Vigor <small>100 % of them<\/small><\/li><li><b>2×<\/b> Magic Armor <small>60 % of them<\/small><\/li><\/ul>/,
  );
  assert.match(
    html,
    /<ul class="upgrade-chips is-mine"><li><b>2×<\/b> Primal Vigor<\/li><li><b>2×<\/b> Magic Armor<\/li><\/ul>/,
  );
  assert.match(html, /<span class="is-next">2 more pieces \(4 pieces\): \+150 PvE Attack<\/span>/);
  assert.match(html, /<li>Arcana 1: Chalice of Magic \(Magic Armor\) → Chalice of Vigor \(Primal Vigor\)<\/li>/);
  assert.match(
    html,
    /<ul class="upgrade-boost-list" aria-label="Skills it raises"><li class="is-behind"><span>Bolt<\/span><small>\+4 · 100 % of them<\/small><b>\+3<\/b><\/li><li class="is-missing"><span>Storm<\/span><small>\+2 · 56 % of them<\/small><b>–<\/b><\/li>/,
  );
  // The skills gear raises.
  assert.match(
    html,
    /<h2>Skills raised by gear<\/h2>[\s\S]*?<h3>From arcana<\/h3>[\s\S]*?<li class="is-extra"><span>Heal<\/span><small>only yours<\/small><b>\+1<\/b><\/li>[\s\S]*?<h3>From other gear<\/h3><ul class="upgrade-boost-list"><li class="is-even"><span>Bolt<\/span><small>\+2 · 80 % of them<\/small><b>\+2<\/b>/,
  );
  // Every slot, the boards and the skill bars.
  assert.match(
    html,
    /<li class="upgrade-row is-big"><div class="upgrade-row-slot"><small>Main hand<\/small>[\s\S]*?<small>Next step<\/small>[\s\S]*?<small>Replace with Dragon Lord Mace<\/small><\/div><\/li>/,
  );
  assert.match(
    html,
    /<ul class="upgrade-boards"><li class="is-behind"><span><strong>Triniel<\/strong><small>0 of 116 nodes · they open 20<\/small>/,
  );
  assert.match(
    html,
    /<li class="is-equipped">[\s\S]*?<strong>Bolt<\/strong><small>10 of 10, level 15 · on your bar, level 13<\/small>/,
  );
  assert.doesNotMatch(html, /Seldom/);
  assert.match(html, /The next step is the nearest characters 5 to 100 % stronger than this one\./);
  assert.match(html, /<a class="text-button" href="#\/armory\/top\/Chanter">All top Chanter players /);
  // The strongest: their place; asked for the next step but given the strongest, it says so.
  const top = view({ ...reference, group: 'top', excluded: 0 }, 'top');
  assert.match(top, /<dt>Your place<\/dt><dd><strong>#4<\/strong><small>with the 10 strongest<\/small>/);
  assert.match(top, /Compared with the 10 strongest Chanter characters the armory keeps/);
  assert.doesNotMatch(top, /characters left out|upgrade-fallback/);
  assert.match(
    view({ ...reference, group: 'top' }, 'next'),
    /<p class="upgrade-fallback">[\s\S]*?Odyle knows too few Chanter characters a step above this one yet, so this compares with the strongest\./,
  );
  // While it loads, when it did not, and while the armory keeps too few of the class.
  assert.match(view(null), /Comparing with the Chanter characters a step above…/);
  assert.match(view(null, 'top'), /Comparing with the strongest Chanter characters the armory keeps…/);
  assert.match(view({ error: true }), /The comparison did not load\. Odyle tries again when you open this tab\./);
  assert.match(
    view({ ...reference, sample: 2, players: reference.players.slice(0, 2) }),
    /The armory keeps too few Chanter characters to compare with yet \(2 of 3\)\./,
  );
  // On par everywhere: nothing to do.
  const even = {
    ...reference,
    slots: [reference.slots[6]],
    boards: [],
    sets: [],
    skills: [],
    arcanaPlayers: 0,
    gearPlayers: 0,
  };
  assert.match(
    view(even, 'next', profile),
    /The gear is on par with the Chanter characters a step above in every slot\./,
  );
});

test('the top players page lists the strongest of a class, with a tab for each class', async () => {
  const top = {
    class: 'Chanter',
    characters: 1234,
    classes: [
      { name: 'Gladiator', icon: 'class_icon_gladiator.png', characters: 0 },
      { name: 'Chanter', icon: '', characters: 1234 },
    ],
    players: [
      {
        place: 1,
        name: 'Top<i>',
        level: 45,
        server: 'Siel',
        region: 'nae',
        serverId: 1101,
        characterId: 'VG9wVG9wVG9wVG9wVG9w1A==',
        combatPower: 382198,
        itemLevel: 3100,
        portrait: 'portrait-a.jpg',
        built: true,
      },
      {
        place: 2,
        name: 'Second',
        level: 45,
        server: 'Lumiel',
        region: 'eu',
        serverId: 2304,
        characterId: 'U2Vjb25kU2Vjb25kU2Vjb25k',
        combatPower: 315968,
        itemLevel: 2900,
        portrait: '',
        built: false,
      },
    ],
  };
  const html = armoryTop(top, images);
  assert.match(html, /<h1>Top players by class<\/h1>/);
  assert.match(
    html,
    /<nav class="armory-tabs top-classes" aria-label="Classes"><a href="#\/armory\/top\/Gladiator"><img class="class-icon" src="\/api\/odyle\/armory-images\/class_icon_gladiator.png"[^>]*>Gladiator<\/a><a href="#\/armory\/top\/Chanter" aria-current="page">Chanter <small>1,234<\/small><\/a><\/nav>/,
  );
  assert.match(html, /<h2>Strongest Chanter characters <span>2<\/span><\/h2>/);
  assert.match(
    html,
    /<li><a href="#\/armory\/nae\/1101\/VG9wVG9wVG9wVG9wVG9w1A=="><span class="top-place">1<\/span><span class="armory-mini" aria-hidden="true">TO<img class="armory-img " src="\/api\/odyle\/armory-images\/portrait-a.jpg"[^>]*><\/span><span class="top-who"><strong>Top&lt;i&gt;<\/strong><small>Siel · North America East · Level 45<\/small><\/span><span class="top-power"><strong>382,198 <small>CP<\/small><\/strong><small>item level 3,100<\/small><\/span><\/a><\/li>/,
  );
  assert.match(html, /<span class="top-place">2<\/span>[\s\S]*Lumiel · Europe · Level 45/);
  assert.match(html, /Odyle knows 1,234 Chanter characters\./);
  assert.doesNotMatch(html, /<i>/);
  // While it loads, and a class nobody is known of.
  assert.match(armoryTop(null, images, 'Ranger'), /Loading the top players…/);
  assert.match(
    armoryTop({ ...top, class: 'Ranger', players: [], characters: 0 }, images),
    /Odyle knows no Ranger character yet\./,
  );
  // The search page leads there.
  assert.match(
    armorySearch([{ region: 'GLOBAL_EU', elyos: [], asmodian: ['Lumiel'] }], {}),
    /<a class="button secondary" href="#\/armory\/top">[\s\S]*Top players by class<\/a>/,
  );
});

test('the search form keeps the last region and server and lists what PLAYNC found', async () => {
  const servers = ['Siel', 'Nezekan'],
    regions = ['GLOBAL_NA', 'GLOBAL_EU'].map(region => ({ region, elyos: servers, asmodian: ['Lumiel'] }));
  const form = armorySearch(regions, { region: 'GLOBAL_EU', server: 'Lumiel', name: 'Ka"' });
  assert.match(form, /<option value="GLOBAL_EU" selected>Europe<\/option>/);
  assert.match(form, /<option selected>Lumiel<\/option>/);
  assert.match(form, /value="Ka&quot;"/);
  assert.doesNotMatch(form, /armory-results|armory-empty/);
  const found = armorySearch(regions, {}, [
    {
      name: 'Ka',
      level: 45,
      race: 2,
      server: 'Lumiel',
      serverId: 2304,
      region: 'eu',
      characterId: 'kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=',
    },
  ]);
  assert.match(
    found,
    /href="#\/armory\/eu\/2304\/kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4="><strong>Ka<\/strong><span>Level 45 · Asmodians · Lumiel/,
  );
  assert.match(armorySearch(regions, {}, []), /PLAYNC lists no character of that name on this server\./);
});

test('bookmarks keep characters in this browser, newest first, with their last opened numbers', async () => {
  let list = addBookmark([], answer(), '2026-10-16T12:00:00.000Z');
  assert.deepEqual(list, [
    {
      region: 'eu',
      serverId: 2304,
      characterId: 'kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=',
      name: 'Ka<b>',
      server: 'Lumiel',
      class: 'Chanter',
      classIcon: '',
      level: 45,
      combatPower: 107458,
      itemLevel: 1671,
      portrait: profile.portrait,
      fetchedAt: answer().fetchedAt,
      savedAt: '2026-10-16T12:00:00.000Z',
    },
  ]);
  assert.equal(addBookmark(list, answer(), 'later'), list, 'a character is bookmarked once');
  const other = answer({
    characterId: 'QXJtb3JlcklkMDAwMDAwMDAwMDAwMDAwMDAwMDA=',
    profile: { ...profile, name: 'Other' },
  });
  list = addBookmark(list, other, '2026-10-16T12:05:00.000Z');
  assert.deepEqual(
    list.map(b => b.name),
    ['Other', 'Ka<b>'],
  );
  // Opening a bookmarked profile brings its row up to date, in its place.
  list = refreshBookmark(
    list,
    answer({ profile: { ...profile, combatPower: 120000 }, fetchedAt: new Date(now).toISOString() }),
  );
  assert.deepEqual([list[1].combatPower, list[1].savedAt, list[0].name], [120000, '2026-10-16T12:00:00.000Z', 'Other']);
  assert.ok(isBookmarked(list, { region: 'eu', serverId: '2304', characterId: other.characterId }));
  // Read back from storage: broken, foreign or repeated entries are left out.
  const stored = JSON.stringify([
    ...list,
    list[0],
    { name: 'x', region: 'xx', serverId: 1, characterId: 'y' },
    null,
    'text',
  ]);
  assert.deepEqual(
    readBookmarks(stored).map(b => b.name),
    ['Other', 'Ka<b>'],
  );
  assert.deepEqual([readBookmarks('not json'), readBookmarks('{}'), readBookmarks(null)], [[], [], []]);
  // The armory page lists them above the form, escaped, and marks them in results.
  const regions = [{ region: 'GLOBAL_EU', elyos: ['Siel'], asmodian: ['Lumiel'] }];
  const page = armorySearch(
    regions,
    {},
    [
      {
        name: 'Other',
        level: 45,
        race: 2,
        server: 'Lumiel',
        serverId: 2304,
        region: 'eu',
        characterId: other.characterId,
      },
    ],
    false,
    list,
    now,
    images,
  );
  assert.match(page, /Bookmarked characters <span>2<\/span>/);
  assert.match(
    page,
    /<strong>Ka&lt;b&gt;<\/strong><span>Level 45 · Chanter · Lumiel<\/span><span class="armory-mark-power">120,000 CP · item level 1,671<small>as of 0s ago<\/small>/,
  );
  assert.ok(page.includes(`data-armory-unmark="${bookmarkKey(list[1])}"`));
  assert.match(page, /<strong>Other <span class="armory-star"/);
  assert.ok(page.indexOf('armory-bookmarks') < page.indexOf('armory-form'));
  assert.match(
    page,
    /<span class="armory-mini" aria-hidden="true">KA<img class="armory-img " src="\/api\/odyle\/armory-images\/portrait-0123456789abcdef0123456789abcdef.png"/,
  );
  assert.deepEqual(
    removeBookmark(list, bookmarkKey(list[0])).map(b => b.name),
    ['Ka<b>'],
  );
  assert.doesNotMatch(armorySearch(regions, {}, null, false, [], now), /armory-bookmarks/);
  // The profile's button says whether it is bookmarked.
  assert.match(armoryProfile(answer(), now, false, true), /aria-pressed="true"[^>]*>★ Bookmarked/);
  assert.match(armoryProfile(answer(), now, false, false), /aria-pressed="false"[^>]*>☆ Bookmark</);
});

test('a character found on PLAYNC opens its own profile, else a search by name (#25)', async () => {
  const found = {
    officialId: 'kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=',
    officialRegion: 'eu',
    officialServerId: 2304,
  };
  assert.equal(officialPath(found), '/armory/eu/2304/kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=');
  assert.ok(armoryRoute.test(officialPath(found)));
  for (const c of [
    {},
    null,
    { ...found, officialId: '' },
    { ...found, officialServerId: 0 },
    { ...found, officialRegion: 'xx' },
    { ...found, officialId: '../x' },
  ])
    assert.equal(officialPath(c), '', JSON.stringify(c));
});
