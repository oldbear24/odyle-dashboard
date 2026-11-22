// The notes above every page: the message superusers set under Server controls, and what
// changed since this browser's last visit or a newer release on the server.
import { t } from '../i18n.js';
import { escape as esc } from '../model.js';
import { icon } from '../icons.js';
import { updated, updatedNote, newerNote, newerRelease } from '../updatenote.js';
import { state, storage, tabStorage } from './state.js';
import { pb } from './server.js';
import { announce, drafted } from './ui.js';
import { onAction } from './actions.js';
import { renderConnection } from './shell.js';

// After an update the dashboard says so once (whatsnew.js). A browser that never had the
// dashboard open starts at this version; one that did, but from before What's new, hears of it.
const seenKey = 'odyle.seenVersion';
// This build's version, from the page (vite.config.js), so the built files keep their names across releases (#185).
export const appVersion = document.querySelector('meta[name="odyle-version"]')?.content || 'dev';
try {
  if (!storage.getItem(seenKey))
    storage.setItem(
      seenKey,
      storage.getItem('odyle.location') || storage.getItem('odyle.account') ? 'earlier' : appVersion,
    );
} catch {
  /* storage blocked */
}
// A newer release on the server (#197) takes the note's place: the announcement names the
// release the backend runs. Only where the backend serves this dashboard; a dashboard on a
// separate host (VITE_POCKETBASE_URL) has releases of its own.
export const updateNote = () =>
  releaseOut && releaseOut !== releaseHidden
    ? newerNote(releaseOut)
    : state.shown !== '/changelog' && updated(storage.getItem(seenKey), appVersion)
      ? updatedNote(appVersion)
      : '';
export function seenVersion() {
  try {
    storage.setItem(seenKey, appVersion);
  } catch {
    /* storage blocked */
  }
  renderUpdateNote();
}
function renderUpdateNote() {
  const el = document.querySelector('.update-note'),
    html = updateNote();
  if (el) el.outerHTML = html;
  else if (html) document.querySelector('.announcement-slot')?.insertAdjacentHTML('afterend', html);
}
const ownDashboard = import.meta.env.PROD && !import.meta.env.VITE_POCKETBASE_URL;
let releaseOut = '',
  releaseHidden = '',
  releaseAt = Date.now();
function noteRelease(data) {
  const next = data?.dashboard;
  if (!ownDashboard || next === releaseOut || !next) return;
  // Only a newer release: a server rolled back to an older one has nothing to offer, and takes
  // back the note of the one it rolled back from.
  if (!newerRelease(next, appVersion)) {
    if (releaseOut) {
      releaseOut = '';
      renderUpdateNote();
    }
    return;
  }
  releaseOut = next;
  renderUpdateNote();
  announce(t('Odyle {version} is out. Reload the page to get it.', { version: next }));
  reloadWhenIdle();
}
// A hidden tab loads the new release by itself, unless a form holds unsaved input or a dialog
// is open; once per release and tab, so a server that keeps answering the same never loops.
const reloadedKey = 'odyle.reloadedFor';
export function reloadWhenIdle() {
  if (!releaseOut || !document.hidden || state.busy || drafted() || document.querySelector('#modal')?.open) return;
  try {
    if (tabStorage?.getItem(reloadedKey) === releaseOut) return;
    tabStorage?.setItem(reloadedKey, releaseOut);
  } catch {
    return;
  }
  location.reload();
}
// The announcement is asked every minute at most for the release, also on pages whose own
// answers carry the announcement and in hidden tabs.
export async function checkRelease() {
  if (ownDashboard && Date.now() - releaseAt >= 60000) await loadAnnouncement(true);
}

// The message superusers set under Server controls, refreshed every minute at most: from
// the rooms list or a room snapshot, which carry it, or on its own when neither came in
// that minute. Hiding it lasts until the text changes.
let announcement = null,
  announcementAt = 0;
const hiddenAnnouncementKey = 'odyle.announcement.hidden';
export function announcementBar() {
  if (!announcement || storage.getItem(hiddenAnnouncementKey) === announcement.text)
    return '<div class="announcement-slot"></div>';
  const warning = announcement.level === 'warning';
  return `<div class="announcement-slot"><div class="announcement ${warning ? 'warning' : 'info'}">${icon(warning ? 'alert' : 'info')}<p>${esc(announcement.text)}</p><button class="close-button" data-action="hide-announcement" aria-label="${esc(t('Hide this message'))}" title="${esc(t('Hide this message'))}">×</button></div></div>`;
}
function renderAnnouncement() {
  const el = document.querySelector('.announcement-slot');
  if (el) el.outerHTML = announcementBar();
}
export async function loadAnnouncement(force = false) {
  if (!force && Date.now() - announcementAt < 60000) return;
  announcementAt = releaseAt = Date.now();
  const answer = await pb.send('/api/odyle/announcement');
  showAnnouncement(answer.announcement || null);
  noteRelease(answer);
  // Signed out nothing else asks the server; its answer shows it is reachable.
  if (!state.online && !pb.authStore.isValid) {
    state.online = true;
    renderConnection();
  }
}
export function announced(data) {
  if (data && 'announcement' in data) {
    announcementAt = Date.now();
    showAnnouncement(data.announcement || null);
  }
}
// A new announcement is read out once (the bar itself is no live region, as pages redraw it).
function showAnnouncement(next) {
  if (JSON.stringify(next) === JSON.stringify(announcement)) return;
  announcement = next;
  renderAnnouncement();
  if (next?.text && storage.getItem(hiddenAnnouncementKey) !== next.text) announce(next.text, next.level === 'warning');
}

onAction({
  'hide-update-note': () => seenVersion(),
  'hide-release-note': () => {
    releaseHidden = releaseOut;
    renderUpdateNote();
  },
  'reload-release': () => location.reload(),
  'hide-announcement': () => {
    storage.setItem(hiddenAnnouncementKey, announcement?.text || '');
    renderAnnouncement();
  },
});
