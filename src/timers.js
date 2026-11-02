import { t, tn, locale } from './i18n.js';
import { escape as esc } from './model.js';
import { icon } from './icons.js';
import { ticksAfter, defaultClock } from './clock.js';
import { nextReset, dayName, resetHour, remaining, defaults as resetDefaults } from './tasks.js';
import { cubeCost } from './catalog.js';
import { link } from './routes.js';

// The timers page (/timers): when the game's daily and weekly resets come, when the natural
// Odyle pool gains its next tick and how long an empty one takes to fill, the weekly
// maintenance and what a cube of each dungeon costs. Open to anyone, signed in or not, and
// listed for search engines (backend/odyle/timers.go): it shows only the game rules the server
// keeps (GET /api/odyle/game), in the reader's own time, and counts down every second while
// it is open. Nothing about a player is typed in or kept.

const hour = 3600000, day = 24 * hour;
const weekDays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// A countdown as the page shows it: "02:14:09", or "3d 02:14:09" a day or more ahead.
export function timerText(ms) {
  const total = Math.max(0, Math.floor(ms / 1000)), days = Math.floor(total / 86400), rest = total % 86400;
  const clock = [Math.floor(rest / 3600), Math.floor(rest / 60) % 60, rest % 60].map(n => String(n).padStart(2, '0')).join(':');
  return days ? t('{d}d {clock}', { d: days, clock }) : clock;
}

// The weekly maintenance under way at `now`, else the next one: { from, to, now } (ms), or
// null while superusers set none. window: { day, hour, hours } in UTC.
export function maintenanceWindow(now, window) {
  const index = weekDays.indexOf(window?.day);
  if (index < 0 || !(window.hours > 0)) return null;
  const at = new Date(now);
  let from = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() - ((at.getUTCDay() - index + 7) % 7), window.hour);
  if (from + window.hours * hour <= now) from += 7 * day;
  return { from, to: from + window.hours * hour, now: from <= now };
}

// The clock's rules with the defaults filled in, or null while superusers pause the clock.
export function clockRules(clock) {
  if (clock?.paused) return null;
  const hours = Array.isArray(clock?.tickHours) && clock.tickHours.length ? clock.tickHours : defaultClock.tickHours;
  return { tickHours: hours, tick: clock?.tick > 0 ? clock.tick : defaultClock.tick, caps: Array.isArray(clock?.caps) && clock.caps.length ? clock.caps : defaultClock.caps };
}
// What the natural pool gains in a day of regeneration.
export const perDay = rules => rules.tickHours.length * rules.tick;
// When an empty natural pool that starts filling at `now` reaches `cap`: the tick that fills it.
export function fillsAt(now, cap, rules) {
  const ticks = Math.ceil(cap / rules.tick);
  return ticksAfter(now, now + 400 * day, rules.tickHours, ticks).at(-1) ?? null;
}
// The membership's word for a cap: with two caps the larger comes with the membership.
export function capWord(cap, caps) {
  if (caps.length !== 2) return '';
  return cap === Math.max(...caps) ? t('with the membership') : t('without the membership');
}
// A number of cubes a day or a pool gives, with one decimal when it is not whole.
const cubes = n => n.toLocaleString(locale(), { maximumFractionDigits: 1 });

// The moments the page counts down to; the page is drawn again once one of them passes.
export function timerTargets(game, now) {
  const resets = game?.resets || resetDefaults, rules = clockRules(game?.clock), down = maintenanceWindow(now, game?.maintenance);
  return {
    daily: nextReset('daily', now, resets),
    weekly: nextReset('weekly', now, resets),
    tick: rules ? ticksAfter(now, now + 2 * day, rules.tickHours, 1)[0] ?? null : null,
    maintenance: down ? (down.now ? down.to : down.from) : null,
  };
}

