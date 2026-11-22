import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageOf, pageTitle, pageNav, link, address } from '../../src/routes.js';
import { findPath, profilePath } from '../../src/armorylinks.js';
import { useLanguage } from '../../src/i18n.js';

const profile = profilePath({ region: 'eu', serverId: 2304, characterId: 'kdPX-_ocYSqMloiCy7IXZ0CDm' });

test('pageOf names the pages the dashboard has and nothing else', () => {
  for (const path of ['/', '/room/abc123', '/join/ABCD-EFGH-2345', '/demo', '/tasks', '/account', '/changelog', '/privacy', '/slots', '/timers', '/achievements', '/week', '/armory', '/armory/top', profile, profile + '/card', findPath('GLOBAL_EU', 'Lumiel', 'Ka')]) assert.equal(pageOf(path), path, path);
  for (const path of ['', '/rooms', '/room/', '/room/a-b', '/room/' + 'a'.repeat(41), '/join/abc', '/tasks/', '/TASKS', '/armory/', '/x', 'tasks', '/account?x=1', '/demo#x']) assert.equal(pageOf(path), '', path);
});

test('pageTitle gives each page the title the backend gives it', async () => {
  assert.equal(pageTitle('/'), 'Odyle — Party command');
  assert.equal(pageTitle('/room/abc'), 'Odyle — Party command');
  assert.equal(pageTitle('/timers'), 'AION 2 timers: daily and weekly reset, Odyle regeneration · Odyle');
  assert.equal(pageTitle('/week'), 'Your week in Odyle');
  assert.equal(pageTitle('/armory'), 'AION 2 armory: look up any Global character · Odyle');
  assert.equal(pageTitle('/armory/top/Chanter'), 'Strongest Chanter characters of AION 2 Global · Odyle Armory');
  // A profile names itself once it is fetched: until then it keeps the title shown.
  assert.equal(pageTitle(profile, 'Kept'), 'Kept');
  assert.equal(pageTitle(profile + '/card', 'Kept'), 'Kept');
  try {
    await useLanguage('cs');
    assert.notEqual(pageTitle('/privacy'), 'Privacy · Odyle');
  } finally { await useLanguage('en'); }
});

test('pageNav lights up the page a loading page belongs to', () => {
  assert.equal(pageNav('/room/abc'), 'overview');
  assert.equal(pageNav('/armory'), 'armory');
  assert.equal(pageNav(profile), 'armory');
  assert.deepEqual(['/', '/tasks', '/week', '/achievements', '/timers', '/account'].map(pageNav), ['library', 'tasks', 'week', 'achievements', 'timers', 'account']);
  for (const path of ['/demo', '/changelog', '/privacy', '/slots', '/join/ABCD-EFGH']) assert.equal(pageNav(path), '', path);
});

test('without a page that says so, pages keep hash routes', () => {
  assert.equal(link('/tasks'), '#/tasks');
  assert.equal(address('/room/abc'), '#/room/abc');
});
