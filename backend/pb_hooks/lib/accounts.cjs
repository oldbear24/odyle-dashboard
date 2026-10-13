const validate = require(__hooks + '/lib/validation.cjs');
const portraits = require(__hooks + '/lib/portraits.cjs');
const now = () => new Date().toISOString();
const expiry = seconds => new Date(Date.now() + seconds * 1000).toISOString();
// Date fields are stored as '2026-10-13 21:40:00.000Z' and filters compare them as
// strings, so filter params must use the same space-separated form, not ISO 'T'.
const stamp = date => date.toISOString().replace('T', ' ');
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
// Odyle per cube is one server-wide value (odyle_settings, edited by superusers).
// Rooms keep their legacy cost field, but every response reports the setting.
function odylePerCube(app) { try { return app.findFirstRecordByFilter('odyle_settings', 'id != ""').getInt('odylePerCube') || 40; } catch { return 40; } }
const roomJson = (room, cost) => ({ ...room.publicExport(), cost });
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
  const cost = odylePerCube(app); room.set('name', validate.text(body.name, 'Room name', 60)); room.set('owner', user.id); room.set('cost', cost); app.save(room);
  return { room: roomJson(room, cost), membership: addMember(app, room.id, user.id, 'owner'), invites: [invite(app, room, 'reporter'), invite(app, room, 'viewer')] };
}); }
function join(e) { return mutate(e, (app, user, body, affected) => {
  const code = validate.text(body.code, 'Invite code', 20).replace(/[\s-]/g, '').toUpperCase(); let invitation;
  try { invitation = app.findFirstRecordByData('room_invites', 'digest', $security.sha256(code)); } catch { throw new BadRequestError('Invite is invalid or expired.'); }
  if (Date.parse(invitation.getString('expiresAt')) <= Date.now()) throw new BadRequestError('Invite is invalid or expired.');
  const room = app.findRecordById('party_rooms', invitation.getString('room')), cost = odylePerCube(app);
  const existing = list(app, 'room_members', 'room = {:room} && user = {:user}', { room: room.id, user: user.id });
  if (existing.length) return { room: roomJson(room, cost), membership: existing[0] };
  if (app.countRecords('room_members', $dbx.hashExp({ room: room.id })) >= 50) throw new BadRequestError('Room is full.');
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
  const id = e.request.pathValue('id'); membership(e.app, e.auth.id, id);
  // Three queries for the whole room: members, their accounts and all their
  // characters, instead of two lookups per member.
  const room = e.app.findRecordById('party_rooms', id), members = list(e.app, 'room_members', 'room = {:room}', { room: id });
  const userIds = members.map(m => m.getString('user')), names = {}, characters = {};
  for (const u of userIds.length ? e.app.findRecordsByIds('users', userIds) : []) names[u.id] = u.getString('displayName');
  for (const c of userIds.length ? e.app.findAllRecords('characters', $dbx.in('user', ...userIds)) : []) (characters[c.getString('user')] ||= []).push(c);
  for (const owned of Object.values(characters)) owned.sort((a, b) => (a.getString('created') < b.getString('created') ? -1 : a.getString('created') > b.getString('created') ? 1 : 0));
  // Others see only the characters a member linked to this room; members always
  // see all of their own, each flagged with whether it is shared here.
  return e.json(200, { room: roomJson(room, odylePerCube(e.app)), serverNow: now(), members: members.map(m => {
    const linked = shared(m), mine = m.getString('user') === e.auth.id;
    return { ...m.publicExport(), sharing: linked.length > 0, displayName: names[m.getString('user')] || '',
      characters: (characters[m.getString('user')] || []).filter(c => mine || linked.includes(c.id)).map(c => ({ ...c.publicExport(), shared: linked.includes(c.id) })) };
  }), wishlist: wishlistOf(e.app, id, members) });
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
    const record = new Record(app.findCollectionByNameOrId('room_wishes'));
    // Joining an entry keeps its first spelling, whatever case this member typed.
    record.set('room', roomId); record.set('member', m.id); record.set('dungeon', entry.length ? entry[0].getString('dungeon') : wish.dungeon); record.set('key', wish.key); app.save(record);
  }
  affected.push(roomId); return { wishlist: wishlistOf(app, roomId) };
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
  // An existing character keeps the identity the game gave it; only a lookup without
  // characterId may name a new one. lastReadingAt marks the last change, so a value
  // re-sent unchanged (the reader resumed after a pause) keeps its timestamp.
  if (!body.characterId) for (const key of ['characterName', 'server', 'region']) character.set(key, data[key]);
  if (!character.getBool('confirmed') || character.getInt('value') !== data.value) character.set('lastReadingAt', now());
  character.set('value', data.value);
  character.set('confirmed', true); character.set('valid', true); character.set('source', data.source); character.set('parserVersion', data.parserVersion); character.set('lastSeenAt', now()); character.set('readingSession', session.id); app.save(character);
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
  const at = stamp(new Date());
  for (const name of ['room_invites', 'desktop_codes']) for (const item of list($app, name, 'expiresAt <= {:now}', { now: at })) $app.delete(item);
  for (const item of list($app, 'publisher_sessions', 'expiresAt <= {:now}', { now: at })) {
    for (const c of list($app, 'characters', 'readingSession = {:id}', { id: item.id })) { c.set('valid', false); $app.save(c); } $app.delete(item);
  }
}
function configureDiscord(app) {
  const clientId = $os.getenv('DISCORD_CLIENT_ID'), clientSecret = $os.getenv('DISCORD_CLIENT_SECRET');
  if (clientId && clientSecret) { const users = app.findCollectionByNameOrId('users'); users.oauth2 = { enabled: true, providers: [{ name: 'discord', clientId, clientSecret }] }; app.save(users); }
}
module.exports = { create, join, rooms, snapshot, wishlist, character, report, heartbeat, sharing, refreshPortraits, session, invalidate, leave, close, invites, revoke, cleanup, membership, desktopCode, pair, configureDiscord };
