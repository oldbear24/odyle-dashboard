import { test } from 'node:test';
import assert from 'node:assert/strict';

// src/routes.js (page addresses) against stand-ins for the browser's document, location and
// history. The module remembers whether the page was served with paths, so each mode loads its
// own copy of it (a query string makes a new module).
let copies = 0;
function browser({ paths, base, href, hash = '' }) {
  const calls = [];
  const url = new URL(href);
  const where = {
    get href() {
      return url.href;
    },
    get pathname() {
      return url.pathname;
    },
    get search() {
      return url.search;
    },
    get hash() {
      return url.hash;
    },
    set hash(value) {
      url.hash = value;
      calls.push(['hash', value]);
    },
  };
  if (hash) url.hash = hash;
  globalThis.document = {
    baseURI: base,
    title: '',
    querySelector: selector => (paths && selector === 'meta[name="odyle-routes"]' ? { content: 'paths' } : null),
  };
  globalThis.location = where;
  globalThis.history = {
    pushState: (_, __, target) => {
      calls.push(['push', target]);
      url.href = new URL(target, base).href;
    },
    replaceState: (_, __, target) => {
      calls.push(['replace', target]);
      url.href = new URL(target, url.href).href;
    },
  };
  return {
    calls,
    go: target => {
      url.href = new URL(target, base).href;
    },
  };
}
const routes = async () => import(`../../src/routes.js?copy=${copies++}`);

test('without paths, pages are hash routes any static host serves', async () => {
  const page = browser({
    paths: false,
    base: 'https://static.test/odyle/',
    href: 'https://static.test/odyle/?utm=1#/armory/eu/1/x',
  });
  const { usesPaths, link, address, current, linked, visit, adoptHash, bare } = await routes();
  assert.equal(usesPaths(), false);
  assert.equal(link('/tasks'), '#/tasks');
  assert.equal(link('/'), '#/');
  assert.equal(link('/join/ABC'), '#/join/ABC');
  // The query of the page is dropped from a copied address; the hash names the page.
  assert.equal(address('/tasks'), 'https://static.test/odyle/#/tasks');
  assert.equal(current(), '/armory/eu/1/x');
  assert.equal(linked('https://static.test/odyle/tasks'), '', 'the browser follows fragments by itself');
  assert.equal(adoptHash(), false);
  assert.equal(bare(), false);
  visit('/armory/eu/1/x');
  assert.deepEqual(page.calls, [], 'the page is already shown');
  visit('/tasks');
  assert.deepEqual(page.calls.at(-1), ['hash', '/tasks']);
  visit('/week', true);
  assert.deepEqual(page.calls.at(-1), ['replace', '#/week']);
  page.go('https://static.test/odyle/');
  assert.equal(bare(), true);
});

test("with paths, links are relative to the dashboard's base and invite codes stay in the fragment", async () => {
  const page = browser({
    paths: true,
    base: 'https://odyle.test/',
    href: 'https://odyle.test/armory/eu/2304/abc?tab=gear',
  });
  const { usesPaths, link, address, current, visit, adoptHash, bare } = await routes();
  assert.equal(usesPaths(), true);
  assert.equal(link('/tasks'), './tasks');
  assert.equal(link('/'), './');
  assert.equal(link('/join/ABC123'), './#/join/ABC123', 'the code never reaches a server');
  assert.equal(address('/tasks'), 'https://odyle.test/tasks');
  assert.equal(address('/join/ABC123'), 'https://odyle.test/#/join/ABC123');
  assert.equal(current(), '/armory/eu/2304/abc');
  assert.equal(bare(), false);
  visit('/armory/eu/2304/abc?tab=gear');
  assert.deepEqual(page.calls, [], 'the page is already shown');
  visit('/tasks');
  assert.deepEqual(page.calls.at(-1), ['push', 'https://odyle.test/tasks']);
  visit('/week', true);
  assert.deepEqual(page.calls.at(-1), ['replace', 'https://odyle.test/week']);
  // An old hash link opens its page under its path; an invite's stays a fragment.
  page.go('https://odyle.test/#/armory/eu/1/x');
  assert.equal(adoptHash(), true);
  assert.deepEqual(page.calls.at(-1), ['replace', './armory/eu/1/x']);
  page.go('https://odyle.test/#/join/CODE');
  assert.equal(adoptHash(), false);
  assert.equal(current(), '/join/CODE');
  page.go('https://odyle.test/');
  assert.equal(bare(), true);
  page.go('https://odyle.test/#');
  assert.equal(adoptHash(), false);
});

test('served under a folder, pages are named from the folder on', async () => {
  const page = browser({ paths: true, base: 'https://host.test/odyle/', href: 'https://host.test/odyle/tasks' });
  const { link, address, current, linked } = await routes();
  assert.equal(current(), '/tasks');
  assert.equal(address('/armory/top'), 'https://host.test/odyle/armory/top');
  assert.equal(link('/'), './');
  page.go('https://host.test/odyle/');
  assert.equal(current(), '/');
  page.go('https://host.test/elsewhere/page');
  assert.equal(current(), '/', 'outside the dashboard is no page of it');
  assert.equal(linked('https://host.test/odyle/week'), '/week');
  assert.equal(linked('/odyle/armory/eu/1/x'), '/armory/eu/1/x');
  assert.equal(linked('https://host.test/elsewhere/week'), '');
  assert.equal(linked('https://other.test/odyle/week'), '');
  assert.equal(linked('mailto:someone@example.test'), '');
  assert.equal(linked('https://host.test/odyle/week#section'), '', "a fragment is the page's own");
  assert.equal(linked('https://host.test/odyle/#/join/CODE'), '/join/CODE');
  assert.equal(linked('http://[bad'), '', 'an address that is no address leads nowhere');
});

test("the tab's title follows the page and is written only when it changes", async () => {
  browser({ paths: false, base: 'https://static.test/', href: 'https://static.test/' });
  const { retitle } = await routes();
  let writes = 0,
    title = 'Odyle';
  Object.defineProperty(globalThis.document, 'title', {
    get: () => title,
    set: value => {
      writes++;
      title = value;
    },
  });
  retitle('Odyle');
  assert.equal(writes, 0);
  retitle('Tasks · Odyle');
  assert.equal(title, 'Tasks · Odyle');
  assert.equal(writes, 1);
  delete globalThis.document;
  assert.doesNotThrow(() => retitle('No page at all'));
});
