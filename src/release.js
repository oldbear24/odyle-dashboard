// Download links for the Windows companion. The backend reports the newest GitHub
// release (`GET /api/odyle/windows-release`); while it is unknown, GitHub's stable
// "latest release" page is linked instead, so the dashboard always has a working link.
export const fallbackRepository = 'oldbear24/odyle-windows';
export const releasesPage = repository => `https://github.com/${repository}/releases/latest`;
export const packageSize = bytes => bytes >= 1048576 ? `${Math.round(bytes / 1048576)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
export function windowsApp(info) {
  const page = releasesPage(info?.repository || fallbackRepository), latest = info?.latest;
  // Only GitHub links are ever rendered; anything else falls back to the release page.
  const safe = url => typeof url === 'string' && url.startsWith('https://github.com/') ? url : page;
  if (!latest || !/^\d+(\.\d+){1,3}$/.test(String(latest.version || ''))) return { version: '', url: page, publishedAt: '', packages: [] };
  const packages = [], add = (file, kind, label) => { if (file?.url) packages.push({ kind, size: packageSize(file.size || 0), label: `${label} · ${packageSize(file.size || 0)}`, url: safe(file.url) }); };
  add(latest.packages?.installer, 'installer', 'Installer for Windows x64');
  add(latest.packages?.small, 'small', 'Download for Windows x64');
  add(latest.packages?.selfContained, 'self-contained', 'Self-contained package');
  add(latest.packages?.arm64?.small, 'arm64-small', 'Windows on ARM');
  add(latest.packages?.arm64?.selfContained, 'arm64-self-contained', 'Windows on ARM, self-contained');
  return { version: latest.version, url: safe(latest.url), publishedAt: latest.publishedAt || '', packages };
}
