// Browser checks of the built dashboard (npm run build first) against a disposable
// backend on port 18091 (the test build, npm run backend:build). Accounts are issued by
// a test-only route (backend/odyle/testing.go) and put into the
// browser's localStorage as the SDK stores a Discord sign-in. Set ODYLE_UI_SHOTS to a
// directory to keep a screenshot of every checked page, and ODYLE_UI_WIDTH to check
// another viewport width (390 for a phone).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
const url = 'http://127.0.0.1:18091';
let child, directory, browser, discord, discordUrl, discordPosts = 0;
const shots = process.env.ODYLE_UI_SHOTS;
async function request(path, body, auth, method = 'POST') {
  const res = await fetch(url + path, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth.token } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, data: await res.json() };
}
const account = async name => (await request('/__test__/account', { name })).data;
before(async () => {
  assert.ok(existsSync(resolve('dist/index.html')), 'Build the dashboard first: npm run build');
  // Stands in for Discord's webhook API.
  discord = createServer((req, res) => { discordPosts++; req.resume(); req.on('end', () => { res.writeHead(204); res.end(); }); });
  await new Promise(r => discord.listen(0, '127.0.0.1', r)); discordUrl = 'http://127.0.0.1:' + discord.address().port;
  directory = await mkdtemp(join(tmpdir(), 'odyle-ui-test-'));
  child = spawn(resolve('.runtime', process.platform === 'win32' ? 'odyle-test.exe' : 'odyle-test'), ['serve', '--http=127.0.0.1:18091', '--dir=' + join(directory, 'data'), '--publicDir=' + resolve('dist')], { stdio: 'ignore', env: { ...process.env, PLAYNC_SEARCH_URL: 'http://127.0.0.1:9/search', ODYLE_WINDOWS_RELEASE_URL: 'http://127.0.0.1:9/releases', ODYLE_DISCORD_WEBHOOK_BASE: discordUrl } });
  for (let i = 0; i < 50 && !(await fetch(url + '/api/health').then(r => r.ok, () => false)); i++) await delay(100);
  browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
  if (shots) await mkdir(shots, { recursive: true });
});
after(async () => { await browser?.close(); discord?.close(); if (child && child.exitCode === null) { const closed = new Promise(r => child.once('exit', r)); child.kill(); await closed; } if (directory) await rm(directory, { recursive: true, force: true }); });
// A browser tab signed in as `auth` (or signed out), in the given language, failing on page errors.
async function open(auth, path = '#/', language = 'en') {
  const context = await browser.newContext({ viewport: { width: Number(process.env.ODYLE_UI_WIDTH) || 1280, height: 900 }, acceptDownloads: true, locale: language === 'cs' ? 'cs-CZ' : 'en-GB' });
  await context.addInitScript(([session, lang]) => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); if (session) localStorage.setItem('odyle.account', session); localStorage.setItem('odyle.language', lang); } }, [auth ? JSON.stringify({ token: auth.token, record: auth.record }) : '', language]);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(message.text()); });
  await page.goto(url + '/' + path);
  return { page, errors, close: () => context.close() };
}
const shot = async (page, name) => { if (shots) await page.screenshot({ path: join(shots, name + '.png'), fullPage: true }); };
const toast = page => page.locator('#toast.show');
// The sidebar on wide screens, the account menu behind the avatar on phones.
async function navigate(page, action) {
  const item = page.locator(`.sidebar [data-action="${action}"]`);
  if (await item.isVisible()) return item.click();
  await page.locator('.avatar').click(); await page.locator(`#modal [data-action="${action}"]`).click();
}

