// Semantic versions (AGENTS.md, Versioning): package.json's "version" is MAJOR.MINOR.PATCH,
// bumped once per change by what it changes, and a release is tagged with exactly it.
//
//   node scripts/version.mjs check [base]   a pull request or branch: when it changes what
//                                           ships, its version must be higher than base's
//                                           (default: where it left origin/main), and
//                                           CHANGELOG.md must describe it
//   node scripts/version.mjs release       the release workflow: writes version= and
//                                           release= to $GITHUB_OUTPUT. No release when
//                                           nothing that ships changed since the latest
//                                           release; a failure when shipped code changed
//                                           without a version above every earlier release
import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { changelogProblem } from '../src/changelog.js';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const lines = text => text.split('\n').filter(Boolean);
const semver = /^(\d+)\.(\d+)\.(\d+)$/;
// Earlier releases were tagged MAJOR.MINOR.PATCH.RUN; missing parts count as zero.
const parts = text => text.replace(/^v/, '').split('.').map(Number).concat([0, 0, 0, 0]).slice(0, 4);
const compare = (a, b) => { const x = parts(a), y = parts(b); for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
// What does not ship: documentation, tests, CI, local scripts and editor or lint settings.
const unshipped = /^(docs\/|tests\/|\.github\/|scripts\/|\.vscode\/)|\.md$|_test\.go$|^\.env[^/]*\.example$|^(LICENSE|\.gitignore|\.gitattributes|\.editorconfig|eslint\.config\.[cm]?js)$/;
// package.json and package-lock.json ship only through what the build uses: the runtime
// dependencies and the build tool (vite), with every package they pull in. A change limited to
// the test and lint tools (playwright, eslint, …), or to the version itself, ships nothing.
const buildTools = ['vite'];
const at = (ref, file) => { try { return JSON.parse(git('show', `${ref}:${file}`)); } catch { return null; } };
function manifestShipped(before, after) {
  const kept = m => m && { ...m, version: undefined, devDependencies: Object.fromEntries(Object.entries(m.devDependencies || {}).filter(([name]) => buildTools.includes(name))) };
  return JSON.stringify(kept(before)) !== JSON.stringify(kept(after));
}
// The lock entries the build uses: from the runtime dependencies and the build tools, following
// each package's dependencies to the nearest node_modules that holds them.
function buildPackages(manifest, lock) {
  const packages = lock?.packages || {}, seen = new Set();
  const resolve = (from, name) => {
    for (let place = from; ; ) {
      const key = (place ? place + '/' : '') + 'node_modules/' + name;
      if (packages[key]) return key;
      if (!place) return null;
      const up = place.lastIndexOf('/node_modules/'); place = up < 0 ? '' : place.slice(0, up);
    }
  };
  const visit = (from, name) => {
    const key = resolve(from, name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    for (const dep of Object.keys({ ...packages[key].dependencies, ...packages[key].optionalDependencies })) visit(key, dep);
  };
  for (const name of [...Object.keys(manifest?.dependencies || {}), ...buildTools]) visit('', name);
  return JSON.stringify([...seen].sort().map(key => [key, packages[key].version, packages[key].integrity]));
}
const packagesShipped = base => manifestShipped(at(base, 'package.json'), at('HEAD', 'package.json')) ||
  buildPackages(at(base, 'package.json'), at(base, 'package-lock.json')) !== buildPackages(at('HEAD', 'package.json'), at('HEAD', 'package-lock.json'));
const npmFiles = ['package.json', 'package-lock.json'];
const shipped = (files, base) => {
  const out = files.filter(f => !unshipped.test(f));
  return out.some(f => npmFiles.includes(f)) && !packagesShipped(base) ? out.filter(f => !npmFiles.includes(f)) : out;
};
const list = files => files.slice(0, 5).join(', ') + (files.length > 5 ? ', …' : '');
const fail = message => { console.error('::error::' + message); process.exit(1); };

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
if (!semver.test(version)) fail(`package.json's version "${version}" must be MAJOR.MINOR.PATCH (AGENTS.md, Versioning).`);
const [mode, baseRef] = process.argv.slice(2);

if (mode === 'check') {
  const base = baseRef || git('merge-base', 'HEAD', 'origin/main');
  const before = JSON.parse(git('show', `${base}:package.json`)).version;
  const changed = shipped(lines(git('diff', '--name-only', base, 'HEAD')), base);
  if (!changed.length) console.log(`Nothing that ships changed; the version stays ${version}.`);
  else if (compare(version, before) <= 0) fail(`${changed.length} shipped file(s) changed (${list(changed)}) but the version is still ${version}. Bump package.json's version by what changed: MAJOR for a breaking change, MINOR for a feature, PATCH for a fix (AGENTS.md, Versioning).`);
  else {
    // A new version says what it changed, for players (CHANGELOG.md).
    const problem = changelogProblem(readFileSync('CHANGELOG.md', 'utf8'), version);
    if (problem) fail(problem);
    console.log(`Version ${before} → ${version} for ${changed.length} shipped file(s), described in CHANGELOG.md.`);
  }
} else if (mode === 'release') {
  const tags = lines(git('tag', '--list', 'v*')).filter(t => /^v\d+(\.\d+){1,3}$/.test(t)).sort(compare), latest = tags.at(-1);
  const changed = latest ? shipped(lines(git('diff', '--name-only', latest, 'HEAD')), latest) : ['(no release yet)'];
  let release = true;
  if (!changed.length) {
    console.log(`Nothing that ships changed since ${latest}: no release.`);
    release = false;
  } else if (tags.includes('v' + version)) fail(`v${version} is already released and ${changed.length} shipped file(s) changed since the latest release ${latest} (${list(changed)}). Bump package.json's version (AGENTS.md, Versioning).`);
  else if (latest && compare(version, latest) <= 0) fail(`${version} is not above the latest release ${latest}; installed apps would not take it as newer.`);
  const out = `version=${version}\nrelease=${release}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, out); else process.stdout.write(out);
} else fail('Usage: node scripts/version.mjs check [base] | release');
