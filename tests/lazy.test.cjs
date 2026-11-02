const { test } = require('node:test');
const assert = require('node:assert/strict');

test('a part loads once, is at hand once loaded and is asked for again after a failure', async () => {
  const { lazily } = await import('../src/lazy.js');
  let loads = 0, fail = true;
  const part = lazily(async () => { loads++; if (fail) throw new Error('gone'); return { page: 'armory' }; });
  assert.equal(part.loaded(), null);
  await assert.rejects(part(), /gone/);
  assert.equal(await part.prefetch(), false);
  assert.equal(part.loaded(), null);
  fail = false;
  const [a, b] = await Promise.all([part(), part()]);
  assert.equal(a, b);
  assert.deepEqual(part.loaded(), { page: 'armory' });
  assert.equal(await part.prefetch(), true);
  assert.equal(loads, 3);
});

test('a part that fails goes to its handler, whose answer the caller gets', async () => {
  const { lazily } = await import('../src/lazy.js');
  const seen = [];
  const part = lazily(async () => { throw new Error('Failed to fetch dynamically imported module'); }, error => { seen.push(error.message); return 'reloading'; });
  assert.equal(await part(), 'reloading');
  // Prefetching never asks the handler: only a page, dialog or action that needs the part does.
  assert.equal(await part.prefetch(), false);
  assert.deepEqual(seen, ['Failed to fetch dynamically imported module']);
});

test('a tab reloads for a part gone with a deploy once a minute at most, never offline or without storage', async () => {
  const { reloadOnce, reloadKey } = await import('../src/lazy.js');
  const kept = {}, store = { getItem: key => kept[key] ?? null, setItem: (key, value) => { kept[key] = value; } };
  const now = Date.parse('2026-11-02T12:00:00Z');
  assert.equal(reloadOnce(store, now, false), false);
  assert.equal(reloadOnce(store, now), true);
  assert.equal(kept[reloadKey], String(now));
  assert.equal(reloadOnce(store, now + 59000), false);
  assert.equal(reloadOnce(store, now + 61000), true);
  assert.equal(reloadOnce({ getItem() { throw new Error('blocked'); }, setItem() {} }, now), false);
  assert.equal(reloadOnce(null, now), false);
});
