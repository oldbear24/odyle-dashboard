import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonical, stable } from '../../src/model.js';
import { deviceName } from '../../src/notify.js';

test('canonical() compares data whatever the order of its keys', () => {
  assert.equal(
    canonical({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: null } }),
    canonical({ a: { c: null, d: [2, { x: 2, y: 1 }] }, b: 1 }),
  );
  assert.equal(canonical({ b: 1, a: 2 }), '{"a":2,"b":1}');
  // Arrays keep their order: a reordered list is a change.
  assert.notEqual(canonical([1, 2]), canonical([2, 1]));
  assert.equal(canonical(null), 'null');
});

test('stable() leaves out when members and characters were last seen', () => {
  const members = [
    {
      id: 'm1',
      lastSeenAt: 'x',
      updated: 'y',
      role: 'owner',
      characters: [{ id: 'c1', value: 5, lastSeenAt: 'z', updated: 'w' }],
    },
    { id: 'm2', lastSeenAt: 'x' },
  ];
  assert.deepEqual(stable(members), [
    { id: 'm1', role: 'owner', characters: [{ id: 'c1', value: 5 }] },
    { id: 'm2', characters: undefined },
  ]);
  assert.equal(canonical(stable(members)), canonical(stable(members.map(m => ({ ...m, lastSeenAt: 'later' })))));
});

test('deviceName names a device by its browser and system', () => {
  assert.equal(
    deviceName(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0',
    ),
    'Edge on Windows',
  );
  assert.equal(
    deviceName(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
    ),
    'Chrome on Android',
  );
  assert.equal(
    deviceName(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    ),
    'Safari on iPhone',
  );
  assert.equal(
    deviceName('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0'),
    'Firefox on Linux',
  );
  assert.equal(deviceName('curl/8.0'), 'Browser');
});