test('the demo workspace shows the party, wishlist, planned runs and a character history', async () => {
  const { page, errors, close } = await open(null, '#/demo');
  try {
    await page.getByRole('heading', { name: 'Party overview.' }).waitFor();
    assert.equal(await page.locator('.runs .wish-row').count(), 1);
    assert.match(await page.locator('.runs .wish-row').innerText(), /Fire Temple/);
    assert.equal(await page.locator('.wishlist:not(.runs) .wish-row').count(), 3);
    await shot(page, 'demo');
    await page.locator('[data-history="c1"]').click();
    await page.locator('#modal .history-line').waitFor();
    await page.locator('#modal svg').hover({ position: { x: 300, y: 80 } });
    assert.match(await page.locator('#modal .history-tip').innerText(), /Odyle/);
    assert.ok(await page.locator('#modal .history-table tbody tr').count() > 5);
    await shot(page, 'demo-history');
    await page.keyboard.press('Escape');
    await page.locator('[data-action="room-settings"]').click();
    assert.match(await page.locator('#modal').innerText(), /sample data/);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('owners invite with a link, manage the room and close it only after confirming', async () => {
  const [lead, friend] = await Promise.all([account('UI lead'), account('UI friend')]);
  const owner = await open(lead);
  try {
    const { page } = owner;
    await page.getByRole('heading', { name: 'Welcome, UI lead.' }).waitFor();
    await page.locator('#create-form [name=name]').fill('UI room');
    await page.locator('#create-form [type=submit]').click();
    await page.locator('#modal .invite-row').first().waitFor();
    const link = await page.locator('#modal [data-copied]').first().getAttribute('data-copy');
    assert.match(link, /#\/join\/[A-Z2-9]{12}$/);
    await shot(page, 'invite');
    // The browser remembers the codes it created, so the dialog shows them after a reload.
    await page.reload(); await page.locator('[data-action="invite"]:visible').first().click();
    assert.equal(await page.locator('#modal [data-copied]').first().getAttribute('data-copy'), link);
    await page.keyboard.press('Escape');

    // A friend who is not signed in opens the link, signs in and lands in the room.
    const guest = await open(null, link.slice(link.indexOf('#')));
    try {
      await guest.page.locator('.join-note').waitFor();
      await guest.page.evaluate(session => localStorage.setItem('odyle.account', session), JSON.stringify({ token: friend.token, record: friend.record }));
      await guest.page.reload();
      await guest.page.getByRole('heading', { name: 'Party overview.' }).waitFor();
      assert.match(guest.page.url(), /#\/room\/[a-z0-9]+$/);
      assert.equal(await guest.page.locator('[data-action="invite"].button').count(), 0);
      assert.deepEqual(guest.errors, []);
    } finally { await guest.close(); }

    // Replacing codes already sent asks first.
    await page.reload(); await page.locator('[data-action="invite"]:visible').first().click();
    await page.locator('#modal [data-action="generate-invites"]').click();
    assert.match(await page.locator('#modal').innerText(), /Revoke the current codes\?[\s\S]*stop working/);
    await page.locator('#modal [data-action="confirm-generate-invites"]').click();
    await page.locator('#modal .invite-row').first().waitFor();
    assert.notEqual(await page.locator('#modal [data-copied]').first().getAttribute('data-copy'), link);
    await page.keyboard.press('Escape');

    // Room settings: rename, make the friend a viewer, then hand the room over.
    await page.locator('[data-action="room-settings"]').click();
    await page.locator('#rename-form [name=name]').fill('Renamed UI room');
    await page.locator('#rename-form [type=submit]').click();
    await toast(page).filter({ hasText: 'Room renamed.' }).waitFor();
    await page.locator('#modal select[data-role]').selectOption('viewer');
    // A role change asks first.
    await page.locator('#modal [data-confirm-role]').waitFor();
    assert.match(await page.locator('#modal').innerText(), /Make UI friend a viewer\?/);
    await page.locator('#modal [data-confirm-role]').click();
    await toast(page).filter({ hasText: 'Role changed.' }).waitFor();
    assert.equal(await page.locator('#modal select[data-role]').inputValue(), 'viewer');
    await shot(page, 'room-settings');
    await page.locator('#modal [data-action="close-room"]').click();
    assert.match(await page.locator('#modal').innerText(), /cannot be undone/);
    await page.locator('#modal [data-action="close-dialog"]').last().click();
    assert.equal((await request('/api/odyle/rooms', undefined, lead, 'GET')).data.rooms.length, 1, 'cancelled close keeps the room');
    await page.locator('[data-action="room-settings"]').click();
    await page.locator('#modal [data-transfer]').click();
    await page.locator('#modal [data-confirm-transfer]').click();
    await toast(page).filter({ hasText: 'You handed the room over' }).waitFor();
    const rooms = (await request('/api/odyle/rooms', undefined, lead, 'GET')).data.rooms;
    assert.deepEqual(rooms.map(r => [r.name, r.role]), [['Renamed UI room', 'reporter']]);
    // A member leaves only after confirming.
    await page.locator('[data-action="room-settings"]').click();
    await page.locator('#modal [data-action="leave-room"]').click();
    await page.locator('#modal [data-action="confirm-leave"]').click();
    await page.getByRole('heading', { name: 'Welcome, UI lead.' }).waitFor();
    assert.equal((await request('/api/odyle/rooms', undefined, lead, 'GET')).data.rooms.length, 0);
    assert.deepEqual(owner.errors, []);
  } finally { await owner.close(); }
});

test('rooms plan, change and export runs, and members see each character history', async () => {
  const [lead, mate, stranger] = await Promise.all([account('Run lead'), account('Run mate'), account('Run stranger')]);
  const created = (await request('/api/odyle/create', { name: 'Run room' }, lead)).data, roomId = created.room.id;
  assert.equal((await request('/api/odyle/join', { code: created.invites[0].code }, mate)).status, 200);
  const session = (await request('/api/odyle/session', {}, lead)).data;
  const reading = { sessionId: session.sessionId, characterName: 'Charted', server: 'Lumiel', region: 'GLOBAL_EU', source: 'packet', parserVersion: 'test-fixture-v1', confirmed: true };
  const c = (await request('/api/odyle/report', { ...reading, sequence: 1, value: 20 }, lead)).data.character;
  for (const [sequence, value] of [[2, 55], [3, 30], [4, 90]]) await request('/api/odyle/report', { ...reading, sequence, value, characterId: c.id }, lead);
  await request('/api/odyle/sharing', { roomId, characterId: c.id, enabled: true }, lead);
  await request('/api/odyle/wishlist', { roomId, dungeon: 'Fire Temple', wanted: true }, lead);
  const { page, errors, close } = await open(lead, '#/room/' + roomId);
  try {
    await page.getByRole('heading', { name: 'Party overview.' }).waitFor();
    await page.locator('[data-plan-wish="Fire Temple"]').click();
    assert.equal(await page.locator('#run-form [name=dungeon]').inputValue(), 'Fire Temple');
    // The start takes only what the server accepts; where a browser ignores the bounds, the form says why before sending.
    const start = page.locator('#run-form [name=startsAt]'), sent = [];
    assert.match(await start.getAttribute('min'), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/); assert.match(await start.getAttribute('max'), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    page.on('request', r => { if (r.url().endsWith('/api/odyle/plan')) sent.push(r.url()); });
    await start.evaluate(input => { input.removeAttribute('max'); input.value = new Date(Date.now() + 70 * 86400000).toISOString().slice(0, 16); });
    await page.locator('#run-form [type=submit]').click();
    assert.match(await page.locator('#run-form .form-error[role=alert]').innerText(), /from an hour ago up to 60 days ahead/);
    assert.deepEqual(sent, []);
    await start.evaluate(input => { input.value = input.defaultValue; });
    await page.locator('#run-form [name=note]').fill('Bring potions');
    await page.locator('#run-form [type=submit]').click();
    await page.locator('.runs .wish-row').waitFor();
    assert.match(await page.locator('.runs .wish-row').innerText(), /Fire Temple[\s\S]*Bring potions[\s\S]*You/);
    assert.match(await page.locator('.runs [data-starts]').innerText(), /^in /);
    // The planner changes the run in a dialog and anyone can put it in their calendar.
    await page.locator('.runs [data-edit-run]').click();
    await page.locator('#run-edit-form [name=note]').fill('Bring food');
    await page.locator('#run-edit-form [type=submit]').click();
    await toast(page).filter({ hasText: 'Run updated.' }).waitFor();
    assert.match(await page.locator('.runs .wish-row').innerText(), /Bring food/);
    const calendar = page.waitForEvent('download'); await page.locator('.runs [data-calendar-run]').click();
    const ics = await calendar; assert.equal(ics.suggestedFilename(), 'odyle-fire-temple.ics');
    await page.locator(`[data-history="${c.id}"]`).click();
    await page.locator('#modal .history-line').waitFor();
    assert.deepEqual(await page.locator('#modal .history-table tbody td:nth-child(2)').allInnerTexts(), ['90', '30', '55', '20']);
    await shot(page, 'room-history');
    await page.keyboard.press('Escape');
    // Cancelling a run asks first.
    await page.locator('.runs [data-cancel-run]').click();
    await page.locator('#modal [data-confirm-cancel-run]').click();
    await page.locator('.runs .wish-empty').waitFor();
    assert.deepEqual(errors, []);
  } finally { await close(); }
  // Another member reads the history of a character shared in the room; an outsider is sent home.
  const other = await open(mate, '#/room/' + roomId);
  try {
    await other.page.getByRole('heading', { name: 'Party overview.' }).waitFor();
    await other.page.locator(`[data-history="${c.id}"]`).click();
    await other.page.locator('#modal .history-line').waitFor();
    assert.equal(await other.page.locator('#modal .history-table tbody tr').count(), 4);
    assert.equal(await other.page.locator('.runs [data-edit-run]').count(), 0);
    assert.deepEqual(other.errors, []);
  } finally { await other.close(); }
  const outside = await open(stranger, '#/room/' + roomId);
  try { await outside.page.getByRole('heading', { name: 'Welcome, Run stranger.' }).waitFor(); assert.match(outside.page.url(), /#\/$/); } finally { await outside.close(); }
});
test('members keep the wishlist together, share characters and viewers only watch', async () => {
  const [lead, mate, watcher] = await Promise.all([account('Wish lead'), account('Wish mate'), account('Wish watcher')]);
  const created = (await request('/api/odyle/create', { name: 'Wish room' }, lead)).data, roomId = created.room.id;
  const mine = (await request('/api/odyle/character', { characterName: 'Sharer', server: 'Lumiel', region: 'GLOBAL_EU' }, mate)).data.character;
  // A typed invite code joins too.
  const mates = await open(mate);
  try {
    await mates.page.getByRole('heading', { name: 'Welcome, Wish mate.' }).waitFor();
    await mates.page.locator('#join-form [name=code]').fill(created.invites[0].code.match(/.{4}/g).join(' '));
    await mates.page.locator('#join-form [type=submit]').click();
    await mates.page.getByRole('heading', { name: 'Party overview.' }).waitFor();
    // Characters join the room from the bar above the party and leave it from their card.
    await mates.page.locator(`.add-chip[data-share="${mine.id}"]`).click();
    await mates.page.locator(`.member-card [data-share="${mine.id}"][data-enabled="false"]`).waitFor();
    // A blank dungeon is stopped in the form, before anything is sent.
    await mates.page.locator('#wish-form [name=dungeon]').fill('   ');
    await mates.page.locator('#wish-form [type=submit]').click();
    assert.match(await mates.page.locator('#wish-form .form-error[role=alert]').innerText(), /Dungeon is required/);
    await mates.page.locator('#wish-form [name=dungeon]').fill('Fire Temple');
    await mates.page.locator('#wish-form [type=submit]').click();
    await mates.page.locator('.wishlist .wish-row').first().waitFor();
    await mates.page.locator(`.member-card [data-share="${mine.id}"]`).click();
    await toast(mates.page).filter({ hasText: 'was removed from this room' }).waitFor();
    // Room sharing on My rooms & characters switches it back on.
    await navigate(mates.page, 'library');
    const chip = mates.page.locator(`.share-chip[data-share="${mine.id}"][data-room-id="${roomId}"]`);
    assert.equal(await chip.getAttribute('aria-pressed'), 'false');
    await chip.click(); await mates.page.locator(`.share-chip[data-share="${mine.id}"][aria-pressed="true"]`).waitFor();
    assert.deepEqual(mates.errors, []);
  } finally { await mates.close(); }
  const owner = await open(lead, '#/room/' + roomId);
  try {
    await owner.page.locator('[data-wish="Fire Temple"][data-wanted="true"]').click();
    await owner.page.locator('[data-wish="Fire Temple"][data-wanted="false"]').waitFor();
    assert.match(await owner.page.locator('.wishlist .wish-row').first().innerText(), /2 members need it/);
    await owner.page.locator('[data-wish="Fire Temple"][data-wanted="false"]').click();
    await owner.page.locator('[data-wish="Fire Temple"][data-wanted="true"]').waitFor();
    await owner.page.locator('[data-clear-wish="Fire Temple"]').click();
    await owner.page.locator('#modal [data-confirm-clear]').click();
    await owner.page.locator('.wishlist:not(.runs) .wish-empty').waitFor();
    assert.deepEqual(owner.errors, []);
  } finally { await owner.close(); }
  assert.equal((await request('/api/odyle/join', { code: created.invites[1].code }, watcher)).status, 200);
  const viewer = await open(watcher, '#/room/' + roomId);
  try {
    await viewer.page.getByRole('heading', { name: 'Party overview.' }).waitFor();
    assert.equal(await viewer.page.locator('#wish-form, #run-form').count(), 0);
    assert.match(await viewer.page.locator('.wishlist').first().innerText(), /Viewers can see the wishlist/);
    assert.match(await viewer.page.locator('.sharing-bar').innerText(), /Viewers cannot add characters/);
    assert.deepEqual(viewer.errors, []);
  } finally { await viewer.close(); }
});
test('a room follows heartbeats and readings as they arrive, without fetching the room again', async () => {
  const [lead, reader] = await Promise.all([account('Live lead'), account('Live reader')]);
  const created = (await request('/api/odyle/create', { name: 'Live room' }, lead)).data;
  assert.equal((await request('/api/odyle/join', { code: created.invites[0].code }, reader)).status, 200);
  const session = (await request('/api/odyle/session', {}, reader)).data;
  const reading = { sessionId: session.sessionId, characterName: 'Pulse', server: 'Lumiel', region: 'GLOBAL_EU', source: 'packet', parserVersion: 'test-fixture-v1', confirmed: true };
  const c = (await request('/api/odyle/report', { ...reading, sequence: 1, value: 120 }, reader)).data.character;
  assert.equal((await request('/api/odyle/sharing', { roomId: created.room.id, characterId: c.id, enabled: true }, reader)).status, 200);
  // The reader went quiet a minute ago.
  assert.equal((await request('/__test__/age-seen', { id: c.id, seconds: 60 })).status, 200);
  const { page, errors, close } = await open(lead, '#/room/' + created.room.id);
  try {
    const card = page.locator('.member-card', { hasText: 'Pulse' });
    await card.locator('.status.offline, .status.stale').waitFor();
    const fetched = []; page.on('request', r => { if (r.url().includes('/api/odyle/snapshot/')) fetched.push(r.url()); });
    // Its next heartbeat makes it live again and a reading changes its value: both are pushed.
    assert.equal((await request('/api/odyle/heartbeat', { sessionId: session.sessionId, characterId: c.id }, reader)).status, 200);
    await card.locator('.status.live').waitFor({ timeout: 8000 });
    assert.equal((await request('/api/odyle/report', { ...reading, sequence: 2, value: 150, characterId: c.id }, reader)).status, 200);
    await card.locator('.energy strong', { hasText: '150' }).waitFor({ timeout: 5000 });
    assert.deepEqual(fetched, []);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});
test('an open room checks no health while live, waits while hidden and draws its own changes from their answers', async () => {
  const [lead, mate] = await Promise.all([account('Quiet lead'), account('Quiet mate')]);
  const created = (await request('/api/odyle/create', { name: 'Quiet room' }, lead)).data, roomId = created.room.id;
  assert.equal((await request('/api/odyle/join', { code: created.invites[0].code }, mate)).status, 200);
  const { page, errors, close } = await open(lead, '#/room/' + roomId);
  try {
    await page.getByRole('heading', { name: 'Party overview.' }).waitFor();
    const asked = []; page.on('request', r => { const path = new URL(r.url()).pathname; if (/^\/api\/(health|odyle\/(snapshot|announcement))/.test(path)) asked.push(path.split('/').slice(0, 4).join('/')); });
    // Realtime is connected, so no health checks; the snapshot already brought the announcement.
    await delay(21000);
    assert.deepEqual(asked, []);
    // A hidden tab leaves room news for later and catches up as soon as it is shown.
    const visibility = hidden => page.evaluate(h => { for (const [name, value] of [['hidden', h], ['visibilityState', h ? 'hidden' : 'visible']]) Object.defineProperty(document, name, { configurable: true, get: () => value }); document.dispatchEvent(new Event('visibilitychange')); }, hidden);
    await visibility(true);
    assert.equal((await request('/api/odyle/wishlist', { roomId, dungeon: 'Fire Temple', wanted: true }, mate)).status, 200);
    await delay(2000);
    assert.deepEqual(asked, []); assert.equal(await page.locator('.wishlist:not(.runs) .wish-row').count(), 0);
    await visibility(false);
    await page.locator('.wishlist:not(.runs) .wish-row', { hasText: 'Fire Temple' }).waitFor();
    assert.deepEqual(asked, ['/api/odyle/snapshot']);
    // The page's own change shows from the route's answer, even while snapshots fail.
    await page.route('**/api/odyle/snapshot/**', route => route.abort());
    await page.locator('[data-wish="Fire Temple"][data-wanted="true"]').click();
    await page.locator('[data-wish="Fire Temple"][data-wanted="false"]').waitFor();
    assert.match(await page.locator('.wishlist .wish-row').first().innerText(), /2 members need it/);
    await page.unroute('**/api/odyle/snapshot/**');
    assert.deepEqual(errors, []);
  } finally { await close(); }
});
test('the daily and weekly checklist adds, ticks, renames, orders and removes tasks', async () => {
  const user = await account('Checklist owner');
  const { page, errors, close } = await open(user, '#/tasks');
  try {
    await page.getByRole('heading', { name: 'Daily & weekly.' }).waitFor();
    for (const title of ['Daily dungeon', 'Arena']) { await page.locator('#task-form-daily [name=title]').fill(title); await page.locator('#task-form-daily [type=submit]').click(); await page.locator('.task-panel .task-row', { hasText: title }).waitFor(); }
    const titles = () => page.locator('.task-panel').first().locator('.task-text strong').allInnerTexts();
    assert.deepEqual(await titles(), ['Daily dungeon', 'Arena']);
    await page.locator('.task-panel .task-main', { hasText: 'Daily dungeon' }).click();
    await page.locator('.task-row.done', { hasText: 'Daily dungeon' }).waitFor();
    assert.match(await page.locator('.task-panel').first().locator('h2').innerText(), /1 \/ 2/);
    await page.locator('.task-row', { hasText: 'Arena' }).locator('[data-move="up"]').click();
    await page.waitForFunction(() => document.querySelector('.task-panel .task-text strong')?.textContent === 'Arena');
    await page.locator('.task-row', { hasText: 'Arena' }).locator('[data-edit-task]').click();
    await page.locator('#task-edit-form [name=title]').fill('Arena x3');
    await page.locator('#task-edit-form [type=submit]').click();
    await page.locator('.task-row', { hasText: 'Arena x3' }).waitFor();
    assert.deepEqual(await titles(), ['Arena x3', 'Daily dungeon']);
    await shot(page, 'tasks');
    await page.locator('.task-row', { hasText: 'Arena x3' }).locator('[data-remove-task]').click();
    assert.match(await page.locator('#modal').innerText(), /Remove Arena x3\?/);
    await page.locator('#modal [data-confirm-remove-task]').click();
    await page.waitForFunction(() => document.querySelectorAll('.task-panel:first-child .task-row').length === 1);
    assert.deepEqual((await request('/api/odyle/tasks', undefined, user, 'GET')).data.tasks.map(t => t.title), ['Daily dungeon']);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('the account page lists paired PCs, removes one and signs out everywhere', async () => {
  const user = await account('PC owner');
  const key = (await request('/api/odyle/desktop-device', { name: 'GAMING-PC' }, user)).data.deviceKey;
  const { page, errors, close } = await open(user, '#/account');
  try {
    await page.locator('.device-row', { hasText: 'GAMING-PC' }).waitFor();
    await shot(page, 'account-devices');
    // Pairing shows a one-time connection link and the download.
    await page.locator('.account-page [data-action="desktop"]').click();
    assert.match(await page.locator('#modal [data-copied]').first().getAttribute('data-copy'), /#odyle-pair=[A-Z2-9]{16}$/);
    assert.match(await page.locator('#modal .app-panel').innerText(), /Open the latest release/);
    await page.keyboard.press('Escape');
    await page.locator('[data-forget-device]').click();
    await page.locator('#modal [data-confirm-forget-device]').click();
    await toast(page).filter({ hasText: 'The PC was unpaired.' }).waitFor();
    assert.equal(await page.locator('.device-row').count(), 0);
    assert.equal((await request('/api/odyle/desktop-sign-in', { deviceKey: key })).status, 401);
    await page.locator('[data-action="sign-out-everywhere"]').click();
    await page.locator('#modal [data-action="confirm-sign-out-everywhere"]').click();
    await toast(page).filter({ hasText: 'Signed out everywhere else' }).waitFor();
    assert.equal((await request('/api/odyle/rooms', undefined, user, 'GET')).status, 401);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});
test('the account page renames, switches to Czech, exports data, deletes characters and the account', async () => {
  const user = await account('Account owner');
  await request('/api/odyle/character', { characterName: 'Doomed', server: 'Lumiel', region: 'GLOBAL_EU' }, user);
  const { page, errors, close } = await open(user, '#/account');
  try {
    await page.getByRole('heading', { name: 'Account & data.' }).waitFor();
    await page.locator('#profile-form [name=displayName]').fill('Renamed owner');
    await page.locator('#profile-form [type=submit]').click();
    await toast(page).filter({ hasText: 'Display name saved.' }).waitFor();
    const download = page.waitForEvent('download');
    await page.locator('[data-action="export"]').click();
    const file = await download; assert.match(file.suggestedFilename(), /^odyle-data-\d{4}-\d{2}-\d{2}\.json$/);
    await shot(page, 'account');
    await page.locator('#language-select').selectOption('cs');
    await page.getByRole('heading', { name: 'Účet a data.' }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'cs');
    await shot(page, 'account-cs');
    // Characters are deleted from My rooms & characters after confirming.
    await navigate(page, 'library');
    await page.locator('[data-delete-character]').click();
    await page.locator('#modal [data-confirm-delete-character]').click();
    await page.locator('.personal-characters .info-panel').waitFor();
    // Deleting the account needs the display name typed in.
    await page.goto(url + '/#/account'); await page.locator('[data-action="delete-account"]').waitFor();
    await page.locator('[data-action="delete-account"]').click();
    await page.locator('#delete-confirm').fill('wrong');
    await page.locator('[data-action="confirm-delete-account"]').click();
    assert.equal((await request('/api/odyle/tasks', undefined, user, 'GET')).status, 200);
    await page.locator('#delete-confirm').fill('Renamed owner');
    await page.locator('[data-action="confirm-delete-account"]').click();
    await page.locator('[data-action="discord"]').waitFor();
    assert.equal((await request('/api/odyle/tasks', undefined, user, 'GET')).status, 401);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('an unreachable server keeps the sign-in and the connection state follows it', async () => {
  const user = await account('Outage');
  // English whatever the machine's language, as the checks read English text.
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-GB' });
  await context.addInitScript(session => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('odyle.account', session); } }, JSON.stringify({ token: user.token, record: user.record }));
  const page = await context.newPage();
  try {
    // The server is down at load: the page says so, keeps the sign-in and opens once it answers.
    await page.route('**/api/**', route => route.abort());
    await page.goto(url + '/#/');
    await page.getByRole('heading', { name: 'The Odyle server is out of reach.' }).waitFor();
    await shot(page, 'unreachable');
    assert.ok(await page.evaluate(() => localStorage.getItem('odyle.account')));
    await page.unroute('**/api/**');
    await page.getByRole('heading', { name: 'Welcome, Outage.' }).waitFor({ timeout: 15000 });
    await page.locator('.topbar .connection.connected').waitFor();
    // Losing the server later flips the indicator without a reload. A server going away
    // ends the realtime stream too, which otherwise stands in for the health check.
    await page.route('**/api/**', route => route.abort());
    assert.equal((await request('/__test__/drop-realtime', {})).status, 200);
    await page.locator('.topbar .connection:not(.connected)').waitFor({ timeout: 30000 });
    await page.unroute('**/api/**');
    await page.locator('.topbar .connection.connected').waitFor({ timeout: 30000 });
  } finally { await context.close(); }
});
test('Discord sign-in offers this page in another browser when its window cannot work', async () => {
  // An app's built-in browser that opens no windows: a note before anything is clicked, then the link to copy.
  const embedded = await browser.newContext({ viewport: { width: Number(process.env.ODYLE_UI_WIDTH) || 1280, height: 900 }, locale: 'en-GB', userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A.240505.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 Instagram 312.0.0.32.112' });
  await embedded.addInitScript(() => { window.open = () => null; });
  try {
    const page = await embedded.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(url + '/#/join/ABCD-EFGH-2345');
    await page.locator('.in-app-note').waitFor();
    await shot(page, 'signin-in-app');
    await page.locator('[data-action="discord"]').click();
    // The invite link stays whole, so the invite still works in the other browser.
    assert.equal(await page.locator('#modal .link-field').inputValue(), url + '/#/join/ABCD-EFGH-2345');
    assert.equal(await page.locator('#modal [data-copied]').getAttribute('data-copy'), url + '/#/join/ABCD-EFGH-2345');
    assert.match(await page.locator('#modal').innerText(), /could not open here[\s\S]*keeps your invite/);
    await shot(page, 'signin-elsewhere');
    assert.deepEqual(errors, []);
  } finally { await embedded.close(); }
  // A desktop browser gets no note; once the Discord window is open, help waits under the button.
  const { page, errors, close } = await open(null, '#/');
  try {
    await page.locator('[data-action="discord"]').waitFor();
    assert.equal(await page.locator('.in-app-note').count(), 0); assert.equal(await page.locator('.signin-help').isVisible(), false);
    await page.evaluate(() => { window.open = () => ({ location: {}, close() {} }); });
    await page.locator('[data-action="discord"]').click();
    await page.locator('.signin-help').waitFor();
    // The test backend has no Discord sign-in configured, and the page says so.
    await toast(page).filter({ hasText: 'Discord sign-in needs backend configuration' }).waitFor();
    await page.locator('.signin-help [data-action="open-elsewhere"]').click();
    assert.equal(await page.locator('#modal .link-field').inputValue(), url + '/#/');
    assert.deepEqual(errors, []);
  } finally { await close(); }
});
test('Discord sign-in opens its window, signs in and joins the room of an invite link', async () => {
  // Stands in for Discord's token and user endpoints; PocketBase still exchanges the code and creates the account.
  const oauth = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/token' && req.method === 'POST') { req.resume(); res.end(JSON.stringify({ access_token: 'test-discord-access', token_type: 'Bearer', expires_in: 3600 })); }
    else if (req.url === '/user' && req.headers.authorization === 'Bearer test-discord-access') res.end(JSON.stringify({ id: '100000000000000077', username: 'window-tester', global_name: 'Window Tester', email: 'window@test.invalid', verified: true }));
    else { res.writeHead(401); res.end('{}'); }
  });
  await new Promise(r => oauth.listen(0, '127.0.0.1', r));
  assert.equal((await request('/__test__/oauth-provider', { url: 'http://127.0.0.1:' + oauth.address().port })).status, 200);
  const lead = await account('Window lead'), created = (await request('/api/odyle/create', { name: 'Window room' }, lead)).data;
  const { page, errors, close } = await open(null, '#/join/' + created.invites[0].code);
  try {
    // Discord's authorize page sends the window straight back with a code for the state it was given.
    await page.context().route('https://discord.com/**', route => { const asked = new URL(route.request().url()); return route.fulfill({ status: 302, headers: { location: asked.searchParams.get('redirect_uri') + '?code=test-code&state=' + asked.searchParams.get('state') } }); });
    await page.locator('.join-note').waitFor();
    const opened = page.waitForEvent('popup');
    await page.locator('[data-action="discord"]').click();
    await opened;
    // Signed in with the Discord name, the invite joins at once.
    await page.getByRole('heading', { name: 'Party overview.' }).waitFor();
    assert.match(page.url(), /#\/room\/[a-z0-9]+$/); assert.match(await page.locator('.topbar .breadcrumb').innerText(), /Window room/);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('odyle.account')).record.displayName), 'Window Tester');
    assert.deepEqual(errors, []);
  } finally { await close(); oauth.close(); }
});
test('the service worker opens the dashboard without a connection', async () => {
  const { page, errors, close } = await open(null, '#/');
  try {
    await page.locator('[data-action="discord"]').waitFor();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await page.context().setOffline(true);
    await page.reload(); await page.locator('[data-action="discord"]').waitFor();
    await page.context().setOffline(false);
    assert.deepEqual(errors.filter(e => !/ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(e)), []);
  } finally { await close(); }
});
test('room owners connect Discord reminders and a bad webhook says why in the form', async () => {
  const lead = await account('Discord lead'), roomId = (await request('/api/odyle/create', { name: 'Discord room' }, lead)).data.room.id;
  const { page, errors, close } = await open(lead, '#/room/' + roomId);
  try {
    await page.locator('[data-action="room-settings"]').click();
    await page.locator('#discord-form [name=webhook]').fill('https://example.com/not-discord');
    await page.locator('#discord-form [type=submit]').click();
    assert.match(await page.locator('#discord-form .form-error[role=alert]').innerText(), /Discord webhook URL/);
    await shot(page, 'room-discord');
    const before = discordPosts;
    await page.locator('#discord-form [name=webhook]').fill(discordUrl + '/api/webhooks/123456789012/' + 'b'.repeat(68));
    await page.locator('#discord-form [type=submit]').click();
    await toast(page).filter({ hasText: 'Discord reminders are on' }).waitFor();
    assert.equal(discordPosts, before + 1);
    await page.locator('#modal [data-action="discord-off"]').click();
    assert.match(await page.locator('#modal').innerText(), /Stop Discord reminders\?/);
    await page.locator('#modal [data-action="confirm-discord-off"]').click();
    await toast(page).filter({ hasText: 'Discord reminders are off.' }).waitFor();
    assert.match(await page.locator('#modal').innerText(), /Post each planned run/);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});
test('an expired sign-in returns to the welcome page', async () => {
  const user = await account('Expiring');
  const { page, close } = await open({ ...user, token: user.token.slice(0, -4) + 'AAAA' }, '#/tasks');
  try { await page.locator('[data-action="discord"]').waitFor(); assert.equal(await page.evaluate(() => localStorage.getItem('odyle.account')), null); } finally { await close(); }
});
// A PocketBase dashboard tab signed in as the test superuser.
async function superuser() {
  const password = 'ui-test-' + Date.now() + '-Password', operator = (await request('/__test__/superuser', { password })).data;
  const tab = await open(null, '_/#/login');
  await tab.page.locator('#login_identity').fill('operator@test.invalid'); await tab.page.locator('#login_pass').fill(password);
  await tab.page.locator('.auth-with-password-form button.next').click();
  await tab.page.locator('.page-header').first().waitFor();
  return { operator, ...tab };
}
test('superusers keep the dungeon catalog and the inactive account period on the Odyle settings page', async () => {
  const { operator, page, errors, close } = await superuser();
  try {
    await page.goto(url + '/_/#/odyle/settings');
    await page.locator('#odyle-inactive').fill('365');
    // Typed line by line, as a superuser would: Enter must not be swallowed by the list it saves.
    await page.locator('#odyle-dungeons').click(); await page.keyboard.type('Fire Temple\n fire temple \nUdas Temple\n');
    assert.match(await page.locator('#odyle-inactive').locator('xpath=../..').innerText(), /365 days/);
    // Before saving, the page counts the accounts the next clean-up would delete with that period.
    await page.locator('#odyle-inactive').locator('xpath=../..').getByText(/With this period the next run at 03:17 UTC \(.+ here\) would delete/).waitFor();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.getByText('Saved the Odyle game settings.').waitFor();
    await shot(page, 'admin-settings');
    const saved = (await request('/api/odyle/admin/settings', undefined, operator, 'GET')).data.settings;
    assert.deepEqual([saved.dungeons, saved.inactiveAccountDays], [['Fire Temple', 'Udas Temple'], 365]);
    // On a phone PocketBase's header scrolls sideways; the Odyle link must still be in sight.
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(url + '/_/#/collections'); await page.locator('.page-header').first().waitFor();
    const header = await page.locator('.app-main-nav').evaluate(nav => ({ fits: nav.scrollWidth <= nav.clientWidth, odyle: [...nav.querySelectorAll('.header-link')].some(a => a.textContent.trim() === 'Odyle' && a.getBoundingClientRect().right <= nav.getBoundingClientRect().right) }));
    assert.deepEqual(header, { fits: true, odyle: true }, 'every header link fits a phone');
    await page.locator('.app-header').getByRole('link', { name: 'Odyle', exact: true }).click();
    await page.getByText('Connected apps').waitFor();
    await shot(page, 'admin-phone-header');
    // A changed extension entry reaches browsers on their next load, not after 14 days.
    assert.equal((await fetch(url + '/_/extensions.js')).headers.get('cache-control'), 'no-cache');
    // A browser still holding an entry from before that drops its cache once, on its next visit.
    const visit = await fetch(url + '/_/'), again = await fetch(url + '/_/', { headers: { Cookie: 'odyle_entry=1' } });
    assert.equal(visit.headers.get('clear-site-data'), '"cache"'); assert.match(visit.headers.get('set-cookie'), /^odyle_entry=1; Path=\/_\/;/);
    assert.equal(again.headers.get('clear-site-data'), null);
    assert.deepEqual(errors.filter(e => !/extensions|favicon/.test(e)), []);
  } finally { await close(); await request('/api/odyle/admin/settings', { dungeons: [], inactiveAccountDays: 0 }, operator); }
});
test('superusers search, open and export packets and read the server status', async () => {
  const reader = await account('Status reader');
  const session = (await request('/api/odyle/session', { appVersion: '0.6.0.12' }, reader)).data;
  const reading = { sessionId: session.sessionId, sequence: 1, characterName: 'Statusa', server: 'Lumiel', region: 'GLOBAL_EU', value: 390, source: 'packet', parserVersion: 'test-fixture-v1', confirmed: true };
  assert.equal((await request('/api/odyle/report', reading, reader)).status, 200);
  assert.equal((await request('/api/odyle/report', reading, reader)).status, 400);
  assert.equal((await request('/api/odyle/rooms', undefined, reader, 'GET')).status, 200);
  const { page, errors, close } = await superuser();
  try {
    await page.goto(url + '/_/#/odyle');
    const rows = page.locator('.odyle-feed .odyle-packet');
    await rows.filter({ hasText: 'Status reader' }).first().waitFor();
    // The search narrows the list; a packet opens every field it keeps.
    await page.locator('#odyle-search').fill('outdated statusa');
    await page.getByText(/^1 of \d+ packets$/).waitFor();
    assert.match(await rows.first().innerText(), /report rejected[\s\S]*Outdated reading/);
    await rows.first().locator('.odyle-packet-text').click();
    const detail = rows.first().locator('.odyle-packet-detail');
    assert.match(await detail.innerText(), /parserVersion\s+test-fixture-v1/); assert.match(await detail.innerText(), /source\s+app/);
    await shot(page, 'admin-packet');
    // Its account narrows the list to that account; the export holds what is shown.
    await page.locator('#odyle-search').fill('');
    await detail.getByRole('button', { name: 'Only this account' }).click();
    await page.locator('.odyle-chip', { hasText: 'Status reader' }).waitFor();
    assert.ok(await rows.count() >= 3);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export' }).click()]);
    const exported = JSON.parse(await (await import('node:fs/promises')).readFile(await download.path(), 'utf8'));
    assert.equal(exported.filters.account, reader.record.id); assert.equal(exported.packets.length, await rows.count());
    assert.ok(exported.packets.every(p => p.user === reader.record.id)); assert.deepEqual(exported.packets.map(p => p.kind).slice(0, 3), ['session', 'report', 'report']);
    // Server status: the last hour per minute, routes and rejection reasons.
    await page.goto(url + '/_/#/odyle/status');
    await page.locator('.odyle-minute .odyle-bar').first().waitFor();
    assert.equal(await page.locator('.odyle-minute').count(), 60);
    await page.locator('.odyle-minute').last().hover();
    assert.match(await page.locator('.odyle-tip').innerText(), /Rejected[\s\S]*Windows app[\s\S]*Reads[\s\S]*requests?/);
    // The keyboard reads the minutes too.
    await page.locator('.odyle-chart').focus(); await page.keyboard.press('Home');
    assert.equal(await page.locator('.odyle-minute').first().evaluate(el => el.classList.contains('active')), true);
    const reasons = page.locator('tr', { hasText: 'Outdated reading.' });
    assert.match(await reasons.innerText(), /report/);
    assert.match(await page.locator('tr', { hasText: 'GET rooms' }).innerText(), /Read/);
    assert.match(await page.locator('tr', { hasText: '0.6.0.12' }).innerText(), /0\.6\.0\.12\s+[1-9]/);
    // The server's build and Go runtime, and a heap profile saved as a file.
    assert.match(await page.locator('.odyle-stat', { hasText: 'Goroutines' }).innerText(), /Goroutines\s+[1-9][\d,]*\s+\d+ realtime connections/);
    assert.match(await page.locator('.odyle-stat', { hasText: 'Version' }).innerText(), /Version\s+\S+/);
    const [heap] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Heap' }).click()]);
    assert.match(heap.suggestedFilename(), /^odyle-heap-.*\.pb\.gz$/);
    assert.deepEqual([...(await (await import('node:fs/promises')).readFile(await heap.path())).subarray(0, 2)], [0x1f, 0x8b]);
    // Activation totals and the backups.
    assert.match(await page.locator('.odyle-stat', { hasText: 'First reading' }).innerText(), /First reading\s+[1-9]/);
    assert.match(await page.locator('.odyle-stat', { hasText: 'Schedule' }).innerText(), /Daily 03:00 UTC\s+keeps the newest 7/);
    await shot(page, 'admin-status');
    // A route links to its packets, the rejected ones from a reason.
    await reasons.getByRole('link', { name: 'Show packets' }).click();
    await page.locator('.odyle-chip', { hasText: 'report' }).waitFor();
    assert.ok(await rows.count() >= 1);
    assert.ok((await rows.allInnerTexts()).every(text => /report rejected/.test(text)));
    assert.deepEqual(errors.filter(e => !/extensions|favicon/.test(e)), []);
  } finally { await close(); }
});
