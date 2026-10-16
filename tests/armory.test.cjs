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
  for (const path of ['/armory', profileAt, findPath('GLOBAL_EU', 'Lumiel', 'Ka'), findPath('GLOBAL_NA', 'Siel', 'Žluťoučký')]) assert.ok(armoryRoute.test(path), path);
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
