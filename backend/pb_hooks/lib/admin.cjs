// The Odyle pages of the superuser dashboard (pb_hooks/admin): the Windows apps
// connected right now, the requests the apps and the dashboard send as they arrive
// ("packets"), the background jobs and the server-wide settings. Only superusers reach
// these routes and the realtime topic.
//
// Packets are Odyle's own API requests, never game traffic. The newest 200 live in
// memory only: nothing is written to the database, and a restart clears them.
const settings = require(__hooks + '/lib/settings.cjs');
const protocols = require(__hooks + '/lib/protocols.cjs');
const jobs = require(__hooks + '/lib/jobs.cjs');
const releases = require(__hooks + '/lib/releases.cjs');
const now = () => new Date().toISOString();
// Date fields are stored as '2026-10-13 21:40:00.000Z'; filters compare them as strings.
const stamp = date => date.toISOString().replace('T', ' ');
const topic = 'odyle.admin.packets', counter = 'odyle.packetCount', prefix = 'odyle.packet.', limit = 200;
// The body fields each route may show; everything else is never kept: tokens, invite and
// pairing codes, device keys, webhook URLs, run notes and task titles included. 'id:taskId'
// keeps a body field under another name: a packet's own id is its number.
const shown = {
  // The Windows app
  session: ['previousSessionId', 'appVersion'],
  report: ['sessionId', 'sequence', 'characterId', 'characterName', 'server', 'region', 'value', 'parserVersion'],
  heartbeat: ['sessionId', 'characterId'],
  invalidate: ['sessionId', 'characterId'],
  character: ['characterName', 'server', 'region'],
  pair: ['name'], 'desktop-sign-in': ['name'], 'desktop-device': ['name'], unpair: [],
  // The dashboard
  create: ['name'], join: [], rename: ['roomId', 'name'], leave: ['roomId'], close: ['roomId'], invites: ['roomId'], revoke: ['roomId', 'memberId'], role: ['roomId', 'memberId', 'role'], transfer: ['roomId', 'memberId'],
  sharing: ['roomId', 'characterId', 'enabled'], wishlist: ['roomId', 'dungeon', 'wanted', 'everyone'], plan: ['roomId', 'id:runId', 'dungeon', 'startsAt', 'going', 'remove'], 'discord-webhook': ['roomId', 'language'],
  task: ['id:taskId', 'done', 'move', 'remove'], profile: ['displayName'], 'desktop-code': [], 'forget-device': ['deviceId'], 'sign-out-everywhere': [], 'delete-account': [], 'delete-character': ['characterId'],
};
function details(kind, body) {
  const out = {};
  for (const field of shown[kind]) {
    const [key, name = key] = field.split(':'), value = body[key];
    if (typeof value === 'string' && value.trim()) out[name] = value.trim().slice(0, 80);
    else if (typeof value === 'number' && Number.isFinite(value)) out[name] = value;
    else if (typeof value === 'boolean') out[name] = value;
  }
  return out;
}
// Numbered under separate keys so recording one packet never rewrites the others.
function remember(app, packet) {
  const store = app.store(); let id = 0;
  store.setFunc(counter, last => (id = (last || 0) + 1));
  const saved = { id, ...packet };
  store.set(prefix + id, JSON.stringify(saved)); store.remove(prefix + (id - limit));
  return saved;
}
function packets(app) {
  const store = app.store(), last = store.get(counter) || 0, list = [];
  for (let id = Math.max(1, last - limit + 1); id <= last; id++) { const raw = store.get(prefix + id); if (raw) list.push(JSON.parse(raw)); }
  return list;
}
function broadcast(app, packet) {
  const clients = app.subscriptionsBroker().clients(), message = new SubscriptionMessage({ name: topic, data: JSON.stringify({ packet }) });
  for (const key in clients) if (clients[key].hasSubscription(topic)) clients[key].send(message);
}
function publish(e, kind, error, ms) {
  let body = {}; try { body = e.requestInfo().body || {}; } catch {}
  const packet = { at: now(), kind, user: e.auth ? e.auth.id : '', account: e.auth ? e.auth.getString('displayName') : '', ok: !error, ms, ...details(kind, body) };
  if (error) packet.error = String(error.message || 'Rejected.').slice(0, 200);
  // Heartbeats and invalidations name their character by id only, room routes their room.
  if (packet.characterId && !packet.characterName) try { packet.characterName = e.app.findRecordById('characters', packet.characterId).getString('characterName'); } catch {}
  if (packet.roomId) try { packet.roomName = e.app.findRecordById('party_rooms', packet.roomId).getString('name'); } catch {}
  // A paired app signs in with its device key alone; the key names the account and is not kept.
  if (kind === 'desktop-sign-in' && !error && typeof body.deviceKey === 'string') try {
    const device = e.app.findFirstRecordByData('desktop_devices', 'digest', $security.sha256(body.deviceKey)), user = e.app.findRecordById('users', device.getString('user'));
    packet.user = user.id; packet.account = user.getString('displayName'); if (!packet.name) packet.name = device.getString('name');
  } catch {}
  broadcast(e.app, remember(e.app, packet));
}
// Wraps an Odyle route: the request is answered exactly as before, then listed,
// accepted or rejected, for superusers. A monitor failure never fails the request.
function observe(e, kind, handle) {
  if (!shown[kind]) return handle();
  const started = Date.now(); let error = null;
  try { return handle(); } catch (failure) { error = failure; throw failure; }
  finally { try { publish(e, kind, error, Date.now() - started); } catch (failure) { console.log('Odyle packet monitor failed: ' + failure.message); } }
}
// One row per reader session. A running Windows app keeps one and touches it with
// every heartbeat (20 s) and reading, so `updated` is its last contact. Sessions
// expire a day after the last contact and the expiry cron deletes them. Rows keep a
// fixed order (account, then connection time): ordering by last contact made every
// heartbeat move its row.
function apps(app) {
  const sessions = app.findRecordsByFilter('publisher_sessions', 'expiresAt > {:now}', '-updated', 200, 0, { now: stamp(new Date()) });
  if (!sessions.length) return [];
  const names = {}, devices = {}, reading = {}, deviceIds = [...new Set(sessions.map(s => s.getString('device')).filter(Boolean))];
  for (const u of app.findRecordsByIds('users', [...new Set(sessions.map(s => s.getString('user')))])) names[u.id] = u.getString('displayName');
  for (const d of deviceIds.length ? app.findRecordsByIds('desktop_devices', deviceIds) : []) devices[d.id] = d.getString('name');
  // The character each session read most recently.
  for (const c of app.findAllRecords('characters', $dbx.in('readingSession', ...sessions.map(s => s.id)))) {
    const id = c.getString('readingSession');
    if (!reading[id] || reading[id].getString('lastSeenAt') < c.getString('lastSeenAt')) reading[id] = c;
  }
  const rows = sessions.map(s => {
    const c = reading[s.id];
    return { sessionId: s.id, user: s.getString('user'), account: names[s.getString('user')] || '', device: devices[s.getString('device')] || '', appVersion: s.getString('appVersion'), connectedAt: s.getString('created'), lastContactAt: s.getString('updated'), readings: s.getInt('sequence'),
      character: c ? { id: c.id, characterName: c.getString('characterName'), server: c.getString('server'), region: c.getString('region'), value: c.getInt('value'), confirmed: c.getBool('confirmed'), valid: c.getBool('valid'), lastSeenAt: c.getString('lastSeenAt'), lastReadingAt: c.getString('lastReadingAt'), parserVersion: c.getString('parserVersion') } : null };
  });
  const key = row => [row.account.toLowerCase(), row.connectedAt, row.sessionId].join('\u0000');
  return rows.sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
}
// The newest Windows release (cached by releases.cjs), so the page can mark outdated apps.
function latestVersion() { try { const release = releases.latest(); return release ? release.version : ''; } catch { return ''; } }
function monitor(e) { return e.json(200, { serverNow: now(), latestVersion: latestVersion(), apps: apps(e.app), packets: packets(e.app) }); }
const jobsJson = (app, extra) => ({ serverNow: now(), startedAt: app.store().get('odyle.startedAt') || '', jobs: jobs.list(app), ...extra });
function jobList(e) { return e.json(200, jobsJson(e.app)); }
function runJob(e) {
  const name = e.request.pathValue('name'), job = jobs.jobs[name];
  if (!job) throw new NotFoundError('There is no such job.');
  if (!job.manual) throw new BadRequestError('This job only runs on its schedule.');
  const result = jobs.run(e.app, name, true);
  if (result.skipped === 'running') throw new BadRequestError('This job is running right now. Try again in a moment.');
  return e.json(200, jobsJson(e.app, { result }));
}
// The adapter names the latest readings carried, so a new decoder shows up here before
// it can be accepted under Server controls.
function seenAdapters(app) {
  const seen = {};
  for (const p of packets(app)) if (p.kind === 'report' && p.parserVersion) {
    const entry = seen[p.parserVersion] || (seen[p.parserVersion] = { name: p.parserVersion, accepted: 0, rejected: 0, lastAt: '' });
    entry[p.ok ? 'accepted' : 'rejected']++; entry.lastAt = p.at;
  }
  return Object.keys(seen).map(name => seen[name]);
}
const settingsJson = (app, current) => ({ settings: current, defaults: settings.defaults, builtInAdapters: protocols.verifiedAdapters, acceptedAdapters: settings.adapters(app), seenAdapters: seenAdapters(app) });
function readSettings(e) { return e.json(200, settingsJson(e.app, settings.read(e.app))); }
function saveSettings(e) {
  let saved; try { saved = settings.write(e.app, e.requestInfo().body || {}); } catch (error) { throw new BadRequestError(error.message || 'Settings could not be saved.'); }
  return e.json(200, settingsJson(e.app, saved));
}
// PocketBase serves extension files with a 14-day browser cache, so main.js imports
// the page under this content hash and a deploy reaches open dashboards at once.
function ui(e) {
  const version = e.app.store().getOrSet('odyle.adminUi', () => $security.sha256(['odyle.js', 'odyle.css'].map(name => toString($os.readFile(__hooks + '/admin/' + name))).join('\n')).slice(0, 16));
  return e.json(200, { version });
}
module.exports = { observe, monitor, jobList, runJob, readSettings, saveSettings, ui, topic };
