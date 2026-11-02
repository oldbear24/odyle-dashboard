import { t, tn, locale } from './i18n.js';
import { escape as esc, timestamp, classOf } from './model.js';
import { icon } from './icons.js';
import { link } from './routes.js';
import { weeklyLedger } from './history.js';
import { periodStart } from './tasks.js';
import { achievementName } from './achievements.js';

// Your week in Odyle (/week): a reset week of the account's own characters summed up as the
// history's By week counts it (history.js weeklyLedger): Odyle spent and about how many cubes,
// regeneration, items, what the natural pools lost at the cap, the days the reader read and the
// achievements reached, beside the week before. Only the account sees it
// (GET /api/odyle/week); its picture and text to share are made here, in the browser, and go
// nowhere unless the player posts them.

const dayMs = 86400000, weekMs = 7 * dayMs;
const number = n => Math.round(n).toLocaleString(locale());

// The change a reading made, as weeklyLedger counts it: what a spend took, else a drop.
function spentAt(readings, i) {
  const r = readings[i], delta = Number.isFinite(r.delta) && r.kind ? r.delta : r.value - readings[i - 1].value;
  if (!delta || r.kind === 'regen' || r.kind === 'item') return 0;
  return r.kind === 'spend' || delta < 0 ? Math.abs(delta) : 0;
}

const empty = () => ({ spent: 0, cubes: 0, regen: 0, items: 0, other: 0, lost: 0, capHours: 0, capped: false });
function add(sum, row) {
  if (!row) return sum;
  for (const key of ['spent', 'cubes', 'regen', 'items', 'other']) sum[key] += row[key] || 0;
  if ('lost' in row) { sum.capped = true; sum.lost += row.lost; sum.capHours += row.capHours; }
  return sum;
}

// What the week came to: each character's row of the week and of the week before, their sums,
// the daily periods the reader read and the day the most Odyle was spent.
export function weekSummary(data, now) {
  const from = timestamp(data.week.from), until = from + weekMs, cost = data.odylePerCube > 0 ? data.odylePerCube : 40, resets = data.resets;
  const total = empty(), previous = empty(), days = new Set(), spentByDay = new Map();
  const characters = data.characters.map(c => {
    const readings = c.readings || [];
    const ledger = weeklyLedger(readings, { now, cost, resets, clock: data.clock, character: c });
    const row = ledger.find(r => r.start === from) || null, before = ledger.find(r => r.start === from - weekMs) || null;
    add(total, row); add(previous, before);
    readings.forEach((r, i) => {
      const at = timestamp(r.at);
      if (at < from || at >= until) return;
      const day = periodStart('daily', at, resets);
      days.add(day);
      if (i > 0) spentByDay.set(day, (spentByDay.get(day) || 0) + spentAt(readings, i));
    });
    return { ...c, week: row || empty() };
  }).sort((a, b) => Boolean(b.main) - Boolean(a.main) || b.week.spent - a.week.spent);
  const best = [...spentByDay.entries()].filter(([, spent]) => spent > 0).sort((a, b) => b[1] - a[1])[0] || null;
  return { from, until, cost, total, previous: data.week.previousKept ? previous : null, characters, days: days.size, best: best ? { day: best[0], spent: best[1], cubes: Math.floor(best[1] / cost) } : null, achievements: data.achievements || [] };
}

