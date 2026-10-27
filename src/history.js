import { t, tn, locale } from './i18n.js';
import { escape as esc, timestamp } from './model.js';
import { periodStart, defaults as resetDefaults } from './tasks.js';
import { capsOf, tickOf, ticksAfter } from './clock.js';
import { pageOf, pager, fillers } from './pager.js';
// Odyle history of one character: a step line (a value holds until the next change)
// from its first change in the chosen period (30 days unless the reader picks another,
// up to as long as the server keeps it) to now, over a 10% wash. One series, so the dialog
// title names it and no legend is drawn. A hairline marks one cube; the crosshair snaps to
// the changes and the list below, a page at a time, is the table view.
const width = 560, height = 190, pad = { top: 12, right: 14, bottom: 24, left: 40 };
// Rounds an axis maximum up to a clean number: 1, 1.5, 2, 2.5, 3, 4, 5, 6 or 8 times a power of ten.
export function niceMax(value) {
  if (!(value > 0)) return 10;
  const power = 10 ** Math.floor(Math.log10(value)), step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(s => s * power >= value);
  return step * power;
}
const compact = value => value >= 1000 ? (value / 1000).toLocaleString(locale(), { maximumFractionDigits: 1 }) + 'K' : value.toLocaleString(locale());
// Time-axis labels: clock times within two days, weekday and hour within a week, dates beyond.
const stamp = (at, span) => new Date(at).toLocaleString(locale(), span < 2 * 86400000 ? { hour: '2-digit', minute: '2-digit' } : span < 7 * 86400000 ? { weekday: 'short', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short' });
export function historyChart(readings, { now, cost, days = 30 }) {
  if (!readings.length) return `<p class="history-empty">${esc(tn(days, 'No changes in the last {n} day.', 'No changes in the last {n} days.'))}</p>`;
  const points = readings.map(r => ({ at: timestamp(r.at), value: r.value })), first = points[0].at, last = points[points.length - 1];
  const end = Math.max(now, last.at + 60000), top = niceMax(Math.max(cost, ...points.map(p => p.value)) * 1.1);
  const x = at => pad.left + (at - first) / (end - first) * (width - pad.left - pad.right), y = value => pad.top + (1 - value / top) * (height - pad.top - pad.bottom);
  let line = `M${x(first)},${y(points[0].value)}`;
  for (const p of points.slice(1)) line += `H${x(p.at)}V${y(p.value)}`;
  line += `H${x(end)}`;
  const grid = [0, top / 2, top].map(v => `<line class="history-grid" x1="${pad.left}" x2="${width - pad.right}" y1="${y(v)}" y2="${y(v)}"/><text class="history-axis" x="${pad.left - 6}" y="${y(v) + 3}" text-anchor="end">${compact(v)}</text>`).join('');
  const ticks = [0, 1, 2, 3].map(i => first + (end - first) * i / 3).map((at, i) => `<text class="history-axis" x="${x(at)}" y="${height - 6}" text-anchor="${['start', 'middle', 'middle', 'end'][i]}">${esc(stamp(at, end - first))}</text>`).join('');
  const cube = cost <= top ? `<line class="history-cost" x1="${pad.left}" x2="${width - pad.right}" y1="${y(cost)}" y2="${y(cost)}"/><text class="history-axis" x="${width - pad.right}" y="${y(cost) - 4}" text-anchor="end">${esc(t('1 cube · {cost}', { cost: cost.toLocaleString(locale()) }))}</text>` : '';
  const data = points.map(p => [p.at, p.value, x(p.at), y(p.value)]);
  return `<figure class="history-chart" data-points="${esc(JSON.stringify(data))}"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(t('Odyle over time'))}">${grid}${cube}<path class="history-area" d="${line}V${y(0)}H${x(first)}Z"/><path class="history-line" d="${line}"/><line class="history-cross" y1="${pad.top}" y2="${height - pad.bottom}" x1="0" x2="0" visibility="hidden"/><circle class="history-dot" cx="${x(end)}" cy="${y(last.value)}" r="4"/><circle class="history-focus" r="4" cx="0" cy="0" visibility="hidden"/>${ticks}<rect class="history-hit" x="${pad.left}" y="0" width="${width - pad.left - pad.right}" height="${height}"/></svg><div class="history-tip" hidden></div></figure>`;
}
// When a change or place was: the day and time, with the year when it is not this one.
export const changedAt = (at, now = Date.now()) => { const date = new Date(timestamp(at)); return date.toLocaleString(locale(), { day: 'numeric', month: 'short', ...(date.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}), hour: '2-digit', minute: '2-digit' }); };
// The periods the dialog offers: a week, 30 and 90 days and a year, up to and with how long
// the server keeps the history (the last one, which may be none of those).
export const periods = keep => [...[7, 30, 90, 365].filter(days => days < keep), keep];
export const periodName = days => days % 365 === 0 ? tn(days / 365, '{n} year', '{n} years') : tn(days, '{n} day', '{n} days');
export function periodSwitch(days, keep) {
  const choices = periods(keep);
  return choices.length > 1 ? `<div class="segmented" role="group" aria-label="${esc(t('Period'))}">${choices.map(d => `<button type="button" data-history-days="${d}" aria-pressed="${d === days}">${esc(periodName(d))}</button>`).join('')}</div>` : '';
}
// The changes of an answer that lists each one (no hourlyBefore), newest first, each with
// how much it moved the value from the change before it: what the server's pages carry.
export const changesOf = readings => readings.map((r, i) => ({ ...r, change: i ? r.value - readings[i - 1].value : null })).reverse();
// One page of them, shaped like the server's page.
export function changesPage(readings, page, perPage) {
  const { items, ...rest } = pageOf(changesOf(readings), page, perPage);
  return { changes: items, ...rest };
}
// What a change was, when the Windows app said (newer apps send it with each reading).
const kinds = { regen: 'regeneration', spend: 'spent', item: 'item' };
const changeText = change => change === null || change === undefined ? '—' : (change > 0 ? '+' : change < 0 ? '−' : '±') + Math.abs(change).toLocaleString(locale());
// A page of changes (changesPage, or a page from the server), with the buttons to the others.
export function changesTable(page, now = Date.now()) {
  if (!page?.total) return '';
  const rows = page.changes.map(r => `<tr><td>${esc(changedAt(r.at, now))}</td><td>${r.value.toLocaleString(locale())}</td><td>${changeText(r.change)}${kinds[r.kind] ? ` <span class="history-kind">${esc(t(kinds[r.kind]))}</span>` : ''}</td></tr>`).join('');
  return `<section class="history-section history-changes"><h3 class="modal-sub">${t('Changes')} <span class="modal-count">${page.total.toLocaleString(locale())}</span></h3><table class="history-table"><thead><tr><th>${t('Changed')}</th><th>${t('Odyle')}</th><th>${t('Change')}</th></tr></thead><tbody>${rows}${fillers(page, page.changes.length, 3)}</tbody></table>${pager(page, 'data-history-page', t('Pages of changes'))}</section>`;
}
// The week by week ledger (#42): for each reset week of the 30 days, newest first, what the
// changes the reader saw add up to: Odyle spent (and about how many cubes at the cost),
// natural regeneration and item top-ups. A change without its kind (older apps) counts as
// spent when the value dropped and as other gains when it rose. Spends on a PC without the
// reader show up as a drop at the next reading, so the ledger is as complete as the readings.
// Hours at the cap and regeneration lost, by reset week (#42): from each reading that carried
// the natural pool (parts.base) to the next one (or now), the pool grows by the tick at the
// tick hours up to the cap, as the clock estimates it (clock.js); while it is full, each tick
// is lost. Only with a settled cap and readings that carry the pool, else null. An estimate:
// a spend on a PC without the reader stays unseen until the next reading.
export function capWeeks(readings, { now, clock, character, resets = resetDefaults }) {
  if (!clock || clock.paused || !character || !readings.some(r => Number.isFinite(r.parts?.base))) return null;
  const caps = capsOf(character, clock);
  if (caps.length !== 1) return null;
  const cap = caps[0], tick = tickOf(character, clock), week = 7 * 86400000, out = new Map();
  const add = (at, key, value) => { const start = periodStart('weekly', at, resets), row = out.get(start) || { capMs: 0, lost: 0 }; row[key] += value; out.set(start, row); };
  const full = (from, until) => { for (let at = from; at < until;) { const end = Math.min(until, periodStart('weekly', at, resets) + week); add(at, 'capMs', end - at); at = end; } };
  readings.forEach((r, i) => {
    const base = r.parts?.base;
    if (!Number.isFinite(base)) return;
    const from = timestamp(r.at), until = i + 1 < readings.length ? timestamp(readings[i + 1].at) : now;
    let pool = base, fullFrom = pool >= cap ? from : null;
    for (const at of ticksAfter(from, until, clock.tickHours)) {
      if (pool + tick > cap) add(at, 'lost', pool + tick - Math.max(pool, cap));
      if (pool < cap && pool + tick >= cap) fullFrom = at;
      pool = Math.max(pool, Math.min(cap, pool + tick));
    }
    if (fullFrom !== null && until > fullFrom) full(fullFrom, until);
  });
  return out;
}
export function weeklyLedger(readings, { now, cost, resets = resetDefaults, clock = null, character = null }) {
  if (readings.length < 2) return [];
  const week = 7 * 86400000, weeks = new Map();
  for (let i = 1; i < readings.length; i++) {
    const r = readings[i], at = timestamp(r.at), delta = Number.isFinite(r.delta) && r.kind ? r.delta : r.value - readings[i - 1].value;
    if (!delta) continue;
    const start = periodStart('weekly', at, resets), row = weeks.get(start) || { start, spent: 0, regen: 0, items: 0, other: 0 };
    if (r.kind === 'regen') row.regen += delta;
    else if (r.kind === 'item') row.items += delta;
    else if (r.kind === 'spend' || delta < 0) row.spent += Math.abs(delta);
    else row.other += delta;
    weeks.set(start, row);
  }
  const current = periodStart('weekly', now, resets), capped = capWeeks(readings, { now, clock, character, resets });
  // A week the character spent full without a change still gets its row.
  for (const start of capped?.keys() || []) if (!weeks.has(start)) weeks.set(start, { start, spent: 0, regen: 0, items: 0, other: 0 });
  return [...weeks.values()].sort((a, b) => b.start - a.start).map(row => ({ ...row, current: row.start === current, end: row.start + week, cubes: cost > 0 ? Math.floor(row.spent / cost) : 0, ...(capped ? { capHours: Math.round((capped.get(row.start)?.capMs || 0) / 3600000), lost: capped.get(row.start)?.lost || 0 } : {}) }));
}
// The ledger shows six weeks a page.
export const weeksPerPage = 6;
export function ledgerTable(all, { hourlyBefore = null, thinnedTo = 'hour', page = 1 } = {}) {
  if (!all.length) return '';
  const paged = pageOf(all, page, weeksPerPage), rows = paged.items;
  const number = v => v.toLocaleString(locale()), label = row => row.current ? t('This week') : t('Week from {date}', { date: new Date(row.start).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }) });
  const capped = all.some(row => 'capHours' in row), full = row => row.capHours || row.lost ? esc(t('≈{hours} h · {lost} lost', { hours: number(row.capHours), lost: number(row.lost) })) : '–';
  const body = rows.map(row => `<tr><td>${esc(label(row))}</td><td>${row.spent ? esc(t('{odyle} · ≈{cubes}', { odyle: number(row.spent), cubes: tn(row.cubes, '{n} cube', '{n} cubes') })) : '–'}</td><td>${row.regen ? '+' + number(row.regen) : '–'}</td><td>${row.items || row.other ? '+' + number(row.items + row.other) : '–'}</td>${capped ? `<td>${full(row)}</td>` : ''}</tr>`).join('');
  const thinned = hourlyBefore ? { date: new Date(timestamp(hourlyBefore)).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }) } : null;
  const note = t('From the changes the reader saw: a spend on a PC without the reader shows as a drop at the next reading.') + (capped ? ' ' + t('At the cap is an estimate from the clock between readings: the hours the natural pool was full and the regeneration it could not take.') : '') + (thinned ? ' ' + (thinnedTo === 'day' ? t('Before {date} only the last change of each day is counted, so those weeks are incomplete.', thinned) : t('Before {date} only the last change of each hour is kept, so those weeks are incomplete.', thinned)) : '');
  return `<section class="history-section history-weeks"><h3 class="modal-sub">${t('By week')}</h3><table class="history-ledger"><thead><tr><th>${t('Week')}</th><th>${t('Spent')}</th><th>${t('Regeneration')}</th><th>${t('Items and other')}</th>${capped ? `<th>${t('At the cap')}</th>` : ''}</tr></thead><tbody>${body}${fillers(paged, rows.length, capped ? 5 : 4)}</tbody></table>${pager(paged, 'data-history-week', t('Pages of weeks'))}<small class="account-note">${esc(note)}</small></section>`;
}
// The dialog's body: the period, the chart and the weeks, beside a page of changes. `changes`
// is the page shown (changesPage, or one from the server when the answer is thinned).
export function historyBody({ data, changes, week = 1, now, cost, resets = resetDefaults, clock = null }) {
  const days = data.days || 30, keep = data.keepDays || days, by = data.thinnedTo || 'hour';
  const about = !data.hourlyBefore ? tn(days, 'Every change in the last {n} day. A value holds until the next change; the line marks one cube.', 'Every change in the last {n} days. A value holds until the next change; the line marks one cube.')
    : by === 'day' ? tn(days, 'The last {n} day: the newest 1,000 changes, and before them the last change of each day. A value holds until the next change; the line marks one cube.', 'The last {n} days: the newest 1,000 changes, and before them the last change of each day. A value holds until the next change; the line marks one cube.')
      : tn(days, 'The last {n} day: the newest 1,000 changes, and before them the last change of each hour. A value holds until the next change; the line marks one cube.', 'The last {n} days: the newest 1,000 changes, and before them the last change of each hour. A value holds until the next change; the line marks one cube.');
  return `<div class="history-main"><div class="history-head">${periodSwitch(days, keep)}<p class="history-about">${esc(about)}</p></div>${historyChart(data.readings, { now, cost, days })}${ledgerTable(weeklyLedger(data.readings, { now, cost, resets, clock, character: data.character }), { hourlyBefore: data.hourlyBefore, thinnedTo: by, page: week })}</div>${changesTable(changes, now)}`;
}
// Crosshair and tooltip: the pointer picks the nearest change on the time axis.
export function bindHistoryChart(figure) {
  const svg = figure?.querySelector('svg'); if (!svg) return;
  const data = JSON.parse(figure.dataset.points), cross = svg.querySelector('.history-cross'), focus = svg.querySelector('.history-focus'), tip = figure.querySelector('.history-tip');
  const hide = () => { cross.setAttribute('visibility', 'hidden'); focus.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  svg.addEventListener('pointermove', e => {
    const box = svg.getBoundingClientRect(), at = (e.clientX - box.left) / box.width * width;
    const [time, value, px, py] = data.reduce((best, p) => Math.abs(p[2] - at) < Math.abs(best[2] - at) ? p : best);
    cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
    focus.setAttribute('cx', px); focus.setAttribute('cy', py); focus.setAttribute('visibility', 'visible');
    tip.textContent = t('{value} Odyle · {when}', { value: value.toLocaleString(locale()), when: new Date(time).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) });
    tip.hidden = false; tip.style.left = Math.min(Math.max(px / width * box.width, 70), box.width - 70) + 'px';
  });
  svg.addEventListener('pointerleave', hide);
}
