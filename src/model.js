import { t } from './i18n.js';
export const timestamp = date => Date.parse(String(date).replace(' ', 'T'));
export function status(member, now = Date.now()) {
  if (!member.sharing) return 'offline';
  if (!member.confirmed || !member.lastReadingAt) return 'unknown';
  if (!member.lastSeenAt || now - timestamp(member.lastSeenAt) >= 90000) return 'offline';
  // Readings are sent only when the value changes; the reader's heartbeat keeps
  // an unchanged value live, so freshness follows presence, not reading age.
  if (member.valid === false || member.source === 'manual' || now - timestamp(member.lastSeenAt) >= 45000) return 'stale';
  return 'live';
}
// A character's class and level as PLAYNC's official search lists them (#25): "Chanter · Lv 45",
// either alone, or "" while the daily lookup has not found the character yet.
export const classOf = c => [c?.className || '', c?.level > 0 ? t('Lv {level}', { level: c.level }) : ''].filter(Boolean).join(' · ');
export function age(date, now = Date.now()) {
  if (!date) return t('No reading yet');
  const seconds = Math.max(0, Math.floor((now - timestamp(date)) / 1000));
  return seconds < 60 ? t('{n}s ago', { n: seconds }) : seconds < 3600 ? t('{n}m ago', { n: Math.floor(seconds / 60) }) : seconds < 86400 ? t('{n}h ago', { n: Math.floor(seconds / 3600) }) : t('{n}d ago', { n: Math.floor(seconds / 86400) });
}
export const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
