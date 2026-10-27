const { test } = require('node:test');
const assert = require('node:assert/strict');
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
  const { armoryRoute, armoryTarget, profilePath, findPath } = await import('../src/armory.js');
  const profileAt = profilePath({ region: 'eu', serverId: 2304, characterId: 'kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=' });
  for (const path of ['/armory', profileAt, profileAt + '/skills', profileAt + '/appearance', findPath('GLOBAL_EU', 'Lumiel', 'Ka'), findPath('GLOBAL_NA', 'Siel', 'Žluťoučký'), findPath('GLOBAL_NAW', 'Siel', 'Ka')]) assert.ok(armoryRoute.test(path), path);
  for (const path of ['/armory/', '/armory/xx/2304/kdPX-_ocYSqMloiCy7IXZ0CDm', '/armory/eu/2304/short', '/armory/find/GLOBAL_XX/Lumiel/Ka', '/armory/eu/2304/a/b', profileAt + '/gear', profileAt + '/']) assert.ok(!armoryRoute.test(path), path);
  assert.deepEqual(armoryTarget(profileAt), { profile: { region: 'eu', serverId: '2304', characterId: 'kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=', tab: '' } });
  assert.deepEqual(armoryTarget(profileAt + '/daevanion').profile.tab, 'daevanion');
  assert.equal(profilePath({ region: 'eu', serverId: 2304, characterId: 'abc' }, 'titles'), '/armory/eu/2304/abc/titles');
  assert.equal(profilePath({ region: 'eu', serverId: 2304, characterId: 'abc' }, 'nonsense'), '/armory/eu/2304/abc');
  assert.deepEqual(armoryTarget(findPath('GLOBAL_NA', 'Siel', 'Žluťoučký')), { find: { region: 'GLOBAL_NA', server: 'Siel', name: 'Žluťoučký' } });
  assert.deepEqual(armoryTarget('/armory'), { search: true });
});

test('a profile shows its gear, power and stats, escaped, with where its lookup stands', async () => {
  const { armoryProfile, slotLabel, gradeClass, lookupLine, waiting, playncPage } = await import('../src/armory.js');
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
  assert.match(html, /<nav class="armory-tabs"[^>]*><a href="#\/armory\/eu\/2304\/kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=" aria-current="page">Gear &amp; stats<\/a><a href="#\/armory\/eu\/2304\/kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=\/skills">Skills<\/a><a [^>]*>Daevanion<\/a><a [^>]*>Titles<\/a><a [^>]*>Appearance<\/a><\/nav>/);
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
  const { armoryProfile, armorySearch, addBookmark, classBadge } = await import('../src/armory.js');
  assert.equal(classBadge(images, 'class_icon_chanter.png', 'Chanter'), '<img class="class-icon" src="/api/odyle/armory-images/class_icon_chanter.png" alt="" title="Chanter" loading="lazy" decoding="async">');
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
  const { armoryProfile, lookupLine, lookupStatus } = await import('../src/armory.js');
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
  const { armoryProfile, profileTabs, imageUrl } = await import('../src/armory.js');
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

test('the search form keeps the last region and server and lists what PLAYNC found', async () => {
  const { armorySearch } = await import('../src/armory.js');
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
  const { readBookmarks, addBookmark, removeBookmark, refreshBookmark, isBookmarked, bookmarkKey, armorySearch, armoryProfile } = await import('../src/armory.js');
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
  const { officialPath, armoryRoute } = await import('../src/armory.js');
  const found = { officialId: 'kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=', officialRegion: 'eu', officialServerId: 2304 };
  assert.equal(officialPath(found), '/armory/eu/2304/kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=');
  assert.ok(armoryRoute.test(officialPath(found)));
  for (const c of [{}, null, { ...found, officialId: '' }, { ...found, officialServerId: 0 }, { ...found, officialRegion: 'xx' }, { ...found, officialId: '../x' }]) assert.equal(officialPath(c), '', JSON.stringify(c));
});
