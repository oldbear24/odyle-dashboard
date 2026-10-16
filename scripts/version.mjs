// Semantic versions (CLAUDE.md, Versioning): package.json's "version" is MAJOR.MINOR.PATCH,
// bumped once per change by what it changes, and a release is tagged with exactly it.
//
//   node scripts/version.mjs check [base]   a pull request or branch: when it changes what
//                                           ships, its version must be higher than base's
//                                           (default: where it left origin/main)
//   node scripts/version.mjs release        the release workflow: prints version= and
//                                           release= (false when this version is out and
//                                           nothing that ships changed since) for
//                                           $GITHUB_OUTPUT; fails when shipped code changed
//                                           without a bump or the version is not above
//                                           every earlier release
import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const semver = /^(\d+)\.(\d+)\.(\d+)$/;
// Earlier releases were tagged MAJOR.MINOR.PATCH.RUN; missing parts count as zero.
const parts = text => text.replace(/^v/, '').split('.').map(Number).concat([0, 0, 0, 0]).slice(0, 4);
const compare = (a, b) => { const x = parts(a), y = parts(b); for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
// What does not ship: documentation, tests, CI, local scripts and editor or lint settings.
const unshipped = /^(docs\/|tests\/|\.github\/|scripts\/|\.vscode\/)|\.md$|_test\.go$|^\.env[^/]*\.example$|^(LICENSE|\.gitignore|\.gitattributes|\.editorconfig|eslint\.config\.[cm]?js)$/;
const shipped = files => files.filter(f => f && !unshipped.test(f));
const fail = message => { console.error('::error::' + message); process.exit(1); };

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
if (!semver.test(version)) fail(`package.json's version "${version}" must be MAJOR.MINOR.PATCH (CLAUDE.md, Versioning).`);
const [mode, baseRef] = process.argv.slice(2);

if (mode === 'check') {
  const base = baseRef || git('merge-base', 'HEAD', 'origin/main');
  const before = JSON.parse(git('show', `${base}:package.json`)).version;
  const changed = shipped(git('diff', '--name-only', base, 'HEAD').split('\n'));
  if (!changed.length) console.log(`Nothing that ships changed; the version stays ${version}.`);
  else if (compare(version, before) <= 0) fail(`${changed.length} shipped file(s) changed (${changed.slice(0, 5).join(', ')}${changed.length > 5 ? ', …' : ''}) but the version is still ${version}. Bump package.json's version by what changed: MAJOR for a breaking change, MINOR for a feature, PATCH for a fix (CLAUDE.md, Versioning; npm version <x.y.z> --no-git-tag-version).`);
  else console.log(`Version ${before} → ${version} for ${changed.length} shipped file(s).`);
} else if (mode === 'release') {
  const tags = git('tag', '--list', 'v*').split('\n').filter(t => /^v\d+(\.\d+){1,3}$/.test(t));
  let release = true;
  if (tags.includes('v' + version)) {
    const changed = shipped(git('diff', '--name-only', 'v' + version, 'HEAD').split('\n'));
    if (changed.length) fail(`v${version} is already released and ${changed.length} shipped file(s) changed since (${changed.slice(0, 5).join(', ')}). Bump package.json's version (CLAUDE.md, Versioning).`);
    console.log(`v${version} is already released and nothing that ships changed: no release.`);
    release = false;
  } else {
    const latest = tags.sort(compare).at(-1);
    if (latest && compare(version, latest) <= 0) fail(`${version} is not above the latest release ${latest}; installed apps would not take it as newer.`);
  }
  const out = `version=${version}\nrelease=${release}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, out); else process.stdout.write(out);
} else fail('Usage: node scripts/version.mjs check [base] | release');
