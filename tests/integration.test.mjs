import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { connect } from './sse.mjs';
import { createServer } from 'node:http';
const url = 'http://127.0.0.1:18090';
let child, directory, owner, player, viewer, outsider, room, code, viewerCode, publisher, first, second, oauthServer, oauthUrl, playncServer, playncUrl, legacyId, legacyRoomId;
let releaseServer, releaseUrl, releaseHits = 0, releaseDown = false;
// Stands in for Discord's webhook API; `discordAnswer` is the status it answers with.
let discordServer, discordUrl, discordPosts = [], discordAnswer = 204;
// Synthetic official portraits served by the PLAYNC stand-in; bump the version to change one.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
let portraitVersion = 1;
// The first start leaves these migrations out, so the legacy data the upgrade tests
// check is written to an older database; every later start applies them.
const upgrades = ['1791763203_packet_only.js', '1791763204_character_sharing.js'];
let upgraded = false;
async function request(path, body, auth, method = 'POST') {
  const res = await fetch(url + path, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth.token } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, data: await res.json() };
}
const action = (name, body, auth) => request('/api/odyle/' + name, body, auth);
// Realtime news is delivered a moment after a change; this delivers what is pending, so a
// stream opened next hears only of later changes.
const settle = async () => assert.equal((await request('/__test__/settle', {})).status, 200);
const snapshot = auth => request('/api/odyle/snapshot/' + room.id, undefined, auth, 'GET');
async function snapshot2(id, auth) { const res = await request('/api/odyle/snapshot/' + id, undefined, auth, 'GET'); assert.equal(res.status, 200, JSON.stringify(res.data)); return res.data; }
async function stop() { if (child && child.exitCode === null) { const closed = new Promise(resolve => child.once('exit', resolve)); child.kill(); await closed; } }
async function start() {
  // The test build of the backend (npm run backend:build): it approves only the synthetic
  // test-fixture-v1 adapter and adds the /__test__ routes (backend/odyle/testing.go).
  child = spawn(resolve('.runtime', process.platform === 'win32' ? 'odyle-test.exe' : 'odyle-test'), ['serve', '--http=127.0.0.1:18090', '--dir=' + join(directory, 'data')], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DISCORD_CLIENT_ID: 'test-application', DISCORD_CLIENT_SECRET: 'test-only-secret', PLAYNC_SEARCH_URL: playncUrl + '/search', PLAYNC_IMAGE_URL: playncUrl, ODYLE_WINDOWS_RELEASE_URL: releaseUrl, ODYLE_DISCORD_WEBHOOK_BASE: discordUrl, ODYLE_TEST_SKIP_MIGRATIONS: upgraded ? '' : upgrades.join(',') } });
  let log = ''; child.stdout.on('data', v => log += v); child.stderr.on('data', v => log += v);
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(url + '/api/health')).ok) {
        const configured = await request('/__test__/oauth-provider', { url: oauthUrl });
        assert.equal(configured.status, 200, JSON.stringify(configured.data)); return;
      }
    } catch {} await delay(100);
  }
  throw new Error('The backend failed to start (build it with npm run backend:build): ' + log.replace(/http[^\s]*pbinstall[^\s]*/g, '[redacted]'));
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
  // Stands in for GitHub's "latest release" API of the Windows companion repository.
  releaseServer = createServer((req, res) => {
    releaseHits++;
    if (releaseDown) { res.writeHead(503); return res.end('{}'); }
    const asset = (name, size) => ({ name, size, browser_download_url: 'https://github.com/oldbear24/odyle-windows/releases/download/v0.5.0.2/' + name });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ tag_name: 'v0.5.0.2', name: 'Odyle 0.5.0.2', html_url: 'https://github.com/oldbear24/odyle-windows/releases/tag/v0.5.0.2', published_at: '2026-10-13T22:34:09Z', draft: false, prerelease: false, assets: [asset('odyle-0.5.0.2-win-x64-self-contained.zip', 71595826), asset('odyle-0.5.0.2-win-x64-self-contained.zip.sha256', 108), asset('odyle-0.5.0.2-win-x64.zip', 217557), asset('odyle-0.5.0.2-win-x64.zip.sha256', 93), asset('odyle-0.5.0.2-win-arm64.zip', 210000), asset('odyle-0.5.0.2-win-arm64-self-contained.zip', 70000000), asset('odyle-0.5.0.2-win-x64-setup.exe', 52428800), asset('odyle-0.5.0.2-win-x64-setup.exe.sha256', 100)] }));
  });
  await new Promise(resolve => releaseServer.listen(0, '127.0.0.1', resolve));
  releaseUrl = 'http://127.0.0.1:' + releaseServer.address().port + '/releases/latest';
  discordServer = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    discordPosts.push({ path: req.url, body: JSON.parse(body || '{}') }); res.writeHead(discordAnswer); res.end(discordAnswer === 204 ? '' : '{}');
  });
  await new Promise(resolve => discordServer.listen(0, '127.0.0.1', resolve));
  discordUrl = 'http://127.0.0.1:' + discordServer.address().port;
  directory = await mkdtemp(join(tmpdir(), 'odyle-account-test-'));
  // Synthetic accounts, the jobs run on demand and records written directly come from the
  // test build's /__test__ routes. There is no password login, test auth route or
  // Discord bypass in production.
  await start();
  const users = await Promise.all(['Owner', 'Player', 'Viewer', 'Outsider'].map(name => request('/__test__/account', { name })));
  for (const result of users) assert.equal(result.status, 200, JSON.stringify(result.data));
  [owner, player, viewer, outsider] = users.map(r => r.data);
  const legacy = await request('/__test__/legacy', { user: outsider.record.id }); assert.equal(legacy.status, 200); legacyId = legacy.data.id;
  const legacyRoom = await request('/__test__/legacy-room', { user: outsider.record.id }); assert.equal(legacyRoom.status, 200, JSON.stringify(legacyRoom.data)); legacyRoomId = legacyRoom.data.id;
  await stop(); upgraded = true;
  await start();
});
after(async () => { await stop(); for (const server of [oauthServer, playncServer, releaseServer, discordServer]) if (server) await new Promise(resolve => server.close(resolve)); if (directory) await rm(directory, { recursive: true, force: true }); });
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
  // The dashboard replaces the placeholder name through the profile route; the users
  // collection itself is closed to writes, so its checks cannot be bypassed.
  const profile = await action('profile', { displayName: 'OAuth Tester' }, firstLogin.data);
  assert.equal(profile.status, 200, JSON.stringify(profile.data)); assert.equal(profile.data.record.displayName, 'OAuth Tester');
  for (const change of [{ displayName: '   ' }, { lastActiveAt: '2099-01-01 00:00:00.000Z' }, { email: 'other@test.invalid' }])
    assert.equal((await request('/api/collections/users/records/' + firstLogin.data.record.id, change, firstLogin.data, 'PATCH')).status, 403);
  const created = await action('create', { name: 'OAuth room' }, firstLogin.data);
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const again = await request('/api/collections/users/auth-with-oauth2', credentials);
  assert.equal(again.status, 200, JSON.stringify(again.data));
  assert.equal(again.data.meta.isNew, false);
  assert.equal(again.data.record.id, firstLogin.data.record.id);
  const saved = await request('/api/odyle/rooms', undefined, again.data, 'GET');
  assert.equal(saved.data.rooms[0].id, created.data.room.id);
  // The data export names the Discord identity the account signs in with.
  const exported = await request('/api/odyle/export', undefined, again.data, 'GET'); assert.equal(exported.status, 200, JSON.stringify(exported.data));
  assert.deepEqual(exported.data.account.signIns.map(a => [a.provider, a.providerId]), [['discord', '100000000000000001']]);
  assert.equal(exported.data.account.email, 'oauth@test.invalid');
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

  // A saved character gets its portrait right away, without waiting for the job.
  for (let i = 0; i < 50 && !(await own()).portrait; i++) await delay(50);
  assert.match((await own()).portrait, /\.png$/);
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
  await settle(); const stream = await connect(url, watcher.token, 'odyle.room.' + roomId);
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
test('accounts keep private daily and weekly checklists that reset by time', async () => {
  const [me, other] = await Promise.all(['Task owner', 'Task other'].map(async name => (await request('/__test__/account', { name })).data));
  const list = auth => request('/api/odyle/tasks', undefined, auth, 'GET');
  const change = (body, auth = me) => action('task', body, auth);
  // Defaults match the Global service: 07:00 UTC daily, Wednesday weekly; both are server settings.
  const empty = await list(me); assert.equal(empty.status, 200, JSON.stringify(empty.data));
  assert.deepEqual(empty.data.tasks, []); assert.deepEqual(empty.data.resets, { dailyResetHour: 7, weeklyResetDay: 'wednesday' }); assert.ok(empty.data.serverNow);
  const added = await change({ title: '  Daily   dungeon ', cadence: 'daily' }); assert.equal(added.status, 200, JSON.stringify(added.data));
  assert.equal((await change({ title: 'Weekly boss', cadence: 'weekly' })).status, 200);
  for (const bad of [{ title: '', cadence: 'daily' }, { title: 'x'.repeat(61), cadence: 'daily' }, { title: 'Run', cadence: 'monthly' }, { title: 'Run' }]) assert.equal((await change(bad)).status, 400);
  const mine = (await list(me)).data.tasks;
  assert.deepEqual(mine.map(t => [t.title, t.cadence, t.doneAt]), [['Daily dungeon', 'daily', ''], ['Weekly boss', 'weekly', '']]);
  const [daily, weekly] = mine;
  // Checking stores the time and unchecking clears it; clients compare it with the reset.
  const before = Date.now() - 1000, done = await change({ id: daily.id, done: true }); assert.equal(done.status, 200, JSON.stringify(done.data));
  const stamp = done.data.tasks.find(t => t.id === daily.id).doneAt; assert.ok(Date.parse(stamp.replace(' ', 'T')) >= before, stamp);
  assert.equal(done.data.tasks.find(t => t.id === weekly.id).doneAt, '');
  assert.equal((await change({ id: daily.id, done: false })).data.tasks[0].doneAt, '');
  assert.equal((await change({ id: daily.id })).status, 400);
  // Private: another account neither sees nor changes them, and the collection is closed.
  assert.deepEqual((await list(other)).data.tasks, []);
  assert.equal((await change({ id: daily.id, done: true }, other)).status, 403);
  assert.equal((await change({ id: daily.id, remove: true }, other)).status, 403);
  assert.equal((await change({ id: 'missingtaskid00', done: true })).status, 404);
  assert.equal((await request('/api/collections/user_tasks/records', undefined, me, 'GET')).status, 403);
  assert.equal((await list()).status, 401);
  // Superusers move the reset in odyle_settings and every client follows.
  assert.equal((await request('/__test__/reset-times', { hour: 0, day: 'monday' })).status, 200);
  try { assert.deepEqual((await list(me)).data.resets, { dailyResetHour: 0, weeklyResetDay: 'monday' }); }
  finally { assert.equal((await request('/__test__/reset-times', { hour: 7, day: 'wednesday' })).status, 200); }
  const removed = await change({ id: weekly.id, remove: true }); assert.equal(removed.status, 200, JSON.stringify(removed.data));
  assert.deepEqual(removed.data.tasks.map(t => t.id), [daily.id]);
});
test('superusers watch connected apps and their packets live and edit the server settings', async () => {
  const operator = (await request('/__test__/superuser', {})).data, reader = (await request('/__test__/account', { name: 'Monitored reader' })).data;
  const monitor = auth => request('/api/odyle/admin/monitor', undefined, auth, 'GET');
  // Only superusers reach the routes and the live topic.
  assert.equal((await monitor()).status, 401); assert.equal((await monitor(reader)).status, 403);
  await assert.rejects(() => connect(url, reader.token, 'odyle.admin.packets'));
  const stream = await connect(url, operator.token, 'odyle.admin.packets');
  try {
    const session = (await action('session', { appVersion: '0.6.0.12' }, reader)).data;
    const opened = (await stream.next())?.data.packet; assert.equal(opened.kind, 'session'); assert.equal(opened.appVersion, '0.6.0.12');
    const reading = { sessionId: session.sessionId, sequence: 1, characterName: 'Watched', server: 'Lumiel', region: 'GLOBAL_EU', value: 390, source: 'packet', parserVersion: 'test-fixture-v1', confirmed: true, token: 'never-listed' };
    const saved = await action('report', reading, reader); assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const live = (await stream.next())?.data.packet;
    assert.equal(live.kind, 'report'); assert.equal(live.ok, true); assert.equal(live.account, 'Monitored reader'); assert.equal(live.user, reader.record.id); assert.equal(live.source, 'app');
    assert.equal(live.characterName, 'Watched'); assert.equal(live.value, 390); assert.equal(live.sequence, 1); assert.equal(live.parserVersion, 'test-fixture-v1'); assert.equal('token' in live, false);
    // Rejected requests are listed with their reason; heartbeats name their character.
    assert.equal((await action('report', reading, reader)).status, 400);
    const rejected = (await stream.next())?.data.packet; assert.equal(rejected.ok, false); assert.equal(rejected.error, 'Outdated reading.');
    assert.equal((await action('heartbeat', { sessionId: session.sessionId, characterId: saved.data.character.id }, reader)).status, 200);
    assert.equal((await stream.next())?.data.packet.characterName, 'Watched');
    // Dashboard requests are packets too, with their safe fields only: never the pairing code.
    const code = (await action('desktop-code', {}, reader)).data.code;
    const web = (await stream.next())?.data.packet; assert.equal(web.kind, 'desktop-code'); assert.equal(web.ok, true); assert.equal(web.account, 'Monitored reader'); assert.equal(web.source, 'web');
    const data = (await monitor(operator)).data, row = data.apps.find(a => a.sessionId === session.sessionId);
    assert.equal(row.account, 'Monitored reader'); assert.equal(row.readings, 1); assert.ok(row.lastContactAt >= row.connectedAt);
    assert.equal(row.appVersion, '0.6.0.12'); assert.equal(row.device, ''); assert.equal(data.latestVersion, '0.5.0.2');
    // Rows keep a fixed order by account and connection time, whatever sent the last heartbeat.
    const order = data.apps.map(a => a.account.toLowerCase() + '\u0000' + a.connectedAt); assert.deepEqual(order, [...order].sort());
    assert.equal(row.character.characterName, 'Watched'); assert.equal(row.character.value, 390); assert.equal(row.character.valid, true);
    assert.deepEqual(data.packets.slice(-5).map(p => [p.kind, p.ok]), [['session', true], ['report', true], ['report', false], ['heartbeat', true], ['desktop-code', true]]);
    assert.equal(JSON.stringify(data).includes('never-listed'), false); assert.equal(JSON.stringify(data).includes(code), false);
  } finally { await stream.close(); }
  // Server-wide settings: validated, partial changes keep the rest, and every client follows.
  const settings = (body, auth = operator) => request('/api/odyle/admin/settings', body, auth, body === undefined ? 'GET' : 'POST');
  const initial = { odylePerCube: 40, dailyResetHour: 7, weeklyResetDay: 'wednesday', inactiveAccountDays: 0, dungeons: [], announcement: '', announcementLevel: 'info', portraitsPaused: false, remindersPaused: false, pairingPaused: false, adapters: { extra: [], disabled: [] } };
  assert.deepEqual((await settings()).data.settings, initial);
  assert.equal((await settings({ odylePerCube: 50 }, reader)).status, 403); assert.equal((await settings(undefined, reader)).status, 403);
  for (const bad of [{ odylePerCube: 0 }, { odylePerCube: 1001 }, { odylePerCube: '50' }, { dailyResetHour: 24 }, { dailyResetHour: 1.5 }, { weeklyResetDay: 'someday' }, { inactiveAccountDays: 10 }, { inactiveAccountDays: -1 }, { dungeons: 'Fire Temple' }, { dungeons: [''] }, { dungeons: ['x'.repeat(61)] }]) assert.equal((await settings(bad)).status, 400, JSON.stringify(bad));
  try {
    const changed = await settings({ odylePerCube: 50, dailyResetHour: 0, weeklyResetDay: 'monday' }); assert.equal(changed.status, 200, JSON.stringify(changed.data));
    assert.equal((await request('/api/odyle/rooms', undefined, reader, 'GET')).data.odylePerCube, 50);
    assert.deepEqual((await request('/api/odyle/tasks', undefined, reader, 'GET')).data.resets, { dailyResetHour: 0, weeklyResetDay: 'monday' });
    assert.deepEqual((await settings({ odylePerCube: 45 })).data.settings, { ...initial, odylePerCube: 45, dailyResetHour: 0, weeklyResetDay: 'monday' });
    // The dungeon catalog keeps the first spelling of each name.
    assert.deepEqual((await settings({ dungeons: [' Fire   Temple ', 'fire temple', 'Udas Temple'] })).data.settings.dungeons, ['Fire Temple', 'Udas Temple']);
  } finally { assert.equal((await settings({ odylePerCube: 40, dailyResetHour: 7, weeklyResetDay: 'wednesday', dungeons: [] })).status, 200); }
  // The dashboard extension: a stable entry that imports the page under its content hash.
  assert.match(await (await fetch(url + '/_/extensions.js')).text(), /extensions\/odyle\/odyle\.js\?v=/);
  const { version } = (await request('/api/odyle/admin/ui', undefined, null, 'GET')).data; assert.match(version, /^[0-9a-f]{16}$/);
  const page = await fetch(url + '/_/extensions/odyle/odyle.js?v=' + version); assert.equal(page.status, 200); assert.match(await page.text(), /export function monitorPage/);
});
test('superusers follow background jobs, run them by hand and pause parts of Odyle under server controls', async () => {
  const operator = (await request('/__test__/superuser', {})).data, member = (await request('/__test__/account', { name: 'Controlled member' })).data;
  const jobs = auth => request('/api/odyle/admin/jobs', undefined, auth, 'GET'), run = (name, auth = operator) => request('/api/odyle/admin/jobs/' + name, {}, auth);
  const settings = body => request('/api/odyle/admin/settings', body, operator, body === undefined ? 'GET' : 'POST');
  assert.equal((await jobs(null)).status, 401); assert.equal((await jobs(member)).status, 403); assert.equal((await run('odyle-expiry', member)).status, 403);
  const listed = (await jobs(operator)).data;
  assert.deepEqual(listed.jobs.map(j => [j.name, j.manual, j.state]), [['odyle-expiry', true, 'active'], ['odyle-portraits', true, 'active'], ['odyle-reminders', true, 'active'], ['odyle-retention', false, 'off']]);
  assert.ok(Date.parse(listed.startedAt) <= Date.now());
  // A run by hand is recorded with its result; the account clean-up only runs on its schedule.
  const ran = await run('odyle-expiry'); assert.equal(ran.status, 200, JSON.stringify(ran.data));
  const expiry = ran.data.jobs.find(j => j.name === 'odyle-expiry');
  assert.equal(expiry.manual, true); assert.equal(expiry.byHand, true); assert.equal(expiry.failed, 0); assert.equal(typeof ran.data.result.done, 'number'); assert.ok(expiry.runs >= 1); assert.ok(Date.parse(expiry.lastRunAt) <= Date.now());
  assert.equal((await run('odyle-retention')).status, 400); assert.equal((await run('odyle-nothing')).status, 404);
  const base = (await settings()).data.settings;
  try {
    for (const bad of [{ portraitsPaused: 'yes' }, { pairingPaused: 1 }, { announcement: 5 }, { announcement: 'x'.repeat(301) }, { announcementLevel: 'loud' }, { adapters: ['test-fixture-v1'] }, { adapters: { extra: ['bad name'], disabled: [] } }, { adapters: { extra: [], disabled: ['test-fixture-v1'] } }, { adapters: { extra: Array.from({ length: 21 }, (_, i) => 'extra-' + i), disabled: [] } }]) assert.equal((await settings(bad)).status, 400, JSON.stringify(bad));
    // Switches pause jobs and new pairings; the announcement is one line of text.
    const saved = await settings({ portraitsPaused: true, remindersPaused: true, pairingPaused: true, announcement: '  Maintenance\n at 10:00   UTC  ', announcementLevel: 'warning' }); assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.deepEqual(saved.data.settings, { ...base, portraitsPaused: true, remindersPaused: true, pairingPaused: true, announcement: 'Maintenance at 10:00 UTC', announcementLevel: 'warning' });
    for (const name of ['odyle-portraits', 'odyle-reminders']) {
      const paused = await run(name); assert.equal(paused.status, 200, JSON.stringify(paused.data));
      assert.equal(paused.data.result.skipped, 'paused'); assert.equal(paused.data.jobs.find(j => j.name === name).state, 'paused');
    }
    const notice = { text: 'Maintenance at 10:00 UTC', level: 'warning' };
    assert.deepEqual((await request('/api/odyle/rooms', undefined, member, 'GET')).data.announcement, notice);
    assert.deepEqual((await request('/api/odyle/announcement', undefined, null, 'GET')).data.announcement, notice);
    const link = await action('desktop-code', {}, member); assert.equal(link.status, 400); assert.equal(link.data.message, 'Pairing new PCs is paused for now. Try again later.');
    const pairing = await action('pair', { code: 'ABCDEFGH23456789', name: 'Paused PC' }); assert.equal(pairing.status, 400); assert.equal(pairing.data.message, 'Pairing new PCs is paused for now. Try again later.');
    const refused = (await request('/api/odyle/admin/monitor', undefined, operator, 'GET')).data.packets.find(p => p.kind === 'pair' && p.name === 'Paused PC');
    assert.equal(refused.ok, false); assert.equal(refused.error, 'Pairing new PCs is paused for now. Try again later.'); assert.equal(JSON.stringify(refused).includes('ABCDEFGH23456789'), false);
    // Packet adapters: a new decoder shows up rejected, can be accepted before a deploy and a built-in one stopped.
    const session = (await action('session', {}, member)).data;
    const reading = (sequence, parserVersion) => action('report', { sessionId: session.sessionId, sequence, characterName: 'Adapted', server: 'Lumiel', region: 'GLOBAL_EU', value: 100 + sequence, source: 'packet', parserVersion, confirmed: true }, member);
    assert.equal((await reading(1, 'next-decoder-v2')).status, 400);
    const seen = (await settings()).data; assert.deepEqual(seen.builtInAdapters, ['test-fixture-v1']); assert.deepEqual(seen.acceptedAdapters, ['test-fixture-v1']);
    assert.ok(seen.seenAdapters.some(a => a.name === 'next-decoder-v2' && a.rejected >= 1 && a.accepted === 0));
    assert.deepEqual((await settings({ adapters: { extra: [' next-decoder-v2 ', 'test-fixture-v1', 'next-decoder-v2'], disabled: ['test-fixture-v1', 'unknown-v9'] } })).data.settings.adapters, { extra: ['next-decoder-v2'], disabled: ['test-fixture-v1'] });
    assert.equal((await reading(2, 'next-decoder-v2')).status, 200);
    assert.equal((await reading(3, 'test-fixture-v1')).status, 400);
    assert.deepEqual((await settings()).data.acceptedAdapters, ['next-decoder-v2']);
  } finally {
    assert.equal((await settings({ portraitsPaused: false, remindersPaused: false, pairingPaused: false, announcement: '', announcementLevel: 'info', adapters: { extra: [], disabled: [] } })).status, 200);
  }
  assert.equal((await request('/api/odyle/announcement', undefined, null, 'GET')).data.announcement, null);
  assert.equal((await request('/api/odyle/rooms', undefined, member, 'GET')).data.announcement, null);
  assert.deepEqual((await jobs(operator)).data.jobs.map(j => j.state), ['active', 'active', 'active', 'off']);
  // A body id never replaces a packet's own number.
  const added = (await action('task', { title: 'Watched task', cadence: 'daily' }, member)).data.tasks.find(x => x.title === 'Watched task');
  assert.equal((await action('task', { id: added.id, done: true }, member)).status, 200);
  const ticked = (await request('/api/odyle/admin/monitor', undefined, operator, 'GET')).data.packets.filter(p => p.kind === 'task').pop();
  assert.equal(ticked.taskId, added.id); assert.equal(ticked.done, true); assert.equal(typeof ticked.id, 'number');
  // The Odyle extension registers the new pages.
  const { version } = (await request('/api/odyle/admin/ui', undefined, null, 'GET')).data;
  assert.match(await (await fetch(url + '/_/extensions/odyle/odyle.js?v=' + version)).text(), /export function jobsPage[\s\S]*export function controlsPage/);
  assert.match(await (await fetch(url + '/_/extensions.js')).text(), /#\/odyle\/jobs[\s\S]*#\/odyle\/controls/);
});
test('superusers read the server status: stored data, connected app versions, the release lookup and the last hour of traffic', async () => {
  const operator = (await request('/__test__/superuser', {})).data, member = (await request('/__test__/account', { name: 'Counted member' })).data;
  const status = auth => request('/api/odyle/admin/status', undefined, auth, 'GET');
  assert.equal((await status()).status, 401); assert.equal((await status(member)).status, 403);
  const route = (data, kind) => data.traffic.routes.find(r => r.kind === kind) || { count: 0, rejected: 0 };
  const reason = (data, kind, message) => data.traffic.errors.find(r => r.kind === kind && r.message === message) || { count: 0 };
  const before = (await status(operator)).data;
  const session = (await action('session', { appVersion: '0.6.0.13' }, member)).data;
  const reading = { sessionId: session.sessionId, sequence: 1, characterName: 'Counted', server: 'Lumiel', region: 'GLOBAL_EU', value: 120, source: 'packet', parserVersion: 'test-fixture-v1', confirmed: true };
  assert.equal((await action('report', reading, member)).status, 200);
  assert.equal((await action('report', reading, member)).status, 400);
  assert.equal((await request('/api/odyle/rooms', undefined, member, 'GET')).status, 200);
  assert.equal((await request('/api/odyle/snapshot/missingroom0000', undefined, member, 'GET')).status, 403);
  const data = (await status(operator)).data;
  assert.ok(Date.parse(data.startedAt) <= Date.parse(data.serverNow));
  assert.ok(data.database.dataBytes > 0); assert.equal(typeof data.database.logsBytes, 'number');
  // Packets count with their source, reads as reads; rejections keep their reason.
  assert.equal(data.traffic.minutes.length, 60); assert.ok(Date.parse(data.traffic.minutes[59].at) <= Date.parse(data.serverNow));
  assert.deepEqual(Object.keys(data.traffic.minutes[59]).sort(), ['app', 'at', 'read', 'rejected', 'web']);
  assert.deepEqual([route(data, 'report').source, route(data, 'session').source, route(data, 'GET rooms').source, route(data, 'GET snapshot').source], ['app', 'app', 'read', 'read']);
  assert.equal(route(data, 'report').count, route(before, 'report').count + 2); assert.equal(route(data, 'report').rejected, route(before, 'report').rejected + 1);
  assert.equal(route(data, 'GET rooms').count, route(before, 'GET rooms').count + 1); assert.equal(route(data, 'GET snapshot').rejected, route(before, 'GET snapshot').rejected + 1);
  assert.equal(reason(data, 'report', 'Outdated reading.').count, reason(before, 'report', 'Outdated reading.').count + 1);
  assert.equal(reason(data, 'GET snapshot', 'You are not a member of this room.').count, reason(before, 'GET snapshot', 'You are not a member of this room.').count + 1);
  assert.ok(data.traffic.total.count >= before.traffic.total.count + 5); assert.ok(data.traffic.total.p95Ms >= data.traffic.total.medianMs);
  for (const key of ['averageMs', 'medianMs', 'p95Ms', 'maxMs']) assert.equal(typeof route(data, 'report')[key], 'number');
  // The superuser routes themselves are never counted.
  assert.equal(data.traffic.routes.some(r => r.kind.includes('admin') || r.kind === 'GET status'), false);
  // What the database holds, and the connected apps by version.
  assert.ok(data.counts.accounts.total >= 2 && data.counts.accounts.active24h >= 1 && data.counts.accounts.active7d >= data.counts.accounts.active24h);
  assert.ok(data.counts.characters.live >= 1 && data.counts.characters.total >= data.counts.characters.live);
  assert.ok(data.counts.readerSessions.connected >= 1 && data.counts.readerSessions.open >= data.counts.readerSessions.connected);
  for (const [name, keys] of Object.entries({ rooms: ['total', 'discordReminders'], pairedPcs: ['total'], plannedRuns: ['total', 'upcoming'], historyPoints: ['total'], tasks: ['total'] })) for (const key of keys) assert.equal(typeof data.counts[name][key], 'number', name + '.' + key);
  assert.equal(data.versions.find(v => v.version === '0.6.0.13')?.apps, 1);
  // The release lookup: GitHub's last answer and when it was asked.
  assert.equal(data.release.version, '0.5.0.2'); assert.equal(data.release.publishedAt, '2026-10-13T22:34:09Z'); assert.equal(data.release.error, ''); assert.equal(data.release.repository, 'oldbear24/odyle-windows');
  assert.ok(Date.parse(data.release.fetchedAt) <= Date.parse(data.release.checkedAt));
  // Nothing an account keeps secret reaches the page.
  assert.equal(JSON.stringify(data).includes(member.token), false); assert.equal(JSON.stringify(data).includes('Counted member'), false);
  // The build and the Go runtime; Go's profiles for superusers only.
  assert.equal(typeof data.build.version, 'string'); assert.match(data.build.go, /^go1\./); assert.match(data.build.pocketbase, /^v0\./);
  for (const key of ['goroutines', 'heapBytes', 'systemBytes', 'gcCycles', 'cpus', 'maxProcs', 'realtimeClients']) assert.equal(typeof data.runtime[key], 'number', key);
  assert.ok(data.runtime.goroutines > 0);
  const profile = (name, auth) => fetch(url + '/api/odyle/admin/pprof/' + name, { headers: auth ? { Authorization: auth.token } : {} });
  const heap = await profile('heap', operator); assert.equal(heap.status, 200);
  assert.deepEqual([...new Uint8Array(await heap.arrayBuffer()).slice(0, 2)], [0x1f, 0x8b]);
  assert.equal((await profile('heap')).status, 401); assert.equal((await profile('heap', member)).status, 403); assert.equal((await profile('nothing', operator)).status, 404);
});
test('accounts see their history, delete characters, export their data, sign out everywhere and delete themselves', async () => {
  const [holder, heir, watcher, loner, stranger] = await Promise.all(['Life holder', 'Life heir', 'Life watcher', 'Life loner', 'Life stranger'].map(async name => (await request('/__test__/account', { name })).data));
  const made = (await action('create', { name: 'Inherited room' }, holder)).data, roomId = made.room.id;
  for (const [auth, role] of [[heir, 'reporter'], [watcher, 'viewer']]) assert.equal((await request('/__test__/member', { room: roomId, user: auth.record.id, role })).status, 200);
  const lonely = (await action('create', { name: 'Lonely room' }, loner)).data.room.id;
  assert.equal((await request('/__test__/member', { room: lonely, user: watcher.record.id, role: 'viewer' })).status, 200);
  // Every change of a value is kept in the character's history; unchanged values are not.
  const session = (await action('session', {}, holder)).data;
  const reading = { sessionId: session.sessionId, characterName: 'Historian', server: 'Lumiel', region: 'GLOBAL_EU', source: 'packet', parserVersion: 'test-fixture-v1', confirmed: true };
  const kept = (await action('report', { ...reading, sequence: 1, value: 100 }, holder)).data.character;
  for (const [sequence, value] of [[2, 100], [3, 140]]) assert.equal((await action('report', { ...reading, sequence, value, characterId: kept.id }, holder)).status, 200);
  const spare = (await action('character', { characterName: 'Spare', server: 'Lumiel', region: 'GLOBAL_EU' }, holder)).data.character;
  assert.equal((await action('sharing', { roomId, characterId: kept.id, enabled: true }, holder)).status, 200);
  const history = (id, auth) => request('/api/odyle/history/' + id, undefined, auth, 'GET');
  const own = await history(kept.id, holder); assert.equal(own.status, 200, JSON.stringify(own.data));
  assert.deepEqual(own.data.readings.map(r => r.value), [100, 140]); assert.equal(own.data.character.characterName, 'Historian');
  // Rooms the character is shared in see it too, viewers included; nobody else does.
  assert.deepEqual((await history(kept.id, watcher)).data.readings.map(r => r.value), [100, 140]);
  assert.equal((await history(kept.id, stranger)).status, 403); assert.equal((await history(spare.id, heir)).status, 403);
  assert.equal((await history('missingcharacter', holder)).status, 404);
  assert.equal((await request('/api/collections/character_readings/records', undefined, holder, 'GET')).status, 403);
  // The display name is changed on the dashboard and every room sees it.
  for (const bad of ['', ' ', 'x'.repeat(41), 7]) assert.equal((await action('profile', { displayName: bad }, holder)).status, 400);
  const renamed = await action('profile', { displayName: '  Life   keeper ' }, holder); assert.equal(renamed.status, 200, JSON.stringify(renamed.data));
  assert.equal((await snapshot2(roomId, heir)).members.find(m => m.user === holder.record.id).displayName, 'Life keeper');
  // The account page lists the Windows apps that read for it; the export holds everything.
  const page = (await request('/api/odyle/account', undefined, holder, 'GET')).data;
  assert.equal(page.account.displayName, 'Life keeper'); assert.deepEqual(page.apps.map(a => [a.sessionId, a.character]), [[session.sessionId, 'Historian']]); assert.equal(page.limits.characters, 30); assert.equal(page.characters, 2);
  assert.equal((await request('/api/odyle/account', undefined, null, 'GET')).status, 401);
  const exported = (await request('/api/odyle/export', undefined, holder, 'GET')).data;
  assert.equal(exported.account.id, holder.record.id); assert.ok(exported.account.lastActiveAt);
  assert.deepEqual(exported.characters.map(c => [c.characterName, c.history.map(h => h.value)]), [['Historian', [100, 140]], ['Spare', []]]);
  assert.deepEqual(exported.rooms.map(r => [r.name, r.role, r.sharedCharacters]), [['Inherited room', 'owner', [kept.id]]]);
  assert.deepEqual(exported.readerSessions.map(s => s.id), [session.sessionId]); assert.equal(JSON.stringify(exported).includes(holder.token), false);
  // Deleting a character takes it out of every room, with its history.
  assert.equal((await action('delete-character', { characterId: kept.id }, heir)).status, 403);
  assert.equal((await action('delete-character', { characterId: spare.id }, holder)).status, 200);
  assert.equal((await action('delete-character', { characterId: spare.id }, holder)).status, 404);
  assert.equal((await action('delete-character', { characterId: kept.id }, holder)).status, 200);
  assert.deepEqual((await request('/api/odyle/rooms', undefined, holder, 'GET')).data.rooms.find(r => r.id === roomId).sharedCharacters, []);
  assert.deepEqual((await request('/api/odyle/export', undefined, holder, 'GET')).data.characters, []);
  assert.equal((await action('report', { ...reading, sequence: 4, value: 150, characterId: kept.id }, holder)).status, 404);
  // Signing out everywhere ends every token and reader session but keeps this browser signed in.
  const paired = (await action('pair', { code: (await action('desktop-code', {}, holder)).data.code, name: '  Gaming   PC  ' })).data;
  assert.deepEqual((await request('/api/odyle/export', undefined, holder, 'GET')).data.pairedWindowsApps.map(a => [Object.keys(a).sort(), a.name]), [[['lastSignInAt', 'name', 'pairedAt'], 'Gaming PC']]);
  const fresh = await action('sign-out-everywhere', {}, holder); assert.equal(fresh.status, 200, JSON.stringify(fresh.data));
  for (const old of [holder, paired]) assert.equal((await request('/api/odyle/rooms', undefined, old, 'GET')).status, 401);
  assert.equal((await action('desktop-sign-in', { deviceKey: paired.deviceKey })).status, 401);
  const current = { token: fresh.data.token, record: fresh.data.record }; assert.equal((await request('/api/odyle/rooms', undefined, current, 'GET')).status, 200);
  assert.equal((await action('heartbeat', { sessionId: session.sessionId }, current)).status, 403);
  // Deleting the account passes its room to the longest-standing player and closes rooms nobody else can lead.
  assert.equal((await action('delete-account', {}, current)).status, 400);
  assert.equal((await action('delete-account', { confirm: true }, current)).status, 200);
  assert.equal((await request('/api/odyle/rooms', undefined, current, 'GET')).status, 401);
  const inherited = await snapshot2(roomId, heir);
  assert.equal(inherited.room.owner, heir.record.id);
  // Members come in id order, which is random.
  assert.deepEqual(Object.fromEntries(inherited.members.map(m => [m.user, m.role])), { [heir.record.id]: 'owner', [watcher.record.id]: 'viewer' });
  assert.equal((await action('delete-account', { confirm: true }, loner)).status, 200);
  assert.equal((await request('/api/odyle/snapshot/' + lonely, undefined, watcher, 'GET')).status, 403);
  // Superusers can delete room owners in the PocketBase dashboard too; the room passes on the same way.
  const operator = (await request('/__test__/superuser', {})).data;
  const deleted = await fetch(url + '/api/collections/users/records/' + heir.record.id, { method: 'DELETE', headers: { Authorization: operator.token } });
  assert.equal(deleted.status, 204, await deleted.text());
  assert.equal((await request('/api/odyle/snapshot/' + roomId, undefined, watcher, 'GET')).status, 403);
});
test('room owners rename rooms, change roles and hand rooms over; runs are planned together', async () => {
  const [lead, mate, guest, other] = await Promise.all(['Manage lead', 'Manage mate', 'Manage guest', 'Manage other'].map(async name => (await request('/__test__/account', { name })).data));
  const roomId = (await action('create', { name: 'Managed room' }, lead)).data.room.id, elsewhere = (await action('create', { name: 'Other room' }, other)).data.room.id;
  for (const [auth, role] of [[mate, 'reporter'], [guest, 'viewer']]) assert.equal((await request('/__test__/member', { room: roomId, user: auth.record.id, role })).status, 200);
  const memberOf = async (auth, room = roomId) => (await snapshot2(room, lead)).members.find(m => m.user === auth.record.id);
  await settle(); const stream = await connect(url, mate.token, 'odyle.room.' + roomId);
  try {
    assert.equal((await action('rename', { roomId, name: ' Renamed room ' }, mate)).status, 403);
    for (const name of ['', 'x'.repeat(61)]) assert.equal((await action('rename', { roomId, name }, lead)).status, 400);
    const renamed = await action('rename', { roomId, name: ' Renamed room ' }, lead); assert.equal(renamed.status, 200, JSON.stringify(renamed.data)); assert.equal(renamed.data.room.name, 'Renamed room');
    assert.equal((await stream.next())?.data.refresh, true);
  } finally { await stream.close(); }
  // A player made viewer stops sharing; the owner cannot change themselves or members of other rooms.
  const own = (await action('character', { characterName: 'Mate main', server: 'Lumiel', region: 'GLOBAL_EU' }, mate)).data.character;
  assert.equal((await action('sharing', { roomId, characterId: own.id, enabled: true }, mate)).status, 200);
  const mateId = (await memberOf(mate)).id;
  assert.equal((await action('role', { roomId, memberId: mateId, role: 'viewer' }, mate)).status, 403);
  for (const bad of [{ role: 'owner' }, { role: 'admin' }]) assert.equal((await action('role', { roomId, memberId: mateId, ...bad }, lead)).status, 400);
  assert.equal((await action('role', { roomId, memberId: (await memberOf(lead)).id, role: 'viewer' }, lead)).status, 403);
  assert.equal((await action('role', { roomId, memberId: (await snapshot2(elsewhere, other)).members[0].id, role: 'viewer' }, lead)).status, 403);
  assert.equal((await action('role', { roomId, memberId: mateId, role: 'viewer' }, lead)).status, 200);
  assert.deepEqual(await memberOf(mate).then(m => [m.role, m.sharedCharacters]), ['viewer', []]);
  assert.equal((await action('sharing', { roomId, characterId: own.id, enabled: true }, mate)).status, 403);
  assert.equal((await action('role', { roomId, memberId: mateId, role: 'reporter' }, lead)).status, 200);
  // Runs: players plan and join, viewers only read, the planner or owner cancels.
  const soon = new Date(Date.now() + 3600000).toISOString(), plan = (auth, body) => action('plan', { roomId, ...body }, auth);
  for (const startsAt of ['tomorrow', new Date(Date.now() - 2 * 3600000).toISOString(), new Date(Date.now() + 61 * 86400000).toISOString()]) assert.equal((await plan(mate, { dungeon: 'Fire Temple', startsAt })).status, 400);
  assert.equal((await plan(mate, { dungeon: 'Fire Temple', startsAt: soon, note: 'x'.repeat(121) })).status, 400);
  assert.equal((await plan(guest, { dungeon: 'Fire Temple', startsAt: soon })).status, 403); assert.equal((await plan(other, { dungeon: 'Fire Temple', startsAt: soon })).status, 403);
  const planned = await plan(mate, { dungeon: ' Fire   Temple ', startsAt: soon, note: 'Bring potions' }); assert.equal(planned.status, 200, JSON.stringify(planned.data));
  const run = planned.data.runs[0]; assert.deepEqual([run.dungeon, run.note, run.planner, run.attendees], ['Fire Temple', 'Bring potions', mate.record.id, [mate.record.id]]);
  assert.equal(Date.parse(run.startsAt.replace(' ', 'T')), Date.parse(soon));
  assert.equal((await plan(guest, { id: run.id, going: true })).status, 403); assert.equal((await plan(lead, { id: run.id })).status, 400);
  assert.deepEqual((await plan(lead, { id: run.id, going: true })).data.runs[0].attendees, [mate.record.id, lead.record.id]);
  assert.deepEqual((await snapshot2(roomId, guest)).runs.map(r => [r.id, r.attendees]), [[run.id, [mate.record.id, lead.record.id]]]);
  assert.equal((await plan(other, { id: run.id, remove: true })).status, 403);
  const second = (await plan(lead, { dungeon: 'Udas Temple', startsAt: new Date(Date.now() + 7200000).toISOString() })).data.runs.find(r => r.dungeon === 'Udas Temple');
  assert.equal((await plan(mate, { id: second.id, remove: true })).status, 403);
  assert.equal((await plan(lead, { id: run.id, remove: true })).status, 200);
  assert.deepEqual((await snapshot2(roomId, lead)).runs.map(r => r.id), [second.id]);
  // The owner hands the room over, stays as a player and can then leave; leaving takes them off runs.
  assert.equal((await action('transfer', { roomId, memberId: mateId }, guest)).status, 403);
  assert.equal((await action('leave', { roomId }, lead)).status, 400);
  const handed = await action('transfer', { roomId, memberId: mateId }, lead); assert.equal(handed.status, 200, JSON.stringify(handed.data)); assert.equal(handed.data.room.owner, mate.record.id);
  assert.deepEqual((await request('/api/odyle/rooms', undefined, lead, 'GET')).data.rooms.find(r => r.id === roomId).role, 'reporter');
  assert.equal((await action('rename', { roomId, name: 'Mine again' }, lead)).status, 403);
  assert.equal((await action('leave', { roomId }, lead)).status, 200);
  const left = (await snapshot2(roomId, mate)).runs[0]; assert.deepEqual([left.planner, left.attendees], ['', []]);
});
test('a dungeon catalog guides wishlists and runs, accounts have caps and inactive accounts can be cleaned up', async () => {
  const operator = (await request('/__test__/superuser', {})).data, settings = body => request('/api/odyle/admin/settings', body, operator);
  const [planner, collector, idle, busy] = await Promise.all(['Catalog planner', 'Cap collector', 'Retention idle', 'Retention busy'].map(async name => (await request('/__test__/account', { name })).data));
  const roomId = (await action('create', { name: 'Catalog room' }, planner)).data.room.id;
  assert.equal((await action('wishlist', { roomId, dungeon: 'Old Cave', wanted: true }, planner)).status, 200);
  try {
    assert.equal((await settings({ dungeons: ['Fire Temple', 'Udas Temple'] })).status, 200);
    const room = await snapshot2(roomId, planner); assert.deepEqual(room.dungeons, ['Fire Temple', 'Udas Temple']);
    // New entries must come from the catalog and take its spelling; existing ones can still be joined and left.
    assert.equal((await action('wishlist', { roomId, dungeon: 'Unknown Cave', wanted: true }, planner)).status, 400);
    assert.deepEqual((await action('wishlist', { roomId, dungeon: 'fire  temple', wanted: true }, planner)).data.wishlist.map(w => w.dungeon), ['Old Cave', 'Fire Temple']);
    assert.equal((await action('plan', { roomId, dungeon: 'Unknown Cave', startsAt: new Date(Date.now() + 3600000).toISOString() }, planner)).status, 400);
    assert.equal((await action('plan', { roomId, dungeon: 'udas temple', startsAt: new Date(Date.now() + 3600000).toISOString() }, planner)).data.runs[0].dungeon, 'Udas Temple');
    assert.equal((await action('wishlist', { roomId, dungeon: 'Old Cave', wanted: false }, planner)).status, 200);
  } finally { assert.equal((await settings({ dungeons: [] })).status, 200); }
  // Caps: 30 characters, 20 owned rooms and 50 memberships per account.
  assert.equal((await request('/__test__/characters', { user: collector.record.id, count: 29 })).status, 200);
  assert.equal((await action('character', { characterName: 'Thirtieth', server: 'Lumiel', region: 'GLOBAL_EU' }, collector)).status, 200);
  assert.equal((await action('character', { characterName: 'Thirtieth', server: 'Lumiel', region: 'GLOBAL_EU' }, collector)).status, 200);
  assert.equal((await action('character', { characterName: 'One too many', server: 'Lumiel', region: 'GLOBAL_EU' }, collector)).status, 400);
  const session = (await action('session', {}, collector)).data;
  assert.equal((await action('report', { sessionId: session.sessionId, sequence: 1, characterName: 'Also too many', server: 'Lumiel', region: 'GLOBAL_EU', value: 1, source: 'packet', parserVersion: 'test-fixture-v1', confirmed: true }, collector)).status, 400);
  assert.equal((await request('/__test__/rooms', { user: collector.record.id, count: 20 })).status, 200);
  assert.equal((await action('create', { name: 'Twenty-first' }, collector)).status, 400);
  assert.equal((await request('/__test__/rooms', { user: collector.record.id, count: 30, role: 'reporter', other: planner.record.id })).status, 200);
  const invite = (await action('invites', { roomId }, planner)).data.invites[0].code;
  assert.equal((await action('join', { code: invite }, collector)).status, 400);
  // Inactive accounts are kept unless a superuser sets a period; then the nightly job deletes them.
  assert.equal((await request('/__test__/inactive', { user: idle.record.id, days: 40 })).status, 200);
  assert.equal((await request('/__test__/retention', {})).status, 200);
  assert.equal((await request('/api/odyle/tasks', undefined, idle, 'GET')).status, 200);
  assert.equal((await request('/__test__/inactive', { user: idle.record.id, days: 40 })).status, 200);
  try {
    assert.equal((await settings({ inactiveAccountDays: 30 })).status, 200);
    assert.equal((await request('/__test__/retention', {})).status, 200);
    assert.equal((await request('/api/odyle/tasks', undefined, idle, 'GET')).status, 401);
    assert.equal((await request('/api/odyle/tasks', undefined, busy, 'GET')).status, 200);
  } finally { assert.equal((await settings({ inactiveAccountDays: 0 })).status, 200); }
});
test('accounts list their paired PCs and remove one without signing out elsewhere', async () => {
  const me = (await request('/__test__/account', { name: 'PC owner' })).data, other = (await request('/__test__/account', { name: 'PC stranger' })).data;
  const account = async (auth = me) => (await request('/api/odyle/account', undefined, auth, 'GET')).data;
  // Two PCs: one names itself when it gets its key, the other at its next sign-in.
  const desk = (await action('desktop-device', { name: 'DESK-PC' }, me)).data.deviceKey, laptop = (await action('desktop-device', {}, me)).data.deviceKey;
  assert.equal((await action('desktop-sign-in', { deviceKey: laptop, name: 'LAPTOP' })).status, 200);
  assert.equal((await action('desktop-sign-in', { deviceKey: laptop, name: 42 })).status, 200);
  let page = await account(); assert.deepEqual(page.devices.map(d => d.name).sort(), ['DESK-PC', 'LAPTOP']);
  for (const d of page.devices) assert.deepEqual(Object.keys(d).sort(), ['id', 'lastSignInAt', 'name', 'pairedAt']);
  // A reader session opened with the key belongs to that PC; an unknown key is a pairing that ended.
  const session = (await action('session', { deviceKey: desk }, me)).data; assert.ok(session.sessionId);
  assert.equal((await action('session', { deviceKey: 'x'.repeat(48) }, me)).status, 401);
  assert.equal((await action('session', { deviceKey: desk }, other)).status, 401);
  assert.equal((await action('session', {}, me)).status, 200);
  page = await account(); const deskId = page.devices.find(d => d.name === 'DESK-PC').id;
  assert.equal(page.apps.find(a => a.sessionId === session.sessionId).device, deskId);
  // A PC runs one app: its next session (a restart, an update) replaces the one it left open,
  // and the character that session read stays valid for the restarted app to take over.
  const fields = { characterName: 'Restarter', server: 'Lumiel', region: 'GLOBAL_EU', value: 500, source: 'packet', parserVersion: 'test-fixture-v1', confirmed: true };
  const read = await action('report', { ...fields, sessionId: session.sessionId, sequence: 1 }, me); assert.equal(read.status, 200, JSON.stringify(read.data));
  const restarted = (await action('session', { deviceKey: desk }, me)).data;
  assert.equal((await action('heartbeat', { sessionId: session.sessionId }, me)).status, 403);
  const kept = (await request('/api/collections/characters/records/' + read.data.character.id, undefined, me, 'GET')).data;
  assert.equal(kept.valid, true); assert.equal(kept.value, 500);
  page = await account();
  assert.deepEqual(page.apps.filter(a => a.device === deskId).map(a => a.sessionId), [restarted.sessionId]);
  assert.equal(page.apps.filter(a => !a.device).length, 1, 'a session opened without a device key is left alone');
  assert.equal((await action('report', { ...fields, characterId: read.data.character.id, sessionId: restarted.sessionId, sequence: 1 }, me)).status, 200);
  // Only the owner removes a PC; removing it ends its session and its key at once.
  assert.equal((await action('forget-device', { deviceId: deskId }, other)).status, 403);
  assert.equal((await action('forget-device', { deviceId: 'missingdevice00' }, me)).status, 404);
  assert.equal((await action('forget-device', { deviceId: deskId }, me)).status, 200);
  assert.equal((await action('heartbeat', { sessionId: restarted.sessionId }, me)).status, 403);
  assert.equal((await action('session', { deviceKey: desk }, me)).status, 401);
  assert.equal((await action('desktop-sign-in', { deviceKey: desk })).status, 401);
  // The other PC and this browser stay signed in.
  assert.equal((await action('desktop-sign-in', { deviceKey: laptop })).status, 200);
  page = await account(); assert.deepEqual(page.devices.map(d => d.name), ['LAPTOP']);
});
test('accounts rename their tasks and put them in order', async () => {
  const me = (await request('/__test__/account', { name: 'Task sorter' })).data, other = (await request('/__test__/account', { name: 'Task watcher' })).data;
  const change = (body, auth = me) => action('task', body, auth);
  for (const title of ['First', 'Second', 'Third']) assert.equal((await change({ title, cadence: 'daily' })).status, 200);
  const weekly = (await change({ title: 'Weekly', cadence: 'weekly' })).data.tasks.find(t => t.title === 'Weekly');
  const titles = data => data.tasks.filter(t => t.cadence === 'daily').map(t => t.title);
  let tasks = (await change({ title: 'Fourth', cadence: 'daily' })).data; const [first, , third] = tasks.tasks.filter(t => t.cadence === 'daily');
  assert.deepEqual(titles(tasks), ['First', 'Second', 'Third', 'Fourth']);
  tasks = (await change({ id: third.id, move: 'up' })).data; assert.deepEqual(titles(tasks), ['First', 'Third', 'Second', 'Fourth']);
  tasks = (await change({ id: first.id, move: 'up' })).data; assert.deepEqual(titles(tasks), ['First', 'Third', 'Second', 'Fourth']);
  tasks = (await change({ id: first.id, move: 'down' })).data; assert.deepEqual(titles(tasks), ['Third', 'First', 'Second', 'Fourth']);
  // Weekly tasks keep their own order; renaming collapses spaces like adding does.
  assert.deepEqual((await change({ id: weekly.id, move: 'up' })).data.tasks.filter(t => t.cadence === 'weekly').map(t => t.title), ['Weekly']);
  tasks = (await change({ id: third.id, title: '  Daily   boss ' })).data; assert.equal(tasks.tasks.find(t => t.id === third.id).title, 'Daily boss');
  for (const bad of [{ id: third.id, title: '   ' }, { id: third.id, title: 'x'.repeat(61) }, { id: third.id, move: 'left' }]) assert.equal((await change(bad)).status, 400);
  assert.equal((await change({ id: third.id, title: 'Mine now' }, other)).status, 403);
  assert.equal((await change({ id: third.id, move: 'down' }, other)).status, 403);
});
test('planned runs can be changed, are posted to Discord and listed as upcoming', async () => {
  const lead = (await request('/__test__/account', { name: 'Run lead' })).data, mate = (await request('/__test__/account', { name: 'Run *mate*' })).data, watcher = (await request('/__test__/account', { name: 'Run watcher' })).data;
  const roomId = (await action('create', { name: 'Raid night' }, lead)).data.room.id;
  for (const [who, role] of [[mate, 'reporter'], [watcher, 'viewer']]) assert.equal((await request('/__test__/member', { room: roomId, user: who.record.id, role })).status, 200);
  const plan = (body, auth = lead) => action('plan', { roomId, ...body }, auth), soon = minutes => new Date(Date.now() + minutes * 60000).toISOString();
  // A note of only spaces is no note.
  let planned = await plan({ dungeon: 'Fire Temple', startsAt: soon(10), note: '   ' }); assert.equal(planned.status, 200, JSON.stringify(planned.data));
  let run = planned.data.runs[0]; assert.equal(run.note, '');
  // Its planner or the room owner changes it; other players and viewers cannot.
  assert.equal((await plan({ id: run.id, note: 'Bring potions' }, mate)).status, 403);
  assert.equal((await plan({ id: run.id, note: 'Bring potions' }, watcher)).status, 403);
  for (const bad of [{ startsAt: 'soon' }, { startsAt: soon(-120) }, { note: 'x'.repeat(121) }, { dungeon: '' }]) assert.equal((await plan({ id: run.id, ...bad })).status, 400, JSON.stringify(bad));
  const changed = await plan({ id: run.id, dungeon: 'Draupnir   Cave', startsAt: soon(12), note: 'Bring potions' }); assert.equal(changed.status, 200, JSON.stringify(changed.data));
  run = changed.data.runs[0]; assert.deepEqual([run.dungeon, run.note], ['Draupnir Cave', 'Bring potions']);
  assert.ok(Math.abs(Date.parse(run.startsAt.replace(' ', 'T')) - Date.parse(soon(12))) < 5000);
  // Upcoming lists the runs the account is going to, across its rooms.
  const upcoming = async auth => (await request('/api/odyle/upcoming', undefined, auth, 'GET')).data.runs;
  assert.deepEqual((await upcoming(lead)).map(r => [r.id, r.room, r.dungeon]), [[run.id, 'Raid night', 'Draupnir Cave']]);
  assert.deepEqual(await upcoming(mate), []);
  assert.equal((await plan({ id: run.id, going: true }, mate)).status, 200); assert.equal((await upcoming(mate)).length, 1);
  // Only the owner connects Discord; the webhook is tested first and never sent back.
  const hook = discordUrl + '/api/webhooks/123456789012/' + 'a'.repeat(68), connect = (body, auth = lead) => action('discord-webhook', { roomId, ...body }, auth);
  assert.equal((await connect({ webhook: hook }, mate)).status, 403);
  for (const bad of ['https://example.com/api/webhooks/1/2', 'http://discord.com/api/webhooks/123456789012/' + 'a'.repeat(68), 'https://discord.com/api/other']) assert.equal((await connect({ webhook: bad })).status, 400, bad);
  discordAnswer = 404; assert.equal((await connect({ webhook: hook })).status, 400); discordAnswer = 204;
  discordPosts = []; const connected = await connect({ webhook: hook, language: 'cs' }); assert.equal(connected.status, 200, JSON.stringify(connected.data));
  assert.equal(discordPosts.length, 1); assert.match(discordPosts[0].body.content, /Raid night/); assert.deepEqual(discordPosts[0].body.allowed_mentions, { parse: [] });
  const shot = await snapshot2(roomId, mate); assert.equal(shot.room.discordReminders, true); assert.equal(JSON.stringify(shot).includes('webhooks'), false);
  assert.equal(JSON.stringify(await request('/api/odyle/rooms', undefined, lead, 'GET')).includes('webhooks'), false);
  // The cron posts a run once, 15 minutes ahead, with who is going; names cannot format the message.
  discordPosts = []; await request('/__test__/remind', {}); await request('/__test__/remind', {});
  assert.equal(discordPosts.length, 1); const embed = discordPosts[0].body.embeds[0];
  assert.equal(embed.title, 'Draupnir Cave'); assert.match(embed.description, /<t:\d+:R>/); assert.match(embed.description, /Bring potions/);
  assert.equal(embed.fields[0].name, 'Jdou (2)'); assert.match(embed.fields[0].value, /Run \\\*mate\\\*/);
  // A new start time announces it again; a run further out waits.
  assert.equal((await plan({ id: run.id, startsAt: soon(14) })).status, 200);
  assert.equal((await plan({ dungeon: 'Fire Temple', startsAt: soon(90) })).status, 200);
  discordPosts = []; await request('/__test__/remind', {}); assert.equal(discordPosts.length, 1); assert.equal(discordPosts[0].body.embeds[0].title, 'Draupnir Cave');
  // A webhook Discord no longer knows is dropped.
  assert.equal((await plan({ id: run.id, startsAt: soon(13) })).status, 200);
  discordAnswer = 404; await request('/__test__/remind', {}); discordAnswer = 204;
  assert.equal((await snapshot2(roomId, lead)).room.discordReminders, false);
  // Runs a day past their start and history older than 30 days leave with the clean-up.
  await request('/__test__/age', { collection: 'room_runs', id: run.id, days: 2 });
  await request('/__test__/cleanup', { codes: [] });
  assert.deepEqual((await snapshot2(roomId, lead)).runs.map(r => r.dungeon), ['Fire Temple']);
  // Disconnecting works without a test post.
  assert.equal((await connect({ webhook: hook })).status, 200); discordPosts = [];
  assert.equal((await connect({ webhook: '' })).status, 200); assert.equal(discordPosts.length, 0); assert.equal((await snapshot2(roomId, lead)).room.discordReminders, false);
});
test('history older than 30 days leaves with the clean-up', async () => {
  const me = (await request('/__test__/account', { name: 'Old history' })).data, session = (await action('session', {}, me)).data;
  const read = (sequence, value) => action('report', { sessionId: session.sessionId, sequence, characterName: 'Oldtimer', server: 'Lumiel', region: 'GLOBAL_EU', value, source: 'packet', parserVersion: 'test-fixture-v1', confirmed: true }, me);
  const character = (await read(1, 10)).data.character; assert.equal((await read(2, 20)).status, 200);
  const [old] = (await request('/__test__/readings', { id: character.id })).data;
  await request('/__test__/age', { collection: 'character_readings', id: old, days: 31 }); await request('/__test__/cleanup', { codes: [] });
  assert.deepEqual((await request('/api/odyle/history/' + character.id, undefined, me, 'GET')).data.readings.map(r => r.value), [20]);
});
test('owners save a full dungeon catalog and closed rooms answer plainly', async () => {
  const operator = (await request('/__test__/superuser', {})).data, names = Array.from({ length: 200 }, (_, i) => `Dungeon number ${String(i).padStart(3, '0')} of the long expedition list`.slice(0, 60));
  const saved = await fetch(url + '/api/odyle/admin/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: operator.token }, body: JSON.stringify({ dungeons: names }) });
  assert.equal(saved.status, 200, await saved.clone().text()); assert.equal((await saved.json()).settings.dungeons.length, 200);
  const cleared = await fetch(url + '/api/odyle/admin/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: operator.token }, body: JSON.stringify({ dungeons: [] }) }); assert.equal(cleared.status, 200);
  const host = (await request('/__test__/account', { name: 'Closing host' })).data, roomId = (await action('create', { name: 'Short-lived' }, host)).data.room.id;
  assert.equal((await action('close', { roomId }, host)).status, 200);
  for (const [name, body] of [['close', { roomId }], ['rename', { roomId, name: 'Again' }], ['invites', { roomId }]]) {
    const again = await action(name, body, host); assert.equal(again.status, 404, name); assert.equal(again.data.message, 'This room no longer exists.');
  }
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
    // The anonymous-room collections of the first release are gone, not merely locked.
    for (const name of ['rooms', 'members', 'invites']) assert.equal((await request('/api/collections/' + name + '/records', undefined, owner, 'GET')).status, 404);
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
  await t.test('a paired app keeps its pairing: its device key signs in again until it unpairs', async () => {
    const paired = (await action('pair', { code: (await action('desktop-code', {}, player)).data.code })).data;
    assert.match(paired.deviceKey, /^[A-Za-z0-9]{48}$/);
    // The key, not the seven-day token, is what lasts: each sign-in issues a fresh account token.
    const signedIn = await action('desktop-sign-in', { deviceKey: paired.deviceKey }); assert.equal(signedIn.status, 200, JSON.stringify(signedIn.data));
    assert.equal(signedIn.data.record.id, player.record.id); assert.equal((await request('/api/odyle/rooms', undefined, signedIn.data, 'GET')).status, 200);
    // Device sign-in is capped at 30 a minute per client; the whole run stays below that.
    assert.equal((await action('desktop-sign-in', { deviceKey: 'x'.repeat(48) })).status, 401);
    assert.equal((await action('desktop-sign-in', { deviceKey: 7 })).status, 400);
    // An app paired before device keys existed gets one with its token.
    const upgraded = await action('desktop-device', {}, paired); assert.equal(upgraded.status, 200); assert.notEqual(upgraded.data.deviceKey, paired.deviceKey);
    assert.equal((await action('desktop-device', {})).status, 401);
    assert.equal((await action('desktop-sign-in', { deviceKey: upgraded.data.deviceKey })).data.record.id, player.record.id);
    // Disconnecting forgets only that app's key.
    assert.equal((await action('unpair', { deviceKey: paired.deviceKey })).status, 200);
    assert.equal((await action('unpair', { deviceKey: paired.deviceKey })).status, 200);
    assert.equal((await action('desktop-sign-in', { deviceKey: paired.deviceKey })).status, 401);
    assert.equal((await action('desktop-sign-in', { deviceKey: upgraded.data.deviceKey })).status, 200);
  });
  await t.test('an account keeps its ten most recently used Windows pairings', async () => {
    const holder = (await request('/__test__/account', { name: 'Many PCs' })).data, keys = [];
    for (let i = 0; i < 10; i++) keys.push((await action('desktop-device', {}, holder)).data.deviceKey);
    // The first PC signed in last, so the second and third are the least recently used when two more pair.
    assert.equal((await action('desktop-sign-in', { deviceKey: keys[0] })).status, 200);
    for (let i = 0; i < 2; i++) keys.push((await action('desktop-device', {}, holder)).data.deviceKey);
    assert.deepEqual((await request('/__test__/devices', { keys })).data.kept, [true, false, false, ...Array(9).fill(true)]);
    assert.equal((await request('/api/odyle/export', undefined, holder, 'GET')).data.pairedWindowsApps.length, 10);
  });
  await t.test('compiled Windows client pairs and retains saved values', { skip: !process.env.ODYLE_WINDOWS_CHECKS }, async () => {
    const pair = (await action('desktop-code', {}, player)).data;
    const output = execFileSync('dotnet', ['run', '--project', process.env.ODYLE_WINDOWS_CHECKS, '-c', 'Release', '--', url, pair.code], { encoding: 'utf8', timeout: 60000 });
    assert.match(output, /persistent character API check passed/); assert.match(output, /lasting pairing check passed/);
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
    await settle(); const stream = await connect(url, viewer.token, 'odyle.room.' + room.id);
    try {
      await action('sharing', { roomId: room.id, enabled: true }, owner); assert.equal((await stream.next())?.data.refresh, true);
      const memberId = (await snapshot(owner)).data.members.find(m => m.user === viewer.record.id).id;
      // A removed member hears once that it was removed, and nothing after that.
      await action('revoke', { roomId: room.id, memberId }, owner);
      assert.deepEqual((await stream.next())?.data, { refresh: true, removed: true });
      await action('sharing', { roomId: room.id, enabled: false }, owner);
      assert.equal(await stream.next(400), null); assert.equal((await snapshot(viewer)).status, 403);
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
test('the dashboard offers the newest Windows release through the backend, cached and without sign-in', async () => {
  // The backend asks GitHub as it starts; that one answer serves every visitor for ten minutes.
  await stop(); const hits = releaseHits; await start();
  const latest = () => request('/api/odyle/windows-release', undefined, null, 'GET');
  const first = await latest();
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.repository, 'oldbear24/odyle-windows');
  assert.equal(first.data.releasesUrl, 'https://github.com/oldbear24/odyle-windows/releases/latest');
  assert.equal(first.data.latest.version, '0.5.0.2'); assert.equal(first.data.latest.tag, 'v0.5.0.2');
  assert.equal(first.data.latest.url, 'https://github.com/oldbear24/odyle-windows/releases/tag/v0.5.0.2');
  assert.equal(first.data.latest.publishedAt, '2026-10-13T22:34:09Z');
  assert.deepEqual(first.data.latest.packages.small, { name: 'odyle-0.5.0.2-win-x64.zip', size: 217557, url: 'https://github.com/oldbear24/odyle-windows/releases/download/v0.5.0.2/odyle-0.5.0.2-win-x64.zip' });
  assert.equal(first.data.latest.packages.selfContained.size, 71595826);
  // The per-user installer and the ARM64 packages are listed next to the x64 ZIPs.
  assert.equal(first.data.latest.packages.installer.name, 'odyle-0.5.0.2-win-x64-setup.exe');
  assert.deepEqual([first.data.latest.packages.arm64.small.size, first.data.latest.packages.arm64.selfContained.name], [210000, 'odyle-0.5.0.2-win-arm64-self-contained.zip']);
  // Browsers get the packages only; checksums are verified by the Windows app itself.
  assert.equal(JSON.stringify(first.data).includes('.sha256'), false);
  const again = await latest(); assert.deepEqual(again.data, first.data); assert.equal(releaseHits, hits + 1);
  // Without GitHub the stable latest-release page link is still offered.
  releaseDown = true;
  try {
    await stop(); await start();
    const offline = await latest(); assert.equal(offline.status, 200, JSON.stringify(offline.data));
    assert.equal(offline.data.latest, null); assert.equal(offline.data.releasesUrl, 'https://github.com/oldbear24/odyle-windows/releases/latest');
    // Superusers see why the lookup failed on the Server status page.
    const operator = (await request('/__test__/superuser', {})).data, lookup = (await request('/api/odyle/admin/status', undefined, operator, 'GET')).data.release;
    assert.deepEqual([lookup.version, lookup.fetchedAt, lookup.error], ['', '', 'GitHub answered 503.']); assert.ok(Date.parse(lookup.checkedAt) <= Date.now());
  } finally { releaseDown = false; }
});
// Last: it spends this client's pairing budget for the minute.
test('pairing and device sign-in are rate limited', async () => {
  const statuses = []; for (let i = 0; i < 12; i++) statuses.push((await action('pair', { code: 'ZZZZZZZZZZZZZZZZ' })).status);
  assert.ok(statuses.includes(429), statuses.join());
  const signIns = []; for (let i = 0; i < 32; i++) signIns.push((await action('desktop-sign-in', { deviceKey: 'y'.repeat(48) })).status);
  assert.ok(signIns.includes(429), signIns.join());
});
