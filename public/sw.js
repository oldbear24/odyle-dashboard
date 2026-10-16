// The dashboard's service worker. It keeps the page and its built files so the
// dashboard opens without a connection (it then says it cannot reach the server) and
// shows run reminders and Web Push notifications. The API and the PocketBase dashboard are never cached: Odyle
// readings are always fetched live.
const cache = 'odyle-shell-v1';
const scope = new URL(self.registration.scope);
const skipped = path => path.startsWith('api/') || path.startsWith('_/');
self.addEventListener('install', event => {
  event.waitUntil(caches.open(cache).then(c => c.addAll(['./', 'manifest.webmanifest', 'favicon.svg', 'icon-192.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('odyle-') && k !== cache).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const path = url.pathname.slice(scope.pathname.length);
  if (skipped(path)) return;
  // Pages: the network first, so a deploy reaches every visitor at once; the kept page offline.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => { if (response.ok) { const copy = response.clone(); caches.open(cache).then(c => c.put('./', copy)); } return response; })
      .catch(() => caches.match('./').then(kept => kept || Response.error())));
    return;
  }
  // Built files carry a content hash in their name and never change; the rest is refreshed in the background.
  event.respondWith(caches.open(cache).then(c => c.match(request).then(kept => {
    if (kept && path.startsWith('assets/')) return kept;
    const fresh = fetch(request).then(response => { if (response.ok && response.type === 'basic') c.put(request, response.clone()); return response; });
    if (kept) { event.waitUntil(fresh.catch(() => null)); return kept; }
    return fresh;
  })));
});
// Web Push from the backend (backend/odyle/push.go): run reminders and cap alerts with the
// dashboard closed, `{ title, body, tag, page }` (the tag is the one open tabs use, so one shows).
self.addEventListener('push', event => {
  let message;
  try { message = event.data ? event.data.json() : {}; } catch { message = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(message.title || 'Odyle', { body: message.body || '', tag: message.tag || undefined, icon: 'icon-192.png', data: { page: message.page || '' } }));
});
// A click on a notification opens the dashboard at its page (or brings an open tab forward there).
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const page = event.notification.data?.page || '', target = new URL('./' + page, scope).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async list => {
    if (!list.length) return self.clients.openWindow(target);
    const tab = await list[0].focus();
    if (page && tab?.navigate) await tab.navigate(target).catch(() => { /* a tab this worker does not control keeps its page */ });
  }));
});
