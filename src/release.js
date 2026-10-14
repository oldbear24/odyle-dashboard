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
  const packages = [];
  if (latest.packages?.small?.url) packages.push({ kind: 'small', label: `Download for Windows x64 · ${packageSize(latest.packages.small.size || 0)}`, note: 'Needs the .NET 10 Desktop Runtime; Windows offers it if it is missing.', url: safe(latest.packages.small.url) });
  if (latest.packages?.selfContained?.url) packages.push({ kind: 'self-contained', label: `Self-contained package · ${packageSize(latest.packages.selfContained.size || 0)}`, note: 'Includes the runtime.', url: safe(latest.packages.selfContained.url) });
  return { version: latest.version, url: safe(latest.url), publishedAt: latest.publishedAt || '', packages };
}
