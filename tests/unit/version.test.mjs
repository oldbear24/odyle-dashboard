import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// scripts/version.mjs gates every pull request and release, so it is run here as it runs in CI:
// in a small git repository of its own, with the files, tags and versions of each case.
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const changelog = version => `# Changelog\n\n## ${version} · 2026-11-01\n\n### Fixed\n- Something works again.\n`;
const made = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});
const manifest = (version, extra = {}) =>
  JSON.stringify(
    {
      name: 'x',
      version,
      type: 'module',
      scripts: { build: 'vite build', test: 'node --test a', lint: 'eslint .' },
      dependencies: { pocketbase: '^0.29.0' },
      devDependencies: { vite: '^8.0.0', playwright: '1.0.0' },
      ...extra,
    },
    null,
    2,
  );

// A repository whose first commit is the base (version 0.1.0, described and released unless
// tags say otherwise) and a branch off it.
function repo({ version = '0.1.0', tags = ['v' + version] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'odyle-version-'));
  made.push(dir);
  const git = (...args) =>
    execFileSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', ...args],
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
  const write = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  git('init', '-q', '-b', 'main');
  mkdirSync(join(dir, 'scripts'));
  mkdirSync(join(dir, 'src'));
  copyFileSync(join(root, 'scripts', 'version.mjs'), join(dir, 'scripts', 'version.mjs'));
  copyFileSync(join(root, 'src', 'changelog.js'), join(dir, 'src', 'changelog.js'));
  write('package.json', manifest(version));
  write('CHANGELOG.md', changelog(version));
  write('src/main.js', 'export {};\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  for (const tag of tags) git('tag', tag);
  git('checkout', '-q', '-b', 'work');
  const run = (...args) => {
    const done = spawnSync(process.execPath, ['scripts/version.mjs', ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: '' },
    });
    return { status: done.status, out: done.stdout, err: done.stderr };
  };
  const commit = (files = {}) => {
    for (const [path, text] of Object.entries(files)) write(path, text);
    git('add', '-A');
    git('commit', '-q', '-m', 'change');
  };
  return { dir, git, write, run, commit, base, check: () => run('check', base), release: () => run('release') };
}

test('a change that ships needs a higher version, described in the changelog', () => {
  const r = repo();
  r.commit({ 'src/main.js': 'export const a = 1;\n' });
  const unchanged = r.check();
  assert.equal(unchanged.status, 1);
  assert.match(
    unchanged.err,
    /::error::1 shipped file\(s\) changed \(src\/main\.js\) but the version is still 0\.1\.0/,
  );
  // Bumped, but nothing tells players.
  r.commit({ 'package.json': manifest('0.2.0') });
  const noNotes = r.check();
  assert.equal(noNotes.status, 1);
  assert.match(noNotes.err, /CHANGELOG\.md has no section for 0\.2\.0/);
  r.commit({ 'CHANGELOG.md': changelog('0.2.0') + '\n' + changelog('0.1.0').split('\n').slice(2).join('\n') });
  const ok = r.check();
  assert.equal(ok.status, 0, ok.err);
  assert.match(ok.out, /Version 0\.1\.0 → 0\.2\.0 for 1 shipped file\(s\)/);
});

test("a version lower than the base's, or one that is not MAJOR.MINOR.PATCH, fails", () => {
  const r = repo({ version: '0.5.0' });
  r.commit({
    'src/main.js': 'export const a = 1;\n',
    'package.json': manifest('0.4.9'),
    'CHANGELOG.md': changelog('0.4.9'),
  });
  assert.equal(r.check().status, 1);
  r.commit({ 'package.json': manifest('1.2') });
  const odd = r.check();
  assert.equal(odd.status, 1);
  assert.match(odd.err, /"1\.2" must be MAJOR\.MINOR\.PATCH/);
});

test('documentation, tests, CI, scripts and lint settings ship nothing', () => {
  const r = repo();
  r.commit({
    'docs/api.md': 'x',
    'README.md': 'x',
    'tests/unit/a.test.mjs': 'x',
    'tests/ui.test.mjs': 'x',
    '.github/workflows/checks.yml': 'x',
    'scripts/other.mjs': 'x',
    'backend/odyle/accounts_test.go': 'x',
    'backend/odyle/testing.go': 'x',
    'backend/odyle/push_testing.go': 'x',
    'eslint.config.js': 'x',
    'compose.yaml': 'x',
    '.gitignore': 'x',
    'LICENSE.md': 'x',
    '.vscode/settings.json': 'x',
    '.env.example': 'x',
  });
  const done = r.check();
  assert.equal(done.status, 0, done.err);
  assert.match(done.out, /Nothing that ships changed; the version stays 0\.1\.0\./);
  // The docs the dashboard shows, and the rest of the backend, do ship.
  for (const file of [
    'docs/privacy.md',
    'backend/odyle/accounts.go',
    'backend/odyle/testing.go.bak',
    'public/sw.js',
    'index.html',
  ]) {
    const s = repo();
    s.commit({ [file]: 'x' });
    assert.equal(s.check().status, 1, file);
  }
});

