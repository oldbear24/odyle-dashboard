import { timestamp } from './model.js';
import { t } from './i18n.js';
// Daily and weekly resets of the Global service happen at one UTC hour (07:00 by
// default) and the weekly reset on one weekday (Wednesday by default); the backend
// reports both from odyle_settings. A task is done while it was checked after the
// current period began, so the lists clear by themselves at reset and nothing is
// deleted. This module is the reference implementation; the server only stores
// the time a task was checked.
export const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export const defaults = { dailyResetHour: 7, weeklyResetDay: 'wednesday' };
const day = 86400000;
export const resetHour = resets => Number.isInteger(resets?.dailyResetHour) && resets.dailyResetHour >= 0 && resets.dailyResetHour < 24 ? resets.dailyResetHour : defaults.dailyResetHour;
const resetWeekday = resets => { const index = days.indexOf(resets?.weeklyResetDay); return index < 0 ? days.indexOf(defaults.weeklyResetDay) : index; };
export function dayName(resets) { const name = days[resetWeekday(resets)]; return name[0].toUpperCase() + name.slice(1); }
// Start (ms) of the daily or weekly period that contains `now`.
export function periodStart(cadence, now, resets = defaults) {
  const at = new Date(now); let start = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), resetHour(resets));
  if (start > now) start -= day;
  if (cadence === 'weekly') start -= ((new Date(start).getUTCDay() - resetWeekday(resets) + 7) % 7) * day;
  return start;
}
export const nextReset = (cadence, now, resets = defaults) => periodStart(cadence, now, resets) + (cadence === 'weekly' ? 7 : 1) * day;
export const isDone = (task, now, resets = defaults) => Boolean(task.doneAt) && timestamp(task.doneAt) >= periodStart(task.cadence, now, resets);
// "2d 3h", "5h 12m", "4m" or "under a minute".
export function remaining(ms) {
  const minutes = Math.max(0, Math.floor(ms / 60000)), hours = Math.floor(minutes / 60) % 24, daysLeft = Math.floor(minutes / 1440);
  return daysLeft ? t('{d}d {h}h', { d: daysLeft, h: hours }) : hours ? t('{h}h {m}m', { h: hours, m: minutes % 60 }) : minutes ? t('{m}m', { m: minutes }) : t('under a minute');
}
