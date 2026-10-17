import { t, tn, locale } from './i18n.js';
import { escape as esc, timestamp, age, classOf } from './model.js';
import { icon } from './icons.js';
import { dungeonField } from './catalog.js';
const two = n => String(n).padStart(2, '0');
// The value of a datetime-local input for a moment, in local time.
export function localInput(at) { const d = new Date(at); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`; }
// The value of a datetime-local input for the next full hour, in local time.
export function nextHour(now) { const d = new Date(now); d.setHours(d.getHours() + 1, 0, 0, 0); return localInput(d); }
// The start times the server accepts (backend validation.go runStart): from an hour ago up
// to 60 days ahead, in whole minutes, as the bounds of a datetime-local input. Some
// browsers ignore the bounds, so forms check the time again before sending (forms.js).
export const runWindow = now => ({ min: Math.ceil((now - 3600000) / 60000) * 60000, max: Math.floor((now + 60 * 86400000) / 60000) * 60000 });
const bounds = (now, earliest = Infinity) => { const { min, max } = runWindow(now); return `min="${localInput(Math.min(min, earliest))}" max="${localInput(max)}"`; };
// Compact spans: "2d 3h", "5h 12m", "45m" (Czech "2 d 3 h", "5 h 12 min", "45 min").
export function span(minutes) {
  const days = Math.floor(minutes / 1440), hours = Math.floor(minutes / 60) % 24;
  return days ? t('{d}d {h}h', { d: days, h: hours }) : hours ? t('{h}h {m}m', { h: hours, m: minutes % 60 }) : t('{m}m', { m: minutes });
}
// "in 2d 3h", "in 45m", "starting now" or "started 20m ago".
export function startsIn(at, now) {
  const minutes = Math.round((at - now) / 60000), text = span(Math.abs(minutes));
  return Math.abs(minutes) < 1 ? t('starting now') : minutes > 0 ? t('in {time}', { time: text }) : t('started {time} ago', { time: text });
}
// An iCalendar file of one run with a reminder 15 minutes ahead, for "Add to calendar".
// Times are UTC; calendars show them in local time. The run lasts an hour by default.
const ics = text => String(text || '').replace(/[\\;,]/g, m => '\\' + m).replace(/\r?\n/g, '\\n');
const utc = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
// Lines longer than 75 octets continue on the next line after a space (RFC 5545).
function fold(line) {
  const out = []; let current = '', size = 0;
  for (const char of line) { const bytes = new TextEncoder().encode(char).length; if (size + bytes > (out.length ? 74 : 75)) { out.push(current); current = ''; size = 0; } current += char; size += bytes; }
  return [...out, current].join('\r\n ');
}
// A run as a Discord message anyone in the room can paste (#35), no webhook needed: Discord
// shows <t:…> in every reader's own time zone. Names and the note are escaped, so they can
// neither format the message nor ping anyone (Discord markdown, <@…> and @everyone).
// "**Fire Temple** · <t:…:F> (<t:…:R>) · Going (3/5): A, B, C · note · link".
const discordMarkdown = /([\\*_~`|>#[\]()<@])/g;
export function discordText({ dungeon, startsAt, note }, { going = [], partySize = 0, link = '' } = {}) {
  const unix = Math.floor(timestamp(startsAt) / 1000), md = text => String(text).replace(discordMarkdown, '\\$1');
  const count = partySize > 0 ? `${going.length}/${partySize}` : String(going.length);
  const parts = [`**${md(dungeon)}**`, `<t:${unix}:F> (<t:${unix}:R>)`, `${t('Going')} (${count})${going.length ? ': ' + going.map(md).join(', ') : ''}`];
  if (note) parts.push(md(note));
  if (link) parts.push(link);
  return parts.join(' · ');
}
function calendarEvent({ id, dungeon, startsAt, note }, { room, going = [], now }) {
  const start = timestamp(startsAt), summary = room ? `${dungeon} · ${room}` : dungeon, details = [note, going.length ? t('Going: {names}', { names: going.join(', ') }) : ''].filter(Boolean).join('\n');
  return ['BEGIN:VEVENT', `UID:${id}@odyle`, `DTSTAMP:${utc(now)}`, `DTSTART:${utc(start)}`, `DTEND:${utc(start + 3600000)}`, `SUMMARY:${ics(summary)}`, ...(details ? [`DESCRIPTION:${ics(details)}`] : []),
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${ics(summary)}`, 'TRIGGER:-PT15M', 'END:VALARM', 'END:VEVENT'];
}
const calendar = events => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Odyle//Party dashboard//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...events.flat(), 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';
export function calendarFile(run, { room, going, now }) {
  return calendar([calendarEvent(run, { room, going, now })]);
}
// Every run you go to in one file (#51): "Add all to calendar" on Rooms & characters. A run the
// calendar already has (the same UID) is updated, not added twice.
export function calendarOfRuns(runs, now) {
  return calendar(runs.map(r => calendarEvent(r, { room: r.room, now })));
}

// Your next runs on Rooms & characters (#51): the runs you are going to in the next two weeks,
// soonest first, each opening its room, with one button for all of them in a calendar.
export function nextRunsSection(runs, now) {
  if (!runs?.length) return '';
  const when = at => new Date(at).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const rows = runs.map(r => `<button class="room-item next-run" data-room="${esc(r.roomId)}"><span class="setup-icon">${icon('calendar')}</span><span><strong>${esc(r.dungeon)}</strong><small>${esc(r.room)} · ${esc(when(timestamp(r.startsAt)))} · ${esc(startsIn(timestamp(r.startsAt), now))}</small></span>${icon('arrow')}</button>`).join('');
  return `<section class="party-section next-runs"><div class="section-heading"><h2>${t('Your next runs')} <span>${runs.length}</span></h2><button class="button secondary" data-action="calendar-all">${icon('calendar')} ${t('Add all to calendar')}</button></div><div class="room-list">${rows}</div></section>`;
}

// A room at a glance on Rooms & characters (#51): your role, its members, who plays live now and
// the cubes their party can open now, and its next run.
export function roomGlance(r, now) {
  const parts = [roleName(r.role)];
  if (typeof r.memberCount !== 'number') return [...parts, t('{cost} Odyle per cube', { cost: r.cost })].join(' · ');
  parts.push(tn(r.memberCount, '{n} member', '{n} members'));
  if (r.liveCount) parts.push(t('{live} live · party {cubes}', { live: r.liveCount, cubes: tn(r.partyCubes, '{n} cube', '{n} cubes') }));
  if (r.nextRun) parts.push(t('next: {dungeon} {when}', { dungeon: r.nextRun.dungeon, when: startsIn(timestamp(r.nextRun.startsAt), now) }));
  return parts.join(' · ');
}
const roleName = role => role === 'owner' ? t('leader') : role === 'officer' ? t('officer') : role === 'viewer' ? t('viewer') : t('player');
// Planned runs of a room, soonest first: owners and players plan and join them, viewers
// read them; the planner or the room owner changes or cancels one. Everyone can add a
// run to their calendar. `live` holds the accounts with a live character in the room.
// With a dungeon catalog the form picks from it (catalog.js) and `facts` adds a listed
// dungeon's cost and the cubes the party can open to its runs.
// readiness(run) is runready.js runReadiness for the run (null: names only); start is the
// earliest time everyone can claim a cube (runready.js earliestClaim), offered to the plan form.
// The game's weekly maintenance (#47): whether a run (an hour from its start) overlaps it, and
// the window of that week in local time. window: { day, hour, hours } in UTC, or null.
const weekDays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export function maintenanceAt(at, window) {
  const day = weekDays.indexOf(window?.day);
  if (day < 0) return null;
  const start = new Date(at), base = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() - ((start.getUTCDay() - day + 7) % 7), window.hour);
  for (const from of [base - 7 * 86400000, base, base + 7 * 86400000]) {
    const to = from + window.hours * 3600000;
    if (at < to && at + 3600000 > from) return { from, to };
  }
  return null;
}
// The roll call of a run (#44): from 15 minutes before its start to 30 minutes after, each
// attendee's place in words, from what the room already sees (presence and readings): ready
// (live with enough for a cube), short (live, not enough), not in game (a saved character that
// is not live), no character (nothing shared here).
export const rollCallWindow = { before: 15 * 60000, after: 30 * 60000 };
export const inRollCall = (at, now) => now >= at - rollCallWindow.before && now <= at + rollCallWindow.after;
export function rollCallOf(row) {
  if (!row?.character) return 'none';
  if (row.state !== 'live') return 'away';
  return row.claims ? 'ready' : 'short';
}
const rollCallWords = { ready: () => t('ready'), short: () => t('short'), away: () => t('not in game'), none: () => t('no character') };
export function rollCallLine(rows) {
  const count = key => rows.filter(row => rollCallOf(row) === key).length;
  const counted = { ready: n => tn(n, '{n} ready', '{n} ready'), short: n => tn(n, '{n} short', '{n} short'), away: n => tn(n, '{n} not in game', '{n} not in game'), none: n => tn(n, '{n} without a character', '{n} without a character') };
  return ['ready', 'short', 'away', 'none'].filter(key => count(key)).map(key => counted[key](count(key))).join(' · ');
}
export function runsSection({ runs, members, myId, viewer, owner, live, now, suggestions, catalog = [], perCube = 40, facts = () => '', demo, discord, readiness = null, costOf = () => perCube, start = null, maintenance = null }) {
  const name = id => id === myId ? t('You') : members.find(m => m.user === id)?.displayName || t('Member');
  const form = viewer ? `<p class="wish-note">${t('Viewers can see planned runs but cannot plan or join them.')}</p>` : `<form id="run-form" class="wish-form run-form">${dungeonField({ catalog, suggestions, list: 'run-dungeons', placeholder: catalog.length ? t('Choose a dungeon') : t('Dungeon'), perCube })}<input name="startsAt" type="datetime-local" required aria-label="${esc(t('Start'))}" value="${nextHour(now)}" ${bounds(now)}><input name="note" maxlength="120" autocomplete="off" placeholder="${esc(t('Note (optional)'))}" aria-label="${esc(t('Note'))}"><button class="button primary" type="submit">${icon('calendar')} ${t('Plan run')}</button></form>${viewer || start === null ? '' : start <= now ? `<p class="wish-note run-hint">${t('Everyone can claim a cube now.')}</p>` : `<p class="wish-note run-hint">${esc(t('Everyone can claim a cube from {when} (an estimate of the Odyle clock).', { when: new Date(start).toLocaleString(locale(), { weekday: 'short', hour: '2-digit', minute: '2-digit' }) }))} <button class="text-button" type="button" data-use-start="${esc(localInput(start))}">${t('Use this time')}</button></p>`}`;
  const rows = runs.map(r => {
    const at = timestamp(r.startsAt), going = r.attendees.includes(myId), mine = r.planner === myId;
    // Each attendee with the character they bring and its cubes at this run's cost, at the start.
    const ready = readiness?.(r), cost = costOf(r), upcoming = at > now, calling = Boolean(ready) && inRollCall(at, now);
    const person = row => {
      const c = row?.character, fresh = row?.state === 'live', call = calling ? rollCallOf(row) : '';
      const word = call ? ` · <b class="roll-call ${call}">${esc(rollCallWords[call]())}</b>` : '';
      if (!c) return `<span class="wish-person"><i></i>${esc(name(row.user))}${word}</span>`;
      const cubes = upcoming ? row.cubesAtStart : row.cubes, label = `${name(row.user)}${c.characterName !== c.displayName ? ' · ' + c.characterName : ''}${c.className ? ' · ' + c.className : ''} · ${tn(cubes, '{n} cube', '{n} cubes')}`;
      const hint = (classOf(c) ? classOf(c) + ' · ' : '') + (row.picked ? t('Picked for this run') + ' · ' : '') + (fresh ? t('Live in this room now') : t('saved {age}', { age: age(c.lastReadingAt, now) })) + (upcoming && row.cubesAtStart !== row.cubes ? ' · ' + t('{n} at the start, with the Odyle clock', { n: row.cubesAtStart }) : '');
      return `<span class="wish-person ${fresh ? 'live' : ''} ${row.claims ? '' : 'short'}" title="${esc(hint)}"><i></i>${esc(label)}${word}${fresh && !call ? `<span class="sr-only"> (${t('live')})</span>` : ''}</span>`;
    };
    const people = (ready ? ready.rows.map(person) : r.attendees.map(u => `<span class="wish-person ${live.has(u) ? 'live' : ''}"${live.has(u) ? ` title="${esc(t('Live in this room now'))}"` : ''}><i></i>${esc(name(u))}${live.has(u) ? `<span class="sr-only"> (${t('live')})</span>` : ''}</span>`)).join('') || `<span class="run-nobody">${t('Nobody is going yet')}</span>`;
    const down = at > now ? maintenanceAt(at, maintenance) : null, clock = ms => new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
    const warning = down ? `<small class="run-warning">${esc(t('During the weekly maintenance of the game ({from}–{to}, your time)', { from: clock(down.from), to: clock(down.to) }))}</small>` : '';
    const roll = calling && ready.rows.length ? `<small class="run-claim roll-call-line">${esc(t('Roll call: {line}', { line: rollCallLine(ready.rows) }))}</small>` : '';
    const claim = warning + roll + (ready?.of ? `<small class="run-claim ${ready.claim === ready.of ? 'all' : ''}">${esc(upcoming ? t('{k} of {n} can claim a cube at the start · {cost} Odyle', { k: ready.claim, n: ready.of, cost }) : t('{k} of {n} can claim a cube · {cost} Odyle', { k: ready.claim, n: ready.of, cost }))}</small>` : '');
    // A run that started is wrapped up by its planner, its attendees or the owner: done (the
    // dungeon leaves the wishlist of those who went), it did not happen, or the same next week.
    const wrapUp = !demo && !viewer && at <= now && (mine || owner || going);
    const actions = wrapUp ? `<button data-run-done="${esc(r.id)}" data-name="${esc(r.dungeon)}">${icon('tick')} ${t('Done')}</button><button data-run-again="${esc(r.id)}" data-name="${esc(r.dungeon)}" data-at="${esc(r.startsAt)}">${t('Plan again next week')}</button><button class="remove" data-cancel-run="${esc(r.id)}" data-name="${esc(r.dungeon)}" data-missed="true">${t('Didn’t happen')}</button>`
      : (demo ? '' : (viewer ? '' : `<button data-run="${esc(r.id)}" data-going="${!going}">${going ? t('Not going') : `${icon('plus')} ${t('Going')}`}</button>`)
      + (demo ? '' : `<button data-copy-run="${esc(r.id)}" title="${esc(t('Copy {dungeon} for Discord', { dungeon: r.dungeon }))}" aria-label="${esc(t('Copy {dungeon} for Discord', { dungeon: r.dungeon }))}">${icon('copy')}</button>`)
      + `<button data-calendar-run="${esc(r.id)}" title="${esc(t('Add {dungeon} to your calendar', { dungeon: r.dungeon }))}" aria-label="${esc(t('Add {dungeon} to your calendar', { dungeon: r.dungeon }))}">${icon('calendar')}</button>`
      + ((mine || owner) && !viewer ? `<button data-edit-run="${esc(r.id)}">${t('Edit')}</button><button class="remove" data-cancel-run="${esc(r.id)}" data-name="${esc(r.dungeon)}">${t('Cancel')}</button>` : ''));
    const when = new Date(at).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return `<div class="wish-row run-row ${going ? 'mine' : ''}"><div class="run-when"><strong>${esc(when)}</strong><small data-starts="${esc(r.startsAt)}">${esc(startsIn(at, now))}</small></div><div class="wish-name"><strong>${esc(r.dungeon)}</strong><small>${r.note ? esc(r.note) : esc(tn(r.attendees.length, '{n} going', '{n} going'))}${r.planner ? ' · ' + esc(t('planned by {name}', { name: name(r.planner) })) : ''}</small>${claim}${facts(r.dungeon)}</div><div class="wish-people">${people}</div><div class="wish-actions">${actions}</div></div>`;
  }).join('');
  return `<section class="party-section wishlist runs"><div class="section-heading"><h2>${t('Planned runs')} <span>${runs.length}</span></h2><span class="refresh-label">${t('Soonest first · your local time')}${discord ? ` · ${t('Discord reminders on')}` : ''}</span></div><div class="wish-panel">${form}${rows ? `<div class="wish-list">${rows}</div>` : `<p class="wish-empty">${t('No runs planned. Pick a dungeon and a time; the party joins with Going.')}</p>`}</div></section>`;
}
// The form that changes a run: dungeon, start (local time) and note. An unchanged start
// stays valid even when it is past the window, and so does a dungeon the catalog dropped.
export function runEditForm(r, { suggestions = [], catalog = [], perCube = 40 } = {}, now = Date.now()) {
  return `<form id="run-edit-form" class="run-edit"><input type="hidden" name="runId" value="${esc(r.id)}"><label>${t('Dungeon')}${dungeonField({ catalog, suggestions, list: 'run-edit-dungeons', value: r.dungeon, perCube })}</label><label>${t('Start')}<input name="startsAt" type="datetime-local" required value="${localInput(timestamp(r.startsAt))}" ${bounds(now, timestamp(r.startsAt))}></label><label>${t('Note (optional)')}<input name="note" maxlength="120" autocomplete="off" value="${esc(r.note)}"></label><button class="button primary" type="submit">${t('Save run')}</button></form>`;
}
