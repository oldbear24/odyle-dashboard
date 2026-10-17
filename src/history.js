import { t, tn, locale } from './i18n.js';
import { escape as esc, timestamp } from './model.js';
import { periodStart, defaults as resetDefaults } from './tasks.js';
// Odyle history of one character: a step line (a value holds until the next change)
// from its first change in the last 30 days to now, over a 10% wash. One series, so
// the dialog title names it and no legend is drawn. A hairline marks one cube; the
// crosshair snaps to the changes and the list below is the table view.
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
export function historyChart(readings, { now, cost }) {
  if (!readings.length) return `<p class="history-empty">${t('No changes in the last 30 days.')}</p>`;
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
// Newest first, each with the change from the value before it. With hourlyBefore (a
// character with more than 1,000 changes) the points before that time are each hour's
// last change, so the changes left out are at least as many as the points.
// What a change was, when the Windows app said (newer apps send it with each reading).
const kinds = { regen: 'regeneration', spend: 'spent', item: 'item' };
export function historyList(readings, limit = 12, hourlyBefore = null) {
  const rows = readings.map((r, i) => ({ ...r, delta: i ? r.value - readings[i - 1].value : null })).reverse().slice(0, limit);
  const more = readings.length - rows.length, left = hourlyBefore ? tn(more, 'At least {n} earlier change not listed', 'At least {n} earlier changes not listed') : tn(more, '{n} earlier change not listed', '{n} earlier changes not listed');
  return `<table class="history-table"><thead><tr><th>${t('Changed')}</th><th>${t('Odyle')}</th><th>${t('Change')}</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(new Date(timestamp(r.at)).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</td><td>${r.value.toLocaleString(locale())}</td><td>${r.delta === null ? '—' : (r.delta > 0 ? '+' : r.delta < 0 ? '−' : '±') + Math.abs(r.delta).toLocaleString(locale())}${kinds[r.kind] ? ` <span class="history-kind">${esc(t(kinds[r.kind]))}</span>` : ''}</td></tr>`).join('')}</tbody></table>${more > 0 ? `<p class="history-more">${esc(left)}${rows.length < readings.length && limit < readings.length ? ` <button class="text-button" type="button" data-history-all>${t('Show all')}</button>` : ''}</p>` : ''}`;
}
// The week by week ledger (#42): for each reset week of the 30 days, newest first, what the
// changes the reader saw add up to: Odyle spent (and about how many cubes at the cost),
// natural regeneration and item top-ups. A change without its kind (older apps) counts as
// spent when the value dropped and as other gains when it rose. Spends on a PC without the
// reader show up as a drop at the next reading, so the ledger is as complete as the readings.
export function weeklyLedger(readings, { now, cost, resets = resetDefaults }) {
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
  const current = periodStart('weekly', now, resets);
  return [...weeks.values()].sort((a, b) => b.start - a.start).map(row => ({ ...row, current: row.start === current, end: row.start + week, cubes: cost > 0 ? Math.floor(row.spent / cost) : 0 }));
}
export function ledgerTable(rows, { hourlyBefore = null } = {}) {
  if (!rows.length) return '';
  const number = v => v.toLocaleString(locale()), label = row => row.current ? t('This week') : t('Week from {date}', { date: new Date(row.start).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }) });
  const body = rows.map(row => `<tr><td>${esc(label(row))}</td><td>${row.spent ? esc(t('{odyle} · ≈{cubes}', { odyle: number(row.spent), cubes: tn(row.cubes, '{n} cube', '{n} cubes') })) : '–'}</td><td>${row.regen ? '+' + number(row.regen) : '–'}</td><td>${row.items || row.other ? '+' + number(row.items + row.other) : '–'}</td></tr>`).join('');
  const note = t('From the changes the reader saw: a spend on a PC without the reader shows as a drop at the next reading.') + (hourlyBefore ? ' ' + t('Before {date} only the last change of each hour is kept, so those weeks are incomplete.', { date: new Date(timestamp(hourlyBefore)).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }) }) : '');
  return `<h3 class="modal-sub">${t('By week')}</h3><table class="history-table ledger"><thead><tr><th>${t('Week')}</th><th>${t('Spent')}</th><th>${t('Regeneration')}</th><th>${t('Items and other')}</th></tr></thead><tbody>${body}</tbody></table><small class="account-note">${esc(note)}</small>`;
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
