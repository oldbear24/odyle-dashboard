import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRegion, isServer, findable } from '../../src/regions.js';
import { armoryRoute } from '../../src/armorylinks.js';

test('the regions and servers the armory can look up', () => {
  for (const region of ['GLOBAL_NA', 'GLOBAL_NAW', 'GLOBAL_EU', 'GLOBAL_SA', 'GLOBAL_ASIA'])
    assert.ok(isRegion(region), region);
  for (const region of ['', null, undefined, 'GLOBAL_XX', 'EU', 'global_eu', 'GLOBAL_EU ', 'xGLOBAL_EU'])
    assert.ok(!isRegion(region), String(region));
  for (const server of ['Lumiel', 'Ab', 'A'.repeat(20)]) assert.ok(isServer(server), server);
  for (const server of ['', null, 'A', 'A'.repeat(21), 'Lu miel', 'Lumiel2', 'Lumiël'])
    assert.ok(!isServer(server), String(server));
  assert.ok(findable({ server: 'Lumiel', region: 'GLOBAL_EU' }));
  assert.ok(!findable({ server: 'Lumiel' }));
  assert.ok(!findable({ region: 'GLOBAL_EU' }));
  assert.ok(!findable({}));
  assert.ok(!findable());
});

test('the armory route is built from the shared patterns and matches what it matched before', () => {
  // The literal the route was before #193.
  const before =
    /^\/armory(?:\/top(?:\/[A-Za-z]{2,30})?|\/find\/GLOBAL_(?:NAW?|EU|SA|ASIA)\/[A-Za-z]{2,20}\/[^/]{1,60}|\/(?:nae|naw|eu|la|as)\/[12]\d{3}\/[A-Za-z0-9_-]{8,90}={0,2}(?:\/(?:skills|daevanion|titles|appearance|upgrade|card))?)?$/;
  assert.equal(armoryRoute.source, before.source);
  assert.equal(armoryRoute.flags, before.flags);
});
