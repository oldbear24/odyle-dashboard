import { t, tn, locale } from './i18n.js';
import { escape as esc, timestamp } from './model.js';
import { icon } from './icons.js';
const two = n => String(n).padStart(2, '0');
// The value of a datetime-local input for the next full hour, in local time.
export function nextHour(now) { const d = new Date(now); d.setHours(d.getHours() + 1, 0, 0, 0); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:00`; }
// "in 2d 3h", "in 45m", "starting now" or "started 20m ago".
export function startsIn(at, now) {
  const minutes = Math.round((at - now) / 60000), span = Math.abs(minutes), days = Math.floor(span / 1440), hours = Math.floor(span / 60) % 24;
  const text = days ? `${days}d ${hours}h` : hours ? `${hours}h ${span % 60}m` : `${span}m`;
  return span < 1 ? t('starting now') : minutes > 0 ? t('in {time}', { time: text }) : t('started {time} ago', { time: text });
}
// Planned runs of a room, soonest first: owners and players plan and join them, viewers
// read them; the planner or the room owner cancels one. `live` holds the accounts with
// a live character in the room.
export function runsSection({ runs, members, myId, viewer, owner, live, now, suggestions, demo }) {
  const name = id => id === myId ? t('You') : members.find(m => m.user === id)?.displayName || t('Member');
  const form = viewer ? `<p class="wish-note">${t('Viewers can see planned runs but cannot plan or join them.')}</p>` : `<form id="run-form" class="wish-form run-form"><input name="dungeon" maxlength="60" list="run-dungeons" autocomplete="off" placeholder="${esc(t('Dungeon'))}" aria-label="${esc(t('Dungeon'))}" required><datalist id="run-dungeons">${suggestions.map(d => `<option value="${esc(d)}">`).join('')}</datalist><input name="startsAt" type="datetime-local" required aria-label="${esc(t('Start'))}" value="${nextHour(now)}"><input name="note" maxlength="120" autocomplete="off" placeholder="${esc(t('Note (optional)'))}" aria-label="${esc(t('Note'))}"><button class="button primary" type="submit">${icon('calendar')} ${t('Plan run')}</button></form>`;
  const rows = runs.map(r => {
    const at = timestamp(r.startsAt), going = r.attendees.includes(myId), mine = r.planner === myId;
    const people = r.attendees.map(u => `<span class="wish-person ${live.has(u) ? 'live' : ''}"${live.has(u) ? ` title="${esc(t('Live in this room now'))}"` : ''}><i></i>${esc(name(u))}</span>`).join('') || `<span class="run-nobody">${t('Nobody is going yet')}</span>`;
    const actions = demo ? '' : (viewer ? '' : `<button data-run="${esc(r.id)}" data-going="${!going}">${going ? t('Not going') : `${icon('plus')} ${t('Going')}`}</button>`) + (mine || owner ? `<button class="remove" data-cancel-run="${esc(r.id)}" data-name="${esc(r.dungeon)}">${t('Cancel')}</button>` : '');
    const when = new Date(at).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return `<div class="wish-row run-row ${going ? 'mine' : ''}"><div class="run-when"><strong>${esc(when)}</strong><small data-starts="${esc(r.startsAt)}">${esc(startsIn(at, now))}</small></div><div class="wish-name"><strong>${esc(r.dungeon)}</strong><small>${r.note ? esc(r.note) : esc(tn(r.attendees.length, '{n} going', '{n} going'))}${r.planner ? ' · ' + esc(t('planned by {name}', { name: name(r.planner) })) : ''}</small></div><div class="wish-people">${people}</div><div class="wish-actions">${actions}</div></div>`;
  }).join('');
  return `<section class="party-section wishlist runs"><div class="section-heading"><h2>${t('Planned runs')} <span>${runs.length}</span></h2><span class="refresh-label">${t('Soonest first · your local time')}</span></div><div class="wish-panel">${form}${rows ? `<div class="wish-list">${rows}</div>` : `<p class="wish-empty">${t('No runs planned. Pick a dungeon and a time; the party joins with Going.')}</p>`}</div></section>`;
}
