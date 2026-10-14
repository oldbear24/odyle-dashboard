const validate = require(__hooks + '/lib/validation.cjs');
const portraits = require(__hooks + '/lib/portraits.cjs');
const settings = require(__hooks + '/lib/settings.cjs');
const discord = require(__hooks + '/lib/discord.cjs');
const now = () => new Date().toISOString();
const expiry = seconds => new Date(Date.now() + seconds * 1000).toISOString();
// Date fields are stored as '2026-10-13 21:40:00.000Z' and filters compare them as
// strings, so filter params must use the same space-separated form, not ISO 'T'.
const stamp = date => date.toISOString().replace('T', ' ');
const list = (app, name, filter, params) => app.findRecordsByFilter(name, filter, 'id', 500, 0, params || {});
// Per-account caps. They only stop runaway or abusive clients: players keep a handful
// of characters, and every character costs the portrait cron one PLAYNC lookup a day.
const limits = { characters: 30, ownedRooms: 20, memberships: 50, desktopDevices: 10 };
function membership(app, userId, roomId) {
  const found = list(app, 'room_members', 'room = {:room} && user = {:user}', { room: roomId, user: userId });
  if (!found.length) throw new ForbiddenError('You are not a member of this room.');
  return found[0];
}
function owner(app, userId, roomId) {
  let room; try { room = app.findRecordById('party_rooms', roomId); } catch { throw new NotFoundError('This room no longer exists.'); }
  if (room.getString('owner') !== userId) throw new ForbiddenError('Only the room owner can do this.'); return room;
}
function ownCharacter(app, userId, id) {
  let character; try { character = app.findRecordById('characters', id); } catch { throw new NotFoundError('This character no longer exists.'); }
  if (character.getString('user') !== userId) throw new ForbiddenError('This character belongs to another account.'); return character;
}
// Another membership of the owner's room, for removing, re-roling or handing over.
function otherMember(app, room, memberId, userId, message) {
  let target; try { target = app.findRecordById('room_members', memberId); } catch { throw new NotFoundError('This member is no longer in the room.'); }
  if (target.getString('room') !== room.id || target.getString('user') === userId) throw new ForbiddenError(message); return target;
}
function newCharacter(app, userId) {
  if (app.countRecords('characters', $dbx.hashExp({ user: userId })) >= limits.characters) throw new BadRequestError('You can keep up to ' + limits.characters + ' characters. Delete one you no longer play under My rooms & characters.');
  const record = new Record(app.findCollectionByNameOrId('characters')); record.set('user', userId); return record;
}
function ownSession(app, userId, id) {
  let session; try { session = app.findRecordById('publisher_sessions', id); } catch { throw new ForbiddenError('Publisher session expired. Reconnect.'); }
  if (session.getString('user') !== userId || Date.parse(session.getString('expiresAt')) <= Date.now()) throw new ForbiddenError('Publisher session expired. Reconnect.'); return session;
}
function notify(app, roomIds) {
  for (const id of [...new Set(roomIds)]) {
    const topic = 'odyle.room.' + id, clients = app.subscriptionsBroker().clients();
    for (const key in clients) if (clients[key].hasSubscription(topic)) clients[key].send(new SubscriptionMessage({ name: topic, data: JSON.stringify({ refresh: true }) }));
  }
}
// Odyle per cube is one server-wide value (odyle_settings, edited by superusers).
// Rooms keep their legacy cost field, but every response reports the setting.
const odylePerCube = app => settings.read(app).odylePerCube;
// The Discord webhook is a hidden field, so publicExport never carries it; members only
// learn whether the room posts reminders.
const roomJson = (room, cost) => ({ ...room.publicExport(), cost, discordReminders: Boolean(room.getString('discordWebhook')) });
const shared = m => Array.from(m.getStringSlice('sharedCharacters'));
const roomsFor = (app, userId) => list(app, 'room_members', 'user = {:user}', { user: userId }).map(m => m.getString('room'));
// lastActiveAt marks the last time the account used Odyle, for the optional clean-up
// of inactive accounts (retention). Written at most hourly, so readings stay cheap.
function touch(e) {
  const auth = e.auth; if (!auth || auth.collection().name !== 'users') return;
  if (auth.getString('lastActiveAt') > stamp(new Date(Date.now() - 3600000))) return;
  try { const user = e.app.findRecordById('users', auth.id); user.set('lastActiveAt', now()); e.app.save(user); } catch (error) { console.log('Odyle activity mark failed: ' + error.message); }
}
function run(e, action) {
  touch(e);
  try { return action(); } catch (error) {
    if (error instanceof BadRequestError || error instanceof ForbiddenError || error instanceof NotFoundError || error instanceof UnauthorizedError) throw error;
    // A record deleted meanwhile (another tab, another member) is not a database error to show.
    if (/no rows in result set/i.test(error.message || '')) throw new NotFoundError('This no longer exists. Reload the page.');
    throw new BadRequestError(error.message || 'Request could not be completed.');
  }
}
function mutate(e, action) { return run(e, () => {
  let result; const affected = [];
  e.app.runInTransaction(app => { result = action(app, e.auth, e.requestInfo().body, affected); });
  notify(e.app, affected); return e.json(200, result || { success: true });
}); }
function invite(app, room, role) {
  const code = $security.randomStringWithAlphabet(12, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
  const record = new Record(app.findCollectionByNameOrId('room_invites'));
  record.set('room', room.id); record.set('role', role); record.set('digest', $security.sha256(code)); record.set('expiresAt', expiry(1800)); app.save(record);
  return { code, role, expiresAt: record.getString('expiresAt') };
}
function addMember(app, roomId, userId, role) {
  const record = new Record(app.findCollectionByNameOrId('room_members'));
  record.set('room', roomId); record.set('user', userId); record.set('role', role); record.set('sharedCharacters', []); app.save(record); return record;
}
function create(e) { return mutate(e, (app, user, body) => {
  if (app.countRecords('party_rooms', $dbx.hashExp({ owner: user.id })) >= limits.ownedRooms) throw new BadRequestError('You can own up to ' + limits.ownedRooms + ' rooms. Close one you no longer use.');
  joinable(app, user.id);
  const room = new Record(app.findCollectionByNameOrId('party_rooms'));
  const cost = odylePerCube(app); room.set('name', validate.text(body.name, 'Room name', 60)); room.set('owner', user.id); room.set('cost', cost); app.save(room);
  return { room: roomJson(room, cost), membership: addMember(app, room.id, user.id, 'owner'), invites: [invite(app, room, 'reporter'), invite(app, room, 'viewer')] };
}); }
function joinable(app, userId) {
  if (app.countRecords('room_members', $dbx.hashExp({ user: userId })) >= limits.memberships) throw new BadRequestError('You can be in up to ' + limits.memberships + ' rooms. Leave one first.');
}
function join(e) { return mutate(e, (app, user, body, affected) => {
  const code = validate.text(body.code, 'Invite code', 20).replace(/[\s-]/g, '').toUpperCase(); let invitation;
  try { invitation = app.findFirstRecordByData('room_invites', 'digest', $security.sha256(code)); } catch { throw new BadRequestError('Invite is invalid or expired.'); }
  if (Date.parse(invitation.getString('expiresAt')) <= Date.now()) throw new BadRequestError('Invite is invalid or expired.');
  const room = app.findRecordById('party_rooms', invitation.getString('room')), cost = odylePerCube(app);
  const existing = list(app, 'room_members', 'room = {:room} && user = {:user}', { room: room.id, user: user.id });
  if (existing.length) return { room: roomJson(room, cost), membership: existing[0] };
  if (app.countRecords('room_members', $dbx.hashExp({ room: room.id })) >= 50) throw new BadRequestError('Room is full.');
  joinable(app, user.id);
  const member = addMember(app, room.id, user.id, invitation.getString('role')); affected.push(room.id); return { room: roomJson(room, cost), membership: member };
}); }
// One query for the memberships, one for their rooms and one for the cost; serverNow
// lets the dashboard correct its clock without a heartbeat round trip.
function rooms(e) { return run(e, () => {
  const cost = odylePerCube(e.app), memberships = list(e.app, 'room_members', 'user = {:user}', { user: e.auth.id }), byId = {};
  for (const r of memberships.length ? e.app.findRecordsByIds('party_rooms', memberships.map(m => m.getString('room'))) : []) byId[r.id] = r;
  return e.json(200, { odylePerCube: cost, serverNow: now(), rooms: memberships.filter(m => byId[m.getString('room')]).map(m => ({ ...roomJson(byId[m.getString('room')], cost), role: m.getString('role'), sharedCharacters: shared(m), sharing: shared(m).length > 0 })) });
}); }
function snapshot(e) { return run(e, () => {
  const id = e.request.pathValue('id'); membership(e.app, e.auth.id, id); const rules = settings.read(e.app);
  // Three queries for the whole room: members, their accounts and all their
  // characters, instead of two lookups per member.
  const room = e.app.findRecordById('party_rooms', id), members = list(e.app, 'room_members', 'room = {:room}', { room: id });
  const userIds = members.map(m => m.getString('user')), names = {}, characters = {};
  for (const u of userIds.length ? e.app.findRecordsByIds('users', userIds) : []) names[u.id] = u.getString('displayName');
  for (const c of userIds.length ? e.app.findAllRecords('characters', $dbx.in('user', ...userIds)) : []) (characters[c.getString('user')] ||= []).push(c);
  for (const owned of Object.values(characters)) owned.sort((a, b) => (a.getString('created') < b.getString('created') ? -1 : a.getString('created') > b.getString('created') ? 1 : 0));
  // Others see only the characters a member linked to this room; members always
  // see all of their own, each flagged with whether it is shared here.
  return e.json(200, { room: roomJson(room, rules.odylePerCube), serverNow: now(), members: members.map(m => {
    const linked = shared(m), mine = m.getString('user') === e.auth.id;
    return { ...m.publicExport(), sharing: linked.length > 0, displayName: names[m.getString('user')] || '',
      characters: (characters[m.getString('user')] || []).filter(c => mine || linked.includes(c.id)).map(c => ({ ...c.publicExport(), shared: linked.includes(c.id) })) };
  }), wishlist: wishlistOf(e.app, id, members), runs: runsOf(e.app, id, members), dungeons: rules.dungeons });
}); }
// The room's dungeon wishlist grouped by dungeon, most wanted first, then oldest.
// `users` are the accounts that still need it; clients name them from `members`.
function wishlistOf(app, roomId, members = list(app, 'room_members', 'room = {:room}', { room: roomId })) {
  const users = {}, entries = {};
  for (const m of members) users[m.id] = m.getString('user');
  for (const w of app.findRecordsByFilter('room_wishes', 'room = {:room}', 'created', 0, 0, { room: roomId })) {
    const key = w.getString('key'), entry = entries[key] || (entries[key] = { key, dungeon: w.getString('dungeon'), since: w.getString('created'), users: [] });
    entry.users.push(users[w.getString('member')]);
  }
  return Object.values(entries).sort((a, b) => b.users.length - a.users.length || (a.since < b.since ? -1 : a.since > b.since ? 1 : 0));
}
// Reporters and owners add dungeons they need, anyone removes their own entry, and
// the owner can clear a dungeon for everyone, for example after the party ran it.
function wishlist(e) { return mutate(e, (app, user, body, affected) => {
  const m = membership(app, user.id, String(body.roomId)), roomId = m.getString('room'), wish = validate.dungeon(body.dungeon);
  if (typeof body.wanted !== 'boolean') throw new BadRequestError('Wanted must be true or false.');
  const entry = list(app, 'room_wishes', 'room = {:room} && key = {:key}', { room: roomId, key: wish.key }), mine = entry.filter(w => w.getString('member') === m.id);
  if (body.everyone === true) {
    if (body.wanted) throw new BadRequestError('A dungeon can only be cleared for everyone, not added for them.');
    owner(app, user.id, roomId); for (const w of entry) app.delete(w);
  } else if (!body.wanted) for (const w of mine) app.delete(w);
  else if (!mine.length) {
    if (m.getString('role') === 'viewer') throw new ForbiddenError('Viewers cannot add dungeons to this room\'s wishlist.');
    if (app.countRecords('room_wishes', $dbx.hashExp({ member: m.id })) >= 20) throw new BadRequestError('You can have up to 20 dungeons on a room\'s wishlist.');
    if (!entry.length && wishlistOf(app, roomId).length >= 50) throw new BadRequestError('This room\'s wishlist is full (50 dungeons).');
    // A new entry must be in the dungeon catalog, when there is one, and takes its spelling.
    const listed = entry.length ? null : settings.dungeonName(app, wish.dungeon);
    if (!entry.length && !listed) throw new BadRequestError('Choose a dungeon from the list.');
    const record = new Record(app.findCollectionByNameOrId('room_wishes'));
    // Joining an entry keeps its first spelling, whatever case this member typed.
    record.set('room', roomId); record.set('member', m.id); record.set('dungeon', entry.length ? entry[0].getString('dungeon') : listed.dungeon); record.set('key', wish.key); app.save(record);
  }
  affected.push(roomId); return { wishlist: wishlistOf(app, roomId) };
}); }
// Reset times of the Global service, edited by superusers in odyle_settings next to
// odylePerCube. Launch defaults: 07:00 UTC daily, Wednesday weekly.
function resets(app) { const s = settings.read(app); return { dailyResetHour: s.dailyResetHour, weeklyResetDay: s.weeklyResetDay }; }
// Personal daily and weekly checklists in the account's order. doneAt is the last time the
// account checked a task; clients show it done while that is after the current reset
// (src/tasks.js), so nothing has to uncheck tasks and nothing is deleted at reset.
const tasksOf = (app, userId) => app.findRecordsByFilter('user_tasks', 'user = {:user}', 'position,created', 0, 0, { user: userId }).map(t => t.publicExport());
// A plain array: Go slices from the VM do not take element swaps.
const taskList = (app, userId, cadence) => Array.from(app.findRecordsByFilter('user_tasks', 'user = {:user} && cadence = {:cadence}', 'position,created', 0, 0, { user: userId, cadence }));
const checklist = (app, userId) => ({ tasks: tasksOf(app, userId), resets: resets(app), serverNow: now() });
function tasks(e) { return run(e, () => e.json(200, checklist(e.app, e.auth.id))); }
// One route for the checklist: { title, cadence } adds a task, { id, done } stores or
// clears the time it was checked, { id, title } renames it, { id, move: 'up'|'down' }
// moves it within its list and { id, remove: true } deletes it. Tasks are private to
// the account and every answer carries the whole list.
function task(e) { return mutate(e, (app, user, body) => {
  if (body.id) {
    let t; try { t = app.findRecordById('user_tasks', String(body.id)); } catch { throw new NotFoundError('This task no longer exists.'); }
    if (t.getString('user') !== user.id) throw new ForbiddenError('This task belongs to another account.');
    if (body.remove === true) app.delete(t);
    else if (typeof body.done === 'boolean') { t.set('doneAt', body.done ? now() : ''); app.save(t); }
    else if (body.title !== undefined) { t.set('title', validate.task({ title: body.title, cadence: t.getString('cadence') }).title); app.save(t); }
    else if (body.move === 'up' || body.move === 'down') {
      const order = taskList(app, user.id, t.getString('cadence')), at = order.findIndex(x => x.id === t.id), to = at + (body.move === 'up' ? -1 : 1);
      if (to >= 0 && to < order.length) [order[at], order[to]] = [order[to], order[at]];
      order.forEach((x, i) => { if (x.getInt('position') !== i + 1) { x.set('position', i + 1); app.save(x); } });
    } else throw new BadRequestError('Send done (true or false), a new title, move (up or down) or remove: true.');
  } else {
    const data = validate.task(body);
    if (app.countRecords('user_tasks', $dbx.hashExp({ user: user.id })) >= 40) throw new BadRequestError('You can keep up to 40 tasks.');
    const last = taskList(app, user.id, data.cadence).pop(), t = new Record(app.findCollectionByNameOrId('user_tasks'));
    t.set('user', user.id); t.set('title', data.title); t.set('cadence', data.cadence); t.set('position', last ? last.getInt('position') + 1 : 1); app.save(t);
  }
  return checklist(app, user.id);
}); }
// Ends a reader session; the characters it read keep their values but turn stale.
function endSession(app, session) {
  for (const c of list(app, 'characters', 'readingSession = {:id}', { id: session.id })) { c.set('valid', false); app.save(c); }
  app.delete(session);
}
// A paired app sends its device key, so removing the PC ends this session too; a key
// the server no longer knows means the pairing ended (401, and the app pairs again).
function session(e) { return mutate(e, (app, user, body, affected) => {
  const device = body.deviceKey ? findDevice(app, deviceKey(body)) : null;
  if (body.deviceKey && (!device || device.getString('user') !== user.id)) throw new UnauthorizedError('This PC is no longer paired with an account.');
  if (body.previousSessionId) {
    endSession(app, ownSession(app, user.id, String(body.previousSessionId))); affected.push(...roomsFor(app, user.id));
  }
  // A PC runs one Odyle at a time, so its new session replaces the ones it left open (a
  // restart, an update, a crash). Their readings are not marked stale: a restarted app takes
  // its character over within seconds, and otherwise the missing heartbeat turns it stale.
  if (device) for (const old of list(app, 'publisher_sessions', 'device = {:device}', { device: device.id })) app.delete(old);
  const record = new Record(app.findCollectionByNameOrId('publisher_sessions'));
  record.set('user', user.id); record.set('expiresAt', expiry(86400)); if (device) record.set('device', device.id); app.save(record); return { sessionId: record.id, sequence: 0 };
}); }
function character(e) { return mutate(e, (app, user, body, affected) => {
  // Identity can be saved before the first game reading. This endpoint cannot
  // supply energy, confidence, ownership, timestamps or a publisher session.
  for (const key of Object.keys(body)) if (!['characterName', 'server', 'region'].includes(key)) throw new BadRequestError('Only character name, server and region may be saved here.');
  const data = validate.characterIdentity(body);
  const existing = list(app, 'characters', 'user = {:user} && region = {:region} && server = {:server} && characterName = {:name}', { user: user.id, region: data.region, server: data.server, name: data.characterName });
  if (existing.length) return { character: existing[0] };
  const record = newCharacter(app, user.id);
  for (const key of ['characterName', 'server', 'region']) record.set(key, data[key]);
  record.set('confirmed', false); record.set('valid', false); app.save(record);
  affected.push(...roomsFor(app, user.id)); return { character: record };
}); }
function report(e) { return mutate(e, (app, user, body, affected) => {
  const session = ownSession(app, user.id, String(body.sessionId));
  const data = validate.reading(body, { sessionId: session.id, sequence: session.getInt('sequence') }, require(__hooks + '/lib/protocols.cjs').verifiedAdapters); let character;
  if (body.characterId) character = ownCharacter(app, user.id, String(body.characterId));
  else {
    const existing = list(app, 'characters', 'user = {:user} && region = {:region} && server = {:server} && characterName = {:name}', { user: user.id, region: data.region, server: data.server, name: data.characterName });
    character = existing[0] || newCharacter(app, user.id);
  }
  // An existing character keeps the identity the game gave it; only a lookup without
  // characterId may name a new one. lastReadingAt marks the last change, so a value
  // re-sent unchanged (the reader resumed after a pause) keeps its timestamp.
  if (!body.characterId) for (const key of ['characterName', 'server', 'region']) character.set(key, data[key]);
  // Every change (the first reading included) is also kept in the character's history.
  const changed = !character.getBool('confirmed') || character.getInt('value') !== data.value;
  if (changed) character.set('lastReadingAt', now());
  character.set('value', data.value);
  character.set('confirmed', true); character.set('valid', true); character.set('source', data.source); character.set('parserVersion', data.parserVersion); character.set('lastSeenAt', now()); character.set('readingSession', session.id); app.save(character);
  if (changed) { const point = new Record(app.findCollectionByNameOrId('character_readings')); point.set('character', character.id); point.set('value', data.value); app.save(point); }
  session.set('sequence', data.sequence); session.set('expiresAt', expiry(86400)); app.save(session); affected.push(...roomsFor(app, user.id)); return { character, serverNow: now() };
}); }
function sharing(e) { return mutate(e, (app, user, body, affected) => {
  const m = membership(app, user.id, String(body.roomId));
  if (m.getString('role') === 'viewer') throw new ForbiddenError('Viewers cannot share characters with this room.');
  if (typeof body.enabled !== 'boolean') throw new BadRequestError('Sharing must be true or false.');
  // Sharing is per character. Without characterId (older clients) the choice
  // applies to every character the account has saved right now.
  const targets = body.characterId ? [ownCharacter(app, user.id, String(body.characterId)).id] : list(app, 'characters', 'user = {:user}', { user: user.id }).map(c => c.id);
  const next = shared(m).filter(id => !targets.includes(id)); if (body.enabled) next.push(...targets);
  m.set('sharedCharacters', next); app.save(m); affected.push(m.getString('room'));
  return { sharedCharacters: next };
}); }
// Loads the official portrait into the character; the file is only rewritten when
// the image changed. Download errors are thrown after the attempt is recorded.
// Never call inside a transaction: it waits on PLAYNC. Portraits come only from
// the game; no route lets players set or replace them.
function gamePortrait(app, id) {
  const before = app.findRecordById('characters', id); let found = null, failure = null;
  try { found = portraits.fetchPortrait(before.getString('characterName'), before.getString('server'), before.getString('region')); } catch (error) { failure = error; }
  // Reload: a reading may have been saved while PLAYNC answered.
  const c = app.findRecordById('characters', id);
  const changed = Boolean(found) && (found.hash !== c.getString('portraitHash') || !c.getString('portrait'));
  if (changed) { c.set('portrait', found.file); c.set('portraitHash', found.hash); }
  c.set('portraitCheckedAt', now()); app.save(c);
  if (changed) notify(app, roomsFor(app, c.getString('user')));
  if (failure) throw failure;
}
// Cron: new characters get their official portrait within a minute, missing ones
// are retried hourly and the rest refresh daily. A few characters per run keeps
// traffic to PLAYNC low.
function refreshPortraits() {
  const ago = ms => stamp(new Date(Date.now() - ms));
  const due = $app.findRecordsByFilter('characters', "portraitCheckedAt = '' || (portrait = '' && portraitCheckedAt < {:hour}) || portraitCheckedAt < {:day}", 'portraitCheckedAt', 5, 0, { hour: ago(3600000), day: ago(86400000) });
  for (const c of due) { try { gamePortrait($app, c.id); } catch (error) { console.log('Odyle portrait refresh failed for character ' + c.id + ': ' + error.message); } }
}
// Presence only. No realtime refresh is sent: clients derive live/stale from
// lastSeenAt on their own schedule, and a broadcast every 20 seconds per reader
// made every member refetch the whole snapshot for nothing.
function heartbeat(e) { return mutate(e, (app, user, body) => {
  if (body.sessionId) {
    const session = ownSession(app, user.id, String(body.sessionId)); session.set('expiresAt', expiry(86400)); app.save(session);
    if (body.characterId) { const c = ownCharacter(app, user.id, String(body.characterId)); if (c.getString('readingSession') === session.id) { c.set('lastSeenAt', now()); app.save(c); } }
  }
  return { serverNow: now() };
}); }
function invalidate(e) { return mutate(e, (app, user, body, affected) => {
  const c = ownCharacter(app, user.id, String(body.characterId)); if (body.sessionId && c.getString('readingSession') !== String(body.sessionId)) return;
  c.set('valid', false); app.save(c); affected.push(...roomsFor(app, user.id));
}); }
function leave(e) { return mutate(e, (app, user, body, affected) => {
  const m = membership(app, user.id, String(body.roomId));
  if (m.getString('role') === 'owner') throw new BadRequestError('Use close to delete an owned room. Characters are retained.');
  affected.push(m.getString('room')); app.delete(m);
}); }
function close(e) { return mutate(e, (app, user, body, affected) => { const room = owner(app, user.id, String(body.roomId)); affected.push(room.id); app.delete(room); }); }
function invites(e) { return mutate(e, (app, user, body) => {
  const room = owner(app, user.id, String(body.roomId)); for (const old of list(app, 'room_invites', 'room = {:room}', { room: room.id })) app.delete(old);
  return { invites: [invite(app, room, 'reporter'), invite(app, room, 'viewer')] };
}); }
function revoke(e) { return mutate(e, (app, user, body, affected) => {
  const room = owner(app, user.id, String(body.roomId)), target = otherMember(app, room, String(body.memberId), user.id, 'Cannot remove this member.');
  app.delete(target); affected.push(room.id);
}); }
function desktopCode(e) { return mutate(e, (app, user) => {
  for (const old of list(app, 'desktop_codes', 'user = {:user}', { user: user.id })) app.delete(old);
  const code = $security.randomStringWithAlphabet(16, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'), record = new Record(app.findCollectionByNameOrId('desktop_codes'));
  record.set('user', user.id); record.set('digest', $security.sha256(code)); record.set('expiresAt', expiry(300)); app.save(record);
  return { code, expiresAt: record.getString('expiresAt') };
}); }
// A paired Windows app's lasting credential. Only its digest is stored; the app keeps
// the key (DPAPI) and trades it for account tokens with desktopSignIn. An account keeps
// its most recently used devices, so stale pairings of reinstalled PCs drop off.
function newDevice(app, userId, name) {
  const devices = app.findRecordsByFilter('desktop_devices', 'user = {:user}', '-lastUsedAt,-created', 500, 0, { user: userId });
  for (const old of devices.slice(limits.desktopDevices - 1)) dropDevice(app, old);
  const key = $security.randomString(48), record = new Record(app.findCollectionByNameOrId('desktop_devices'));
  record.set('user', userId); record.set('digest', $security.sha256(key)); record.set('lastUsedAt', now()); record.set('name', name || ''); app.save(record);
  return key;
}
// Ends a pairing: its key stops working and its reader sessions end (their readings turn
// stale), so the app notices at its next heartbeat and asks for a new connection link.
function dropDevice(app, device) {
  for (const s of list(app, 'publisher_sessions', 'device = {:device}', { device: device.id })) endSession(app, s);
  app.delete(device);
}
const deviceKey = body => validate.text(body.deviceKey, 'Device key', 100);
const findDevice = (app, key) => { try { return app.findFirstRecordByData('desktop_devices', 'digest', $security.sha256(key)); } catch { return null; } };
// The Windows computer name the app sends with pairing and sign-in; optional, for the
// list of paired PCs. Anything that is not a usable name is left out, never refused.
const deviceName = value => typeof value === 'string' && value.trim() ? value.trim().replace(/\s+/g, ' ').slice(0, 40) : '';
function pair(e) { return run(e, () => {
  const body = e.requestInfo().body, code = validate.text(body.code, 'Pairing code', 24).replace(/[\s-]/g, '').toUpperCase(); let result;
  e.app.runInTransaction(app => {
    let record; try { record = app.findFirstRecordByData('desktop_codes', 'digest', $security.sha256(code)); } catch { throw new BadRequestError('Pairing code is invalid or expired.'); }
    if (Date.parse(record.getString('expiresAt')) <= Date.now()) throw new BadRequestError('Pairing code is invalid or expired.');
    const user = app.findRecordById('users', record.getString('user')); app.delete(record); result = { token: user.newAuthToken(), record: user, deviceKey: newDevice(app, user.id, deviceName(body.name)) };
  }); return e.json(200, result);
}); }
// A device key for an app paired before keys existed; it asks with its still-valid token.
function desktopDevice(e) { return mutate(e, (app, user, body) => ({ deviceKey: newDevice(app, user.id, deviceName(body.name)) })); }
// Public: a fresh account token for a paired app. An unknown key (the app disconnected,
// the account signed out everywhere or was deleted) is 401, and the app pairs again.
function desktopSignIn(e) { return run(e, () => {
  const body = e.requestInfo().body, device = findDevice(e.app, deviceKey(body)), name = deviceName(body.name);
  if (!device) throw new UnauthorizedError('This PC is no longer paired with an account.');
  const user = e.app.findRecordById('users', device.getString('user'));
  device.set('lastUsedAt', now()); if (name) device.set('name', name); e.app.save(device);
  return e.json(200, { token: user.newAuthToken(), record: user });
}); }
// Public: the app's Disconnect forgets its key on the server too. Unknown keys are fine.
function unpair(e) { return run(e, () => {
  const device = findDevice(e.app, deviceKey(e.requestInfo().body));
  if (device) { const rooms = roomsFor(e.app, device.getString('user')); e.app.runInTransaction(app => dropDevice(app, app.findRecordById('desktop_devices', device.id))); notify(e.app, rooms); }
  return e.json(200, { success: true });
}); }
// Account & data removes one paired PC, for example a lost or sold one; the other
// browsers and PCs stay signed in.
function forgetDevice(e) { return mutate(e, (app, user, body, affected) => {
  let device; try { device = app.findRecordById('desktop_devices', String(body.deviceId)); } catch { throw new NotFoundError('This PC is no longer paired.'); }
  if (device.getString('user') !== user.id) throw new ForbiddenError('This PC is paired with another account.');
  dropDevice(app, device); affected.push(...roomsFor(app, user.id));
}); }
function cleanup() {
  const at = stamp(new Date());
  for (const name of ['room_invites', 'desktop_codes']) for (const item of list($app, name, 'expiresAt <= {:now}', { now: at })) $app.delete(item);
  for (const item of list($app, 'publisher_sessions', 'expiresAt <= {:now}', { now: at })) endSession($app, item);
  // Odyle history covers 30 days; planned runs go a day after they started.
  for (const item of list($app, 'character_readings', 'created < {:month}', { month: stamp(new Date(Date.now() - 30 * 86400000)) })) $app.delete(item);
  for (const item of list($app, 'room_runs', 'startsAt < {:day}', { day: stamp(new Date(Date.now() - 86400000)) })) $app.delete(item);
}
function configureDiscord(app) {
  const clientId = $os.getenv('DISCORD_CLIENT_ID'), clientSecret = $os.getenv('DISCORD_CLIENT_SECRET');
  if (clientId && clientSecret) { const users = app.findCollectionByNameOrId('users'); users.oauth2 = { enabled: true, providers: [{ name: 'discord', clientId, clientSecret }] }; app.save(users); }
}
// Upcoming runs of a room, soonest first; a run stays listed until three hours after it
// started. `planner` and `attendees` are account ids; clients name them from `members`.
function runsOf(app, roomId, members = list(app, 'room_members', 'room = {:room}', { room: roomId })) {
  const users = {}; for (const m of members) users[m.id] = m.getString('user');
  return app.findRecordsByFilter('room_runs', 'room = {:room} && startsAt >= {:since}', 'startsAt', 0, 0, { room: roomId, since: stamp(new Date(Date.now() - 3 * 3600000)) })
    .map(r => ({ id: r.id, dungeon: r.getString('dungeon'), startsAt: r.getString('startsAt'), note: r.getString('note'), planner: users[r.getString('plannedBy')] || '', attendees: Array.from(r.getStringSlice('attendees')).map(id => users[id]).filter(Boolean) }));
}
// Planned runs: { roomId, dungeon, startsAt, note? } plans one with the planner going,
// { roomId, id, going } joins or leaves it, { roomId, id, dungeon?, startsAt?, note? }
// changes it and { roomId, id, remove: true } cancels it (changes and cancelling: its
// planner or the room owner). Owners and players plan and join; viewers read.
function plan(e) { return mutate(e, (app, user, body, affected) => {
  const m = membership(app, user.id, String(body.roomId)), roomId = m.getString('room'), viewer = m.getString('role') === 'viewer';
  if (body.id) {
    let r; try { r = app.findRecordById('room_runs', String(body.id)); } catch { throw new NotFoundError('This run is no longer planned.'); }
    if (r.getString('room') !== roomId) throw new NotFoundError('This run is no longer planned.');
    if (body.remove === true) {
      if (r.getString('plannedBy') !== m.id && m.getString('role') !== 'owner') throw new ForbiddenError('Only its planner or the room owner can cancel this run.');
      app.delete(r);
    } else if (typeof body.going === 'boolean') {
      if (viewer) throw new ForbiddenError('Viewers cannot join runs.');
      const going = Array.from(r.getStringSlice('attendees')).filter(id => id !== m.id); if (body.going) going.push(m.id);
      r.set('attendees', going); app.save(r);
    } else if (body.dungeon !== undefined || body.startsAt !== undefined || body.note !== undefined) {
      if (viewer) throw new ForbiddenError('Viewers cannot plan runs.');
      if (r.getString('plannedBy') !== m.id && m.getString('role') !== 'owner') throw new ForbiddenError('Only its planner or the room owner can change this run.');
      // A run keeps its dungeon when the name only differs in case or spacing, even if the catalog changed since.
      if (body.dungeon !== undefined && validate.dungeon(body.dungeon).key !== validate.dungeon(r.getString('dungeon')).key) {
        const name = settings.dungeonName(app, body.dungeon); if (!name) throw new BadRequestError('Choose a dungeon from the list.'); r.set('dungeon', name.dungeon);
      }
      // A new start time is announced again on Discord.
      if (body.startsAt !== undefined) { const startsAt = validate.runStart(body.startsAt); if (Date.parse(startsAt) !== Date.parse(r.getString('startsAt').replace(' ', 'T'))) { r.set('startsAt', startsAt); r.set('remindedAt', ''); } }
      if (body.note !== undefined) r.set('note', validate.note(body.note));
      app.save(r);
    } else throw new BadRequestError('Send going (true or false), the changes to the run or remove: true.');
  } else {
    if (viewer) throw new ForbiddenError('Viewers cannot plan runs.');
    const name = settings.dungeonName(app, body.dungeon); if (!name) throw new BadRequestError('Choose a dungeon from the list.');
    const note = validate.note(body.note), startsAt = validate.runStart(body.startsAt);
    if (app.countRecords('room_runs', $dbx.hashExp({ room: roomId })) >= 20) throw new BadRequestError('A room can plan up to 20 runs at a time.');
    const r = new Record(app.findCollectionByNameOrId('room_runs'));
    r.set('room', roomId); r.set('dungeon', name.dungeon); r.set('startsAt', startsAt); r.set('note', note); r.set('plannedBy', m.id); r.set('attendees', [m.id]); app.save(r);
  }
  affected.push(roomId); return { runs: runsOf(app, roomId) };
}); }
// Room management by its owner: rename it, make a member a player (reporter) or a
// viewer, or hand the room over. Viewers cannot share, so a member made viewer stops
// sharing characters here. The previous owner stays as a player and can then leave.
function rename(e) { return mutate(e, (app, user, body, affected) => {
  const room = owner(app, user.id, String(body.roomId)); room.set('name', validate.text(body.name, 'Room name', 60)); app.save(room);
  affected.push(room.id); return { room: roomJson(room, odylePerCube(app)) };
}); }
function role(e) { return mutate(e, (app, user, body, affected) => {
  const room = owner(app, user.id, String(body.roomId)), target = otherMember(app, room, String(body.memberId), user.id, 'Cannot change this member.');
  if (!['reporter', 'viewer'].includes(body.role)) throw new BadRequestError('Choose player or viewer.');
  target.set('role', body.role); if (body.role === 'viewer') target.set('sharedCharacters', []); app.save(target);
  affected.push(room.id); return { membership: target };
}); }
function transfer(e) { return mutate(e, (app, user, body, affected) => {
  const room = owner(app, user.id, String(body.roomId)), target = otherMember(app, room, String(body.memberId), user.id, 'Cannot hand the room to this member.'), mine = membership(app, user.id, room.id);
  target.set('role', 'owner'); app.save(target); mine.set('role', 'reporter'); app.save(mine);
  room.set('owner', target.getString('user')); app.save(room);
  affected.push(room.id); return { room: roomJson(room, odylePerCube(app)) };
}); }
// Room settings: the owner connects a Discord channel webhook ({ roomId, webhook, language })
// or disconnects it (webhook ''). A test post proves the webhook before it is saved; it
// runs outside a transaction because it waits on Discord. No response carries the URL.
function discordWebhook(e) { return run(e, () => {
  const body = e.requestInfo().body, room = owner(e.app, e.auth.id, String(body.roomId)), url = discord.webhook(body.webhook), language = body.language === 'cs' ? 'cs' : 'en';
  if (url) discord.connect(url, room.getString('name'), language);
  room.set('discordWebhook', url); room.set('discordLanguage', language); e.app.save(room); notify(e.app, [room.id]);
  return e.json(200, { room: roomJson(room, odylePerCube(e.app)) });
}); }
// Cron, every minute: posts each run to its room's Discord channel 15 minutes before it
// starts, or at once when it was planned later than that. A run is announced once and
// again after a new start time; a webhook Discord no longer knows is dropped.
function remindRuns() {
  const at = new Date(), due = $app.findRecordsByFilter('room_runs', "remindedAt = '' && room.discordWebhook != '' && startsAt > {:now} && startsAt <= {:soon}", 'startsAt', 50, 0, { now: stamp(at), soon: stamp(new Date(at.getTime() + 15 * 60000)) });
  for (const r of due) {
    try {
      const room = $app.findRecordById('party_rooms', r.getString('room')), url = room.getString('discordWebhook'), ids = Array.from(r.getStringSlice('attendees'));
      const users = ids.length ? $app.findRecordsByIds('room_members', ids).map(m => m.getString('user')) : [];
      const going = users.length ? $app.findRecordsByIds('users', users).map(u => u.getString('displayName')) : [];
      const status = discord.post(url, discord.reminder({ roomName: room.getString('name'), dungeon: r.getString('dungeon'), startsAt: r.getString('startsAt'), note: r.getString('note'), going, language: room.getString('discordLanguage') }));
      if (status === 401 || status === 404) { room.set('discordWebhook', ''); $app.save(room); notify($app, [room.id]); console.log('Odyle dropped the Discord webhook of room ' + room.id + ': Discord answered ' + status); }
      else if (status >= 200 && status < 300) { r.set('remindedAt', now()); $app.save(r); }
      else console.log('Odyle reminder for run ' + r.id + ' failed: Discord answered ' + status);
    } catch (error) { console.log('Odyle reminder for run ' + r.id + ' failed: ' + error.message); }
  }
}
// The runs the account is going to in the next 24 hours across all its rooms, for
// reminders in the browser and the Windows app.
function upcoming(e) { return run(e, () => {
  const memberships = list(e.app, 'room_members', 'user = {:user}', { user: e.auth.id }), mine = {}, names = {};
  for (const m of memberships) mine[m.getString('room')] = m.id;
  const rooms = Object.keys(mine); if (!rooms.length) return e.json(200, { runs: [], serverNow: now() });
  for (const r of e.app.findRecordsByIds('party_rooms', rooms)) names[r.id] = r.getString('name');
  const runs = e.app.findAllRecords('room_runs', $dbx.in('room', ...rooms), $dbx.exp('startsAt > {:now} AND startsAt <= {:until}', { now: stamp(new Date()), until: stamp(new Date(Date.now() + 86400000)) }))
    .filter(r => Array.from(r.getStringSlice('attendees')).includes(mine[r.getString('room')]))
    .map(r => ({ id: r.id, roomId: r.getString('room'), room: names[r.getString('room')] || '', dungeon: r.getString('dungeon'), startsAt: r.getString('startsAt'), note: r.getString('note') }))
    .sort((a, b) => a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0);
  return e.json(200, { runs, serverNow: now() });
}); }
// An account that is deleted (by its owner, a superuser or for inactivity) hands each
// room it owns to its longest-standing player; a room without one closes. Runs as the
// users delete hook in main.pb.js, inside the deleting transaction.
function handOver(app, userId) {
  for (const room of app.findRecordsByFilter('party_rooms', 'owner = {:user}', '', 0, 0, { user: userId })) {
    const next = app.findRecordsByFilter('room_members', "room = {:room} && user != {:user} && role = 'reporter'", 'created', 1, 0, { room: room.id, user: userId })[0];
    if (!next) { app.delete(room); continue; }
    next.set('role', 'owner'); app.save(next); room.set('owner', next.getString('user')); app.save(room);
  }
}
// The account page: profile, caps and the Windows apps (reader sessions) in use.
function account(e) { return run(e, () => {
  const user = e.app.findRecordById('users', e.auth.id), reading = {};
  const sessions = e.app.findRecordsByFilter('publisher_sessions', 'user = {:user} && expiresAt > {:now}', '-updated', 20, 0, { user: user.id, now: stamp(new Date()) });
  for (const c of sessions.length ? e.app.findAllRecords('characters', $dbx.in('readingSession', ...sessions.map(s => s.id))) : []) reading[c.getString('readingSession')] = c.getString('characterName');
  const devices = e.app.findRecordsByFilter('desktop_devices', 'user = {:user}', '-lastUsedAt,-created', 0, 0, { user: user.id });
  return e.json(200, { account: { id: user.id, displayName: user.getString('displayName'), email: user.email(), created: user.getString('created'), lastActiveAt: user.getString('lastActiveAt') }, limits, serverNow: now(), characters: e.app.countRecords('characters', $dbx.hashExp({ user: user.id })),
    apps: sessions.map(s => ({ sessionId: s.id, connectedAt: s.getString('created'), lastContactAt: s.getString('updated'), character: reading[s.id] || '', device: s.getString('device') })),
    devices: devices.map(d => ({ id: d.id, name: d.getString('name'), pairedAt: d.getString('created'), lastSignInAt: d.getString('lastUsedAt') })) });
}); }
function profile(e) { return mutate(e, (app, user, body, affected) => {
  const record = app.findRecordById('users', user.id); record.set('displayName', validate.displayName(body.displayName)); app.save(record);
  affected.push(...roomsFor(app, user.id)); return { record };
}); }
// Everything stored for the account as one JSON document (Download my data).
function exportData(e) { return run(e, () => {
  const app = e.app, user = app.findRecordById('users', e.auth.id), all = (name, filter, params) => app.findRecordsByFilter(name, filter, 'created', 0, 0, params);
  const characters = all('characters', 'user = {:user}', { user: user.id }), memberships = all('room_members', 'user = {:user}', { user: user.id }), names = {};
  for (const r of memberships.length ? app.findRecordsByIds('party_rooms', memberships.map(m => m.getString('room'))) : []) names[r.id] = r.getString('name');
  const history = id => all('character_readings', 'character = {:id}', { id }).map(r => ({ value: r.getInt('value'), at: r.getString('created') }));
  return e.json(200, {
    exportedAt: now(),
    account: { id: user.id, displayName: user.getString('displayName'), email: user.email(), created: user.getString('created'), lastActiveAt: user.getString('lastActiveAt'),
      signIns: app.findAllExternalAuthsByRecord(user).map(a => ({ provider: a.getString('provider'), providerId: a.getString('providerId'), created: a.getString('created') })) },
    characters: characters.map(c => ({ ...c.publicExport(), history: history(c.id) })),
    rooms: memberships.map(m => ({ room: m.getString('room'), name: names[m.getString('room')] || '', role: m.getString('role'), joined: m.getString('created'), sharedCharacters: shared(m),
      wishlist: all('room_wishes', 'member = {:member}', { member: m.id }).map(w => w.getString('dungeon')),
      runs: all('room_runs', 'plannedBy = {:member} || attendees ~ {:member}', { member: m.id }).map(r => ({ dungeon: r.getString('dungeon'), startsAt: r.getString('startsAt'), note: r.getString('note'), planned: r.getString('plannedBy') === m.id })) })),
    tasks: tasksOf(app, user.id),
    readerSessions: all('publisher_sessions', 'user = {:user}', { user: user.id }).map(s => ({ id: s.id, connectedAt: s.getString('created'), lastContactAt: s.getString('updated'), expiresAt: s.getString('expiresAt') })),
    pairedWindowsApps: all('desktop_devices', 'user = {:user}', { user: user.id }).map(d => ({ name: d.getString('name'), pairedAt: d.getString('created'), lastSignInAt: d.getString('lastUsedAt') })),
  });
}); }
// Ends every sign-in of the account: other browsers and paired Windows apps lose their
// tokens, device keys, reader sessions and pairing codes. The asking browser gets a new token.
function signOutEverywhere(e) { return mutate(e, (app, user, body, affected) => {
  const record = app.findRecordById('users', user.id); record.refreshTokenKey(); app.save(record);
  for (const s of list(app, 'publisher_sessions', 'user = {:user}', { user: user.id })) endSession(app, s);
  for (const name of ['desktop_codes', 'desktop_devices']) for (const item of list(app, name, 'user = {:user}', { user: user.id })) app.delete(item);
  affected.push(...roomsFor(app, user.id)); return { token: record.newAuthToken(), record };
}); }
// Deletes the account with its characters, history, memberships, wishes and tasks;
// owned rooms pass on first (handOver). Body { confirm: true } guards against slips.
function deleteAccount(e) { return mutate(e, (app, user, body, affected) => {
  if (body.confirm !== true) throw new BadRequestError('Confirm that the account should be deleted.');
  affected.push(...roomsFor(app, user.id)); app.delete(app.findRecordById('users', user.id));
}); }
// Deletes one character with its history and portrait; rooms stop listing it. A reader
// that sees it in game again saves it as a new character.
function deleteCharacter(e) { return mutate(e, (app, user, body, affected) => {
  const c = ownCharacter(app, user.id, String(body.characterId)); affected.push(...roomsFor(app, user.id)); app.delete(c);
}); }
// A character's Odyle over the last 30 days, oldest first. Its owner and members of
// rooms it is shared in may read it, like its current value.
function history(e) { return run(e, () => {
  const id = e.request.pathValue('id'); let c; try { c = e.app.findRecordById('characters', id); } catch { throw new NotFoundError('This character no longer exists.'); }
  if (c.getString('user') !== e.auth.id) {
    const rooms = list(e.app, 'room_members', 'user = {:owner} && sharedCharacters ~ {:id}', { owner: c.getString('user'), id }).map(m => m.getString('room'));
    if (!rooms.some(room => list(e.app, 'room_members', 'room = {:room} && user = {:user}', { room, user: e.auth.id }).length)) throw new ForbiddenError('This character is not shared with you.');
  }
  const readings = Array.from(e.app.findRecordsByFilter('character_readings', 'character = {:id} && created >= {:since}', '-created', 500, 0, { id, since: stamp(new Date(Date.now() - 30 * 86400000)) })).reverse();
  return e.json(200, { character: { id: c.id, characterName: c.getString('characterName'), value: c.getInt('value'), confirmed: c.getBool('confirmed') }, readings: readings.map(r => ({ value: r.getInt('value'), at: r.getString('created') })), serverNow: now() });
}); }
// Cron: deletes accounts unused for odyle_settings.inactiveAccountDays days (0 keeps
// them), up to 200 a night. handOver passes their rooms on first.
function retention() {
  const days = settings.read($app).inactiveAccountDays; if (!days) return;
  const cutoff = stamp(new Date(Date.now() - days * 86400000));
  for (const user of $app.findRecordsByFilter('users', "lastActiveAt < {:cutoff} && (lastActiveAt != '' || created < {:cutoff})", 'lastActiveAt', 200, 0, { cutoff })) {
    try { const rooms = roomsFor($app, user.id); $app.delete(user); notify($app, rooms); console.log('Odyle deleted inactive account ' + user.id); } catch (error) { console.log('Odyle could not delete inactive account ' + user.id + ': ' + error.message); }
  }
}
module.exports = { create, join, rooms, snapshot, wishlist, tasks, task, character, report, heartbeat, sharing, refreshPortraits, session, invalidate, leave, close, invites, revoke, rename, role, transfer, plan, account, profile, exportData, signOutEverywhere, deleteAccount, deleteCharacter, history, handOver, retention, cleanup, membership, desktopCode, pair, desktopDevice, desktopSignIn, unpair, forgetDevice, discordWebhook, remindRuns, upcoming, configureDiscord };
