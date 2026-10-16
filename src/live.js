import { timestamp } from './model.js';
// Realtime news a page applies to what it shows without fetching it again (the
// backend's realtime.go): changed characters and heartbeats. The character functions
// answer whether every character was known; false means a character is new to the page,
// which then fetches its data again. Below them, the answers of the page's own room
// changes, which carry the new state too.

// Changed characters of a room, into its members' character lists.
export function applyRoomCharacters(members, changed) {
  let complete = true;
  for (const c of changed) {
    const list = members.find(m => m.user === c.user)?.characters, at = list ? list.findIndex(x => x.id === c.id) : -1;
    if (at < 0) complete = false; else list[at] = { ...list[at], ...c };
  }
  return complete;
}
// Changed characters of the account itself.
export function applyCharacters(list, changed) {
  let complete = true;
  for (const c of changed) {
    const at = list.findIndex(x => x.id === c.id);
    if (at < 0) complete = false; else list[at] = { ...list[at], ...c };
  }
  return complete;
}
// Heartbeats, { <character id>: lastSeenAt }, into every list given; an older one never
// replaces a later time.
export function applySeen(seen, ...lists) {
  for (const list of lists) for (const c of list || []) {
    const at = seen[c.id];
    if (at && !(timestamp(c.lastSeenAt) >= timestamp(at))) c.lastSeenAt = at;
  }
}
// The sharing route's answer, { sharedCharacters }, into the account's own membership:
// which of its characters the room sees (it always lists all of them, each with shared).
export function applyShared(member, shared) {
  if (!member) return;
  member.sharedCharacters = shared; member.sharing = shared.length > 0;
  for (const c of member.characters || []) c.shared = shared.includes(c.id);
}
// The role route's answer, { membership }, into another member: its role and the
// characters it shares, which a member made viewer no longer does. False for a member the
// page does not list, which then fetches the room again.
export function applyMembership(members, membership) {
  const m = members.find(x => x.id === membership?.id);
  if (!m) return false;
  const shared = membership.sharedCharacters || [];
  Object.assign(m, { role: membership.role, sharedCharacters: shared, sharing: shared.length > 0, characters: (m.characters || []).filter(c => shared.includes(c.id)) });
  return true;
}
// Reader sessions in contact, { <session id>: time }, into the account page's apps.
export function applyContact(contact, apps) {
  for (const a of apps || []) {
    const at = contact[a.sessionId];
    if (at && !(timestamp(a.lastContactAt) >= timestamp(at))) a.lastContactAt = at;
  }
}
