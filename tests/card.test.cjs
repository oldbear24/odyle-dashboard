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
  const trying = cardPage(answer({ design: 'abyss', finish: 'prism', mine: true, holo: true }), { look: { design: 'elysea', finish: 'etched' } });
  assert.match(trying, /<article class="tcg design-elysea finish-etched"/);
  assert.match(trying, /<button class="button primary" type="submit" >/);

  const player = cardPage(answer({ design: '', finish: '', mine: true, holo: false }));
  assert.equal((player.match(/name="finish" value="(prism|starfall|etched|sunburst|ice|scales|aether|opal|galaxy|lenticular|brushed|stained|shield)" {2}disabled/g) || []).length, 13, 'holo locked');
  assert.match(player, /<input type="radio" name="finish" value="" checked/, 'plain open');
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

test('the card turns whichever way it is dragged and rests on the face that shows, upright', async () => {
  const { orientation: o, dragTurn } = await import('../src/card.js');
  const start = [0, 0, 0, 1], round = v => v.map(n => Math.round(n * 1000) / 1000 + 0);
  assert.equal(o.css(start), 'rotate3d(0, 1, 0, 0deg)');
  // Sideways about the vertical axis, up and down about the horizontal one (half a degree a pixel).
  assert.equal(o.css(o.times(dragTurn(60, 0), start)), 'rotate3d(0.0000, 1.0000, 0.0000, 30.00deg)');
  assert.equal(o.css(o.times(dragTurn(0, 60), start)), 'rotate3d(-1.0000, 0.0000, 0.0000, 30.00deg)');
  // Past 90 degrees either way the back shows.
  for (const [dx, dy] of [[200, 0], [0, 200], [-150, -150]]) assert.ok(o.normal(o.times(dragTurn(dx, dy), start))[2] < 0, `${dx}, ${dy}`);
  // Turned in the screen's frame: a drag down after the card is on its back still turns its top toward the viewer's feet.
  const back = o.times(dragTurn(360, 0), start), down = o.times(dragTurn(0, 60), back);
  assert.deepEqual(round(o.normal(down)), round(o.normal(o.times(dragTurn(0, 60), [0, 1, 0, 0]))));
  // It rests on the face that shows, upright; flipping a card turned over top to bottom keeps it on its back.
  assert.deepEqual(o.rest(o.times(dragTurn(50, 30), start)), [0, 0, 0, 1]);
  assert.deepEqual(o.rest(o.times(dragTurn(0, 220), start)), [0, 1, 0, 0]);
  // Halfway between two orientations, the short way round.
  assert.deepEqual(round(o.toward(start, o.about(0, 1, 0, 90), 0.5)), round(o.about(0, 1, 0, 45)));
  // What lies under the face that shows shifts toward where the viewer is: turned the same way,
  // the front's and the back's shift the same way on screen; facing the viewer, not at all.
  const [fx] = o.view(o.about(0, 1, 0, 20)), [bx] = o.view(o.times(o.about(0, 1, 0, 20), [0, 1, 0, 0]));
  assert.ok(fx < -0.3 && Math.abs(fx - bx) < 1e-9, `${fx} ${bx}`);
  assert.ok(o.view(o.about(1, 0, 0, 20))[1] > 0.3);
  assert.deepEqual(o.view(start).map(v => v + 0), [0, 0]);
  // The sparks around it face the viewer: the turn back undoes the turn.
  assert.deepEqual(round(o.times(o.inverse(o.about(1, 2, 0, 50)), o.about(1, 2, 0, 50))), [0, 0, 0, 1]);
});

