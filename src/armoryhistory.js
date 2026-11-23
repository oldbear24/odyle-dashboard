// How a character progressed (the Progress panel of a profile's Gear & stats tab, and the change
// under the hero's combat power): the backend keeps one point a UTC day of each character the
// armory keeps, its combat power, item level and level as PLAYNC's pages listed them, for 180
// days (backend/odyle/armoryhistory.go). Pure functions that return HTML strings, and
// bindProgress, which follows the pointer and the arrow keys over the chart.
//
// Two measures of different scales, so two small charts on one time axis instead of two y-axes:
// combat power above, item level below, each one line over a 10% wash, its title naming it. The
// crosshair snaps to the days and its readout lists both; the table under the chart lists every
// day. The two colours passed the dataviz palette check on the panel's surface.
import { t, tn, locale } from './i18n.js';
import { escape as esc, number } from './model.js';

const dayMs = 86400000;

// The days of a history the route sent, valid ones only, the oldest first.
export function historyPoints(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter(p => p && /^\d{4}-\d{2}-\d{2}$/.test(p.day) && Number(p.combatPower) > 0)
    .map(p => ({
      day: p.day,
      at: Date.parse(p.day + 'T00:00:00Z'),
      combatPower: Number(p.combatPower) || 0,
      itemLevel: Number(p.itemLevel) || 0,
      level: Number(p.level) || 0,
    }))
    .sort((a, b) => a.at - b.at);
}

