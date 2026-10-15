// Odyle pages of the PocketBase superuser dashboard, imported by main.js: the Windows
// apps connected right now and the requests ("packets") the apps and the dashboard
// send as they arrive, the background jobs, the game settings and the server controls.
// `app`, `t`, `store` and `watch` are globals of the PocketBase UI (extension API of
// PocketBase 0.37+, still marked experimental). Everything players control is rendered
// as text nodes, never as HTML.
const stylesheet = new URL('odyle.css', import.meta.url);
stylesheet.search = new URL(import.meta.url).search;
document.head.appendChild(t.link({ rel: 'stylesheet', href: stylesheet.href }));

const pages = [
  { href: '#/odyle', icon: 'ri-pulse-line', label: 'Apps & packets' },
  { href: '#/odyle/jobs', icon: 'ri-timer-line', label: 'Background jobs' },
  { href: '#/odyle/settings', icon: 'ri-equalizer-line', label: 'Game settings' },
  { href: '#/odyle/controls', icon: 'ri-toggle-line', label: 'Server controls' },
];
const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const timestamp = value => Date.parse(String(value || '').replace(' ', 'T'));
const number = value => typeof value === 'number' ? value.toLocaleString() : '?';
const region = value => String(value || '').replace('GLOBAL_', '').replace('ASIA', 'Asia');
const capital = text => text.charAt(0).toUpperCase() + text.slice(1);
function ago(at, now) {
  const seconds = Math.max(0, Math.floor((now - timestamp(at)) / 1000));
  if (!Number.isFinite(seconds)) return '—';
  return seconds < 60 ? seconds + 's ago' : seconds < 3600 ? Math.floor(seconds / 60) + 'm ago' : seconds < 86400 ? Math.floor(seconds / 3600) + 'h ago' : Math.floor(seconds / 86400) + 'd ago';
}
const clock = at => Number.isFinite(timestamp(at)) ? new Date(timestamp(at)).toLocaleTimeString() : '';
const when = at => Number.isFinite(timestamp(at)) ? new Date(timestamp(at)).toLocaleString() : '';
// Today's date, so the local time follows summer and winter time.
const localHour = (hour, minute = 0) => new Date(new Date().setUTCHours(hour, minute, 0, 0)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const copy = value => JSON.parse(JSON.stringify(value));
// Row keys: answers come from the server's JavaScript VM, which does not keep key order,
// so the same row would look changed in every answer without sorting.
const signature = value => value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => key + ':' + signature(value[key])).join(',') + '}' : String(value);
// The companion sends a heartbeat every 20 seconds. As on the dashboard (src/model.js),
// 45 seconds without contact is late and 90 seconds is offline.
function contact(at, now) { const age = now - timestamp(at); return !(age < 90000) ? 'offline' : age >= 45000 ? 'late' : 'online'; }
const contactLabels = { online: 'Online', late: 'Late', offline: 'Offline' };
function reading(c, now) {
  if (!c) return { state: 'waiting', label: 'Waiting for the game' };
  if (!c.confirmed) return { state: 'waiting', label: 'Named, no reading yet' };
  return c.valid && now - timestamp(c.lastSeenAt) < 45000 ? { state: 'live', label: 'Live reading' } : { state: 'stale', label: 'Stale' };
}
// Windows app versions are numbers like 0.6.0.12; a development build ends in .0.
function older(version, latest) {
  if (!version || !latest) return false;
  const a = version.split('.').map(Number), b = latest.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0);
  return false;
}
const place = p => [p.characterName, p.server ? p.server + (p.region ? ' (' + region(p.region) + ')' : '') : ''].filter(Boolean).join(' · ');
const room = p => p.roomName || (p.roomId ? 'room ' + p.roomId : 'a room');
const named = (text, name) => name ? text + ': ' + name : text;
// Requests of the Windows app; everything else comes from the dashboard. Character saves
// come from both, and count as the app's.
const appKinds = ['session', 'report', 'heartbeat', 'invalidate', 'character', 'pair', 'desktop-sign-in', 'desktop-device', 'unpair'];
function describe(p) {
  switch (p.kind) {
    case 'report': return (place(p) || 'Character') + ' → ' + number(p.value) + ' Odyle · #' + (p.sequence ?? '?') + ' · ' + (p.parserVersion || 'no adapter');
    case 'heartbeat': return p.characterId ? (p.characterName || p.characterId) + ' still in game' : 'App alive, no character in game';
    case 'session': return (p.previousSessionId ? 'Reader session renewed, replaces ' + p.previousSessionId : 'New reader session') + (p.appVersion ? ' · app ' + p.appVersion : '');
    case 'invalidate': return (p.characterName || p.characterId || 'Character') + ' marked stale';
    case 'character': return (place(p) || 'Character') + ' saved';
    case 'pair': return named('PC paired', p.name);
    case 'desktop-sign-in': return named('Paired PC signed in', p.name);
    case 'desktop-device': return named('Device key for an older pairing', p.name);
    case 'unpair': return 'PC disconnected its pairing';
    case 'create': return named('Room created', p.name);
    case 'join': return 'Joined a room with an invite';
    case 'rename': return named('Room renamed', p.name);
    case 'leave': return 'Left ' + room(p);
    case 'close': return 'Closed ' + room(p);
    case 'invites': return 'New invites for ' + room(p);
    case 'revoke': return 'Removed a member from ' + room(p);
    case 'role': return 'Made a member ' + (p.role === 'viewer' ? 'viewer' : 'player') + ' in ' + room(p);
    case 'transfer': return 'Handed ' + room(p) + ' to another member';
    case 'sharing': return (p.characterName || 'All characters') + (p.enabled ? ' shared with ' : ' unshared from ') + room(p);
    case 'wishlist': return (p.everyone ? 'Cleared ' : p.wanted ? 'Wished for ' : 'Unwished ') + (p.dungeon || 'a dungeon') + ' in ' + room(p);
    case 'plan': return (!p.runId ? named('Run planned', p.dungeon) : p.remove ? 'Run removed' : typeof p.going === 'boolean' ? (p.going ? 'Going to a run' : 'Not going to a run') : 'Run changed') + ' in ' + room(p);
    case 'discord-webhook': return 'Discord reminders set for ' + room(p);
    case 'task': return !p.taskId ? 'Task added' : p.remove ? 'Task removed' : typeof p.done === 'boolean' ? (p.done ? 'Task ticked' : 'Task unticked') : p.move ? 'Task moved ' + p.move : 'Task renamed';
    case 'profile': return named('Display name changed', p.displayName);
    case 'desktop-code': return 'Connection link for a new PC';
    case 'forget-device': return 'Paired PC removed';
    case 'sign-out-everywhere': return 'Signed out everywhere';
    case 'delete-account': return 'Account deleted';
    case 'delete-character': return (p.characterName || 'Character') + ' deleted';
    default: return p.kind;
  }
}
const kindClass = { report: 'success', session: 'info', character: 'info', pair: 'info', create: 'info', invalidate: 'warning', unpair: 'warning', close: 'warning', 'forget-device': 'warning', 'sign-out-everywhere': 'warning', 'delete-account': 'warning', 'delete-character': 'warning' };
const filters = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'app', label: 'Windows app', test: p => appKinds.includes(p.kind) },
  { id: 'web', label: 'Dashboard', test: p => !appKinds.includes(p.kind) },
  { id: 'rejected', label: 'Rejected', test: p => !p.ok },
];

