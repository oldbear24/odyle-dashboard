const { test } = require('node:test');
const assert = require('node:assert/strict');
const memory = () => { const data = {}; return { getItem: key => data[key] ?? null, setItem: (key, value) => { data[key] = String(value); } }; };
test('invite links carry the code in the fragment and the owner\'s browser remembers live codes', async () => {
  const { inviteLink, joinCode, savedInvites, rememberInvites, forgetInvites } = await import('../src/invites.js');
  assert.equal(inviteLink('https://odyle.example/app/?x=1#/room/abc', 'ABCDEFGH2345'), 'https://odyle.example/app/#/join/ABCDEFGH2345');
  assert.equal(joinCode('/join/abcd-efgh-2345'), 'ABCDEFGH2345'); assert.equal(joinCode('/room/abc'), ''); assert.equal(joinCode('/join/<x>'), '');
  const storage = memory(), now = Date.parse('2026-10-14T12:00:00Z');
  rememberInvites(storage, 'room1', [{ code: 'AAAA', role: 'reporter', expiresAt: '2026-10-14T12:30:00Z', extra: 'dropped' }, { code: 'BBBB', role: 'viewer', expiresAt: '2026-10-14T11:59:00Z' }], now);
  assert.deepEqual(savedInvites(storage, 'room1', now), [{ code: 'AAAA', role: 'reporter', expiresAt: '2026-10-14T12:30:00Z' }]);
  assert.deepEqual(savedInvites(storage, 'room1', now + 3600000), []); assert.deepEqual(savedInvites(storage, 'other', now), []);
  forgetInvites(storage, 'room1', now); assert.deepEqual(savedInvites(storage, 'room1', now), []);
  // Broken or blocked storage never breaks the dialog.
  assert.deepEqual(savedInvites({ getItem: () => '{not json' }, 'room1', now), []);
  rememberInvites({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, 'room1', [], now);
});
test('sign-in names browsers built into apps and its way out keeps the invite', async () => {
  const { inAppBrowser, signInLink } = await import('../src/signin.js');
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';
  const browsers = [iphone + ' Version/17.5 Mobile/15E148 Safari/604.1', iphone + ' CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'];
  const apps = [iphone + ' Mobile/15E148', iphone + ' Mobile/15E148 Instagram 312.0.0.32.112 (iPhone15,2; iOS 17_5; en_GB)', iphone + ' Mobile/15E148 [FBAN/FBIOS;FBAV/450.0.0.38.108]', 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A.240505.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36', 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 Line/14.5.0'];
  assert.deepEqual(browsers.map(ua => inAppBrowser(ua)), [false, false, false, false]);
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
  const form = runEditForm(run, ['Fire Temple'], now); assert.match(form, /name="runId" value="r1"/);
  // A run that started long ago can still be changed without moving its start.
  assert.match(runEditForm({ ...run, startsAt: '2026-10-14 09:00:00.000Z' }, [], now), new RegExp(`min="${localInput(Date.parse('2026-10-14T09:00:00Z'))}"`)); assert.match(form, new RegExp(`value="${localInput(Date.parse('2026-10-14T19:00:00Z'))}"`)); assert.match(form, /value="Potions; food, and\nmore"/);
  const html = runsSection({ runs: [run], members: [], myId: 'u1', viewer: false, owner: false, live: new Set(), now, suggestions: [], demo: false, discord: true });
  assert.match(html, /data-edit-run="r1"/); assert.match(html, /data-calendar-run="r1"/); assert.match(html, /Discord reminders on/);
  assert.doesNotMatch(runsSection({ runs: [run], members: [], myId: 'u9', viewer: true, owner: false, live: new Set(), now, suggestions: [], demo: false }), /data-edit-run/);
  try { await useLanguage('cs'); const { startsIn } = await import('../src/runs.js'); assert.equal(startsIn(now + 125 * 60000, now), 'za 2 h 5 min'); assert.equal(startsIn(now + 26 * 3600000, now), 'za 1 d 2 h'); }
  finally { await useLanguage('en'); }
});
test('the account page lists paired PCs with their reader and offers reminders', async () => {
  const { accountView } = await import('../src/account.js'), now = Date.parse('2026-10-14T12:00:00Z');
  const html = accountView({ account: { displayName: 'Lumina', email: '' }, characters: 1, limits: { characters: 30 }, reminders: 'off', now,
    devices: [{ id: 'd1', name: 'DESK-PC', pairedAt: '2026-10-01 10:00:00.000Z', lastSignInAt: '2026-10-14 11:00:00.000Z' }, { id: 'd2', name: '', pairedAt: '2026-10-02 10:00:00.000Z', lastSignInAt: '' }],
    apps: [{ sessionId: 's1', device: 'd1', character: 'Lumina', connectedAt: '2026-10-14 11:00:00.000Z', lastContactAt: '2026-10-14 11:59:50.000Z' }, { sessionId: 's2', device: '', character: '', connectedAt: '2026-10-14 10:00:00.000Z', lastContactAt: '2026-10-14 10:00:00.000Z' }] });
  assert.match(html, /DESK-PC/); assert.match(html, /Windows PC/); assert.match(html, /data-forget-device="d1"/); assert.match(html, /data-forget-device="d2"/);
  assert.match(html, /<h2>Windows apps <span>3<\/span>/); assert.match(html, /status live/); assert.match(html, /Not reading/);
  assert.match(html, /data-action="reminders" aria-pressed="false"/);
  assert.match(accountView({ account: { displayName: 'L' }, characters: 0, limits: { characters: 30 }, reminders: 'blocked', now, devices: [], apps: [] }), /blocked for this site/);
});
