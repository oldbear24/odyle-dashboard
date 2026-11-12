import { t, tn, locale } from './i18n.js';
import { escape as esc, changedAt, age, regionLabel, timestamp } from './model.js';
import { pageOf, pager, fillers } from './pager.js';
import { findPath } from './armorylinks.js';
import { link } from './routes.js';

// PvP stats (opt-in): a character's kills, assists and deaths against other players, as its
// player's Windows app read them from the game while the account has PvP stats on. The dialog
// shows the counts of a period (up to as long as the server keeps the events), the players the
// character met (how often it killed them, helped kill them and was killed by them), the allies
// whose kills it assisted and the latest events, a page at a time. Its owner and the rooms the
// character is shared in see it. The row's button that opens it is pvpline.js.

const number = n => (Number(n) || 0).toLocaleString(locale());
// Kills for each death, to two places; with no death yet the kills themselves.
export const ratio = ({ kills = 0, deaths = 0 } = {}) => kills / Math.max(1, deaths);
const ratioText = totals => ratio(totals).toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The periods the dialog offers: a week, 30 days and as long as the server keeps the events.
export const periods = keep => [...[7, 30].filter(days => days < keep), keep];
const periodName = days => tn(days, '{n} day', '{n} days');
export function periodSwitch(days, keep) {
  const choices = periods(keep);
  return choices.length > 1 ? `<div class="segmented" role="group" aria-label="${esc(t('Period'))}">${choices.map(d => `<button type="button" data-pvp-days="${d}" aria-pressed="${d === days}">${esc(periodName(d))}</button>`).join('')}</div>` : '';
}

// A player as the game named them: the name, linked to the armory's lookup when the game said
// their server, and the server with its region under it.
const serverName = /^[A-Za-z]{2,20}$/, regionName = /^GLOBAL_(NAW?|EU|SA|ASIA)$/;
export function playerCell(p) {
  const known = serverName.test(p.server || '') && regionName.test(p.region || '');
  const where = known ? `<small>${esc(p.server)} ${esc(regionLabel(p.region))}</small>` : '';
  const name = known ? `<a href="${esc(link(findPath(p.region, p.server, p.name)))}" title="${esc(t('Look up {name} in the armory', { name: p.name }))}">${esc(p.name)}</a>` : esc(p.name);
  return `<span class="pvp-player">${name}${where}</span>`;
}

// The players table's orders: the busiest first (as the server sends them), or by one count.
export const sorts = ['total', 'kills', 'assists', 'deaths', 'last'];
export function sorted(players, by = 'total') {
  if (by === 'total' || !sorts.includes(by)) return players;
  const value = by === 'last' ? p => timestamp(p.lastAt) || 0 : p => p[by] || 0;
  return [...players].sort((a, b) => value(b) - value(a));
}
const playersPerPage = 10;
// The first column orders by how often a player was met, which the server's order already is:
// only a count's column says it is sorted.
const sortHead = (key, label, by, title) => `<th${by === key && key !== 'total' ? ' aria-sort="descending"' : ''}><button type="button" class="pvp-sort" data-pvp-sort="${key}" aria-pressed="${by === key}" title="${esc(title)}">${esc(label)}</button></th>`;

// The players the character met in the period, a page at a time, in the chosen order.
export function playersTable({ data, sort = 'total', page = 1, now }) {
  const all = data.opponents || [];
  if (!all.length) return '';
  const view = pageOf(sorted(all, sort), page, playersPerPage), count = Math.max(data.opponentCount || 0, all.length);
  const rows = view.items.map(p => `<tr><td>${playerCell(p)}</td><td>${number(p.kills)}</td><td>${number(p.assists)}</td><td>${number(p.deaths)}</td><td>${esc(age(p.lastAt, now))}</td></tr>`).join('');
  const more = count > all.length ? `<small class="account-note">${esc(t('The {n} players met most are listed.', { n: number(all.length) }))}</small>` : '';
  return `<section class="history-section pvp-players"><h3 class="modal-sub">${t('Players')} <span class="modal-count">${number(count)}</span></h3><table class="history-table pvp-table"><thead><tr>${sortHead('total', t('Player'), sort, t('Most met first'))}${sortHead('kills', t('Killed'), sort, t('Most killed by this character first'))}${sortHead('assists', t('Assisted'), sort, t('Most kills of them assisted first'))}${sortHead('deaths', t('Killed by'), sort, t('Most deaths to them first'))}${sortHead('last', t('Last'), sort, t('Latest first'))}</tr></thead><tbody>${rows}${fillers(view, view.items.length, 5)}</tbody></table>${pager(view, 'data-pvp-players', t('Pages of players'))}${more}</section>`;
}

