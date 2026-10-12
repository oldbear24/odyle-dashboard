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
let child, directory, owner, player, viewer, outsider, room, code, viewerCode, publisher, first, second, oauthServer, oauthUrl, legacyId;
async function request(path, body, auth, method = 'POST') {
  const res = await fetch(url + path, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth.token } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, data: await res.json() };
}
const action = (name, body, auth) => request('/api/odyle/' + name, body, auth);
const snapshot = auth => request('/api/odyle/snapshot/' + room.id, undefined, auth, 'GET');
async function stop() { if (child && child.exitCode === null) { const closed = new Promise(resolve => child.once('exit', resolve)); child.kill(); await closed; } }
async function start() {
  child = spawn(resolve('.runtime', process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase'), ['serve', '--http=127.0.0.1:18090', '--dir=' + join(directory, 'data'), '--hooksDir=' + join(directory, 'hooks'), '--migrationsDir=' + join(directory, 'migrations'), '--automigrate=false'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DISCORD_CLIENT_ID: 'test-application', DISCORD_CLIENT_SECRET: 'test-only-secret' } });
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
  directory = await mkdtemp(join(tmpdir(), 'odyle-account-test-'));
  await cp(resolve('backend/pb_hooks'), join(directory, 'hooks'), { recursive: true });
  await cp(resolve('backend/pb_migrations'), join(directory, 'migrations'), { recursive: true, filter: path => !path.endsWith('1791763203_packet_only.js') });
  // Only this disposable test backend approves the synthetic fixture adapter.
  await writeFile(join(directory, 'hooks', 'lib', 'protocols.cjs'), "module.exports = { verifiedAdapters: ['test-fixture-v1'] };");
  // Synthetic account issuance exists only in the temporary test hooks. There
  // is no password login, test auth route or Discord bypass in production.
  await writeFile(join(directory, 'hooks', 'fixtures.pb.js'), `routerAdd('POST','/__test__/account',(e)=>{const name=e.requestInfo().body.name; let user; try{user=e.app.findFirstRecordByData('users','displayName',name);}catch{user=new Record(e.app.findCollectionByNameOrId('users'));user.set('email',$security.randomString(20)+'@test.invalid');user.setPassword($security.randomString(48));user.set('displayName',name);e.app.save(user);}return e.json(200,{token:user.newAuthToken(),record:user});});`);
  await writeFile(join(directory, 'hooks', 'oauth-fixture.pb.js'), `routerAdd('POST','/__test__/oauth-provider',e => { const users=e.app.findCollectionByNameOrId('users'); users.oauth2={enabled:true,providers:[{name:'discord',clientId:'test-application',clientSecret:'test-only-secret',tokenURL:'${oauthUrl}/token',userInfoURL:'${oauthUrl}/user'}]};e.app.save(users); return e.json(200,{success:true}); });`);
  await writeFile(join(directory, 'hooks', 'legacy-fixture.pb.js'), `routerAdd('POST','/__test__/legacy', e => { const c=new Record(e.app.findCollectionByNameOrId('characters')); c.set('user',e.requestInfo().body.user); c.set('characterName','Legacy'); c.set('server','EU'); c.set('region','GLOBAL_EU'); c.set('value',123); c.set('confirmed',true); c.set('valid',true); c.set('source','manual'); c.set('lastReadingAt','2026-10-12 12:00:00.000Z'); e.app.save(c); return e.json(200,c); });`);
  await start();
  const users = await Promise.all(['Owner', 'Player', 'Viewer', 'Outsider'].map(name => request('/__test__/account', { name })));
  for (const result of users) assert.equal(result.status, 200, JSON.stringify(result.data));
  [owner, player, viewer, outsider] = users.map(r => r.data);
  const legacy = await request('/__test__/legacy', { user: outsider.record.id }); assert.equal(legacy.status, 200); legacyId = legacy.data.id;
  await stop();
  await cp(resolve('backend/pb_migrations/1791763203_packet_only.js'), join(directory, 'migrations/1791763203_packet_only.js'));
  await start();
});
after(async () => { await stop(); if (oauthServer) await new Promise(resolve => oauthServer.close(resolve)); if (directory) await rm(directory, { recursive: true, force: true }); });
test('packet-only upgrade preserves legacy totals and removes current confidence', async () => {
  const legacy = await request('/api/collections/characters/records/' + legacyId, undefined, outsider, 'GET');
  assert.equal(legacy.status, 200); assert.equal(legacy.data.value, 123); assert.equal(legacy.data.confirmed, true); assert.equal(legacy.data.valid, false);
  assert.equal(legacy.data.source, 'manual'); assert.equal(legacy.data.lastReadingAt, '2026-10-12 12:00:00.000Z');
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
  await t.test('sharing is explicit per room; viewers cannot share or administer', async () => {
    assert.equal((await snapshot(owner)).data.members.find(m => m.user === player.record.id).characters.length, 0);
    assert.equal((await action('sharing', { roomId: room.id, enabled: true }, player)).status, 200);
    const chars = (await snapshot(owner)).data.members.find(m => m.user === player.record.id).characters;
    assert.equal(chars.length, 2); assert.equal(chars.find(c => c.id === first.id).value, 0);
    assert.equal(JSON.stringify(chars).includes('readingSession'), false);
    assert.equal((await action('sharing', { roomId: room.id, enabled: true }, viewer)).status, 403);
    assert.equal((await action('settings', { roomId: room.id, cost: 20 }, viewer)).status, 403);
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
      await action('settings', { roomId: room.id, cost: 30 }, owner); assert.equal((await stream.next())?.data.refresh, true);
      const memberId = (await snapshot(owner)).data.members.find(m => m.user === viewer.record.id).id;
      await action('revoke', { roomId: room.id, memberId }, owner);
      await action('settings', { roomId: room.id, cost: 40 }, owner);
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
