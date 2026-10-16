// Records the CPU profile the backend is built with (profile-guided optimisation: go build
// uses backend/default.pgo). It runs the test build (npm run backend:build) on a temporary
// database under a busy server's traffic in fast motion: Windows readers sending heartbeats
// and readings, and open dashboards that follow their rooms over realtime and fetch
// snapshots when a room changes. 30 seconds of it are recorded through the superuser
// profile route. Refresh the profile after larger backend changes:
//
//   npm run backend:build && npm run backend:profile -- [output] [test build]
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const output = resolve(process.argv[2] || 'backend/default.pgo');
const binary = resolve(process.argv[3] || join('.runtime', process.platform === 'win32' ? 'odyle-test.exe' : 'odyle-test'));
const seconds = 30, readerCount = 40, roomCount = 8, dashboardCount = 24, workerCount = 16;
const url = 'http://127.0.0.1:18095';
const directory = await mkdtemp(join(tmpdir(), 'odyle-profile-'));
// Outside services are unreachable: lookups fail at once and nothing leaves the machine.
const child = spawn(binary, ['serve', '--http=127.0.0.1:18095', '--dir=' + join(directory, 'data')], { stdio: 'ignore', env: { ...process.env, PLAYNC_SEARCH_URL: 'http://127.0.0.1:9/search', PLAYNC_ARMORY_URL: 'http://127.0.0.1:9', PLAYNC_IMAGE_URL: 'http://127.0.0.1:9', ODYLE_WINDOWS_RELEASE_URL: 'http://127.0.0.1:9/releases', ODYLE_DISCORD_WEBHOOK_BASE: 'http://127.0.0.1:9' } });
const send = async (path, body, token, method = body === undefined ? 'GET' : 'POST') => {
  const res = await fetch(url + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(data)}`);
  return data;
};
const pick = list => list[Math.floor(Math.random() * list.length)];

// A dashboard on realtime: it fetches a room's snapshot when the room changed and its rooms
// when its own data did, like src/main.js.
async function dashboard(reader, signal) {
  const res = await fetch(url + '/api/realtime', { signal });
  const stream = res.body.getReader(), decoder = new TextDecoder();
  let buffer = '', connected;
  const clientId = new Promise(done => { connected = done; });
  (async () => {
    try {
      for (;;) {
        const { value, done } = await stream.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
          const block = buffer.slice(0, end), event = /^event:(.*)$/m.exec(block)?.[1], data = JSON.parse(/^data:(.*)$/m.exec(block)?.[1] || 'null');
          buffer = buffer.slice(end + 2);
          if (event === 'PB_CONNECT') connected(data.clientId);
          else if (event?.startsWith('odyle.room.') && data?.refresh && !data.characters) send('/api/odyle/snapshot/' + event.slice('odyle.room.'.length), undefined, reader.token).catch(() => {});
          else if (event?.startsWith('odyle.user.') && data?.refresh) send('/api/odyle/rooms', undefined, reader.token).catch(() => {});
        }
      }
    } catch { /* closed at the end */ }
  })();
  const topics = ['odyle.user.' + reader.id, ...reader.rooms.flatMap(room => ['odyle.room.' + room, 'odyle.presence.' + room])];
  await send('/api/realtime', { clientId: await clientId, subscriptions: topics }, reader.token);
}

try {
  for (let i = 0; i < 100 && !(await fetch(url + '/api/health').then(r => r.ok, () => false)); i++) await delay(100);
  const operator = (await send('/__test__/superuser', {})).token;
  // The production rate limits stay on, raised so that one machine's traffic fits.
  const { rateLimits } = await send('/api/settings', undefined, operator);
  await send('/api/settings', { rateLimits: { ...rateLimits, rules: rateLimits.rules.map(rule => ({ ...rule, maxRequests: rule.maxRequests * 1000 })) } }, operator, 'PATCH');

  const readers = [];
  for (let i = 0; i < readerCount; i++) {
    const account = await send('/__test__/account', { name: 'Profile reader ' + i });
    readers.push({ id: account.record.id, token: account.token, rooms: [], characters: [], sequence: 0 });
  }
  const invites = [];
  for (let i = 0; i < roomCount; i++) {
    const created = await send('/api/odyle/create', { name: 'Profile room ' + i }, readers[i].token);
    readers[i].rooms.push(created.room.id);
    invites.push({ room: created.room.id, code: created.invites[0].code });
  }
  for (const [i, reader] of readers.entries()) {
    for (const invite of [invites[i % roomCount], invites[(i + 3) % roomCount]]) {
      if (reader.rooms.includes(invite.room)) continue;
      await send('/api/odyle/join', { code: invite.code }, reader.token);
      reader.rooms.push(invite.room);
    }
    reader.session = (await send('/api/odyle/session', { appVersion: '0.6.0.1' }, reader.token)).sessionId;
    for (const name of i % 3 ? ['Main ' + i] : ['Main ' + i, 'Alt ' + i]) {
      const saved = await send('/api/odyle/report', { sessionId: reader.session, sequence: ++reader.sequence, characterName: name, server: 'Lumiel', region: 'GLOBAL_EU', value: 300 + i, source: 'packet', parserVersion: 'test-fixture-v1', confirmed: true }, reader.token);
      reader.characters.push({ id: saved.character.id, name, value: 300 + i });
    }
    for (const room of reader.rooms) await send('/api/odyle/sharing', { roomId: room, enabled: true }, reader.token);
  }
  const closing = new AbortController();
  for (const reader of readers.slice(0, dashboardCount)) await dashboard(reader, closing.signal);

  // Each worker drives its own readers, so a session's readings stay in order.
  const work = [[70, reader => send('/api/odyle/heartbeat', { sessionId: reader.session, characterId: reader.characters[0].id }, reader.token)],
    [12, reader => { const c = pick(reader.characters); c.value += Math.random() < 0.5 ? 1 : -1; return send('/api/odyle/report', { sessionId: reader.session, characterId: c.id, sequence: ++reader.sequence, characterName: c.name, server: 'Lumiel', region: 'GLOBAL_EU', value: Math.max(0, c.value), source: 'packet', parserVersion: 'test-fixture-v1', confirmed: true }, reader.token); }],
    [8, reader => send('/api/odyle/snapshot/' + pick(reader.rooms), undefined, reader.token)],
    [4, reader => send('/api/odyle/rooms', undefined, reader.token)],
    [3, reader => send(pick(['/api/odyle/upcoming', '/api/odyle/tasks', '/api/odyle/account']), undefined, reader.token)],
    [2, reader => send('/api/collections/characters/records?filter=' + encodeURIComponent(`user = "${reader.id}"`), undefined, reader.token)],
    [1, reader => send('/api/odyle/sharing', { roomId: pick(reader.rooms), characterId: pick(reader.characters).id, enabled: Math.random() < 0.5 }, reader.token)]];
  const total = work.reduce((sum, [weight]) => sum + weight, 0);
  let running = true, done = 0, failed = 0;
  const workers = Array.from({ length: workerCount }, async (_, w) => {
    const mine = readers.filter((_, i) => i % workerCount === w);
    while (running) {
      let roll = Math.random() * total;
      const [, action] = work.find(([weight]) => (roll -= weight) < 0);
      await action(pick(mine)).then(() => done++, () => failed++);
    }
  });
  await delay(3000);
  const started = Date.now(), before = done;
  const res = await fetch(`${url}/api/odyle/admin/pprof/profile?seconds=${seconds}`, { headers: { Authorization: operator } });
  if (!res.ok) throw new Error('The profile route answered ' + res.status);
  const profile = Buffer.from(await res.arrayBuffer());
  const rate = (done - before) / ((Date.now() - started) / 1000);
  running = false;
  await Promise.all(workers);
  closing.abort();
  await writeFile(output, profile);
  console.log(`Wrote ${output} (${Math.round(profile.length / 1024)} KiB): ${seconds} s at ${rate.toFixed(0)} requests/s, ${failed} failed.`);
} finally {
  child.kill();
  await delay(300);
  await rm(directory, { recursive: true, force: true });
}
