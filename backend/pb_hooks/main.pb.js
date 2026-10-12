routerAdd('POST', '/api/odyle/create', (e) => require(__hooks + '/lib/service.cjs').create(e), $apis.bodyLimit(4096));
routerAdd('POST', '/api/odyle/join', (e) => require(__hooks + '/lib/service.cjs').join(e), $apis.bodyLimit(4096));
for (const action of ['report', 'heartbeat', 'sharing', 'session', 'invalidate', 'leave', 'settings', 'invites', 'revoke']) {
  // PocketBase serializes handlers: route path is read inside the isolated callback.
  routerAdd('POST', '/api/odyle/' + action, (e) => {
    const action = e.request.url.path.split('/').pop();
    return require(__hooks + '/lib/service.cjs')[action](e);
  }, $apis.requireAuth('members'), $apis.bodyLimit(4096));
}
cronAdd('odyle-expiry', '*/5 * * * *', () => require(__hooks + '/lib/service.cjs').cleanup());
// SSE clients cache auth records. Recheck membership before each delivery so
// an already-connected client cannot keep reading after its credential is revoked.
onRealtimeMessageSend((e) => {
  const auth = e.client.get('auth');
  if (auth && auth.collection().name === 'members' && e.message.name !== 'PB_CONNECT') {
    try {
      const current = e.app.findRecordById('members', auth.id);
      const room = e.app.findRecordById('rooms', current.getString('room'));
      if (Date.parse(room.getString('expiresAt')) <= Date.now()) return;
    } catch { return; }
  }
  return e.next();
});