const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } };
const clockTime = at => new Date(at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
const shortDayTime = at => new Date(at).toLocaleString(locale(), { weekday: 'short', hour: '2-digit', minute: '2-digit' });
const utcHour = h => `${String(h).padStart(2, '0')}:00 UTC`;

function timerCard({ title, glyph, at, now, line, live = false, note = '' }) {
  return `<article class="timer-card${live ? ' is-live' : ''}"><h2>${icon(glyph)}<span>${title}</span></h2><strong class="timer-value" data-timer="${at}">${esc(timerText(at - now))}</strong><p>${line}</p>${note ? `<small>${note}</small>` : ''}</article>`;
}

// The page. game: the answer of GET /api/odyle/game, or null while it loads; signedIn says
// which way the call to action leads.
export function timersView({ game, now, signedIn = false, failed = false }) {
  const where = zone(), heading = `<section class="heading"><div><div class="eyebrow"><span class="tiny-diamond"></span> ${t('AION 2 · GLOBAL')}</div><h1>${t('Timers')}<span class="mint">.</span></h1><p>${esc(where ? t('Resets, Odyle regeneration and maintenance in your time ({zone}).', { zone: where }) : t('Resets, Odyle regeneration and maintenance in your time.'))}</p></div><span class="refresh-label"><i></i>${t('No sign-in needed')}</span></section>`;
  if (!game) return `<main class="dashboard timers-page">${heading}<p class="intro">${failed ? t('The timers could not be loaded. They try again in a moment.') : t('Loading…')}</p></main>`;
  const resets = game.resets || resetDefaults, rules = clockRules(game.clock), targets = timerTargets(game, now), down = maintenanceWindow(now, game.maintenance);
  const hourUtc = resetHour(resets), weekday = t(dayName(resets));
  const cards = [
    timerCard({ title: t('Daily reset'), glyph: 'clock', at: targets.daily, now, line: esc(t('Every day at {time} your time', { time: clockTime(targets.daily) })), note: esc(utcHour(hourUtc)) }),
    timerCard({ title: t('Weekly reset'), glyph: 'calendar', at: targets.weekly, now, line: esc(t('{day} at {time} your time', { day: capitalize(new Date(targets.weekly).toLocaleDateString(locale(), { weekday: 'long' })), time: clockTime(targets.weekly) })), note: esc(t('{day} {time}', { day: weekday, time: utcHour(hourUtc) })) }),
    rules && targets.tick ? timerCard({ title: t('Next Odyle tick'), glyph: 'bolt', at: targets.tick, now, line: esc(t('+{tick} to the natural pool at {time}', { tick: rules.tick, time: clockTime(targets.tick) })), note: esc(tn(rules.tickHours.length, '{n} tick a day', '{n} ticks a day')) }) : '',
    down ? timerCard({ title: down.now ? t('Maintenance under way') : t('Weekly maintenance'), glyph: 'gear', at: targets.maintenance, now, live: down.now, line: esc(down.now ? t('Ends at {time} your time', { time: clockTime(down.to) }) : t('{from} to {to} your time', { from: shortDayTime(down.from), to: clockTime(down.to) })), note: esc(tn(game.maintenance.hours, 'Every week, {n} hour', 'Every week, {n} hours')) }) : '',
  ].join('');
  return `<main class="dashboard timers-page">${heading}<div class="timer-grid">${cards}</div>${rules ? regeneration(rules, now, game.odylePerCube) : `<section class="party-section"><p class="wish-note">${t('The Odyle clock is paused by the server\'s operators, most likely after a game patch, so the regeneration times are hidden until it is checked again.')}</p></section>`}${dungeonTable(game, rules)}${callToAction(signedIn)}</main>`;
}
const capitalize = text => text ? text[0].toUpperCase() + text.slice(1) : text;

// The natural pool: the ticks of the next day, how long an empty pool takes to fill to each
// cap, and what a day of regeneration is worth.
function regeneration(rules, now, perCube = 40) {
  const ticks = ticksAfter(now, now + day, rules.tickHours);
  const strip = ticks.map((at, i) => `<li class="${i === 0 ? 'is-next' : ''}"><time datetime="${new Date(at).toISOString()}">${esc(clockTime(at))}</time><span>+${rules.tick}</span></li>`).join('');
  const fills = [...rules.caps].sort((a, b) => b - a).map(cap => {
    const at = fillsAt(now, cap, rules), word = capWord(cap, rules.caps);
    return `<div class="fill-row"><strong>${esc(cap.toLocaleString(locale()))}</strong><div><span>${esc(word ? t('A full natural pool {word}', { word }) : t('A full natural pool'))}</span><small>${esc(t('From empty in {time} ({ticks} ticks): full on {when} if it starts now', { time: remaining(at - now), ticks: Math.ceil(cap / rules.tick), when: shortDayTime(at) }))}</small></div></div>`;
  }).join('');
  const daily = perDay(rules), cost = perCube > 0 ? perCube : 40;
  const hours = rules.tickHours.map(h => `${String(h).padStart(2, '0')}:00`).join(', ');
  return `<section class="party-section"><div class="section-heading"><h2>${t('Odyle regeneration')} <span>${esc(tn(rules.tickHours.length, '{n} tick a day', '{n} ticks a day'))}</span></h2></div>
<div class="wish-panel timers-panel"><p class="timers-lead">${esc(t('The natural pool gains {tick} at {hours} UTC. The next 24 hours in your time:', { tick: rules.tick, hours }))}</p><ol class="tick-strip">${strip}</ol>
<div class="fill-list">${fills}<div class="fill-row"><strong>+${esc(daily.toLocaleString(locale()))}</strong><div><span>${t('A day of regeneration')}</span><small>${esc(t('Worth {cubes} cubes at {cost} Odyle per cube', { cubes: cubes(daily / cost), cost }))}</small></div></div></div>
<p class="wish-note">${t('A natural pool at its cap loses every tick, so spend it before it is full. Odyle from items never regenerates and is not capped.')}</p></div></section>`;
}

// The dungeon catalog the server keeps: what a cube of each dungeon costs, its party and how
// many cubes of it a day of regeneration and a full natural pool are worth.
function dungeonTable(game, rules) {
  const catalog = Array.isArray(game.catalog) ? game.catalog : [];
  if (!catalog.length) return '';
  const perCube = game.odylePerCube > 0 ? game.odylePerCube : 40, cap = rules ? Math.max(...rules.caps) : 0;
  const rows = catalog.map(d => {
    const cost = cubeCost(d, perCube);
    return `<tr><th scope="row">${esc(d.name)}${d.category ? `<small>${esc(d.category)}</small>` : ''}</th><td>${esc(cost.toLocaleString(locale()))}${d.unconfirmed ? ` <small>${t('unconfirmed')}</small>` : ''}</td><td>${d.partySize ? esc(tn(d.partySize, '{n} player', '{n} players')) : '—'}</td>${rules ? `<td>${esc(cubes(perDay(rules) / cost))}</td><td>${esc(cubes(Math.floor(cap / cost)))}</td>` : ''}</tr>`;
  }).join('');
  const head = `<tr><th scope="col">${t('Dungeon')}</th><th scope="col">${t('Odyle per cube')}</th><th scope="col">${t('Party')}</th>${rules ? `<th scope="col">${t('Cubes a day')}</th><th scope="col">${t('Cubes in a full pool')}</th>` : ''}</tr>`;
  const note = rules ? `<p class="table-note">${esc(t('Cubes a day: what a day of regeneration (+{daily}) pays for. Cubes in a full pool: a full natural pool of {cap}.', { daily: perDay(rules).toLocaleString(locale()), cap: cap.toLocaleString(locale()) }))}</p>` : '';
  return `<section class="party-section"><div class="section-heading"><h2>${t('Dungeon cubes')} <span>${catalog.length}</span></h2></div><div class="wish-panel"><div class="table-scroll"><table class="timers-table"><thead>${head}</thead><tbody>${rows}</tbody></table></div>${note}</div></section>`;
}

// What Odyle does beyond the timers: signed out, the way in; signed in, the account's own pages.
function callToAction(signedIn) {
  if (signedIn) return `<section class="party-section timers-cta"><div class="setup-card"><h2>${t('Your own characters')}</h2><p>${t('Your characters\' cards show their natural pool, its next tick and when it is full, and cap alerts warn you before a tick is lost.')}</p><div class="timers-actions"><a class="button primary" href="${link('/')}">${t('My rooms & characters')} ${icon('arrow')}</a><a class="button secondary" href="${link('/week')}">${t('Your week in Odyle')}</a><a class="button secondary" href="${link('/tasks')}">${t('Daily & weekly')}</a></div></div></section>`;
  return `<section class="party-section timers-cta"><div class="setup-card"><div class="setup-icon">${icon('people')}</div><h2>${t('Let Odyle keep these for your whole party')}</h2><p>${t('The Windows reader reads each character\'s Odyle from your own game. Your party then sees who can open how many cubes, when every natural pool is full and when the next run starts, with alerts before a tick is lost.')}</p><div class="timers-actions"><button class="button discord-button" data-action="discord">${t('Continue with Discord')} ${icon('arrow')}</button><button class="button secondary" data-action="demo">${t('Explore the demo workspace')}</button><a class="button secondary" href="${link('/achievements')}">${t('See the achievements')}</a></div><small>${t('Free, no separate password. Unofficial fan project.')}</small></div></section>`;
}
