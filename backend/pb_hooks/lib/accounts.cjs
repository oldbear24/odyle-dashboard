const validate = require(__hooks + '/lib/validation.cjs');
const now = () => new Date().toISOString();
const expiry = seconds => new Date(Date.now() + seconds * 1000).toISOString();
const list = (app, name, filter, params) => app.findRecordsByFilter(name, filter, 'id', 500, 0, params || {});
function membership(app, userId, roomId) {
  const found = list(app, 'room_members', 'room = {:room} && user = {:user}', { room: roomId, user: userId });
  if (!found.length) throw new ForbiddenError('You are not a member of this room.');
  return found[0];
}
function owner(app, userId, roomId) {
  const room = app.findRecordById('party_rooms', roomId);
  if (room.getString('owner') !== userId) throw new ForbiddenError('Only the room owner can do this.'); return room;
}
function ownCharacter(app, userId, id) {
  const character = app.findRecordById('characters', id);
  if (character.getString('user') !== userId) throw new ForbiddenError('This character belongs to another account.'); return character;
}
function ownSession(app, userId, id) {
  const session = app.findRecordById('publisher_sessions', id);
  if (session.getString('user') !== userId || Date.parse(session.getString('expiresAt')) <= Date.now()) throw new ForbiddenError('Publisher session expired. Reconnect.'); return session;
}
function notify(app, roomIds) {
  for (const id of [...new Set(roomIds)]) {
    const topic = 'odyle.room.' + id, clients = app.subscriptionsBroker().clients();
    for (const key in clients) if (clients[key].hasSubscription(topic)) clients[key].send(new SubscriptionMessage({ name: topic, data: JSON.stringify({ refresh: true }) }));
  }
}
const shared = m => Array.from(m.getStringSlice('sharedCharacters'));
const roomsFor = (app, userId) => list(app, 'room_members', 'user = {:user}', { user: userId }).map(m => m.getString('room'));
function run(e, action) {
  try { return action(); } catch (error) {
    if (error instanceof BadRequestError || error instanceof ForbiddenError || error instanceof NotFoundError) throw error;
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
  const room = new Record(app.findCollectionByNameOrId('party_rooms'));
  room.set('name', validate.text(body.name, 'Room name', 60)); room.set('owner', user.id); room.set('cost', validate.integer(body.cost ?? 40, 'Cube cost', 1, 1000)); app.save(room);
  return { room, membership: addMember(app, room.id, user.id, 'owner'), invites: [invite(app, room, 'reporter'), invite(app, room, 'viewer')] };
}); }
function join(e) { return mutate(e, (app, user, body, affected) => {
  const code = validate.text(body.code, 'Invite code', 20).replace(/[\s-]/g, '').toUpperCase(); let invitation;
  try { invitation = app.findFirstRecordByData('room_invites', 'digest', $security.sha256(code)); } catch { throw new BadRequestError('Invite is invalid or expired.'); }
  if (Date.parse(invitation.getString('expiresAt')) <= Date.now()) throw new BadRequestError('Invite is invalid or expired.');
  const room = app.findRecordById('party_rooms', invitation.getString('room'));
  const existing = list(app, 'room_members', 'room = {:room} && user = {:user}', { room: room.id, user: user.id });
  if (existing.length) return { room, membership: existing[0] };
  if (app.countRecords('room_members', $dbx.hashExp({ room: room.id })) >= 50) throw new BadRequestError('Room is full.');
  const member = addMember(app, room.id, user.id, invitation.getString('role')); affected.push(room.id); return { room, membership: member };
}); }
function rooms(e) { return run(e, () => e.json(200, { rooms: list(e.app, 'room_members', 'user = {:user}', { user: e.auth.id }).map(m => ({ ...e.app.findRecordById('party_rooms', m.getString('room')).publicExport(), role: m.getString('role'), sharedCharacters: shared(m), sharing: shared(m).length > 0 })) })); }
function snapshot(e) { return run(e, () => {
  const id = e.request.pathValue('id'); membership(e.app, e.auth.id, id);
  // Others see only the characters a member linked to this room; members always
  // see all of their own, each flagged with whether it is shared here.
  return e.json(200, { room: e.app.findRecordById('party_rooms', id), serverNow: now(), members: list(e.app, 'room_members', 'room = {:room}', { room: id }).map(m => {
    const linked = shared(m), mine = m.getString('user') === e.auth.id;
    return { ...m.publicExport(), sharing: linked.length > 0, displayName: e.app.findRecordById('users', m.getString('user')).getString('displayName'),
      characters: list(e.app, 'characters', 'user = {:user}', { user: m.getString('user') }).filter(c => mine || linked.includes(c.id)).map(c => ({ ...c.publicExport(), shared: linked.includes(c.id) })) };
  }) });
}); }
function session(e) { return mutate(e, (app, user, body, affected) => {
  if (body.previousSessionId) {
    const old = ownSession(app, user.id, String(body.previousSessionId));
    for (const c of list(app, 'characters', 'readingSession = {:id}', { id: old.id })) { c.set('valid', false); app.save(c); }
    app.delete(old); affected.push(...roomsFor(app, user.id));
  }
  const record = new Record(app.findCollectionByNameOrId('publisher_sessions'));
  record.set('user', user.id); record.set('expiresAt', expiry(86400)); app.save(record); return { sessionId: record.id, sequence: 0 };
}); }
function character(e) { return mutate(e, (app, user, body, affected) => {
  // Identity can be saved before the first game reading. This endpoint cannot
  // supply energy, confidence, ownership, timestamps or a publisher session.
  for (const key of Object.keys(body)) if (!['characterName', 'server', 'region'].includes(key)) throw new BadRequestError('Only character name, server and region may be saved here.');
  const data = validate.characterIdentity(body);
  const existing = list(app, 'characters', 'user = {:user} && region = {:region} && server = {:server} && characterName = {:name}', { user: user.id, region: data.region, server: data.server, name: data.characterName });
  if (existing.length) return { character: existing[0] };
  const record = new Record(app.findCollectionByNameOrId('characters')); record.set('user', user.id);
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
    character = existing[0] || new Record(app.findCollectionByNameOrId('characters')); character.set('user', user.id);
  }
  for (const key of ['value', 'characterName', 'server', 'region']) character.set(key, data[key]);
  character.set('confirmed', true); character.set('valid', true); character.set('source', data.source); character.set('parserVersion', data.parserVersion); character.set('lastReadingAt', now()); character.set('lastSeenAt', now()); character.set('readingSession', session.id); app.save(character);
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
function heartbeat(e) { return mutate(e, (app, user, body, affected) => {
  if (body.sessionId) {
    const session = ownSession(app, user.id, String(body.sessionId)); session.set('expiresAt', expiry(86400)); app.save(session);
    if (body.characterId) { const c = ownCharacter(app, user.id, String(body.characterId)); if (c.getString('readingSession') === session.id) { c.set('lastSeenAt', now()); app.save(c); affected.push(...roomsFor(app, user.id)); } }
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
function settings(e) { return mutate(e, (app, user, body, affected) => {
  const room = owner(app, user.id, String(body.roomId)); room.set('cost', validate.integer(body.cost, 'Cube cost', 1, 1000)); app.save(room); affected.push(room.id); return { room };
}); }
function invites(e) { return mutate(e, (app, user, body) => {
  const room = owner(app, user.id, String(body.roomId)); for (const old of list(app, 'room_invites', 'room = {:room}', { room: room.id })) app.delete(old);
  return { invites: [invite(app, room, 'reporter'), invite(app, room, 'viewer')] };
}); }
function revoke(e) { return mutate(e, (app, user, body, affected) => {
  const room = owner(app, user.id, String(body.roomId)), target = app.findRecordById('room_members', String(body.memberId));
  if (target.getString('room') !== room.id || target.getString('user') === user.id) throw new ForbiddenError('Cannot remove this member.');
  app.delete(target); affected.push(room.id);
}); }
function desktopCode(e) { return mutate(e, (app, user) => {
  for (const old of list(app, 'desktop_codes', 'user = {:user}', { user: user.id })) app.delete(old);
  const code = $security.randomStringWithAlphabet(16, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'), record = new Record(app.findCollectionByNameOrId('desktop_codes'));
  record.set('user', user.id); record.set('digest', $security.sha256(code)); record.set('expiresAt', expiry(300)); app.save(record);
  return { code, expiresAt: record.getString('expiresAt') };
}); }
function pair(e) { return run(e, () => {
  const code = validate.text(e.requestInfo().body.code, 'Pairing code', 24).replace(/[\s-]/g, '').toUpperCase(); let result;
  e.app.runInTransaction(app => {
    let record; try { record = app.findFirstRecordByData('desktop_codes', 'digest', $security.sha256(code)); } catch { throw new BadRequestError('Pairing code is invalid or expired.'); }
    if (Date.parse(record.getString('expiresAt')) <= Date.now()) throw new BadRequestError('Pairing code is invalid or expired.');
    const user = app.findRecordById('users', record.getString('user')); app.delete(record); result = { token: user.newAuthToken(), record: user };
  }); return e.json(200, result);
}); }
function cleanup() {
  for (const name of ['room_invites', 'desktop_codes']) for (const item of list($app, name, 'expiresAt <= {:now}', { now: now() })) $app.delete(item);
  for (const item of list($app, 'publisher_sessions', 'expiresAt <= {:now}', { now: now() })) {
    for (const c of list($app, 'characters', 'readingSession = {:id}', { id: item.id })) { c.set('valid', false); $app.save(c); } $app.delete(item);
  }
}
function configureDiscord(app) {
  const clientId = $os.getenv('DISCORD_CLIENT_ID'), clientSecret = $os.getenv('DISCORD_CLIENT_SECRET');
  if (clientId && clientSecret) { const users = app.findCollectionByNameOrId('users'); users.oauth2 = { enabled: true, providers: [{ name: 'discord', clientId, clientSecret }] }; app.save(users); }
}
module.exports = { create, join, rooms, snapshot, character, report, heartbeat, sharing, session, invalidate, leave, close, settings, invites, revoke, cleanup, membership, desktopCode, pair, configureDiscord };
