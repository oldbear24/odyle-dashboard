import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// public/sw.js, the service worker, run in a context that stands in for the worker's globals:
// a cache storage kept in memory, a network that answers from a table, and the worker's events.
const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');

class FakeResponse {
  constructor(body = '', { ok = true, type = 'basic', url = '' } = {}) {
    Object.assign(this, { body, ok, type, url });
  }
  clone() {
    return new FakeResponse(this.body, this);
  }
  static error() {
    return Object.assign(new FakeResponse('', { ok: false, type: 'error' }), { error: true });
  }
  static redirect(to) {
    return Object.assign(new FakeResponse('', { ok: false }), { redirected: to });
  }
}
const keyOf = request => (typeof request === 'string' ? new URL(request, 'https://odyle.test/app/').href : request.url);

// worker runs the file with the build's stamp (the line the build writes) and returns what
// the tests drive: the listeners, the caches and the network.
function worker({ built = null, online = true, scope = 'https://odyle.test/app/' } = {}) {
  const listeners = {},
    stores = new Map(),
    fetched = [],
    notes = [],
    opened = [],
    table = new Map();
  const open = name => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };
  const cacheOf = name => {
    const store = open(name);
    return {
      addAll: async urls => {
        for (const u of urls) store.set(keyOf(u), new FakeResponse('shell ' + u));
      },
      put: async (request, response) => {
        store.set(keyOf(request), response);
      },
      match: async request => store.get(keyOf(request)),
      keys: async () => [...store.keys()].map(url => ({ url })),
    };
  };
  const clients = {
    list: [],
    opened: [],
    matchAll: async () => clients.list,
    openWindow: async url => {
      clients.opened.push(url);
    },
    claim: async () => {
      clients.claimed = true;
    },
  };
  const self = {
    registration: {
      scope,
      showNotification: async (title, options) => {
        notes.push({ title, ...options });
      },
    },
    addEventListener: (type, listener) => {
      listeners[type] = listener;
    },
    skipWaiting: async () => {
      self.skipped = true;
    },
    clients,
  };
  const caches = {
    open: async name => cacheOf(name),
    keys: async () => [...stores.keys()],
    delete: async name => stores.delete(name),
    match: async request => {
      for (const store of stores.values()) if (store.has(keyOf(request))) return store.get(keyOf(request));
    },
  };
  const net = async request => {
    fetched.push(request.url);
    if (!online) throw new TypeError('offline');
    return table.get(request.url) || new FakeResponse('network ' + request.url);
  };
  const stamped = source.replace(
    "const build = 'dev', built = null;",
    `const build = 'abc', built = ${JSON.stringify(built)};`,
  );
  assert.notEqual(stamped, source, 'the stamp line is where the build writes it');
  vm.runInNewContext(stamped, { self, caches, fetch: net, Response: FakeResponse, URL, Promise, console });
  return {
    listeners,
    stores,
    fetched,
    notes,
    table,
    self,
    clients,
    open,
    cacheOf,
    opened,
    dispatch: async (type, event) => {
      const waits = [];
      const e = {
        ...event,
        waitUntil: p => waits.push(p),
        respondWith: p => {
          e.responded = p;
        },
      };
      listeners[type](e);
      await Promise.all(waits);
      return e;
    },
  };
}
const get = (url, mode = 'cors') => ({ url: new URL(url, 'https://odyle.test/app/').href, method: 'GET', mode });

test('installing keeps the start page and its files, and takes over at once', async () => {
  const w = worker();
  await w.dispatch('install', {});
  assert.deepEqual([...w.stores.keys()], ['odyle-shell-abc']);
  assert.deepEqual([...w.stores.get('odyle-shell-abc').keys()].sort(), [
    'https://odyle.test/app/',
    'https://odyle.test/app/favicon.svg',
    'https://odyle.test/app/icon-192.png',
    'https://odyle.test/app/manifest.webmanifest',
  ]);
  assert.equal(w.self.skipped, true);
});

