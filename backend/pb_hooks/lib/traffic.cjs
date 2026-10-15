// Odyle's requests of the last hour for the superuser dashboard's Server status page:
// per minute and route how many arrived, how many were rejected and why, and how long
// they took. Packets (POST routes) count with the source they came from, the Windows app
// or the dashboard; reads (GET routes) count as reads and are never listed as packets.
// Like packets this lives in server memory only, one entry per minute, and a restart
// clears it. Requests refused before Odyle handles them (no sign-in) are not counted.
const prefix = 'odyle.traffic.', latest = 'odyle.trafficMinute', hour = 60;
// Handling time buckets: up to 1 ms, up to 2 ms, … up to 5 s; the last holds anything slower.
const bounds = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
const bucket = ms => { const i = bounds.findIndex(bound => ms <= bound); return i < 0 ? bounds.length : i; };
// Distinct rejection reasons kept per minute; more are still counted as rejected.
const reasons = 20;

function record(app, kind, source, ms, error) {
  const store = app.store(), minute = Math.floor(Date.now() / 60000); let previous = minute;
  store.setFunc(latest, last => { previous = last || minute; return Math.max(previous, minute); });
  // The minutes that left the hour since the last request, however long the pause was.
  for (let m = previous - hour + 1; m <= Math.min(previous, minute - hour); m++) store.remove(prefix + m);
  store.setFunc(prefix + minute, raw => {
    const entry = raw ? JSON.parse(raw) : { routes: {}, errors: {} };
    const route = entry.routes[kind] || (entry.routes[kind] = { source, count: 0, rejected: 0, totalMs: 0, maxMs: 0, times: new Array(bounds.length + 1).fill(0) });
    route.count++; route.totalMs += ms; route.maxMs = Math.max(route.maxMs, ms); route.times[bucket(ms)]++;
    if (error) {
      route.rejected++;
      const message = String(error.message || 'Rejected.').slice(0, 200), key = kind + '\n' + message;
      if (entry.errors[key] || Object.keys(entry.errors).length < reasons) {
        const reason = entry.errors[key] || (entry.errors[key] = { kind, message, count: 0 });
        reason.count++; reason.lastAt = new Date().toISOString();
      }
    }
    return JSON.stringify(entry);
  });
}
// The upper bound of the bucket that holds the q-th share of the requests; the slowest
// time for the last bucket.
function percentile(times, count, maxMs, q) {
  let seen = 0;
  for (let i = 0; i < times.length; i++) { seen += times[i]; if (seen >= q * count) return i < bounds.length ? Math.min(bounds[i], maxMs) : maxMs; }
  return maxMs;
}
const timing = route => ({ averageMs: Math.round(route.totalMs / route.count * 10) / 10, medianMs: percentile(route.times, route.count, route.maxMs, 0.5), p95Ms: percentile(route.times, route.count, route.maxMs, 0.95), maxMs: route.maxMs });
function add(total, route) {
  total.count += route.count; total.rejected += route.rejected; total.totalMs += route.totalMs; total.maxMs = Math.max(total.maxMs, route.maxMs);
  route.times.forEach((n, i) => total.times[i] += n);
}
const empty = source => ({ source, count: 0, rejected: 0, totalMs: 0, maxMs: 0, times: new Array(bounds.length + 1).fill(0) });

// The last 60 minutes, oldest first, each with the accepted requests by source and every
// rejected one; the routes and the rejection reasons of the whole hour.
function summary(app) {
  const store = app.store(), now = Math.floor(Date.now() / 60000), minutes = [], routes = {}, errors = {}, all = empty('');
  for (let m = now - hour + 1; m <= now; m++) {
    const raw = store.get(prefix + m), entry = raw ? JSON.parse(raw) : { routes: {}, errors: {} };
    const minute = { at: new Date(m * 60000).toISOString(), app: 0, web: 0, read: 0, rejected: 0 };
    for (const kind in entry.routes) {
      const route = entry.routes[kind];
      minute[route.source] += route.count - route.rejected; minute.rejected += route.rejected;
      add(routes[kind] || (routes[kind] = empty(route.source)), route); add(all, route);
    }
    for (const key in entry.errors) {
      const reason = entry.errors[key], total = errors[key] || (errors[key] = { kind: reason.kind, message: reason.message, count: 0, lastAt: '' });
      total.count += reason.count; if (reason.lastAt > total.lastAt) total.lastAt = reason.lastAt;
    }
    minutes.push(minute);
  }
  const byCount = (a, b) => b.count - a.count || (a.kind < b.kind ? -1 : 1);
  return {
    minutes,
    total: { count: all.count, rejected: all.rejected, ...(all.count ? timing(all) : {}) },
    routes: Object.keys(routes).map(kind => ({ kind, source: routes[kind].source, count: routes[kind].count, rejected: routes[kind].rejected, ...timing(routes[kind]) })).sort(byCount),
    errors: Object.keys(errors).map(key => errors[key]).sort(byCount).slice(0, 20),
  };
}
module.exports = { record, summary };
