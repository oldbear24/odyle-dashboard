const { test } = require('node:test');
const assert = require('node:assert/strict');
// Realtime news the dashboard applies without fetching again (src/live.js).
const live = () => import('../src/live.js');
test('changed characters merge into the room and the account; a new one asks for a fetch', async () => {
  const { applyRoomCharacters, applyCharacters } = await live();
  const members = [{ user: 'a', characters: [{ id: 'c1', user: 'a', value: 10, shared: true, characterName: 'Main' }] }, { user: 'b', characters: [] }];
  assert.equal(applyRoomCharacters(members, [{ id: 'c1', user: 'a', value: 25, shared: true }]), true);
  assert.deepEqual(members[0].characters[0], { id: 'c1', user: 'a', value: 25, shared: true, characterName: 'Main' });
  assert.equal(applyRoomCharacters(members, [{ id: 'c2', user: 'b', value: 5 }]), false);
  assert.equal(applyRoomCharacters(members, [{ id: 'c3', user: 'z', value: 5 }]), false);
  const mine = [{ id: 'c1', value: 10, valid: true }];
  assert.equal(applyCharacters(mine, [{ id: 'c1', value: 11, valid: false }]), true);
  assert.deepEqual(mine, [{ id: 'c1', value: 11, valid: false }]);
  assert.equal(applyCharacters(mine, [{ id: 'new', value: 1 }]), false);
});
test('heartbeats move lastSeenAt and contact forward, never back', async () => {
  const { applySeen, applyContact } = await live();
  const a = [{ id: 'c1', lastSeenAt: '2026-10-15 12:00:00.000Z' }, { id: 'c2', lastSeenAt: '' }], b = [{ id: 'c1', lastSeenAt: '2026-10-15 12:00:30.000Z' }];
  applySeen({ c1: '2026-10-15T12:00:20.000Z', c2: '2026-10-15T12:00:20.000Z', other: '2026-10-15T12:00:20.000Z' }, a, b, undefined);
  assert.deepEqual(a.map(c => c.lastSeenAt), ['2026-10-15T12:00:20.000Z', '2026-10-15T12:00:20.000Z']);
  assert.equal(b[0].lastSeenAt, '2026-10-15 12:00:30.000Z');
  const apps = [{ sessionId: 's1', lastContactAt: '2026-10-15 12:00:00.000Z' }, { sessionId: 's2', lastContactAt: '2026-10-15 12:01:00.000Z' }];
  applyContact({ s1: '2026-10-15T12:00:40.000Z', s2: '2026-10-15T12:00:40.000Z' }, apps);
  assert.deepEqual(apps.map(a => a.lastContactAt), ['2026-10-15T12:00:40.000Z', '2026-10-15 12:01:00.000Z']);
});
