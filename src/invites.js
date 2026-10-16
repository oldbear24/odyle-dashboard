import { t, tn, locale } from './i18n.js';
import { escape as esc, timestamp } from './model.js';
import { icon } from './icons.js';
// Invitation links carry the room code in the URL fragment (#/join/CODE), so it never
// reaches a server log. The server keeps only digests of codes and cannot show them
// again: it lists a room's open links to its owner by their details (role, label,
// expiry and joins), and the browser that made a link remembers its code until it
// expires, so only that browser offers the link to copy. Where the browser keeps no site
// data (blocked storage, some in-app browsers) the codes live in this page's memory.
const key = 'odyle.invites', unsaved = new WeakMap();
export function inviteLink(page, code) { const url = new URL(page); url.search = ''; url.hash = '/join/' + code; return url.href; }
// The code of a #/join/<code> path, normalized like the join form does; '' for anything else.
export function joinCode(path) { const match = /^\/join\/([A-Za-z0-9-]{4,24})$/.exec(path); return match ? match[1].replace(/-/g, '').toUpperCase() : ''; }
function read(storage) { try { const saved = JSON.parse(storage.getItem(key)); if (saved && typeof saved === 'object') return saved; } catch { /* unreadable: the page's own copy */ } return unsaved.get(storage) || {}; }
function write(storage, rooms, now) {
  const kept = {};
  for (const id in rooms) { const live = (rooms[id] || []).filter(i => timestamp(i.expiresAt) > now); if (live.length) kept[id] = live; }
  unsaved.delete(storage);
  try { storage.setItem(key, JSON.stringify(kept)); if (storage.getItem(key) === null) unsaved.set(storage, kept); } catch { unsaved.set(storage, kept); }
}
export function savedInvites(storage, roomId, now = Date.now()) { return (read(storage)[roomId] || []).filter(i => timestamp(i.expiresAt) > now); }
// Each code keeps when this browser learned it (savedAt, its own clock), so a listing
// asked for before then cannot make it forget the code (withCodes).
export function rememberInvites(storage, roomId, invites, now = Date.now()) { write(storage, { ...read(storage), [roomId]: invites.map(({ id, code, role, expiresAt, savedAt = Date.now() }) => ({ id, code, role, expiresAt, savedAt })) }, now); }
export function rememberInvite(storage, roomId, invite, now = Date.now()) { rememberInvites(storage, roomId, [...savedInvites(storage, roomId, now).filter(i => i.id !== invite.id), invite], now); }
export function forgetInvite(storage, roomId, id, now = Date.now()) { rememberInvites(storage, roomId, savedInvites(storage, roomId, now).filter(i => i.id !== id), now); }
export function forgetInvites(storage, roomId, now = Date.now()) { const rooms = read(storage); delete rooms[roomId]; write(storage, rooms, now); }
export function forgetAllInvites(storage) { unsaved.delete(storage); try { storage.removeItem(key); } catch { /* storage blocked */ } }
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
// The card of an invite link (#/join/<code>) from the server's preview: who invited you
// to which room and as what, or why the link no longer works. Until the preview answers,
// or when it cannot, the general note.
export function inviteLanding(preview, signedIn = false) {
  if (preview?.state === 'valid') {
    const role = preview.role === 'viewer' ? t('as a viewer: you watch the party, without sharing characters') : t('as a player');
    return `<div class="join-note invite-landing valid" role="status"><span class="setup-icon">${icon('people')}</span><div><strong>${t('{name} invited you to {room}', { name: esc(preview.inviter || t('A friend')), room: `<em>${esc(preview.room)}</em>` })}</strong><small>${esc(role)} · ${esc(tn(preview.members, '{n} member', '{n} members'))}</small>${signedIn ? '' : `<small>${t('Sign in with Discord and you join it right away.')}</small>`}</div></div>`;
  }
  const problem = text => `<div class="join-note invite-landing problem" role="status">${icon('alert')}<span>${text}</span></div>`;
  if (preview?.state === 'expired') return problem(esc(t('This invite to {room} expired or was used up. Ask the room’s leader for a new link.', { room: preview.room })));
  if (preview?.state === 'unknown') return problem(t('This invite link does not work. Check that you opened all of it, or ask the room’s leader for a new one.'));
  return `<p class="join-note invite-landing">${icon('link')} ${signedIn ? t('You were invited to a room.') : t('You were invited to a room. Sign in with Discord and you join it right away.')}</p>`;
}
// The toast after joining: the room and the role it gave, or that you were in it already.
export function joinedMessage({ room, membership, alreadyMember }) {
  if (alreadyMember) return t('You are already in {room}.', { room: room.name });
  return membership?.role === 'viewer' ? t('You joined {room} as a viewer: you watch the party, without sharing characters.', { room: room.name }) : t('You joined {room} as a player.', { room: room.name });
}
