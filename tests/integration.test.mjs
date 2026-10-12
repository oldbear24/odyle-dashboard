import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { connect } from './sse.mjs';
const url = 'http://127.0.0.1:18090';
let child, directory, owner, reporter, viewer;
async function request(path, body, auth, method = 'POST') {
  const res = await fetch(url + path, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth.token } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const data = await res.json(); return { status: res.status, data };
}
const action = (name, body, auth) => request('/api/odyle/' + name, body, auth);
const recordPath = (id) => '/api/collections/members/records/' + id;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'odyle-test-'));
  child = spawn(resolve('.runtime', process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase'), ['serve', '--http=127.0.0.1:18090', '--dir=' + directory, '--hooksDir=' + resolve('backend/pb_hooks'), '--migrationsDir=' + resolve('backend/pb_migrations'), '--automigrate=false'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', value => log += value); child.stderr.on('data', value => log += value);
  for (let i = 0; i < 50; i++) { try { if ((await fetch(url + '/api/health')).ok) return; } catch {} await delay(100); }
  throw new Error('PocketBase failed to start: ' + log.replace(/http[^\s]*pbinstall[^\s]*/g, '[redacted]'));
});
after(async () => {
  if (owner?.token) await action('leave', {}, owner).catch(() => {});
  if (child && child.exitCode === null) { const closed = new Promise(resolve => child.once('exit', resolve)); child.kill(); await closed; }
  if (directory) await rm(directory, { recursive: true, force: true });
});
test('private room, five publishers, read-only viewers, sequencing and revocation', async (t) => {
  const created = await action('create', { name: 'Integration party', displayName: 'Leader', cost: 40 });
  assert.equal(created.status, 200, JSON.stringify(created.data)); owner = created.data;
  const invites = owner.invites;
  const code = invites.find(i => i.role === 'reporter').code;
  const viewerCode = invites.find(i => i.role === 'viewer').code;
  await t.test('five independent members join with their own identities', async () => {
    const group = [];
    for (let i = 0; i < 5; i++) { const result = await action('join', { code, displayName: 'Player ' + i }); assert.equal(result.status, 200, JSON.stringify(result.data)); group.push(result.data); }
    reporter = group[0]; assert.equal(new Set(group.map(p => p.record.id)).size, 5);
    const result = await action('join', { code: viewerCode, displayName: 'Observer' }); assert.equal(result.status, 200); viewer = result.data;
  });
  if (!reporter || !viewer) return;
  await t.test('live SSE delivers updates, and revoked connected viewers stop receiving them', async () => {
    const temporaryViewer = (await action('join', { code: viewerCode, displayName: 'Live observer' })).data;
    const stream = await connect(url, temporaryViewer.token);
    try {
      await action('sharing', { enabled: true }, reporter);
      const event = await stream.next(); assert.equal(event?.data.record.id, reporter.record.id);
      await action('revoke', { memberId: temporaryViewer.record.id }, owner);
      await action('heartbeat', {}, reporter);
      const finalEvent = await stream.next(250);
      // PocketBase may deliver the observer's own deletion notification.
      if (finalEvent) {
        assert.equal(finalEvent.data.action, 'delete');
        assert.equal(finalEvent.data.record.id, temporaryViewer.record.id);
        assert.equal(await stream.next(250), null);
      }
    } finally { await action('sharing', { enabled: false }, reporter); await stream.close(); }
  });
  await t.test('anonymous and cross-room reads cannot access the party', async () => {
    assert.equal((await request(recordPath(reporter.record.id), undefined, null, 'GET')).status, 404);
    const other = (await action('create', { name: 'Other', displayName: 'Other', cost: 20 })).data;
    assert.equal((await request(recordPath(reporter.record.id), undefined, other, 'GET')).status, 404);
    await action('leave', {}, other);
    assert.equal((await request('/api/collections/invites/records', undefined, owner, 'GET')).status, 403);
  });
  await t.test('viewers cannot publish, set sharing, rotate or change costs', async () => {
    for (const name of ['report', 'sharing', 'session', 'settings', 'invites', 'revoke']) assert.equal((await action(name, { enabled: true, cost: 20 }, viewer)).status, 403, name);
  });
  const reading = { sessionId: reporter.sessionId, sequence: 1, region: 'GLOBAL_EU', server: 'EU', characterName: 'Player zero', value: 0, source: 'manual', confirmed: true };
  await t.test('explicit consent required, zero accepted, and another member cannot be forged', async () => {
    assert.equal((await action('report', reading, reporter)).status, 403);
    assert.equal((await action('sharing', { enabled: true }, reporter)).status, 200);
    assert.equal((await action('report', { ...reading, memberId: owner.record.id }, reporter)).status, 200);
    const zero = await request(recordPath(reporter.record.id), undefined, viewer, 'GET');
    assert.equal(zero.data.value, 0); assert.equal(zero.data.confirmed, true);
    assert.equal((await request(recordPath(owner.record.id), undefined, viewer, 'GET')).data.confirmed, false);
    assert.equal((await request(recordPath(reporter.record.id), { value: 999, role: 'owner' }, reporter, 'PATCH')).status, 403);
  });
  await t.test('replays, parallel duplicate sequences, packets and malformed numbers are rejected', async () => {
    assert.equal((await action('report', reading, reporter)).status, 400);
    const pair = await Promise.all([action('report', { ...reading, sequence: 2 }, reporter), action('report', { ...reading, sequence: 2 }, reporter)]);
    assert.deepEqual(pair.map(r => r.status).sort(), [200, 400]);
    for (const patch of [{ sequence: 3, source: 'packet' }, { sequence: 3, value: 0.5 }, { sequence: 3, value: -1 }, { sequence: 3, sessionId: 'bad' }]) assert.equal((await action('report', { ...reading, ...patch }, reporter)).status, 400);
  });
  await t.test('heartbeat preserves observation timestamp; session reset clears confidence', async () => {
    const before = (await request(recordPath(reporter.record.id), undefined, viewer, 'GET')).data;
    assert.equal((await action('heartbeat', {}, reporter)).status, 200);
    const after = (await request(recordPath(reporter.record.id), undefined, viewer, 'GET')).data;
    assert.equal(after.lastReadingAt, before.lastReadingAt);
    const session = await action('session', {}, reporter); assert.equal(session.status, 200);
    assert.notEqual(session.data.sessionId, reading.sessionId);
    assert.equal((await request(recordPath(reporter.record.id), undefined, viewer, 'GET')).data.confirmed, false);
    assert.equal((await action('report', { ...reading, sequence: 4 }, reporter)).status, 400);
    assert.equal((await action('report', { ...reading, sessionId: session.data.sessionId }, reporter)).status, 200);
    await action('sharing', { enabled: false }, reporter);
    const stopped = (await request(recordPath(reporter.record.id), undefined, viewer, 'GET')).data;
    assert.equal(stopped.confirmed, false); assert.equal(stopped.sharing, false); assert.equal(stopped.lastReadingAt, '');
  });
  await t.test('leader changes cost and rotates invites, old invite cannot be reused', async () => {
    assert.equal((await action('settings', { cost: 30 }, owner)).data.room.cost, 30);
    assert.equal((await action('settings', { cost: 0 }, owner)).status, 400);
    assert.equal((await action('invites', {}, owner)).status, 200);
    assert.equal((await action('join', { code, displayName: 'Late arrival' })).status, 400);
  });
  await t.test('member removal and room closure revoke credentials', async () => {
    assert.equal((await action('revoke', { memberId: reporter.record.id }, owner)).status, 200);
    assert.equal((await action('heartbeat', {}, reporter)).status, 401);
    assert.equal((await action('leave', {}, owner)).status, 200);
    assert.equal((await action('heartbeat', {}, viewer)).status, 401);
  });
});
