const { test } = require('node:test');
const assert = require('node:assert/strict');
// Player cards: src/card.js.
const profile = {
  name: 'Ka<b>', level: 45, class: 'Chanter', race: 'Asmodians', server: 'Lumiel', title: 'Golden Glow', titleGrade: 'Unique', combatPower: 107458, itemLevel: 1671, portrait: 'portrait-ka.jpg',
  stats: [{ type: 'STR', name: 'Might', value: 45, primary: true }, { type: 'Justice', name: 'Justice', value: 41, primary: false }],
  gear: [{ slot: 'MainHand', grade: 'Unique' }, { slot: 'Helmet', grade: 'Mythic' }, { slot: 'Pet', grade: '' }],
  skills: [{ name: 'Bolt', category: 'Active', level: 13, acquired: true, equipped: true, icon: 'ICON_Bolt.png' }, { name: 'Rend', category: 'Active', level: 20, acquired: true, equipped: false },
    { name: 'Smite', category: 'Active', level: 9, acquired: true, equipped: true }, { name: 'Ward', category: 'Passive', level: 30, acquired: true, equipped: true }, { name: 'Soon', category: 'Active', level: 40, acquired: false, equipped: false }],
  titles: { owned: 94, total: 304, equipped: [] }, boards: [{ open: 12, total: 40 }],
};
const answer = card => ({ region: 'eu', serverId: 2304, characterId: 'kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=', server: 'Lumiel', profile, classIcon: '', card });

test('a card is drawn in its chosen look, else after the character\'s race', async () => {
  const { designOf, finishOf, cardPath } = await import('../src/card.js');
  assert.equal(designOf(answer({ design: '', finish: '' })), 'asmodae');
  assert.equal(designOf({ ...answer({}), profile: { ...profile, race: 'Elyos' } }), 'elysea');
  assert.equal(designOf(answer({ design: 'abyss' })), 'abyss');
  assert.equal(designOf(answer({ design: 'abyss' }), 'elysea'), 'elysea', 'a look being tried');
  assert.equal(designOf(answer({ design: 'gilded' })), 'asmodae', 'an unknown design');
  assert.equal(finishOf(answer({ finish: 'prism' })), 'prism');
  assert.equal(finishOf(answer({ finish: 'prism' }), ''), '', 'plain being tried');
  assert.equal(finishOf(answer({ finish: 'chrome' })), '');
  assert.equal(cardPath(answer({})), '/armory/eu/2304/kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=/card');
});

test('the card shows the strongest skills on the bar and the best gear grade', async () => {
  const { signatureSkills, bestGrade } = await import('../src/card.js');
  assert.deepEqual(signatureSkills(profile.skills).map(s => s.name), ['Bolt', 'Smite']);
  assert.deepEqual(signatureSkills(profile.skills.map(s => ({ ...s, equipped: false }))).map(s => s.name), ['Rend', 'Bolt'], 'without a skill bar, the strongest learned');
  assert.deepEqual(signatureSkills([]), []);
  assert.equal(bestGrade(profile.gear), 5);
  assert.equal(bestGrade([]), 0);
});

test('the card page escapes what PLAYNC lists and offers the look picker only to the character\'s player', async () => {
  const { cardPage } = await import('../src/card.js');
  const visitor = cardPage(answer({ design: '', finish: '', mine: false, holo: false }), { images: '/api/odyle/armory-images/' });
  assert.match(visitor, /<main class="card-page design-asmodae">/);
  assert.match(visitor, /<h2>Ka&lt;b&gt;<\/h2>/);
  assert.ok(!visitor.includes('Ka<b>'), 'the name is escaped');
  assert.match(visitor, /<img class="tcg-portrait" src="\/api\/odyle\/armory-images\/portrait-ka.jpg"/);
  assert.match(visitor, /Combat power<\/span><strong>107,458<\/strong>/);
  assert.match(visitor, /<ul class="tcg-moves"><li>[\s\S]*Bolt[\s\S]*Lv 13[\s\S]*Smite/);
  assert.match(visitor, /<dt>Might<\/dt><dd>45<\/dd>/);
  assert.ok(!visitor.includes('Justice'), 'deity stats stay on the profile');
  assert.match(visitor, /Daevanion 12\/40<br>Titles 94\/304/);
  assert.match(visitor, /class="tcg-gem grade-mythic"/);
  assert.ok(!visitor.includes('card-form'));
  assert.match(visitor, /The player whose Odyle app reads Ka&lt;b&gt; chooses this card&#39;s design\./);
  assert.match(visitor, /href="#\/armory\/eu\/2304\/kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4="/, 'back to the profile');

  const member = cardPage(answer({ design: 'abyss', finish: 'prism', mine: true, holo: true }));
  assert.match(member, /<article class="tcg design-abyss finish-prism"/);
  assert.match(member, /<input type="radio" name="design" value="abyss" checked/);
  assert.match(member, /<input type="radio" name="finish" value="prism" checked/);
  assert.ok(!/name="finish"[^>]*disabled/.test(member), 'every finish open');
  assert.match(member, /<button class="button primary" type="submit" disabled>/, 'nothing to save yet');
  const trying = cardPage(answer({ design: 'abyss', finish: 'prism', mine: true, holo: true }), { design: 'elysea', finish: 'etched' });
  assert.match(trying, /<article class="tcg design-elysea finish-etched"/);
  assert.match(trying, /<button class="button primary" type="submit" >/);

  const player = cardPage(answer({ design: '', finish: '', mine: true, holo: false }));
  assert.equal((player.match(/name="finish" value="(prism|starfall|etched)" {2}disabled/g) || []).length, 3, 'holo locked');
  assert.match(player, /Holo finishes are for players with the membership/);

  const waiting = cardPage({ region: 'eu', serverId: 2304, characterId: 'x', server: 'Lumiel', profile: null, card: { design: '' } }, { status: '<p>busy</p>' });
  assert.match(waiting, /<p>busy<\/p><p>The card is drawn once Odyle has fetched this character from PLAYNC\.<\/p>/);
});

test('player card paths belong to the armory, apart from its tabs', async () => {
  const { armoryRoute, armoryTarget, armoryTabs } = await import('../src/armory.js');
  const at = '/armory/eu/2304/kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=/card';
  assert.ok(armoryRoute.test(at));
  assert.ok(!armoryRoute.test(at + '/skills'));
  assert.deepEqual(armoryTarget(at), { card: { region: 'eu', serverId: '2304', characterId: 'kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=' } });
  assert.ok(!armoryTabs.includes('card'));
});