test("activating drops the caches of older builds, keeps others' and moves over the built files this build still uses", async () => {
  const w = worker({ built: ['assets/a-1.js', 'assets/b-2.css'] });
  const old = w.open('odyle-shell-old'),
    foreign = w.open('another-app');
  old.set('https://odyle.test/app/assets/a-1.js', new FakeResponse('kept'));
  old.set('https://odyle.test/app/assets/gone-9.js', new FakeResponse('dropped'));
  old.set('https://odyle.test/app/index.html', new FakeResponse('page'));
  foreign.set('x', new FakeResponse('x'));
  w.open('odyle-shell-abc');
  await w.dispatch('activate', {});
  assert.deepEqual([...w.stores.keys()].sort(), ['another-app', 'odyle-shell-abc']);
  assert.deepEqual([...w.stores.get('odyle-shell-abc').keys()], ['https://odyle.test/app/assets/a-1.js']);
  assert.equal(w.clients.claimed, true);
  // A worker without the list of built files moves nothing and still drops the old caches.
  const bare = worker();
  bare.open('odyle-shell-old').set('https://odyle.test/app/assets/a-1.js', new FakeResponse('kept'));
  await bare.dispatch('activate', {});
  assert.deepEqual([...bare.stores.keys()], []);
});

test("only GET requests for the dashboard's own files are handled, never the API or the PocketBase dashboard", async () => {
  const w = worker();
  for (const request of [
    { ...get('assets/x.js'), method: 'POST' },
    get('https://elsewhere.test/app/assets/x.js'),
    get('https://odyle.test/other/assets/x.js'),
    get('api/odyle/rooms'),
    get('api/odyle/rooms', 'navigate'),
    get('_/'),
    get('_/extensions.js', 'navigate'),
  ]) {
    const e = await w.dispatch('fetch', { request });
    assert.equal(e.responded, undefined, `${request.method} ${request.url}`);
  }
  assert.deepEqual(w.fetched, []);
});

test('pages come from the network first, and offline the start page or a way back to it', async () => {
  const w = worker();
  const start = await (await w.dispatch('fetch', { request: get('./', 'navigate') })).responded;
  assert.equal(start.body, 'network https://odyle.test/app/');
  assert.equal(
    w.stores.get('odyle-shell-abc').get('https://odyle.test/app/').body,
    'network https://odyle.test/app/',
    'the start page is kept for offline',
  );
  // Other pages are not kept: they name their files relative to their own folder.
  await (
    await w.dispatch('fetch', { request: get('armory/eu/1/x', 'navigate') })
  ).responded;
  assert.equal(w.stores.get('odyle-shell-abc').has('https://odyle.test/app/armory/eu/1/x'), false);
  // A page the network refuses is not kept either.
  w.table.set('https://odyle.test/app/index.html', new FakeResponse('down', { ok: false }));
  w.stores.get('odyle-shell-abc').delete('https://odyle.test/app/');
  await (
    await w.dispatch('fetch', { request: get('index.html', 'navigate') })
  ).responded;
  assert.equal(w.stores.get('odyle-shell-abc').has('https://odyle.test/app/'), false);
  // Offline.
  const off = worker({ online: false });
  off.open('odyle-shell-abc').set('https://odyle.test/app/', new FakeResponse('kept start'));
  assert.equal((await (await off.dispatch('fetch', { request: get('./', 'navigate') })).responded).body, 'kept start');
  assert.equal(
    (await (await off.dispatch('fetch', { request: get('index.html', 'navigate') })).responded).body,
    'kept start',
  );
  assert.equal(
    (await (await off.dispatch('fetch', { request: get('armory/eu/1/x', 'navigate') })).responded).redirected,
    'https://odyle.test/app/',
  );
  // Offline with nothing kept yet.
  const empty = worker({ online: false });
  assert.equal((await (await empty.dispatch('fetch', { request: get('./', 'navigate') })).responded).error, true);
});

