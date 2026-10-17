const { test } = require('node:test');
const assert = require('node:assert/strict');
// The armory page (#67): src/armory.js.
const now = Date.parse('2026-10-16T12:00:00Z');
const profile = {
  name: 'Ka<b>', level: 45, class: 'Chanter', race: 'Asmodians', server: 'Lumiel', title: 'Golden Glow', titleGrade: 'Unique', combatPower: 107458, itemLevel: 1671,
  stats: [{ type: 'STR', name: 'Might', value: 45, primary: true }, { type: 'Justice', name: 'Justice', deity: 'Nezekan', value: 41, primary: false }],
  gear: [{ slot: 'MainHand', name: 'Enraged Kromede Rod', grade: 'Unique', enchant: 15, exceed: 3 }, { slot: 'Arcana3', name: 'Compass', grade: 'Legend', enchant: 0, exceed: 0 }, { slot: 'Pet', name: 'Pagati', grade: '', enchant: 0, exceed: 0, level: 3 }],
  boards: [{ name: 'Nezekan', open: 12, total: 40 }],
};
const answer = extra => ({ region: 'eu', serverId: 2304, characterId: 'kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=', server: 'Lumiel', profile, fetchedAt: new Date(now - 2 * 3600000).toISOString(), error: '', state: 'fresh', position: 0, wait: 0, retryAfter: 0, lookupError: '', ...extra });

test('armory paths say what they show', async () => {
  const { armoryRoute, armoryTarget, profilePath, findPath } = await import('../src/armory.js');
  const profileAt = profilePath({ region: 'eu', serverId: 2304, characterId: 'kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=' });
  for (const path of ['/armory', profileAt, findPath('GLOBAL_EU', 'Lumiel', 'Ka'), findPath('GLOBAL_NA', 'Siel', 'Žluťoučký'), findPath('GLOBAL_NAW', 'Siel', 'Ka')]) assert.ok(armoryRoute.test(path), path);
  for (const path of ['/armory/', '/armory/xx/2304/kdPX-_ocYSqMloiCy7IXZ0CDm', '/armory/eu/2304/short', '/armory/find/GLOBAL_XX/Lumiel/Ka', '/armory/eu/2304/a/b']) assert.ok(!armoryRoute.test(path), path);
  assert.deepEqual(armoryTarget(profileAt), { profile: { region: 'eu', serverId: '2304', characterId: 'kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=' } });
  assert.deepEqual(armoryTarget(findPath('GLOBAL_NA', 'Siel', 'Žluťoučký')), { find: { region: 'GLOBAL_NA', server: 'Siel', name: 'Žluťoučký' } });
  assert.deepEqual(armoryTarget('/armory'), { search: true });
});

test('a profile shows its gear, power and stats, escaped, with where its lookup stands', async () => {
  const { armoryProfile, slotLabel, gradeClass, lookupLine, waiting } = await import('../src/armory.js');
  assert.deepEqual(['MainHand', 'Earring2', 'Arcana3', 'Mystery'].map(slotLabel), ['Main hand', 'Earring', 'Arcana 3', 'Mystery']);
  assert.deepEqual(['Unique', 'legend', 'weird', undefined].map(gradeClass), ['grade-unique', 'grade-legend', 'grade-common', 'grade-common']);
  const html = armoryProfile(answer(), now, false);
  assert.match(html, /<h1>Ka&lt;b&gt;<\/h1>/);
  assert.match(html, /107,458/);
  assert.match(html, /1,671/);
  assert.match(html, /grade-unique"><span class="armory-slot">Main hand<\/span><strong>Enraged Kromede Rod<\/strong><span class="armory-grade">Unique · \+15 · exceed 3/);
  assert.match(html, /Arcana 3/);
  assert.match(html, /Pagati<\/strong><span class="armory-grade">Level 3<\/span>/);
  assert.match(html, /Justice<small>Nezekan<\/small>/);
  assert.match(html, /Data from PLAYNC 2h ago/);
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
  assert.deepEqual(list, [{ region: 'eu', serverId: 2304, characterId: 'kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=', name: 'Ka<b>', server: 'Lumiel', class: 'Chanter', level: 45, combatPower: 107458, itemLevel: 1671, fetchedAt: answer().fetchedAt, savedAt: '2026-10-16T12:00:00.000Z' }]);
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
  const page = armorySearch(regions, {}, [{ name: 'Other', level: 45, race: 2, server: 'Lumiel', serverId: 2304, region: 'eu', characterId: other.characterId }], false, list, now);
  assert.match(page, /Bookmarked characters <span>2<\/span>/);
  assert.match(page, /<strong>Ka&lt;b&gt;<\/strong><span>Level 45 · Chanter · Lumiel<\/span><span class="armory-mark-power">120,000 CP · item level 1,671<small>as of 0s ago<\/small>/);
  assert.ok(page.includes(`data-armory-unmark="${bookmarkKey(list[1])}"`));
  assert.match(page, /<strong>Other <span class="armory-star"/);
  assert.ok(page.indexOf('armory-bookmarks') < page.indexOf('armory-form'));
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