test("package.json ships only through the runtime dependencies, the build tool and the build's scripts", () => {
  const nothing = { 'package.json': manifest('0.1.1') };
  const cases = [
    ['only the version', nothing, 0],
    [
      'a test tool',
      { 'package.json': manifest('0.1.0', { devDependencies: { vite: '^8.0.0', playwright: '2.0.0' } }) },
      0,
    ],
    [
      'the test script',
      {
        'package.json': manifest('0.1.0', {
          scripts: {
            build: 'vite build',
            test: 'node --test "tests/unit/*.test.mjs"',
            'test:ui': 'x',
            lint: 'eslint . --max-warnings 0',
          },
        }),
      },
      0,
    ],
    ['a runtime dependency', { 'package.json': manifest('0.1.0', { dependencies: { pocketbase: '^0.30.0' } }) }, 1],
    [
      'the build tool',
      { 'package.json': manifest('0.1.0', { devDependencies: { vite: '^9.0.0', playwright: '1.0.0' } }) },
      1,
    ],
    [
      'the build script',
      {
        'package.json': manifest('0.1.0', {
          scripts: { build: 'vite build --mode x', test: 'node --test a', lint: 'eslint .' },
        }),
      },
      1,
    ],
  ];
  for (const [name, files, status] of cases) {
    const r = repo();
    r.commit(files);
    assert.equal(r.check().status, status, name);
  }
});

test('a version main never released may stay for the change to go out with it, a released one may not', () => {
  const free = repo({ tags: [] });
  free.commit({ 'src/main.js': 'export const a = 1;\n' });
  const pending = free.check();
  assert.equal(pending.status, 0, pending.err);
  assert.match(pending.out, /Version 0\.1\.0 is not released yet; 1 shipped file\(s\) go out with it/);
  const released = repo();
  released.commit({ 'src/main.js': 'export const a = 1;\n' });
  assert.equal(released.check().status, 1);
});

test('a release is made for shipped changes under a new version above every earlier release', () => {
  const first = repo({ tags: [] });
  assert.match(first.release().out, /^version=0\.1\.0\nrelease=true\n$/, 'with no release yet');
  // Nothing that ships since the latest release.
  const quiet = repo({ tags: ['v0.1.0'] });
  quiet.commit({ 'docs/a.md': 'x', 'tests/a.mjs': 'x' });
  const none = quiet.release();
  assert.equal(none.status, 0);
  assert.match(none.out, /Nothing that ships changed since v0\.1\.0: no release\./);
  assert.match(none.out, /release=false/);
  // Shipped code under the version already released.
  const same = repo({ tags: ['v0.1.0'] });
  same.commit({ 'src/main.js': 'export const a = 1;\n' });
  const stale = same.release();
  assert.equal(stale.status, 1);
  assert.match(
    stale.err,
    /v0\.1\.0 is already released and 1 shipped file\(s\) changed since the latest release v0\.1\.0 \(src\/main\.js\)/,
  );
  // A new version.
  same.commit({ 'package.json': manifest('0.1.1'), 'CHANGELOG.md': changelog('0.1.1') });
  const fresh = same.release();
  assert.equal(fresh.status, 0, fresh.err);
  assert.match(fresh.out, /^version=0\.1\.1\nrelease=true\n$/);
  // A version that is new but not above the latest release (an older branch).
  const behind = repo({ tags: ['v0.9.0', 'v0.10.0'] });
  behind.commit({ 'src/main.js': 'export const a = 1;\n', 'package.json': manifest('0.9.5') });
  const old = behind.release();
  assert.equal(old.status, 1);
  assert.match(old.err, /0\.9\.5 is not above the latest release v0\.10\.0/, 'versions are compared as numbers');
});

test('releases tagged before semantic versions (0.5.0.24) count as 0.5.0 and the run number', () => {
  const early = repo({ version: '0.5.0', tags: ['v0.5.0.3', 'v0.5.0.24', 'v0.5.0.9'] });
  early.commit({ 'src/main.js': 'export const a = 1;\n' });
  const same = early.release();
  assert.equal(same.status, 1);
  assert.match(same.err, /0\.5\.0 is not above the latest release v0\.5\.0\.24/);
  early.commit({ 'package.json': manifest('0.5.1') });
  assert.match(early.release().out, /version=0\.5\.1\nrelease=true/);
  assert.equal(readFileSync(join(early.dir, 'package.json'), 'utf8').includes('0.5.1'), true);
});

test('with no mode the script says how it is used', () => {
  const r = repo();
  const usage = r.run();
  assert.equal(usage.status, 1);
  assert.match(usage.err, /Usage: node scripts\/version\.mjs check \[base\] \| release/);
});
