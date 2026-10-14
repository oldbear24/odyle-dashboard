// Browser checks of the built dashboard (npm run build first) against a disposable
// PocketBase on port 18091. Accounts are issued by a test-only hook and put into the
// browser's localStorage as the SDK stores a Discord sign-in. Set ODYLE_UI_SHOTS to a
// directory to keep a screenshot of every checked page, and ODYLE_UI_WIDTH to check
// another viewport width (390 for a phone).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, cp, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
const url = 'http://127.0.0.1:18091';
let child, directory, browser;
const shots = process.env.ODYLE_UI_SHOTS;
async function request(path, body, auth, method = 'POST') {
  const res = await fetch(url + path, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth.token } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, data: await res.json() };
}
const account = async name => (await request('/__test__/account', { name })).data;
before(async () => {
  assert.ok(existsSync(resolve('dist/index.html')), 'Build the dashboard first: npm run build');
  directory = await mkdtemp(join(tmpdir(), 'odyle-ui-test-'));
  await cp(resolve('backend/pb_hooks'), join(directory, 'hooks'), { recursive: true });
  await cp(resolve('backend/pb_migrations'), join(directory, 'migrations'), { recursive: true });
  await writeFile(join(directory, 'hooks', 'lib', 'protocols.cjs'), "module.exports = { verifiedAdapters: ['test-fixture-v1'] };");
  // Test-only account issuance; production has no password or test sign-in.
  await writeFile(join(directory, 'hooks', 'fixtures.pb.js'), `routerAdd('POST','/__test__/account',(e)=>{const name=e.requestInfo().body.name; const user=new Record(e.app.findCollectionByNameOrId('users'));user.set('email',$security.randomString(20)+'@test.invalid');user.setPassword($security.randomString(48));user.set('displayName',name);e.app.save(user);return e.json(200,{token:user.newAuthToken(),record:user});});`);
  child = spawn(resolve('.runtime', process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase'), ['serve', '--http=127.0.0.1:18091', '--dir=' + join(directory, 'data'), '--hooksDir=' + join(directory, 'hooks'), '--migrationsDir=' + join(directory, 'migrations'), '--publicDir=' + resolve('dist'), '--automigrate=false'], { stdio: 'ignore', env: { ...process.env, PLAYNC_SEARCH_URL: 'http://127.0.0.1:9/search', ODYLE_WINDOWS_RELEASE_URL: 'http://127.0.0.1:9/releases' } });
  for (let i = 0; i < 50 && !(await fetch(url + '/api/health').then(r => r.ok, () => false)); i++) await delay(100);
  browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
  if (shots) await mkdir(shots, { recursive: true });
});
after(async () => { await browser?.close(); if (child && child.exitCode === null) { const closed = new Promise(r => child.once('exit', r)); child.kill(); await closed; } if (directory) await rm(directory, { recursive: true, force: true }); });
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

    // Room settings: rename, make the friend a viewer, then hand the room over.
    await page.reload(); await page.locator('[data-action="room-settings"]').click();
    await page.locator('#rename-form [name=name]').fill('Renamed UI room');
    await page.locator('#rename-form [type=submit]').click();
    await toast(page).filter({ hasText: 'Room renamed.' }).waitFor();
    await page.locator('#modal select[data-role]').selectOption('viewer');
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

test('rooms plan runs and members see each character history', async () => {
  const [lead, mate] = await Promise.all([account('Run lead'), account('Run mate')]);
  const roomId = (await request('/api/odyle/create', { name: 'Run room' }, lead)).data.room.id;
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
    await page.locator('#run-form [name=note]').fill('Bring potions');
    await page.locator('#run-form [type=submit]').click();
    await page.locator('.runs .wish-row').waitFor();
    assert.match(await page.locator('.runs .wish-row').innerText(), /Fire Temple[\s\S]*Bring potions[\s\S]*You/);
    assert.match(await page.locator('.runs [data-starts]').innerText(), /^in /);
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
  const other = await open(mate, '#/room/' + roomId);
  try { await other.page.locator('.join-note, .heading').first().waitFor(); assert.match(other.page.url(), /#\/$/); } finally { await other.close(); }
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

test('an expired sign-in returns to the welcome page', async () => {
  const user = await account('Expiring');
  const { page, close } = await open({ ...user, token: user.token.slice(0, -4) + 'AAAA' }, '#/tasks');
  try { await page.locator('[data-action="discord"]').waitFor(); assert.equal(await page.evaluate(() => localStorage.getItem('odyle.account')), null); } finally { await close(); }
});