// The apps and jobs pages use PocketBase's wide wrapper; the forms keep the narrow one.
const wide = ['#/odyle', '#/odyle/jobs'];
function layout(active, actions, ...content) {
  return t.div({ className: 'page odyle-page' },
    app.components.pageSidebar({ className: 'odyle-sidebar' }, t.nav({ className: 'sidebar-content scrollable' },
      t.details({ className: 'nav-group', open: true }, t.summary({ tabIndex: -1, onclick: () => false }, 'Odyle'),
        pages.map(p => t.a({ href: p.href, className: 'nav-item' + (p.href === active ? ' active' : '') }, t.i({ className: p.icon, ariaHidden: true }), t.span({ className: 'txt' }, p.label)))))),
    t.div({ className: 'page-content full-height' },
      t.header({ className: 'page-header' }, t.nav({ className: 'breadcrumbs' }, t.div({ className: 'breadcrumb-item' }, 'Odyle'), t.div({ className: 'breadcrumb-item' }, () => app.store.title)), actions),
      t.div({ className: 'wrapper m-b-base' + (wide.includes(active) ? ' lg' : '') }, ...content),
      t.footer({ className: 'page-footer' }, app.components.credits())));
}
const stat = (label, value, hint) => t.div({ className: 'odyle-stat' }, t.span({ className: 'txt-hint txt-sm' }, label), t.strong(null, value), t.span({ className: 'txt-hint txt-sm' }, hint));
const toggle = (id, label, checked, onchange) => t.div({ className: 'field odyle-toggle' }, t.input({ id, type: 'checkbox', className: 'switch', checked, onchange: e => onchange(e.target.checked) }), t.label({ htmlFor: id }, label));
const field = (id, label, input, help, width = 4) => t.div({ className: 'col-lg-' + width }, t.div({ className: 'field' }, t.label({ htmlFor: id }, label), input), t.div({ className: 'field-help' }, help));
const section = (title, hint) => t.div({ className: 'col-lg-12 odyle-section' }, t.div({ className: 'txt-lg' }, title), hint ? t.p({ className: 'txt-hint' }, hint) : null);

