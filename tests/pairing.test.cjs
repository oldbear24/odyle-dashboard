const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const memory = () => { const data = {}; return { getItem: key => data[key] ?? null, setItem: (key, value) => { data[key] = String(value); }, removeItem: key => { delete data[key]; } }; };
const now = Date.parse('2026-10-15T12:00:00Z');
test('the pairing link is shown again until a minute before it expires, for its own account only', async () => {
  const { savedPairing, rememberPairing, forgetPairing } = await import('../src/pairing.js');
  const storage = memory(), pair = { code: 'ABCDEFGH23456789', expiresAt: '2026-10-15 12:05:00.000Z' };
  assert.equal(savedPairing(storage, 'u1', now), null);
  rememberPairing(storage, 'u1', { ...pair, extra: 'dropped' });
  assert.deepEqual(savedPairing(storage, 'u1', now), pair);
  assert.deepEqual(savedPairing(storage, 'u1', now + 239000), pair);
  // With a minute or less left, the dialog asks for a new link instead.
  assert.equal(savedPairing(storage, 'u1', now + 240000), null);
  assert.equal(savedPairing(storage, 'u2', now), null);
  forgetPairing(storage); assert.equal(savedPairing(storage, 'u1', now), null);
  // An expired code is dropped from the browser once it is read.
  rememberPairing(storage, 'u1', pair); assert.equal(savedPairing(storage, 'u2', now + 300000), null);
  assert.equal(storage.getItem('odyle.pairing'), null);
  // Broken or blocked storage never breaks the dialog.
  assert.equal(savedPairing({ getItem: () => '{not json' }, 'u1', now), null);
  assert.equal(savedPairing({ getItem: () => JSON.stringify({ user: 'u1', code: 5, expiresAt: pair.expiresAt }) }, 'u1', now), null);
  rememberPairing({ setItem: () => { throw new Error('quota'); } }, 'u1', pair);
  forgetPairing({ removeItem: () => { throw new Error('blocked'); } });
});
test('a link counts as used once a PC paired after it was made, and readers name their PC while online', async () => {
  const { pairedWith, readerList, onlineReader, countdown } = await import('../src/pairing.js');
  const pair = { code: 'ABCDEFGH23456789', expiresAt: '2026-10-15 12:05:00.000Z' };
  const old = { id: 'd1', name: 'OLD-PC', pairedAt: '2026-10-15 11:59:59.000Z' }, desk = { id: 'd2', name: 'DESK-PC', pairedAt: '2026-10-15 12:01:00.000Z' };
  assert.equal(pairedWith([old], pair), null); assert.equal(pairedWith(undefined, pair), null);
  assert.equal(pairedWith([old, desk], pair), desk);
  const account = { devices: [old, desk], apps: [
    { sessionId: 's1', device: 'd2', character: 'Lumina', lastContactAt: '2026-10-15 11:59:40.000Z' },
    { sessionId: 's2', device: 'd1', character: '', lastContactAt: '2026-10-15 11:59:50.000Z' },
    { sessionId: 's3', device: '', character: '', lastContactAt: '2026-10-15 11:58:00.000Z' }] };
  const readers = readerList(account);
  assert.deepEqual(readers.map(r => [r.sessionId, r.name, r.character]), [['s1', 'DESK-PC', 'Lumina'], ['s2', 'OLD-PC', ''], ['s3', '', '']]);
  // The latest contact within 45 seconds; none once every reader went quiet.
  assert.equal(onlineReader(readers, now).sessionId, 's2');
  assert.equal(onlineReader(readers, now + 30000).sessionId, 's2');
  assert.equal(onlineReader(readers, now + 40000), null);
  assert.deepEqual(readerList(null), []); assert.equal(onlineReader(undefined, now), null);
  assert.deepEqual([300000, 61000, 500, -5].map(countdown), ['5:00', '1:01', '0:01', '0:00']);
});
test('the pairing dialog shows the link, says why pairing is refused and confirms the PC it paired', async () => {
  const { pairingSlot } = await import('../src/pairing.js'), { useLanguage } = await import('../src/i18n.js');
  const link = 'https://odyle.example/#odyle-pair=ABCDEFGH23456789';
  const shown = pairingSlot({ step: 'link', link, left: 254000 });
  assert.match(shown, new RegExp(`class="link-field" readonly value="${link}"`)); assert.match(shown, new RegExp(`data-copy="${link}"`));
  assert.match(shown, /<strong data-pair-expires>4:14<\/strong>/); assert.match(shown, /data-action="new-pairing"/);
  // Open in Odyle hands the same link to the Windows app.
  assert.match(shown, new RegExp(`href="odyle://pair\\?link=${encodeURIComponent(link).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">`));
  assert.match(pairingSlot({ step: 'expired' }), /expired[\s\S]*data-action="new-pairing"/);
  const paused = pairingSlot({ step: 'refused', problem: 'Pairing new PCs is paused for now. Try again later.', paused: true });
  assert.match(paused, /role="alert">Pairing new PCs is paused/); assert.match(paused, /download and install the app now/);
  assert.doesNotMatch(pairingSlot({ step: 'refused', problem: 'Failed to fetch', paused: false }), /download and install/);
  assert.match(pairingSlot({ step: 'paired', pc: '<DESK>', character: 'Lumina' }), /Paired with &lt;DESK&gt;[\s\S]*Reading Lumina[\s\S]*data-action="close-dialog"/);
  assert.match(pairingSlot({ step: 'paired', pc: '', character: '' }), /Paired with Windows PC[\s\S]*Waiting for the game/);
  assert.match(pairingSlot({ step: 'online', pc: 'DESK-PC', character: '' }), /Reader online on DESK-PC[\s\S]*No character in game[\s\S]*data-action="pair-another"/);
  assert.match(pairingSlot({ step: 'loading' }), /Getting a connection link/);
  try {
    await useLanguage('cs');
    assert.match(pairingSlot({ step: 'paired', pc: 'DESK-PC', character: 'Lumina' }), /Spárováno s DESK-PC[\s\S]*Čte postavu Lumina/);
    assert.match(pairingSlot({ step: 'link', link, left: 59000 }), /Platí jednou a vyprší za <strong data-pair-expires>0:59<\/strong>\./);
  } finally { await useLanguage('en'); }
});
test('the scope notice is the agreed text in English and Czech', async () => {
  const { default: cs } = await import('../src/locales/cs.js');
  const english = "Odyle is an unofficial fan project, not affiliated with or endorsed by NCSOFT. The Windows reader only listens to your own game connection: it never reads game memory, changes or sends game traffic, automates play or collects combat data. NCSOFT's rules ban unauthorized programs, so use Odyle at your own risk.";
  assert.ok(readFileSync('src/main.js', 'utf8').includes(`t("${english}")`));
  assert.equal(cs[english], 'Odyle je neoficiální fanouškovský projekt, který není spojen se společností NCSOFT ani jí schválen. Čtečka pro Windows jen naslouchá spojení vaší vlastní hry: nikdy nečte paměť hry, nemění ani neposílá herní provoz, neautomatizuje hraní a nesbírá data o boji. Pravidla NCSOFT zakazují neautorizované programy, Odyle proto používáte na vlastní riziko.');
});
