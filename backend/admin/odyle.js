// Odyle pages of the PocketBase superuser dashboard, imported by main.js: the Windows
// apps connected right now and the requests ("packets") the apps and the dashboard
// send as they arrive, the server's status with the last hour's traffic, the background
// jobs, the game settings and the server controls.
// `app`, `t`, `store` and `watch` are globals of the PocketBase UI (extension API of
// PocketBase 0.37+, still marked experimental). Everything players control is rendered
// as text nodes, never as HTML.
const stylesheet = new URL('odyle.css', import.meta.url);
stylesheet.search = new URL(import.meta.url).search;
document.head.appendChild(t.link({ rel: 'stylesheet', href: stylesheet.href }));

const pages = [
  { href: '#/odyle', icon: 'ri-pulse-line', label: 'Apps & packets' },
  { href: '#/odyle/status', icon: 'ri-bar-chart-box-line', label: 'Server status' },
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
// Newest first; a version the app did not send ('') last.
const byVersion = (a, b) => !a ? 1 : !b ? -1 : older(a, b) ? 1 : older(b, a) ? -1 : 0;
const place = p => [p.characterName, p.server ? p.server + (p.region ? ' (' + region(p.region) + ')' : '') : ''].filter(Boolean).join(' · ');
const room = p => p.roomName || (p.roomId ? 'room ' + p.roomId : 'a room');
const named = (text, name) => name ? text + ': ' + name : text;
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
// The server names each packet's source: the Windows app ('app') or the dashboard ('web').
const filters = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'app', label: 'Windows app', test: p => p.source === 'app' },
  { id: 'web', label: 'Dashboard', test: p => p.source === 'web' },
  { id: 'rejected', label: 'Rejected', test: p => !p.ok },
];
// A packet's fields in a fixed order (the server's VM does not keep key order): its own
// first, then the request's safe fields by name.
const first = ['id', 'at', 'kind', 'source', 'ok', 'ms', 'error', 'account', 'user'];
const fields = p => first.filter(key => key in p).concat(Object.keys(p).filter(key => !first.includes(key) && key !== 'fresh').sort()).map(key => [key, p[key]]);
const plain = p => Object.fromEntries(fields(p));

// The apps, status and jobs pages use PocketBase's wide wrapper; the forms keep the narrow one.
const wide = ['#/odyle', '#/odyle/status', '#/odyle/jobs'];
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

