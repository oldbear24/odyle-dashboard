import { t, locale } from './i18n.js';
import { escape as esc, timestamp } from './model.js';
import { icon } from './icons.js';
import { pairingKey as key, forgetPairing, readerLabel } from './readers.js';
// Pairing a Windows app: the dialog behind Pair Windows app and Connect reader. Its
// connection link carries a one-time code that expires after five minutes and that the
// server keeps only as a digest, so the browser that asked for it remembers it (like
// invite codes, invites.js) and the dialog shows the same link again instead of a new
// one, until a minute before it expires. A new link replaces the code on the server too.
// Signing out of the browser forgets it (readers.js). The dialog loads with its first opening
// (main.js desktopDialog).
const lifetime = 300000;
export function savedPairing(storage, user, now = Date.now()) {
  let saved; try { saved = JSON.parse(storage.getItem(key)); } catch { return null; }
  if (!saved) return null;
  if (!(timestamp(saved.expiresAt) > now)) { forgetPairing(storage); return null; } // expired codes are not kept
  if (saved.user !== user || typeof saved.code !== 'string' || timestamp(saved.expiresAt) - now <= 60000) return null;
  return { code: saved.code, expiresAt: saved.expiresAt };
}
export function rememberPairing(storage, user, { code, expiresAt }) { try { storage.setItem(key, JSON.stringify({ user, code, expiresAt })); } catch { /* private mode: the next dialog asks for a new link */ } }
// The PC this link paired: the newest PC paired since the link was made, as only a
// pairing adds one (the account page's devices, each with pairedAt).
export function pairedWith(devices, pair) {
  const since = timestamp(pair.expiresAt) - lifetime;
  return (devices || []).filter(d => timestamp(d.pairedAt) >= since).sort((a, b) => timestamp(b.pairedAt) - timestamp(a.pairedAt))[0] || null;
}
// "4:05" until the link expires.
export function countdown(ms) { const seconds = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
// Open in Odyle: the Windows app (0.15.0 and newer) registers odyle:// links, takes this one even
// while it runs, names the server and asks before pairing. Copying the link keeps working.
export const appLink = link => 'odyle://pair?link=' + encodeURIComponent(link);
// The dialog's changing part, by step: loading the link, the link with its countdown, an
// expired link, a refused one (pairing paused, say), the PC it paired and the reader
// already online. The download links and the rest of the dialog stay as they are.
export function pairingSlot(v) {
  if (v.step === 'link') return `<p>${t('Copy this link, then click <strong>Paste link & connect</strong> in the Windows app. The reader starts by itself and follows the character you log in with.')}</p><div class="link-copy"><input class="link-field" readonly value="${esc(v.link)}" aria-label="${esc(t('Connection link'))}"><button class="button primary" data-copy="${esc(v.link)}" data-copied="${esc(t('Connection link copied.'))}">${icon('copy')} ${t('Copy connection link')}</button></div><p class="pairing-open"><a class="button secondary" href="${esc(appLink(v.link))}">${icon('arrow')} ${t('Open in Odyle')}</a><small>${t('Odyle 0.15 or newer on this PC: your browser asks to open it, then Odyle asks before pairing.')}</small></p><p class="pairing-expiry"><span>${t('Works once and expires in {time}.', { time: `<strong data-pair-expires>${countdown(v.left)}</strong>` })}</span><button class="text-button" data-action="new-pairing">${icon('link')} ${t('New link')}</button></p><p>${t('The app then stays paired, even after weeks switched off, until you disconnect it or sign out everywhere. It requires Npcap.')}</p>`;
  if (v.step === 'expired') return `<p class="pairing-problem" role="status">${t('This connection link expired. A new one works for five minutes.')}</p><button class="button primary" data-action="new-pairing">${icon('link')} ${t('New link')}</button>`;
  if (v.step === 'refused') return `<p class="pairing-problem" role="alert">${esc(t(v.problem))}</p>${v.paused ? `<p>${t('You can download and install the app now and pair it once pairing is open again.')}</p>` : ''}<button class="button secondary" data-action="new-pairing">${t('Try again')}</button>`;
  const outcome = (title, detail, mark) => `<div class="pairing-done" role="status"><span class="setup-icon">${mark}</span><div><strong>${esc(title)}</strong><small>${esc(detail)}</small></div></div>`;
  if (v.step === 'paired') return outcome(t('Paired with {pc}', { pc: v.pc || t('Windows PC') }), v.character ? t('Reading {name}', { name: v.character }) : t('Waiting for the game: log into your character and the reader picks it up.'), icon('tick')) + `<button class="button primary" data-action="close-dialog">${t('Done')}</button>`;
  if (v.step === 'online') return outcome(readerLabel(v.pc), v.character ? t('Reading {name}', { name: v.character }) : t('No character in game'), '<i class="live-dot"></i>') + `<p>${t('To read on another PC too, pair it with a new connection link.')}</p><button class="button secondary" data-action="pair-another">${icon('plus')} ${t('Pair another PC')}</button>`;
  return `<p class="pairing-wait">${t('Getting a connection link…')}</p>`;
}
// The dialog's downloads: the newest Windows app release as release.js windowsApp names it.
export function downloadPanel(app) {
  const find = kind => app.packages.find(p => p.kind === kind);
  const installer = find('installer'), small = find('small'), bundled = find('self-contained'), armSmall = find('arm64-small'), armBundled = find('arm64-self-contained');
  const released = app.publishedAt ? ` · ${t('released {date}', { date: new Date(app.publishedAt).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' }) })}` : '';
  const link = (cls, href, label, title = '') => `<a class="${cls}" href="${esc(href)}" target="_blank" rel="noopener noreferrer"${title ? ` title="${esc(title)}"` : ''}>${label}</a>`;
  const runtime = t('Needs the .NET 10 Desktop Runtime; Windows offers it if it is missing.');
  // The installer is the easiest start; the ZIPs remain for a folder of your choice and for ARM PCs.
  const primary = installer ? link('button secondary', installer.url, `${icon('download')} ${esc(t('Download the installer · {size}', { size: installer.size }))}`) + `<small>${t('Installs for your Windows account without administrator rights and includes the runtime.')}</small>`
    : small ? link('button secondary', small.url, `${icon('download')} ${esc(t('Download for Windows x64 · {size}', { size: small.size }))}`) + `<small>${runtime}</small>`
      : link('button secondary', app.url, `${icon('download')} ${t('Open the latest release')}`);
  const more = [installer && small ? link('text-button', small.url, esc(t('ZIP for Windows x64 · {size}', { size: small.size })), runtime) : '', bundled ? link('text-button', bundled.url, esc(t('Self-contained package · {size}', { size: bundled.size }))) : '',
    armSmall ? link('text-button', armSmall.url, esc(t('Windows on ARM · {size}', { size: armSmall.size })), runtime) : '', armBundled ? link('text-button', armBundled.url, esc(t('Windows on ARM, self-contained · {size}', { size: armBundled.size }))) : ''];
  return `<div class="info-panel app-panel"><h3>${app.version ? esc(t('Odyle {version} for Windows', { version: app.version })) : t('Odyle for Windows')}</h3><p>${app.version ? `${t('The newest release')}${esc(released)}.` : t('The newest release is on GitHub.')} ${t('Once installed, the app updates itself from new releases.')}</p>${primary}<div class="app-links">${more.join('')}${link('text-button', app.url, `${app.version ? t('Release notes') : t('All releases')} ${icon('arrow')}`)}</div></div>`;
}
