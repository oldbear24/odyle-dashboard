migrate((app) => {
  // Room creation, joins and the application routes were capped tightly while the
  // service was new. Abuse has not been a concern, so the limits now only stop a
  // runaway client: the dashboard polls every open room every 15 seconds and the
  // Windows app adds its heartbeat, party and checklist reads. Pairing and sign-in
  // keep their brute-force caps from 1791763201_accounts.js.
  const budget = { '/api/odyle/create': 30, '/api/odyle/join': 30, '/api/odyle/': 600 };
  const settings = app.settings();
  settings.rateLimits.rules = settings.rateLimits.rules.map(r => ({ label: r.label, audience: r.audience, duration: r.duration, maxRequests: budget[r.label] || r.maxRequests }));
  app.save(settings);
}, (app) => {
  const budget = { '/api/odyle/create': 5, '/api/odyle/join': 10, '/api/odyle/': 120 };
  const settings = app.settings();
  settings.rateLimits.rules = settings.rateLimits.rules.map(r => ({ label: r.label, audience: r.audience, duration: r.duration, maxRequests: budget[r.label] || r.maxRequests }));
  app.save(settings);
});
