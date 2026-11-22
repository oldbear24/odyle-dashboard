import { test } from 'node:test';
import assert from 'node:assert/strict';
import { armoryProfile, slotLabel, gradeClass, lookupLine, waiting, playncPage, armorySearch, addBookmark, lookupStatus, profileTabs, armoryTop, readBookmarks, removeBookmark, refreshBookmark, isBookmarked, bookmarkKey } from '../../src/armory.js';
import { armoryRoute, armoryTarget, profilePath, findPath, topPath, classBadge, imageUrl, officialPath } from '../../src/armorylinks.js';
import { upgradePlan, upgradeSlot, compareSlot, gradeRank, rolledValue } from '../../src/upgrade.js';
// The armory page (#67): src/armory.js.
const now = Date.parse('2026-10-16T12:00:00Z');
// A profile as the backend keeps it (backend/odyle/armory.go), with an item's details, skills,
// titles, skins and a board's nodes.
const detail = {
  category: 'Mace', kind: 'Equip', itemLevel: 102, maxEnchant: 15, maxExceed: 5, equipLevel: 45, race: 'All', classes: ['Chanter'],
  main: [{ name: 'Attack', min: '315', value: '630', extra: '174' }, { name: 'Attack', value: '0', extra: '40', exceed: true }], sub: [{ name: 'Combat Speed', value: '13%' }], subCount: 2, soulBind: '63.8',
  subSkills: [{ name: 'Bolt', level: 2, icon: 'ICON_EL_SKILL_004.png' }], stoneSlots: 2, stones: [{ name: 'Attack', value: '+10', grade: 'Unique', icon: 'Icon_Stone.png' }], godSlots: 1, godStones: [],
  set: { name: 'Primal Vigor', equipped: 2, items: [{ name: 'Chalice of Vigor', grade: 'Unique', equipped: true }, { name: 'Bell of Vigor', grade: 'Unique', equipped: false }], bonuses: [{ count: 2, effects: ['+60 PvE Attack'] }, { count: 4, effects: ['+150 PvE Attack'] }] },
  desc: '', sources: ['Crafting'], skins: ['Golden Vow (Mace)'], tradable: false, storable: true,
};
const profile = {
  v: 2, name: 'Ka<b>', level: 45, class: 'Chanter', race: 'Asmodians', gender: 'Female', server: 'Lumiel', title: 'Golden Glow', titleGrade: 'Unique', combatPower: 107458, itemLevel: 1671, portrait: 'portrait-0123456789abcdef0123456789abcdef.png',
  stats: [{ type: 'STR', name: 'Might', value: 45, primary: true, effects: ['Attack increase +4.5%'] }, { type: 'Justice', name: 'Justice', deity: 'Nezekan', value: 41, primary: false, effects: [] }],
  gear: [{ slot: 'MainHand', name: 'Enraged Kromede Rod', grade: 'Unique', enchant: 15, exceed: 3, icon: 'Icon_WP_MA_0078_T05.png', detail }, { slot: 'Helmet', name: 'Vakron Helm', grade: 'Legend', enchant: 0, exceed: 0 }, { slot: 'Arcana3', name: 'Compass', grade: 'Legend', enchant: 0, exceed: 0 }, { slot: 'Pet', name: 'Pagati', grade: '', enchant: 0, exceed: 0, level: 3 }],
  skins: [{ slot: 'EarringL', name: 'Gilded Wings (Earrings)', grade: 'Unique', icon: '' }, { slot: 'MaceMain', name: 'Eternal Sun (Mace)', grade: 'Special', icon: '' }],
  skills: [{ name: 'Bolt', category: 'Active', level: 13, needLevel: 1, acquired: true, equipped: true, icon: 'ICON_CL_SKILL_001.png' }, { name: 'Absolution', category: 'Dp', level: 0, needLevel: 22, acquired: false, equipped: false, icon: '' }],
  titles: { owned: 94, total: 304, equipped: [{ category: 'Attack', name: 'Guardian of Altgard', grade: 'Legend', owned: 36, total: 105, effects: ['PvE Damage Boost +3%'], stats: ['PvE Attack +4'] }, { category: 'Etc', name: '', grade: '', owned: 27, total: 101, effects: [], stats: [] }] },
  boards: [{ id: 71, name: 'Nezekan', open: 12, total: 40, icon: '', nodes: [{ r: 3, c: 3, g: 'Unique', t: 'Stat', o: true, e: 'Combat Speed +1.5%' }, { r: 4, c: 5, g: 'Rare', t: 'SkillLevel', e: 'Bolt +1' }], statEffects: ['Combat Speed +1.5%'], skillEffects: ['Bolt +1'] },
    { id: 74, name: 'Triniel', open: 0, total: 116, icon: '', nodes: [], statEffects: [], skillEffects: [] }],
};
const images = '/api/odyle/armory-images/';
const answer = extra => ({ region: 'eu', serverId: 2304, characterId: 'kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=', server: 'Lumiel', profile, fetchedAt: new Date(now - 2 * 3600000).toISOString(), error: '', state: 'fresh', position: 0, wait: 0, retryAfter: 0, lookupError: '', ...extra });

