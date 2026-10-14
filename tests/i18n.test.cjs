const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const i18n = () => import('../src/i18n.js');
// Every text the dashboard passes to t() or tn() as a literal, and every literal
// message the backend answers with, must have a Czech entry.
const literal = "'((?:[^'\\\\]|\\\\.)*)'", unescape = text => text.replace(/\\'/g, "'");
function sources(directory, ending) { return readdirSync(directory).filter(name => name.endsWith(ending)).map(name => readFileSync(join(directory, name), 'utf8')); }
test('every dashboard text and backend message has a Czech translation', async () => {
  const { default: cs } = await import('../src/locales/cs.js'), missing = [];
  for (const source of sources('src', '.js')) {
    for (const m of source.matchAll(new RegExp(`\\bt\\(\\s*${literal}`, 'g'))) if (typeof cs[unescape(m[1])] !== 'string') missing.push(unescape(m[1]));
    for (const m of source.matchAll(new RegExp(`\\btn\\(\\s*[^,]+,\\s*${literal}\\s*,\\s*${literal}`, 'g'))) { const key = unescape(m[1]) + '|' + unescape(m[2]); if (!Array.isArray(cs[key]) || cs[key].length !== 3) missing.push(key); }
  }
  for (const source of sources('backend/pb_hooks/lib', '.cjs'))
    for (const m of source.matchAll(new RegExp(`(?:Error|BadRequestError|ForbiddenError|NotFoundError)\\(\\s*${literal}\\s*\\)`, 'g'))) if (typeof cs[unescape(m[1])] !== 'string') missing.push(unescape(m[1]));
  for (const day of ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) if (!cs[day]) missing.push(day);
  assert.deepEqual(missing, []);
  // Placeholders survive translation.
  const names = text => (text.match(/\{\w+\}/g) || []).sort().join();
  for (const [key, value] of Object.entries(cs)) for (const form of [].concat(value)) assert.equal(names(form).replace('{n},', ''), names(key.split('|').pop()).replace('{n},', ''), key);
});
test('the browser language is detected, chosen languages are kept and plurals follow Czech rules', async () => {
  const { detect, useLanguage, t, tn, locale } = await i18n();
  assert.equal(detect(null, ['cs-CZ', 'en']), 'cs'); assert.equal(detect(null, ['de-DE', 'en-US']), 'en'); assert.equal(detect(null, ['de']), 'en');
  assert.equal(detect('en', ['cs-CZ']), 'en'); assert.equal(detect('xx', ['cs']), 'cs');
  try {
    await useLanguage('cs'); assert.equal(locale(), 'cs-CZ');
    assert.equal(t('Welcome, {name}', { name: 'Lumina' }), 'Vítej, Lumina');
    assert.equal(t('Not a known text {x}', { x: 1 }), 'Not a known text 1');
    assert.deepEqual([1, 2, 4, 5, 0, 21].map(n => tn(n, '{n} member', '{n} members')), ['1 člen', '2 členové', '4 členové', '5 členů', '0 členů', '21 členů']);
    await useLanguage('en'); assert.deepEqual([1, 2].map(n => tn(n, '{n} member', '{n} members')), ['1 member', '2 members']);
    assert.equal(await useLanguage('xx'), 'en');
  } finally { await useLanguage('en'); }
});
