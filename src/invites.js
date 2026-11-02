import { t, tn } from './i18n.js';
import { escape as esc, timestamp } from './model.js';
import { icon } from './icons.js';
// Invitation links carry the room code in the URL fragment (#/join/CODE), so it never
// reaches a server log. The server keeps only digests of codes and cannot show them
// again: it lists a room's open links to its owner by their details (role, label,
// expiry and joins), and the browser that made a link remembers its code until it
// expires, so only that browser offers the link to copy. Where the browser keeps no site
// data (blocked storage, some in-app browsers) the codes live in this page's memory. The owner's
// dialog with the room's open links is invitedialog.js, which loads with it.
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