test('armory paths say what they show', async () => {
  const profileAt = profilePath({ region: 'eu', serverId: 2304, characterId: 'kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=' });
  for (const path of ['/armory', profileAt, profileAt + '/skills', profileAt + '/appearance', profileAt + '/upgrade', '/armory/top', '/armory/top/Chanter', findPath('GLOBAL_EU', 'Lumiel', 'Ka'), findPath('GLOBAL_NA', 'Siel', 'Žluťoučký'), findPath('GLOBAL_NAW', 'Siel', 'Ka')]) assert.ok(armoryRoute.test(path), path);
  for (const path of ['/armory/', '/armory/xx/2304/kdPX-_ocYSqMloiCy7IXZ0CDm', '/armory/eu/2304/short', '/armory/find/GLOBAL_XX/Lumiel/Ka', '/armory/eu/2304/a/b', profileAt + '/gear', profileAt + '/', '/armory/top/Chanter/x', '/armory/top/', '/armory/top/<b>']) assert.ok(!armoryRoute.test(path), path);
  assert.deepEqual([armoryTarget('/armory/top'), armoryTarget('/armory/top/Chanter')], [{ top: { class: '' } }, { top: { class: 'Chanter' } }]);
  assert.deepEqual([topPath(), topPath('Chanter'), topPath('<b>')], ['/armory/top', '/armory/top/Chanter', '/armory/top']);
  assert.deepEqual(armoryTarget(profileAt), { profile: { region: 'eu', serverId: '2304', characterId: 'kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=', tab: '' } });
  assert.deepEqual(armoryTarget(profileAt + '/daevanion').profile.tab, 'daevanion');
  assert.deepEqual(armoryTarget(profileAt + '/upgrade').profile.tab, 'upgrade');
  assert.equal(profilePath({ region: 'eu', serverId: 2304, characterId: 'abc' }, 'titles'), '/armory/eu/2304/abc/titles');
  assert.equal(profilePath({ region: 'eu', serverId: 2304, characterId: 'abc' }, 'nonsense'), '/armory/eu/2304/abc');
  assert.deepEqual(armoryTarget(findPath('GLOBAL_NA', 'Siel', 'Žluťoučký')), { find: { region: 'GLOBAL_NA', server: 'Siel', name: 'Žluťoučký' } });
  assert.deepEqual(armoryTarget('/armory'), { search: true });
});

test('a profile shows its gear, power and stats, escaped, with where its lookup stands', async () => {
  assert.deepEqual(['MainHand', 'Earring2', 'Arcana3', 'Mystery', 'EarringL', 'MaceMain', 'OrbSub'].map(slotLabel), ['Main hand', 'Earring', 'Arcana 3', 'Mystery', 'Earring', 'Main hand', 'Off hand']);
  assert.deepEqual(['Unique', 'legend', 'weird', undefined].map(gradeClass), ['grade-unique', 'grade-legend', 'grade-common', 'grade-common']);
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
  assert.match(html, /<img class="armory-img " src="\/api\/odyle\/armory-images\/portrait-0123456789abcdef0123456789abcdef.png"/);
  assert.doesNotMatch(html, /playnccdn|profileimg/);
  assert.match(html, new RegExp(`href="${playncPage(answer()).replace(/[.?+]/g, '\\$&')}" target="_blank" rel="noopener noreferrer">Official page ↗`));
  assert.equal(playncPage(answer()), 'https://aion2.plaync.com/en-us/characters/2304/kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4%3D?region=eu');
  // The paper doll: every slot, empty ones said so; weapons and arcana name their type.
  assert.match(html, /<small>Main hand · Mace<\/small><strong>Enraged Kromede Rod<\/strong><span>item level 102 · 1 stone<\/span>/);
  assert.match(html, /<small>Helmet<\/small><strong>Vakron Helm<\/strong><span>Legend<\/span>/);
  assert.match(html, /<small>Shoulders<\/small><strong>Empty<\/strong>/);
  assert.match(html, /<b class="armory-enchant">\+15<\/b><i class="armory-exceed">✦3<\/i>/);
  assert.match(html, /Arcana 3/);
  assert.match(html, /<b class="armory-enchant">Lv 3<\/b><\/span><span class="armory-gear-text"><small>Pet<\/small><strong>Pagati<\/strong>/);
  // The item's card: its facts, stats, soul binding, stones (empty slots too) and set.
  assert.match(html, /<strong>\+15 Enraged Kromede Rod<\/strong><small>Unique · Mace<\/small>/);
  assert.match(html, /<dt>Enchantment<\/dt><dd>\+15 \/ 15<\/dd>/);
  assert.match(html, /<dt>Exceed<\/dt><dd>3 \/ 5<\/dd>/);
  assert.match(html, /<li><span>Attack<\/span><b>315 ~ 630 <em>\(\+174\)<\/em><\/b><\/li><li class="is-exceed"><span>Attack<\/span><b>40<\/b><\/li>/);
  assert.match(html, /<h4>Soul binding <em>63.8%<\/em><\/h4>/);
  assert.match(html, /<span>Bolt<\/span><b>\+2<\/b>/);
  assert.match(html, /<h4>Manastone engraving<\/h4><ul class="armory-stones"><li class="grade-unique"><img [^>]*Icon_Stone.png[^>]*><span>Attack \+10<\/span><\/li><li class="is-open"><i class="armory-stone-art"><\/i><span>Empty slot<\/span><\/li><\/ul>/);
  assert.match(html, /<h4>Theostone engraving<\/h4><ul class="armory-stones"><li class="is-open">/);
  assert.match(html, /<h4>Set: Primal Vigor <span>2 \/ 2<\/span><\/h4>/);
  assert.match(html, /<li class="is-on"><b>2 pieces<\/b><span>\+60 PvE Attack<\/span><\/li><li class=""><b>4 pieces<\/b>/);
  assert.match(html, /<span>Skin: Golden Vow \(Mace\)<\/span><span>How to obtain: Crafting<\/span><span>Not tradable<\/span>/);
  assert.match(html, /<small>2 pieces: \+60 PvE Attack<\/small>/);
  // Stats with what they give.
  assert.match(html, /<span>Might<\/span><strong>45<\/strong><\/div><ul><li>Attack increase \+4.5%<\/li><\/ul>/);
  assert.match(html, /Justice<small>Nezekan<\/small>/);
  assert.match(html, /Data from PLAYNC 2h ago/);
  // The tabs, the first one shown.
  assert.match(html, /<nav class="armory-tabs"[^>]*><a href="#\/armory\/eu\/2304\/kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=" aria-current="page">Gear &amp; stats<\/a><a href="#\/armory\/eu\/2304\/kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=\/skills">Skills<\/a><a [^>]*>Daevanion<\/a><a [^>]*>Titles<\/a><a [^>]*>Appearance<\/a><a [^>]*>Upgrade<\/a><\/nav>/);
  assert.doesNotMatch(html, /armory-refresh/);
  assert.match(armoryProfile(answer(), now, true), /data-action="armory-refresh"/);
  // Waiting for PLAYNC: the kept copy stays, with the queue.
  const queued = answer({ state: 'queued', position: 3, wait: 17, retryAfter: 15 });
  assert.equal(lookupLine(queued, now), 'Fetching from PLAYNC · about 17 s, 3 characters ahead');
  assert.ok(waiting(queued) && !waiting(answer()));
  assert.equal(lookupLine(answer({ state: 'queued', position: 0, wait: 3 }), now), 'Fetching from PLAYNC · about 3 s');
  assert.equal(lookupLine(answer({ state: 'failed', lookupError: 'PLAYNC refused the lookup for now.', retryAfter: 590 }), now), 'PLAYNC did not answer (PLAYNC refused the lookup for now.). Odyle tries again in 10 min.');
  assert.equal(lookupLine(answer({ state: 'paused', profile: null, fetchedAt: '' }), now), 'The armory is paused for now. Try again later.');
  // Not kept yet: the page waits for it.
  const first = armoryProfile(answer({ profile: null, fetchedAt: '', state: 'fetching', retryAfter: 2 }), now, false);
  assert.match(first, /A character on Lumiel/);
  assert.match(first, /armory-spinner/);
});