test('a card\'s options pick from what PLAYNC lists, and anything else falls back', async () => {
  const { lookOf, cardSkills, cardStats, cardLine, cardPage, defaultOptions, cardAura } = await import('../src/card.js');
  const { imageName } = await import('../src/cardimage.js');
  assert.deepEqual(lookOf(answer({ design: '', finish: '' })).options, defaultOptions());
  const saved = answer({ design: 'balaur', finish: 'starfall', options: { layout: 'full', back: 'beluslan', stats: 'deity', line: 'legion', skills: ['Rend'] } });
  const styles = { aura: '', accent: '', frame: '', nameStyle: '' };
  assert.deepEqual(lookOf(saved), { design: 'balaur', finish: 'starfall', options: { layout: 'full', back: 'beluslan', stats: 'deity', line: 'legion', skills: ['Rend'], ...styles } });
  assert.deepEqual(lookOf(saved, { options: { layout: 'wide', back: 'gilded', stats: 'all', line: 'motto', aura: 'fireworks', accent: '#f00', frame: 'diamond', nameStyle: 'comic' } }).options, { layout: 'classic', back: '', stats: 'primary', line: 'title', skills: ['Rend'], ...styles });
  // The effect around the card, accent colour, frame and name style.
  const tried = { options: { aura: 'embers', accent: 'jade', frame: 'radiant', nameStyle: 'gold' } }, styled = lookOf(saved, tried);
  assert.deepEqual([styled.options.aura, styled.options.accent, styled.options.frame, styled.options.nameStyle], ['embers', 'jade', 'radiant', 'gold']);
  assert.match(cardPage(saved, { look: tried }), /<article class="tcg design-balaur finish-starfall layout-full accent-jade frame-radiant name-gold"[^>]*><div class="tcg-body"><div class="tcg-aura aura-embers" aria-hidden="true">(<i style="--x:[\d.]+%;--z:-?[\d.]+cqw;[^"]+"><\/i>){18}<\/div><div class="tcg-face tcg-front">/);
  assert.equal(cardAura(lookOf(saved)), '<div class="tcg-aura" aria-hidden="true"></div>', 'no effect, an empty layer');
  assert.equal(cardAura(styled), cardAura(lookOf(saved, tried)), 'the sparks stay where they were');
  assert.equal((cardAura(lookOf(saved, { options: { aura: 'stardust' } })).match(/<i /g) || []).length, 26);
  // Chosen skills first, then the strongest on the bar; a skill not learned is left out.
  assert.deepEqual(cardSkills(profile.skills, ['Rend']).map(s => s.name), ['Rend', 'Bolt']);
  assert.deepEqual(cardSkills(profile.skills, ['Soon', 'Smite']).map(s => s.name), ['Smite', 'Bolt']);
  assert.deepEqual(cardStats(profile.stats, 'deity').map(s => s.name), ['Justice']);
  assert.deepEqual(cardLine({ ...profile, legion: 'Golden Order' }, 'legion'), { kind: 'legion', text: 'Golden Order' });
  assert.equal(cardLine(profile, 'legion'), null, 'no legion, no line');
  assert.equal(cardLine(profile, 'none'), null);
  const page = cardPage({ ...saved, profile: { ...profile, legion: 'Golden <Order>' } });
  assert.match(page, /<article class="tcg design-balaur finish-starfall layout-full"/);
  assert.match(page, /<div class="tcg-face tcg-back design-beluslan"/);
  assert.match(page, /<p class="tcg-line is-legion">Legion Golden &lt;Order&gt;<\/p>/);
  assert.match(page, /<dt>Justice<\/dt><dd>41<\/dd>/);
  assert.match(page, /data-action="card-image"/);
  assert.equal(imageName({ name: 'Ka<b>' }), 'Kab-odyle-card.png');
  assert.equal(imageName({ name: 'Žluťoučký' }), 'Žluťoučký-odyle-card.png');
});

test('the effects around the card are in its 3D space, in front of it and behind it', async () => {
  const { lookOf, cardAura, cardAuras, cardDesigns, cardFinishes } = await import('../src/card.js');
  const look = aura => lookOf(answer({ design: 'abyss', finish: '', options: { aura } }));
  assert.equal(cardAuras().length, 11);
  assert.deepEqual([cardDesigns().length, cardFinishes().length], [12, 14]);
  for (const design of ['sanctum', 'pandaemonium', 'eltnen', 'inggison', 'dredgion', 'tiamaranta']) assert.equal(lookOf(answer({ design })).design, design);
  for (const finish of ['opal', 'galaxy', 'lenticular', 'brushed', 'stained', 'shield']) assert.equal(lookOf(answer({ design: 'abyss', finish })).finish, finish);
  // A plane behind each face, the back's turned with it.
  assert.equal(cardAura(look('glow')), '<div class="tcg-aura aura-glow" aria-hidden="true"><b class="tcg-plane tcg-halo"></b><b class="tcg-plane tcg-halo is-back"></b></div>');
  assert.equal((cardAura(look('rift')).match(/class="tcg-plane tcg-vortex/g) || []).length, 4);
  // Sparks spread in front of the card and behind it, the same each time.
  const depths = [...cardAura(look('embers')).matchAll(/--z:(-?[\d.]+)cqw/g)].map(m => Number(m[1]));
  assert.ok(depths.some(z => z > 0) && depths.some(z => z < 0), depths.join());
  assert.ok(depths.every(z => Math.abs(z) <= 30));
  assert.equal(cardAura(look('feathers')), cardAura(look('feathers')));
  assert.equal((cardAura(look('feathers')).match(/<i style="--x:[^"]*--axis:-?[\d.]+ 1 -?[\d.]+"><\/i>/g) || []).length, 14);
  assert.equal((cardAura(look('shards')).match(/<i /g) || []).length, 10);
  // Rings tilted around it, and a pair of wings of feathers.
  assert.equal((cardAura(look('orbit')).match(/<b class="tcg-ring is-orbit" style="--w:\d+cqw;--tilt:\d+deg;--roll:-?\d+deg;--t:\d+s;--at:50%"><b><\/b><\/b>/g) || []).length, 3);
  assert.match(cardAura(look('runes')), /<b class="tcg-ring is-runes" style="[^"]*--at:84%">/);
  const wings = cardAura(look('wings'));
  assert.match(wings, /^<div class="tcg-aura aura-wings" aria-hidden="true"><i class="tcg-wing is-left"><svg viewBox="-12 -14 160 120" focusable="false">(<path class="is-(flight|covert)" transform="translate\(-?[\d.]+ -?[\d.]+\) rotate\(-?[\d.]+\)" d="[^"]+"\/>){20}<\/svg><\/i><i class="tcg-wing is-right">/);
});

test('the look picker keeps its choices under tabs', async () => {
  const { cardPage, studioTabs } = await import('../src/card.js');
  const own = answer({ design: 'abyss', finish: '', mine: true, holo: true });
  const page = cardPage(own);
  assert.deepEqual(studioTabs().map(([key]) => key), ['design', 'finish', 'effects', 'content']);
  assert.match(page, /<div class="card-tabs" role="tablist" aria-label="Card look"><button type="button" role="tab" id="card-tab-design" aria-controls="card-panel-design" aria-selected="true" tabindex="0" data-card-tab="design">Design<\/button>/);
  assert.match(page, /<div class="card-panel" role="tabpanel" id="card-panel-design" aria-labelledby="card-tab-design" data-card-panel="design">/);
  for (const tab of ['finish', 'effects', 'content']) assert.match(page, new RegExp(`id="card-panel-${tab}" aria-labelledby="card-tab-${tab}" data-card-panel="${tab}" hidden>`));
  // Every choice is in the form, whichever tab is open, and the chosen design and finish say what they are.
  for (const name of ['design', 'finish', 'aura', 'accent', 'frame', 'nameStyle', 'layout', 'line', 'stats', 'skill0', 'skill1', 'back']) assert.match(page, new RegExp(`name="${name}"`), name);
  assert.match(page, /<p class="card-about" data-about="design">Obsidian split by aether light<\/p>/);
  assert.match(page, /<span class="card-swatch design-tiamaranta" aria-hidden="true"><\/span><strong>Tiamaranta<\/strong>/);
  // The tab last opened stays open; an unknown one opens the first.
  assert.match(cardPage(own, { tab: 'effects' }), /aria-selected="true" tabindex="0" data-card-tab="effects"/);
  assert.match(cardPage(own, { tab: 'effects' }), /data-card-panel="design" hidden>/);
  assert.match(cardPage(own, { tab: 'nope' }), /aria-selected="true" tabindex="0" data-card-tab="design"/);
});
