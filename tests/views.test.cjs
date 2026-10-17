const { test } = require('node:test');
const assert = require('node:assert/strict');
const memory = () => { const data = {}; return { getItem: key => data[key] ?? null, setItem: (key, value) => { data[key] = String(value); } }; };
test('invite links carry the code in the fragment and the owner\'s browser remembers live codes', async () => {
  const { inviteLink, joinCode, savedInvites, rememberInvites, forgetInvites } = await import('../src/invites.js');
  assert.equal(inviteLink('https://odyle.example/app/?x=1#/room/abc', 'ABCDEFGH2345'), 'https://odyle.example/app/#/join/ABCDEFGH2345');
  assert.equal(joinCode('/join/abcd-efgh-2345'), 'ABCDEFGH2345'); assert.equal(joinCode('/room/abc'), ''); assert.equal(joinCode('/join/<x>'), '');
  const storage = memory(), now = Date.parse('2026-10-14T12:00:00Z');
  rememberInvites(storage, 'room1', [{ code: 'AAAA', role: 'reporter', expiresAt: '2026-10-14T12:30:00Z', extra: 'dropped' }, { code: 'BBBB', role: 'viewer', expiresAt: '2026-10-14T11:59:00Z' }], now);
  assert.deepEqual(savedInvites(storage, 'room1', now).map(({ savedAt, ...s }) => (assert.equal(typeof savedAt, 'number'), s)), [{ code: 'AAAA', role: 'reporter', expiresAt: '2026-10-14T12:30:00Z' }]);
  assert.deepEqual(savedInvites(storage, 'room1', now + 3600000), []); assert.deepEqual(savedInvites(storage, 'other', now), []);
  forgetInvites(storage, 'room1', now); assert.deepEqual(savedInvites(storage, 'room1', now), []);
  // Broken or blocked storage never breaks the dialog.
  assert.deepEqual(savedInvites({ getItem: () => '{not json' }, 'room1', now), []);
  rememberInvites({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, 'room1', [], now);
});
test('sign-in names browsers built into apps and its way out keeps the invite', async () => {
  const { inAppBrowser, signInLink } = await import('../src/signin.js');
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';
  const browsers = [iphone + ' Version/17.5 Mobile/15E148 Safari/604.1', iphone + ' CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36', 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile DuckDuckGo/5 Safari/537.36'];
  const apps = [iphone + ' Mobile/15E148', iphone + ' Mobile/15E148 Instagram 312.0.0.32.112 (iPhone15,2; iOS 17_5; en_GB)', iphone + ' Mobile/15E148 [FBAN/FBIOS;FBAV/450.0.0.38.108]', 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A.240505.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36', 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 Line/14.5.0'];
  assert.deepEqual(browsers.map(ua => inAppBrowser(ua)), [false, false, false, false, false]);
  assert.deepEqual(apps.map(ua => inAppBrowser(ua)), [true, true, true, true, true]);
  // The installed web app on iOS has no Safari mark either.
  assert.equal(inAppBrowser(apps[0], true), false); assert.equal(inAppBrowser(), false);
  assert.equal(signInLink('https://odyle.example/app/?fbclid=x#/join/ABCD-EFGH-2345'), 'https://odyle.example/app/#/join/ABCD-EFGH-2345');
  assert.equal(signInLink('https://odyle.example/'), 'https://odyle.example/');
});
test('planned runs count down in local time and history charts round their axis', async () => {
  const { startsIn, nextHour, runsSection } = await import('../src/runs.js'), { niceMax, historyChart, historyList } = await import('../src/history.js');
  const now = Date.parse('2026-10-14T12:00:00Z');
  assert.deepEqual([now + 125 * 60000, now + 26 * 3600000, now + 20000, now - 20 * 60000].map(at => startsIn(at, now)), ['in 2h 5m', 'in 1d 2h', 'starting now', 'started 20m ago']);
  assert.match(nextHour(now), /^\d{4}-\d{2}-\d{2}T\d{2}:00$/);
  assert.deepEqual([0, 7, 44, 291, 1200].map(niceMax), [10, 8, 50, 300, 1500]);
  const html = runsSection({ runs: [{ id: 'r1', dungeon: '<b>Fire</b>', startsAt: '2026-10-14 13:00:00.000Z', note: '', planner: 'u1', attendees: ['u1', 'u2'] }], members: [{ user: 'u2', displayName: 'Lumina' }], myId: 'u1', viewer: false, owner: false, live: new Set(['u2']), now, suggestions: ['Fire Temple'], demo: false });
  assert.match(html, /&lt;b&gt;Fire&lt;\/b&gt;/); assert.match(html, /data-going="false"/); assert.match(html, /data-cancel-run="r1"/); assert.match(html, /wish-person live/);
  // The time input takes what the server accepts: an hour ago up to 60 days ahead.
  const { localInput, runWindow } = await import('../src/runs.js'), { min, max } = runWindow(now);
  assert.match(html, new RegExp(`name="startsAt" type="datetime-local"[^>]* min="${localInput(min)}" max="${localInput(max)}"`));
  const viewer = runsSection({ runs: [], members: [], myId: 'u3', viewer: true, owner: false, live: new Set(), now, suggestions: [], demo: false });
  assert.doesNotMatch(viewer, /run-form/);
  const readings = [{ value: 20, at: '2026-10-13 10:00:00.000Z' }, { value: 55, at: '2026-10-13 18:00:00.000Z' }, { value: 30, at: '2026-10-14 09:00:00.000Z' }];
  const chart = historyChart(readings, { now, cost: 40 });
  assert.match(chart, /class="history-line" d="M[\d.]+,[\d.]+H[\d.]+V[\d.]+H[\d.]+V[\d.]+H[\d.]+"/); assert.match(chart, /1 cube · 40/);
  assert.match(historyChart([], { now, cost: 40 }), /No changes/);
  assert.deepEqual([...historyList(readings).matchAll(/<td>([^<]*)<\/td><td>([^<]*)<\/td><\/tr>/g)].map(m => [m[1], m[2]]), [['30', '−25'], ['55', '+35'], ['20', '—']]);
  // Points before hourlyBefore are each hour's last change, so the count left out is a floor.
  // Show all lists every change.
  assert.match(historyList(readings, 2), /<p class="history-more">1 earlier change not listed <button class="text-button" type="button" data-history-all>Show all<\/button><\/p>/);
  assert.equal([...historyList(readings, Infinity).matchAll(/<tr><td>/g)].length, 3);
  assert.match(historyList(readings, 1, '2026-10-13 18:00:00.000Z'), /<p class="history-more">At least 2 earlier changes not listed <button/);
  // Newer Windows apps say what each change was.
  const kinds = historyList([{ value: 910, at: '2026-10-14 22:00:00.000Z', kind: 'regen' }, { value: 830, at: '2026-10-14 22:04:00.000Z', kind: 'spend' }, { value: 870, at: '2026-10-14 22:10:00.000Z', kind: 'item' }, { value: 870, at: '2026-10-14 23:00:00.000Z', kind: 'snapshot' }]);
  assert.deepEqual([...kinds.matchAll(/<span class="history-kind">([^<]*)<\/span>/g)].map(m => m[1]), ['item', 'spent', 'regeneration']);
});
test('runs go to calendars with a reminder, can be changed and count down in Czech', async () => {
  const { calendarFile, runEditForm, localInput, runsSection } = await import('../src/runs.js'), { useLanguage } = await import('../src/i18n.js');
  const now = Date.parse('2026-10-14T12:00:00Z'), run = { id: 'r1', dungeon: 'Fire Temple', startsAt: '2026-10-14 19:00:00.000Z', note: 'Potions; food, and\nmore', planner: 'u1', attendees: ['u1'] };
  const file = calendarFile(run, { room: 'Raid night', going: ['Lumina', 'Kaelen'], now });
  assert.match(file, /^BEGIN:VCALENDAR\r\n/); assert.match(file, /\r\nEND:VCALENDAR\r\n$/);
  assert.match(file, /\r\nUID:r1@odyle\r\n/); assert.match(file, /\r\nDTSTART:20261014T190000Z\r\n/); assert.match(file, /\r\nDTEND:20261014T200000Z\r\n/); assert.match(file, /\r\nTRIGGER:-PT15M\r\n/);
  assert.match(file, /SUMMARY:Fire Temple · Raid night/); assert.match(file, /DESCRIPTION:Potions\\; food\\, and\\nmore\\nGoing: Lumina\\, Kaelen/);
  // Long lines fold at 75 octets.
  const long = calendarFile({ ...run, note: 'ř'.repeat(100) }, { room: '', going: [], now });
  for (const line of long.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  assert.match(long, /\r\n ř/);
  // The change form starts from the run's values in local time.
  const form = runEditForm(run, { suggestions: ['Fire Temple'] }, now); assert.match(form, /name="runId" value="r1"/);
  // A run that started long ago can still be changed without moving its start.
  assert.match(runEditForm({ ...run, startsAt: '2026-10-14 09:00:00.000Z' }, {}, now), new RegExp(`min="${localInput(Date.parse('2026-10-14T09:00:00Z'))}"`)); assert.match(form, new RegExp(`value="${localInput(Date.parse('2026-10-14T19:00:00Z'))}"`)); assert.match(form, /value="Potions; food, and\nmore"/);
  const html = runsSection({ runs: [run], members: [], myId: 'u1', viewer: false, owner: false, live: new Set(), now, suggestions: [], demo: false, discord: true });
  assert.match(html, /data-edit-run="r1"/); assert.match(html, /data-calendar-run="r1"/); assert.match(html, /Discord reminders on/);
  assert.doesNotMatch(runsSection({ runs: [run], members: [], myId: 'u9', viewer: true, owner: false, live: new Set(), now, suggestions: [], demo: false }), /data-edit-run/);
  try { await useLanguage('cs'); const { startsIn } = await import('../src/runs.js'); assert.equal(startsIn(now + 125 * 60000, now), 'za 2 h 5 min'); assert.equal(startsIn(now + 26 * 3600000, now), 'za 1 d 2 h'); }
  finally { await useLanguage('en'); }
});
test('the account page lists paired PCs with their reader and keeps the notifications', async () => {
  const { accountView } = await import('../src/account.js'), now = Date.parse('2026-10-14T12:00:00Z');
  const html = accountView({ account: { displayName: 'Lumina', email: '' }, characters: 1, limits: { characters: 30 }, reminders: 'off', now,
    devices: [{ id: 'd1', name: 'DESK-PC', pairedAt: '2026-10-01 10:00:00.000Z', lastSignInAt: '2026-10-14 11:00:00.000Z' }, { id: 'd2', name: '', pairedAt: '2026-10-02 10:00:00.000Z', lastSignInAt: '' }],
    apps: [{ sessionId: 's1', device: 'd1', character: 'Lumina', connectedAt: '2026-10-14 11:00:00.000Z', lastContactAt: '2026-10-14 11:59:50.000Z' }, { sessionId: 's2', device: '', character: '', connectedAt: '2026-10-14 10:00:00.000Z', lastContactAt: '2026-10-14 10:00:00.000Z' }] });
  assert.match(html, /DESK-PC/); assert.match(html, /Windows PC/); assert.match(html, /data-forget-device="d1"/); assert.match(html, /data-forget-device="d2"/);
  assert.match(html, /<h2>Windows apps <span>3<\/span>/); assert.match(html, /status live/); assert.match(html, /Not reading/);
  // Notifications: the defaults until saved, and this browser's permission asked here.
  assert.match(html, /id="notifications-form"/); assert.match(html, /data-action="reminders"/);
  assert.deepEqual([...html.matchAll(/name="lead" value="(\d+)" ?(checked)?/g)].map(m => [m[1], Boolean(m[2])]), [['5', false], ['15', true], ['30', false], ['60', false], ['120', false], ['1440', false]]);
  assert.match(html, /name="tray" checked/); assert.match(html, /name="quietFrom" value=""/);
  assert.match(html, /name="cap"\s+>/); assert.match(html, /<option value="1" selected>one tick before/);
  const saved = accountView({ account: { displayName: 'L' }, characters: 0, limits: { characters: 30 }, reminders: 'blocked', now, devices: [], apps: [],
    notifications: { channels: { tray: false, browser: true, push: true }, leadMinutes: [45, 15], kinds: { runs: true, cap: false }, quiet: { from: '23:00', to: '07:00', timeZone: 'Europe/Prague' }, saved: true } });
  // Usage against the limits, the inactive-account date, each app's version and the operator's pause (#49).
  const counted = accountView({ account: { displayName: 'L', created: '2026-01-05 10:00:00.000Z' }, characters: 3, limits: { characters: 30, ownedRooms: 20, memberships: 50, desktopDevices: 10 }, usage: { ownedRooms: 1, memberships: 2, desktopDevices: 1, characters: 3 }, retention: { inactiveAccountDays: 90, deleteAfter: '2027-01-12 10:00:00.000Z' }, paused: { reminders: true }, latestVersion: '0.16.0', now,
    devices: [{ id: 'd1', name: 'DESK-PC', pairedAt: '2026-10-01 10:00:00.000Z' }], apps: [{ sessionId: 's1', device: 'd1', character: 'Lumina', appVersion: '0.15.0', connectedAt: '2026-10-14 11:00:00.000Z', lastContactAt: '2026-10-14 11:59:50.000Z' }] });
  assert.match(counted, /Rooms you lead 1\/20 · rooms 2\/50 · PCs 1\/10 · characters 3\/30 · member since 5 Jan 2026/);
  assert.match(counted, /unused for 90 days are deleted\. Yours would be on 12 Jan 2027/);
  assert.match(counted, /Odyle 0\.15\.0 · <span class="update-due">update available<\/span>/);
  assert.match(counted, /operator has paused planned-run reminders/);
  assert.doesNotMatch(html, /update available|operator has paused|Rooms you lead/);
  assert.match(saved, /blocked for this site/); assert.doesNotMatch(saved, /data-action="reminders"/);
  assert.match(saved, /name="tray"\s+>/); assert.match(saved, /value="45" checked><span>45 min/); assert.match(saved, /name="quietFrom" value="23:00"/); assert.match(saved, /in Europe\/Prague/);
});
test('cap alerts say when the natural pool is full, or that it loses each tick', async () => {
  const { capAlertText } = await import('../src/notify.js'), { useLanguage } = await import('../src/i18n.js');
  await useLanguage('en');
  const soon = { characterId: 'c', characterName: 'Lumina', state: 'soon', base: 545, cap: 840, settled: true, tick: 15, at: '2026-10-15T19:00:00.000Z' };
  assert.equal(capAlertText(soon).title, 'Lumina caps soon'); assert.match(capAlertText(soon).body, /^Its natural pool is full ≈ .+; each tick of 15 after that is lost\.$/);
  assert.match(capAlertText({ ...soon, settled: false, cap: 560 }).body, /^Its natural pool reaches 560 ≈ .+, full if that is its cap\.$/);
  assert.deepEqual(capAlertText({ ...soon, state: 'full', at: '' }), { title: 'Lumina is losing Odyle', body: 'Its natural pool is full: each tick of 15 is lost until you spend some.' });
  await useLanguage('cs');
  assert.equal(capAlertText({ ...soon, state: 'full', settled: false, cap: 560 }).body, 'Přirozená zásoba je na 560: pokud je to její strop, každých 15 propadá.');
  await useLanguage('en');
});
test('run reminders come once, at the smallest reminder time a run is within, and never in quiet hours', async () => {
  const { dueReminders, quietAt, leadLabel } = await import('../src/notify.js'), now = Date.parse('2026-10-15T18:00:00Z');
  const runs = [{ id: 'a', startsAt: '2026-10-15 18:10:00.000Z' }, { id: 'b', startsAt: '2026-10-15 19:30:00.000Z' }, { id: 'c', startsAt: '2026-10-16 18:00:00.000Z' }, { id: 'd', startsAt: '2026-10-15 17:59:00.000Z' }];
  const due = dueReminders(runs, now, [120, 15], {});
  assert.deepEqual(due.map(d => [d.run.id, d.lead, d.marks.length]), [['a', 15, 2], ['b', 120, 1]]);
  const done = Object.fromEntries(due.flatMap(d => d.marks.map(k => [k, d.at])));
  assert.deepEqual(dueReminders(runs, now, [120, 15], done), []);
  // Later, run b comes within 15 minutes and is reminded again.
  assert.deepEqual(dueReminders(runs, Date.parse('2026-10-15T19:20:00Z'), [120, 15], done).map(d => [d.run.id, d.lead]), [['b', 15]]);
  const night = { quiet: { from: '22:00', to: '07:00', timeZone: 'Europe/Prague' } };
  assert.equal(quietAt(night, Date.parse('2026-10-15T19:59:00Z')), false); assert.equal(quietAt(night, Date.parse('2026-10-15T20:00:00Z')), true);
  assert.equal(quietAt(night, Date.parse('2026-10-16T05:00:00Z')), false); assert.equal(quietAt({ quiet: { from: '', to: '' } }, now), false);
  assert.deepEqual([5, 60, 90, 1440].map(leadLabel), ['5 min', '1 h', '90 min', '24 h']);
});

test('a run copies as a Discord message nobody can format or ping with (#35)', async () => {
  const { discordText } = await import('../src/runs.js');
  const run = { dungeon: 'Fire *Temple*', startsAt: '2026-10-17 18:00:00.000Z', note: 'Bring <@1234567> and @everyone_pots' };
  const unix = Date.parse('2026-10-17T18:00:00Z') / 1000;
  assert.equal(discordText(run, { going: ['Lumina', 'Kaelen_x'], partySize: 4, link: 'https://odyle.example/#/room/r1' }),
    String.raw`**Fire \*Temple\*** · <t:` + unix + String.raw`:F> (<t:` + unix + String.raw`:R>) · Going (2/4): Lumina, Kaelen\_x · Bring \<\@1234567\> and \@everyone\_pots · https://odyle.example/#/room/r1`);
  assert.equal(discordText({ ...run, note: '' }, {}), String.raw`**Fire \*Temple\*** · <t:` + unix + String.raw`:F> (<t:` + unix + String.raw`:R>) · Going (0)`);
});
test('the Notifications card has the switch for open tasks before a reset, on until turned off', async () => {
  const { accountView } = await import('../src/account.js'), now = Date.parse('2026-10-14T12:00:00Z');
  const view = notifications => accountView({ account: { displayName: 'L' }, characters: 0, limits: { characters: 30 }, now, devices: [], apps: [], ...(notifications ? { notifications } : {}) });
  assert.match(view(), /name="tasks" checked/); assert.match(view(), /once per reset, and never when everything is done/);
  const saved = { channels: { tray: true, browser: true, push: true }, leadMinutes: [15], kinds: { runs: true, cap: false }, quiet: { from: '', to: '', timeZone: '' }, saved: true };
  assert.match(view(saved), /name="tasks" checked/, 'settings saved before the switch keep it on');
  assert.match(view({ ...saved, kinds: { ...saved.kinds, tasks: false } }), /name="tasks"\s+>/);
});
test('a run planned into the weekly maintenance says so', async () => {
  const { maintenanceAt, runsSection } = await import('../src/runs.js');
  const window = { day: 'wednesday', hour: 6, hours: 3 }, at = text => Date.parse(text);
  // 2026-10-21 is a Wednesday: 06:00–09:00 UTC, and a run lasts an hour from its start.
  assert.deepEqual(maintenanceAt(at('2026-10-21T07:00:00Z'), window), { from: at('2026-10-21T06:00:00Z'), to: at('2026-10-21T09:00:00Z') });
  assert.ok(maintenanceAt(at('2026-10-21T05:30:00Z'), window), 'a run that runs into it');
  assert.equal(maintenanceAt(at('2026-10-21T05:00:00Z'), window), null, 'a run that ends as it starts');
  assert.equal(maintenanceAt(at('2026-10-21T09:00:00Z'), window), null);
  assert.ok(maintenanceAt(at('2026-10-28T08:59:00Z'), window), 'every week');
  assert.equal(maintenanceAt(at('2026-10-22T07:00:00Z'), window), null);
  assert.equal(maintenanceAt(at('2026-10-21T07:00:00Z'), null), null);
  assert.ok(maintenanceAt(at('2026-10-25T23:30:00Z'), { day: 'monday', hour: 0, hours: 2 }), 'a Sunday run into a Monday window');
  const now = at('2026-10-20T12:00:00Z'), section = startsAt => runsSection({ runs: [{ id: 'r', dungeon: 'Fire Temple', startsAt, attendees: [], planner: 'a', note: '' }], members: [], myId: 'a', viewer: false, owner: false, live: new Set(), now, maintenance: window });
  assert.match(section('2026-10-21T07:00:00.000Z'), /class="run-warning">During the weekly maintenance of the game \(/);
  assert.doesNotMatch(section('2026-10-21T12:00:00.000Z'), /run-warning/);
});
test('the Notifications card has the party-ready switch, on until turned off', async () => {
  const { accountView } = await import('../src/account.js'), now = Date.parse('2026-10-14T12:00:00Z');
  const view = notifications => accountView({ account: { displayName: 'L' }, characters: 0, limits: { characters: 30 }, now, devices: [], apps: [], ...(notifications ? { notifications } : {}) });
  assert.match(view(), /name="ready" checked/); assert.match(view(), /once everyone going plays live with enough Odyle for a cube/);
  const saved = { channels: { tray: true, browser: true, push: true }, leadMinutes: [15], kinds: { runs: true, cap: false }, quiet: { from: '', to: '', timeZone: '' }, saved: true };
  assert.match(view(saved), /name="ready" checked/); assert.match(view({ ...saved, kinds: { ...saved.kinds, ready: false } }), /name="ready"\s+>/);
});
test('Rooms & characters lists your next runs and each room at a glance', async () => {
  const { calendarOfRuns, nextRunsSection, roomGlance } = await import('../src/runs.js'), now = Date.parse('2026-10-14T12:00:00Z');
  const runs = [{ id: 'r1', roomId: 'room1', room: 'Raid night', dungeon: 'Fire Temple', startsAt: '2026-10-14 14:00:00.000Z', note: '' }, { id: 'r2', roomId: 'room2', room: 'Alts', dungeon: 'Ice Temple', startsAt: '2026-10-16 18:00:00.000Z', note: 'Bring potions' }];
  const html = nextRunsSection(runs, now);
  assert.match(html, /<h2>Your next runs <span>2<\/span>/); assert.match(html, /data-action="calendar-all"/);
  assert.match(html, /data-room="room1"[\s\S]*Fire Temple[\s\S]*Raid night · [^<]* · in 2h 0m/); assert.match(html, /data-room="room2"/);
  assert.equal(nextRunsSection([], now), '');
  // One calendar file with every run, each with its own UID and reminder.
  const file = calendarOfRuns(runs, now);
  assert.equal(file.match(/BEGIN:VCALENDAR/g).length, 1); assert.equal(file.match(/BEGIN:VEVENT/g).length, 2);
  assert.match(file, /UID:r1@odyle/); assert.match(file, /SUMMARY:Ice Temple · Alts/); assert.match(file, /DESCRIPTION:Bring potions/);
  // Rooms: members, live players and their cubes, the next run; the cost alone from older servers.
  assert.equal(roomGlance({ role: 'officer', memberCount: 4, liveCount: 2, partyCubes: 3, nextRun: { dungeon: 'Fire Temple', startsAt: '2026-10-14 13:05:00.000Z' } }, now), 'officer · 4 members · 2 live · party 3 cubes · next: Fire Temple in 1h 5m');
  assert.equal(roomGlance({ role: 'owner', memberCount: 1, liveCount: 0, partyCubes: 0, nextRun: null }, now), 'leader · 1 member');
  assert.equal(roomGlance({ role: 'reporter', cost: 40 }, now), 'player · 40 Odyle per cube');
});
test('a member without a character in the room sees the steps to get one there', async () => {
  const { setupTracker, setupSteps } = await import('../src/setup.js');
  const states = s => setupSteps(s).map(x => x.state).join(' ');
  assert.equal(states({ paired: false, online: false, saved: false, shared: false }), 'now later later later');
  assert.equal(states({ paired: true, online: false, saved: false, shared: false }), 'done now later later');
  assert.equal(states({ paired: true, online: true, saved: false, shared: false }), 'done done now later');
  // A character saved once: the app was paired and read it, whether it runs now or not.
  assert.equal(states({ paired: false, online: false, saved: true, shared: false }), 'done done done now');
  const first = setupTracker({ paired: false, online: false, saved: false, shared: false }, { install: '<a class="download">Download</a>', add: '<div class="add-chips"></div>' });
  assert.match(first, /Step 1 of 4/); assert.match(first, /More info → Run anyway[\s\S]*Npcap/); assert.match(first, /class="download"/); assert.doesNotMatch(first, /add-chips/);
  const last = setupTracker({ paired: true, online: false, saved: true, shared: false }, { install: '<a class="download">Download</a>', add: '<div class="add-chips"></div>' });
  assert.match(last, /Step 4 of 4/); assert.match(last, /add-chips/); assert.doesNotMatch(last, /class="download"/); assert.equal((last.match(/setup-step done/g) || []).length, 3);
  assert.equal(setupTracker({ paired: true, online: true, saved: true, shared: true }), '');
});
test('around its start a run calls the roll: each attendee in words and a count', async () => {
  const { runsSection, rollCallOf, rollCallLine, inRollCall } = await import('../src/runs.js'), now = Date.parse('2026-10-14T20:00:00Z');
  const at = ms => new Date(ms).toISOString();
  // From 15 minutes before the start to 30 minutes after it.
  assert.deepEqual([16, 15, -30, -31].map(minutes => inRollCall(now + minutes * 60000, now)), [false, true, true, false]);
  const live = { characterName: 'Lumina', displayName: 'Lumina', lastReadingAt: at(now - 60000) };
  const rows = [{ user: 'a', character: live, state: 'live', claims: true, cubes: 2, cubesAtStart: 2 }, { user: 'b', character: { ...live, characterName: 'Kaelen', displayName: 'Kaelen' }, state: 'live', claims: false, cubes: 0, cubesAtStart: 0 }, { user: 'c', character: { ...live, characterName: 'Nyx', displayName: 'Nyx' }, state: 'offline', claims: true, cubes: 1, cubesAtStart: 1 }, { user: 'd', character: null, state: 'unknown', claims: false }];
  assert.deepEqual(rows.map(rollCallOf), ['ready', 'short', 'away', 'none']);
  assert.equal(rollCallLine(rows), '1 ready · 1 short · 1 not in game · 1 without a character');
  const members = ['a', 'b', 'c', 'd'].map(user => ({ user, displayName: user.toUpperCase() }));
  const section = start => runsSection({ runs: [{ id: 'r', dungeon: 'Fire Temple', startsAt: at(start), attendees: ['a', 'b', 'c', 'd'], planner: 'a', note: '' }], members, myId: 'a', viewer: false, owner: false, live: new Set(), now, readiness: () => ({ rows, claim: 2, of: 4 }) });
  const calling = section(now + 10 * 60000);
  assert.match(calling, /Roll call: 1 ready · 1 short · 1 not in game · 1 without a character/);
  assert.match(calling, /class="roll-call ready">ready</); assert.match(calling, /D · <b class="roll-call none">no character</);
  assert.doesNotMatch(section(now + 60 * 60000), /roll-call/, 'an hour ahead: no roll call yet');
});
