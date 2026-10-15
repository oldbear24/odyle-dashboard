// The newest release of the Windows companion, so the dashboard can offer its
// download with the version. The backend asks GitHub's API at most every ten
// minutes and serves that answer to every browser: visitors never contact GitHub
// and the unauthenticated API limit is never reached. When GitHub cannot be
// reached the last known release is kept, and without one the dashboard still
// gets the stable "latest release" page link.
const repository = () => $os.getenv('ODYLE_WINDOWS_REPOSITORY') || 'oldbear24/odyle-windows';
const feedUrl = () => $os.getenv('ODYLE_WINDOWS_RELEASE_URL') || 'https://api.github.com/repos/' + repository() + '/releases/latest';
const key = 'odyle.windowsRelease', fresh = 600000, retry = 60000;
// Package names from the release workflow: odyle-<version>-<runtime>[-self-contained].zip
// and the per-user installer odyle-<version>-win-x64-setup.exe.
const packageName = /^odyle-(\d+(?:\.\d+){1,3})-(win-x64|win-arm64)(-self-contained)?\.zip$/, installerName = /^odyle-(\d+(?:\.\d+){1,3})-win-x64-setup\.exe$/;
const github = url => typeof url === 'string' && url.startsWith('https://github.com/');

function fetchLatest() {
  const res = $http.send({ url: feedUrl(), method: 'GET', headers: { accept: 'application/vnd.github+json', 'user-agent': 'Odyle (AION 2 party dashboard)' }, timeout: 10 });
  if (res.statusCode !== 200) throw new Error('GitHub answered ' + res.statusCode + '.');
  const data = res.json || {}, version = String(data.tag_name || '').replace(/^v/, '');
  if (!/^\d+(\.\d+){1,3}$/.test(version) || data.draft || data.prerelease) throw new Error('The latest release is not a versioned release.');
  // x64 packages stay under small/selfContained for older dashboards; ARM64 ones sit under arm64.
  // Checksums stay with the Windows app, which verifies its own downloads.
  const packages = {};
  for (const asset of Array.isArray(data.assets) ? data.assets : []) {
    const name = String(asset.name || ''), match = packageName.exec(name), file = { name, size: Number(asset.size) || 0, url: asset.browser_download_url };
    if (!github(asset.browser_download_url)) continue;
    if (installerName.test(name)) packages.installer = file;
    else if (match && match[2] === 'win-x64') packages[match[3] ? 'selfContained' : 'small'] = file;
    else if (match) (packages.arm64 ||= {})[match[3] ? 'selfContained' : 'small'] = file;
  }
  return { version, tag: String(data.tag_name), url: github(data.html_url) ? data.html_url : 'https://github.com/' + repository() + '/releases/latest', publishedAt: String(data.published_at || ''), packages };
}
// The cache also keeps when GitHub last answered and why the last lookup failed, for
// the superuser dashboard's Server status page.
const cache = () => $app.store().has(key) ? JSON.parse($app.store().get(key)) : null;
function latest() {
  const cached = cache(), now = Date.now();
  if (cached && now - cached.at < (cached.release ? fresh : retry)) return cached.release;
  let release = cached ? cached.release : null, fetchedAt = cached ? cached.fetchedAt || 0 : 0, error = '';
  try { release = fetchLatest(); fetchedAt = now; } catch (failure) { error = String(failure.message || failure); console.log('Odyle release lookup failed: ' + error); }
  $app.store().set(key, JSON.stringify({ at: now, release, fetchedAt, error }));
  return release;
}
function lookup() {
  latest();
  const cached = cache(), iso = at => at ? new Date(at).toISOString() : '';
  return { repository: repository(), checkedAt: iso(cached && cached.at), fetchedAt: iso(cached && cached.fetchedAt), error: cached ? cached.error || '' : '', version: cached && cached.release ? cached.release.version : '', publishedAt: cached && cached.release ? cached.release.publishedAt : '' };
}
function windowsRelease(e) {
  return e.json(200, { repository: repository(), releasesUrl: 'https://github.com/' + repository() + '/releases/latest', latest: latest() });
}
module.exports = { windowsRelease, latest, lookup, fetchLatest };
