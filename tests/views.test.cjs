const { test } = require('node:test');
const assert = require('node:assert/strict');
const memory = () => { const data = {}; return { getItem: key => data[key] ?? null, setItem: (key, value) => { data[key] = String(value); } }; };
test('invite links carry the code in the fragment and the owner\'s browser remembers live codes', async () => {
  const { inviteLink, joinCode, savedInvites, rememberInvites, forgetInvites } = await import('../src/invites.js');
  assert.equal(inviteLink('https://odyle.example/app/?x=1#/room/abc', 'ABCDEFGH2345'), 'https://odyle.example/app/#/join/ABCDEFGH2345');
  assert.equal(joinCode('/join/abcd-efgh-2345'), 'ABCDEFGH2345'); assert.equal(joinCode('/room/abc'), ''); assert.equal(joinCode('/join/<x>'), '');
  const storage = memory(), now = Date.parse('2026-10-14T12:00:00Z');
  rememberInvites(storage, 'room1', [{ code: 'AAAA', role: 'reporter', expiresAt: '2026-10-14T12:30:00Z', extra: 'dropped' }, { code: 'BBBB', role: 'viewer', expiresAt: '2026-10-14T11:59:00Z' }], now);
  assert.deepEqual(savedInvites(storage, 'room1', now), [{ code: 'AAAA', role: 'reporter', expiresAt: '2026-10-14T12:30:00Z' }]);
  assert.deepEqual(savedInvites(storage, 'room1', now + 3600000), []); assert.deepEqual(savedInvites(storage, 'other', now), []);
  forgetInvites(storage, 'room1', now); assert.deepEqual(savedInvites(storage, 'room1', now), []);
  // Broken or blocked storage never breaks the dialog.
  assert.deepEqual(savedInvites({ getItem: () => '{not json' }, 'room1', now), []);
  rememberInvites({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, 'room1', [], now);
});
test('planned runs count down in local time and history charts round their axis', async () => {
  const { startsIn, nextHour, runsSection } = await import('../src/runs.js'), { niceMax, historyChart, historyList } = await import('../src/history.js');
  const now = Date.parse('2026-10-14T12:00:00Z');
  assert.deepEqual([now + 125 * 60000, now + 26 * 3600000, now + 20000, now - 20 * 60000].map(at => startsIn(at, now)), ['in 2h 5m', 'in 1d 2h', 'starting now', 'started 20m ago']);
  assert.match(nextHour(now), /^\d{4}-\d{2}-\d{2}T\d{2}:00$/);
  assert.deepEqual([0, 7, 44, 291, 1200].map(niceMax), [10, 8, 50, 300, 1500]);
  const html = runsSection({ runs: [{ id: 'r1', dungeon: '<b>Fire</b>', startsAt: '2026-10-14 13:00:00.000Z', note: '', planner: 'u1', attendees: ['u1', 'u2'] }], members: [{ user: 'u2', displayName: 'Lumina' }], myId: 'u1', viewer: false, owner: false, live: new Set(['u2']), now, suggestions: ['Fire Temple'], demo: false });
  assert.match(html, /&lt;b&gt;Fire&lt;\/b&gt;/); assert.match(html, /data-going="false"/); assert.match(html, /data-cancel-run="r1"/); assert.match(html, /wish-person live/);
  const viewer = runsSection({ runs: [], members: [], myId: 'u3', viewer: true, owner: false, live: new Set(), now, suggestions: [], demo: false });
  assert.doesNotMatch(viewer, /run-form/);
  const readings = [{ value: 20, at: '2026-10-13 10:00:00.000Z' }, { value: 55, at: '2026-10-13 18:00:00.000Z' }, { value: 30, at: '2026-10-14 09:00:00.000Z' }];
  const chart = historyChart(readings, { now, cost: 40 });
  assert.match(chart, /class="history-line" d="M[\d.]+,[\d.]+H[\d.]+V[\d.]+H[\d.]+V[\d.]+H[\d.]+"/); assert.match(chart, /1 cube · 40/);
  assert.match(historyChart([], { now, cost: 40 }), /No changes/);
  assert.deepEqual([...historyList(readings).matchAll(/<td>([^<]*)<\/td><td>([^<]*)<\/td><\/tr>/g)].map(m => [m[1], m[2]]), [['30', '−25'], ['55', '+35'], ['20', '—']]);
});
