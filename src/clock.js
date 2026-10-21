import { t, locale } from './i18n.js';
import { timestamp } from './model.js';
import { remaining } from './tasks.js';

// The Odyle clock: a character's natural pool regenerates by a tick at fixed UTC hours up to
// its cap (the server's game rules, refined by what the character's own readings showed).
// Everything here is an estimate from the last reading, computed on the page and never
// stored: a spend on a PC without the reader stays unseen until its next reading. The
// backend makes the same projection (backend/odyle/clock.go).
const hour = 3600000, day = 24 * hour;
export const defaultClock = { tickHours: [1, 4, 7, 10, 13, 16, 19, 22], tick: 15, caps: [560, 840], paused: false };

// The tick times after `from` up to `until` (both ms), at most `limit` of them.
export function ticksAfter(from, until, hours, limit = Infinity) {
  const out = [];
  for (let at = Math.floor(from / hour) * hour + hour; at <= until && out.length < limit; at += hour) if (hours.includes(new Date(at).getUTCHours())) out.push(at);
  return out;
}
// The caps a character may have, smallest first: the one its account's membership answer
// settled (answeredCap: 840 with it, 560 without), else those its fullest natural pool of the
// last 30 days fits under, one once its readings settled it (it held more than 560, so 840).
export function capsOf(c, rules) {
  if (c.answeredCap > 0) return [c.answeredCap];
  const fit = rules.caps.filter(cap => cap >= (c.naturalMax || 0));
  return fit.length ? fit : rules.caps.slice(-1);
}
// Readings that contradict the answer: the natural pool held more than the answered cap (the
// membership started, most likely). They stay as read; the owner's card says so.
export const capMismatch = c => c.answeredCap > 0 && (c.naturalMax || 0) > c.answeredCap;
// The size of its last regeneration tick, else the server's.
export const tickOf = (c, rules) => c.regenTick > 0 ? c.regenTick : rules.tick;

// Where a character's natural pool stands now and where it goes, or null without the game's
// two numbers or a reading time, or while superusers pause the clock. While the cap is not
// settled the estimate stops at the smallest one, and `fills` says when each cap is reached.
export function clockOf(c, now, rules = defaultClock) {
  if (!rules || rules.paused || !c?.parts || !c.lastReadingAt) return null;
  const from = timestamp(c.lastReadingAt);
  if (!Number.isFinite(from)) return null;
  const caps = capsOf(c, rules), cap = caps[0], tick = tickOf(c, rules), start = c.parts.base;
  const passed = ticksAfter(from, now, rules.tickHours, 60 * 8).length;
  const base = start >= cap ? start : Math.min(cap, start + passed * tick);
  const next = ticksAfter(now, now + 2 * day, rules.tickHours, 1)[0] ?? null;
  const fills = caps.filter(limit => base < limit).map(limit => ({ cap: limit, at: ticksAfter(now, now + 120 * day, rules.tickHours, Math.ceil((limit - base) / tick)).at(-1) ?? null }));
  return { base, total: base + c.parts.bonus, cap, tick, next, fills, full: base >= cap, settled: caps.length === 1, projected: base !== start };
}

// How close the natural pool is to its cap, for the card's colour: "full" once it is full or
// fills within the hour, "soon" when it fills within two days, else "". While the cap is open
// it goes by the smallest one, as cap alerts do.
export const capSoon = 2 * day, capNow = hour;
export function capLevel(clock, now) {
  if (!clock) return '';
  const at = clock.full ? now : clock.fills[0]?.at;
  if (at == null) return '';
  return at - now <= capNow ? 'full' : at - now <= capSoon ? 'soon' : '';
}

// One line for a card: for a character not read right now its estimated value, then either
// the next tick and when the natural pool is full, or that it is full and losing each tick.
export function clockLine(clock, now, fresh) {
  if (!clock) return '';
  const when = at => new Date(at).toLocaleString(locale(), { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const parts = [];
  if (!fresh && clock.projected) parts.push(t('≈{total} now if unspent', { total: clock.total.toLocaleString(locale()) }));
  if (clock.full && clock.settled) parts.push(t('natural pool full · each tick of {tick} is lost', { tick: clock.tick }));
  else {
    if (clock.full) parts.push(t('natural pool at {base}: full if its cap is {cap}', { base: clock.base.toLocaleString(locale()), cap: clock.cap.toLocaleString(locale()) }));
    else if (clock.next) parts.push(t('+{tick} in {time}', { tick: clock.tick, time: remaining(clock.next - now) }));
    const fills = clock.fills.filter(f => f.at);
    if (fills.length) parts.push(t('full ≈ {when}', { when: fills.map(f => clock.settled ? when(f.at) : t('{when} at {cap}', { when: when(f.at), cap: f.cap.toLocaleString(locale()) })).join(' / ') }));
  }
  return parts.join(' · ');
}
