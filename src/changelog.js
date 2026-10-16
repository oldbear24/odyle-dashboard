// The changelog (CHANGELOG.md, #74): one section per version, "## 0.10.0 · 2026-10-16", with
// groups "### New", "### Changed" and "### Fixed" of "- " entries written for players. The
// dashboard's What's new page, the release notes and the version check read it through here;
// nothing here imports, so the scripts can use it in Node.
const heading = /^## (\d+\.\d+\.\d+)(?:\s*·\s*(\d{4}-\d{2}-\d{2}))?\s*$/;
export const groupTitles = ['New', 'Changed', 'Fixed'];

// The versions, newest first as written: [{ version, date, groups: [{ title, items }] }].
export function parseChangelog(text) {
  const out = []; let entry = null, group = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trimEnd(), version = line.match(heading);
    if (version) { entry = { version: version[1], date: version[2] || '', groups: [] }; group = null; out.push(entry); continue; }
    if (!entry) continue;
    const title = line.match(/^### (.+)$/);
    if (title) { group = { title: title[1].trim(), items: [] }; entry.groups.push(group); continue; }
    const item = line.match(/^- (.+)$/);
    if (item && group) group.items.push(item[1].trim());
    else if (/^\s+\S/.test(line) && group?.items.length) group.items[group.items.length - 1] += ' ' + line.trim();
  }
  for (const e of out) e.groups = e.groups.filter(g => g.items.length);
  return out;
}
export const entryOf = (entries, version) => entries.find(e => e.version === version) || null;

// Why the changelog does not describe a version yet, or '' when it does: its section must
// exist, hold at least one entry, and use only New, Changed and Fixed.
export function changelogProblem(text, version) {
  const entry = entryOf(parseChangelog(text), version);
  if (!entry) return `CHANGELOG.md has no section for ${version}. Add "## ${version} · <date>" with what changed, for players (AGENTS.md, Versioning).`;
  if (!entry.groups.length) return `CHANGELOG.md's section for ${version} lists nothing. Add "### New", "### Changed" or "### Fixed" with "- " entries.`;
  const odd = entry.groups.find(g => !groupTitles.includes(g.title));
  return odd ? `CHANGELOG.md's section for ${version} has a group "${odd.title}"; use New, Changed or Fixed.` : '';
}

// A version's entries as release notes, between markers the backend reads them back from
// (the Windows app's releases, for What's new).
export function releaseNotes(entry) {
  return ['<!-- changes -->', ...entry.groups.flatMap(g => ['### ' + g.title, ...g.items.map(i => '- ' + i), '']), '<!-- /changes -->'].join('\n');
}
