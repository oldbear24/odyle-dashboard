import PocketBase, { LocalAuthStore } from 'pocketbase';
import { status, age, escape as esc } from './model';
import './style.css';

const backend = import.meta.env.VITE_POCKETBASE_URL || (import.meta.env.DEV ? 'http://127.0.0.1:8090' : window.location.origin);
const pb = new PocketBase(backend, new LocalAuthStore('odyle.session', window.sessionStorage));
pb.autoCancellation(false);
const app = document.querySelector('#app');
let room = null, members = [], demo = false, online = false, invites = [], sessionId = '', sequence = 0, serverOffset = 0;
let timer, unsubscribe = [], busy = false, lastPulse = 0;
const paths = {
  diamond: '<path d="m12 2 8 10-8 10-8-10 8-10Z"/><path d="m4 12 8 4 8-4M12 2v20"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m0-16a3 3 0 0 1 0 6m3 3a5 5 0 0 1 3 4v3"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bolt: '<path d="m14 2-9 12h6l-1 8 9-12h-6l1-8Z"/>',
};
const icon = name => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.diamond}</svg>`;
function shell(content, active = 'overview') {
  app.innerHTML = `<aside class="sidebar"><a href="#" class="brand" aria-label="Odyle home"><span class="brand-symbol">${icon('diamond')}</span><span>odyle<span class="brand-dot">.</span></span></a><div class="workspace-label">PARTY COMMAND</div><nav><button data-action="overview" class="nav-item ${active === 'overview' ? 'active' : ''}">${icon('grid')} Overview <span class="nav-marker"></span></button><button data-action="invite" class="nav-item">${icon('people')} Invitations</button><button data-action="help" class="nav-item">${icon('shield')} Reader & privacy</button></nav><div class="sidebar-bottom"><span class="game-mark">A<span>2</span></span><div>AION 2 <span>Global · Community tool</span></div></div></aside><div class="main"><header class="topbar"><span class="breadcrumb">Workspace <span>/</span> <strong>${room ? esc(room.name) : 'Welcome'}</strong></span><div class="topbar-right"><span class="connection ${online || demo ? 'connected' : ''}"><i></i>${demo ? 'Demo workspace' : online ? 'Connected' : 'Not connected'}</span><button class="avatar" data-action="account" aria-label="Session details">${esc((pb.authStore.record?.displayName || 'O').slice(0, 1).toUpperCase())}</button></div></header>${content}<footer><span>${icon('shield')} Only what your party chooses to share.</span><span>Odyle Party <span class="muted">/ MVP 0.1</span></span></footer></div><div id="toast" role="status" aria-live="polite"></div><dialog id="modal"></dialog>`;
}
function welcome() {
  shell(`<main class="welcome"><div class="eyebrow"><span class="tiny-diamond"></span> BUILT FOR YOUR NEXT RUN</div><h1>Good runs start<br>with a ready party<span class="mint">.</span></h1><p class="intro">Your party’s Odyle, in one place. Create a private room,<br class="desktop-only"> bring your friends, and see who’s ready for the next cube.</p><div class="welcome-grid"><form id="create-form" class="setup-card"><div class="setup-icon">${icon('diamond')}</div><h2>Lead the party</h2><p>A private workspace for your next adventure.</p><label>Room name<input name="name" value="The evening expedition" maxlength="60" required></label><label>Your display name<input name="displayName" placeholder="e.g. DaveCZ" maxlength="40" required></label><button class="button primary" type="submit">Create private room ${icon('arrow')}</button></form><form id="join-form" class="setup-card"><div class="setup-icon">${icon('people')}</div><h2>Join your friends</h2><p>Enter the code shared by your party leader.</p><label>Invite code<input name="code" class="code-input" placeholder="XXXX XXXX XXXX" autocomplete="off" maxlength="20" required></label><label>Your display name<input name="displayName" placeholder="How should we call you?" maxlength="40" required></label><button class="button secondary" type="submit">Join room ${icon('arrow')}</button></form></div><button class="text-button" data-action="demo">Explore the demo workspace ${icon('arrow')}</button><p class="welcome-note">No game account needed. No public directory. Just your party.</p></main>`);
}
function dashboard() {
  const now = Date.now() + serverOffset;
  const party = members.filter(m => m.role !== 'viewer');
  const live = party.filter(m => status(m, now) === 'live');
  const ready = live.filter(m => m.value >= room.cost);
  const total = live.reduce((sum, m) => sum + m.value, 0);
  const owner = demo || pb.authStore.record?.role === 'owner';
  shell(`<main class="dashboard"><section class="heading"><div><div class="eyebrow"><span class="tiny-diamond"></span> YOUR NEXT ADVENTURE</div><h1>Party overview<span class="mint">.</span></h1><p>Check your energy. Rally your party. Make every run count.</p></div><div class="heading-actions">${demo ? '<span class="demo-tag">Sample data</span>' : ''}<button class="button primary" data-action="invite">${icon('plus')} Invite a friend</button></div></section>
    <section class="stats" aria-label="Party summary"><article><div class="stat-caption">PARTY READINESS ${icon('people')}</div><div class="stat-number">${ready.length}<span>/ ${party.length}</span></div><div class="stat-detail"><span class="mint">${ready.length === party.length && party.length ? 'All set for the next run' : 'Ready for the selected cube'}</span></div><div class="mini-track"><i style="width:${party.length ? ready.length / party.length * 100 : 0}%"></i></div></article><article><div class="stat-caption">CONFIRMED ODYLE ${icon('bolt')}</div><div class="stat-number">${total.toLocaleString()}<span class="unit">energy</span></div><div class="stat-detail">From ${live.length} fresh, confirmed reading${live.length === 1 ? '' : 's'}</div></article><article><div class="stat-caption">REWARD CUBE COST ${icon('diamond')}</div><div class="stat-number">${room.cost}<span class="unit">per cube</span></div><div class="cost-options" aria-label="Select cube cost">${[20, 30, 40].map(cost => `<button data-cost="${cost}" ${owner ? '' : 'disabled'} aria-pressed="${cost === room.cost}" class="${cost === room.cost ? 'selected' : ''}">${cost}</button>`).join('')}<button data-action="custom-cost" ${owner ? '' : 'disabled'}>Custom</button></div></article></section>
    <section class="party-section"><div class="section-heading"><h2>Your party <span>${party.length}</span></h2><span class="refresh-label"><i></i>${demo ? 'Illustrative readings' : 'Live room updates'}</span></div><div class="member-grid">${party.map((m, i) => card(m, i, now, owner)).join('')}<button class="empty-card" data-action="invite"><span class="empty-plus">${icon('plus')}</span><strong>A spot for your next ally</strong><span>Share an invite to grow your party</span></button></div></section>
    <section class="lower-grid"><article class="info-panel"><div class="info-heading"><span class="setup-icon">${icon('shield')}</span><div><h3>Your data. Your call.</h3><p>Private by design, shared by choice.</p></div></div><p>Each player shares their own Odyle. Readings become stale after 45 seconds and never count toward readiness until confirmed again.</p><button class="text-button" data-action="help">About the Windows reader ${icon('arrow')}</button></article><article class="next-panel"><div class="eyebrow">BEFORE YOU HEAD OUT</div><h3>${ready.length === party.length && party.length ? 'Your party is good to go.' : 'A little preparation goes a long way.'}</h3><p>${ready.length} of ${party.length} members can claim a cube at ${room.cost} Odyle. ${demo ? 'Try a different cube cost to explore.' : 'Reconfirm your reading before your next run.'}</p>${pb.authStore.record?.role !== 'viewer' && !demo ? '<button class="button secondary" data-action="reading">Update my Odyle ' + icon('arrow') + '</button>' : '<button class="button secondary" data-action="help">How readings work ' + icon('arrow') + '</button>'}</article></section></main>`);
}
function card(m, index, now, owner) {
  const state = status(m, now), fresh = state === 'live', known = m.confirmed && m.lastReadingAt;
  const ready = fresh && m.value >= room.cost;
  const labels = { live: 'Live', stale: 'Stale', unknown: 'No reading', offline: 'Offline' };
  const colors = ['jade', 'amber', 'blue', 'pink', 'violet'];
  return `<article class="member-card ${ready ? 'is-ready' : ''} ${state === 'offline' ? 'is-offline' : ''}"><div class="card-top"><span class="portrait ${colors[index % colors.length]}">${esc((m.characterName || m.displayName).slice(0, 2).toUpperCase())}<span class="portrait-rune">${icon('diamond')}</span></span><span class="status ${state}"><i></i>${labels[state]}</span></div><div class="member-name">${esc(m.characterName || m.displayName)} ${m.role === 'owner' ? '<span class="leader-label">LEADER</span>' : ''}</div><div class="member-server">${esc(m.server || 'Character not selected')} <span>·</span> ${esc((m.region || 'GLOBAL').replace('GLOBAL_', ''))}</div><div class="energy"><strong>${known ? m.value.toLocaleString() : '—'}</strong><span>Odyle Energy</span></div><div class="energy-track"><i style="width:${known ? Math.min(100, m.value / (room.cost * 8) * 100) : 0}%"></i></div><div class="cube-line">${icon('diamond')}<span>${fresh ? `<strong>${Math.floor(m.value / room.cost)}</strong> reward cubes` : 'Readiness unavailable'}</span><span class="readiness ${ready ? 'ready' : ''}">${ready ? 'Ready' : fresh ? 'Low energy' : '—'}</span></div><div class="card-footer"><span>${m.source === 'packet' ? 'Packet' : 'Manual'} ${known ? '· ' + age(m.lastReadingAt, now) : '· Not confirmed'}</span>${m.id === pb.authStore.record?.id && !demo ? '<button data-action="reading">Update</button>' : owner && !demo && m.role !== 'owner' ? `<button data-remove="${esc(m.id)}" aria-label="Remove ${esc(m.displayName)}">Remove</button>` : ''}</div></article>`;
}
function toast(message) { const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 4500); }
function modal(title, body) {
  const el = document.querySelector('#modal');
  el.innerHTML = `<div class="modal-head"><h2>${title}</h2><button data-action="close" class="close-button" aria-label="Close dialog">×</button></div>${body}`;
  el.showModal();
}
function inviteDialog() {
  if (!room) return toast('Create or join a room first.');
  if (demo) return modal('Bring your party together', '<p>This workspace uses sample data. Create a private room to get real invite codes.</p><button class="button primary" data-action="exit-demo">Create my room</button>');
  if (pb.authStore.record.role !== 'owner') return toast('Ask your party leader for an invite code.');
  modal('Invite your party', `<p>Codes expire in 30 minutes. Reporter codes allow joining with your own reading; viewer codes allow read-only access.</p><div id="invite-codes">${invites.length ? invites.map(invite => `<div class="invite-row"><div><span>${invite.role === 'reporter' ? 'PLAYER INVITE' : 'VIEWER INVITE'}</span><strong>${esc(invite.code.match(/.{1,4}/g).join(' '))}</strong><small>Expires ${new Date(invite.expiresAt).toLocaleTimeString()}</small></div><button class="icon-button" data-copy="${esc(invite.code)}" aria-label="Copy ${invite.role} code">${icon('copy')}</button></div>`).join('') : '<p>Generate fresh invites to share with your friends.</p>'}</div><button class="button primary" data-action="generate-invites">${invites.length ? 'Revoke codes & generate new invites' : 'Generate invite codes'}</button>`);
}
function readingDialog() {
  const me = members.find(m => m.id === pb.authStore.record.id) || pb.authStore.record;
  modal('Confirm your Odyle', `<p>Read your current <strong>Odyle Energy</strong> in AION 2, then enter it below. Zero is a valid reading.</p><form id="reading-form"><label>Character<input name="characterName" maxlength="40" value="${esc(me.characterName || me.displayName)}" required></label><div class="form-row"><label>Server<input name="server" maxlength="40" value="${esc(me.server)}" required></label><label>Region<select name="region">${['EU', 'NA', 'SA', 'ASIA'].map(r => `<option value="GLOBAL_${r}" ${me.region === 'GLOBAL_' + r ? 'selected' : ''}>Global ${r}</option>`).join('')}</select></label></div><label>Odyle Energy<input type="number" name="value" min="0" max="1000000" step="1" value="${me.confirmed ? me.value : ''}" placeholder="0" required></label><label class="check-label"><input type="checkbox" name="confirmed" required>I checked this total in the game and consent to share it with this room.</label><button class="button primary" type="submit">Confirm & share ${icon('arrow')}</button>${me.sharing ? '<button class="text-button" type="button" data-action="stop-sharing">Stop sharing & clear reading</button>' : ''}</form>`);
}
async function send(action, body = {}) {
  const data = await pb.send('/api/odyle/' + action, { method: 'POST', body });
  if (data.serverNow) serverOffset = Date.parse(data.serverNow) - Date.now();
  return data;
}
async function refresh() {
  const [r, list] = await Promise.all([pb.collection('rooms').getOne(pb.authStore.record.room), pb.collection('members').getFullList({ sort: 'created' })]);
  room = r; members = list; online = true;
  if (!document.querySelector('#modal')?.open) dashboard();
}
async function startSession(result) {
  if (result) { pb.authStore.save(result.token, result.record); sessionId = result.sessionId; sequence = 0; invites = result.invites || []; }
  else {
    await pb.collection('members').authRefresh();
    if (pb.authStore.record.role !== 'viewer') { const s = await send('session'); sessionId = s.sessionId; sequence = 0; }
  }
  await refresh();
  const update = async () => {
    try { await refresh(); }
    catch (error) {
      if ([401, 403, 404].includes(error.status)) { endSession(); toast('This room has closed or your access was revoked.'); return; }
      online = false; if (room && !document.querySelector('#modal')?.open) dashboard();
    }
  };
  unsubscribe.push(await pb.collection('members').subscribe('*', update));
  unsubscribe.push(await pb.collection('rooms').subscribe(pb.authStore.record.room, e => { if (e.action === 'delete') { endSession(); toast('The leader closed this room.'); } else update(); }));
  unsubscribe.push(await pb.realtime.subscribe('PB_CONNECT', async () => {
    try {
      if (pb.authStore.record?.role !== 'viewer') {
        const s = await send('session'); sessionId = s.sessionId; sequence = 0;
        toast('Reconnected. Confirm a new in-game reading.');
      }
      await update();
    } catch { online = false; }
  }));
  clearInterval(timer);
  timer = setInterval(async () => {
    if (busy || document.querySelector('#modal')?.open) return;
    try {
      if (Date.now() - lastPulse > 20000) {
        if ((!online || (lastPulse && Date.now() - lastPulse > 45000)) && pb.authStore.record?.role !== 'viewer') {
          const s = await send('session'); sessionId = s.sessionId; sequence = 0;
        }
        await send('heartbeat'); lastPulse = Date.now(); await refresh();
      }
      else if (room) dashboard();
    } catch (error) {
      if ([401, 403, 404].includes(error.status)) { endSession(); toast('This room has closed or your access was revoked.'); return; }
      online = false; if (room) dashboard();
    }
  }, 5000);
}
function endSession() {
  clearInterval(timer); unsubscribe.forEach(fn => fn()); unsubscribe = []; pb.authStore.clear(); room = null; members = []; invites = []; demo = false; online = false; welcome();
}
function demoSession() {
  demo = true; room = { name: 'The evening expedition', cost: 40 }; const now = Date.now();
  members = [
    { id: 'd1', displayName: 'DaveCZ', characterName: 'DaveCZ', role: 'owner', server: 'Atreia', region: 'GLOBAL_EU', value: 265, source: 'manual', sharing: true, confirmed: true, lastSeenAt: new Date(now).toISOString(), lastReadingAt: new Date(now - 3000).toISOString() },
    { id: 'd2', displayName: 'Lumina', characterName: 'Lumina', role: 'reporter', server: 'Atreia', region: 'GLOBAL_EU', value: 180, source: 'manual', sharing: true, confirmed: true, lastSeenAt: new Date(now).toISOString(), lastReadingAt: new Date(now - 9000).toISOString() },
    { id: 'd3', displayName: 'Kaelen', characterName: 'Kaelen', role: 'reporter', server: 'Atreia', region: 'GLOBAL_EU', value: 35, source: 'manual', sharing: true, confirmed: true, lastSeenAt: new Date(now).toISOString(), lastReadingAt: new Date(now - 12000).toISOString() },
    { id: 'd4', displayName: 'Seraph', characterName: 'Seraph', role: 'reporter', server: 'Atreia', region: 'GLOBAL_EU', value: 80, source: 'manual', sharing: true, confirmed: true, lastSeenAt: new Date(now).toISOString(), lastReadingAt: new Date(now - 120000).toISOString() },
    { id: 'd5', displayName: 'Nyx', characterName: 'Nyx', role: 'reporter', server: 'Atreia', region: 'GLOBAL_EU', source: 'manual', sharing: false, confirmed: false },
  ]; dashboard();
}
app.addEventListener('submit', async e => {
  e.preventDefault(); if (busy) return;
  const form = e.target, data = Object.fromEntries(new FormData(form)); busy = true;
  const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
  try {
    if (form.id === 'create-form') await startSession(await send('create', { ...data, cost: 40 }));
    else if (form.id === 'join-form') await startSession(await send('join', data));
    else if (form.id === 'reading-form') {
      const me = members.find(m => m.id === pb.authStore.record.id);
      if (!me?.sharing) await send('sharing', { enabled: true });
      if (!sessionId) { const s = await send('session'); sessionId = s.sessionId; sequence = 0; }
      await send('report', { ...data, value: Number(data.value), source: 'manual', confirmed: true, sessionId, sequence: ++sequence });
      document.querySelector('#modal').close(); await refresh(); toast('Odyle confirmed and shared with your party.');
    } else if (form.id === 'cost-form') { document.querySelector('#modal').close(); await setCost(Number(data.cost)); }
  } catch (error) { toast(error.message || 'Could not reach PocketBase. Check your server URL.'); }
  finally { busy = false; if (submit.isConnected) submit.disabled = false; }
});
async function setCost(cost) { if (demo) { room.cost = cost; dashboard(); } else { await send('settings', { cost }); await refresh(); } }
app.addEventListener('click', async e => {
  const el = e.target.closest('button, .brand'); if (!el) return;
  try {
    if (el.matches('.brand')) { room ? dashboard() : welcome(); return; }
    if (el.dataset.cost) return await setCost(Number(el.dataset.cost));
    if (el.dataset.copy) { await navigator.clipboard.writeText(el.dataset.copy); return toast('Invite code copied.'); }
    if (el.dataset.remove) { modal('Remove member?', `<p>This revokes the member’s room credential immediately.</p><button class="button danger" data-confirm-remove="${esc(el.dataset.remove)}">Remove member</button>`); return; }
    if (el.dataset.confirmRemove) { await send('revoke', { memberId: el.dataset.confirmRemove }); document.querySelector('#modal').close(); return await refresh(); }
    switch (el.dataset.action) {
      case 'overview': room ? dashboard() : welcome(); break;
      case 'demo': demoSession(); break;
      case 'exit-demo': endSession(); break;
      case 'close': document.querySelector('#modal').close(); break;
      case 'invite': inviteDialog(); break;
      case 'reading': readingDialog(); break;
      case 'stop-sharing': await send('sharing', { enabled: false }); document.querySelector('#modal').close(); await refresh(); toast('Sharing stopped. Your reading has been cleared.'); break;
      case 'generate-invites': invites = (await send('invites')).invites; inviteDialog(); break;
      case 'custom-cost': modal('Reward cube cost', `<form id="cost-form"><label>Odyle per cube<input name="cost" type="number" min="1" max="1000" value="${room.cost}" required></label><button class="button primary" type="submit">Save cube cost</button></form>`); break;
      case 'help': modal('A clear view of your party', `<p>Install the companion Windows app to join a room and publish your own confirmed Odyle. You can also enter your reading in this browser.</p><p><strong>Manual mode is available.</strong> Automatic packet reading is unavailable until the current Global game format is independently validated.</p><p>Fresh readings are usable for 45 seconds. Heartbeats keep a client online, but do not reconfirm its energy. A client becomes offline after 90 seconds without a heartbeat.</p><p>Only character details and normalized readings are shared. No game account, memory, or raw traffic is uploaded.</p>`); break;
      case 'account': if (demo) endSession(); else if (!room) toast('Create or join a private room to start.'); else modal('Your room session', `<p>Signed in as <strong>${esc(pb.authStore.record.displayName)}</strong> · ${esc(pb.authStore.record.role)}</p><p>This browser session is stored for this tab. Closing a leader’s room revokes everyone’s access.</p><button class="button danger" data-action="leave">${pb.authStore.record.role === 'owner' ? 'Close room for everyone' : 'Leave this room'}</button>`); break;
      case 'leave': await send('leave'); endSession(); break;
    }
  } catch (error) { toast(error.message); }
});
welcome();
if (pb.authStore.isValid) startSession().catch(() => { endSession(); toast('Your session expired. Join again with a fresh invite.'); });
