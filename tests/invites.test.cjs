const { test } = require('node:test');
const assert = require('node:assert/strict');
const memory = () => { const data = {}; return { getItem: key => data[key] ?? null, setItem: (key, value) => { data[key] = String(value); } }; };
const now = Date.parse('2026-10-16T12:00:00Z');
const link = (id, role, expiresAt, extra = {}) => ({ id, role, label: '', expiresAt, maxUses: 0, uses: 0, created: '2026-10-16 11:00:00.000Z', ...extra });
test('the owner\'s list shows a link\'s code only where this browser made it, and forgets codes of links gone', async () => {
  const { withCodes, rememberInvites, rememberInvite, forgetInvite, savedInvites } = await import('../src/invites.js');
  const storage = memory();
  // A code from before links had ids is matched by its role and expiry.
  rememberInvites(storage, 'room1', [{ code: 'OLDPLAYER234', role: 'reporter', expiresAt: '2026-10-16 12:30:00.000Z' }], now);
  rememberInvite(storage, 'room1', { id: 'v1', code: 'VIEWERCODE23', role: 'viewer', expiresAt: '2026-10-17 12:00:00.000Z', label: 'dropped' }, now);
  rememberInvite(storage, 'room1', { id: 'gone', code: 'REVOKEDCODE2', role: 'reporter', expiresAt: '2026-10-17 12:00:00.000Z' }, now);
  const listed = [link('p0', 'reporter', '2026-10-16 12:30:00.000Z'), link('elsewhere', 'reporter', '2026-10-18 12:00:00.000Z'), link('v1', 'viewer', '2026-10-17 12:00:00.000Z')];
  assert.deepEqual(withCodes(storage, 'room1', listed, now).map(r => [r.id, r.code]), [['p0', 'OLDPLAYER234'], ['elsewhere', ''], ['v1', 'VIEWERCODE23']]);
  // The revoked link's code is forgotten; the others stay for the next time.
  assert.deepEqual(savedInvites(storage, 'room1', now).map(s => s.code).sort(), ['OLDPLAYER234', 'VIEWERCODE23']);
  forgetInvite(storage, 'room1', 'v1', now); assert.deepEqual(savedInvites(storage, 'room1', now).map(s => s.code), ['OLDPLAYER234']);
  // Codes expire with their link.
  assert.deepEqual(savedInvites(storage, 'room1', Date.parse('2026-10-16T12:31:00Z')), []);
  assert.deepEqual(withCodes({ getItem: () => '{not json', setItem() { throw new Error('blocked'); } }, 'room1', listed, now).map(r => r.code), ['', '', '']);
});
test('without site data the page keeps the codes it made, and a listing asked for earlier never forgets a newer one', async () => {
  const { withCodes, rememberInvites, rememberInvite, savedInvites } = await import('../src/invites.js');
  // Storage that keeps nothing (main.js stands it in when localStorage is blocked).
  const blocked = { getItem: () => null, setItem() {}, removeItem() {} };
  const made = [link('p1', 'reporter', '2026-10-17 12:00:00.000Z', { code: 'PLAYERCODE23' }), link('v1', 'viewer', '2026-10-17 12:00:00.000Z', { code: 'VIEWERCODE23' })];
  rememberInvites(blocked, 'room1', made, now);
  assert.deepEqual(withCodes(blocked, 'room1', made, now).map(r => r.code), ['PLAYERCODE23', 'VIEWERCODE23']);
  rememberInvite(blocked, 'room1', { id: 'n1', code: 'NEWLINKCODE2', role: 'reporter', expiresAt: '2026-10-17 12:00:00.000Z' }, now);
  const listing = [...made.map(l => ({ ...l, code: undefined })), link('n1', 'reporter', '2026-10-17 12:00:00.000Z')];
  assert.deepEqual(withCodes(blocked, 'room1', listing, now).map(r => r.code), ['PLAYERCODE23', 'VIEWERCODE23', 'NEWLINKCODE2']);
  assert.deepEqual(withCodes(memory(), 'room1', listing, now).map(r => r.code), ['', '', ''], 'another storage has its own codes');
  // A listing asked for before a link was made does not list it: its code stays for the next one.
  const storage = memory(), askedAt = Date.now();
  rememberInvite(storage, 'room2', { id: 'late', code: 'LATELINKCODE', role: 'viewer', expiresAt: '2026-10-17 12:00:00.000Z' }, now);
  assert.deepEqual(withCodes(storage, 'room2', [], now, askedAt), []);
  assert.deepEqual(withCodes(storage, 'room2', [link('late', 'viewer', '2026-10-17 12:00:00.000Z')], now).map(r => r.code), ['LATELINKCODE']);
  // A listing asked for after it was made, without it, means the link closed.
  assert.deepEqual(withCodes(storage, 'room2', [], now, Date.now() + 1), []); assert.deepEqual(savedInvites(storage, 'room2', now), []);
});
test('the invite dialog lists open links with what is left of them and makes new ones', async () => {
  const { inviteList, inviteDialogBody, expiresLabel, usesLabel } = await import('../src/invites.js');
  const page = 'https://odyle.example/#/room/abc';
  const rows = [link('p1', 'reporter', '2026-10-23 12:00:00.000Z', { code: 'ABCDEFGH2345', label: 'Discord <raids>', maxUses: 5, uses: 2 }), link('v1', 'viewer', '2026-10-17 12:00:00.000Z', { code: '' })];
  const html = inviteList(rows, page, now);
  assert.match(html, /data-invite="p1"[\s\S]*PLAYER INVITE · Discord &lt;raids&gt;[\s\S]*<strong>ABCD EFGH 2345<\/strong>[\s\S]*3 uses left/);
  assert.match(html, /data-copy="https:\/\/odyle.example\/#\/join\/ABCDEFGH2345"/); assert.match(html, /data-revoke-invite="p1"/);
  // A link made in another browser: its details and Revoke, nothing to copy.
  const other = html.slice(html.indexOf('data-invite="v1"'));
  assert.match(other, /VIEWER INVITE[\s\S]*shows only in the browser that made it[\s\S]*No use limit[\s\S]*data-revoke-invite="v1"/); assert.doesNotMatch(other, /data-copy/);
  assert.match(inviteList(null, page, now), /Loading invite links/); assert.match(inviteList([], page, now), /No open invite links/);
  assert.equal(usesLabel({ maxUses: 1, uses: 1 }), '0 uses left'); assert.equal(usesLabel({ maxUses: 1, uses: 0 }), '1 use left');
  // Today only the time; a later day its date too.
  assert.doesNotMatch(expiresLabel('2026-10-16 12:30:00.000Z', now), /Oct/); assert.match(expiresLabel('2026-10-23 12:00:00.000Z', now), /Oct/);
  // A new link joins as a player for 24 hours, for anyone with it, unless chosen otherwise.
  const body = inviteDialogBody(rows, page, now);
  assert.match(body, /id="invite-form"/); assert.match(body, /<option value="reporter" selected>Player/); assert.match(body, /<option value="86400" selected>24 hours/);
  assert.match(body, /<option value="0" selected>Anyone with the link[\s\S]*value="1">One person[\s\S]*value="25">25 people/); assert.match(body, /name="label" maxlength="40"/);
});
test('an invite link opens on what it invites to, or says why it no longer works', async () => {
  const { inviteLanding, joinedMessage } = await import('../src/invites.js'), { useLanguage } = await import('../src/i18n.js');
  const valid = { state: 'valid', room: 'The <evening> expedition', inviter: 'Lumina', role: 'reporter', members: 4 };
  assert.match(inviteLanding(valid), /Lumina invited you to <em>The &lt;evening&gt; expedition<\/em>[\s\S]*as a player · 4 members[\s\S]*Sign in with Discord/);
  assert.doesNotMatch(inviteLanding(valid, true), /Sign in/);
  assert.match(inviteLanding({ ...valid, role: 'viewer', members: 1, inviter: '' }), /A friend invited you[\s\S]*as a viewer: you watch the party[\s\S]*1 member/);
  assert.match(inviteLanding({ state: 'expired', room: 'Old <room>' }), /class="join-note invite-landing problem"[\s\S]*This invite to Old &lt;room&gt; expired or was used up/);
  assert.match(inviteLanding({ state: 'unknown' }), /does not work/);
  assert.match(inviteLanding(null), /class="join-note invite-landing"[\s\S]*Sign in with Discord and you join it right away/);
  assert.doesNotMatch(inviteLanding(null, true), /Sign in/);
  const room = { name: 'Raid' };
  assert.equal(joinedMessage({ room, membership: { role: 'reporter' } }), 'You joined Raid as a player.');
  assert.match(joinedMessage({ room, membership: { role: 'viewer' } }), /^You joined Raid as a viewer/);
  assert.equal(joinedMessage({ room, membership: { role: 'reporter' }, alreadyMember: true }), 'You are already in Raid.');
  try {
    await useLanguage('cs');
    assert.match(inviteLanding(valid), /Lumina tě zve do místnosti <em>The &lt;evening&gt; expedition<\/em>[\s\S]*jako hráč · 4 členové/);
    assert.equal(joinedMessage({ room, membership: { role: 'reporter' } }), 'Připojil(a) ses do místnosti Raid jako hráč.');
  } finally { await useLanguage('en'); }
});
