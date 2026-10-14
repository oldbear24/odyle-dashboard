// Invitation links carry the room code in the URL fragment (#/join/CODE), so it never
// reaches a server log. The server keeps only digests of codes and cannot show them
// again, so the owner's browser remembers the codes it created until they expire.
const key = 'odyle.invites';
export function inviteLink(page, code) { const url = new URL(page); url.search = ''; url.hash = '/join/' + code; return url.href; }
// The code of a #/join/<code> path, normalized like the join form does; '' for anything else.
export function joinCode(path) { const match = /^\/join\/([A-Za-z0-9-]{4,24})$/.exec(path); return match ? match[1].replace(/-/g, '').toUpperCase() : ''; }
function read(storage) { try { const saved = JSON.parse(storage.getItem(key)); return saved && typeof saved === 'object' ? saved : {}; } catch { return {}; } }
function write(storage, rooms, now) {
  const kept = {};
  for (const id in rooms) { const live = (rooms[id] || []).filter(i => Date.parse(i.expiresAt) > now); if (live.length) kept[id] = live; }
  try { storage.setItem(key, JSON.stringify(kept)); } catch { /* private mode: codes just are not remembered */ }
}
export function savedInvites(storage, roomId, now = Date.now()) { return (read(storage)[roomId] || []).filter(i => Date.parse(i.expiresAt) > now); }
export function rememberInvites(storage, roomId, invites, now = Date.now()) { write(storage, { ...read(storage), [roomId]: invites.map(({ code, role, expiresAt }) => ({ code, role, expiresAt })) }, now); }
export function forgetInvites(storage, roomId, now = Date.now()) { const rooms = read(storage); delete rooms[roomId]; write(storage, rooms, now); }
