const { test } = require('node:test');
const assert = require('node:assert/strict');
const maps = [{ id: 1110, name: 'Altgard', thgl: 'Altgard' }, { id: 600001, name: '', thgl: '' }];
const now = Date.parse('2026-10-24T18:00:00Z');
test('a shared place shows its map and age on the row, and TH.GL is centred y,x on it', async () => {
  const { placeButton, embedUrl, mapName, sourceName } = await import('../src/places.js');
  const c = { id: 'c1', characterName: 'Scout', location: { map: 1110, x: -83475.7, y: -33883.7, z: 19698, heading: 113.4, source: 'load', at: '2026-10-24 17:56:00.000Z' } };
  const row = placeButton(c, maps, now);
  assert.match(row, /data-location="c1"/); assert.match(row, />Altgard</); assert.match(row, /4m ago/);
  assert.equal(placeButton({ id: 'c2', characterName: 'Hidden', location: null }, maps, now), '');
  // TH.GL keys its markers y:x, so its centre is the game's y, then x.
  assert.equal(embedUrl('Altgard', c.location), 'https://aion2.th.gl/embed/maps/Altgard?center=-33884,-83476&zoom=3&types=kibelisk,dungeon_kibelisk');
  assert.equal(embedUrl('Fire Temple', { x: 1, y: 2 }, 4), 'https://aion2.th.gl/embed/maps/Fire%20Temple?center=2,1&zoom=4&types=kibelisk,dungeon_kibelisk');
  // A map without a name shows its id; the sources read as words.
  assert.equal(mapName(600001, maps), 'Map 600001'); assert.equal(mapName(42, []), 'Map 42');
  assert.deepEqual(['load', 'arrival', 'flight', 'effect', 'walk'].map(sourceName), ['loading screen', 'arrived', 'in flight', 'skill or effect', '']);
});
test('the location dialog shows the latest place on the map, the 30 days, and why there is nothing', async () => {
  const { locationBody, placesOf } = await import('../src/places.js');
  const latest = { map: 1110, x: 10, y: 20, z: 0, heading: null, source: 'flight', at: '2026-10-24 17:59:30.000Z' };
  const history = [{ map: 1110, x: 0, y: 0, z: 0, heading: 90, source: 'load', at: '2026-10-24 17:50:00.000Z' }, { map: 600001, x: 5, y: 5, z: 0, heading: null, source: 'load', at: '2026-10-23 20:00:00.000Z' }];
  // The latest place is newer than the history (a flight keeps a place a minute apart).
  assert.equal(placesOf({ location: latest, locations: history }).length, 3);
  assert.equal(placesOf({ location: history[0], locations: history }).length, 2);
  const body = locationBody({ data: { shared: true, location: latest, locations: history }, maps, name: 'Scout', now });
  assert.match(body, /<strong>Altgard<\/strong> · in flight/);
  assert.match(body, /<iframe src="https:\/\/aion2\.th\.gl\/embed\/maps\/Altgard\?center=20,10&amp;zoom=3/);
  assert.match(body, /class="place-pin"/); assert.match(body, /data-place="1"/); assert.match(body, /data-place="2"/);
  // A place on a map without a TH.GL link says so instead of showing a map.
  const dungeon = locationBody({ data: { shared: true, location: null, locations: history }, maps, name: 'Scout', now, picked: 1 });
  assert.doesNotMatch(dungeon, /<iframe/); assert.match(dungeon, /Map 600001 has no map linked yet/);
  assert.match(locationBody({ data: { shared: false, locations: [] }, maps, name: 'Scout', now }), /The player of Scout does not share their location/);
  assert.match(locationBody({ data: { shared: false, locations: [] }, maps, name: 'Scout', own: true, now }), /Turn it on under Account &amp; data|Turn it on under Account & data/);
  assert.match(locationBody({ data: { shared: true, location: null, locations: [] }, maps, name: 'Scout', now }), /No place in the last 30 days yet/);
  // Twelve rows, then Show all.
  const many = Array.from({ length: 20 }, (_, i) => ({ ...history[0], at: new Date(now - i * 60000).toISOString() }));
  const listed = locationBody({ data: { shared: true, location: null, locations: many }, maps, name: 'Scout', now });
  assert.equal(listed.match(/<tr/g).length, 13); assert.match(listed, /8 earlier places in the last 30 days/); assert.match(listed, /data-place-all/);
  assert.equal(locationBody({ data: { shared: true, location: null, locations: many }, maps, name: 'Scout', now, all: true }).match(/<tr/g).length, 21);
});
test('the account page offers location sharing, off until the player turns it on', async () => {
  const { locationCard } = await import('../src/places.js');
  assert.match(locationCard(false), /id="location-form"/); assert.doesNotMatch(locationCard(false), /checked/);
  assert.match(locationCard(true), /name="shareLocation" checked/); assert.match(locationCard(true), /Share my location with my rooms/);
});
