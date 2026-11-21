// After an update the dashboard says once that it was updated (main.js, odyle.seenVersion), with
// a link to What's new (whatsnew.js, which loads with its page). A tab left open while a newer
// release went out says that one is out, with a way to load it (#197). Neither note is a live
// region: pages draw them again with every redraw, and main.js reads out the news once.
import { t } from './i18n.js';
import { escape as esc } from './model.js';
import { icon } from './icons.js';
import { link } from './routes.js';

// Whether to say the dashboard was updated: a version seen before that is not this one.
export const updated = (seen, current) => Boolean(seen) && seen !== current;
const hide = action => `<button class="close-button" data-action="${action}" aria-label="${esc(t('Hide this message'))}" title="${esc(t('Hide this message'))}">×</button>`;
export function updatedNote(current) {
  return `<div class="update-note">${icon('info')}<p>${esc(t('Updated to {version}.', { version: current }))} <a href="${link('/changelog')}">${t('What\'s new')}</a></p>${hide('hide-update-note')}</div>`;
}
export function newerNote(version) {
  return `<div class="update-note is-newer">${icon('info')}<p>${esc(t('Odyle {version} is out.', { version }))} <button class="note-action" data-action="reload-release">${t('Reload to update')}</button></p>${hide('hide-release-note')}</div>`;
}
