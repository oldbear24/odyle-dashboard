const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
// What's new (#74): CHANGELOG.md read by src/changelog.js, the version rule, the release notes
// and the page (src/whatsnew.js).
const sample = `# Changelog\n\nIntro text.\n\n## 0.10.0 · 2026-10-16\n\n### New\n- **Bold** first\n  continued here\n- Second with \`code\`\n\n### Fixed\n- A fix\n\n## 0.9.0\n\n### Odd\n- x\n\n## 0.8.0 · 2026-10-15\n\n### New\n`;

test('the changelog parses into versions, groups and entries, newest first', async () => {
  const { parseChangelog, entryOf } = await import('../src/changelog.js');
  const entries = parseChangelog(sample.replace(/\n/g, '\r\n'));
  assert.deepEqual(entries.map(e => [e.version, e.date]), [['0.10.0', '2026-10-16'], ['0.9.0', ''], ['0.8.0', '2026-10-15']]);
  assert.deepEqual(entryOf(entries, '0.10.0').groups, [{ title: 'New', items: ['**Bold** first continued here', 'Second with `code`'] }, { title: 'Fixed', items: ['A fix'] }]);
  assert.deepEqual(entryOf(entries, '0.8.0').groups, [], 'empty groups are left out');
  assert.equal(entryOf(entries, '1.0.0'), null);
});

test('a new version must describe what it changed, and the repository\'s changelog does', async () => {
  const { changelogProblem, parseChangelog } = await import('../src/changelog.js');
  assert.equal(changelogProblem(sample, '0.10.0'), '');
  assert.match(changelogProblem(sample, '0.11.0'), /^CHANGELOG\.md has no section for 0\.11\.0\./);
  assert.match(changelogProblem(sample, '0.8.0'), /lists nothing/);
  assert.match(changelogProblem(sample, '0.9.0'), /has a group "Odd"; use New, Changed or Fixed\./);
  const text = readFileSync('CHANGELOG.md', 'utf8'), version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  assert.equal(changelogProblem(text, version), '', 'CHANGELOG.md describes package.json\'s version');
  const versions = parseChangelog(text).map(e => e.version);
  assert.deepEqual(versions, [...versions].sort((a, b) => b.localeCompare(a, 'en', { numeric: true })), 'newest first');
});

test('release notes carry the entries between markers the backend reads back', async () => {
  const { parseChangelog, entryOf, releaseNotes } = await import('../src/changelog.js');
  assert.equal(releaseNotes(entryOf(parseChangelog(sample), '0.10.0')), '<!-- changes -->\n### New\n- **Bold** first continued here\n- Second with `code`\n\n### Fixed\n- A fix\n\n<!-- /changes -->');
});

test('What\'s new lists the versions, this one marked, and the newest Windows app release', async () => {
  const { parseChangelog } = await import('../src/changelog.js'), { whatsNew, updated, updatedNote, inline } = await import('../src/whatsnew.js'), { useLanguage } = await import('../src/i18n.js');
  await useLanguage('en');
  assert.equal(inline('**A** <b> `x`'), '<strong>A</strong> &lt;b&gt; <code>x</code>');
  const page = whatsNew(parseChangelog(sample), '0.10.0', { version: '0.9.0', publishedAt: '2026-10-16T20:21:26Z', url: 'https://github.com/oldbear24/odyle-windows/releases/tag/v0.9.0', changes: [{ title: 'Fixed', items: ['Updates **work** again.'] }] });
  assert.match(page, /<section class="changelog-entry is-current"><div class="changelog-head"><h3 class="changelog-version">0\.10\.0 <span class="changelog-badge">this version<\/span><\/h3><span>16 Oct 2026<\/span>/);
  assert.match(page, /<h3>New<\/h3><ul><li><strong>Bold<\/strong> first continued here<\/li><li>Second with <code>code<\/code><\/li><\/ul>/);
  assert.match(page, /Windows app 0\.9\.0<\/h3><span>16 Oct 2026<\/span><\/div><h3>Fixed<\/h3><ul><li>Updates <strong>work<\/strong> again\.<\/li><\/ul>/);
  assert.match(whatsNew([], '0.10.0', { version: '0.8.0', publishedAt: '', url: 'https://github.com/x', changes: [] }), /This release lists its changes on GitHub\./);
  assert.doesNotMatch(whatsNew([], '0.10.0', null), /Windows app/);
  // The note after an update: a version seen before that is not this one.
  assert.deepEqual([updated('0.9.0', '0.10.0'), updated('earlier', '0.10.0'), updated('0.10.0', '0.10.0'), updated(null, '0.10.0')], [true, true, false, false]);
  assert.match(updatedNote('0.10.0'), /Updated to 0\.10\.0\. <a href="#\/changelog">What's new<\/a>/);
});
