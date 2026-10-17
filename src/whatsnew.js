// What's new (#/changelog, #74): the dashboard's changelog (CHANGELOG.md, bundled with the build,
// read by changelog.js) and what the newest Windows app release changed (from its release
// notes, which the backend keeps with the release: `changes`). After an update the dashboard
// says once that it was updated (main.js, odyle.seenVersion).
import { t, locale } from './i18n.js';
import { escape as esc } from './model.js';
import { icon } from './icons.js';

// An entry's text, escaped, with **bold** and `code` as the changelog writes them.
export const inline = text => esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
const groupName = title => ({ New: t('New'), Changed: t('Changed'), Fixed: t('Fixed') })[title] || title;
const day = text => /^\d{4}-\d{2}-\d{2}/.test(text || '') ? new Date(text.slice(0, 10) + 'T12:00:00Z').toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const groups = list => list.map(g => `<h3>${esc(groupName(g.title))}</h3><ul>${g.items.map(i => `<li>${inline(i)}</li>`).join('')}</ul>`).join('');

// The page: the dashboard's versions, newest first, this one marked; then the newest Windows
// app release (`windows`: version, publishedAt, url, changes), when the backend knows it.
export function whatsNew(entries, current, windows) {
  const dashboard = entries.map(e => `<section class="changelog-entry${e.version === current ? ' is-current' : ''}"><div class="changelog-head"><h3 class="changelog-version">${esc(e.version)}${e.version === current ? ` <span class="changelog-badge">${t('this version')}</span>` : ''}</h3><span>${esc(day(e.date))}</span></div>${groups(e.groups)}</section>`).join('');
  const app = windows?.version ? `<section class="changelog-entry"><div class="changelog-head"><h3 class="changelog-version">${esc(t('Windows app {version}', { version: windows.version }))}</h3><span>${esc(day(windows.publishedAt))}</span></div>${windows.changes?.length ? groups(windows.changes) : `<p class="changelog-note">${t('This release lists its changes on GitHub.')}</p>`}<a class="text-button" href="${esc(windows.url)}" target="_blank" rel="noopener">${t('Release notes on GitHub')} ${icon('arrow')}</a></section>` : '';
  return `<main class="dashboard changelog"><div class="heading"><div><h1>${t('What\'s new')}</h1><p>${t('What changed in each release, newest first.')}</p></div></div>
<h2 class="changelog-part">${t('Dashboard')}</h2>${dashboard || `<p class="changelog-note">${t('No changes listed yet.')}</p>`}${app ? `<h2 class="changelog-part">${t('Windows app')}</h2>${app}` : ''}</main>`;
}

// Whether to say the dashboard was updated: a version seen before that is not this one.
export const updated = (seen, current) => Boolean(seen) && seen !== current;
export function updatedNote(current) {
  return `<div class="update-note" role="status">${icon('info')}<p>${esc(t('Updated to {version}.', { version: current }))} <a href="#/changelog">${t('What\'s new')}</a></p><button class="close-button" data-action="hide-update-note" aria-label="${esc(t('Hide this message'))}" title="${esc(t('Hide this message'))}">×</button></div>`;
}