test('a class shows its emblem where the server keeps one: profile, search, bookmarks', async () => {
  assert.equal(classBadge(images, 'class_icon_chanter.png', 'Chanter'), '<img class="class-icon" src="/api/odyle/armory-images/class_icon_chanter.png" alt="" title="Chanter" loading="lazy" decoding="async" draggable="false">');
  assert.deepEqual([classBadge(images, '', 'Chanter'), classBadge(images, '../x.png', 'Chanter'), classBadge(images, undefined)], ['', '', '']);
  const shown = answer({ classIcon: 'class_icon_chanter.png' });
  assert.match(armoryProfile(shown, now, false, false, { images }), /<span>Level 45<\/span><span><img class="class-icon" src="\/api\/odyle\/armory-images\/class_icon_chanter.png" alt="" title="Chanter"[^>]*>Chanter<\/span><span>Asmodians<\/span>/);
  assert.match(armoryProfile(answer(), now, false, false, { images }), /<span>Level 45<\/span><span>Chanter<\/span>/);
  const regions = [{ region: 'GLOBAL_EU', elyos: ['Siel'], asmodian: ['Lumiel'] }];
  const hits = [{ name: 'Ka', level: 45, race: 2, server: 'Lumiel', serverId: 2304, region: 'eu', characterId: 'kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=', class: 'Chanter', classIcon: 'class_icon_chanter.png' },
    { name: 'Kb', level: 12, race: 1, server: 'Lumiel', serverId: 2304, region: 'eu', characterId: 'QXJtb3JlcklkMDAwMDAwMDAwMDAwMDAwMDAwMDA=', class: '', classIcon: '' }];
  const page = armorySearch(regions, {}, hits, false, addBookmark([], shown, 'now'), now, images);
  assert.match(page, /<span>Level 45 · <img class="class-icon" [^>]*title="Chanter"[^>]*>Chanter · Asmodians · Lumiel<\/span>/);
  assert.match(page, /<span>Level 12 · Elyos · Lumiel<\/span>/);
  assert.match(page, /<strong>Ka&lt;b&gt;<\/strong><span><img class="class-icon" [^>]*>Level 45 · Chanter · Lumiel<\/span>/);
});

