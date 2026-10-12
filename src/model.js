const timestamp = date => Date.parse(String(date).replace(' ', 'T'));
export function status(member, now = Date.now()) {
  if (!member.sharing || !member.lastSeenAt || now - timestamp(member.lastSeenAt) >= 90000) return 'offline';
  if (!member.confirmed || !member.lastReadingAt) return 'unknown';
  if (member.valid === false) return 'stale';
  if (now - timestamp(member.lastReadingAt) >= 45000 || now - timestamp(member.lastSeenAt) >= 45000) return 'stale';
  return 'live';
}
export function age(date, now = Date.now()) {
  if (!date) return 'No reading yet';
  const seconds = Math.max(0, Math.floor((now - timestamp(date)) / 1000));
  return seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`;
}
export const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
