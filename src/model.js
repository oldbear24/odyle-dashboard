import { t, locale } from './i18n.js';
export const timestamp = date => Date.parse(String(date).replace(' ', 'T'));
export function status(member, now = Date.now()) {
  if (!member.sharing) return 'offline';
  if (!member.confirmed || !member.lastReadingAt) return 'unknown';
  if (!member.lastSeenAt || now - timestamp(member.lastSeenAt) >= 90000) return 'offline';
  // Readings are sent only when the value changes; the reader's heartbeat keeps
  // an unchanged value live, so freshness follows presence, not reading age.
  if (member.valid === false || member.source === 'manual' || now - timestamp(member.lastSeenAt) >= 45000)
    return 'stale';
  return 'live';
}
// A character's class and level as PLAYNC's official search lists them (#25): "Chanter · Lv 45",
// either alone, or "" while the daily lookup has not found the character yet.
// A region as cards show it: EU, NA-E, NA-W, SA, ASIA.
export const regionLabel = region =>
  ({ GLOBAL_NA: 'NA-E', GLOBAL_NAW: 'NA-W' })[region] ?? String(region || '').replace('GLOBAL_', '');
export const classOf = c =>
  [c?.className || '', c?.level > 0 ? t('Lv {level}', { level: c.level }) : ''].filter(Boolean).join(' · ');
export function age(date, now = Date.now()) {
  if (!date) return t('No reading yet');
  const seconds = Math.max(0, Math.floor((now - timestamp(date)) / 1000));
  return seconds < 60
    ? t('{n}s ago', { n: seconds })
    : seconds < 3600
      ? t('{n}m ago', { n: Math.floor(seconds / 60) })
      : seconds < 86400
        ? t('{n}h ago', { n: Math.floor(seconds / 3600) })
        : t('{n}d ago', { n: Math.floor(seconds / 86400) });
}
// When a change or place was: the day and time, with the year when it is not this one.
export const changedAt = (at, now = Date.now()) => {
  const date = new Date(timestamp(at));
  return date.toLocaleString(locale(), {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
  });
};
// A reset week's dates in the reader's language: "28 Oct – 3 Nov 2026", its first and last daily
// period named by their middle, so the reset hour never shifts them a day in the reader's zone
// (week.js, and Rooms & characters when the week before is ready).
export function weekDates(from, until) {
  const halfDay = 43200000,
    last = new Date(until - halfDay),
    first = new Date(from + halfDay);
  const sameYear = first.getFullYear() === last.getFullYear();
  return `${first.toLocaleDateString(locale(), { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })} – ${last.toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
// A count in the reader's language: 1,234 or 1 234; anything not a number counts as 0.
export const number = value => (Number(value) || 0).toLocaleString(locale());
export const escape = value =>
  String(value ?? '').replace(
    /[&<>"']/g,
    char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
// What a redraw compares (each page's signature): hook responses list record fields in a
// different order each time, so keys are sorted and identical data compares equal.
export const canonical = value =>
  JSON.stringify(value, (key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
// Members (or the account) without what changes with every heartbeat: when each was last seen.
export const stable = list =>
  list.map(({ lastSeenAt: _lastSeen, updated: _changed, characters, ...rest }) => ({
    ...rest,
    characters: characters?.map(({ lastSeenAt: _seen, updated: _updated, ...c }) => c),
  }));