test('built files with a hash in their name are served from the cache, the rest is refreshed behind the kept copy', async () => {
  const w = worker();
  const store = w.open('odyle-shell-abc');
  store.set('https://odyle.test/app/assets/app-1a2b.js', new FakeResponse('kept build'));
  assert.equal(
    (await (await w.dispatch('fetch', { request: get('assets/app-1a2b.js') })).responded).body,
    'kept build',
  );
  assert.deepEqual(w.fetched, [], 'a hashed file never changes: no request');
  // Not yet kept: fetched, and kept when the answer is ours and fine.
  assert.equal(
    (await (await w.dispatch('fetch', { request: get('assets/new-3c4d.js') })).responded).body,
    'network https://odyle.test/app/assets/new-3c4d.js',
  );
  assert.equal(store.has('https://odyle.test/app/assets/new-3c4d.js'), true);
  // Anything else answers from the cache and is refreshed in the background.
  store.set('https://odyle.test/app/icon-192.png', new FakeResponse('old icon'));
  w.table.set('https://odyle.test/app/icon-192.png', new FakeResponse('new icon'));
  const e = await w.dispatch('fetch', { request: get('icon-192.png') });
  assert.equal((await e.responded).body, 'old icon');
  assert.equal(store.get('https://odyle.test/app/icon-192.png').body, 'new icon');
  // Answers that are not ours (opaque, redirected elsewhere) or not fine are not kept.
  w.table.set('https://odyle.test/app/a.png', new FakeResponse('opaque', { type: 'cors' }));
  w.table.set('https://odyle.test/app/b.png', new FakeResponse('bad', { ok: false }));
  await (
    await w.dispatch('fetch', { request: get('a.png') })
  ).responded;
  await (
    await w.dispatch('fetch', { request: get('b.png') })
  ).responded;
  assert.equal(store.has('https://odyle.test/app/a.png') || store.has('https://odyle.test/app/b.png'), false);
  // Offline, the kept copy answers; without one the request fails as it would without a worker.
  const off = worker({ online: false });
  off.open('odyle-shell-abc').set('https://odyle.test/app/icon-192.png', new FakeResponse('kept icon'));
  assert.equal((await (await off.dispatch('fetch', { request: get('icon-192.png') })).responded).body, 'kept icon');
  await assert.rejects(
    Promise.resolve((await off.dispatch('fetch', { request: get('missing.png') })).responded),
    TypeError,
  );
});

test('a push shows its notification with the tag the open tabs use, and survives a message that is not JSON', async () => {
  const w = worker();
  await w.dispatch('push', {
    data: { json: () => ({ title: 'Run at 20:00', body: 'Fire Temple', tag: 'run-1', page: '#/room/abc' }) },
  });
  await w.dispatch('push', {
    data: {
      json: () => {
        throw new SyntaxError('no');
      },
      text: () => 'plain words',
    },
  });
  await w.dispatch('push', {});
  // Through JSON: the objects come from the worker's own realm, and a tag left out is no key.
  assert.deepEqual(JSON.parse(JSON.stringify(w.notes)), [
    { title: 'Run at 20:00', body: 'Fire Temple', tag: 'run-1', icon: 'icon-192.png', data: { page: '#/room/abc' } },
    { title: 'Odyle', body: 'plain words', icon: 'icon-192.png', data: { page: '' } },
    { title: 'Odyle', body: '', icon: 'icon-192.png', data: { page: '' } },
  ]);
});

test('a click on a notification opens the dashboard at its page, or brings an open tab there', async () => {
  const closed = [];
  const click = page => ({ notification: { close: () => closed.push(page), data: { page } } });
  const w = worker();
  await w.dispatch('notificationclick', click('#/room/abc'));
  assert.deepEqual(w.clients.opened, ['https://odyle.test/app/#/room/abc']);
  const navigated = [];
  w.clients.list = [
    {
      focus: async () => ({
        navigate: async url => {
          navigated.push(url);
        },
      }),
    },
  ];
  await w.dispatch('notificationclick', click('#/tasks'));
  assert.deepEqual(navigated, ['https://odyle.test/app/#/tasks']);
  // No page: the tab is only brought forward. A tab this worker does not control keeps its page.
  navigated.length = 0;
  await w.dispatch('notificationclick', click(''));
  assert.deepEqual(navigated, []);
  w.clients.list = [
    {
      focus: async () => ({
        navigate: async () => {
          throw new Error('not ours');
        },
      }),
    },
  ];
  await w.dispatch('notificationclick', click('#/week'));
  assert.equal(closed.length, 4);
});
