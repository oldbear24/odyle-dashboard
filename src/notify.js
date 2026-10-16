import { t, locale } from './i18n.js';
import { timestamp } from './model.js';

// The account's notification settings (backend notifications.go): which notifications,
// where, and quiet hours in the account's time zone. Every browser and Windows app follows
// them; only the permission to show notifications belongs to each browser.
export const defaultNotifications = { channels: { tray: true, browser: true, push: true }, leadMinutes: [15], kinds: { runs: true, cap: false }, capTicks: 1, quiet: { from: '', to: '', timeZone: '' }, saved: false };
// How many regeneration ticks before the cap a cap alert comes (0: when the pool is full).
export const capTickChoices = [[0, 'when it is full'], [1, 'one tick before'], [2, 'two ticks before'], [4, 'four ticks before']];
// Reminder times offered on the account page; a saved time outside them is offered too.
export const leadChoices = [5, 15, 30, 60, 120, 1440];
export const leadLabel = minutes => minutes % 60 ? t('{n} min', { n: minutes }) : t('{n} h', { n: minutes / 60 });
export const browserZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

// Whether a moment falls in the quiet hours (a span over midnight wraps).
export function quietAt(settings, at) {
  const { from, to, timeZone } = settings?.quiet || {};
  if (!from || !to) return false;
  let clock;
  try { clock = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(at)); } catch { return false; }
  const minutes = text => Number(text.slice(0, 2)) * 60 + Number(text.slice(3, 5));
  const now = minutes(clock), start = minutes(from), end = minutes(to);
  return start < end ? now >= start && now < end : now >= start || now < end;
}

// A cap alert of the odyle-cap-alerts job (backend capalerts.go) as a notification: soon (with
// when the natural pool is full) or full, for a settled cap or one that may be larger.
export function capAlertText(alert) {
  const when = alert.at ? new Date(alert.at).toLocaleString(locale(), { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const values = { name: alert.characterName, when, tick: alert.tick, cap: Number(alert.cap).toLocaleString(locale()) };
  if (alert.state === 'soon') return { title: t('{name} caps soon', values), body: alert.settled ? t('Its natural pool is full ≈ {when}; each tick of {tick} after that is lost.', values) : t('Its natural pool reaches {cap} ≈ {when}, full if that is its cap.', values) };
  return { title: t('{name} is losing Odyle', values), body: alert.settled ? t('Its natural pool is full: each tick of {tick} is lost until you spend some.', values) : t('Its natural pool is at {cap}: if that is its cap, each tick of {tick} is lost.', values) };
}
// The run reminders due now: for each run not started yet, the smallest reminder time it is
// within, unless that one was shown. `marks` are the keys to remember, every time it is
// within, so opening the page 10 minutes before a run reminds once, not for 2 h and 15 min.
export function dueReminders(runs, now, leads, done) {
  const out = [];
  for (const r of runs) {
    const at = timestamp(r.startsAt), left = at - now, within = leads.filter(lead => left <= lead * 60000);
    if (!(left > 0) || !within.length) continue;
    const key = lead => r.id + '@' + r.startsAt + '@' + lead, lead = Math.min(...within);
    if (!done[key(lead)]) out.push({ run: r, at, lead, key: key(lead), marks: within.map(key) });
  }
  return out;
}
