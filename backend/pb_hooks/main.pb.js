for (const action of ['create', 'join', 'character', 'report', 'heartbeat', 'sharing', 'session', 'invalidate', 'leave', 'close', 'invites', 'revoke', 'desktop-code']) {
  routerAdd('POST', '/api/odyle/' + action, e => {
    const name = e.request.url.path.split('/').pop();
    return require(__hooks + '/lib/accounts.cjs')[name === 'desktop-code' ? 'desktopCode' : name](e);
  }, $apis.requireAuth('users'), $apis.bodyLimit(4096));
}
routerAdd('POST', '/api/odyle/pair', e => require(__hooks + '/lib/accounts.cjs').pair(e), $apis.bodyLimit(4096));
routerAdd('GET', '/api/odyle/rooms', e => require(__hooks + '/lib/accounts.cjs').rooms(e), $apis.requireAuth('users'));
routerAdd('GET', '/api/odyle/snapshot/{id}', e => require(__hooks + '/lib/accounts.cjs').snapshot(e), $apis.requireAuth('users'));
onRealtimeSubscribeRequest(e => {
  for (const topic of e.subscriptions) if (topic.startsWith('odyle.room.')) {
    if (!e.auth || e.auth.collection().name !== 'users') throw new ForbiddenError();
    require(__hooks + '/lib/accounts.cjs').membership(e.app, e.auth.id, topic.slice(11));
  }
  return e.next();
});
onRealtimeMessageSend(e => {
  if (e.message.name.startsWith('odyle.room.')) {
    const auth = e.client.get('auth'); if (!auth || auth.collection().name !== 'users') return;
    try { require(__hooks + '/lib/accounts.cjs').membership(e.app, auth.id, e.message.name.slice(11)); } catch { return; }
  }
  return e.next();
});
onBootstrap(e => { e.next(); require(__hooks + '/lib/accounts.cjs').configureDiscord(e.app); });
cronAdd('odyle-expiry', '*/5 * * * *', () => require(__hooks + '/lib/accounts.cjs').cleanup());
cronAdd('odyle-portraits', '* * * * *', () => require(__hooks + '/lib/accounts.cjs').refreshPortraits());