// Links from the Server status page open this page filtered: #/odyle?kind=report&filter=rejected
// (and account=<user id>).
export function monitorPage(route) {
  app.store.title = 'Apps & packets';
  const query = name => route?.query?.[name]?.[0] || '';
  // feed is always current; frozen holds what is shown while the list is paused. open is
  // the packet whose fields are shown.
  const state = store({ loading: true, failed: '', apps: [], latestVersion: '', feed: [], frozen: null, heartbeats: true, offset: 0, now: Date.now(), open: 0,
    filter: filters.some(f => f.id === query('filter')) ? query('filter') : 'all', kind: query('kind'), account: query('account'), search: '' });
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
  // The search matches the shown text and every field's value, ids and adapter names included.
  const words = () => state.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const text = p => [describe(p), ...Object.values(p).filter(v => typeof v === 'string' || typeof v === 'number')].join(' ').toLowerCase();
  const matches = p => (state.heartbeats || p.kind !== 'heartbeat' || !p.ok || state.kind === 'heartbeat') && chosen().test(p)
    && (!state.kind || p.kind === state.kind) && (!state.account || p.user === state.account) && words().every(word => text(p).includes(word));
  const shown = () => (state.frozen || state.feed).filter(matches);
  const narrowed = () => state.kind || state.account || words().length || state.filter !== 'all' || !state.heartbeats;
  const waiting = () => state.frozen ? state.feed.filter(p => p.id > (state.frozen[0]?.id || 0)).length : 0;
  const recent = () => state.feed.filter(p => now() - timestamp(p.at) < 60000);
  const outdated = () => state.apps.filter(a => contact(a.lastContactAt, now()) !== 'offline' && older(a.appVersion, state.latestVersion));
  const accountName = () => state.feed.find(p => p.user === state.account)?.account || state.apps.find(a => a.user === state.account)?.account || state.account;
  const feed = () => document.querySelector('.odyle-feed-head')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const onlyAccount = user => { state.account = user; feed(); };
  // The shown packets, oldest first like the API, with the filters that chose them.
  function exportShown() {
    const packets = shown().slice().reverse().map(plain);
    app.utils.downloadJSON({ exportedAt: new Date().toISOString(), server: location.origin, filters: { source: state.filter, kind: state.kind, account: state.account, search: state.search.trim(), heartbeats: state.heartbeats }, packets }, 'odyle-packets-' + new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-'));
  }
  const chip = (label, value, clear) => t.span({ className: 'label sm odyle-chip' }, t.span({ className: 'txt-hint' }, label), ' ', value,
    t.button({ type: 'button', className: 'odyle-chip-clear', title: 'Clear', ariaLabel: 'Clear ' + label.toLowerCase(), onclick: clear }, t.i({ className: 'ri-close-line', ariaHidden: true })));

  const version = a => !a.appVersion ? t.span({ className: 'txt-hint', title: 'Older Windows apps do not send their version' }, '—')
    : [t.div({ className: 'txt-code' }, a.appVersion), older(a.appVersion, state.latestVersion) ? t.span({ className: 'label sm warning', title: 'Newest release: ' + state.latestVersion }, 'update available') : state.latestVersion ? t.span({ className: 'txt-hint txt-sm' }, 'newest') : null];
  // Rows are keyed by session and content: an unchanged row is kept as it is, a changed one
  // is redrawn in its place. Only the status and ages tick every second.
  const appRow = a => t.tr({ rid: signature(a) + '@' + state.latestVersion },
    t.td(null, t.span({ className: () => 'odyle-status ' + contact(a.lastContactAt, now()) }, () => contactLabels[contact(a.lastContactAt, now())])),
    t.td(null, t.button({ type: 'button', className: 'odyle-link txt-bold', title: 'Show only this account\'s packets', onclick: () => onlyAccount(a.user) }, a.account || '—'), a.device ? t.div({ className: 'txt-sm' }, a.device) : null, t.div({ className: 'txt-hint txt-sm txt-code' }, a.sessionId)),
    t.td({ className: 'txt-nowrap' }, version(a)),
    // A character belongs to the session that read it last, so older sessions lose it.
    t.td(null, a.character ? [t.div(null, place(a.character)), t.span({ className: () => 'odyle-reading ' + reading(a.character, now()).state }, () => reading(a.character, now()).label)] : () => contact(a.lastContactAt, now()) === 'offline' ? t.span({ className: 'txt-hint' }, '—') : t.span({ className: 'odyle-reading waiting' }, 'Waiting for the game')),
    t.td({ className: 'txt-right' }, a.character?.confirmed ? [t.div({ className: 'txt-bold' }, number(a.character.value)), t.div({ className: 'txt-hint txt-sm' }, () => 'changed ' + ago(a.character.lastReadingAt, now()))] : '—'),
    t.td({ className: 'txt-nowrap odyle-age' }, t.div(null, () => ago(a.lastContactAt, now())), t.div({ className: 'txt-hint txt-sm', title: when(a.connectedAt) }, () => 'connected ' + ago(a.connectedAt, now()))),
    t.td({ className: 'txt-right' }, number(a.readings)));
  // Every field of one packet, with shortcuts to the packets like it.
  const value = (key, v) => key === 'at' ? when(v) + ' · ' + v : key === 'ms' ? v + ' ms' : String(v);
  const detail = p => t.div({ className: 'odyle-packet-detail', onclick: e => e.stopPropagation() },
    t.dl({ className: 'odyle-fields' }, fields(p).flatMap(([key, v]) => [t.dt({ className: 'txt-hint' }, key), t.dd({ className: key === 'error' ? 'txt-danger' : '' }, value(key, v))])),
    t.div({ className: 'flex odyle-detail-actions' },
      p.user ? t.button({ type: 'button', className: 'btn sm secondary', disabled: () => state.account === p.user, onclick: () => state.account = p.user }, t.i({ className: 'ri-user-line', ariaHidden: true }), t.span({ className: 'txt' }, 'Only this account')) : null,
      t.button({ type: 'button', className: 'btn sm secondary', disabled: () => state.kind === p.kind, onclick: () => state.kind = p.kind }, t.i({ className: 'ri-filter-line', ariaHidden: true }), t.span({ className: 'txt' }, 'Only ' + p.kind)),
      t.button({ type: 'button', className: 'btn sm transparent secondary', onclick: async () => { await app.utils.copyToClipboard(JSON.stringify(plain(p), null, 2)); app.toasts.success('Packet ' + p.id + ' copied as JSON.'); } }, t.i({ className: 'ri-file-copy-line', ariaHidden: true }), t.span({ className: 'txt' }, 'Copy JSON'))));
  // Packets never change, so rows are keyed and kept: only new ones are drawn (and flash).
  // A click opens the packet's fields, unless it selected text to copy.
  const expand = p => { if (!String(window.getSelection?.() || '')) state.open = state.open === p.id ? 0 : p.id; };
  const packetRow = p => t.div({ rid: p.id + '@' + p.at, className: () => 'odyle-packet' + (p.ok ? '' : ' rejected') + (p.fresh ? ' fresh' : '') + (state.open === p.id ? ' open' : ''), onclick: () => expand(p) },
    t.span({ className: 'txt-hint', title: when(p.at) }, clock(p.at)),
    t.button({ type: 'button', className: 'label sm odyle-kind ' + (p.ok ? kindClass[p.kind] || '' : 'danger'), title: 'Show only ' + p.kind + ' packets', onclick: e => { e.stopPropagation(); state.kind = p.kind; } }, p.ok ? p.kind : p.kind + ' rejected'),
    p.user ? t.button({ type: 'button', className: 'odyle-link txt-bold txt-ellipsis', title: 'Show only ' + (p.account || 'this account') + '\'s packets', onclick: e => { e.stopPropagation(); state.account = p.user; } }, p.account || '—') : t.span({ className: 'txt-hint' }, '—'),
    t.button({ type: 'button', className: 'odyle-packet-text', ariaExpanded: () => state.open === p.id, title: 'Show every field', onclick: e => { e.stopPropagation(); expand(p); } }, describe(p), p.ok ? null : t.span({ className: 'txt-danger' }, ' — ' + p.error)),
    t.span({ className: 'odyle-packet-ms txt-hint txt-nowrap' }, number(p.ms) + ' ms'),
    () => state.open === p.id ? detail(p) : null);
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
    t.div({ className: 'flex m-b-sm odyle-feed-tools' },
      t.div({ className: 'odyle-search' }, t.i({ className: 'ri-search-line txt-hint', ariaHidden: true }),
        t.input({ type: 'search', id: 'odyle-search', placeholder: 'Search packets: account, character, room, error, id…', ariaLabel: 'Search packets', value: () => state.search, oninput: e => state.search = e.target.value })),
      () => state.kind ? chip('Kind', state.kind, () => state.kind = '') : null,
      () => state.account ? chip('Account', accountName(), () => state.account = '') : null,
      t.div({ className: 'm-r-auto' }),
      t.span({ className: 'txt-hint txt-sm txt-nowrap' }, () => narrowed() ? number(shown().length) + ' of ' + number((state.frozen || state.feed).length) + ' packets' : number(shown().length) + ' packets'),
      t.button({ type: 'button', className: 'btn sm transparent secondary', disabled: () => !shown().length, title: 'The packets shown, as JSON', onclick: exportShown }, t.i({ className: 'ri-download-line', ariaHidden: true }), t.span({ className: 'txt' }, 'Export'))),
    t.div({ className: 'odyle-feed' }, () => shown().length ? shown().map(packetRow) : t.div({ className: 'odyle-packet txt-hint' }, () => state.loading ? 'Loading…' : state.feed.length ? 'No packets match these filters.' : 'No packets since the server started.')),
    t.p({ className: 'txt-hint txt-sm m-t-sm' }, 'Packets are Odyle\'s own requests: from the Windows app reader sessions, Odyle readings, heartbeats every 20 seconds, stale marks, character saves and pairings; from the dashboard every room, sharing, wishlist, run, task and account change. Click a packet for all its fields, its kind or account to show only those. Only safe fields are kept (never tokens, codes, keys, webhooks, notes or task titles). The newest 200 are kept in server memory only and a restart clears them; game traffic itself never reaches the server.')));
}

