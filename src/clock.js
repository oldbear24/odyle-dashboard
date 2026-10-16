import { t, locale } from './i18n.js';
import { timestamp } from './model.js';
import { remaining } from './tasks.js';

// The Odyle clock: a character's natural pool regenerates by a tick at fixed UTC hours up to
// its cap (the server's game rules, refined by what the character's own readings showed).
// Everything here is an estimate from the last reading, computed on the page and never
// stored: a spend on a PC without the reader stays unseen until its next reading.
const hour = 3600000, day = 24 * hour;
export const defaultClock = { tickHours: [1, 4, 7, 10, 13, 16, 19, 22], tick: 15, caps: [560, 840], paused: false };

// The tick times after `from` up to `until` (both ms), at most `limit` of them.
export function ticksAfter(from, until, hours, limit = Infinity) {
  const out = [];
  for (let at = Math.floor(from / hour) * hour + hour; at <= until && out.length < limit; at += hour) if (hours.includes(new Date(at).getUTCHours())) out.push(at);
  return out;
}
// The cap a character counts under: the smallest one its fullest natural pool of the last
// 30 days fits under (560, or 840 once it held more).
export const capOf = (c, rules) => rules.caps.find(cap => cap >= (c.naturalMax || 0)) ?? rules.caps[rules.caps.length - 1];
// The size of its last regeneration tick, else the server's.
export const tickOf = (c, rules) => c.regenTick > 0 ? c.regenTick : rules.tick;

// Where a character's natural pool stands now and where it goes, or null without the game's
// two numbers or a reading time, or while superusers pause the clock.
export function clockOf(c, now, rules = defaultClock) {
  if (!rules || rules.paused || !c?.parts || !c.lastReadingAt) return null;
  const from = timestamp(c.lastReadingAt);
  if (!Number.isFinite(from)) return null;
  const cap = capOf(c, rules), tick = tickOf(c, rules), start = c.parts.base;
  const passed = ticksAfter(from, now, rules.tickHours, 60 * 8).length;
  const base = start >= cap ? start : Math.min(cap, start + passed * tick);
  const next = ticksAfter(now, now + 2 * day, rules.tickHours, 1)[0] ?? null;
  const needed = base >= cap ? 0 : Math.ceil((cap - base) / tick);
  const fullAt = needed ? ticksAfter(now, now + 120 * day, rules.tickHours, needed)[needed - 1] ?? null : null;
  return { base, total: base + c.parts.bonus, cap, tick, next, fullAt, full: base >= cap, projected: base !== start };
}

// One line for a card: for a character not read right now its estimated value, then either
// the next tick and when the natural pool is full, or that it is full and losing each tick.
export function clockLine(clock, now, fresh) {
  if (!clock) return '';
  const when = at => new Date(at).toLocaleString(locale(), { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const parts = [];
  if (!fresh && clock.projected) parts.push(t('≈{total} now if unspent', { total: clock.total.toLocaleString(locale()) }));
  if (clock.full) parts.push(t('natural pool full · each tick of {tick} is lost', { tick: clock.tick }));
  else {
    if (clock.next) parts.push(t('+{tick} in {time}', { tick: clock.tick, time: remaining(clock.next - now) }));
    if (clock.fullAt) parts.push(t('full ≈ {when}', { when: when(clock.fullAt) }));
  }
  return parts.join(' · ');
}
