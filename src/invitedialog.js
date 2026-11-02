// The owner's invite dialog (main.js inviteDialog): the room's open links with the codes this
// browser remembers (invites.js) and the form for a new one. It loads with the dialog.
import { t, tn, locale } from './i18n.js';
import { escape as esc, timestamp } from './model.js';
import { icon } from './icons.js';
import { inviteLink, savedInvites, rememberInvites } from './invites.js';

// The room's open links as the server lists them, each with the code this browser
// remembers for it: by id, or for a code remembered before links had ids, by role and
// expiry, or the code an answer that made the link still carries. Codes of links no longer
// open (revoked or used up, here or elsewhere) are forgotten, except those learned at or
// after `since` (this browser's clock), when the listing was asked for: a link made
// meanwhile, here or in another tab, is just not in it yet.
export function withCodes(storage, roomId, listed, now = Date.now(), since = Infinity) {
  const saved = savedInvites(storage, roomId, now), match = l => s => s.id ? s.id === l.id : s.role === l.role && s.expiresAt === l.expiresAt;
  const rows = listed.map(l => ({ ...l, code: l.code || saved.find(match(l))?.code || '' }));
  const kept = rows.filter(r => r.code).map(r => ({ ...r, savedAt: saved.find(match(r))?.savedAt }));
  rememberInvites(storage, roomId, [...kept, ...saved.filter(s => s.savedAt >= since && !rows.some(r => match(r)(s)))], now);
  return rows;
}
// "Expires 21:30" today, "Expires 18 Oct, 21:30" on a later day.
export function expiresLabel(expiresAt, now) {
  const at = new Date(timestamp(expiresAt)), today = at.toDateString() === new Date(now).toDateString();
  return t('Expires {time}', { time: at.toLocaleString(locale(), today ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) });
}
export function usesLabel(link) {
  const left = Math.max(0, link.maxUses - link.uses);
  return link.maxUses ? tn(left, '{n} use left', '{n} uses left') : t('No use limit');
}
// One open link of the owner's invite dialog: role and label, the code with its copy
// buttons where this browser made the link, expiry, joins left and Revoke.
export function inviteRow(link, page, now) {
  const role = link.role === 'viewer' ? t('VIEWER INVITE') : t('PLAYER INVITE');
  const code = link.code ? `<strong>${esc(link.code.match(/.{1,4}/g).join(' '))}</strong>` : `<p class="invite-elsewhere">${t('Its link shows only in the browser that made it.')}</p>`;
  const copy = link.code ? `<button class="invite-link" data-copy="${esc(inviteLink(page, link.code))}" data-copied="${esc(t('Invite link copied.'))}">${icon('link')} ${t('Copy link')}</button>` : '';
  const copyCode = link.code ? `<button class="icon-button" data-copy="${esc(link.code)}" aria-label="${esc(t('Copy code'))}" title="${esc(t('Copy code'))}">${icon('copy')}</button>` : '';
  return `<div class="invite-row" data-invite="${esc(link.id)}"><div><span>${role}${link.label ? ` · ${esc(link.label)}` : ''}</span>${code}<small>${esc(expiresLabel(link.expiresAt, now))} · ${esc(usesLabel(link))}</small></div><div class="invite-actions">${copy}<div class="invite-tools">${copyCode}<button class="invite-revoke" data-revoke-invite="${esc(link.id)}">${t('Revoke')}</button></div></div></div>`;
}
// The list part of the dialog: loading (null), empty or the links, player links first.
export function inviteList(rows, page, now) {
  if (!rows) return `<p class="invite-note">${t('Loading invite links…')}</p>`;
  if (!rows.length) return `<p class="invite-note">${t('No open invite links. Make one below.')}</p>`;
  return rows.map(r => inviteRow(r, page, now)).join('');
}
const choice = (value, label, selected = false) => `<option value="${value}"${selected ? ' selected' : ''}>${esc(label)}</option>`;
// The owner's invite dialog: the room's open links, then the form for a new one: the
// role it joins as, how long it works (24 hours unless chosen) and how many may use it.
export function inviteDialogBody(rows, page, now) {
  const people = [5, 10, 25].map(n => choice(n, tn(n, '{n} person', '{n} people'))).join('');
  return `<p>${t('Send a friend an invite link, or its code to enter under Join your friends. Members stay until they leave or you remove them.')}</p><div class="invite-list">${inviteList(rows, page, now)}</div><form id="invite-form" class="invite-form"><h3 class="modal-sub">${t('New invite link')}</h3><div class="invite-options"><label>${t('Joins as')}<select name="role">${choice('reporter', t('Player'), true)}${choice('viewer', t('Viewer'))}</select></label><label>${t('Works for')}<select name="expiresIn">${choice(1800, t('30 minutes'))}${choice(86400, t('24 hours'), true)}${choice(604800, t('7 days'))}</select></label><label>${t('Who can use it')}<select name="maxUses">${choice(0, t('Anyone with the link'), true)}${choice(1, t('One person'))}${people}</select></label></div><label>${t('Label (optional)')}<input name="label" maxlength="40" autocomplete="off" placeholder="${esc(t('For example: Discord #raids'))}"></label><button class="button primary" type="submit">${icon('link')} ${t('Make invite link')}</button></form>`;
}