export function monitorPage() {
  app.store.title = 'Apps & packets';
  // feed is always current; frozen holds what is shown while the list is paused.
  const state = store({ loading: true, failed: '', apps: [], latestVersion: '', feed: [], frozen: null, heartbeats: true, filter: 'all', offset: 0, now: Date.now() });
  const now = () => state.now + state.offset;
  let alive = true, poll = 0, tick = 0, unsubscribe = null;
  async function load() {
    try {
      const data = await app.pb.send('/api/odyle/admin/monitor', { requestKey: null });
      // A signed-out dashboard can hand back an error body; only a full answer replaces the lists.
      if (Array.isArray(data?.apps) && Array.isArray(data.packets)) {
        state.offset = timestamp(data.serverNow) - Date.now(); state.apps = data.apps; state.latestVersion = data.latestVersion || '';
        // The server keeps the newest 200; its list replaces whatever realtime added since.
        state.feed = data.packets.slice().reverse(); state.failed = '';
      }
    } catch (error) { if (!error.isAbort) state.failed = error.message || 'The monitor could not be loaded.'; }
    state.loading = false;
  }
  function arrive(packet) {
    if (!packet || state.feed.some(p => p.id === packet.id)) return;
    state.feed = [{ ...packet, fresh: true }, ...state.feed].slice(0, 200);
  }
  const chosen = () => filters.find(f => f.id === state.filter) || filters[0];
  const shown = () => (state.frozen || state.feed).filter(p => (state.heartbeats || p.kind !== 'heartbeat' || !p.ok) && chosen().test(p));
  const waiting = () => state.frozen ? state.feed.filter(p => p.id > (state.frozen[0]?.id || 0)).length : 0;
  const recent = () => state.feed.filter(p => now() - timestamp(p.at) < 60000);
  const outdated = () => state.apps.filter(a => contact(a.lastContactAt, now()) !== 'offline' && older(a.appVersion, state.latestVersion));

  const version = a => !a.appVersion ? t.span({ className: 'txt-hint', title: 'Older Windows apps do not send their version' }, '—')
    : [t.div({ className: 'txt-code' }, a.appVersion), older(a.appVersion, state.latestVersion) ? t.span({ className: 'label sm warning', title: 'Newest release: ' + state.latestVersion }, 'update available') : state.latestVersion ? t.span({ className: 'txt-hint txt-sm' }, 'newest') : null];
  // Rows are keyed by session and content: an unchanged row is kept as it is, a changed one
  // is redrawn in its place. Only the status and ages tick every second.
  const appRow = a => t.tr({ rid: signature(a) + '@' + state.latestVersion },
    t.td(null, t.span({ className: () => 'odyle-status ' + contact(a.lastContactAt, now()) }, () => contactLabels[contact(a.lastContactAt, now())])),
    t.td(null, t.div({ className: 'txt-bold' }, a.account || '—'), a.device ? t.div({ className: 'txt-sm' }, a.device) : null, t.div({ className: 'txt-hint txt-sm txt-code' }, a.sessionId)),
    t.td({ className: 'txt-nowrap' }, version(a)),
    // A character belongs to the session that read it last, so older sessions lose it.
    t.td(null, a.character ? [t.div(null, place(a.character)), t.span({ className: () => 'odyle-reading ' + reading(a.character, now()).state }, () => reading(a.character, now()).label)] : () => contact(a.lastContactAt, now()) === 'offline' ? t.span({ className: 'txt-hint' }, '—') : t.span({ className: 'odyle-reading waiting' }, 'Waiting for the game')),
    t.td({ className: 'txt-right' }, a.character?.confirmed ? [t.div({ className: 'txt-bold' }, number(a.character.value)), t.div({ className: 'txt-hint txt-sm' }, () => 'changed ' + ago(a.character.lastReadingAt, now()))] : '—'),
    t.td({ className: 'txt-nowrap odyle-age' }, t.div(null, () => ago(a.lastContactAt, now())), t.div({ className: 'txt-hint txt-sm', title: when(a.connectedAt) }, () => 'connected ' + ago(a.connectedAt, now()))),
    t.td({ className: 'txt-right' }, number(a.readings)));
  // Packets never change, so rows are keyed and kept: only new ones are drawn (and flash).
  const packetRow = p => t.div({ rid: p.id + '@' + p.at, className: 'odyle-packet' + (p.ok ? '' : ' rejected') + (p.fresh ? ' fresh' : '') },
    t.span({ className: 'txt-hint', title: when(p.at) }, clock(p.at)),
    t.span({ className: 'label sm ' + (p.ok ? kindClass[p.kind] || '' : 'danger') }, p.ok ? p.kind : p.kind + ' rejected'),
    t.span({ className: 'txt-bold txt-ellipsis', title: p.account }, p.account || '—'),
    t.span({ className: 'odyle-packet-text' }, describe(p), p.ok ? null : t.span({ className: 'txt-danger' }, ' — ' + p.error)),
    t.span({ className: 'odyle-packet-ms txt-hint txt-nowrap' }, number(p.ms) + ' ms'));
  const heads = ['Status', 'Account', 'App', 'Game', 'Odyle', 'Last contact', 'Readings'];

  return layout('#/odyle', app.components.refreshButton({ onclick: load }),
    t.div({
      className: 'odyle-monitor',
      onmount: async () => {
        load(); poll = setInterval(load, 5000); tick = setInterval(() => state.now = Date.now(), 1000);
        try {
          const stop = await app.pb.realtime.subscribe('odyle.admin.packets', e => arrive(e.packet));
          if (alive) unsubscribe = stop; else stop();
        } catch (error) { console.warn('Odyle live packets unavailable, the list refreshes every 5 seconds:', error); }
      },
      onunmount: () => { alive = false; clearInterval(poll); clearInterval(tick); unsubscribe?.(); },
    },
    () => state.failed ? t.div({ className: 'alert danger m-b-sm' }, state.failed) : null,
    t.div({ className: 'odyle-stats m-b-base' },
      stat('Apps online', () => number(state.apps.filter(a => contact(a.lastContactAt, now()) === 'online').length), () => number(state.apps.length) + (state.apps.length === 1 ? ' reader session open' : ' reader sessions open')),
      stat('Reading the game', () => number(state.apps.filter(a => contact(a.lastContactAt, now()) === 'online' && reading(a.character, now()).state === 'live').length), 'live Odyle readings'),
      stat('Newest Windows app', () => state.latestVersion || '—', () => outdated().length ? number(outdated().length) + (outdated().length === 1 ? ' connected app is older' : ' connected apps are older') : 'no connected app is older'),
      stat('Packets last minute', () => number(recent().length), () => number(recent().filter(p => p.kind === 'report' && p.ok).length) + ' readings saved'),
      stat('Rejected', () => number(state.feed.filter(p => !p.ok).length), () => 'of the last ' + number(state.feed.length) + ' packets')),
    t.div({ className: 'flex m-b-sm' }, t.div({ className: 'txt-lg' }, 'Connected apps'), t.span({ className: 'txt-hint txt-sm' }, 'one row per running Windows app (reader session), by account')),
    t.div({ className: 'odyle-table m-b-base' }, t.table(null,
      t.thead(null, t.tr(null, ...heads.map(h => t.th({ className: h === 'Odyle' || h === 'Readings' ? 'txt-right' : '' }, h)))),
      t.tbody(null, () => state.apps.length ? state.apps.map(appRow) : t.tr(null, t.td({ colSpan: heads.length, className: 'txt-hint txt-center' }, () => state.loading ? 'Loading…' : 'No Windows app is connected.'))))),
    t.div({ className: 'flex m-b-sm odyle-feed-head' },
      t.div({ className: 'txt-lg' }, 'Packet flow'),
      t.span({ className: () => 'odyle-live ' + (state.frozen ? 'paused' : '') }, () => state.frozen ? 'Paused' : 'Live'),
      t.div({ className: 'odyle-filters' }, filters.map(f => t.button({ type: 'button', className: () => 'btn sm ' + (state.filter === f.id ? 'secondary' : 'transparent'), onclick: () => state.filter = f.id }, t.span({ className: 'txt' }, f.label)))),
      t.div({ className: 'm-r-auto' }),
      toggle('odyle-heartbeats', 'Heartbeats', () => state.heartbeats, checked => state.heartbeats = checked),
      t.button({ type: 'button', className: 'btn sm secondary', onclick: () => state.frozen = state.frozen ? null : state.feed.slice() },
        t.i({ className: () => state.frozen ? 'ri-play-line' : 'ri-pause-line', ariaHidden: true }),
        t.span({ className: 'txt' }, () => state.frozen ? 'Resume' + (waiting() ? ' (' + number(waiting()) + ' new)' : '') : 'Pause'))),
    t.div({ className: 'odyle-feed' }, () => shown().length ? shown().map(packetRow) : t.div({ className: 'odyle-packet txt-hint' }, () => state.loading ? 'Loading…' : state.feed.length ? 'No packets match this filter.' : 'No packets since the server started.')),
    t.p({ className: 'txt-hint txt-sm m-t-sm' }, 'Packets are Odyle\'s own requests: from the Windows app reader sessions, Odyle readings, heartbeats every 20 seconds, stale marks, character saves and pairings; from the dashboard every room, sharing, wishlist, run, task and account change. Only safe fields are kept (never tokens, codes, keys, webhooks, notes or task titles). The newest 200 are kept in server memory only and a restart clears them; game traffic itself never reaches the server.')));
}

