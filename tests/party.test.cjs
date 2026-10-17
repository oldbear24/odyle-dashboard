const { test } = require('node:test');
const assert = require('node:assert/strict');
// The room's party explained (#27): readiness.js explain() and src/partyview.js.
const now = Date.parse('2026-10-15T12:00:00Z');
const ago = seconds => new Date(now - seconds * 1000).toISOString();
const live = (id, user, name, value, extra = {}) => ({ id, user, displayName: user, role: 'reporter', characterName: name, value, confirmed: true, valid: true, source: 'packet', sharing: true, lastSeenAt: ago(5), lastReadingAt: ago(600), ...extra });
const entries = [
  live('a1', 'Anna', 'Ayla', 265, { role: 'owner' }), live('a2', 'Anna', 'AylaAlt', 300, { lastSeenAt: ago(7200) }),
  live('b1', 'Bram', 'Bram', 95), live('k1', 'Kaelen', 'Kael', 45),
  live('n1', 'Nyx', 'Nyx', 135, { lastSeenAt: ago(3 * 3600), lastReadingAt: ago(3 * 86400) }),
  { id: '', user: 'Aren', displayName: 'Aren', role: 'reporter', characterName: '', confirmed: false, lastReadingAt: '', source: 'packet', sharing: true },
  { id: '', user: 'Vee', displayName: 'Vee', role: 'viewer', characterName: '', confirmed: false, lastReadingAt: '', source: 'packet', sharing: true },
];
test('the party says who counts, who holds it back, who is missing and what was last known', async () => {
  const { explain } = await import('../src/readiness.js');
  const x = explain(entries, now, 40);
  assert.deepEqual([...x.counted], ['a1', 'b1', 'k1']);
  assert.deepEqual([x.lowest.id, x.cubes, x.members], ['k1', 1, 5]);
  assert.deepEqual(x.spread, [{ cubes: 6, players: 1 }, { cubes: 2, players: 1 }, { cubes: 1, players: 1 }]);
  assert.deepEqual(x.missing, [{ user: 'Nyx', displayName: 'Nyx', shared: true, lastSeenAt: ago(3 * 3600) }, { user: 'Aren', displayName: 'Aren', shared: false, lastSeenAt: '' }]);
  // Nearest to counting first, whatever order the room lists its members in.
  assert.deepEqual(explain([...entries].reverse(), now, 40).missing.map(m => m.user), ['Nyx', 'Aren']);
  // Every player's best saved value, the alt included; never part of the live numbers.
  assert.deepEqual({ ...x.lastKnown, lowest: x.lastKnown.lowest.id }, { lowest: 'k1', value: 45, cubes: 1, players: 4, of: 5, newest: ago(600), oldest: ago(3 * 86400) });
  // A projected value (the Odyle clock) replaces the saved one.
  assert.equal(explain(entries, now, 40, c => c.id === 'k1' ? 100 : c.value).lastKnown.lowest.id, 'b1');
  // Everyone live: nothing to add.
  const all = explain(entries.filter(c => ['Anna', 'Bram'].includes(c.user)), now, 40);
  assert.deepEqual([all.missing, all.lastKnown], [[], null]);
  // Missing players without a saved value add nothing to the live numbers.
  assert.equal(explain(entries.filter(c => c.user !== 'Nyx'), now, 40).lastKnown, null);
});
test('the summary gives the numbers, then reads like a sentence, in English and Czech, and cards say why they are not live', async () => {
  const { explain } = await import('../src/readiness.js'), { partySummary, statusReason, readyOrder } = await import('../src/partyview.js'), { useLanguage } = await import('../src/i18n.js');
  await useLanguage('en');
  const html = partySummary(explain(entries, now, 40), now), text = html.replace(/<[^>]+>/g, '\n').split('\n').filter(Boolean);
  assert.deepEqual(text, [
    'Party cubes', '1', 'the lowest player decides', 'Ready now', '3', '/ 5', 'characters with a cube of Odyle', 'Live', '3', '/ 5', 'players in game', 'Lowest', '45', 'Kaelen · Kael',
    'Kaelen · Kael is the bottleneck · 1 player can do 6 cubes, 1 player can do 2 cubes, 1 player can do 1 cube',
    // Players with a row say since when on it; the others say why here, and every reason is in the tooltip.
    'Not counted: Nyx, Aren (no character shared)',
    'Last known: 1 cube · lowest Kaelen · Kael 45 · values from 10m ago to 3d ago · 4 of 5 players have a saved value',
    'Not live: it does not count toward the party cubes.',
  ]);
  assert.match(html, /title="Nyx: last in game 3h ago\nAren: no character shared"/);
  assert.match(partySummary(explain(entries, now, 40), now, { estimated: true }), /Last known, estimated with the Odyle clock: /);
  assert.equal(statusReason(entries[0], now), '');
  assert.equal(statusReason(entries[4], now), 'Last in game 3h ago');
  assert.equal(statusReason({ ...entries[2], valid: false }, now), 'The reading ended: the game closed or another character was picked');
  assert.equal(statusReason({ ...entries[2], lastSeenAt: ago(60) }, now), 'The reader has not been heard from for 60s');
  assert.equal(statusReason({ ...entries[2], confirmed: false }, now), 'No confirmed reading yet');
  // Closest to ready first, the room's order within each group: never ranked by value.
  assert.deepEqual(readyOrder(entries.filter(c => c.characterName), now, 40).map(c => c.id), ['a1', 'b1', 'k1', 'a2', 'n1']);
  await useLanguage('cs');
  assert.match(partySummary(explain(entries, now, 40), now), /Kaelen · Kael brzdí partu/);
  await useLanguage('en');
});
