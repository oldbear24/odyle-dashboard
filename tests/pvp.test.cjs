const { test } = require('node:test');
const assert = require('node:assert/strict');
const now = Date.parse('2026-11-12T20:00:00Z');
const data = {
  character: { id: 'c1', characterName: 'Hero' }, enabled: true, days: 90, keepDays: 90,
  totals: { kills: 6, assists: 2, deaths: 4 }, allTime: { kills: 40, assists: 12, deaths: 31, at: '2026-11-12 19:58:00.000Z' },
  opponents: [
    { name: 'Vexa', server: 'Kaisinel', region: 'GLOBAL_EU', kills: 3, assists: 0, deaths: 2, lastAt: '2026-11-12 19:58:00.000Z' },
    { name: 'Nyra', server: '', region: '', kills: 0, assists: 2, deaths: 0, lastAt: '2026-11-12 19:00:00.000Z' },
    { name: '<i>x</i>', server: 'Siel', region: 'GLOBAL_NAW', kills: 3, assists: 0, deaths: 2, lastAt: '2026-11-10 08:00:00.000Z' },
  ], opponentCount: 3,
  allies: [{ name: 'Kael', server: 'Lumiel', region: 'GLOBAL_EU', kills: 0, assists: 2, deaths: 0, lastAt: '2026-11-12 19:00:00.000Z' }],
  events: [
    { kind: 'death', name: 'Vexa', server: 'Kaisinel', region: 'GLOBAL_EU', at: '2026-11-12 19:58:00.000Z' },
    { kind: 'assist', name: 'Nyra', server: '', region: '', by: 'Kael', byServer: 'Lumiel', byRegion: 'GLOBAL_EU', at: '2026-11-12 19:00:00.000Z' },
    { kind: 'assist', name: 'Nyra', server: '', region: '', at: '2026-11-12 18:59:00.000Z' },
    { kind: 'kill', name: 'Vexa', server: '', region: '', at: '2026-11-12 18:00:00.000Z' },
  ], page: 1, perPage: 12, total: 12, pages: 1,
};
test('a character whose player counts PvP shows its kills and deaths on its row', async () => {
  const { pvpButton } = await import('../src/pvpline.js');
  const row = pvpButton({ id: 'c1', characterName: 'Hero', pvp: { kills: 1, assists: 12, deaths: 31 } });
  assert.match(row, /data-pvp="c1"/); assert.match(row, /data-name="Hero"/); assert.match(row, />1 kill</); assert.match(row, />31 deaths</);
  assert.match(row, /title="PvP of Hero: kills 1 · assists 12 · deaths 31"/);
  // Counted from zero once PvP stats are on; nothing while they are off or for a character not saved yet.
  assert.match(pvpButton({ id: 'c2', characterName: 'Alt', pvp: { kills: 0, assists: 0, deaths: 0 } }), />0 kills<.*>0 deaths</);
  assert.equal(pvpButton({ id: 'c3', characterName: 'Off', pvp: null }), ''); assert.equal(pvpButton({ id: 'c3', characterName: 'Off' }), ''); assert.equal(pvpButton({ characterName: 'New', pvp: { kills: 1 } }), '');
});
test('the PvP dialog shows the period, its counts, the players met, the allies helped and the latest events', async () => {
  const { pvpBody, ratio, periods } = await import('../src/pvp.js');
  const body = pvpBody({ data, name: 'Hero', own: true, now });
  // The period's four figures and the counts since PvP stats were turned on.
  assert.match(body, /<strong>6<\/strong><span>Kills<\/span>/); assert.match(body, /<strong>2<\/strong><span>Assists<\/span>/); assert.match(body, /<strong>4<\/strong><span>Deaths<\/span>/); assert.match(body, /<strong>1\.50<\/strong><span>Kills per death<\/span>/);
  assert.match(body, /Since PvP stats were turned on: kills 40 · assists 12 · deaths 31/);
  assert.equal(ratio({ kills: 3, deaths: 0 }), 3); assert.equal(ratio({}), 0); assert.equal(ratio(), 0);
  // The periods: a week, 30 days and as long as events are kept, the asked one pressed.
  assert.deepEqual(periods(90), [7, 30, 90]); assert.deepEqual(periods(30), [7, 30]); assert.deepEqual(periods(7), [7]); assert.deepEqual(periods(3), [3]);
  assert.match(body, /data-pvp-days="90" aria-pressed="true">90 days</); assert.match(body, /data-pvp-days="7" aria-pressed="false">7 days</);
  // A player whose server the game said links to the armory's lookup; one without stays plain, and names are escaped.
  assert.match(body, /<a href="#\/armory\/find\/GLOBAL_EU\/Kaisinel\/Vexa" title="Look up Vexa in the armory">Vexa<\/a><small>Kaisinel EU<\/small>/);
  assert.match(body, /<span class="pvp-player">Nyra<\/span><\/td><td>0<\/td><td>2<\/td><td>0<\/td><td>1h ago<\/td>/);
  assert.match(body, /&lt;i&gt;x&lt;\/i&gt;<\/a><small>Siel NA-W<\/small>/); assert.doesNotMatch(body, /<i>x<\/i>/);
  assert.match(body, /Players <span class="modal-count">3</); assert.match(body, /Kills assisted for <span class="modal-count">1</); assert.match(body, /Lumiel EU<\/small><\/span><\/td><td>2<\/td>/);
  // The events: what happened and against whom, newest first, as the server paged them.
  assert.match(body, /class="pvp-death"><td>[^<]+<\/td><td>Killed by <strong>Vexa<\/strong>/); assert.match(body, /Assisted <strong>Kael<\/strong> against <strong>Nyra<\/strong>/);
  assert.match(body, /<td>Assisted against <strong>Nyra<\/strong>/); assert.match(body, /class="pvp-kill"><td>[^<]+<\/td><td>Killed <strong>Vexa<\/strong>/);
  assert.match(body, /Latest <span class="modal-count">12</); assert.match(body, /Each event is kept for 90 days\./);
});
test('the players table sorts by a column and pages; the events page their own', async () => {
  const { sorted, playersTable, eventsTable } = await import('../src/pvp.js');
  const names = (list, by) => sorted(list, by).map(p => p.name);
  assert.deepEqual(names(data.opponents, 'total'), ['Vexa', 'Nyra', '<i>x</i>']); assert.deepEqual(names(data.opponents, 'nonsense'), ['Vexa', 'Nyra', '<i>x</i>']);
  assert.deepEqual(names(data.opponents, 'assists'), ['Nyra', 'Vexa', '<i>x</i>']); assert.deepEqual(names(data.opponents, 'deaths'), ['Vexa', '<i>x</i>', 'Nyra']);
  assert.deepEqual(names(data.opponents, 'last'), ['Vexa', 'Nyra', '<i>x</i>']); assert.deepEqual(names([...data.opponents].reverse(), 'last'), ['Vexa', 'Nyra', '<i>x</i>']);
  const many = Array.from({ length: 23 }, (_, i) => ({ name: 'P' + i, server: '', region: '', kills: i, assists: 0, deaths: 0, lastAt: '2026-11-12 19:00:00.000Z' }));
  const first = playersTable({ data: { opponents: many, opponentCount: 600 }, sort: 'kills', page: 1, now });
  assert.match(first, /data-pvp-sort="kills" aria-pressed="true"/); assert.match(first, /<th aria-sort="descending"><button type="button" class="pvp-sort" data-pvp-sort="kills"/);
  assert.match(first, />P22</); assert.doesNotMatch(first, />P12</); assert.match(first, /data-pvp-players="2"/); assert.match(first, /Page 1 of 3/);
  assert.match(first, /Players <span class="modal-count">600</); assert.match(first, /The 23 players met most are listed\./);
  // A short last page keeps the table's height, and a page past the end is the last.
  const last = playersTable({ data: { opponents: many }, sort: 'kills', page: 9, now });
  assert.match(last, /Page 3 of 3/); assert.equal(last.match(/class="pager-filler"/g).length, 7);
  assert.equal(playersTable({ data: { opponents: [] }, now }), '');
  const events = eventsTable({ data: { ...data, page: 2, pages: 3, perPage: 4, total: 12 }, now });
  assert.match(events, /data-pvp-page="1"/); assert.match(events, /data-pvp-page="3"/); assert.match(events, /Page 2 of 3/);
  assert.equal(eventsTable({ data: { total: 0, events: [] }, now }), '');
});
test('without PvP stats or events the dialog says why, and the account card says what is read', async () => {
  const { pvpBody, pvpCard } = await import('../src/pvp.js');
  assert.match(pvpBody({ data: { enabled: false }, name: 'Hero', own: true, now }), /PvP stats are off for your account\. Turn them on under Account & data/);
  const theirs = pvpBody({ data: { enabled: false }, name: 'Sc<out', own: false, now });
  assert.match(theirs, /The player of Sc&lt;out has not turned on PvP stats\./); assert.doesNotMatch(theirs, /history-table/);
  const empty = pvpBody({ data: { enabled: true, days: 30, keepDays: 90, totals: { kills: 0, assists: 0, deaths: 0 }, allTime: { kills: 0, assists: 0, deaths: 0 }, opponents: [], allies: [], events: [], total: 0 }, name: 'Hero', own: true, now });
  assert.match(empty, /No PvP kill, assist or death in the last 30 days\./); assert.match(empty, /<strong>0\.00<\/strong>/); assert.match(empty, /data-pvp-days="30" aria-pressed="true"/);
  assert.doesNotMatch(empty, /pvp-events/); assert.doesNotMatch(empty, /history-table/);
  const off = pvpCard(false, 90), on = pvpCard(true, 1);
  assert.match(off, /id="pvp-form"/); assert.match(off, /name="pvpStats" >/); assert.match(off, /never damage numbers, HP or skills/); assert.match(off, /Events are kept for 90 days, and turning this off deletes them at once\./);
  assert.match(on, /name="pvpStats" checked>/); assert.match(on, /Events are kept for 1 day,/);
});
test('the PvP texts read in Czech', async () => {
  const { useLanguage } = await import('../src/i18n.js'), { pvpBody } = await import('../src/pvp.js'), { pvpButton } = await import('../src/pvpline.js');
  try {
    await useLanguage('cs');
    const body = pvpBody({ data, name: 'Hero', own: true, now });
    assert.match(body, /<span>Zabití<\/span>/); assert.match(body, /Smrt od hráče <strong>Vexa<\/strong>/); assert.match(body, /Asistence hráči <strong>Kael<\/strong> při zabití hráče <strong>Nyra<\/strong>/);
    assert.match(pvpButton({ id: 'c1', characterName: 'Hero', pvp: { kills: 2, assists: 0, deaths: 5 } }), />2 zabití<.*>5 smrtí</);
  } finally { await useLanguage('en'); }
});