// What each background job does; main.pb.js holds the schedules, lib/jobs.cjs the records.
const jobInfo = {
  'odyle-expiry': { label: 'Clean-up', schedule: () => 'Every 5 minutes', unit: 'removed', about: 'Removes expired invites, pairing codes and reader sessions, Odyle history older than 30 days and runs a day after they started.' },
  'odyle-portraits': { label: 'Portrait refresh', schedule: () => 'Every minute', unit: 'portraits checked', about: 'Up to five characters a run get their official portrait from PLAYNC: new ones at once, missing ones hourly, the rest daily.' },
  'odyle-reminders': { label: 'Discord reminders', schedule: () => 'Every minute', unit: 'reminders posted', about: 'Posts planned runs to their room\'s Discord channel 15 minutes before they start.' },
  'odyle-retention': { label: 'Inactive accounts', schedule: () => 'Daily at 03:17 UTC (' + localHour(3, 17) + ' here)', unit: 'accounts deleted', about: 'Deletes accounts unused for the period set under Game settings, up to 200 a night.' },
};
const skips = { paused: 'Skipped, paused under Server controls', off: 'Skipped, Game settings keep every account' };

export function jobsPage() {
  app.store.title = 'Background jobs';
  const state = store({ loading: true, failed: '', jobs: [], startedAt: '', offset: 0, now: Date.now(), starting: '' });
  const now = () => state.now + state.offset;
  let poll = 0, tick = 0;
  const accept = data => { if (!Array.isArray(data?.jobs)) return; state.offset = timestamp(data.serverNow) - Date.now(); state.jobs = data.jobs; state.startedAt = data.startedAt; state.failed = ''; };
  async function load() {
    try { accept(await app.pb.send('/api/odyle/admin/jobs', { requestKey: null })); } catch (error) { if (!error.isAbort) state.failed = error.message || 'The jobs could not be loaded.'; }
    state.loading = false;
  }
  const summary = (job, result) => result.skipped ? skips[result.skipped] || 'Skipped' : number(result.done || 0) + ' ' + jobInfo[job.name].unit + (result.failed ? ' · ' + number(result.failed) + ' failed' : '');
  async function start(job) {
    if (state.starting) return;
    state.starting = job.name;
    try { const data = await app.pb.send('/api/odyle/admin/jobs/' + encodeURIComponent(job.name), { method: 'POST', requestKey: null }); accept(data); app.toasts.success(jobInfo[job.name].label + ': ' + summary(job, data.result) + '.'); }
    catch (error) { app.checkApiError(error); }
    state.starting = '';
  }
  const stateLabel = job => job.state === 'paused' ? t.a({ href: '#/odyle/controls', className: 'label sm warning', title: 'Resume it under Server controls' }, 'Paused') : job.state === 'off' ? t.span({ className: 'label sm' }, 'Off') : null;
  const fact = (label, ...value) => t.div({ className: 'odyle-fact' }, t.div({ className: 'txt-hint txt-sm' }, label), ...value);
  // One card per job, keyed by its record: only a job that ran again is redrawn.
  const jobCard = job => t.div({ rid: signature(job) + '@' + state.starting, className: 'odyle-job' },
    t.div({ className: 'flex odyle-job-head' },
      t.span({ className: 'txt-bold txt-lg' }, jobInfo[job.name].label), stateLabel(job), job.running ? t.span({ className: 'label sm info' }, 'Running') : null,
      t.div({ className: 'm-r-auto' }),
      t.span({ className: 'txt-hint txt-sm' }, jobInfo[job.name].schedule()),
      job.manual ? t.button({ type: 'button', className: () => 'btn sm secondary' + (state.starting === job.name ? ' loading' : ''), disabled: () => Boolean(state.starting) || job.state === 'paused' || job.running, title: job.state === 'paused' ? 'Paused under Server controls' : 'Run it now, outside its schedule', onclick: () => start(job) },
        t.i({ className: 'ri-play-line', ariaHidden: true }), t.span({ className: 'txt' }, 'Run now')) : t.span({ className: 'label sm', title: 'It deletes accounts, so it never runs by hand' }, 'Schedule only')),
    t.div({ className: 'txt-hint txt-sm m-b-sm' }, jobInfo[job.name].about, ' ', t.span({ className: 'txt-code' }, job.name)),
    t.div({ className: 'odyle-facts' },
      fact('Last run', job.lastRunAt ? [t.div({ title: when(job.lastRunAt) }, () => ago(job.lastRunAt, now())), t.div({ className: 'txt-hint txt-sm' }, number(job.ms) + ' ms' + (job.byHand ? ' · by hand' : ''))] : t.div({ className: 'txt-hint' }, 'Not since the server started')),
      fact('Result', job.lastRunAt ? t.div({ className: job.failed ? 'txt-danger' : job.skipped ? 'txt-hint' : '' }, summary(job, job)) : t.div({ className: 'txt-hint' }, '—')),
      fact('Since the server started', job.runs ? [t.div(null, number(job.runs) + (job.runs === 1 ? ' run · ' : ' runs · ') + number(job.totalDone) + ' ' + jobInfo[job.name].unit),
        job.failedRuns ? t.div({ className: 'txt-sm txt-danger' }, number(job.failedRuns) + (job.failedRuns === 1 ? ' run with failures' : ' runs with failures')) : t.div({ className: 'txt-hint txt-sm' }, 'no failures')] : t.div({ className: 'txt-hint' }, '—'))),
    // The last failure stays listed after later runs succeed.
    job.failedRuns ? t.div({ className: 'odyle-job-error' + (job.error ? ' current' : '') },
      t.span({ className: 'txt-sm txt-bold' }, job.error ? 'Last run failed' : 'Last failure', ' ', t.span({ className: 'txt-hint', title: when(job.lastFailureAt) }, () => ago(job.lastFailureAt, now()))),
      t.div({ className: 'odyle-error' }, job.lastError)) : null);

  return layout('#/odyle/jobs', app.components.refreshButton({ onclick: load }),
    t.div({ onmount: () => { load(); poll = setInterval(load, 10000); tick = setInterval(() => state.now = Date.now(), 1000); }, onunmount: () => { clearInterval(poll); clearInterval(tick); } },
      () => state.failed ? t.div({ className: 'alert danger m-b-sm' }, state.failed) : null,
      t.div({ className: 'flex m-b-sm' }, t.div({ className: 'txt-lg' }, 'Scheduled jobs'), t.span({ className: 'txt-hint txt-sm', title: () => when(state.startedAt) }, () => state.startedAt ? 'counted since the server started ' + ago(state.startedAt, now()) : '')),
      t.div({ className: 'odyle-jobs m-b-base' }, () => state.jobs.length ? state.jobs.map(jobCard) : t.div({ className: 'txt-hint txt-center' }, () => state.loading ? 'Loading…' : 'No jobs.')),
      t.p({ className: 'txt-hint txt-sm' }, 'Each run is recorded in server memory, so a restart starts these counts over; details of every failure are also in the server log. The account clean-up only runs on its schedule.')));
}

