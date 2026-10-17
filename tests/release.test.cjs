const { test } = require('node:test');
const assert = require('node:assert/strict');

test('the Windows app links name the newest release and fall back to the latest-release page', async () => {
  const { windowsApp, packageSize } = await import('../src/release.js');
  const { behind } = await import('../src/release.js');
  assert.deepEqual([['0.15.0', '0.16.0'], ['0.16.0', '0.16.0'], ['0.16.1', '0.16.0'], ['0.9.0', '0.10.0'], ['0.6.0.18', '0.7.0'], ['', '0.16.0'], ['0.16.0', '']].map(([v, l]) => behind(v, l)), [true, false, false, true, true, false, false]);
  const info = { repository: 'oldbear24/odyle-windows', releasesUrl: 'https://github.com/oldbear24/odyle-windows/releases/latest', latest: { version: '0.5.0.2', tag: 'v0.5.0.2', url: 'https://github.com/oldbear24/odyle-windows/releases/tag/v0.5.0.2', publishedAt: '2026-10-13T22:34:09Z', packages: {
    small: { name: 'odyle-0.5.0.2-win-x64.zip', size: 217557, url: 'https://github.com/oldbear24/odyle-windows/releases/download/v0.5.0.2/odyle-0.5.0.2-win-x64.zip' },
    selfContained: { name: 'odyle-0.5.0.2-win-x64-self-contained.zip', size: 71595826, url: 'https://github.com/oldbear24/odyle-windows/releases/download/v0.5.0.2/odyle-0.5.0.2-win-x64-self-contained.zip' },
    installer: { name: 'odyle-0.5.0.2-win-x64-setup.exe', size: 52428800, url: 'https://github.com/oldbear24/odyle-windows/releases/download/v0.5.0.2/odyle-0.5.0.2-win-x64-setup.exe' },
    arm64: { small: { name: 'odyle-0.5.0.2-win-arm64.zip', size: 210000, url: 'https://github.com/oldbear24/odyle-windows/releases/download/v0.5.0.2/odyle-0.5.0.2-win-arm64.zip' } } } } };
  const app = windowsApp(info);
  assert.equal(app.version, '0.5.0.2');
  assert.equal(app.url, 'https://github.com/oldbear24/odyle-windows/releases/tag/v0.5.0.2');
  assert.deepEqual(app.packages.map(p => [p.kind, p.label, p.url]), [
    ['installer', 'Installer for Windows x64 · 50 MB', info.latest.packages.installer.url],
    ['small', 'Download for Windows x64 · 212 KB', info.latest.packages.small.url],
    ['self-contained', 'Self-contained package · 68 MB', info.latest.packages.selfContained.url],
    ['arm64-small', 'Windows on ARM · 205 KB', info.latest.packages.arm64.small.url]]);
  // Unknown release (backend unreachable or GitHub down): the stable page link, no packages.
  for (const unknown of [null, undefined, {}, { repository: 'oldbear24/odyle-windows', latest: null }, { latest: { version: 'nightly' } }])
    assert.deepEqual(windowsApp(unknown), { version: '', url: 'https://github.com/oldbear24/odyle-windows/releases/latest', publishedAt: '', packages: [] });
  // Only GitHub links are rendered.
  const elsewhere = windowsApp({ ...info, latest: { ...info.latest, url: 'https://mirror.example/release', packages: { small: { ...info.latest.packages.small, url: 'http://mirror.example/odyle.zip' } } } });
  assert.equal(elsewhere.url, 'https://github.com/oldbear24/odyle-windows/releases/latest');
  assert.equal(elsewhere.packages[0].url, 'https://github.com/oldbear24/odyle-windows/releases/latest');
  assert.equal(packageSize(500), '1 KB'); assert.equal(packageSize(1048576), '1 MB');
});
