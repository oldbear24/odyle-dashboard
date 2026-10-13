import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, cp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { connect } from './sse.mjs';
import { createServer } from 'node:http';
const url = 'http://127.0.0.1:18090';
let child, directory, owner, player, viewer, outsider, room, code, viewerCode, publisher, first, second, oauthServer, oauthUrl, playncServer, playncUrl, legacyId, legacyRoomId;
// Synthetic official portraits served by the PLAYNC stand-in; bump the version to change one.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
let portraitVersion = 1;
const upgrades = ['1791763203_packet_only.js', '1791763204_character_sharing.js'];
async function request(path, body, auth, method = 'POST') {
  const res = await fetch(url + path, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth.token } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, data: await res.json() };
}
const action = (name, body, auth) => request('/api/odyle/' + name, body, auth);
const snapshot = auth => request('/api/odyle/snapshot/' + room.id, undefined, auth, 'GET');
async function stop() { if (child && child.exitCode === null) { const closed = new Promise(resolve => child.once('exit', resolve)); child.kill(); await closed; } }
async function start() {
  child = spawn(resolve('.runtime', process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase'), ['serve', '--http=127.0.0.1:18090', '--dir=' + join(directory, 'data'), '--hooksDir=' + join(directory, 'hooks'), '--migrationsDir=' + join(directory, 'migrations'), '--automigrate=false'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DISCORD_CLIENT_ID: 'test-application', DISCORD_CLIENT_SECRET: 'test-only-secret', PLAYNC_SEARCH_URL: playncUrl + '/search', PLAYNC_IMAGE_URL: playncUrl } });
  let log = ''; child.stdout.on('data', v => log += v); child.stderr.on('data', v => log += v);
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(url + '/api/health')).ok) {
        const configured = await request('/__test__/oauth-provider', {});
        assert.equal(configured.status, 200, JSON.stringify(configured.data)); return;
      }
    } catch {} await delay(100);
  }
  throw new Error('PocketBase failed to start: ' + log.replace(/http[^\s]*pbinstall[^\s]*/g, '[redacted]'));
}
before(async () => {
  // Mock only Discord's remote responses; PocketBase still performs its real
  // OAuth code exchange, account creation, access rules and identity linking.
  oauthServer = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/token' && req.method === 'POST') {
      let body = ''; for await (const chunk of req) body += chunk;
      if (new URLSearchParams(body).get('code') !== 'valid-test-discord-code') {
        res.writeHead(400); res.end(JSON.stringify({ error: 'invalid_grant' })); return;
      }
      res.end(JSON.stringify({ access_token: 'test-discord-access', token_type: 'Bearer', expires_in: 3600 }));
    } else if (req.url === '/user' && req.headers.authorization === 'Bearer test-discord-access') {
      res.end(JSON.stringify({ id: '100000000000000001', username: 'oauth-tester', global_name: 'OAuth Tester', email: 'oauth@test.invalid', verified: true }));
    } else { res.writeHead(401); res.end('{}'); }
  });
  await new Promise(resolve => oauthServer.listen(0, '127.0.0.1', resolve));
  oauthUrl = 'http://127.0.0.1:' + oauthServer.address().port;
  // Stands in for PLAYNC's public character search and portrait host. Lumiel EU is
  // server 2304; Nezekan on NA West is 1202 (NA East 1102 is searched first).
  playncServer = createServer((req, res) => {
    const query = new URL(req.url, 'http://x').searchParams, listed = { 'Pictured|2304|eu': '/images?charKey=1', 'Western|1202|naw': '/images?charKey=2' };
    if (req.url.startsWith('/search')) {
      if (query.get('keyword') === 'Broken') { res.writeHead(503); return res.end('{}'); }
      const hit = listed[[query.get('keyword'), query.get('serverId'), query.get('region')].join('|')];
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ list: hit ? [{ name: '<strong>' + query.get('keyword') + '</strong>', serverId: Number(query.get('serverId')), profileImageUrl: hit }] : [] }));
    }
    if (req.url.startsWith('/images')) { res.setHeader('Content-Type', 'image/png'); return res.end(Buffer.concat([png, Buffer.from([portraitVersion])])); }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => playncServer.listen(0, '127.0.0.1', resolve));
  playncUrl = 'http://127.0.0.1:' + playncServer.address().port;
  directory = await mkdtemp(join(tmpdir(), 'odyle-account-test-'));
  await cp(resolve('backend/pb_hooks'), join(directory, 'hooks'), { recursive: true });
  await cp(resolve('backend/pb_migrations'), join(directory, 'migrations'), { recursive: true, filter: path => !upgrades.some(name => path.endsWith(name)) });
  // Only this disposable test backend approves the synthetic fixture adapter.
  await writeFile(join(directory, 'hooks', 'lib', 'protocols.cjs'), "module.exports = { verifiedAdapters: ['test-fixture-v1'] };");
  // Synthetic account issuance exists only in the temporary test hooks. There
  // is no password login, test auth route or Discord bypass in production.
  await writeFile(join(directory, 'hooks', 'fixtures.pb.js'), `routerAdd('POST','/__test__/account',(e)=>{const name=e.requestInfo().body.name; let user; try{user=e.app.findFirstRecordByData('users','displayName',name);}catch{user=new Record(e.app.findCollectionByNameOrId('users'));user.set('email',$security.randomString(20)+'@test.invalid');user.setPassword($security.randomString(48));user.set('displayName',name);e.app.save(user);}return e.json(200,{token:user.newAuthToken(),record:user});});`);
  await writeFile(join(directory, 'hooks', 'oauth-fixture.pb.js'), `routerAdd('POST','/__test__/oauth-provider',e => { const users=e.app.findCollectionByNameOrId('users'); users.oauth2={enabled:true,providers:[{name:'discord',clientId:'test-application',clientSecret:'test-only-secret',tokenURL:'${oauthUrl}/token',userInfoURL:'${oauthUrl}/user'}]};e.app.save(users); return e.json(200,{success:true}); });`);
  // Runs the portrait cron job now; age-portrait makes a character's daily refresh due.
  await writeFile(join(directory, 'hooks', 'portraits-fixture.pb.js'), `routerAdd('POST','/__test__/refresh-portraits', e => { require(__hooks + '/lib/accounts.cjs').refreshPortraits(); return e.json(200, {}); }); routerAdd('POST','/__test__/age-portrait', e => { const c=e.app.findRecordById('characters', e.requestInfo().body.id); c.set('portraitCheckedAt', new Date(Date.now() - 2 * 86400000).toISOString()); e.app.save(c); return e.json(200, {}); });`);
  // Runs the odyle-expiry cron job on demand and reports which of the given invite codes it kept.
  await writeFile(join(directory, 'hooks', 'expiry-fixture.pb.js'), `routerAdd('POST','/__test__/expire-invite', e => { const r=e.app.findFirstRecordByData('room_invites','digest',$security.sha256(e.requestInfo().body.code)); r.set('expiresAt',new Date(Date.now()-60000).toISOString()); e.app.save(r); return e.json(200,{}); }); routerAdd('POST','/__test__/cleanup', e => { require(__hooks + '/lib/accounts.cjs').cleanup(); const codes=e.requestInfo().body.codes, kept=[]; for (let i=0;i<codes.length;i++) { try { e.app.findFirstRecordByData('room_invites','digest',$security.sha256(codes[i])); kept.push(codes[i]); } catch {} } return e.json(200,{kept}); });`);
  // Stands in for a superuser editing odyle_settings in the PocketBase dashboard.
  await writeFile(join(directory, 'hooks', 'settings-fixture.pb.js'), `routerAdd('POST','/__test__/odyle-per-cube', e => { const r=e.app.findFirstRecordByFilter('odyle_settings','id != ""'); r.set('odylePerCube',e.requestInfo().body.value); e.app.save(r); return e.json(200,{}); });`);
  // Joins are rate limited to 10 a minute and other tests use that budget; this adds a membership directly.
  await writeFile(join(directory, 'hooks', 'member-fixture.pb.js'), `routerAdd('POST','/__test__/member', e => { const b=e.requestInfo().body, m=new Record(e.app.findCollectionByNameOrId('room_members')); m.set('room',b.room); m.set('user',b.user); m.set('role',b.role); m.set('sharedCharacters',[]); e.app.save(m); return e.json(200,m); });`);
  await writeFile(join(directory, 'hooks', 'legacy-fixture.pb.js'), `routerAdd('POST','/__test__/legacy', e => { const c=new Record(e.app.findCollectionByNameOrId('characters')); c.set('user',e.requestInfo().body.user); c.set('characterName','Legacy'); c.set('server','EU'); c.set('region','GLOBAL_EU'); c.set('value',123); c.set('confirmed',true); c.set('valid',true); c.set('source','manual'); c.set('lastReadingAt','2026-10-12 12:00:00.000Z'); e.app.save(c); return e.json(200,c); }); routerAdd('POST','/__test__/legacy-room', e => { const user=e.requestInfo().body.user; const r=new Record(e.app.findCollectionByNameOrId('party_rooms')); r.set('owner',user); r.set('name','Legacy room'); r.set('cost',40); e.app.save(r); const m=new Record(e.app.findCollectionByNameOrId('room_members')); m.set('room',r.id); m.set('user',user); m.set('role','owner'); m.set('sharing',true); e.app.save(m); return e.json(200,r); });`);
  await start();
  const users = await Promise.all(['Owner', 'Player', 'Viewer', 'Outsider'].map(name => request('/__test__/account', { name })));
  for (const result of users) assert.equal(result.status, 200, JSON.stringify(result.data));
  [owner, player, viewer, outsider] = users.map(r => r.data);
  const legacy = await request('/__test__/legacy', { user: outsider.record.id }); assert.equal(legacy.status, 200); legacyId = legacy.data.id;
  const legacyRoom = await request('/__test__/legacy-room', { user: outsider.record.id }); assert.equal(legacyRoom.status, 200, JSON.stringify(legacyRoom.data)); legacyRoomId = legacyRoom.data.id;
  await stop();
  for (const name of upgrades) await cp(resolve('backend/pb_migrations', name), join(directory, 'migrations', name));
  await start();
});
after(async () => { await stop(); for (const server of [oauthServer, playncServer]) if (server) await new Promise(resolve => server.close(resolve)); if (directory) await rm(directory, { recursive: true, force: true }); });
test('packet-only upgrade preserves legacy totals and removes current confidence', async () => {
  const legacy = await request('/api/collections/characters/records/' + legacyId, undefined, outsider, 'GET');
  assert.equal(legacy.status, 200); assert.equal(legacy.data.value, 123); assert.equal(legacy.data.confirmed, true); assert.equal(legacy.data.valid, false);
  assert.equal(legacy.data.source, 'manual'); assert.equal(legacy.data.lastReadingAt, '2026-10-12 12:00:00.000Z');
});
test('per-character upgrade keeps every character of a sharing membership shared', async () => {
  const listed = (await request('/api/odyle/rooms', undefined, outsider, 'GET')).data.rooms.find(r => r.id === legacyRoomId);
  assert.deepEqual(listed.sharedCharacters, [legacyId]); assert.equal(listed.sharing, true);
  const own = (await request('/api/odyle/snapshot/' + legacyRoomId, undefined, outsider, 'GET')).data.members[0];
  assert.equal(own.characters[0].shared, true); assert.equal(own.sharing, true);
});
test('first Discord OAuth sign-in creates an account; repeat sign-in retains its rooms', async () => {
  const credentials = { provider: 'discord', code: 'valid-test-discord-code', codeVerifier: 'a'.repeat(43), redirectURL: url + '/api/oauth2-redirect', createData: { displayName: 'Adventurer' } };
  const firstLogin = await request('/api/collections/users/auth-with-oauth2', credentials);
  assert.equal(firstLogin.status, 200, JSON.stringify(firstLogin.data));
  assert.equal(firstLogin.data.meta.isNew, true);
  assert.equal(firstLogin.data.record.email, 'oauth@test.invalid');
  const profile = await request('/api/collections/users/records/' + firstLogin.data.record.id, { displayName: 'OAuth Tester' }, firstLogin.data, 'PATCH');
  assert.equal(profile.status, 200, JSON.stringify(profile.data));
  const created = await action('create', { name: 'OAuth room' }, firstLogin.data);
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const again = await request('/api/collections/users/auth-with-oauth2', credentials);
  assert.equal(again.status, 200, JSON.stringify(again.data));
  assert.equal(again.data.meta.isNew, false);
  assert.equal(again.data.record.id, firstLogin.data.record.id);
  const saved = await request('/api/odyle/rooms', undefined, again.data, 'GET');
  assert.equal(saved.data.rooms[0].id, created.data.room.id);
  const invalid = await request('/api/collections/users/auth-with-oauth2', { ...credentials, code: 'invalid-code' });
  assert.equal(invalid.status, 400);
});
test('character identity can be saved before any game reading without accepting manual energy', async () => {
  const user = (await request('/__test__/account', { name: 'Character metadata' })).data;
  const identity = { characterName: ' NewMain ', server: ' Lumiel ', region: 'GLOBAL_EU' };
  assert.equal((await action('character', identity)).status, 401);
  const saves = await Promise.all(Array.from({ length: 3 }, () => action('character', identity, user)));
  for (const save of saves) assert.equal(save.status, 200, JSON.stringify(save.data));
  const c = saves[0].data.character;
  assert.equal(new Set(saves.map(s => s.data.character.id)).size, 1);
  assert.equal(c.user, user.record.id); assert.equal(c.characterName, 'NewMain'); assert.equal(c.server, 'Lumiel');
  assert.equal(c.confirmed, false); assert.equal(c.valid, false); assert.equal(c.lastReadingAt, ''); assert.equal(c.lastSeenAt, ''); assert.equal(c.source, '');
  for (const extra of [{ value: 390 }, { user: owner.record.id }, { confirmed: true }, { source: 'packet' }, { characterId: legacyId }]) assert.equal((await action('character', { ...identity, ...extra }, user)).status, 400);
  for (const bad of [{ characterName: '' }, { server: '' }, { region: 'KR' }]) assert.equal((await action('character', { ...identity, ...bad }, user)).status, 400);
  assert.equal((await request('/api/collections/characters/records/' + c.id, undefined, outsider, 'GET')).status, 404);
  const session = (await action('session', {}, user)).data;
  const reported = await action('report', { ...identity, characterId: c.id, sessionId: session.sessionId, sequence: 1, value: 265, source: 'packet', parserVersion: 'test-fixture-v1', confirmed: true }, user);
  assert.equal(reported.status, 200);
  const again = (await action('character', identity, user)).data.character;
  assert.equal(again.id, c.id); assert.equal(again.value, 265); assert.equal(again.confirmed, true); assert.equal(again.lastReadingAt, reported.data.character.lastReadingAt);
  await stop(); await start();
  assert.equal((await request('/api/collections/characters/records/' + c.id, undefined, user, 'GET')).data.value, 265);
});
test('characters get their official portrait from the game; players cannot change it', async () => {
  const [author, mate] = await Promise.all(['Portrait owner', 'Portrait mate'].map(async name => (await request('/__test__/account', { name })).data));
  const save = async (characterName, server, region = 'GLOBAL_EU') => (await action('character', { characterName, server, region }, author)).data.character;
  // NA East and West share server names; Western is only listed on NA West.
  const c = await save('Pictured', 'Lumiel'), western = await save('Western', 'Nezekan', 'GLOBAL_NA');
  // Not listed by the search, an unknown server name and a search outage.
  const missing = [await save('Unlisted', 'Lumiel'), await save('Pictured', 'Atreia'), await save('Broken', 'Lumiel')];
  const made = (await action('create', { name: 'Portrait room' }, author)).data;
  assert.equal((await action('join', { code: made.invites.find(i => i.role === 'reporter').code }, mate)).status, 200);
  const own = async (id = c.id) => (await request('/api/collections/characters/records/' + id, undefined, author, 'GET')).data;
  const file = async name => fetch(url + '/api/files/characters/' + c.id + '/' + name);
  const seen = async auth => (await request('/api/odyle/snapshot/' + made.room.id, undefined, auth, 'GET')).data.members.flatMap(m => m.characters).find(x => x.id === c.id);
  // Each cron run handles five characters; other tests leave a few unchecked ones too.
  const refresh = async () => { for (let i = 0; i < 3; i++) assert.equal((await request('/__test__/refresh-portraits', {})).status, 200); };
  const dayLater = async () => assert.equal((await request('/__test__/age-portrait', { id: c.id })).status, 200);

  await refresh();
  const game = await own(); assert.match(game.portrait, /\.png$/);
  assert.equal('portraitHash' in game || 'portraitCheckedAt' in game, false);
  assert.equal(game.confirmed, false); assert.equal(game.lastReadingAt, '');
  const served = await file(game.portrait); assert.equal(served.status, 200); assert.equal(served.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), Buffer.concat([png, Buffer.from([1])]));
  assert.match((await own(western.id)).portrait, /\.png$/);
  for (const m of missing) assert.equal((await own(m.id)).portrait, '', m.characterName + ' on ' + m.server);

  // Rechecked daily; the file is only rewritten when the official image changed.
  await refresh(); assert.equal((await own()).portrait, game.portrait);
  await dayLater(); await refresh(); assert.equal((await own()).portrait, game.portrait);
  portraitVersion = 2; await dayLater(); await refresh();
  const updated = await own(); assert.notEqual(updated.portrait, game.portrait); assert.equal((await file(game.portrait)).status, 404);

  // Rooms see the picture only for characters shared with them.
  assert.equal((await seen(author)).portrait, updated.portrait); assert.equal(await seen(mate), undefined);
  assert.equal((await action('sharing', { roomId: made.room.id, characterId: c.id, enabled: true }, author)).status, 200);
  assert.equal((await seen(mate)).portrait, updated.portrait);

  // Players have no way to set or replace a picture.
  const form = () => { const f = new FormData(); f.append('characterId', c.id); f.append('portrait', new Blob([png], { type: 'image/png' }), 'mine.png'); return f; };
  assert.equal((await fetch(url + '/api/odyle/portrait', { method: 'POST', headers: { Authorization: author.token }, body: form() })).status, 404);
  assert.equal((await action('portrait', { characterId: c.id, source: 'game' }, author)).status, 404);
  assert.equal((await fetch(url + '/api/collections/characters/records/' + c.id, { method: 'PATCH', headers: { Authorization: author.token }, body: form() })).status, 403);
  assert.equal((await own()).portrait, updated.portrait);
});
test('expiry cron removes expired invites but keeps fresh invites and pairing codes', async () => {
  // Stored dates read '2026-10-13 21:40:00.000Z'; comparing them with an ISO 'T' timestamp
  // treated anything later on the same UTC day as expired, so fresh codes died at the next tick.
  const [author, guest] = await Promise.all(['Expiry owner', 'Expiry guest'].map(async name => (await request('/__test__/account', { name })).data));
  const made = (await action('create', { name: 'Expiry room' }, author)).data;
  const [fresh, stale] = ['reporter', 'viewer'].map(role => made.invites.find(i => i.role === role).code);
  const pairing = (await action('desktop-code', {}, author)).data;
  assert.equal((await request('/__test__/expire-invite', { code: stale })).status, 200);
  const swept = await request('/__test__/cleanup', { codes: [fresh, stale] });
  assert.equal(swept.status, 200, JSON.stringify(swept.data)); assert.deepEqual(swept.data.kept, [fresh]);
  const joined = await action('join', { code: fresh }, guest); assert.equal(joined.status, 200, JSON.stringify(joined.data));
  assert.equal((await action('join', { code: stale }, guest)).status, 400);
  const paired = await action('pair', { code: pairing.code }); assert.equal(paired.status, 200, JSON.stringify(paired.data));
});
test('room members keep a shared dungeon wishlist', async () => {
  const [author, mate, watcher, stranger] = await Promise.all(['Wish owner', 'Wish mate', 'Wish viewer', 'Wish stranger'].map(async name => (await request('/__test__/account', { name })).data));
  const made = (await action('create', { name: 'Wishlist room' }, author)).data, roomId = made.room.id;
  for (const [auth, role] of [[mate, 'reporter'], [watcher, 'viewer']]) assert.equal((await request('/__test__/member', { room: roomId, user: auth.record.id, role })).status, 200);
  const wish = (auth, dungeon, wanted = true, extra = {}) => action('wishlist', { roomId, dungeon, wanted, ...extra }, auth);
  const listed = async auth => (await request('/api/odyle/snapshot/' + roomId, undefined, auth, 'GET')).data.wishlist.map(w => [w.dungeon, w.users]);

  // Free-text names: differently typed names join one entry, which keeps its first
  // spelling; the most wanted dungeon comes first and every member sees the list.
  assert.equal((await wish(author, 'Draupnir Cave')).status, 200);
  const added = await wish(mate, '  Fire   Temple '); assert.equal(added.status, 200, JSON.stringify(added.data));
  assert.deepEqual(added.data.wishlist.map(w => w.dungeon), ['Draupnir Cave', 'Fire Temple']);
  for (let i = 0; i < 2; i++) assert.equal((await wish(author, 'FIRE temple')).status, 200);
  const both = [['Fire Temple', [mate.record.id, author.record.id]], ['Draupnir Cave', [author.record.id]]];
  assert.deepEqual(await listed(watcher), both); assert.deepEqual(await listed(mate), both);

  // Viewers only read it, outsiders get nothing and the collection is closed to direct access.
  const stream = await connect(url, watcher.token, 'odyle.room.' + roomId);
  try {
    assert.equal((await wish(watcher, 'Udas Temple')).status, 403);
    assert.equal((await wish(stranger, 'Udas Temple')).status, 403);
    assert.equal(await stream.next(250), null);
    assert.equal((await wish(mate, 'Udas Temple')).status, 200); assert.equal((await stream.next())?.data.refresh, true);
  } finally { await stream.close(); }
  assert.equal((await request('/api/odyle/snapshot/' + roomId, undefined, stranger, 'GET')).status, 403);
  assert.equal((await request('/api/collections/room_wishes/records', undefined, author, 'GET')).status, 403);
  for (const bad of [{ dungeon: '' }, { dungeon: 'x'.repeat(61) }, { wanted: 'yes' }]) assert.equal((await action('wishlist', { roomId, dungeon: 'Fire Temple', wanted: true, ...bad }, mate)).status, 400);

  // Members take only themselves off; only the owner clears an entry for everyone.
  assert.equal((await wish(mate, 'fire temple', false)).status, 200);
  assert.equal((await wish(mate, 'Draupnir Cave', false, { everyone: true })).status, 403);
  assert.equal((await wish(author, 'Draupnir Cave', true, { everyone: true })).status, 400);
  assert.deepEqual(await listed(author), [['Draupnir Cave', [author.record.id]], ['Fire Temple', [author.record.id]], ['Udas Temple', [mate.record.id]]]);
  assert.equal((await wish(author, 'draupnir cave', false, { everyone: true })).status, 200);

  // A member who leaves takes their entries along.
  assert.equal((await action('leave', { roomId }, mate)).status, 200);
  assert.deepEqual(await listed(author), [['Fire Temple', [author.record.id]]]);
});
test('Windows UI follows the game character, sends only changes and follows dashboard sharing', { skip: !process.env.ODYLE_WINDOWS_UI_CHECKS }, async () => {
  const user = (await request('/__test__/account', { name: 'Windows UI fixture' })).data;
  const pair = (await action('desktop-code', {}, user)).data;
  const output = execFileSync('dotnet', ['run', '--project', process.env.ODYLE_WINDOWS_UI_CHECKS, '-c', 'Release', '--', url, pair.code], { encoding: 'utf8', timeout: 60000 });
  assert.match(output, /game-driven characters, change-only sending, in-game switch attribution, dashboard-managed room sharing, party list and persistence passed/);
});
test('Discord accounts, persistent characters, private rooms and desktop pairing', async t => {
  await t.test('Discord is the only enabled sign-in provider; public password registration is closed', async () => {
    const methods = await request('/api/collections/users/auth-methods', undefined, null, 'GET');
    assert.equal(methods.data.password.enabled, false);
    assert.deepEqual(methods.data.oauth2.providers.map(p => p.name), ['discord']);
    assert.equal(JSON.stringify(methods.data).includes('test-only-secret'), false);
    const registration = { email: 'a@test.invalid', password: 'password1234', passwordConfirm: 'password1234', displayName: 'Bypass' };
    assert.equal((await request('/api/collections/users/records', registration)).status, 400);
    assert.equal((await request('/api/collections/users/records?context=oauth2', { ...registration, context: 'oauth2', '@request.context': 'oauth2' })).status, 400);
    const spoofed = await fetch(url + '/api/collections/users/records', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Request-Context': 'oauth2' }, body: JSON.stringify(registration) });
    assert.equal(spoofed.status, 400);
    assert.equal((await action('create', { name: 'Anonymous room' })).status, 401);
  });
  const created = await action('create', { name: 'Persistent expedition', cost: 40 }, owner);
  assert.equal(created.status, 200, JSON.stringify(created.data)); room = created.data.room;
  code = created.data.invites.find(i => i.role === 'reporter').code; viewerCode = created.data.invites.find(i => i.role === 'viewer').code;
  await t.test('Odyle per cube is one server setting, not chosen per room', async () => {
    assert.equal(room.cost, 40);
    assert.equal((await action('settings', { roomId: room.id, cost: 20 }, owner)).status, 404);
    assert.equal((await request('/api/collections/odyle_settings/records', undefined, owner, 'GET')).status, 403);
    assert.equal((await request('/__test__/odyle-per-cube', { value: 30 })).status, 200);
    try {
      assert.equal((await snapshot(owner)).data.room.cost, 30);
      const listed = (await request('/api/odyle/rooms', undefined, owner, 'GET')).data;
      assert.equal(listed.odylePerCube, 30); assert.equal(listed.rooms.find(r => r.id === room.id).cost, 30);
    } finally { await request('/__test__/odyle-per-cube', { value: 40 }); }
    assert.equal((await snapshot(owner)).data.room.cost, 40);
  });
  await t.test('membership is attached to accounts and repeat join creates no duplicate', async () => {
    assert.equal((await action('join', { code }, player)).status, 200);
    assert.equal((await action('join', { code: viewerCode }, viewer)).status, 200);
    const again = await action('join', { code }, player); assert.equal(again.status, 200);
    assert.equal((await snapshot(owner)).data.members.length, 3);
    for (let i = 0; i < 3; i++) { const extra = (await request('/__test__/account', { name: 'Extra ' + i })).data; assert.equal((await action('join', { code }, extra)).status, 200); }
    assert.equal((await snapshot(owner)).data.members.length, 6);
    assert.equal((await snapshot(outsider)).status, 403);
  });
  publisher = (await action('session', {}, player)).data;
  const input = { sessionId: publisher.sessionId, sequence: 1, region: 'GLOBAL_EU', server: 'EU', characterName: 'Main', value: 0, source: 'packet', parserVersion: 'test-fixture-v1', confirmed: true };
  await t.test('each account keeps several character values, including confirmed zero', async () => {
    const one = await action('report', input, player); assert.equal(one.status, 200, JSON.stringify(one.data)); first = one.data.character;
    const two = await action('report', { ...input, sequence: 2, characterName: 'Alt', value: 265 }, player); assert.equal(two.status, 200); second = two.data.character;
    assert.notEqual(first.id, second.id);
    const mine = await request('/api/collections/characters/records', undefined, player, 'GET'); assert.equal(mine.data.items.length, 2);
    assert.equal(mine.data.items.find(c => c.id === first.id).value, 0);
    assert.equal((await request('/api/collections/characters/records/' + first.id, undefined, owner, 'GET')).status, 404);
    assert.equal((await request('/api/collections/characters/records/' + first.id, { value: 999 }, player, 'PATCH')).status, 403);
  });
  await t.test('sharing is explicit per character and room; viewers cannot share or administer', async () => {
    const shared = async () => (await snapshot(owner)).data.members.find(m => m.user === player.record.id).characters;
    assert.equal((await shared()).length, 0);
    const own = (await snapshot(player)).data.members.find(m => m.user === player.record.id).characters;
    assert.deepEqual(own.map(c => c.shared), [false, false]);
    const one = await action('sharing', { roomId: room.id, characterId: first.id, enabled: true }, player);
    assert.equal(one.status, 200, JSON.stringify(one.data)); assert.deepEqual(one.data.sharedCharacters, [first.id]);
    let chars = await shared(); assert.deepEqual(chars.map(c => c.id), [first.id]); assert.equal(chars[0].value, 0); assert.equal(chars[0].shared, true);
    assert.deepEqual((await request('/api/odyle/rooms', undefined, player, 'GET')).data.rooms.find(r => r.id === room.id).sharedCharacters, [first.id]);
    assert.equal((await action('sharing', { roomId: room.id, characterId: first.id, enabled: true }, owner)).status, 403);
    assert.equal((await action('sharing', { roomId: room.id, characterId: first.id, enabled: 'yes' }, player)).status, 400);
    // Older clients without characterId share or hide every saved character at once.
    assert.equal((await action('sharing', { roomId: room.id, enabled: true }, player)).status, 200);
    assert.equal((await shared()).length, 2);
    assert.equal((await action('sharing', { roomId: room.id, characterId: second.id, enabled: false }, player)).status, 200);
    chars = await shared(); assert.deepEqual(chars.map(c => c.id), [first.id]);
    assert.equal(JSON.stringify(chars).includes('readingSession'), false);
    assert.equal((await action('sharing', { roomId: room.id, enabled: true }, viewer)).status, 403);
    assert.equal((await action('invites', { roomId: room.id }, viewer)).status, 403);
    assert.equal((await action('report', { ...input, sequence: 3, characterId: first.id }, outsider)).status, 403);
    const outSession = (await action('session', {}, outsider)).data;
    assert.equal((await action('report', { ...input, sessionId: outSession.sessionId, characterId: first.id }, outsider)).status, 403);
  });
  await t.test('one-time desktop code pairs the same account and cannot be replayed', async () => {
    const pairing = await action('desktop-code', {}, player); assert.equal(pairing.status, 200);
    const paired = await action('pair', { code: pairing.data.code }); assert.equal(paired.status, 200); assert.equal(paired.data.record.id, player.record.id);
    assert.equal((await action('pair', { code: pairing.data.code })).status, 400);
    const refreshed = await request('/api/collections/users/auth-refresh', {}, paired.data); assert.equal(refreshed.status, 200); assert.equal(refreshed.data.record.id, player.record.id);
  });
  await t.test('compiled Windows client pairs and retains saved values', { skip: !process.env.ODYLE_WINDOWS_CHECKS }, async () => {
    const pair = (await action('desktop-code', {}, player)).data;
    const output = execFileSync('dotnet', ['run', '--project', process.env.ODYLE_WINDOWS_CHECKS, '-c', 'Release', '--', url, pair.code], { encoding: 'utf8', timeout: 60000 });
    assert.match(output, /persistent character API check passed/);
  });
  await t.test('sequences are atomic, manual data, unverified adapters and impersonation are rejected', async () => {
    assert.equal((await action('report', input, player)).status, 400);
    const duplicate = await Promise.all([action('report', { ...input, sequence: 3, characterId: first.id }, player), action('report', { ...input, sequence: 3, characterId: first.id }, player)]);
    assert.deepEqual(duplicate.map(r => r.status).sort(), [200, 400]);
    for (const patch of [{ source: 'manual' }, { parserVersion: 'reference-odyle-v1-unverified' }, { value: -1 }, { value: 1.5 }]) assert.equal((await action('report', { ...input, sequence: 4, ...patch }, player)).status, 400);
  });
  await t.test('heartbeat and confidence reset preserve each last saved value', async () => {
    await action('heartbeat', { sessionId: publisher.sessionId, characterId: first.id }, player);
    const saved = (await request('/api/collections/characters/records/' + first.id, undefined, player, 'GET')).data;
    await action('invalidate', { characterId: first.id, sessionId: publisher.sessionId }, player);
    const stale = (await request('/api/collections/characters/records/' + first.id, undefined, player, 'GET')).data;
    assert.equal(stale.value, saved.value); assert.equal(stale.confirmed, true); assert.equal(stale.valid, false); assert.equal(stale.lastReadingAt, saved.lastReadingAt);
    publisher = (await action('session', { previousSessionId: publisher.sessionId }, player)).data;
    assert.equal((await request('/api/collections/characters/records/' + second.id, undefined, player, 'GET')).data.value, 265);
  });
  await t.test('live room subscription requires membership; revoked listeners lose access', async () => {
    const stream = await connect(url, viewer.token, 'odyle.room.' + room.id);
    try {
      await action('sharing', { roomId: room.id, enabled: true }, owner); assert.equal((await stream.next())?.data.refresh, true);
      const memberId = (await snapshot(owner)).data.members.find(m => m.user === viewer.record.id).id;
      await action('revoke', { roomId: room.id, memberId }, owner);
      await action('sharing', { roomId: room.id, enabled: false }, owner);
      assert.equal(await stream.next(250), null); assert.equal((await snapshot(viewer)).status, 403);
    } finally { await stream.close(); }
    await assert.rejects(() => connect(url, outsider.token, 'odyle.room.' + room.id));
  });
  await t.test('rooms and multiple character values survive a server restart', async () => {
    await stop(); await start();
    const roomList = await request('/api/odyle/rooms', undefined, player, 'GET'); assert.equal(roomList.data.rooms[0].id, room.id);
    const mine = await request('/api/collections/characters/records', undefined, player, 'GET'); assert.equal(mine.data.items.length, 2); assert.equal(mine.data.items.find(c => c.id === second.id).value, 265);
  });
  await t.test('leaving and deleting rooms retain characters on the Discord account', async () => {
    assert.equal((await action('leave', { roomId: room.id }, player)).status, 200);
    assert.equal((await snapshot(player)).status, 403);
    assert.equal((await request('/api/collections/characters/records', undefined, player, 'GET')).data.items.length, 2);
    assert.equal((await action('close', { roomId: room.id }, owner)).status, 200);
    assert.equal((await request('/api/collections/characters/records/' + second.id, undefined, player, 'GET')).data.value, 265);
  });
});
