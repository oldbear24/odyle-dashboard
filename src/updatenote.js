// After an update the dashboard says once that it was updated (main.js, odyle.seenVersion), with
// a link to What's new (whatsnew.js, which loads with its page).
import { t } from './i18n.js';
import { escape as esc } from './model.js';
import { icon } from './icons.js';
import { link } from './routes.js';

// Whether to say the dashboard was updated: a version seen before that is not this one.
export const updated = (seen, current) => Boolean(seen) && seen !== current;
export function updatedNote(current) {
  return `<div class="update-note" role="status">${icon('info')}<p>${esc(t('Updated to {version}.', { version: current }))} <a href="${link('/changelog')}">${t('What\'s new')}</a></p><button class="close-button" data-action="hide-update-note" aria-label="${esc(t('Hide this message'))}" title="${esc(t('Hide this message'))}">×</button></div>`;
}