// The traffic chart's series, stacked from the baseline in this order (rejected first, so
// it is read against the axis); colors in odyle.css.
const series = [
  { id: 'rejected', label: 'Rejected' },
  { id: 'app', label: 'Windows app' },
  { id: 'web', label: 'Dashboard' },
  { id: 'read', label: 'Reads' },
];
const sourceLabels = { app: 'Windows app', web: 'Dashboard', read: 'Read' };
const plotHeight = 160;
// The scale's top: 2, 4, 6, 8 or 10 times a power of ten, so its half is a whole number too.
function ceiling(value) { for (let power = 1; ; power *= 10) for (const step of [2, 4, 6, 8, 10]) if (step * power >= value) return step * power; }
const duration = ms => { const m = Math.floor(ms / 60000); return !(m >= 1) ? Math.max(0, Math.floor(ms / 1000) || 0) + 's' : m < 60 ? m + 'm' : m < 1440 ? Math.floor(m / 60) + 'h ' + m % 60 + 'm' : Math.floor(m / 1440) + 'd ' + Math.floor(m % 1440 / 60) + 'h'; };
const millis = ms => typeof ms !== 'number' ? '—' : ms < 1000 ? number(ms) + ' ms' : (ms / 1000).toLocaleString([], { maximumFractionDigits: 1 }) + ' s';
const share = (part, whole) => whole ? (part / whole * 100).toLocaleString([], { maximumFractionDigits: 1 }) + ' %' : '—';
const minuteLabel = at => Number.isFinite(timestamp(at)) ? new Date(timestamp(at)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
// Packet routes link to the packet list, filtered; reads are never listed as packets.
const packets = (kind, extra = '') => '#/odyle?kind=' + encodeURIComponent(kind) + extra;

export function statusPage() {
  app.store.title = 'Server status';
  const empty = { serverNow: '', startedAt: '', database: {}, counts: {}, release: {}, versions: [], traffic: { minutes: [], total: { count: 0, rejected: 0 }, routes: [], errors: [] } };
  // hover is the minute (its time) the chart's tooltip shows.
  const state = store({ loading: true, failed: '', data: empty, offset: 0, now: Date.now(), hover: '' });
  const now = () => state.now + state.offset;
  let poll = 0, tick = 0;
  async function load() {
    try {
      const data = await app.pb.send('/api/odyle/admin/status', { requestKey: null });
      if (Array.isArray(data?.traffic?.minutes)) { state.offset = timestamp(data.serverNow) - Date.now(); state.data = data; state.failed = ''; }
    } catch (error) { if (!error.isAbort) state.failed = error.message || 'The server status could not be loaded.'; }
    state.loading = false;
  }
  const traffic = () => state.data.traffic, minutes = () => traffic().minutes, total = m => series.reduce((sum, s) => sum + m[s.id], 0);
  const top = () => ceiling(Math.max(0, ...minutes().map(total)));
  const busiest = () => Math.max(0, ...minutes().map(total));
  // Per minute over the hour, or over the minutes since a server start less than an hour ago.
  const perMinute = () => traffic().total.count / Math.min(60, Math.max(1, Math.ceil((now() - timestamp(state.data.startedAt)) / 60000)) || 60);
  const counts = name => state.data.counts[name] || {};
  const latest = () => state.data.release.version || '';

  // Requests per minute, stacked by source. Each minute's column is its hover target; the
  // arrow keys move through the minutes when the chart has focus.
  const segment = (m, s, scale) => m[s.id] ? t.div({ className: 'odyle-segment ' + s.id, style: 'height:' + Math.max(2, Math.round(m[s.id] / scale * plotHeight)) + 'px' }) : null;
  const column = m => { const scale = top(); return t.div({ rid: m.at + '@' + signature(m) + '@' + scale, className: () => 'odyle-minute' + (state.hover === m.at ? ' active' : ''), onpointerenter: () => state.hover = m.at }, total(m) ? t.div({ className: 'odyle-bar' }, series.map(s => segment(m, s, scale))) : null); };
  const hovered = () => minutes().findIndex(m => m.at === state.hover);
  const tip = () => {
    const i = hovered(); if (i < 0) return null;
    // Beside the minute, towards the middle of the chart, so the bar stays in sight.
    const m = minutes()[i], side = i < minutes().length / 2 ? ' after' : ' before';
    return t.div({ className: 'odyle-tip' + side, style: 'left:' + (i + 0.5) / minutes().length * 100 + '%' },
      t.div({ className: 'txt-hint txt-sm' }, minuteLabel(m.at) + ' – ' + minuteLabel(new Date(timestamp(m.at) + 60000).toISOString())),
      series.map(s => t.div({ className: 'odyle-tip-row' }, t.span({ className: 'odyle-key-line ' + s.id }), t.strong(null, number(m[s.id])), t.span({ className: 'txt-hint' }, s.label))),
      t.div({ className: 'odyle-tip-row total' }, t.strong(null, number(total(m))), t.span({ className: 'txt-hint' }, total(m) === 1 ? 'request' : 'requests')));
  };
  function move(e) {
    const list = minutes(), i = hovered(), last = list.length - 1;
    const next = { ArrowLeft: Math.max(0, (i < 0 ? last : i) - 1), ArrowRight: Math.min(last, (i < 0 ? last : i) + 1), Home: 0, End: last }[e.key];
    if (next === undefined || !list.length) return;
    e.preventDefault(); state.hover = list[next].at;
  }
  const legend = () => series.map(s => t.span({ className: 'odyle-key' }, t.span({ className: 'odyle-swatch ' + s.id }), s.id === 'rejected' ? t.i({ className: 'ri-error-warning-line', ariaHidden: true }) : null,
    s.label, ' ', t.strong(null, () => number(minutes().reduce((sum, m) => sum + m[s.id], 0)))));
  const chart = t.div({ className: 'odyle-chart', tabIndex: 0, role: 'group', ariaLabel: 'Requests per minute over the last hour. The arrow keys read each minute.',
    onkeydown: move, onfocus: () => { if (!state.hover && minutes().length) state.hover = minutes()[minutes().length - 1].at; }, onblur: () => state.hover = '' },
    t.div({ className: 'odyle-legend' }, legend()),
    t.div({ className: 'odyle-plot', style: 'height:' + plotHeight + 'px' },
      t.div({ className: 'odyle-gridline', style: 'bottom:' + plotHeight + 'px' }, t.span(null, () => number(top()))),
      t.div({ className: 'odyle-gridline', style: 'bottom:' + plotHeight / 2 + 'px' }, t.span(null, () => number(top() / 2))),
      t.div({ className: 'odyle-gridline base', style: 'bottom:0' }, t.span(null, '0')),
      t.div({ className: 'odyle-bars', onpointerleave: () => { if (document.activeElement !== chart) state.hover = ''; } }, () => minutes().map(column)),
      t.div({ className: 'odyle-tip-layer', ariaLive: 'polite' }, tip)),
    // A time under every quarter hour.
    t.div({ className: 'odyle-axis', ariaHidden: true }, () => minutes().map(m => t.span({ rid: m.at }, new Date(timestamp(m.at)).getMinutes() % 15 === 0 ? minuteLabel(m.at) : ''))));
  // The same minutes as a table, newest first, for reading without the chart.
  const minuteTable = () => {
    const busy = minutes().filter(total).reverse();
    return busy.length ? t.div({ className: 'odyle-table m-t-xs' }, t.table(null,
      t.thead(null, t.tr(null, t.th(null, 'Minute'), series.map(s => t.th({ className: 'txt-right' }, s.label)), t.th({ className: 'txt-right' }, 'Total'))),
      t.tbody(null, busy.map(m => t.tr(null, t.td({ className: 'txt-nowrap' }, minuteLabel(m.at)), series.map(s => t.td({ className: 'txt-right' }, number(m[s.id]))), t.td({ className: 'txt-right txt-bold' }, number(total(m)))))))) : t.div({ className: 'txt-hint txt-sm m-t-xs' }, 'No requests in the last hour.');
  };

  const routeRow = r => t.tr({ rid: signature(r) },
    t.td({ className: 'txt-code' }, r.source === 'read' ? r.kind : t.a({ href: packets(r.kind), title: 'Show these packets' }, r.kind)),
    t.td(null, sourceLabels[r.source] || r.source),
    t.td({ className: 'txt-right' }, number(r.count)),
    t.td({ className: 'txt-right txt-nowrap' }, !r.rejected ? t.span({ className: 'txt-hint' }, '0') : r.source === 'read' ? t.span({ className: 'txt-danger' }, number(r.rejected) + ' · ' + share(r.rejected, r.count))
      : t.a({ href: packets(r.kind, '&filter=rejected'), className: 'txt-danger', title: 'Show the rejected ones among the latest packets' }, number(r.rejected) + ' · ' + share(r.rejected, r.count))),
    t.td({ className: 'txt-right txt-nowrap' }, millis(r.averageMs)),
    t.td({ className: 'txt-right txt-nowrap' }, '≤ ' + millis(r.medianMs)),
    t.td({ className: 'txt-right txt-nowrap' }, '≤ ' + millis(r.p95Ms)),
    t.td({ className: 'txt-right txt-nowrap' }, millis(r.maxMs)));
  const routeHeads = ['Route', 'Source', 'Requests', 'Rejected', 'Average', 'Median', '95 %', 'Slowest'];
  const reasonRow = r => t.tr({ rid: signature(r) },
    t.td({ className: 'odyle-error' }, r.message),
    t.td({ className: 'txt-code txt-nowrap' }, r.kind),
    t.td({ className: 'txt-right' }, number(r.count)),
    t.td({ className: 'txt-nowrap odyle-age', title: when(r.lastAt) }, () => ago(r.lastAt, now())),
    t.td({ className: 'txt-right txt-nowrap' }, r.kind.startsWith('GET ') ? null : t.a({ href: packets(r.kind, '&filter=rejected'), title: 'The rejected ones among the latest packets' }, 'Show packets')));
  const versionRow = v => t.tr({ rid: signature(v) + '@' + latest() },
    t.td({ className: 'txt-code' }, v.version || t.span({ className: 'txt-hint' }, 'not sent (older app)')),
    t.td({ className: 'txt-right' }, number(v.apps)),
    t.td(null, !v.version || !latest() ? null : older(v.version, latest()) ? t.span({ className: 'label sm warning' }, 'update available') : t.span({ className: 'txt-hint txt-sm' }, 'newest')));
  const release = () => state.data.release;

  return layout('#/odyle/status', app.components.refreshButton({ onclick: load }),
    t.div({ onmount: () => { load(); poll = setInterval(load, 10000); tick = setInterval(() => state.now = Date.now(), 1000); }, onunmount: () => { clearInterval(poll); clearInterval(tick); } },
      () => state.failed ? t.div({ className: 'alert danger m-b-sm' }, state.failed) : null,
      t.div({ className: 'odyle-stats m-b-base' },
        stat('Server running', () => state.data.startedAt ? duration(now() - timestamp(state.data.startedAt)) : '—', () => state.data.startedAt ? 'since ' + when(state.data.startedAt) : ''),
        stat('Requests last hour', () => number(traffic().total.count), () => perMinute().toLocaleString([], { maximumFractionDigits: 1 }) + ' a minute · busiest ' + number(busiest())),
        stat('Rejected last hour', () => number(traffic().total.rejected), () => share(traffic().total.rejected, traffic().total.count) + ' of the requests'),
        stat('Handling time', () => traffic().total.count ? '≤ ' + millis(traffic().total.p95Ms) : '—', () => traffic().total.count ? '95 % of requests · median ≤ ' + millis(traffic().total.medianMs) + ' · slowest ' + millis(traffic().total.maxMs) : 'no requests yet'),
        stat('Database', () => state.data.database.dataBytes ? app.utils.formattedFileSize(state.data.database.dataBytes) : '—', () => state.data.database.logsBytes ? 'logs ' + app.utils.formattedFileSize(state.data.database.logsBytes) : '')),
      t.div({ className: 'flex m-b-sm' }, t.div({ className: 'txt-lg' }, 'Requests per minute'), t.span({ className: 'txt-hint txt-sm' }, 'the last hour, by source; rejected ones from any source')),
      t.div({ className: 'odyle-card m-b-base' }, chart,
        t.details({ className: 'odyle-minutes' }, t.summary({ className: 'txt-sm' }, 'Minutes as a table'), minuteTable)),
      t.div({ className: 'flex m-b-sm' }, t.div({ className: 'txt-lg' }, 'Routes'), t.span({ className: 'txt-hint txt-sm' }, 'the last hour, busiest first')),
      t.div({ className: 'odyle-table m-b-xs' }, t.table(null,
        t.thead(null, t.tr(null, routeHeads.map((h, i) => t.th({ className: i > 1 ? 'txt-right' : '' }, h)))),
        t.tbody(null, () => traffic().routes.length ? traffic().routes.map(routeRow) : t.tr(null, t.td({ colSpan: routeHeads.length, className: 'txt-hint txt-center' }, () => state.loading ? 'Loading…' : 'No requests in the last hour.'))))),
      t.p({ className: 'txt-hint txt-sm m-b-base' }, 'Handling time is measured inside Odyle\'s route, from the request to its answer. Median and 95 % are upper bounds: times are counted in steps of 1, 2, 5, 10, 25, 50, 100, 250 and 500 ms, 1, 2.5 and 5 s.'),
      t.div({ className: 'flex m-b-sm' }, t.div({ className: 'txt-lg' }, 'Rejection reasons'), t.span({ className: 'txt-hint txt-sm' }, 'the last hour, most frequent first')),
      t.div({ className: 'odyle-table m-b-base' }, t.table(null,
        t.thead(null, t.tr(null, t.th(null, 'Reason'), t.th(null, 'Route'), t.th({ className: 'txt-right' }, 'Count'), t.th(null, 'Last'), t.th(null, ''))),
        t.tbody(null, () => traffic().errors.length ? traffic().errors.map(reasonRow) : t.tr(null, t.td({ colSpan: 5, className: 'txt-hint txt-center' }, () => state.loading ? 'Loading…' : 'Nothing was rejected in the last hour.'))))),
      t.div({ className: 'flex m-b-sm' }, t.div({ className: 'txt-lg' }, 'Stored data')),
      t.div({ className: 'odyle-stats m-b-base' },
        stat('Accounts', () => number(counts('accounts').total), () => number(counts('accounts').active24h) + ' active in 24 h · ' + number(counts('accounts').active7d) + ' in 7 days'),
        stat('Characters', () => number(counts('characters').total), () => number(counts('characters').live) + ' with a live reading'),
        stat('Rooms', () => number(counts('rooms').total), () => number(counts('rooms').discordReminders) + ' with Discord reminders'),
        stat('Paired PCs', () => number(counts('pairedPcs').total), () => number(counts('readerSessions').connected) + ' apps connected · ' + number(counts('readerSessions').open) + ' sessions open'),
        stat('Planned runs', () => number(counts('plannedRuns').total), () => number(counts('plannedRuns').upcoming) + ' still to start'),
        stat('Odyle history', () => number(counts('historyPoints').total), 'changes of the last 30 days'),
        stat('Checklist tasks', () => number(counts('tasks').total), 'daily and weekly')),
      t.div({ className: 'flex m-b-sm' }, t.div({ className: 'txt-lg' }, 'Windows app')),
      t.div({ className: 'grid m-b-base' },
        t.div({ className: 'col-lg-5' }, t.div({ className: 'odyle-card' },
          t.div({ className: 'txt-hint txt-sm' }, 'Newest release'),
          t.div({ className: 'txt-lg txt-bold' }, () => latest() || '—'),
          t.div({ className: 'txt-sm' }, () => release().publishedAt ? 'published ' + when(release().publishedAt) : 'not known yet'),
          t.div({ className: 'txt-hint txt-sm' }, () => release().checkedAt ? 'GitHub checked ' + ago(release().checkedAt, now()) + (release().fetchedAt ? ', last answered ' + ago(release().fetchedAt, now()) : ', no answer since the server started') : ''),
          () => release().error ? t.div({ className: 'alert warning m-t-xs odyle-error' }, 'The last lookup failed: ', release().error) : null,
          () => release().repository ? t.a({ className: 'txt-sm', href: 'https://github.com/' + release().repository + '/releases', target: '_blank', rel: 'noopener noreferrer' }, 'Releases on GitHub ↗') : null)),
        t.div({ className: 'col-lg-7' }, t.div({ className: 'odyle-table' }, t.table(null,
          t.thead(null, t.tr(null, t.th(null, 'Connected app version'), t.th({ className: 'txt-right' }, 'Apps'), t.th(null, ''))),
          t.tbody(null, () => state.data.versions.length ? state.data.versions.slice().sort((a, b) => byVersion(a.version, b.version)).map(versionRow) : t.tr(null, t.td({ colSpan: 3, className: 'txt-hint txt-center' }, () => state.loading ? 'Loading…' : 'No Windows app is connected.'))))),
          t.div({ className: 'field-help' }, 'Apps in contact within the last 90 seconds.'))),
      t.p({ className: 'txt-hint txt-sm' }, 'Traffic counts every Odyle route, the dashboard\'s reads included, per minute in server memory only; a restart starts it over, and requests refused before Odyle handles them (no sign-in) are not counted. The page refreshes every 10 seconds.')));
}

// What each background job does; the backend's odyle/jobs.go holds the schedules and the records.
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
