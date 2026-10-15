import { timestamp } from './model.js';
// Realtime news a page applies to what it shows without fetching it again (the
// backend's realtime.go): changed characters and heartbeats. The character functions
// answer whether every character was known; false means a character is new to the page,
// which then fetches its data again.

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
// Reader sessions in contact, { <session id>: time }, into the account page's apps.
export function applyContact(contact, apps) {
  for (const a of apps || []) {
    const at = contact[a.sessionId];
    if (at && !(timestamp(a.lastContactAt) >= timestamp(at))) a.lastContactAt = at;
  }
}
