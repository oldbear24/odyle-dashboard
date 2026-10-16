const { test } = require('node:test');
const assert = require('node:assert/strict');
// The dungeon catalog in rooms (src/catalog.js): the wishlist and run forms pick from it,
// and listed dungeons show their cost and the cubes the party can open.
const catalogOf = () => import('../src/catalog.js');
const catalog = [
  { name: 'Krao Cave', cost: 20, partySize: 5, category: 'Exploration', unconfirmed: true },
  { name: 'Fire Temple', cost: 0, partySize: 0, category: '', unconfirmed: false },
  { name: 'Abyssal Forge: Ludra', cost: 80, partySize: 10, category: 'Sanctuary', unconfirmed: false },
  { name: 'Urugugu <Canyon>', cost: 20, partySize: 5, category: 'Exploration', unconfirmed: false },
];
test('listed dungeons match like the server matches names and cost Odyle per cube without their own cost', async () => {
  const { dungeonKey, entryOf, cubeCost } = await catalogOf();
  assert.equal(dungeonKey('  Fire   TEMPLE '), 'fire temple');
  assert.equal(entryOf(catalog, ' fire  temple').name, 'Fire Temple'); assert.equal(entryOf(catalog, 'Nowhere'), null); assert.equal(entryOf([], 'Fire Temple'), null);
  assert.deepEqual([cubeCost(catalog[0], 40), cubeCost(catalog[1], 40), cubeCost(null, 40)], [20, 40, 40]);
});
test('a listed dungeon names its cost, party size and the cubes the party can open', async () => {
  const { dungeonFacts } = await catalogOf(), { useLanguage } = await import('../src/i18n.js');
  // The party at a cost: its lowest live player holds 170 Odyle.
  const asked = [], party = cost => { asked.push(cost); return { lowest: { value: 170 }, cubes: Math.floor(170 / cost) }; };
  assert.equal(dungeonFacts(catalog[2], { perCube: 40, party }), '<small class="dungeon-facts">80 Odyle per cube · 10 players · <span class="dungeon-cubes">party can open 2 cubes</span></small>');
  assert.equal(dungeonFacts(catalog[1], { perCube: 40, party }), '<small class="dungeon-facts">40 Odyle per cube · <span class="dungeon-cubes">party can open 4 cubes</span></small>');
  assert.match(dungeonFacts(catalog[0], { perCube: 40, party }), /20 Odyle per cube \(unconfirmed\) · 5 players · .*party can open 8 cubes/);
  assert.deepEqual(asked, [80, 40, 20]);
  // Nobody live: no cube count. A dungeon the catalog does not list: no line at all.
  const empty = () => ({ lowest: null, cubes: 0 });
  assert.equal(dungeonFacts(catalog[2], { perCube: 40, party: empty }), '<small class="dungeon-facts">80 Odyle per cube · 10 players</small>');
  assert.equal(dungeonFacts(null, { perCube: 40, party }), '');
  try {
    await useLanguage('cs');
    assert.match(dungeonFacts(catalog[0], { perCube: 40, party: () => ({ lowest: { value: 20 }, cubes: 1 }) }), /20 Odyle za kostku \(nepotvrzeno\) · 5 hráčů · .*parta otevře 1 kostku/);
  } finally { await useLanguage('en'); }
});
test('forms pick a listed dungeon when there is a catalog and take any name otherwise', async () => {
  const { dungeonField } = await catalogOf();
  // Without a catalog: free text with suggestions, as before.
  const free = dungeonField({ catalog: [], suggestions: ['Old <Cave>'], list: 'wish-suggestions', placeholder: 'Add a dungeon' });
  assert.match(free, /^<input name="dungeon" maxlength="60" list="wish-suggestions" autocomplete="off" placeholder="Add a dungeon" aria-label="Dungeon" required>/);
  assert.match(free, /<datalist id="wish-suggestions"><option value="Old &lt;Cave&gt;"><\/datalist>$/); assert.doesNotMatch(free, /<select/);
  assert.match(dungeonField({ catalog: [], list: 'run-edit-dungeons', value: 'Old Cave' }), /required value="Old Cave">/);
  // With one: a required list grouped by category, each dungeon with its cost, nothing chosen yet.
  const select = dungeonField({ catalog, list: 'run-dungeons', placeholder: 'Choose a dungeon', perCube: 40 });
  assert.match(select, /^<select name="dungeon" required aria-label="Dungeon"><option value="" disabled selected>Choose a dungeon<\/option>/);
  assert.deepEqual([...select.matchAll(/<optgroup label="([^"]*)">/g)].map(m => m[1]), ['Exploration', 'Sanctuary']);
  assert.deepEqual([...select.matchAll(/<option value="([^"]+)"[^>]*>([^<]*)</g)].map(m => [m[1], m[2]]), [['Krao Cave', 'Krao Cave · 20 Odyle'], ['Urugugu &lt;Canyon&gt;', 'Urugugu &lt;Canyon&gt; · 20 Odyle'], ['Fire Temple', 'Fire Temple · 40 Odyle'], ['Abyssal Forge: Ludra', 'Abyssal Forge: Ludra · 80 Odyle']]);
  assert.doesNotMatch(select, /datalist/);
  // Only the offered choices; a run being changed keeps its dungeon selected, even one the catalog dropped.
  assert.doesNotMatch(dungeonField({ catalog, choices: catalog.slice(1, 2), list: 'x', perCube: 40 }), /Krao Cave/);
  const kept = dungeonField({ catalog, list: 'run-edit-dungeons', value: 'krao  cave', perCube: 40 });
  assert.match(kept, /<option value="" disabled>/); assert.match(kept, /<option value="Krao Cave" selected>/); assert.equal(kept.match(/ selected/g).length, 1);
  const dropped = dungeonField({ catalog, list: 'run-edit-dungeons', value: 'Old Cave', perCube: 40 });
  assert.match(dropped, /<option value="" disabled>Choose a dungeon<\/option><option value="Old Cave" selected>Old Cave<\/option><optgroup/); assert.equal(dropped.match(/ selected/g).length, 1);
});
test('runs show the cost of listed dungeons and their forms pick from the catalog', async () => {
  const { runsSection, runEditForm } = await import('../src/runs.js'), now = Date.parse('2026-10-14T12:00:00Z');
  const run = { id: 'r1', dungeon: 'Abyssal Forge: Ludra', startsAt: '2026-10-14 19:00:00.000Z', note: '', planner: 'u1', attendees: ['u1'] };
  const facts = name => name === run.dungeon ? '<small class="dungeon-facts">80 Odyle per cube</small>' : '';
  const html = runsSection({ runs: [run], members: [], myId: 'u1', viewer: false, owner: false, live: new Set(), now, suggestions: [], catalog, perCube: 40, facts, demo: false });
  assert.match(html, /<strong>Abyssal Forge: Ludra<\/strong><small>[^<]*<\/small><small class="dungeon-facts">80 Odyle per cube<\/small>/);
  assert.match(html, /<form id="run-form" class="wish-form run-form"><select name="dungeon" required aria-label="Dungeon"><option value="" disabled selected>Choose a dungeon<\/option>/);
  assert.match(runEditForm(run, { catalog, perCube: 40 }, now), /<option value="Abyssal Forge: Ludra" selected>/);
  // Without a catalog the run form keeps its free text and suggestions.
  assert.match(runsSection({ runs: [], members: [], myId: 'u1', viewer: false, owner: false, live: new Set(), now, suggestions: ['Fire Temple'], demo: false }), /<input name="dungeon" maxlength="60" list="run-dungeons" autocomplete="off" placeholder="Dungeon"[^>]*><datalist id="run-dungeons"><option value="Fire Temple"><\/datalist>/);
});
