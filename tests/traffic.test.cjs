const { test } = require('node:test');
const assert = require('node:assert/strict');
const traffic = require('../backend/pb_hooks/lib/traffic.cjs');
// PocketBase's in-memory app store, as far as the traffic counter uses it.
function memory() {
  const map = new Map();
  return { map, app: { store: () => ({ setFunc: (key, change) => { const value = change(map.get(key)); map.set(key, value); return value; }, get: key => map.get(key), remove: key => map.delete(key) }) } };
}

test('the last hour of traffic is counted per minute, route and reason, and older minutes leave', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 15, 8, 0, 30) });
  const { app, map } = memory(), outdated = new Error('Outdated reading.');
  traffic.record(app, 'report', 'app', 3, null);
  traffic.record(app, 'report', 'app', 40, outdated);
  traffic.record(app, 'heartbeat', 'app', 0, null);
  traffic.record(app, 'GET rooms', 'read', 7, null);
  t.mock.timers.tick(60000);
  traffic.record(app, 'task', 'web', 1, null);
  traffic.record(app, 'report', 'app', 6000, outdated);
  let summary = traffic.summary(app);
  assert.equal(summary.minutes.length, 60);
  // Accepted requests by source; rejected ones from any source.
  assert.deepEqual(summary.minutes.slice(-2), [{ at: '2026-10-15T08:00:00.000Z', app: 2, web: 0, read: 1, rejected: 1 }, { at: '2026-10-15T08:01:00.000Z', app: 0, web: 1, read: 0, rejected: 1 }]);
  assert.ok(summary.minutes.slice(0, -2).every(m => m.app + m.web + m.read + m.rejected === 0));
  // Median and 95 % are the upper bounds of their time step, the slowest time beyond the last.
  assert.deepEqual(summary.total, { count: 6, rejected: 2, averageMs: 1008.5, medianMs: 5, p95Ms: 6000, maxMs: 6000 });
  assert.deepEqual(summary.routes.map(r => [r.kind, r.source, r.count, r.rejected]), [['report', 'app', 3, 2], ['GET rooms', 'read', 1, 0], ['heartbeat', 'app', 1, 0], ['task', 'web', 1, 0]]);
  assert.deepEqual(summary.routes[0], { kind: 'report', source: 'app', count: 3, rejected: 2, averageMs: 2014.3, medianMs: 50, p95Ms: 6000, maxMs: 6000 });
  assert.deepEqual(summary.routes[1], { kind: 'GET rooms', source: 'read', count: 1, rejected: 0, averageMs: 7, medianMs: 7, p95Ms: 7, maxMs: 7 });
  assert.deepEqual(summary.errors, [{ kind: 'report', message: 'Outdated reading.', count: 2, lastAt: '2026-10-15T08:01:30.000Z' }]);
  // An hour later the first minute has left the summary and the next request removes it.
  t.mock.timers.tick(59 * 60000);
  summary = traffic.summary(app);
  assert.equal(summary.minutes[0].at, '2026-10-15T08:01:00.000Z');
  assert.deepEqual(summary.routes.map(r => [r.kind, r.count]), [['report', 1], ['task', 1]]);
  traffic.record(app, 'heartbeat', 'app', 0, null);
  const minutes = () => [...map.keys()].filter(key => key.startsWith('odyle.traffic.'));
  assert.equal(minutes().length, 2);
  // However long the server was quiet, nothing older than the hour stays behind.
  t.mock.timers.tick(5 * 3600000);
  traffic.record(app, 'heartbeat', 'app', 0, null);
  assert.equal(minutes().length, 1);
  assert.deepEqual(traffic.summary(app).total, { count: 1, rejected: 0, averageMs: 0, medianMs: 0, p95Ms: 0, maxMs: 0 });
});

test('an empty hour has sixty quiet minutes and no routes', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 15, 8, 0, 0) });
  const summary = traffic.summary(memory().app);
  assert.equal(summary.minutes.length, 60); assert.equal(summary.minutes[59].at, '2026-10-15T08:00:00.000Z');
  assert.deepEqual([summary.total, summary.routes, summary.errors], [{ count: 0, rejected: 0 }, [], []]);
});
