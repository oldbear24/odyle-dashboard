const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
// The privacy notice in the app (#39): src/privacy.js renders docs/privacy.md.
const notice = readFileSync(join(__dirname, '..', 'docs', 'privacy.md'), 'utf8');

test('the notice renders as text with code, bold and safe links', async () => {
  const { inline, noticeHtml, noticeHref } = await import('../src/privacy.js');
  assert.equal(inline('Keys like `odyle.**x**` and **bold** <b>'), 'Keys like <code>odyle.**x**</code> and <strong>bold</strong> &lt;b&gt;');
  assert.equal(inline('[the API](api.md#armory) and [a page](https://example.org/a?b=1&c=2)'),
    '<a href="https://github.com/oldbear24/odyle-dashboard/blob/main/docs/api.md#armory" target="_blank" rel="noopener">the API</a> and <a href="https://example.org/a?b=1&amp;c=2" target="_blank" rel="noopener">a page</a>');
  for (const bad of ['javascript:alert(1)', 'http://plain.example', '../../etc/passwd', 'data:text/html,x']) assert.equal(noticeHref(bad), '', bad);
  assert.equal(inline('[click](javascript:alert(1))'), 'click)');
  assert.equal(noticeHtml('# Title\n\nOne\nline.\n\n## Part\n\n- a\n- `b`'), '<p>One line.</p><h2>Part</h2><ul><li>a</li><li><code>b</code></li></ul>');
  const page = noticeHtml(notice);
  assert.ok(page.length > 10000 && !/<script|onerror|javascript:/i.test(page));
});

test('the notice names every key the dashboard keeps in the browser', () => {
  const src = join(__dirname, '..', 'src'), used = new Set();
  for (const name of readdirSync(src).filter(n => n.endsWith('.js')))
    for (const m of readFileSync(join(src, name), 'utf8').matchAll(/'(odyle\.[a-zA-Z.]+)'/g)) used.add(m[1]);
  // Realtime topics and the storage probe are not stored.
  const stored = [...used].filter(key => !/^odyle\.(room|user|presence|admin)\.?$/.test(key) && !key.endsWith('.') && key !== 'odyle.probe');
  assert.ok(stored.length >= 10, stored.join());
  for (const key of stored) assert.ok(notice.includes('`' + key + '`'), key + ' is missing from docs/privacy.md');
});
