// POST /api/odyle/<action> runs the accounts.cjs function of the same name in camel case
// (desktop-code → desktopCode).
for (const action of ['create', 'join', 'character', 'report', 'heartbeat', 'sharing', 'wishlist', 'task', 'session', 'invalidate', 'leave', 'close', 'invites', 'revoke', 'rename', 'role', 'transfer', 'plan', 'discord-webhook', 'profile', 'desktop-code', 'desktop-device', 'forget-device', 'sign-out-everywhere', 'delete-account', 'delete-character']) {
  routerAdd('POST', '/api/odyle/' + action, e => {
    const name = e.request.url.path.split('/').pop();
    // Every request also feeds the superuser dashboard's packet list.
    return require(__hooks + '/lib/admin.cjs').observe(e, name, () => require(__hooks + '/lib/accounts.cjs')[name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())](e));
  }, $apis.requireAuth('users'), $apis.bodyLimit(4096));
}
// Public like pairing: a paired Windows app signs in, or forgets its pairing, with its device key.
// Handlers run in their own VM and see no outer variables, so each reads its action from the path.
for (const action of ['pair', 'desktop-sign-in', 'unpair']) {
  routerAdd('POST', '/api/odyle/' + action, e => {
    const name = e.request.url.path.split('/').pop();
    return require(__hooks + '/lib/admin.cjs').observe(e, name, () => require(__hooks + '/lib/accounts.cjs')[name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())](e));
  }, $apis.bodyLimit(4096));
}
routerAdd('GET', '/api/odyle/rooms', e => require(__hooks + '/lib/accounts.cjs').rooms(e), $apis.requireAuth('users'));
routerAdd('GET', '/api/odyle/tasks', e => require(__hooks + '/lib/accounts.cjs').tasks(e), $apis.requireAuth('users'));
routerAdd('GET', '/api/odyle/snapshot/{id}', e => require(__hooks + '/lib/accounts.cjs').snapshot(e), $apis.requireAuth('users'));
routerAdd('GET', '/api/odyle/history/{id}', e => require(__hooks + '/lib/accounts.cjs').history(e), $apis.requireAuth('users'));
routerAdd('GET', '/api/odyle/upcoming', e => require(__hooks + '/lib/accounts.cjs').upcoming(e), $apis.requireAuth('users'));
routerAdd('GET', '/api/odyle/account', e => require(__hooks + '/lib/accounts.cjs').account(e), $apis.requireAuth('users'));
routerAdd('GET', '/api/odyle/export', e => require(__hooks + '/lib/accounts.cjs').exportData(e), $apis.requireAuth('users'));
// Public: the newest Windows companion release, cached from GitHub (no account data involved).
routerAdd('GET', '/api/odyle/windows-release', e => require(__hooks + '/lib/releases.cjs').windowsRelease(e));
// Public: the message superusers set under Server controls, for the dashboard (signed in or not).
routerAdd('GET', '/api/odyle/announcement', e => { const settings = require(__hooks + '/lib/settings.cjs'); return e.json(200, { announcement: settings.announcement(settings.read(e.app)) }); });
// Superuser dashboard → Odyle (pb_hooks/admin, PocketBase UI extension): connected
// Windows apps, live requests, background jobs and the server-wide settings (lib/admin.cjs).
$app.onServe().bindFunc(e => { e.uiExtensions.push({ name: 'odyle', fs: $os.dirFS(__hooks + '/admin') }); return e.next(); });
routerAdd('GET', '/api/odyle/admin/ui', e => require(__hooks + '/lib/admin.cjs').ui(e));
routerAdd('GET', '/api/odyle/admin/monitor', e => require(__hooks + '/lib/admin.cjs').monitor(e), $apis.requireSuperuserAuth());
routerAdd('GET', '/api/odyle/admin/jobs', e => require(__hooks + '/lib/admin.cjs').jobList(e), $apis.requireSuperuserAuth());
routerAdd('POST', '/api/odyle/admin/jobs/{name}', e => require(__hooks + '/lib/admin.cjs').runJob(e), $apis.requireSuperuserAuth());
routerAdd('GET', '/api/odyle/admin/settings', e => require(__hooks + '/lib/admin.cjs').readSettings(e), $apis.requireSuperuserAuth());
// A full dungeon catalog (200 names of up to 60 characters) needs more than the 4 KB of the other routes.
routerAdd('POST', '/api/odyle/admin/settings', e => require(__hooks + '/lib/admin.cjs').saveSettings(e), $apis.requireSuperuserAuth(), $apis.bodyLimit(65536));
onRealtimeSubscribeRequest(e => {
  for (const topic of e.subscriptions) if (topic.startsWith('odyle.room.')) {
    if (!e.auth || e.auth.collection().name !== 'users') throw new ForbiddenError();
    require(__hooks + '/lib/accounts.cjs').membership(e.app, e.auth.id, topic.slice(11));
  } else if (topic.startsWith('odyle.admin.') && !(e.auth && e.auth.isSuperuser())) throw new ForbiddenError();
  return e.next();
});
onRealtimeMessageSend(e => {
  if (e.message.name.startsWith('odyle.room.')) {
    const auth = e.client.get('auth'); if (!auth || auth.collection().name !== 'users') return;
    try { require(__hooks + '/lib/accounts.cjs').membership(e.app, auth.id, e.message.name.slice(11)); } catch { return; }
  } else if (e.message.name.startsWith('odyle.admin.')) {
    const auth = e.client.get('auth'); if (!auth || !auth.isSuperuser()) return;
  }
  return e.next();
});
// The Background jobs page counts from this server start.
onBootstrap(e => { e.next(); e.app.store().set('odyle.startedAt', new Date().toISOString()); require(__hooks + '/lib/accounts.cjs').configureDiscord(e.app); });
// Every account deletion (by its owner, in the superuser dashboard or for inactivity)
// first passes the rooms it owns to another player or closes them.
onRecordDelete(e => { require(__hooks + '/lib/accounts.cjs').handOver(e.app, e.record.id); return e.next(); }, 'users');
// Each run is recorded for the superuser dashboard's Background jobs page (lib/jobs.cjs).
cronAdd('odyle-expiry', '*/5 * * * *', () => require(__hooks + '/lib/jobs.cjs').run($app, 'odyle-expiry'));
cronAdd('odyle-portraits', '* * * * *', () => require(__hooks + '/lib/jobs.cjs').run($app, 'odyle-portraits'));
cronAdd('odyle-reminders', '* * * * *', () => require(__hooks + '/lib/jobs.cjs').run($app, 'odyle-reminders'));
cronAdd('odyle-retention', '17 3 * * *', () => require(__hooks + '/lib/jobs.cjs').run($app, 'odyle-retention'));
// Browser hardening for the dashboard pages and files it serves. API and admin
// responses are left alone: the OAuth redirect page and the PocketBase UI need
// inline scripts, and JSON needs none of these headers.
routerUse(e => {
  const path = e.request.url.path;
  if (!path.startsWith('/api/') && !path.startsWith('/_/')) {
    const headers = e.response.header();
    headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'");
    headers.set('X-Frame-Options', 'DENY'); headers.set('X-Content-Type-Options', 'nosniff'); headers.set('Referrer-Policy', 'no-referrer');
  }
  return e.next();
});
