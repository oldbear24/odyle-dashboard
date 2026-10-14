// The newest release of the Windows companion, so the dashboard can offer its
// download with the version. The backend asks GitHub's API at most every ten
// minutes and serves that answer to every browser: visitors never contact GitHub
// and the unauthenticated API limit is never reached. When GitHub cannot be
// reached the last known release is kept, and without one the dashboard still
// gets the stable "latest release" page link.
const repository = () => $os.getenv('ODYLE_WINDOWS_REPOSITORY') || 'oldbear24/odyle-windows';
const feedUrl = () => $os.getenv('ODYLE_WINDOWS_RELEASE_URL') || 'https://api.github.com/repos/' + repository() + '/releases/latest';
const key = 'odyle.windowsRelease', fresh = 600000, retry = 60000;
// Package names from the release workflow: odyle-<version>-<runtime>[-self-contained].zip.
const packageName = /^odyle-(\d+(?:\.\d+){1,3})-(win-x64|win-arm64)(-self-contained)?\.zip$/;
const github = url => typeof url === 'string' && url.startsWith('https://github.com/');

function fetchLatest() {
  const res = $http.send({ url: feedUrl(), method: 'GET', headers: { accept: 'application/vnd.github+json', 'user-agent': 'Odyle (AION 2 party dashboard)' }, timeout: 10 });
  if (res.statusCode !== 200) throw new Error('GitHub answered ' + res.statusCode + '.');
  const data = res.json || {}, version = String(data.tag_name || '').replace(/^v/, '');
  if (!/^\d+(\.\d+){1,3}$/.test(version) || data.draft || data.prerelease) throw new Error('The latest release is not a versioned release.');
  // Only the x64 packages are offered; checksums stay with the Windows app, which verifies them itself.
  const packages = {};
  for (const asset of Array.isArray(data.assets) ? data.assets : []) {
    const match = packageName.exec(String(asset.name || ''));
    if (match && match[2] === 'win-x64' && github(asset.browser_download_url)) packages[match[3] ? 'selfContained' : 'small'] = { name: asset.name, size: Number(asset.size) || 0, url: asset.browser_download_url };
  }
  return { version, tag: String(data.tag_name), url: github(data.html_url) ? data.html_url : 'https://github.com/' + repository() + '/releases/latest', publishedAt: String(data.published_at || ''), packages };
}
function latest() {
  const store = $app.store(), cached = store.has(key) ? JSON.parse(store.get(key)) : null, now = Date.now();
  if (cached && now - cached.at < (cached.release ? fresh : retry)) return cached.release;
  let release = cached ? cached.release : null;
  try { release = fetchLatest(); } catch (error) { console.log('Odyle release lookup failed: ' + error.message); }
  store.set(key, JSON.stringify({ at: now, release }));
  return release;
}
function windowsRelease(e) {
  return e.json(200, { repository: repository(), releasesUrl: 'https://github.com/' + repository() + '/releases/latest', latest: latest() });
}
module.exports = { windowsRelease, latest, fetchLatest };