// A day as the reader's language writes it ("3 Nov"), the year added when it is not the last
// day's.
export function dayName(day, lastDay = day) {
  const at = new Date(day + 'T00:00:00Z'),
    sameYear = day.slice(0, 4) === lastDay.slice(0, 4);
  return at.toLocaleDateString(locale(), {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

// How a measure changed up to the last day: from the last day at least `days` before it, or
// from the first day when the history is shorter (full false). null with fewer than 2 days.
export function changeOver(points, key, days) {
  if (points.length < 2) return null;
  const last = points[points.length - 1],
    edge = last.at - days * dayMs;
  const before = points.filter(p => p.at <= edge),
    base = before.length ? before[before.length - 1] : points[0];
  if (base === last) return null;
  const delta = last[key] - base[key];
  return {
    from: base[key],
    to: last[key],
    delta,
    percent: base[key] ? (delta / base[key]) * 100 : null,
    since: base.day,
    full: before.length > 0,
  };
}

const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '±') + number(Math.abs(n));
const signedPercent = n =>
  (n > 0 ? '+' : n < 0 ? '−' : '±') +
  Math.abs(n).toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) +
  ' %';

// The line under the hero's combat power: "+4.1 % in 30 days", or since the first day kept
// when that is less than 30 days ago; '' when the history has fewer than 2 days.
export function powerChange(history) {
  const points = historyPoints(history),
    change = changeOver(points, 'combatPower', 30);
  if (!change || change.percent === null) return '';
  return change.full
    ? t('{change} in 30 days', { change: signedPercent(change.percent) })
    : t('{change} since {date}', {
        change: signedPercent(change.percent),
        date: dayName(change.since, points[points.length - 1].day),
      });
}

// Rounds an axis range out to clean numbers: the tightest of two to four steps of 1, 2, 2.5 or 5
// times a power of ten that holds the values, with room above and below a flat line; never below
// zero. The ticks are the steps' ends, the highest first.
export function niceRange(min, max) {
  if (!(max > min)) {
    const pad = Math.max(1, Math.abs(max) * 0.02);
    min -= pad;
    max += pad;
  }
  const power = 10 ** Math.floor(Math.log10((max - min) / 4));
  const steps = [1, 10, 100].flatMap(m => [1, 2, 2.5, 5].map(s => s * m * power));
  let best = null;
  for (const count of [2, 3, 4]) {
    const step = steps.find(s => Math.max(0, Math.floor(min / s) * s) + count * s >= max);
    if (!step) continue;
    const low = Math.max(0, Math.floor(min / step) * step);
    if (!best || count * step < best.high - best.low) best = { low, high: low + count * step, step, count };
  }
  const ticks = Array.from({ length: best.count + 1 }, (_, i) => best.high - i * best.step);
  return { low: best.low, high: best.high, ticks };
}

const compact = value =>
  value >= 10000 ? (value / 1000).toLocaleString(locale(), { maximumFractionDigits: 1 }) + 'K' : number(value);

// The chart's geometry: each day's x (0 to 100, % of the width) and its y in each measure (0 at
// the top to 100 at the bottom, %), with each measure's axis.
export function chartGeometry(points) {
  const first = points[0].at,
    span = points[points.length - 1].at - first || 1;
  const axis = key => niceRange(Math.min(...points.map(p => p[key])), Math.max(...points.map(p => p[key])));
  const power = axis('combatPower'),
    item = axis('itemLevel');
  const y = (range, v) => (range.high === range.low ? 50 : (1 - (v - range.low) / (range.high - range.low)) * 100);
  return {
    power,
    item,
    days: points.map(p => ({
      ...p,
      x: points.length === 1 ? 100 : ((p.at - first) / span) * 100,
      power: y(power, p.combatPower),
      item: y(item, p.itemLevel),
    })),
  };
}

const round = n => Math.round(n * 100) / 100;

// One small chart: gridlines at its ticks, the wash and the line (drawn in a 1000 × 100 box
// stretched to the plot, strokes kept at 2px), its labels and dots as HTML on top, so they keep
// their size at any width.
function plot(kind, title, value, range, days, key) {
  const pathOf = days.map((d, i) => `${i ? 'L' : 'M'}${round(d.x * 10)},${round(d[key])}`).join(''),
    first = days[0],
    last = days[days.length - 1];
  const grid = range.ticks
    .map(v => {
      const top = round((1 - (v - range.low) / (range.high - range.low || 1)) * 100);
      return `<line x1="0" x2="1000" y1="${top}" y2="${top}"/>`;
    })
    .join('');
  const labels = range.ticks
    .map(v => {
      const top = round((1 - (v - range.low) / (range.high - range.low || 1)) * 100);
      return `<span class="growth-y" style="top:${top}%">${esc(compact(v))}</span>`;
    })
    .join('');
  return `<div class="growth-plot is-${kind}"><p class="growth-plot-title"><i class="growth-key" aria-hidden="true"></i>${esc(title)} <strong>${esc(value)}</strong></p><div class="growth-area">${labels}<svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true" focusable="false"><g class="growth-grid">${grid}</g><path class="growth-wash" d="${pathOf}L${round(last.x * 10)},100L${round(first.x * 10)},100Z"/><path class="growth-line" d="${pathOf}"/></svg><span class="growth-dot" style="left:${round(last.x)}%;top:${round(last[key])}%" aria-hidden="true"></span><span class="growth-focus" aria-hidden="true" hidden></span></div></div>`;
}

// A stat tile: what it measures, its value and a note under it.
const tile = (label, value, note, direction = 0) =>
  `<li class="growth-tile"><span>${esc(label)}</span><strong${direction > 0 ? ' class="is-up"' : direction < 0 ? ' class="is-down"' : ''}>${esc(value)}</strong>${note ? `<small>${esc(note)}</small>` : ''}</li>`;

// The Progress panel: stat tiles, the two charts and the table of the days; with fewer than two
// days a sentence saying the history starts with this reading.
export function progressPanel(history) {
  const points = historyPoints(history);
  const heading = `<div class="section-heading"><h2 id="armory-growth-title">${t('Progress')}</h2>${points.length ? `<small>${esc(tn(points.length, '{n} day kept since {date}', '{n} days kept since {date}', { date: dayName(points[0].day, points[points.length - 1].day) }))}</small>` : ''}</div>`;
  if (points.length < 2)
    return `<section class="armory-panel armory-growth" aria-labelledby="armory-growth-title">${heading}<p class="armory-empty">${t('The history of this character starts with this reading. Odyle keeps one point a day, so the chart fills in as PLAYNC lists new combat power and item level.')}</p></section>`;
  const last = points[points.length - 1],
    lastDay = last.day,
    name = day => dayName(day, lastDay);
  const power = changeOver(points, 'combatPower', 30),
    item = changeOver(points, 'itemLevel', 100000),
    best = points.reduce((a, b) => (b.combatPower > a.combatPower ? b : a));
  const tiles = [
    tile(
      power.full ? t('Combat power, last 30 days') : t('Combat power since {date}', { date: name(power.since) }),
      `${signed(power.delta)} CP`,
      power.percent === null ? '' : signedPercent(power.percent),
      Math.sign(power.delta),
    ),
    tile(
      t('Item level since {date}', { date: name(item.since) }),
      signed(item.delta),
      `${number(item.from)} → ${number(item.to)}`,
      Math.sign(item.delta),
    ),
    tile(t('Highest combat power'), number(best.combatPower), t('on {date}', { date: name(best.day) })),
  ].join('');
  const geometry = chartGeometry(points),
    days = geometry.days;
  const data = days.map(d => [name(d.day), d.combatPower, d.itemLevel, round(d.x), round(d.power), round(d.item)]);
  const xLabels = [days[0], days[Math.floor((days.length - 1) / 2)], days[days.length - 1]]
    .filter((d, i, list) => list.indexOf(d) === i)
    .map(
      (d, i, list) =>
        `<span${i === 0 ? ' class="is-first"' : i === list.length - 1 ? ' class="is-last"' : ''} style="left:${round(d.x)}%">${esc(name(d.day))}</span>`,
    )
    .join('');
  const summary = t(
    'Combat power from {fromPower} on {from} to {toPower} on {to}; item level from {fromItem} to {toItem}. Use the arrow keys to read each day.',
    {
      fromPower: number(points[0].combatPower),
      toPower: number(last.combatPower),
      fromItem: number(points[0].itemLevel),
      toItem: number(last.itemLevel),
      from: name(points[0].day),
      to: name(lastDay),
    },
  );
  const rows = [...points]
    .reverse()
    .map(
      p =>
        `<tr><th scope="row">${esc(name(p.day))}</th><td>${number(p.combatPower)}</td><td>${number(p.itemLevel)}</td><td>${number(p.level)}</td></tr>`,
    )
    .join('');
  const chart = `<figure class="growth-chart" tabindex="0" role="group" aria-label="${esc(summary)}" data-days="${esc(JSON.stringify(data))}">${plot('power', t('Combat power'), number(last.combatPower), geometry.power, days, 'power')}${plot('item', t('Item level'), number(last.itemLevel), geometry.item, days, 'item')}<div class="growth-x" aria-hidden="true">${xLabels}</div><span class="growth-cross" aria-hidden="true" hidden></span><div class="growth-tip" aria-live="polite" hidden></div></figure>`;
  const table = `<details class="growth-table"><summary>${t('Every day as a table')}</summary><div class="growth-table-scroll"><table><thead><tr><th scope="col">${t('Day')}</th><th scope="col">${t('Combat power')}</th><th scope="col">${t('Item level')}</th><th scope="col">${t('Level')}</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
  return `<section class="armory-panel armory-growth" aria-labelledby="armory-growth-title">${heading}<ul class="growth-tiles">${tiles}</ul>${chart}${table}</section>`;
}

// The crosshair and readout: the pointer, or the arrow keys, Home and End while the chart has
// focus, pick a day; both measures of that day show in one readout.
export function bindProgress(figure) {
  if (!figure?.dataset.days) return;
  const days = JSON.parse(figure.dataset.days),
    cross = figure.querySelector('.growth-cross'),
    tip = figure.querySelector('.growth-tip'),
    focus = [...figure.querySelectorAll('.growth-focus')],
    area = figure.querySelector('.growth-area');
  let shown = -1;
  const show = index => {
    shown = Math.max(0, Math.min(days.length - 1, index));
    const [day, power, item, x, py, iy] = days[shown];
    const box = figure.getBoundingClientRect(),
      plotBox = area.getBoundingClientRect(),
      left = plotBox.left - box.left + (x / 100) * plotBox.width;
    cross.style.left = left + 'px';
    cross.hidden = false;
    focus.forEach((dot, i) => {
      dot.style.left = x + '%';
      dot.style.top = (i ? iy : py) + '%';
      dot.hidden = false;
    });
    tip.replaceChildren();
    const when = document.createElement('span');
    when.textContent = day;
    tip.append(when);
    for (const [kind, label, value] of [
      ['power', t('Combat power'), power],
      ['item', t('Item level'), item],
    ]) {
      const row = document.createElement('span'),
        key = document.createElement('i'),
        strong = document.createElement('strong');
      row.className = 'is-' + kind;
      key.className = 'growth-key';
      strong.textContent = number(value);
      row.append(key, strong, ' ' + label);
      tip.append(row);
    }
    tip.hidden = false;
    const width = tip.offsetWidth;
    tip.style.left = Math.min(Math.max(left, width / 2), box.width - width / 2) + 'px';
  };
  const hide = () => {
    shown = -1;
    cross.hidden = tip.hidden = true;
    focus.forEach(dot => (dot.hidden = true));
  };
  figure.addEventListener('pointermove', e => {
    const plotBox = area.getBoundingClientRect(),
      x = ((e.clientX - plotBox.left) / plotBox.width) * 100;
    let best = 0;
    days.forEach((d, i) => {
      if (Math.abs(d[3] - x) < Math.abs(days[best][3] - x)) best = i;
    });
    show(best);
  });
  figure.addEventListener('pointerleave', () => {
    if (document.activeElement !== figure) hide();
  });
  figure.addEventListener('focus', () => show(shown < 0 ? days.length - 1 : shown));
  figure.addEventListener('blur', hide);
  figure.addEventListener('keydown', e => {
    const to = { ArrowLeft: shown - 1, ArrowRight: shown + 1, Home: 0, End: days.length - 1 }[e.key];
    if (to === undefined || e.altKey || e.ctrlKey || e.metaKey) {
      if (e.key === 'Escape') figure.blur();
      return;
    }
    e.preventDefault();
    show(to);
  });
}