// The week's dates in the reader's language: "28 Oct – 3 Nov 2026", its first and last daily
// period named by their middle, so the reset hour never shifts them a day in the reader's zone.
const halfDay = dayMs / 2;
export function weekDates(from, until) {
  const last = new Date(until - halfDay), first = new Date(from + halfDay);
  const sameYear = first.getFullYear() === last.getFullYear();
  return `${first.toLocaleDateString(locale(), { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })} – ${last.toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

// How a number moved since the week before: "+4 vs the week before", or '' without one.
function versus(now, before) {
  if (before === null || before === undefined) return '';
  const change = now - before;
  return change === 0 ? t('same as the week before') : t('{change} vs the week before', { change: (change > 0 ? '+' : '−') + number(Math.abs(change)) });
}

// The text to paste in Discord: the week's numbers and the way to Odyle.
export function weekText(summary, address) {
  const { total } = summary, lines = [`**${t('My week in Odyle')}** (${weekDates(summary.from, summary.until)})`,
    `🎲 ${tn(total.cubes, '{n} cube opened', '{n} cubes opened')} · ${t('{spent} Odyle spent', { spent: number(total.spent) })}`,
    `⚡ ${t('+{regen} Odyle regenerated', { regen: number(total.regen) })}${total.capped ? ' · ' + (total.lost ? `💧 ${t('{lost} lost at the cap', { lost: number(total.lost) })}` : `💧 ${t('no tick lost at the cap')}`) : ''}`,
    `📅 ${tn(summary.days, '{n} day with the reader', '{n} days with the reader')}${summary.achievements.length ? ' · 🏆 ' + tn(summary.achievements.length, '{n} achievement', '{n} achievements') : ''}`,
    `${t('Odyle for your whole party:')} ${address}`];
  return lines.join('\n');
}

function metric(label, value, small, main = false) {
  return `<div class="metric${main ? ' is-main' : ''}"><span class="metric-label">${label}</span><strong>${value}</strong><small>${small || '&nbsp;'}</small></div>`;
}

// The page. data: the answer of GET /api/odyle/week, or null while it loads.
export function weekView({ data, now, failed = false, canShare = false }) {
  const back = data?.week?.back ?? 0, weeks = data?.week?.weeks ?? 0;
  const nav = data ? `<div class="heading-actions week-nav"><button class="button secondary" data-week-back="${back + 1}" ${back >= weeks ? 'disabled' : ''} title="${esc(t('The week before'))}"><span aria-hidden="true">‹</span> ${t('Earlier')}</button><button class="button secondary" data-week-back="${back - 1}" ${back <= 0 ? 'disabled' : ''} title="${esc(t('The week after'))}">${t('Later')} <span aria-hidden="true">›</span></button></div>` : '';
  const heading = (title, line) => `<section class="heading"><div><div class="eyebrow"><span class="tiny-diamond"></span> ${t('YOUR WEEK IN ODYLE')}</div><h1>${title}<span class="mint">.</span></h1><p>${line}</p></div>${nav}</section>`;
  if (!data) return `<main class="dashboard week-page">${heading(t('Your week'), t('Only you see it, until you share it.'))}<p class="intro">${failed ? t('Your week could not be loaded. Try again in a moment.') : t('Loading…')}</p></main>`;
  const s = weekSummary(data, now), title = esc(weekDates(s.from, s.until));
  const line = esc(data.week.complete ? t('A whole reset week, from reset to reset. Only you see it, until you share it.') : t('This week so far, until the weekly reset. Only you see it, until you share it.'));
  if (!s.characters.length) return `<main class="dashboard week-page">${heading(title, line)}<section class="party-section"><div class="info-panel"><h3>${t('No readings in this week.')}</h3><p>${t('Keep the Windows reader running while you play: what your characters spend and regenerate fills your week in by itself.')}</p><div class="timers-actions"><a class="button secondary" href="${link('/')}">${t('My rooms & characters')}</a><a class="button secondary" href="${link('/achievements')}">${t('Achievements')}</a></div></div></section></main>`;
  const prev = s.previous, total = s.total;
  const lost = !total.capped ? '–' : total.lost ? `≈${number(total.lost)}` : '0';
  const metrics = `<section class="metric-panel"><div class="party-metrics">${metric(t('Cubes opened'), `≈${number(total.cubes)}`, esc(versus(total.cubes, prev?.cubes) || t('at {cost} Odyle per cube', { cost: s.cost })), true)}${metric(t('Odyle spent'), number(total.spent), esc(versus(total.spent, prev?.spent)))}${metric(t('Regenerated'), `+${number(total.regen)}`, esc(total.items ? t('+{items} from items', { items: number(total.items) }) : versus(total.regen, prev?.regen)))}${metric(t('Lost at the cap'), lost, esc(!total.capped ? t('not known without the natural pool') : total.lost ? t('≈{hours} h with a full natural pool', { hours: number(total.capHours) }) : t('not a drop wasted')))}</div></section>`;
  const facts = [
    `<li>${icon('calendar')}<span>${esc(tn(s.days, '{n} day with the reader', '{n} days with the reader'))}</span></li>`,
    s.best ? `<li>${icon('bolt')}<span>${esc(t('Biggest day: {day}, {spent} Odyle spent', { day: new Date(s.best.day + halfDay).toLocaleDateString(locale(), { weekday: 'long' }), spent: number(s.best.spent) }))}</span></li>` : '',
    `<li>${icon('trophy')}<span>${s.achievements.length ? esc(tn(s.achievements.length, '{n} achievement reached: {names}', '{n} achievements reached: {names}', { names: s.achievements.map(a => achievementName(a.id)).join(', ') })) : esc(t('No achievement reached this week'))}</span> <a class="footer-link" href="${link('/achievements')}">${t('All achievements')}</a></li>`,
  ].join('');
  const share = `<section class="party-section week-share"><div class="setup-card"><div class="week-share-text"><h2>${t('Share your week')}</h2><p>${t('A picture of these numbers and a text for Discord, made in your browser. Nothing is posted until you do it yourself.')}</p></div><div class="timers-actions">${canShare ? `<button class="button primary" data-action="week-share">${icon('share')} ${t('Share')}</button>` : ''}<button class="button ${canShare ? 'secondary' : 'primary'}" data-action="week-image">${icon('download')} ${t('Save image')}</button><button class="button secondary" data-action="week-copy">${icon('copy')} ${t('Copy for Discord')}</button></div></div></section>`;
  const rows = s.characters.map(c => {
    const w = c.week;
    return `<tr><th scope="row">${esc(c.characterName)}${c.main ? ` <span class="main-label">${icon('star')}</span>` : ''}<small>${esc([classOf(c), c.server].filter(Boolean).join(' · '))}</small></th><td>${number(w.spent)}<small>${esc(tn(w.cubes, '≈{n} cube', '≈{n} cubes'))}</small></td><td>+${number(w.regen)}</td><td>${w.items ? '+' + number(w.items) : '–'}</td><td>${'lost' in w ? (w.lost ? `≈${number(w.lost)}` : '0') : '–'}</td></tr>`;
  }).join('');
  const table = `<section class="party-section"><div class="section-heading"><h2>${t('Your characters')} <span>${s.characters.length}</span></h2></div><div class="wish-panel"><div class="table-scroll"><table class="timers-table"><thead><tr><th scope="col">${t('Character')}</th><th scope="col">${t('Spent')}</th><th scope="col">${t('Regeneration')}</th><th scope="col">${t('Items')}</th><th scope="col">${t('At the cap')}</th></tr></thead><tbody>${rows}</tbody></table></div><p class="table-note">${esc(t('From the changes the reader saw: a spend on a PC without the reader shows as a drop at the next reading.') + ' ' + t('At the cap is an estimate from the clock between readings: the hours the natural pool was full and the regeneration it could not take.'))}</p></div></section>`;
  return `<main class="dashboard week-page">${heading(title, line)}${metrics}<ul class="week-facts">${facts}</ul>${share}${table}</main>`;
}

// The picture of the week to share (1200 × 630, the size link previews use), drawn on a canvas
// in the dashboard's colours; address is where Odyle is, printed at its foot.
export async function weekImage(summary, address) {
  if (typeof document === 'undefined') return null;
  await Promise.all(['750', '650'].map(w => document.fonts?.load(`${w} 40px "Manrope Variable"`)).concat(['500', '700'].map(w => document.fonts?.load(`${w} 20px "DM Sans Variable"`)))).catch(() => { /* the fallback fonts draw it */ });
  const canvas = document.createElement('canvas'), width = 1200, height = 630;
  canvas.width = width; canvas.height = height;
  const g = canvas.getContext('2d');
  if (!g) return null;
  const head = (size, weight = 700) => `${weight} ${size}px "Manrope Variable", Manrope, sans-serif`, body = (size, weight = 500) => `${weight} ${size}px "DM Sans Variable", "DM Sans", sans-serif`;
  const box = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  const fit = (text, font, max) => { g.font = font; let out = text; while (out.length > 1 && g.measureText(out).width > max) out = out.slice(0, -2) + '…'; return out; };
  // Backdrop: the dashboard's dark green with a mint glow, a frame and a diamond.
  const back = g.createLinearGradient(0, 0, width, height); back.addColorStop(0, '#172119'); back.addColorStop(1, '#0d1210');
  g.fillStyle = back; g.fillRect(0, 0, width, height);
  const glow = g.createRadialGradient(width - 160, 90, 10, width - 160, 90, 420); glow.addColorStop(0, 'rgba(181,242,205,0.22)'); glow.addColorStop(1, 'rgba(181,242,205,0)');
  g.fillStyle = glow; g.fillRect(0, 0, width, height);
  g.strokeStyle = '#2f4a3a'; g.lineWidth = 2; box(18, 18, width - 36, height - 36, 26); g.stroke();
  const diamond = (x, y, s) => { g.beginPath(); g.moveTo(x, y - s); g.lineTo(x + s * 0.8, y); g.lineTo(x, y + s); g.lineTo(x - s * 0.8, y); g.closePath(); };
  g.strokeStyle = '#b5f2cd'; g.lineWidth = 3; diamond(78, 76, 20); g.stroke();
  g.fillStyle = '#eaf1ed'; g.font = head(34, 750); g.textBaseline = 'middle'; g.fillText('odyle', 110, 76);
  g.fillStyle = '#b5f2cd'; g.fillText('.', 110 + g.measureText('odyle').width, 76);
  g.textAlign = 'right'; g.fillStyle = '#92a899'; g.font = body(18, 700); g.fillText('AION 2 · GLOBAL', width - 60, 76); g.textAlign = 'left';
  // The title and the week.
  g.textBaseline = 'alphabetic'; g.fillStyle = '#eaf1ed'; g.font = head(58, 750); g.fillText(fit(t('My week in Odyle'), head(58, 750), width - 120), 60, 182);
  g.fillStyle = '#9fb3a6'; g.font = body(26); g.fillText(weekDates(summary.from, summary.until), 60, 226);
  // Four numbers.
  const { total } = summary, tiles = [
    [`≈${number(total.cubes)}`, t('cubes opened'), '#b5f2cd'],
    [number(total.spent), t('Odyle spent'), '#eaf1ed'],
    [`+${number(total.regen)}`, t('regenerated'), '#eaf1ed'],
    total.capped ? [total.lost ? `≈${number(total.lost)}` : '0', t('lost at the cap'), total.lost ? '#f3c94a' : '#b5f2cd'] : [String(summary.days), t('days with the reader'), '#eaf1ed'],
  ];
  const tileWidth = (width - 120 - 3 * 18) / 4;
  tiles.forEach(([value, label, color], i) => {
    const x = 60 + i * (tileWidth + 18), y = 262;
    g.fillStyle = 'rgba(24,32,28,0.92)'; box(x, y, tileWidth, 150, 18); g.fill();
    g.strokeStyle = '#2a3530'; g.lineWidth = 2; box(x, y, tileWidth, 150, 18); g.stroke();
    g.fillStyle = color; g.font = head(56, 750); g.fillText(fit(value, head(56, 750), tileWidth - 40), x + 22, y + 80);
    g.fillStyle = '#a6b6ab'; g.font = body(20, 600); g.fillText(fit(label, body(20, 600), tileWidth - 40), x + 22, y + 122);
  });
  // The rest in one line, the characters in another, then where Odyle is.
  const facts = [tn(summary.days, '{n} day with the reader', '{n} days with the reader'), tn(summary.characters.length, '{n} character', '{n} characters'), summary.achievements.length ? tn(summary.achievements.length, '{n} achievement', '{n} achievements') : ''].filter(Boolean).join('  ·  ');
  g.fillStyle = '#d3e4d8'; g.font = body(24, 600); g.fillText(fit(facts, body(24, 600), width - 120), 60, 466);
  const names = summary.characters.slice(0, 3).map(c => `${c.characterName} ${tn(c.week.cubes, '≈{n} cube', '≈{n} cubes')}`).join('   ');
  g.fillStyle = '#9fb3a6'; g.font = body(21); g.fillText(fit(names, body(21), width - 120), 60, 506);
  g.strokeStyle = '#2a3530'; g.lineWidth = 2; g.beginPath(); g.moveTo(60, 548); g.lineTo(width - 60, 548); g.stroke();
  g.fillStyle = '#b5f2cd'; g.font = body(22, 700); g.fillText(fit(address.replace(/^https?:\/\//, '').replace(/\/$/, ''), body(22, 700), 560), 60, 586);
  g.textAlign = 'right'; g.fillStyle = '#89958f'; g.font = body(18); g.fillText(t('Party dashboard for AION 2 · unofficial fan project'), width - 60, 586);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}
export const weekImageName = summary => `odyle-week-${new Date(summary.from).toISOString().slice(0, 10)}.png`;