// Both settings pages load the shared settings and save only their own fields, so one
// page never overwrites what the other changed. sync() refreshes text kept beside the form.
function settingsForm(keys, sync = () => {}) {
  const state = store({ loading: true, saving: false, form: null, initial: 'null', data: null, get changed() { return state.initial !== JSON.stringify(state.form); } });
  const accept = data => { state.data = data; state.form = copy(Object.fromEntries(keys.map(key => [key, data.settings[key]]))); state.initial = JSON.stringify(state.form); sync(state.form); };
  async function load() {
    try { accept(await app.pb.send('/api/odyle/admin/settings', { requestKey: null })); state.loading = false; } catch (error) { if (!error.isAbort) app.checkApiError(error); }
  }
  async function save(message) {
    if (state.saving || !state.changed) return;
    state.saving = true;
    try { accept(await app.pb.send('/api/odyle/admin/settings', { method: 'POST', body: state.form, requestKey: null })); app.toasts.success(message); } catch (error) { app.checkApiError(error); }
    state.saving = false;
  }
  const cancel = () => { state.form = JSON.parse(state.initial); sync(state.form); };
  const buttons = (...left) => t.div({ className: 'col-lg-12' }, t.div({ className: 'flex' }, ...left, t.div({ className: 'm-r-auto' }),
    () => state.changed ? [
      t.button({ type: 'button', className: 'btn transparent secondary', onclick: cancel }, t.span({ className: 'txt' }, 'Cancel')),
      t.button({ className: () => 'btn expanded-lg ' + (state.saving ? 'loading' : ''), disabled: () => state.saving }, t.span({ className: 'txt' }, 'Save changes')),
    ] : null));
  return { state, load, save, buttons };
}