test('a running lookup shows its step and a progress bar, and the profile read so far', async () => {
  const running = (progress, extra = {}) => answer({ state: 'fetching', retryAfter: 2, progress, ...extra });
  assert.equal(lookupLine(running({ step: 'profile', done: 1, total: 2, percent: 3 }), now), 'Reading the character page…');
  assert.equal(lookupLine(running({ step: 'images', done: 12, total: 1200, percent: 20 }), now), 'Downloading icons · 12 of 1,200');
  assert.equal(lookupLine(running({ step: 'items', done: 5, total: 20, percent: 40 }), now), 'Reading item details · 5 of 20');
  assert.equal(lookupLine(running({ step: 'boards', done: 0, total: 4, percent: 90 }), now), 'Reading Daevanion boards · 0 of 4');
  assert.equal(lookupLine(running(null), now), 'Fetching from PLAYNC now…');
  const status = lookupStatus(running({ step: 'items', done: 5, total: 20, percent: 40 }), now, false);
  assert.match(status, /<div class="armory-status is-waiting" role="status"><span class="armory-spinner" aria-hidden="true"><\/span><span>Reading item details · 5 of 20<span class="armory-track armory-progress" role="progressbar" aria-label="Lookup progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="40"><i style="width:40%"><\/i><\/span><\/span><\/div>/);
  assert.match(lookupStatus(running({ step: 'items', percent: 250 }), now, false), /aria-valuenow="100"><i style="width:100%">/);
  // Queued, kept or failed: no bar.
  for (const extra of [{ state: 'queued', position: 1, wait: 50, progress: null }, {}, { state: 'failed', lookupError: 'x', retryAfter: 600 }]) assert.doesNotMatch(lookupStatus(answer(extra), now, false), /progressbar/);
  // The profile read so far: items and boards say their details are on their way.
  const partial = { ...profile, gear: profile.gear.map(({ detail: _, ...g }) => g), boards: profile.boards.map(b => ({ ...b, nodes: [], statEffects: [], skillEffects: [] })) };
  const reading = running({ step: 'items', done: 0, total: 2, percent: 20 }, { profile: partial, partial: true, fetchedAt: '' });
  const gear = armoryProfile(reading, now, false, false, { images });
  assert.match(gear, /<small>Main hand<\/small><strong>Enraged Kromede Rod<\/strong><span>Unique · exceed 3<\/span>[\s\S]*?Odyle is reading this item's details from PLAYNC…/);
  assert.match(gear, /progressbar/);
  assert.match(armoryProfile(reading, now, false, false, { images, tab: 'daevanion' }), /Odyle is reading this board from PLAYNC…/);
  // Kept without them, the profile says PLAYNC gave none.
  const kept = armoryProfile(answer({ profile: partial }), now, false, false, { images, tab: 'daevanion' });
  assert.match(kept, /PLAYNC did not list this board's nodes\./);
  assert.doesNotMatch(armoryProfile(answer({ profile: partial }), now, false, false, { images }), /reading this item/);
});

test('a profile\'s tabs show its skills, Daevanion boards, titles and appearance', async () => {
  const view = (tab, extra = {}) => armoryProfile(answer(), now, false, false, { images, tab, ...extra });
  const skills = view('skills');
  assert.match(skills, /aria-current="page">Skills<\/a>/);
  assert.match(skills, /<h2>Active skills <span>1 \/ 1<\/span><\/h2>/);
  assert.match(skills, /<li class="armory-skill is-equipped" tabindex="0" aria-label="Bolt, Level 13, On the skill bar">/);
  assert.match(skills, /<dt>From gear<\/dt><dd>\+2<\/dd><\/div><div><dt>From Daevanion<\/dt><dd>\+1<\/dd>/);
  assert.match(skills, /<h2>Stigma skills <span>0 \/ 1<\/span><\/h2>/);
  assert.match(skills, /armory-skill is-locked" tabindex="0" aria-label="Absolution, Level 0, Not learned yet"/);
  // Daevanion: the first board with open nodes, its nodes from its first row and column on.
  const boards = view('daevanion');
  assert.match(boards, /data-armory-board="71" aria-pressed="true"/);
  assert.match(boards, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\);grid-template-rows:repeat\(2,auto\)/);
  assert.match(boards, /<span class="armory-node grade-unique is-stat is-open" style="grid-row:1;grid-column:1" title="Combat Speed \+1.5%"><\/span>/);
  assert.match(boards, /<span class="armory-node grade-rare is-skilllevel" style="grid-row:2;grid-column:3" title="Bolt \+1 · closed"><\/span>/);
  assert.match(boards, /<h4>Skill effect<\/h4><ul><li>Bolt \+1<\/li><\/ul>/);
  assert.match(view('daevanion', { board: '74' }), /No node of this board is open yet\./);
  // Titles: the one worn in each category, with what it gives.
  const titles = view('titles');
  assert.match(titles, /<strong>94 <small>\/ 304<\/small><\/strong>/);
  assert.match(titles, /<span>Offensive<\/span><small>36 \/ 105<\/small>[\s\S]*<strong class="grade-legend">Guardian of Altgard<\/strong><h4>When worn<\/h4><ul><li>PvE Damage Boost \+3%<\/li><\/ul><h4>Title stats<\/h4>/);
  assert.match(titles, /<span>Other<\/span>[\s\S]*No title worn/);
  const appearance = view('appearance');
  assert.match(appearance, /<h2>Skins <span>2<\/span><\/h2>/);
  assert.match(appearance, /<small>Earring<\/small><strong>Gilded Wings \(Earrings\)<\/strong>/);
  assert.match(appearance, /<small>Main hand<\/small><strong>Eternal Sun \(Mace\)<\/strong>/);
  // A profile kept before the armory kept everything shows its gear and stats only.
  const old = { name: 'Old', level: 45, combatPower: 1, itemLevel: 1, stats: [], gear: [{ slot: 'MainHand', name: 'Rod', grade: 'Unique', enchant: 15, exceed: 3 }], boards: [{ name: 'Nezekan', open: 12, total: 40 }] };
  assert.deepEqual(profileTabs({ ...old, skills: [], skins: [], titles: {} }).map(([key]) => key), ['', 'daevanion']);
  const shown = armoryProfile(answer({ profile: old }), now, false, false, { images, tab: 'skills' });
  assert.match(shown, /aria-current="page">Gear &amp; stats/);
  assert.match(shown, /<small>Main hand<\/small><strong>Rod<\/strong><span>Unique · exceed 3<\/span>/);
  assert.match(shown, /<span class="armory-icon {2}grade-unique is-empty"/);
  // Only names the backend keeps images under become addresses.
  assert.deepEqual(['a.png', 'portrait-x.jpg', '../x.png', 'x.gif', '', null, 'a b.png'].map(name => imageUrl(images, name)), [images + 'a.png', images + 'portrait-x.jpg', '', '', '', '', '']);
});

// What the strongest Chanters the armory keeps wear (backend/odyle/upgrades.go).
const strongest = (name, combatPower, n) => ({ name, level: 45, server: 'Siel', region: 'nae', serverId: 1101, characterId: `VG9wVG9wVG9wVG9wVG9w${n}A==`, combatPower, itemLevel: 1800, portrait: '' });
const reference = {
  class: 'Chanter', players: [strongest('Top<i>', 150000, 1), strongest('Second', 120000, 2), strongest('Third', 100000, 3)],
  combatPower: { median: 120000, low: 100000, high: 150000 }, itemLevel: { median: 1750, low: 1600, high: 1800 },
  slots: [
    { slot: 'MainHand', players: 3, items: 3, grade: 'Mythic', itemLevel: 120, enchant: 15, exceed: 5, stones: 2, stoneSlots: 2, stoneNames: [{ name: 'Attack', count: 5 }, { name: 'Critical Hit', count: 1 }],
      rolledItems: 3, rolled: [{ name: 'Combat Speed', percent: true, count: 3, value: 15 }, { name: 'Critical Hit', percent: false, count: 2, value: 1200 }, { name: 'Accuracy', percent: false, count: 1, value: 80 }],
      popular: [{ name: 'Dragon Lord Mace', grade: 'Mythic', icon: 'Icon_Mace.png', category: 'Mace', count: 2, enchant: 15, exceed: 5, itemLevel: 120, sources: ['Crafting', "Dragon Lord's Refuge"] },
        { name: 'Enraged Kromede Rod', grade: 'Unique', icon: '', category: 'Mace', count: 1, enchant: 15, exceed: 3, itemLevel: 102, sources: [] }] },
    { slot: 'Helmet', players: 3, items: 3, grade: 'Legend', itemLevel: 0, enchant: 0, exceed: 0, stones: 0, stoneSlots: 0, stoneNames: [], popular: [{ name: 'Vakron Helm', grade: 'Legend', icon: '', category: '', count: 3, enchant: 0, exceed: 0, itemLevel: 0, sources: [] }] },
    { slot: 'Earring', players: 3, items: 6, grade: 'Unique', itemLevel: 54, enchant: 10, exceed: 0, stones: 0, stoneSlots: 0, stoneNames: [], popular: [{ name: 'Berk Earrings', grade: 'Unique', icon: '', category: 'Earrings', count: 6, enchant: 10, exceed: 0, itemLevel: 54, sources: ['Expedition'] }] },
    { slot: 'Arcana3', players: 1, items: 1, grade: 'Legend', itemLevel: 0, enchant: 0, exceed: 0, stones: 0, stoneSlots: 0, stoneNames: [], popular: [{ name: 'Compass', grade: 'Legend', icon: '', category: '', count: 1, enchant: 0, exceed: 0, itemLevel: 0, sources: [] }] },
  ],
  sets: [{ name: 'Primal Vigor', players: 3, pieces: 4 }, { name: 'Storm', players: 1, pieces: 2 }],
  boards: [{ name: 'Nezekan', players: 3, open: 30, total: 40 }, { name: 'Triniel', players: 3, open: 20, total: 116 }],
  skills: [{ name: 'Bolt', category: 'Active', icon: '', players: 3, level: 15 }, { name: 'Absolution', category: 'Dp', icon: '', players: 2, level: 10 }, { name: 'Seldom', category: 'Active', icon: '', players: 0, level: 1 }],
  builtAt: '2026-10-16T11:55:00.000Z',
};

test('the upgrade plan ranks the slots by how far the gear is behind the strongest of the class', async () => {
  assert.deepEqual(['MainHand', 'Earring2', 'Ring1', 'Bracelet2', 'Rune1', 'Arcana3', 'Pet', 'Wings'].map(upgradeSlot), ['MainHand', 'Earring', 'Ring', 'Bracelet', 'Rune', 'Arcana3', '', 'Wings']);
  assert.deepEqual(['Common', 'Legend', 'Mythic', 'Special', undefined].map(gradeRank), [1, 3, 6, 0, 0]);
  const plan = upgradePlan(profile, reference);
  // Behind in item level (18 of 120), grade (two), exceed (two), one empty stone slot and the stats
  // most of the strongest roll: Combat Speed lower (13 % of their 15 %), no Critical Hit; few roll Accuracy.
  const main = plan.rows.find(r => r.slot === 'MainHand');
  assert.deepEqual(main.gaps, { itemLevel: 18, enchant: 0, exceed: 2, grade: 2, stones: 1, rolled: [{ name: 'Combat Speed', percent: true, theirs: 15, mine: 13 }, { name: 'Critical Hit', percent: false, theirs: 1200, mine: null }] });
  assert.equal(main.score, 73); assert.equal(main.state, 'big'); assert.equal(main.best.name, 'Dragon Lord Mace'); assert.equal(main.wearsBest, false);
  // Both earrings, which every one of the strongest wears, are missing; the helmet and arcana are on par.
  assert.deepEqual(plan.rows.map(r => [r.slot, r.score, r.state]), [['MainHand', 73, 'big'], ['Helmet', 0, 'even'], ['Earring', 100, 'big'], ['Earring', 100, 'big'], ['Arcana3', 0, 'even']]);
  assert.deepEqual(plan.picks.map(r => r.slot), ['Earring', 'Earring', 'MainHand']);
  // Its place: third with the three strongest, by combat power.
  assert.equal(plan.place, 3); assert.equal(plan.below, false);
  assert.deepEqual([plan.combatPower.mine, plan.combatPower.gap, plan.itemLevel.gap], [107458, 120000 - 107458, 1750 - 1671]);
  assert.deepEqual(plan.sets.map(s => [s.name, s.mine]), [['Primal Vigor', 2], ['Storm', 0]]);
  assert.deepEqual(plan.boards.map(b => [b.name, b.mine, b.gap]), [['Triniel', 0, 20], ['Nezekan', 12, 18]]);
  assert.deepEqual(plan.skills.map(s => [s.name, s.equipped, s.acquired, s.mine]), [['Bolt', true, true, 13], ['Absolution', false, false, 0]]);
  // Weaker than them all; among many more than are listed by name, its place by their combat power.
  const weak = upgradePlan({ ...profile, combatPower: 1 }, reference);
  assert.deepEqual([weak.place, weak.below], [4, true]);
  const many = upgradePlan(profile, { ...reference, sample: 500, combatPowers: Array.from({ length: 500 }, (_, i) => 500000 - i * 1000) });
  assert.deepEqual([many.sample, many.place, many.below], [500, 394, false]);
  // Too few to compare with; an empty place few of the strongest fill counts for nothing.
  assert.equal(upgradePlan(profile, { ...reference, players: reference.players.slice(0, 2) }), null);
  assert.equal(upgradePlan(profile, { ...reference, sample: 2 }), null);
  assert.equal(upgradePlan(profile, null), null);
  assert.equal(compareSlot(null, reference.slots[3], 3).score, 0);
  // Wearing what the strongest wear most, enchanted further than they do: on par.
  const same = compareSlot({ slot: 'MainHand', name: 'Dragon Lord Mace', grade: 'Mythic', enchant: 15, exceed: 5, detail: { itemLevel: 120, stoneSlots: 2, stones: [{}, {}] } }, reference.slots[0], 3);
  assert.deepEqual([same.score, same.state, same.wearsBest], [0, 'even', true]);
  // Rolled stats: as many as theirs or more, summed when rolled twice ("1,200" is a number), are on
  // par; an item without them misses them all; too few of the strongest's known compare nothing.
  assert.deepEqual(['13%', '+120', '1,200', '-2.5%', '?', undefined].map(rolledValue), [{ value: 13, percent: true }, { value: 120, percent: false }, { value: 1200, percent: false }, { value: -2.5, percent: true }, null, null]);
  const rolls = sub => compareSlot({ ...same.item, detail: { ...same.item.detail, sub } }, reference.slots[0], 3);
  assert.equal(rolls([{ name: 'Combat Speed', value: '9%' }, { name: 'Combat Speed', value: '6%' }, { name: 'Critical Hit', value: '1,200' }]).score, 0);
  assert.deepEqual([rolls([]).score, rolls([]).gaps.rolled.map(r => r.name)], [6, ['Combat Speed', 'Critical Hit']]);
  assert.deepEqual(rolls([{ name: 'Critical Hit', value: '1200%' }, { name: 'Combat Speed', value: '15%' }]).gaps.rolled, [{ name: 'Critical Hit', percent: false, theirs: 1200, mine: null }]);
  assert.equal(compareSlot({ ...same.item, detail: { ...same.item.detail, sub: [] } }, { ...reference.slots[0], rolledItems: 2 }, 3).score, 0);
});

test('the upgrade tab shows the best upgrades, every slot, the sets, boards and skills of the strongest', async () => {
  const view = upgrade => armoryProfile(answer(), now, false, false, { images, tab: 'upgrade', upgrade });
  assert.ok(profileTabs(profile).some(([key]) => key === 'upgrade'));
  assert.ok(!profileTabs({ ...profile, class: '' }).some(([key]) => key === 'upgrade'), 'nothing to compare without a class');
  const html = view(reference);
  assert.match(html, /<a href="#\/armory\/eu\/2304\/kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=\/upgrade" aria-current="page">Upgrade<\/a>/);
  assert.match(html, /<h2>Upgrades<\/h2><\/div><p>Compared with the 3 strongest Chanter characters the armory keeps, from every Global region, by combat power\.<\/p>/);
  assert.match(html, /<dt>Combat power<\/dt><dd><strong>107,458<\/strong><small>their median 120,000 \(−12,542\)<\/small>/);
  assert.match(html, /<dt>Item level<\/dt><dd><strong>1,671<\/strong><small>their median 1,750 \(−79\)<\/small>/);
  assert.match(html, /<dt>Your place<\/dt><dd><strong>#3<\/strong><small>with the 3 strongest<\/small>/);
  // The strongest, escaped, each linking its profile.
  assert.match(html, /<summary>The 3 strongest Chanter characters<\/summary><ol class="upgrade-players"><li><a href="#\/armory\/nae\/1101\/VG9wVG9wVG9wVG9wVG9w1A=="><span class="armory-mini" aria-hidden="true">TO<\/span><strong>Top&lt;i&gt;<\/strong><span>Siel · 150,000 CP<\/span>/);
  assert.doesNotMatch(html, /<i>/);
  // The best upgrades: the missing earrings first, then the main hand with what it is behind by.
  const picks = html.match(/<ol class="upgrade-picks">([\s\S]*?)<\/ol><\/section>/)[1].split('<li class="upgrade-pick ').slice(1);
  assert.equal(picks.length, 3);
  assert.match(picks[0], /^is-big"><div class="upgrade-pick-head"><span class="upgrade-rank" aria-hidden="true">1<\/span><h3>Earring<\/h3><span class="upgrade-badge">Big upgrade<\/span>/);
  assert.match(picks[0], /<strong>Empty<\/strong>[\s\S]*<strong>Berk Earrings<\/strong><small>100 % of the strongest · usually \+10 · item level 54<\/small>/);
  assert.match(picks[0], /<li>3 of the 3 strongest wear something here<\/li>[\s\S]*<dt>How to obtain<\/dt><dd>Expedition<\/dd>/);
  assert.match(picks[2], /<h3>Main hand<\/h3>[\s\S]*<strong>\+15 Enraged Kromede Rod<\/strong><small>Unique · item level 102<\/small>[\s\S]*<strong>Dragon Lord Mace<\/strong><small>67 % of the strongest · usually \+15 · item level 120<\/small>/);
  assert.match(picks[2], /<ul class="upgrade-reasons"><li>Item level 102 → 120<\/li><li>Grade Unique → Mythic<\/li><li>Exceed 3 → 5<\/li><li>1 empty stone slot<\/li><li>Rolled Combat Speed 13% → 15%<\/li><li>Rolled Critical Hit: none → 1,200<\/li><\/ul>/);
  assert.match(picks[2], /<dt>How to obtain<\/dt><dd>Crafting, Dragon Lord&#39;s Refuge<\/dd><\/div><div><dt>Stats they roll<\/dt><dd>Combat Speed 15%, Critical Hit 1,200<\/dd><\/div><div><dt>Stones they engrave<\/dt><dd>Attack, Critical Hit<\/dd><\/div><div><dt>Also worn<\/dt><dd>Enraged Kromede Rod<\/dd>/);
  assert.match(picks[2], /src="\/api\/odyle\/armory-images\/Icon_Mace.png"/);
  // Every slot, the sets, the boards furthest behind first and the skills on the strongest's bars.
  assert.match(html, /<li class="upgrade-row is-even"><div class="upgrade-row-slot"><small>Helmet<\/small>[\s\S]*?<span class="upgrade-badge">On par<\/span><\/div><\/li>/);
  assert.match(html, /<strong>Primal Vigor<\/strong><span>3 of the 3 strongest, usually 4 pieces<\/span><small>Yours: 2 pieces<\/small>/);
  assert.match(html, /<strong>Storm<\/strong><span>1 of the 3 strongest, usually 2 pieces<\/span><small>Not worn<\/small>/);
  assert.match(html, /<ul class="upgrade-boards"><li class="is-behind"><span><strong>Triniel<\/strong><small>0 of 116 nodes · the strongest 20<\/small>[\s\S]*?<i style="width:0%"><\/i><b style="left:17%"><\/b>/);
  assert.match(html, /<strong>Nezekan<\/strong><small>12 of 40 nodes · the strongest 30<\/small>[\s\S]*?<i style="width:30%"><\/i><b style="left:75%"><\/b>/);
  assert.match(html, /<li class="is-equipped">[\s\S]*?<strong>Bolt<\/strong><small>3 of the 3 strongest, level 15 · on your bar, level 13<\/small>/);
  assert.match(html, /<li class="is-locked">[\s\S]*?<strong>Absolution<\/strong><small>2 of the 3 strongest, level 10 · Not learned yet<\/small>/);
  assert.doesNotMatch(html, /Seldom/);
  assert.match(html, /those Odyle's scout finds with PLAYNC's character search/);
  assert.match(html, /<a class="text-button" href="#\/armory\/top\/Chanter">All top Chanter players /);
  // While it loads, when it did not, and while the armory keeps too few of the class.
  assert.match(view(null), /Comparing with the strongest Chanter characters the armory keeps…/);
  assert.match(view({ error: true }), /The comparison did not load\. Odyle tries again when you open this tab\./);
  assert.match(view({ ...reference, players: reference.players.slice(0, 2) }), /The armory keeps too few Chanter characters to compare with yet \(2 of 3\)\./);
  // On par everywhere: nothing to pick.
  const even = { ...reference, slots: [reference.slots[1]], boards: [], sets: [], skills: [] };
  assert.match(view(even), /The gear is on par with the strongest Chanter characters in every slot\./);
});

test('the top players page lists the strongest of a class, with a tab for each class', async () => {
  const top = { class: 'Chanter', characters: 1234, classes: [{ name: 'Gladiator', icon: 'class_icon_gladiator.png', characters: 0 }, { name: 'Chanter', icon: '', characters: 1234 }],
    players: [{ place: 1, name: 'Top<i>', level: 45, server: 'Siel', region: 'nae', serverId: 1101, characterId: 'VG9wVG9wVG9wVG9wVG9w1A==', combatPower: 382198, itemLevel: 3100, portrait: 'portrait-a.jpg', built: true },
      { place: 2, name: 'Second', level: 45, server: 'Lumiel', region: 'eu', serverId: 2304, characterId: 'U2Vjb25kU2Vjb25kU2Vjb25k', combatPower: 315968, itemLevel: 2900, portrait: '', built: false }] };
  const html = armoryTop(top, images);
  assert.match(html, /<h1>Top players by class<\/h1>/);
  assert.match(html, /<nav class="armory-tabs top-classes" aria-label="Classes"><a href="#\/armory\/top\/Gladiator"><img class="class-icon" src="\/api\/odyle\/armory-images\/class_icon_gladiator.png"[^>]*>Gladiator<\/a><a href="#\/armory\/top\/Chanter" aria-current="page">Chanter <small>1,234<\/small><\/a><\/nav>/);
  assert.match(html, /<h2>Strongest Chanter characters <span>2<\/span><\/h2>/);
  assert.match(html, /<li><a href="#\/armory\/nae\/1101\/VG9wVG9wVG9wVG9wVG9w1A=="><span class="top-place">1<\/span><span class="armory-mini" aria-hidden="true">TO<img class="armory-img " src="\/api\/odyle\/armory-images\/portrait-a.jpg"[^>]*><\/span><span class="top-who"><strong>Top&lt;i&gt;<\/strong><small>Siel · North America East · Level 45<\/small><\/span><span class="top-power"><strong>382,198 <small>CP<\/small><\/strong><small>item level 3,100<\/small><\/span><\/a><\/li>/);
  assert.match(html, /<span class="top-place">2<\/span>[\s\S]*Lumiel · Europe · Level 45/);
  assert.match(html, /Odyle knows 1,234 Chanter characters\./);
  assert.doesNotMatch(html, /<i>/);
  // While it loads, and a class nobody is known of.
  assert.match(armoryTop(null, images, 'Ranger'), /Loading the top players…/);
  assert.match(armoryTop({ ...top, class: 'Ranger', players: [], characters: 0 }, images), /Odyle knows no Ranger character yet\./);
  // The search page leads there.
  assert.match(armorySearch([{ region: 'GLOBAL_EU', elyos: [], asmodian: ['Lumiel'] }], {}), /<a class="button secondary" href="#\/armory\/top">[\s\S]*Top players by class<\/a>/);
});

test('the search form keeps the last region and server and lists what PLAYNC found', async () => {
  const servers = ['Siel', 'Nezekan'], regions = ['GLOBAL_NA', 'GLOBAL_EU'].map(region => ({ region, elyos: servers, asmodian: ['Lumiel'] }));
  const form = armorySearch(regions, { region: 'GLOBAL_EU', server: 'Lumiel', name: 'Ka"' });
  assert.match(form, /<option value="GLOBAL_EU" selected>Europe<\/option>/);
  assert.match(form, /<option selected>Lumiel<\/option>/);
  assert.match(form, /value="Ka&quot;"/);
  assert.doesNotMatch(form, /armory-results|armory-empty/);
  const found = armorySearch(regions, {}, [{ name: 'Ka', level: 45, race: 2, server: 'Lumiel', serverId: 2304, region: 'eu', characterId: 'kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=' }]);
  assert.match(found, /href="#\/armory\/eu\/2304\/kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4="><strong>Ka<\/strong><span>Level 45 · Asmodians · Lumiel/);
  assert.match(armorySearch(regions, {}, []), /PLAYNC lists no character of that name on this server\./);
});

test('bookmarks keep characters in this browser, newest first, with their last opened numbers', async () => {
  let list = addBookmark([], answer(), '2026-10-16T12:00:00.000Z');
  assert.deepEqual(list, [{ region: 'eu', serverId: 2304, characterId: 'kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=', name: 'Ka<b>', server: 'Lumiel', class: 'Chanter', classIcon: '', level: 45, combatPower: 107458, itemLevel: 1671, portrait: profile.portrait, fetchedAt: answer().fetchedAt, savedAt: '2026-10-16T12:00:00.000Z' }]);
  assert.equal(addBookmark(list, answer(), 'later'), list, 'a character is bookmarked once');
  const other = answer({ characterId: 'QXJtb3JlcklkMDAwMDAwMDAwMDAwMDAwMDAwMDA=', profile: { ...profile, name: 'Other' } });
  list = addBookmark(list, other, '2026-10-16T12:05:00.000Z');
  assert.deepEqual(list.map(b => b.name), ['Other', 'Ka<b>']);
  // Opening a bookmarked profile brings its row up to date, in its place.
  list = refreshBookmark(list, answer({ profile: { ...profile, combatPower: 120000 }, fetchedAt: new Date(now).toISOString() }));
  assert.deepEqual([list[1].combatPower, list[1].savedAt, list[0].name], [120000, '2026-10-16T12:00:00.000Z', 'Other']);
  assert.ok(isBookmarked(list, { region: 'eu', serverId: '2304', characterId: other.characterId }));
  // Read back from storage: broken, foreign or repeated entries are left out.
  const stored = JSON.stringify([...list, list[0], { name: 'x', region: 'xx', serverId: 1, characterId: 'y' }, null, 'text']);
  assert.deepEqual(readBookmarks(stored).map(b => b.name), ['Other', 'Ka<b>']);
  assert.deepEqual([readBookmarks('not json'), readBookmarks('{}'), readBookmarks(null)], [[], [], []]);
  // The armory page lists them above the form, escaped, and marks them in results.
  const regions = [{ region: 'GLOBAL_EU', elyos: ['Siel'], asmodian: ['Lumiel'] }];
  const page = armorySearch(regions, {}, [{ name: 'Other', level: 45, race: 2, server: 'Lumiel', serverId: 2304, region: 'eu', characterId: other.characterId }], false, list, now, images);
  assert.match(page, /Bookmarked characters <span>2<\/span>/);
  assert.match(page, /<strong>Ka&lt;b&gt;<\/strong><span>Level 45 · Chanter · Lumiel<\/span><span class="armory-mark-power">120,000 CP · item level 1,671<small>as of 0s ago<\/small>/);
  assert.ok(page.includes(`data-armory-unmark="${bookmarkKey(list[1])}"`));
  assert.match(page, /<strong>Other <span class="armory-star"/);
  assert.ok(page.indexOf('armory-bookmarks') < page.indexOf('armory-form'));
  assert.match(page, /<span class="armory-mini" aria-hidden="true">KA<img class="armory-img " src="\/api\/odyle\/armory-images\/portrait-0123456789abcdef0123456789abcdef.png"/);
  assert.deepEqual(removeBookmark(list, bookmarkKey(list[0])).map(b => b.name), ['Ka<b>']);
  assert.doesNotMatch(armorySearch(regions, {}, null, false, [], now), /armory-bookmarks/);
  // The profile's button says whether it is bookmarked.
  assert.match(armoryProfile(answer(), now, false, true), /aria-pressed="true"[^>]*>★ Bookmarked/);
  assert.match(armoryProfile(answer(), now, false, false), /aria-pressed="false"[^>]*>☆ Bookmark</);
});

test('a character found on PLAYNC opens its own profile, else a search by name (#25)', async () => {
  const found = { officialId: 'kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=', officialRegion: 'eu', officialServerId: 2304 };
  assert.equal(officialPath(found), '/armory/eu/2304/kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=');
  assert.ok(armoryRoute.test(officialPath(found)));
  for (const c of [{}, null, { ...found, officialId: '' }, { ...found, officialServerId: 0 }, { ...found, officialRegion: 'xx' }, { ...found, officialId: '../x' }]) assert.equal(officialPath(c), '', JSON.stringify(c));
});
