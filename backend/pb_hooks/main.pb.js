for (const action of ['create', 'join', 'character', 'report', 'heartbeat', 'sharing', 'wishlist', 'task', 'session', 'invalidate', 'leave', 'close', 'invites', 'revoke', 'desktop-code']) {
  routerAdd('POST', '/api/odyle/' + action, e => {
    const name = e.request.url.path.split('/').pop();
    // The companion's requests also feed the superuser dashboard's packet list.
    return require(__hooks + '/lib/admin.cjs').observe(e, name, () => require(__hooks + '/lib/accounts.cjs')[name === 'desktop-code' ? 'desktopCode' : name](e));
  }, $apis.requireAuth('users'), $apis.bodyLimit(4096));
}
routerAdd('POST', '/api/odyle/pair', e => require(__hooks + '/lib/accounts.cjs').pair(e), $apis.bodyLimit(4096));
routerAdd('GET', '/api/odyle/rooms', e => require(__hooks + '/lib/accounts.cjs').rooms(e), $apis.requireAuth('users'));
routerAdd('GET', '/api/odyle/tasks', e => require(__hooks + '/lib/accounts.cjs').tasks(e), $apis.requireAuth('users'));
routerAdd('GET', '/api/odyle/snapshot/{id}', e => require(__hooks + '/lib/accounts.cjs').snapshot(e), $apis.requireAuth('users'));
// Public: the newest Windows companion release, cached from GitHub (no account data involved).
routerAdd('GET', '/api/odyle/windows-release', e => require(__hooks + '/lib/releases.cjs').windowsRelease(e));
// Superuser dashboard → Odyle (pb_hooks/admin, PocketBase UI extension): connected
// Windows apps, their live requests and the server-wide settings (lib/admin.cjs).
$app.onServe().bindFunc(e => { e.uiExtensions.push({ name: 'odyle', fs: $os.dirFS(__hooks + '/admin') }); return e.next(); });
routerAdd('GET', '/api/odyle/admin/ui', e => require(__hooks + '/lib/admin.cjs').ui(e));
routerAdd('GET', '/api/odyle/admin/monitor', e => require(__hooks + '/lib/admin.cjs').monitor(e), $apis.requireSuperuserAuth());
routerAdd('GET', '/api/odyle/admin/settings', e => require(__hooks + '/lib/admin.cjs').readSettings(e), $apis.requireSuperuserAuth());
routerAdd('POST', '/api/odyle/admin/settings', e => require(__hooks + '/lib/admin.cjs').saveSettings(e), $apis.requireSuperuserAuth(), $apis.bodyLimit(4096));
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
onBootstrap(e => { e.next(); require(__hooks + '/lib/accounts.cjs').configureDiscord(e.app); });
cronAdd('odyle-expiry', '*/5 * * * *', () => require(__hooks + '/lib/accounts.cjs').cleanup());
cronAdd('odyle-portraits', '* * * * *', () => require(__hooks + '/lib/accounts.cjs').refreshPortraits());
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