export function settingsPage() {
  app.store.title = 'Game settings';
  // dungeonText is the catalog as typed; form.dungeons is the list it saves.
  const text = store({ dungeons: '' });
  const { state, load, save, buttons } = settingsForm(['odylePerCube', 'dailyResetHour', 'weeklyResetDay', 'inactiveAccountDays', 'dungeons'], form => text.dungeons = (form.dungeons || []).join('\n'));
  const integer = value => { const parsed = parseInt(value, 10); return Number.isNaN(parsed) ? null : parsed; };
  // The dungeon catalog is edited as one name per line.
  const lines = value => value.split('\n').map(line => line.trim()).filter(Boolean);
  const defaults = () => state.data?.defaults;
  load();
  return layout('#/odyle/settings', null,
    () => state.loading ? t.div({ className: 'block txt-center' }, t.span({ className: 'loader lg' })) : t.form({ className: 'grid', inert: () => state.saving, onsubmit: e => { e.preventDefault(); save('Saved the Odyle game settings.'); } },
      t.div({ className: 'col-lg-12 txt-lg' }, t.p(null, 'Server-wide rules for every room, the dashboard and the Windows app.')),
      field('odyle-per-cube', 'Odyle per cube', t.input({ id: 'odyle-per-cube', type: 'number', min: 1, max: 1000, step: 1, required: true, value: () => state.form.odylePerCube ?? '', oninput: e => state.form.odylePerCube = integer(e.target.value) }),
        'What one dungeon cube costs. Every room reports it as its cost and counts cubes with it; open dashboards follow within 15 seconds.'),
      field('odyle-daily-reset', 'Daily reset (hour, UTC)', t.input({ id: 'odyle-daily-reset', type: 'number', min: 0, max: 23, step: 1, required: true, value: () => state.form.dailyResetHour ?? '', oninput: e => state.form.dailyResetHour = integer(e.target.value) }),
        () => Number.isInteger(state.form.dailyResetHour) && state.form.dailyResetHour >= 0 && state.form.dailyResetHour < 24 ? 'Daily tasks uncheck at ' + String(state.form.dailyResetHour).padStart(2, '0') + ':00 UTC, ' + localHour(state.form.dailyResetHour) + ' in your time zone.' : 'An hour from 0 to 23.'),
      field('odyle-weekly-reset', 'Weekly reset day', app.components.select({ id: 'odyle-weekly-reset', required: true, options: days.map(d => ({ label: capital(d), value: d })), value: () => state.form.weeklyResetDay, onchange: e => state.form.weeklyResetDay = e?.[0]?.value }),
        'Weekly tasks uncheck on this day at the daily reset hour.'),
      field('odyle-inactive', 'Delete inactive accounts after (days)', t.input({ id: 'odyle-inactive', type: 'number', min: 0, max: 3650, step: 1, required: true, value: () => state.form.inactiveAccountDays ?? '', oninput: e => state.form.inactiveAccountDays = integer(e.target.value) }),
        () => state.form.inactiveAccountDays ? 'Every night, accounts that have not used the dashboard or the Windows app for ' + number(state.form.inactiveAccountDays) + ' days are deleted with their characters; rooms they own pass to another player or close.' : '0 keeps every account. Set 30 days or more to delete accounts that stopped using Odyle.'),
      field('odyle-dungeons', 'Dungeon catalog', t.textarea({ id: 'odyle-dungeons', rows: 6, placeholder: 'One dungeon per line', value: () => text.dungeons, oninput: e => { text.dungeons = e.target.value; state.form.dungeons = lines(e.target.value); } }),
        () => (state.form.dungeons || []).length ? number(state.form.dungeons.length) + ' dungeons. New wishlist entries and planned runs must be one of them and take this spelling; existing entries stay.' : 'Empty: wishlists and planned runs take any dungeon name. One name per line, up to 200.', 8),
      t.div({ className: 'col-lg-12' }, t.hr()),
      // Resets the game rules only; the retention period and the dungeon catalog stay.
      buttons(t.button({ type: 'button', className: 'btn transparent secondary', onclick: () => state.form = { ...state.form, odylePerCube: defaults().odylePerCube, dailyResetHour: defaults().dailyResetHour, weeklyResetDay: defaults().weeklyResetDay } },
        t.span({ className: 'txt' }, () => 'Use defaults (' + number(defaults()?.odylePerCube) + ' · ' + String(defaults()?.dailyResetHour ?? '').padStart(2, '0') + ':00 UTC · ' + capital(defaults()?.weeklyResetDay || '') + ')')))));
}

