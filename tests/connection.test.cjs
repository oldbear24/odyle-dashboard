const { test } = require('node:test');
const assert = require('node:assert/strict');

test('Windows connection links carry the backend and single-use code in a fragment', async () => {
  const { connectionLink } = await import('../src/connection.js');
  const code = 'ABCDEFGH23456789';
  const link = new URL(connectionLink('https://party.example/pocketbase/', code));
  assert.equal(link.origin + link.pathname, 'https://party.example/pocketbase/');
  assert.equal(link.hash, '#odyle-pair=' + code);
  assert.equal(link.search, '');
  assert.equal(connectionLink('http://127.0.0.1:8090', code), 'http://127.0.0.1:8090/#odyle-pair=' + code);
  for (const address of ['http://party.example', 'https://user:secret@party.example', 'https://party.example?token=x', 'https://party.example#old', 'file:///C:/app']) assert.throws(() => connectionLink(address, code));
  assert.throws(() => connectionLink('https://party.example', 'ROOMINVITE12'));
});
