// The Odyle page of the superuser dashboard (pb_hooks/admin): the Windows apps
// connected right now, the requests they send as they arrive ("packets") and the
// server-wide settings. Only superusers reach these routes and the realtime topic.
//
// Packets are the companion's own API requests, never game traffic. The newest 200
// live in memory only: nothing is written to the database, and a restart clears them.
const settings = require(__hooks + '/lib/settings.cjs');
const now = () => new Date().toISOString();
// Date fields are stored as '2026-10-13 21:40:00.000Z'; filters compare them as strings.
const stamp = date => date.toISOString().replace('T', ' ');
const topic = 'odyle.admin.packets', counter = 'odyle.packetCount', prefix = 'odyle.packet.', limit = 200;
// The body fields each companion route may show; everything else, tokens and codes
// included, is never kept.
const shown = {
  session: ['previousSessionId'],
  report: ['sessionId', 'sequence', 'characterId', 'characterName', 'server', 'region', 'value', 'parserVersion'],
  heartbeat: ['sessionId', 'characterId'],
  invalidate: ['sessionId', 'characterId'],
  character: ['characterName', 'server', 'region'],
};
function details(kind, body) {
  const out = {};
  for (const key of shown[kind]) {
    const value = body[key];
    if (typeof value === 'string' && value.trim()) out[key] = value.trim().slice(0, 80);
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
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
  // Heartbeats and invalidations name their character by id only.
  if (packet.characterId && !packet.characterName) try { packet.characterName = e.app.findRecordById('characters', packet.characterId).getString('characterName'); } catch {}
  broadcast(e.app, remember(e.app, packet));
}
// Wraps a companion route: the request is answered exactly as before, then listed,
// accepted or rejected, for superusers. A monitor failure never fails the request.
function observe(e, kind, handle) {
  if (!shown[kind]) return handle();
  const started = Date.now(); let error = null;
  try { return handle(); } catch (failure) { error = failure; throw failure; }
  finally { try { publish(e, kind, error, Date.now() - started); } catch (failure) { console.log('Odyle packet monitor failed: ' + failure.message); } }
}
// One row per reader session. A running Windows app keeps one and touches it with
// every heartbeat (20 s) and reading, so `updated` is its last contact. Sessions
// expire a day after the last contact and the expiry cron deletes them.
function apps(app) {
  const sessions = app.findRecordsByFilter('publisher_sessions', 'expiresAt > {:now}', '-updated', 200, 0, { now: stamp(new Date()) });
  if (!sessions.length) return [];
  const names = {}, reading = {};
  for (const u of app.findRecordsByIds('users', [...new Set(sessions.map(s => s.getString('user')))])) names[u.id] = u.getString('displayName');
  // The character each session read most recently.
  for (const c of app.findAllRecords('characters', $dbx.in('readingSession', ...sessions.map(s => s.id)))) {
    const id = c.getString('readingSession');
    if (!reading[id] || reading[id].getString('lastSeenAt') < c.getString('lastSeenAt')) reading[id] = c;
  }
  return sessions.map(s => {
    const c = reading[s.id];
    return { sessionId: s.id, user: s.getString('user'), account: names[s.getString('user')] || '', connectedAt: s.getString('created'), lastContactAt: s.getString('updated'), readings: s.getInt('sequence'),
      character: c ? { id: c.id, characterName: c.getString('characterName'), server: c.getString('server'), region: c.getString('region'), value: c.getInt('value'), confirmed: c.getBool('confirmed'), valid: c.getBool('valid'), lastSeenAt: c.getString('lastSeenAt'), lastReadingAt: c.getString('lastReadingAt'), parserVersion: c.getString('parserVersion') } : null };
  });
}
function monitor(e) { return e.json(200, { serverNow: now(), apps: apps(e.app), packets: packets(e.app) }); }
function readSettings(e) { return e.json(200, { settings: settings.read(e.app), defaults: settings.defaults }); }
function saveSettings(e) {
  let saved; try { saved = settings.write(e.app, e.requestInfo().body || {}); } catch (error) { throw new BadRequestError(error.message || 'Settings could not be saved.'); }
  return e.json(200, { settings: saved, defaults: settings.defaults });
}
// PocketBase serves extension files with a 14-day browser cache, so main.js imports
// the page under this content hash and a deploy reaches open dashboards at once.
function ui(e) {
  const version = e.app.store().getOrSet('odyle.adminUi', () => $security.sha256(['odyle.js', 'odyle.css'].map(name => toString($os.readFile(__hooks + '/admin/' + name))).join('\n')).slice(0, 16));
  return e.json(200, { version });
}
module.exports = { observe, monitor, readSettings, saveSettings, ui, topic };