export function controlsPage() {
  app.store.title = 'Server controls';
  // extra is the extra adapter list as typed; form.adapters.extra is the list it saves.
  const text = store({ extra: '' });
  const { state, load, save, buttons } = settingsForm(['announcement', 'announcementLevel', 'portraitsPaused', 'remindersPaused', 'pairingPaused', 'adapters'], form => text.extra = form.adapters.extra.join('\n'));
  const lines = value => value.split('\n').map(line => line.trim()).filter(Boolean);
  const builtIn = () => state.data?.builtInAdapters || [];
  const adapters = next => state.form.adapters = { ...state.form.adapters, ...next };
  // The adapters readings are stored from once these changes are saved.
  const accepted = () => builtIn().filter(name => !state.form.adapters.disabled.includes(name)).concat(state.form.adapters.extra);
  const acceptExtra = name => { const extra = [...state.form.adapters.extra, name]; adapters({ extra }); text.extra = extra.join('\n'); };
  const switchField = (key, label, help) => t.div({ className: 'col-lg-4' }, toggle('odyle-' + key, label, () => state.form[key], checked => state.form[key] = checked), t.div({ className: 'field-help' }, help));
  const seenRow = s => t.tr({ rid: signature(s) + accepted().includes(s.name) },
    t.td({ className: 'txt-code' }, s.name),
    t.td({ className: 'txt-right' }, number(s.accepted)), t.td({ className: 'txt-right' }, number(s.rejected)),
    t.td({ className: 'txt-nowrap', title: when(s.lastAt) }, clock(s.lastAt)),
    t.td({ className: 'txt-right' }, accepted().includes(s.name) ? t.span({ className: 'label sm success' }, 'Accepted') : t.button({ type: 'button', className: 'btn sm secondary', onclick: () => acceptExtra(s.name) }, t.span({ className: 'txt' }, 'Accept'))));
  load();
  return layout('#/odyle/controls', null,
    () => state.loading ? t.div({ className: 'block txt-center' }, t.span({ className: 'loader lg' })) : t.form({ className: 'grid', inert: () => state.saving, onsubmit: e => { e.preventDefault(); save('Saved the Odyle server controls.'); } },
      section('Announcement', 'A message above every page of the dashboard and on the Windows app card, for example planned maintenance or an update to install. Players see it within about a minute; leave it empty to remove it.'),
      field('odyle-announcement', 'Message', t.textarea({ id: 'odyle-announcement', rows: 2, maxLength: 300, placeholder: 'For example: Server maintenance on Thursday 10:00–11:00 UTC.', value: () => state.form.announcement, oninput: e => state.form.announcement = e.target.value }),
        () => 'One line of plain text, ' + number(state.form.announcement.trim().length) + ' of 300 characters. Updated Windows apps show it on their card too.', 8),
      field('odyle-announcement-level', 'Style', app.components.select({ id: 'odyle-announcement-level', required: true, options: [{ label: 'Information', value: 'info' }, { label: 'Warning', value: 'warning' }], value: () => state.form.announcementLevel, onchange: e => state.form.announcementLevel = e?.[0]?.value || 'info' }),
        'Warnings stand out in amber.'),
      t.div({ className: 'col-lg-12' }, () => state.form.announcement.trim() ? t.div({ className: () => 'alert ' + (state.form.announcementLevel === 'warning' ? 'warning' : 'info') }, t.i({ className: state.form.announcementLevel === 'warning' ? 'ri-alert-line' : 'ri-information-line', ariaHidden: true }), t.span({ className: 'txt' }, state.form.announcement.trim().replace(/\s+/g, ' '))) : t.div({ className: 'txt-hint txt-sm' }, 'No announcement is shown.')),
      section('Switches', 'Pause a part of Odyle without a redeploy, for example while an outside service fails. Background jobs shows what each job did last.'),
      switchField('portraitsPaused', 'Pause portrait refresh', 'Stops asking PLAYNC for character portraits. New characters get theirs once it runs again.'),
      switchField('remindersPaused', 'Pause Discord reminders', 'No planned run is posted to Discord. Runs that start while paused are not announced afterwards; saving a webhook still posts its test message.'),
      switchField('pairingPaused', 'Pause new pairings', 'The dashboard stops creating connection links and Windows apps cannot pair. PCs already paired keep signing in and reading.'),
      section('Packet adapters', 'The Windows app names its decoder with every reading, and only readings from accepted adapters are stored. Built-in adapters come with the backend code; accept a new decoder here before the next deploy, or stop one that reads wrong values.'),
      t.div({ className: 'col-lg-4' }, t.div({ className: 'txt-bold m-b-xs' }, 'Built-in adapters'),
        builtIn().map(name => toggle('odyle-adapter-' + name, name, () => !state.form.adapters.disabled.includes(name), checked => adapters({ disabled: checked ? state.form.adapters.disabled.filter(n => n !== name) : [...state.form.adapters.disabled, name] }))),
        t.div({ className: 'field-help' }, 'Switched off, its readings are refused.')),
      field('odyle-adapters-extra', 'Also accept', t.textarea({ id: 'odyle-adapters-extra', rows: 3, placeholder: 'One adapter name per line', value: () => text.extra, oninput: e => { text.extra = e.target.value; adapters({ extra: lines(e.target.value) }); } }),
        'Letters, digits, dots, dashes and underscores, up to 20 names.', 8),
      t.div({ className: 'col-lg-12' }, () => accepted().length ? t.p(null, 'Readings are stored from: ', t.span({ className: 'txt-code' }, accepted().join(', ')), '.') : t.div({ className: 'alert danger' }, 'Keep at least one adapter accepted, or no reading can be saved.')),
      t.div({ className: 'col-lg-12' }, t.div({ className: 'txt-bold m-b-xs' }, 'Seen in the latest packets'),
        () => (state.data?.seenAdapters || []).length ? t.div({ className: 'odyle-table' }, t.table(null,
          t.thead(null, t.tr(null, t.th(null, 'Adapter'), t.th({ className: 'txt-right' }, 'Saved'), t.th({ className: 'txt-right' }, 'Rejected'), t.th(null, 'Last'), t.th({ className: 'txt-right' }, ''))),
          t.tbody(null, () => state.data.seenAdapters.map(seenRow)))) : t.div({ className: 'txt-hint txt-sm' }, 'No readings among the latest 200 packets.'),
        t.div({ className: 'field-help' }, 'Rejected counts readings refused for any reason, an outdated sequence included.')),
      t.div({ className: 'col-lg-12' }, t.hr()),
      buttons()));
}
