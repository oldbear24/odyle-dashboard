const { test } = require('node:test');
const assert = require('node:assert/strict');
// The information board (src/board.js) and room features (src/roomfeatures.js).
const now = Date.parse('2026-10-22T12:00:00Z');
test('the board escapes its text and links only web addresses', async () => {
  const { linked } = await import('../src/board.js');
  assert.equal(linked('<b>Raid</b> & "fun"'), '&lt;b&gt;Raid&lt;/b&gt; &amp; &quot;fun&quot;');
  assert.equal(linked('Discord: https://discord.gg/abc.'), 'Discord: <a href="https://discord.gg/abc" target="_blank" rel="noopener noreferrer">https://discord.gg/abc</a>.');
  // Quotes, brackets and markup end an address; a bracket the address opened stays in it.
  assert.equal(linked('"https://x.example/?a=1&b=2"'), '&quot;<a href="https://x.example/?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">https://x.example/?a=1&amp;b=2</a>&quot;');
  assert.equal(linked('(see https://x.example/a)'), '(see <a href="https://x.example/a" target="_blank" rel="noopener noreferrer">https://x.example/a</a>)');
  assert.match(linked('https://en.example/wiki/Foo_(bar)'), /href="https:\/\/en\.example\/wiki\/Foo_\(bar\)"/);
  assert.equal(linked('https://x.example/<img src=x onerror=alert(1)>'), '<a href="https://x.example/" target="_blank" rel="noopener noreferrer">https://x.example/</a>&lt;img src=x onerror=alert(1)&gt;');
  // Only http and https, and only with a host.
  assert.equal(linked('javascript:alert(1) data:text/html,x https:// ftp://x.example'), 'javascript:alert(1) data:text/html,x https:// ftp://x.example');
  assert.equal(linked('Line one\nhttps://a.example\nLine three'), 'Line one\n<a href="https://a.example" target="_blank" rel="noopener noreferrer">https://a.example</a>\nLine three');
});
test('members read the board; the owner and officers edit it, and only they see it empty', async () => {
  const { boardSection, boardForm } = await import('../src/board.js');
  const board = { text: 'Raid at 20:00', by: 'u1', at: new Date(now - 7200000).toISOString() }, name = id => id === 'u1' ? 'Lumina' : '';
  const read = boardSection(board, { name, now });
  assert.match(read, /Raid at 20:00/); assert.match(read, /Last edit: Lumina/); assert.match(read, /data-age=/); assert.doesNotMatch(read, /edit-board/);
  assert.match(boardSection(board, { canEdit: true, name, now }), /data-action="edit-board"/);
  // A writer who left the room is not named.
  assert.doesNotMatch(boardSection({ ...board, by: 'gone' }, { name, now }), /Last edit/);
  assert.equal(boardSection(null, { now }), '');
  assert.equal(boardSection({ text: '' }, { now }), '');
  assert.match(boardSection(null, { canEdit: true, now }), /board-card empty[\s\S]*data-action="edit-board"/);
  // The form keeps the text and offers Clear only when there is one.
  assert.match(boardForm(board), /<textarea[^>]*maxlength="2000">Raid at 20:00<\/textarea>/);
  assert.match(boardForm({ text: '</textarea><script>' }), /&lt;\/textarea&gt;&lt;script&gt;<\/textarea>/);
  assert.match(boardForm(board), /clear-board/); assert.doesNotMatch(boardForm(null), /clear-board/);
});
test('room features are on unless the room turned them off, and the form sends what changed', async () => {
  const { featureOn, featuresForm, changedFeatures } = await import('../src/roomfeatures.js');
  const room = { features: { board: true, runs: false, wishlist: true, week: true } };
  assert.equal(featureOn(room, 'runs'), false); assert.equal(featureOn(room, 'board'), true);
  assert.equal(featureOn({}, 'runs'), true, 'a server without features has them all on');
  assert.equal(featureOn(null, 'wishlist'), true);
  const form = featuresForm(room);
  assert.match(form, /name="board" checked/); assert.match(form, /name="runs" >/);
  const checked = new Set(['board', 'runs', 'week']);
  const fake = { querySelector: selector => ({ checked: checked.has(selector.match(/name="(\w+)"/)[1]) }) };
  assert.deepEqual(changedFeatures(fake, room), { runs: true, wishlist: false });
  checked.add('wishlist'); checked.delete('runs');
  assert.deepEqual(changedFeatures(fake, room), {});
});