// The allies whose kills the character assisted, the most helped first.
export function alliesTable({ data, now }) {
  const allies = (data.allies || []).slice(0, 10);
  if (!allies.length) return '';
  return `<section class="history-section pvp-allies"><h3 class="modal-sub">${t('Kills assisted for')} <span class="modal-count">${number(data.allies.length)}</span></h3><table class="history-table pvp-table"><thead><tr><th>${t('Player')}</th><th>${t('Assists')}</th><th>${t('Last')}</th></tr></thead><tbody>${allies.map(p => `<tr><td>${playerCell(p)}</td><td>${number(p.assists)}</td><td>${esc(age(p.lastAt, now))}</td></tr>`).join('')}</tbody></table></section>`;
}

// What an event was, with who it was against.
export function eventText(e) {
  const name = `<strong>${esc(e.name)}</strong>`;
  if (e.kind === 'kill') return t('Killed {name}', { name });
  if (e.kind === 'death') return t('Killed by {name}', { name });
  return e.by ? t('Assisted {by} against {name}', { by: `<strong>${esc(e.by)}</strong>`, name }) : t('Assisted against {name}', { name });
}

// A page of the events (the server's), newest first, with the buttons to the others.
export function eventsTable({ data, now }) {
  if (!data.total) return '';
  const events = data.events || [], page = { page: data.page || 1, pages: data.pages || 1, perPage: data.perPage || events.length };
  const rows = events.map(e => `<tr class="pvp-${esc(e.kind)}"><td>${esc(changedAt(e.at, now))}</td><td>${eventText(e)}</td></tr>`).join('');
  return `<h3 class="modal-sub">${t('Latest')} <span class="modal-count">${number(data.total)}</span></h3><table class="history-table pvp-table pvp-log"><thead><tr><th>${t('When')}</th><th>${t('What')}</th></tr></thead><tbody>${rows}${fillers(page, events.length, 2)}</tbody></table>${pager(page, 'data-pvp-page', t('Pages of events'))}<small class="account-note">${esc(tn(data.keepDays || 90, 'Each event is kept for {n} day.', 'Each event is kept for {n} days.'))}</small>`;
}

// The counts of the period as four figures, and under them the counts since PvP stats were turned on.
export function totalsRow(data) {
  const totals = data.totals || {}, since = data.allTime;
  const figure = (value, label, cls = '') => `<div class="pvp-figure ${cls}"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`;
  return `<div class="pvp-figures">${figure(number(totals.kills), t('Kills'), 'is-kills')}${figure(number(totals.assists), t('Assists'))}${figure(number(totals.deaths), t('Deaths'), 'is-deaths')}${figure(ratioText(totals), t('Kills per death'))}</div>`
    + (since ? `<p class="pvp-since">${esc(t('Since PvP stats were turned on: kills {kills} · assists {assists} · deaths {deaths}', { kills: number(since.kills), assists: number(since.assists), deaths: number(since.deaths) }))}</p>` : '');
}

// The dialog's body: the period's counts and players beside the latest events, or why there is nothing.
export function pvpBody({ data, name, own = false, now, sort = 'total', page = 1 }) {
  if (!data.enabled) return `<p class="place-off">${own ? t('PvP stats are off for your account. Turn them on under Account & data to count your characters\' PvP kills, assists and deaths.') : esc(t('The player of {name} has not turned on PvP stats.', { name }))}</p>`;
  const days = data.days || data.keepDays || 90, head = `<div class="history-head"><p class="history-about">${t('Kills, assists and deaths against other players, as the Windows app reads them from the game. An assist is a hit on a player at most 15 seconds before an ally kills them.')}</p>${periodSwitch(days, data.keepDays || days)}</div>`;
  const empty = !data.total ? `<p class="place-off">${esc(tn(days, 'No PvP kill, assist or death in the last {n} day. The Windows app reads them while PvP stats are on and the reader runs.', 'No PvP kill, assist or death in the last {n} days. The Windows app reads them while PvP stats are on and the reader runs.'))}</p>` : '';
  return `<div class="pvp-main">${head}${totalsRow(data)}${empty}<div class="pvp-players-slot">${playersTable({ data, sort, page, now })}</div>${alliesTable({ data, now })}</div>${data.total ? `<div class="pvp-events">${eventsTable({ data, now })}</div>` : ''}`;
}

// The account page's switch (Account & data), with what is read and how long it is kept.
export function pvpCard(on = false, days = 90) {
  return `<form id="pvp-form" class="setup-card"><h2>${t('PvP stats')}</h2><p>${t('Counts your characters\' PvP kills, assists and deaths, with who you killed, whose kills you assisted and who killed you. While this is on, the Windows app reads kill messages, the names of players near you and which players your own character hits; never damage numbers, HP or skills. Your rooms see the stats of the characters you share with them.')}</p>
<label class="check-row"><input type="checkbox" name="pvpStats" ${on ? 'checked' : ''}> <span>${t('Count my PvP kills, assists and deaths')}</span></label><small class="account-note">${esc(tn(days, 'Off by default. Events are kept for {n} day, and turning this off deletes them at once.', 'Off by default. Events are kept for {n} days, and turning this off deletes them at once.'))}</small><button class="button primary" type="submit">${t('Save PvP stats')}</button></form>`;
}
