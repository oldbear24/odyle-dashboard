const validate = require(__hooks + '/lib/validation.cjs');
function now() { return new Date().toISOString(); }
function expiry(seconds) { return new Date(Date.now() + seconds * 1000).toISOString(); }
function touch(app, room) { room.set('expiresAt', expiry(86400)); app.save(room); }
function roomFor(app, auth) {
  const room = app.findRecordById('rooms', auth.getString('room'));
  if (Date.parse(room.getString('expiresAt')) <= Date.now()) throw new ForbiddenError('This room has expired.');
  return room;
}
function member(app, room, role, name) {
  const record = new Record(app.findCollectionByNameOrId('members'));
  record.set('email', $security.randomString(24) + '@odyle.invalid');
  record.setPassword($security.randomString(48));
  record.set('room', room.id); record.set('role', role); record.set('displayName', name);
  record.set('sessionId', $security.randomString(32)); record.set('lastSeenAt', now());
  app.save(record); return record;
}
function invite(app, room, role) {
  const code = $security.randomStringWithAlphabet(12, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
  const record = new Record(app.findCollectionByNameOrId('invites'));
  record.set('room', room.id); record.set('role', role); record.set('digest', $security.sha256(code)); record.set('expiresAt', expiry(1800));
  app.save(record); return { code, role, expiresAt: record.getString('expiresAt') };
}
function run(e, action) {
  try { return action(); } catch (error) {
    if (error instanceof BadRequestError || error instanceof ForbiddenError || error instanceof NotFoundError) throw error;
    throw new BadRequestError(error.message || 'Request could not be completed.');
  }
}
function create(e) { return run(e, () => {
  const body = e.requestInfo().body;
  const name = validate.text(body.name, 'Room name', 60), displayName = validate.text(body.displayName, 'Your name', 40);
  let result;
  e.app.runInTransaction((app) => {
    const room = new Record(app.findCollectionByNameOrId('rooms'));
    room.set('name', name); room.set('cost', validate.integer(body.cost || 40, 'Cube cost', 1, 1000)); room.set('expiresAt', expiry(86400)); app.save(room);
    const owner = member(app, room, 'owner', displayName);
    result = { token: owner.newAuthToken(), record: owner, room, sessionId: owner.getString('sessionId'), invites: [invite(app, room, 'reporter'), invite(app, room, 'viewer')] };
  });
  return e.json(200, result);
}); }
function join(e) { return run(e, () => {
  const body = e.requestInfo().body;
  const code = validate.text(body.code, 'Invite code', 20).replace(/[\s-]/g, '').toUpperCase();
  const displayName = validate.text(body.displayName, 'Your name', 40);
  let result;
  e.app.runInTransaction((app) => {
    let invitation;
    try { invitation = app.findFirstRecordByData('invites', 'digest', $security.sha256(code)); }
    catch { throw new BadRequestError('Invite is invalid or expired. Ask the leader for a new code.'); }
    if (Date.parse(invitation.getString('expiresAt')) <= Date.now()) throw new BadRequestError('Invite is invalid or expired.');
    const room = roomFor(app, invitation);
    const count = app.countRecords('members', $dbx.hashExp({ room: room.id }));
    if (count >= 50) throw new BadRequestError('This room is full.');
    const actor = member(app, room, invitation.getString('role'), displayName);
    touch(app, room);
    result = { token: actor.newAuthToken(), record: actor, room, sessionId: actor.getString('sessionId') };
  });
  return e.json(200, result);
}); }
function mutate(e, action) { return run(e, () => {
  let result;
  e.app.runInTransaction((app) => {
    const actor = app.findRecordById('members', e.auth.id), room = roomFor(app, actor);
    result = action(app, actor, room, e.requestInfo().body);
  });
  return e.json(200, result || { success: true });
}); }
function publisher(actor) { if (actor.getString('role') === 'viewer') throw new ForbiddenError('Viewers cannot publish.'); }
function owner(actor) { if (actor.getString('role') !== 'owner') throw new ForbiddenError('Only the leader can do this.'); }
function report(e) { return mutate(e, (app, actor, room, body) => {
  publisher(actor);
  if (!actor.getBool('sharing')) throw new ForbiddenError('Enable sharing first.');
  const data = validate.reading(body, { sessionId: actor.getString('sessionId'), sequence: actor.getInt('sequence') });
  for (const key of Object.keys(data)) actor.set(key, data[key]);
  actor.set('confirmed', true); actor.set('source', 'manual'); actor.set('lastSeenAt', now()); actor.set('lastReadingAt', now());
  app.save(actor); touch(app, room); return { member: actor, serverNow: now() };
}); }
function session(e) { return mutate(e, (app, actor) => {
  publisher(actor); actor.set('sessionId', $security.randomString(32)); actor.set('sequence', 0); actor.set('confirmed', false); actor.set('lastReadingAt', ''); actor.set('value', 0); app.save(actor);
  return { sessionId: actor.getString('sessionId'), sequence: 0 };
}); }
function sharing(e) { return mutate(e, (app, actor, room, body) => {
  publisher(actor);
  if (typeof body.enabled !== 'boolean') throw new BadRequestError('Sharing must be true or false.');
  actor.set('sharing', body.enabled); actor.set('confirmed', false); actor.set('value', 0); actor.set('lastReadingAt', ''); actor.set('lastSeenAt', now()); app.save(actor); touch(app, room);
}); }
function heartbeat(e) { return mutate(e, (app, actor, room) => {
  actor.set('lastSeenAt', now()); app.save(actor); touch(app, room); return { serverNow: now() };
}); }
function invalidate(e) { return mutate(e, (app, actor) => {
  publisher(actor); actor.set('confirmed', false); actor.set('value', 0); actor.set('lastReadingAt', ''); app.save(actor);
}); }
function leave(e) { return mutate(e, (app, actor, room) => {
  if (actor.getString('role') === 'owner') app.delete(room); else app.delete(actor);
}); }
function settings(e) { return mutate(e, (app, actor, room, body) => {
  owner(actor); room.set('cost', validate.integer(body.cost, 'Cube cost', 1, 1000)); app.save(room); return { room };
}); }
function invites(e) { return mutate(e, (app, actor, room) => {
  owner(actor);
  const old = app.findRecordsByFilter('invites', 'room = {:room}', '', 100, 0, { room: room.id });
  for (const item of old) app.delete(item);
  return { invites: [invite(app, room, 'reporter'), invite(app, room, 'viewer')] };
}); }
function revoke(e) { return mutate(e, (app, actor, room, body) => {
  owner(actor); const target = app.findRecordById('members', String(body.memberId));
  if (target.getString('room') !== room.id || target.id === actor.id) throw new ForbiddenError('Cannot remove this member.');
  app.delete(target);
}); }
function cleanup() {
  const expired = $app.findRecordsByFilter('rooms', 'expiresAt <= {:now}', '', 500, 0, { now: now() });
  for (const room of expired) $app.delete(room);
  const codes = $app.findRecordsByFilter('invites', 'expiresAt <= {:now}', '', 500, 0, { now: now() });
  for (const code of codes) $app.delete(code);
}
module.exports = { create, join, report, heartbeat, sharing, session, invalidate, leave, settings, invites, revoke, cleanup };
