// The information board at the top of a room: what its owner and officers want every member
// to read (the week's plan, rules, a Discord link), kept by the backend (backend/odyle/board.go).
// Plain text: its lines stay and web addresses become links; nothing else formats it.
import { t } from './i18n.js';
import { escape as esc, age } from './model.js';
import { icon } from './icons.js';

export const boardLimit = 2000;

// The text escaped, with each http(s) address a link that opens in a new tab. Punctuation
// that ends a sentence stays out of the link, and so does a closing bracket the address did
// not open.
export function linked(text) {
  let out = '', last = 0;
  for (const m of String(text ?? '').matchAll(/https?:\/\/[^\s<>"'`]+/g)) {
    let url = m[0].replace(/[.,;:!?*]+$/, '');
    while (/[)\]}]$/.test(url) && count(url, url.at(-1)) > count(url, { ')': '(', ']': '[', '}': '{' }[url.at(-1)])) url = url.slice(0, -1).replace(/[.,;:!?*]+$/, '');
    if (!/^https?:\/\/[^/?#]/.test(url)) continue;
    out += esc(m.input.slice(last, m.index)) + `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`;
    last = m.index + url.length;
  }
  return out + esc(String(text ?? '').slice(last));
}
const count = (text, char) => text.split(char).length - 1;

// The board as the room shows it: its text, who wrote it last and when, and Edit for the owner
// and officers (canEdit). An empty board shows only to them, as an invitation to write one.
// name(accountId) names a member; one who left the room is not named.
export function boardSection(board, { canEdit = false, name = () => '', now = Date.now() } = {}) {
  const heading = `<h2>${icon('pin')} ${t('Information board')}</h2>`;
  if (!board?.text) {
    if (!canEdit) return '';
    return `<section class="board-card empty" aria-label="${esc(t('Information board'))}"><div class="board-head">${heading}<button class="button secondary" data-action="edit-board">${t('Write')}</button></div><p class="board-note">${t('Pin what every member should know: the week’s plan, the rules, a Discord link. Only the leader and the officers can change it.')}</p></section>`;
  }
  const by = board.by ? name(board.by) : '', when = board.at ? `<span data-age="${esc(board.at)}">${esc(age(board.at, now))}</span>` : '';
  const meta = [by ? esc(t('Last edit: {name}', { name: by })) : '', when].filter(Boolean).join(' · ');
  return `<section class="board-card" aria-label="${esc(t('Information board'))}"><div class="board-head">${heading}${meta ? `<small class="board-meta">${meta}</small>` : ''}${canEdit ? `<button class="text-button board-edit" data-action="edit-board">${t('Edit')}</button>` : ''}</div><div class="board-text">${linked(board.text)}</div></section>`;
}

// The form that writes the board; Clear empties a board that has text.
export function boardForm(board) {
  const text = board?.text || '';
  return `<form id="board-form" class="board-form"><label for="board-text">${t('Every member reads this at the top of the room.')}</label><textarea id="board-text" name="text" rows="10" maxlength="${boardLimit}">${esc(text)}</textarea><small class="account-note">${t('Up to 2,000 characters. Lines stay as you write them, and web addresses become links. Only the leader and the officers can change it.')}</small><div class="board-actions"><button class="button primary" type="submit">${t('Save board')}</button>${text ? `<button class="button secondary" type="button" data-action="clear-board">${t('Clear the board')}</button>` : ''}</div></form>`;
}
