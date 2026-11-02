// What a room does with a planned run now and then, loaded the first time (main.js): the form
// that changes it and calendar files of one run or of every run you go to.
import { t } from './i18n.js';
import { escape as esc, timestamp } from './model.js';
import { dungeonField } from './catalog.js';
import { localInput, bounds } from './runs.js';

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

// The form that changes a run: dungeon, start (local time) and note. An unchanged start
// stays valid even when it is past the window, and so does a dungeon the catalog dropped.
export function runEditForm(r, { suggestions = [], catalog = [], perCube = 40 } = {}, now = Date.now()) {
  return `<form id="run-edit-form" class="run-edit"><input type="hidden" name="runId" value="${esc(r.id)}"><label>${t('Dungeon')}${dungeonField({ catalog, suggestions, list: 'run-edit-dungeons', value: r.dungeon, perCube })}</label><label>${t('Start')}<input name="startsAt" type="datetime-local" required value="${localInput(timestamp(r.startsAt))}" ${bounds(now, timestamp(r.startsAt))}></label><label>${t('Event link (optional)')}<input name="link" type="url" maxlength="300" autocomplete="off" placeholder="https://…" value="${esc(r.link || '')}"></label><label>${t('Note (optional)')}<input name="note" maxlength="120" autocomplete="off" value="${esc(r.note)}"></label><button class="button primary" type="submit">${t('Save run')}</button></form>`;
}
