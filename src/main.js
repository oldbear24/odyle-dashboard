import PocketBase, { LocalAuthStore } from 'pocketbase';
import { status, age, escape as esc } from './model';
import { connectionLink } from './connection';
import './style.css';
import './accounts.css';

const backend = import.meta.env.VITE_POCKETBASE_URL || (import.meta.env.DEV ? 'http://127.0.0.1:8090' : window.location.origin);
const pb = new PocketBase(backend, new LocalAuthStore('odyle.account', window.sessionStorage));
pb.autoCancellation(false);
const app = document.querySelector('#app');
let room = null, members = [], rooms = [], characters = [], demo = false, online = false, invites = [];
let serverOffset = 0, lastPulse = 0, busy = false, subscription = null;
let timer;
const iconPaths = {
  diamond: '<path d="m12 2 8 10-8 10-8-10 8-10Z"/><path d="m4 12 8 4 8-4M12 2v20"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m0-16a3 3 0 0 1 0 6m3 3a5 5 0 0 1 3 4v3"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
  bolt: '<path d="m14 2-9 12h6l-1 8 9-12h-6l1-8Z"/>',
};
const icon = name => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.diamond}</svg>`;
const me = () => members.find(m => m.user === pb.authStore.record?.id);
const owner = () => demo || room?.owner === pb.authStore.record?.id;
const mine = () => me()?.characters || [];
const sharedCount = () => mine().filter(c => c.shared).length;
function shell(content, active = 'overview') {
  app.innerHTML = `<aside class="sidebar"><a href="#" class="brand" aria-label="Odyle home"><span class="brand-symbol">${icon('diamond')}</span><span>odyle<span class="brand-dot">.</span></span></a><div class="workspace-label">PARTY COMMAND</div><nav><button data-action="overview" class="nav-item ${active === 'overview' ? 'active' : ''}">${icon('grid')} Overview <span class="nav-marker"></span></button><button data-action="library" class="nav-item ${active === 'library' ? 'active' : ''}">${icon('people')} My rooms & characters</button><button data-action="invite" class="nav-item">${icon('plus')} Invitations</button><button data-action="help" class="nav-item">${icon('shield')} Reader & privacy</button></nav><div class="sidebar-bottom"><span class="game-mark">A<span>2</span></span><div>AION 2 <span>Global · Community tool</span></div></div></aside><div class="main"><header class="topbar"><span class="breadcrumb">Workspace <span>/</span> <strong>${esc(room?.name || (pb.authStore.isValid ? 'My account' : 'Welcome'))}</strong></span><div class="topbar-right"><span class="connection ${online || demo ? 'connected' : ''}"><i></i>${demo ? 'Demo workspace' : online ? 'Connected' : 'Not connected'}</span><button class="avatar" data-action="account" aria-label="Session details">${esc((pb.authStore.record?.displayName || 'O').slice(0, 1).toUpperCase())}</button></div></header>${content}<footer><span>${icon('shield')} Your characters, saved. Your party, private.</span><span>Odyle Party <span class="muted">/ 0.4 · Live packet readings</span></span></footer></div><div id="toast" role="status" aria-live="polite"></div><dialog id="modal"></dialog>`;
}
function welcome() {
  shell(`<main class="welcome"><div class="eyebrow"><span class="tiny-diamond"></span> BUILT FOR YOUR NEXT RUN</div><h1>Good runs start<br>with a ready party<span class="mint">.</span></h1><p class="intro">Sign in with Discord. Save the Odyle of every character.<br class="desktop-only"> Create a private room and bring your friends together.</p><div class="discord-card"><div class="setup-icon">${icon('people')}</div><h2>One account. Every adventure.</h2><p>Your rooms and character readings stay with your Discord account, even after you close the app.</p><button class="button discord-button" data-action="discord">Continue with Discord ${icon('arrow')}</button><small>First sign-in creates your account. No separate password.</small></div><button class="text-button" data-action="demo">Explore the demo workspace ${icon('arrow')}</button><p class="welcome-note">No game account needed. No public directory. Just your party.</p></main>`);
}
function libraryView() {
  shell(`<main class="dashboard"><section class="heading"><div><div class="eyebrow"><span class="tiny-diamond"></span> YOUR ADVENTURE, SAVED</div><h1>Welcome, ${esc(pb.authStore.record.displayName)}<span class="mint">.</span></h1><p>All your rooms and characters, connected to your Discord account.</p></div><button class="button secondary" data-action="desktop">Pair Windows app ${icon('arrow')}</button></section><section class="party-section"><div class="section-heading"><h2>Your rooms <span>${rooms.length}</span></h2></div><div class="room-list">${rooms.map(r => `<button class="room-item" data-room="${esc(r.id)}"><span class="setup-icon">${icon('diamond')}</span><span><strong>${esc(r.name)}</strong><small>${esc(r.role)} · ${r.cost} Odyle per cube</small></span>${icon('arrow')}</button>`).join('') || '<p class="intro">Create your first room, or join one with an invite.</p>'}</div></section><div class="welcome-grid"><form id="create-form" class="setup-card"><h2>Create a private room</h2><p>Keep your party together between sessions.</p><label>Room name<input name="name" maxlength="60" placeholder="The evening expedition" required></label><button class="button primary" type="submit">Create room ${icon('arrow')}</button></form><form id="join-form" class="setup-card"><h2>Join your friends</h2><p>Your membership stays with your account.</p><label>Invite code<input name="code" class="code-input" autocomplete="off" placeholder="XXXX XXXX XXXX" maxlength="20" required></label><button class="button secondary" type="submit">Join room ${icon('arrow')}</button></form></div><section class="party-section personal-characters"><div class="section-heading"><h2>Your saved characters <span>${characters.length}</span></h2><button class="button secondary" data-action="reading">${icon('plus')} Connect reader</button></div><div class="member-grid">${characters.map((c, i) => card({ ...c, sharing: true, role: 'reporter', displayName: pb.authStore.record.displayName, user: pb.authStore.record.id }, i)).join('') || '<div class="info-panel"><h3>Every character gets its own reading.</h3><p>Connect the Windows reader to read Odyle straight from the game. Values update live while the reader runs and stay saved when you leave a room or sign out.</p></div>'}</div></section></main>`, 'library');
}
function flattened() { return members.flatMap(m => m.characters?.length ? m.characters.map(c => ({ ...c, sharing: c.shared ?? m.sharing, user: m.user, membershipId: m.id, role: m.role, displayName: m.displayName })) : [{ ...m, id: '', characterName: '', confirmed: false, lastReadingAt: '', source: 'packet' }]); }
// Re-render only when the room data or a readiness state changed; otherwise just refresh the "ago" labels,
// so hover, focus and open menus survive the periodic refresh.
let rendered = '', renderedLibrary = '';
const stable = list => list.map(({ lastSeenAt, updated, characters, ...rest }) => ({ ...rest, characters: characters?.map(({ lastSeenAt: _seen, updated: _updated, ...c }) => c) }));
function signature() { const now = Date.now() + serverOffset; return JSON.stringify([room, stable(members), flattened().map(c => status(c, now))]); }
function updateAges() { const now = Date.now() + serverOffset; document.querySelectorAll('[data-age]').forEach(el => { el.textContent = age(el.dataset.age, now); }); }
function renderDashboard() { if (signature() === rendered) updateAges(); else dashboard(); }
function librarySignature() { const now = Date.now() + serverOffset; return JSON.stringify([stable([{ characters }]), characters.map(c => status({ ...c, sharing: true }, now))]); }
function dashboard() {
  rendered = signature();
  const now = Date.now() + serverOffset, party = flattened(), actual = party.filter(c => c.characterName);
  const live = actual.filter(c => status(c, now) === 'live'), ready = live.filter(c => c.value >= room.cost), total = live.reduce((sum, c) => sum + c.value, 0);
  shell(`<main class="dashboard"><section class="heading"><div><div class="eyebrow"><span class="tiny-diamond"></span> YOUR NEXT ADVENTURE</div><h1>Party overview<span class="mint">.</span></h1><p>${members.length} members · ${actual.length} saved characters · Every last confirmed value stays saved.</p></div><div class="heading-actions">${demo ? '<span class="demo-tag">Sample data</span>' : ''}<button class="button primary" data-action="invite">${icon('plus')} Invite a friend</button></div></section><section class="stats"><article><div class="stat-caption">CHARACTER READINESS ${icon('people')}</div><div class="stat-number">${ready.length}<span>/ ${actual.length}</span></div><div class="stat-detail"><span class="mint">Fresh characters ready for this cube</span></div><div class="mini-track"><i style="width:${actual.length ? ready.length / actual.length * 100 : 0}%"></i></div></article><article><div class="stat-caption">CONFIRMED ODYLE ${icon('bolt')}</div><div class="stat-number">${total.toLocaleString()}<span class="unit">fresh energy</span></div><div class="stat-detail">From ${live.length} current readings; old values stay on their cards</div></article><article><div class="stat-caption">REWARD CUBE COST ${icon('diamond')}</div><div class="stat-number">${room.cost}<span class="unit">per cube</span></div><div class="cost-options">${[20, 30, 40].map(cost => `<button data-cost="${cost}" ${owner() ? '' : 'disabled'} aria-pressed="${cost === room.cost}" class="${cost === room.cost ? 'selected' : ''}">${cost}</button>`).join('')}<button data-action="custom-cost" ${owner() ? '' : 'disabled'}>Custom</button></div></article></section>${!demo ? `<div class="sharing-bar"><span>${me()?.role === 'viewer' ? 'Viewers cannot share characters in this room.' : !mine().length ? 'Save a character with the Windows app to share it here.' : sharedCount() ? `${sharedCount()} of ${mine().length} of your characters ${sharedCount() === 1 ? 'is' : 'are'} shared here. Choose per character on its card.` : 'Your characters are private here. Share each one from its card.'}</span><button class="button secondary" data-action="toggle-sharing" ${me()?.role === 'viewer' || !mine().length ? 'disabled' : ''}>${sharedCount() === mine().length && mine().length ? 'Stop sharing all' : 'Share all'}</button></div>` : ''}<section class="party-section"><div class="section-heading"><h2>Party characters <span>${actual.length}</span></h2><span class="refresh-label"><i></i>${demo ? 'Illustrative readings' : 'Live room updates'}</span></div><div class="member-grid">${party.map((c, i) => card(c, i)).join('')}<button class="empty-card" data-action="invite"><span class="empty-plus">${icon('plus')}</span><strong>A spot for your next ally</strong><span>Invite another Discord account</span></button></div></section><section class="lower-grid"><article class="info-panel"><div class="info-heading"><span class="setup-icon">${icon('shield')}</span><div><h3>Your data. Your call.</h3><p>Account-owned characters. Room-scoped sharing.</p></div></div><p>All characters keep their last confirmed Odyle. You choose which characters each room sees. Older values remain visible with their timestamp, while readiness uses only fresh readings.</p><button class="text-button" data-action="library">My rooms & characters ${icon('arrow')}</button></article><article class="next-panel"><div class="eyebrow">BEFORE YOU HEAD OUT</div><h3>Check the character you’re taking.</h3><p>${ready.length} characters can currently claim a cube at ${room.cost} Odyle. A stale value remains stored but does not count as ready.</p><button class="button secondary" data-action="${demo ? 'help' : 'reading'}">${demo ? 'How readings work' : 'Connect packet reader'} ${icon('arrow')}</button></article></section></main>`);
}
function card(c, index) {
  const now = Date.now() + serverOffset, state = status(c, now), fresh = state === 'live', known = c.confirmed && c.lastReadingAt, cost = room?.cost || 40, ready = fresh && c.value >= cost;
  const labels = { live: 'Live', stale: 'Stale', unknown: 'No reading', offline: 'Offline' }, colors = ['jade', 'amber', 'blue', 'pink', 'violet'];
  return `<article class="member-card ${ready ? 'is-ready' : ''} ${state === 'offline' ? 'is-offline' : ''}"><div class="card-top"><span class="portrait ${colors[index % colors.length]}">${esc((c.characterName || c.displayName).slice(0, 2).toUpperCase())}<span class="portrait-rune">${icon('diamond')}</span></span><span class="status ${state}"><i></i>${labels[state]}</span></div><div class="member-name">${esc(c.characterName || c.displayName)} ${c.role === 'owner' ? '<span class="leader-label">LEADER</span>' : ''}</div><div class="member-server">${esc(c.displayName)} <span>·</span> ${esc(c.server || 'No shared characters')} ${esc((c.region || '').replace('GLOBAL_', ''))}</div><div class="energy"><strong>${known ? c.value.toLocaleString() : '—'}</strong><span>Odyle Energy</span></div><div class="energy-track"><i style="width:${known ? Math.min(100, c.value / (cost * 8) * 100) : 0}%"></i></div><div class="cube-line">${icon('diamond')}<span>${fresh ? `<strong>${Math.floor(c.value / cost)}</strong> reward cubes` : known ? 'Last saved value' : 'No confirmed reading'}</span><span class="readiness ${ready ? 'ready' : ''}">${ready ? 'Ready' : fresh ? 'Low energy' : '—'}</span></div><div class="card-footer"><span>${demo ? 'Sample' : c.source === 'packet' ? 'Packet' : c.source === 'manual' ? 'Legacy manual' : 'Waiting for game'} · ${known ? `changed <span data-age="${esc(c.lastReadingAt)}">${age(c.lastReadingAt, now)}</span>` : 'Not confirmed'}</span>${c.user === pb.authStore.record?.id && !demo && room && c.id ? `<button data-share="${esc(c.id)}" data-enabled="${!c.shared}" ${c.role === 'viewer' ? 'disabled' : ''}>${c.shared ? 'Stop sharing' : 'Share here'}</button>` : c.user === pb.authStore.record?.id && !demo ? `<button data-character="${esc(c.id || '')}" data-action="reading">Reader</button>` : owner() && c.membershipId && c.role !== 'owner' && !demo ? `<button data-remove="${esc(c.membershipId)}">Remove member</button>` : ''}</div></article>`;
}
function toast(message) { const el = document.querySelector('#toast'); if (!el) return; el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 5000); }
function modal(title, body) { const el = document.querySelector('#modal'); el.innerHTML = `<div class="modal-head"><h2>${title}</h2><button data-action="close-dialog" class="close-button" aria-label="Close dialog">×</button></div>${body}`; el.showModal(); }
function inviteDialog() {
  if (demo) return modal('Bring your party together', '<p>This workspace uses sample data. Sign in with Discord to create a persistent room.</p><button class="button discord-button" data-action="exit-demo">Sign in with Discord</button>');
  if (!room || !owner()) return toast('Open a room you own to invite friends.');
  modal('Invite another Discord account', `<p>Friends sign in with Discord and enter your room code. Codes expire after 30 minutes; membership remains until they leave or you remove them.</p>${invites.map(i => `<div class="invite-row"><div><span>${i.role === 'reporter' ? 'PLAYER INVITE' : 'VIEWER INVITE'}</span><strong>${esc(i.code.match(/.{1,4}/g).join(' '))}</strong><small>Expires ${new Date(i.expiresAt).toLocaleTimeString()}</small></div><button class="icon-button" data-copy="${esc(i.code)}" aria-label="Copy invite">${icon('copy')}</button></div>`).join('')}<button class="button primary" data-action="generate-invites">${invites.length ? 'Revoke codes & generate new invites' : 'Generate invite codes'}</button>`);
}
async function desktopDialog() {
  if (!pb.authStore.isValid || demo) return toast('Sign in with Discord to connect your reader.');
  const pair = await send('desktop-code'), link = connectionLink(backend, pair.code);
  modal('Connect your packet reader', `<p>Copy this link, then click <strong>Paste link & connect</strong> in the Windows app. Choose your character and start the packet reader.</p><button class="button primary" data-copy="${esc(link)}">${icon('copy')} Copy connection link</button><p>Expires in five minutes and works once. The app requires Npcap.</p><div class="info-panel"><h3>How it works</h3><p>Start the reader before you log into your character. It detects the character, reads the Odyle snapshot from the game and sends the value again only when it changes. Nothing is injected and no raw traffic leaves your PC.</p></div>`);
}
async function send(action, body = {}) {
  const data = await pb.send('/api/odyle/' + action, { method: 'POST', body });
  if (data.serverNow) serverOffset = Date.parse(data.serverNow) - Date.now(); return data;
}
async function refreshRoom() {
  const snapshot = await pb.send('/api/odyle/snapshot/' + room.id); room = snapshot.room; members = snapshot.members; serverOffset = Date.parse(snapshot.serverNow) - Date.now(); online = true;
  characters = me()?.characters || characters;
  if (!document.querySelector('#modal')?.open) renderDashboard();
}
async function library() {
  if (!pb.authStore.isValid) { demo = false; room = null; welcome(); return; }
  if (subscription) { await subscription(); subscription = null; }
  room = null; members = []; demo = false; invites = [];
  const [list, mine] = await Promise.all([pb.send('/api/odyle/rooms'), pb.collection('characters').getFullList({ sort: 'created' })]); rooms = list.rooms; characters = mine; online = true; libraryView(); renderedLibrary = librarySignature();
}
async function openRoom(id) {
  if (subscription) { await subscription(); subscription = null; }
  room = { id }; demo = false; invites = []; rendered = ''; await refreshRoom();
  subscription = await pb.realtime.subscribe('odyle.room.' + id, async () => {
    try { await refreshRoom(); } catch (error) { if ([403, 404].includes(error.status)) { await library(); toast('Your access to this room ended. Your characters are still saved.'); } else online = false; }
  });
}

async function authenticated() {
  await pb.collection('users').authRefresh(); await library();
  clearInterval(timer); lastPulse = Date.now();
  timer = setInterval(async () => {
    if (busy || demo) return;
    try {
      if (Date.now() - lastPulse >= 20000) {
        await send('heartbeat'); lastPulse = Date.now(); online = true;
        if (!room) characters = await pb.collection('characters').getFullList({ sort: 'created' });
      }
      if (room) await refreshRoom();
      else if (!document.querySelector('#modal')?.open) {
        const grid = document.querySelector('.personal-characters .member-grid'), key = librarySignature();
        if (grid && characters.length && key !== renderedLibrary) {
          renderedLibrary = key;
          grid.innerHTML = characters.map((c, i) => card({ ...c, sharing: true, role: 'reporter', displayName: pb.authStore.record.displayName, user: pb.authStore.record.id }, i)).join('');
          document.querySelector('.personal-characters h2 span').textContent = characters.length;
        } else updateAges();
      }
    } catch { online = false; }
  }, 5000);
}
async function discordLogin() {
  let auth;
  // The SDK opens its popup immediately; keep this call within the click gesture.
  try { auth = await pb.collection('users').authWithOAuth2({ provider: 'discord', createData: { displayName: 'Adventurer' } }); }
  catch (error) {
    const methods = await pb.collection('users').listAuthMethods();
    if (!methods.oauth2?.providers?.some(p => p.name === 'discord')) return toast('Discord sign-in needs backend configuration. See docs/discord-setup.md.');
    throw error;
  }
  if (auth.record.displayName === 'Adventurer' && auth.meta?.name) await pb.collection('users').update(auth.record.id, { displayName: String(auth.meta.name).slice(0, 40) });
  await authenticated();
}
async function logout() {
  if (subscription) await subscription(); subscription = null; clearInterval(timer); pb.authStore.clear(); room = null; members = []; rooms = []; characters = []; online = false; demo = false; welcome();
}
function demoSession() {
  demo = true; room = { id: 'demo', owner: 'demo', name: 'The evening expedition', cost: 40 }; const now = Date.now();
  members = [{ id: 'd1', user: 'dave', displayName: 'DaveCZ', role: 'owner', sharing: true, characters: [
    { id: 'c1', characterName: 'DaveCZ', server: 'Atreia', region: 'GLOBAL_EU', source: 'packet', value: 265, confirmed: true, valid: true, lastSeenAt: new Date(now).toISOString(), lastReadingAt: new Date(now - 3000).toISOString() },
    { id: 'c2', characterName: 'DaveAlt', server: 'Atreia', region: 'GLOBAL_EU', source: 'packet', value: 80, confirmed: true, valid: false, lastSeenAt: new Date(now).toISOString(), lastReadingAt: new Date(now - 120000).toISOString() },
  ] }, { id: 'd2', user: 'lumina', displayName: 'Lumina', role: 'reporter', sharing: true, characters: [{ id: 'c3', characterName: 'Lumina', server: 'Atreia', region: 'GLOBAL_EU', source: 'packet', value: 180, confirmed: true, valid: true, lastSeenAt: new Date(now).toISOString(), lastReadingAt: new Date(now - 9000).toISOString() }] },
  { id: 'd3', user: 'kaelen', displayName: 'Kaelen', role: 'reporter', sharing: true, characters: [{ id: 'c4', characterName: 'Kaelen', server: 'Atreia', region: 'GLOBAL_EU', source: 'packet', value: 35, confirmed: true, valid: true, lastSeenAt: new Date(now).toISOString(), lastReadingAt: new Date(now - 12000).toISOString() }] },
  { id: 'd4', user: 'nyx', displayName: 'Nyx', role: 'reporter', sharing: false, characters: [] }]; dashboard();
}
app.addEventListener('submit', async e => {
  e.preventDefault(); if (busy) return; busy = true;
  const form = e.target, data = Object.fromEntries(new FormData(form)), button = form.querySelector('[type="submit"]'); button.disabled = true;
  try {
    if (form.id === 'create-form') { const result = await send('create', { name: data.name, cost: 40 }); await openRoom(result.room.id); invites = result.invites; inviteDialog(); }
    else if (form.id === 'join-form') { const result = await send('join', { code: data.code }); await openRoom(result.room.id); }
    else if (form.id === 'cost-form') { document.querySelector('#modal').close(); await setCost(Number(data.cost)); }
  } catch (error) { toast(error.message); }
  finally { busy = false; if (button.isConnected) button.disabled = false; }
});
async function setCost(cost) { if (demo) { room.cost = cost; dashboard(); } else { await send('settings', { roomId: room.id, cost }); await refreshRoom(); } }
app.addEventListener('click', async e => {
  const el = e.target.closest('button, .brand'); if (!el) return;
  try {
    if (el.matches('.brand')) return await library();
    if (el.dataset.room) return await openRoom(el.dataset.room);
    if (el.dataset.cost) return await setCost(Number(el.dataset.cost));
    if (el.dataset.copy) { await navigator.clipboard.writeText(el.dataset.copy); return toast('Code copied.'); }
    if (el.dataset.remove) return modal('Remove member?', `<p>Their saved characters stay on their account. This removes their access to this room.</p><button class="button danger" data-confirm-remove="${esc(el.dataset.remove)}">Remove member</button>`);
    if (el.dataset.share) { await send('sharing', { roomId: room.id, characterId: el.dataset.share, enabled: el.dataset.enabled === 'true' }); return await refreshRoom(); }
    if (el.dataset.confirmRemove) { await send('revoke', { roomId: room.id, memberId: el.dataset.confirmRemove }); document.querySelector('#modal').close(); return await refreshRoom(); }
    switch (el.dataset.action) {
      case 'discord': await discordLogin(); break;
      case 'overview': room ? dashboard() : pb.authStore.isValid ? await library() : welcome(); break;
      case 'library': if (demo) { demo = false; room = null; welcome(); } else await library(); break;
      case 'demo': demoSession(); break;
      case 'exit-demo': demo = false; room = null; welcome(); break;
      case 'close-dialog': document.querySelector('#modal').close(); break;
      case 'invite': inviteDialog(); break;
      case 'reading': await desktopDialog(); break;
      case 'toggle-sharing': await send('sharing', { roomId: room.id, enabled: sharedCount() < mine().length }); await refreshRoom(); break;
      case 'generate-invites': invites = (await send('invites', { roomId: room.id })).invites; inviteDialog(); break;
      case 'custom-cost': modal('Reward cube cost', `<form id="cost-form"><label>Odyle per cube<input name="cost" type="number" min="1" max="1000" value="${room.cost}" required></label><button class="button primary" type="submit">Save cost</button></form>`); break;
      case 'desktop': await desktopDialog(); break;
      case 'help': modal('Saved characters, fresh readings', '<p>Sign in with Discord to create your account. Rooms and all character readings persist across sign-outs and room changes.</p><p>Each character is shared per room. Friends only see the characters you linked to that room. A viewer invite grants read-only room access.</p><p>The Windows app pairs with a one-time code. It reads game packets locally. Raw game traffic stays on your PC. Only normalized readings from a validated adapter may be shared.</p><p>The Windows app sends Odyle when it first reads it and whenever it changes. A reading counts as live while the app reports the game connection; 45 seconds without that it turns stale and stays saved as history. Readings are decoded from the Global game stream by the reference adapter; manual entry is disabled.</p>'); break;
      case 'account': if (!pb.authStore.isValid || demo) { demo = false; room = null; welcome(); } else modal('Your Discord account', `<p>${esc(pb.authStore.record.displayName)} · Rooms and characters remain saved after sign-out.</p><button class="button secondary" data-action="library">My rooms & characters</button><button class="button secondary" data-action="desktop">Pair Windows app</button>${room ? `<button class="button danger" data-action="leave-room">${owner() ? 'Close this room' : 'Leave this room'}</button>` : ''}<button class="text-button" data-action="logout">Sign out of this browser</button>`); break;
      case 'leave-room': await send(owner() ? 'close' : 'leave', { roomId: room.id }); await library(); toast('Your saved characters are retained.'); break;
      case 'logout': await logout(); break;
    }
  } catch (error) { toast(error.message); }
});
welcome();
if (pb.authStore.isValid) authenticated().catch(() => logout());
