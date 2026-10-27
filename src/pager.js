import { t, locale } from './i18n.js';
import { escape as esc } from './model.js';
import { icon } from './icons.js';

// The paged lists of the history and location dialogs: newest first, a page at a time, with
// buttons to the newest, newer, older and oldest pages. A short last page keeps the table's
// height with empty rows, so paging never moves the buttons from under the pointer.

export const pageCount = (total, perPage) => Math.max(1, Math.ceil(total / perPage));

// One page of a list held in full, shaped like a paged answer of the server.
export function pageOf(list, page, perPage) {
  const pages = pageCount(list.length, perPage), at = Math.min(Math.max(1, page), pages);
  return { items: list.slice((at - 1) * perPage, at * perPage), page: at, pages, total: list.length, perPage };
}

// Empty rows that fill a short page up to perPage rows of the given columns.
export const fillers = ({ pages, perPage }, rows, columns) => pages > 1 && rows < perPage ? `<tr class="pager-filler" aria-hidden="true">${'<td>&nbsp;</td>'.repeat(columns)}</tr>`.repeat(perPage - rows) : '';

// The buttons under a list; `attribute` carries the page each button opens.
export function pager({ page, pages }, attribute, label) {
  if (pages <= 1) return '';
  const step = (to, name, cls, disabled) => `<button class="pager-step ${cls}" type="button" ${attribute}="${to}"${disabled ? ' disabled' : ''} title="${esc(name)}" aria-label="${esc(name)}">${icon('chevron')}${cls.includes('edge') ? icon('chevron') : ''}</button>`;
  return `<nav class="pager" aria-label="${esc(label)}">${step(1, t('Newest'), 'newer edge', page <= 1)}${step(page - 1, t('Newer'), 'newer', page <= 1)}<span class="pager-at" aria-live="polite">${esc(t('Page {page} of {pages}', { page: page.toLocaleString(locale()), pages: pages.toLocaleString(locale()) }))}</span>${step(page + 1, t('Older'), 'older', page >= pages)}${step(pages, t('Oldest'), 'older edge', page >= pages)}</nav>`;
}
