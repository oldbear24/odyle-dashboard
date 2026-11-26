// Odyle pages of the PocketBase superuser dashboard, imported by main.js: the Windows
// apps connected right now and the requests ("packets") the apps and the dashboard
// send as they arrive, the server's status with the last hour's traffic, the background
// jobs, the game settings, the server controls, the armory AI's knowledge base and the audit log
// of what superusers did.
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
  { href: '#/odyle/knowledge', icon: 'ri-book-open-line', label: 'AI knowledge' },
  { href: '#/odyle/audit', icon: 'ri-file-list-3-line', label: 'Audit log' },
];
const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const timestamp = value => Date.parse(String(value || '').replace(' ', 'T'));
const number = value => (typeof value === 'number' ? value.toLocaleString() : '?');
// PLAYNC's search regions (the armory's) by the Odyle region they belong to.
const searchRegions = { nae: 'NA', naw: 'NAW', eu: 'EU', la: 'SA', as: 'Asia' };
const region = value =>
  searchRegions[value] ||
  String(value || '')
    .replace('GLOBAL_', '')
    .replace('ASIA', 'Asia');
const capital = text => text.charAt(0).toUpperCase() + text.slice(1);
function ago(at, now) {
  const seconds = Math.max(0, Math.floor((now - timestamp(at)) / 1000));
  if (!Number.isFinite(seconds)) return '—';
  return seconds < 60
    ? seconds + 's ago'
    : seconds < 3600
      ? Math.floor(seconds / 60) + 'm ago'
      : seconds < 86400
        ? Math.floor(seconds / 3600) + 'h ago'
        : Math.floor(seconds / 86400) + 'd ago';
}
const clock = at => (Number.isFinite(timestamp(at)) ? new Date(timestamp(at)).toLocaleTimeString() : '');
const when = at => (Number.isFinite(timestamp(at)) ? new Date(timestamp(at)).toLocaleString() : '');
// Today's date, so the local time follows summer and winter time.
const localHour = (hour, minute = 0) =>
  new Date(new Date().setUTCHours(hour, minute, 0, 0)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const copy = value => JSON.parse(JSON.stringify(value));
// datetime-local inputs hold the browser's local time to the minute; the API takes and answers UTC.
const localInput = value => {
  const at = timestamp(value);
  return Number.isFinite(at) ? new Date(at - new Date(at).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
};
const fromLocal = value => (value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : '');
// Row keys: the backend writes Go maps with sorted keys and its own objects in the order
// it built them, so rows are compared by sorted keys and key order never counts as a change.
const signature = value =>
  value && typeof value === 'object'
    ? '{' +
      Object.keys(value)
        .sort()
        .map(key => key + ':' + signature(value[key]))
        .join(',') +
      '}'
    : String(value);
// The companion sends a heartbeat every 20 seconds. As on the dashboard (src/model.js),
// 45 seconds without contact is late and 90 seconds is offline.
function contact(at, now) {
  const age = now - timestamp(at);
  return !(age < 90000) ? 'offline' : age >= 45000 ? 'late' : 'online';
}
const contactLabels = { online: 'Online', late: 'Late', offline: 'Offline' };
// What a Windows app's reader reports with its heartbeat (backend/odyle/health.go).
const readerLabels = {
  waiting: 'no game connection',
  listening: 'listening, no Odyle yet',
  midstream: 'started after login',
  reading: 'reading Odyle',
  problem: 'capture problem',
  npcap: 'Npcap missing',
  'two-clients': 'two game clients',
  paused: 'paused by the server',
  stopped: 'stopped by hand',
};
function reading(c, now) {
  if (!c) return { state: 'waiting', label: 'Waiting for the game' };
  if (!c.confirmed) return { state: 'waiting', label: 'Named, no reading yet' };
  return c.valid && now - timestamp(c.lastSeenAt) < 45000
    ? { state: 'live', label: 'Live reading' }
    : { state: 'stale', label: 'Stale' };
}
// Windows app versions are numbers like 0.6.0.12; a development build ends in .0.
function older(version, latest) {
  if (!version || !latest) return false;
  const a = version.split('.').map(Number),
    b = latest.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0);
  return false;
}
// Newest first; a version the app did not send ('') last.
const byVersion = (a, b) => (!a ? 1 : !b ? -1 : older(a, b) ? 1 : older(b, a) ? -1 : 0);
const place = p =>
  [p.characterName, p.server ? p.server + (p.region ? ' (' + region(p.region) + ')' : '') : '']
    .filter(Boolean)
    .join(' · ');
const room = p => p.roomName || (p.roomId ? 'room ' + p.roomId : 'a room');
const named = (text, name) => (name ? text + ': ' + name : text);
function describe(p) {
  switch (p.kind) {
    case 'report':
      return (
        (place(p) || 'Character') +
        ' → ' +
        number(p.value) +
        ' Odyle · #' +
        (p.sequence ?? '?') +
        ' · ' +
        (p.parserVersion || 'no adapter')
      );
    case 'heartbeat':
      return p.characterId ? (p.characterName || p.characterId) + ' still in game' : 'App alive, no character in game';
    case 'session':
      return (
        (p.previousSessionId ? 'Reader session renewed, replaces ' + p.previousSessionId : 'New reader session') +
        (p.appVersion ? ' · app ' + p.appVersion : '')
      );
    case 'invalidate':
      return (p.characterName || p.characterId || 'Character') + ' marked stale';
    case 'character':
      return (place(p) || 'Character') + ' saved';
    case 'pair':
      return named('PC paired', p.name);
    case 'desktop-sign-in':
      return named('Paired PC signed in', p.name);
    case 'unpair':
      return 'PC disconnected its pairing';
    case 'create':
      return named('Room created', p.name);
    case 'join':
      return 'Joined a room with an invite';
    case 'rename':
      return named('Room renamed', p.name);
    case 'leave':
      return 'Left ' + room(p);
    case 'close':
      return 'Closed ' + room(p);
    case 'invite-create':
      return 'New ' + (p.role === 'viewer' ? 'viewer' : 'player') + ' invite link for ' + room(p);
    case 'invite-revoke':
      return 'Revoked an invite link of ' + room(p);
    case 'invite-preview':
      return 'Invite link opened';
    case 'revoke':
      return 'Removed a member from ' + room(p);
    case 'role':
      return 'Made a member ' + (p.role === 'viewer' ? 'viewer' : 'player') + ' in ' + room(p);
    case 'transfer':
      return 'Handed ' + room(p) + ' to another member';
    case 'sharing':
      return (p.characterName || 'All characters') + (p.enabled ? ' shared with ' : ' unshared from ') + room(p);
    case 'wishlist':
      return (
        (p.everyone ? 'Cleared ' : p.wanted ? 'Wished for ' : 'Unwished ') +
        (p.dungeon || 'a dungeon') +
        ' in ' +
        room(p)
      );
    case 'plan':
      return (
        (!p.runId
          ? named('Run planned', p.dungeon)
          : p.remove
            ? 'Run removed'
            : typeof p.going === 'boolean'
              ? p.going
                ? 'Going to a run'
                : 'Not going to a run'
              : 'Run changed') +
        ' in ' +
        room(p)
      );
    case 'discord-webhook':
      return 'Discord reminders set for ' + room(p);
    case 'task':
      return !p.taskId
        ? 'Task added'
        : p.remove
          ? 'Task removed'
          : typeof p.done === 'boolean'
            ? p.done
              ? 'Task ticked'
              : 'Task unticked'
            : p.move
              ? 'Task moved ' + p.move
              : 'Task renamed';
    case 'profile':
      return named('Display name changed', p.displayName);
    case 'desktop-code':
      return 'Connection link for a new PC';
    case 'forget-device':
      return 'Paired PC removed';
    case 'sign-out-everywhere':
      return 'Signed out everywhere';
    case 'delete-account':
      return 'Account deleted';
    case 'delete-character':
      return (p.characterName || 'Character') + ' deleted';
    default:
      return p.kind;
  }
}
const kindClass = {
  report: 'success',
  session: 'info',
  character: 'info',
  pair: 'info',
  create: 'info',
  invalidate: 'warning',
  unpair: 'warning',
  close: 'warning',
  'forget-device': 'warning',
  'sign-out-everywhere': 'warning',
  'delete-account': 'warning',
  'delete-character': 'warning',
};
// The server names each packet's source: the Windows app ('app') or the dashboard ('web').
const filters = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'app', label: 'Windows app', test: p => p.source === 'app' },
  { id: 'web', label: 'Dashboard', test: p => p.source === 'web' },
  { id: 'rejected', label: 'Rejected', test: p => !p.ok },
];
// A packet's fields in a fixed order, whatever order the backend added them in: its own
// first, then the request's safe fields by name.
const first = ['id', 'at', 'kind', 'source', 'ok', 'ms', 'error', 'account', 'user'];
const fields = p =>
  first
    .filter(key => key in p)
    .concat(
      Object.keys(p)
        .filter(key => !first.includes(key) && key !== 'fresh')
        .sort(),
    )
    .map(key => [key, p[key]]);
const plain = p => Object.fromEntries(fields(p));

// The apps, status, jobs and audit pages use PocketBase's wide wrapper; the forms keep the narrow one.
const wide = ['#/odyle', '#/odyle/status', '#/odyle/jobs', '#/odyle/knowledge', '#/odyle/audit'];
function layout(active, actions, ...content) {
  return t.div(
    { className: 'page odyle-page' },
    app.components.pageSidebar(
      { className: 'odyle-sidebar' },
      t.nav(
        { className: 'sidebar-content scrollable' },
        t.details(
          { className: 'nav-group', open: true },
          t.summary({ tabIndex: -1, onclick: () => false }, 'Odyle'),
          pages.map(p =>
            t.a(
              { href: p.href, className: 'nav-item' + (p.href === active ? ' active' : '') },
              t.i({ className: p.icon, ariaHidden: true }),
              t.span({ className: 'txt' }, p.label),
            ),
          ),
        ),
      ),
    ),
    t.div(
      { className: 'page-content full-height' },
      t.header(
        { className: 'page-header' },
        t.nav(
          { className: 'breadcrumbs' },
          t.div({ className: 'breadcrumb-item' }, 'Odyle'),
          t.div({ className: 'breadcrumb-item' }, () => app.store.title),
        ),
        actions,
      ),
      t.div({ className: 'wrapper m-b-base' + (wide.includes(active) ? ' lg' : '') }, ...content),
      t.footer({ className: 'page-footer' }, app.components.credits()),
    ),
  );
}
const stat = (label, value, hint) =>
  t.div(
    { className: 'odyle-stat' },
    t.span({ className: 'txt-hint txt-sm' }, label),
    t.strong(null, value),
    t.span({ className: 'txt-hint txt-sm' }, hint),
  );
const toggle = (id, label, checked, onchange) =>
  t.div(
    { className: 'field odyle-toggle' },
    t.input({ id, type: 'checkbox', className: 'switch', checked, onchange: e => onchange(e.target.checked) }),
    t.label({ htmlFor: id }, label),
  );
const field = (id, label, input, help, width = 4) =>
  t.div(
    { className: 'col-lg-' + width },
    t.div({ className: 'field' }, t.label({ htmlFor: id }, label), input),
    t.div({ className: 'field-help' }, help),
  );
const section = (title, hint) =>
  t.div(
    { className: 'col-lg-12 odyle-section' },
    t.div({ className: 'txt-lg' }, title),
    hint ? t.p({ className: 'txt-hint' }, hint) : null,
  );

// Links from the Server status page open this page filtered: #/odyle?kind=report&filter=rejected
// (and account=<user id>).
export function monitorPage(route) {
  app.store.title = 'Apps & packets';
  const query = name => route?.query?.[name]?.[0] || '';
  // feed is always current; frozen holds what is shown while the list is paused. open is
  // the packet whose fields are shown.
  // updated is the server's answer to the last Update all apps now, updateFailed why it failed.
  const state = store({
    loading: true,
    failed: '',
    apps: [],
    latestVersion: '',
    feed: [],
    frozen: null,
    heartbeats: true,
    offset: 0,
    now: Date.now(),
    open: 0,
    filter: filters.some(f => f.id === query('filter')) ? query('filter') : 'all',
    kind: query('kind'),
    account: query('account'),
    search: '',
    updating: false,
    updated: null,
    updateFailed: '',
  });
  const now = () => state.now + state.offset;
  let alive = true,
    poll = 0,
    tick = 0,
    unsubscribe = null;
  async function load() {
    try {
      const data = await app.pb.send('/api/odyle/admin/monitor', { requestKey: null });
      // A signed-out dashboard can hand back an error body; only a full answer replaces the lists.
      if (Array.isArray(data?.apps) && Array.isArray(data.packets)) {
        state.offset = timestamp(data.serverNow) - Date.now();
        state.apps = data.apps;
        state.latestVersion = data.latestVersion || '';
        // The server keeps the newest 200; its list replaces whatever realtime added since.
        state.feed = data.packets.slice().reverse();
        state.failed = '';
      }
    } catch (error) {
      if (!error.isAbort) state.failed = error.message || 'The monitor could not be loaded.';
    }
    state.loading = false;
  }
  function arrive(packet) {
    if (!packet || state.feed.some(p => p.id === packet.id)) return;
    state.feed = [{ ...packet, fresh: true }, ...state.feed].slice(0, 200);
  }
  const chosen = () => filters.find(f => f.id === state.filter) || filters[0];
  // The search matches the shown text and every field's value, ids and adapter names included.
  const words = () => state.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const text = p =>
    [describe(p), ...Object.values(p).filter(v => typeof v === 'string' || typeof v === 'number')]
      .join(' ')
      .toLowerCase();
  const matches = p =>
    (state.heartbeats || p.kind !== 'heartbeat' || !p.ok || state.kind === 'heartbeat') &&
    chosen().test(p) &&
    (!state.kind || p.kind === state.kind) &&
    (!state.account || p.user === state.account) &&
    words().every(word => text(p).includes(word));
  const shown = () => (state.frozen || state.feed).filter(matches);
  const narrowed = () => state.kind || state.account || words().length || state.filter !== 'all' || !state.heartbeats;
  const waiting = () => (state.frozen ? state.feed.filter(p => p.id > (state.frozen[0]?.id || 0)).length : 0);
  const recent = () => state.feed.filter(p => now() - timestamp(p.at) < 60000);
  const outdated = () =>
    state.apps.filter(a => contact(a.lastContactAt, now()) !== 'offline' && older(a.appVersion, state.latestVersion));
  const accountName = () =>
    state.feed.find(p => p.user === state.account)?.account ||
    state.apps.find(a => a.user === state.account)?.account ||
    state.account;
  const feed = () => document.querySelector('.odyle-feed-head')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const onlyAccount = user => {
    state.account = user;
    feed();
  };
  // The shown packets, oldest first like the API, with the filters that chose them.
  function exportShown() {
    const packets = shown().slice().reverse().map(plain);
    app.utils.downloadJSON(
      {
        exportedAt: new Date().toISOString(),
        server: location.origin,
        filters: {
          source: state.filter,
          kind: state.kind,
          account: state.account,
          search: state.search.trim(),
          heartbeats: state.heartbeats,
        },
        packets,
      },
      'odyle-packets-' + new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-'),
    );
  }
  // Update all apps now (backend/odyle/releases.go): every connected Windows app older than the
  // newest release the server knows downloads it, installs it and restarts; the others do
  // nothing. The server counts every realtime connection it told, dashboards in browsers included.
  const updateHint = () =>
    (state.latestVersion
      ? 'Every connected Windows app older than ' + state.latestVersion + ' downloads it and restarts.'
      : 'Every connected Windows app looks up the newest release and, if it is newer, downloads it and restarts.') +
    ' The reader hands the live character over.';
  const connections = n => number(n) + (n === 1 ? ' connection' : ' connections');
  function updateApps() {
    app.modals.confirm(
      'Update all Windows apps now? ' +
        updateHint() +
        ' Apps not running now install new releases at their next start anyway.',
      async () => {
        state.updating = true;
        state.updateFailed = '';
        try {
          state.updated = await app.pb.send('/api/odyle/admin/update-apps', { method: 'POST', requestKey: null });
        } catch (error) {
          state.updated = null;
          if (!error.isAbort) state.updateFailed = error.message || 'The apps could not be asked to update.';
        }
        state.updating = false;
      },
      null,
      { yesButton: 'Update all apps' },
    );
  }
  const updated = () =>
    'Sent to ' +
    connections(state.updated.told) +
    ' · ' +
    (state.updated.version
      ? 'apps older than ' + state.updated.version + ' update now'
      : 'apps look up the newest release and update if it is newer');
  const chip = (label, value, clear) =>
    t.span(
      { className: 'label sm odyle-chip' },
      t.span({ className: 'txt-hint' }, label),
      ' ',
      value,
      t.button(
        {
          type: 'button',
          className: 'odyle-chip-clear',
          title: 'Clear',
          ariaLabel: 'Clear ' + label.toLowerCase(),
          onclick: clear,
        },
        t.i({ className: 'ri-close-line', ariaHidden: true }),
      ),
    );

  const version = a =>
    !a.appVersion
      ? t.span({ className: 'txt-hint', title: 'Older Windows apps do not send their version' }, '—')
      : [
          t.div({ className: 'txt-code' }, a.appVersion),
          older(a.appVersion, state.latestVersion)
            ? t.span(
                { className: 'label sm warning', title: 'Newest release: ' + state.latestVersion },
                'update available',
              )
            : state.latestVersion
              ? t.span({ className: 'txt-hint txt-sm' }, 'newest')
              : null,
        ];
  // Rows are keyed by session and content: an unchanged row is kept as it is, a changed one
  // is redrawn in its place. Only the status and ages tick every second.
  const readerLine = a =>
    a.reader
      ? t.div(
          { className: 'txt-hint txt-sm', title: 'since ' + when(a.reader.since) },
          (readerLabels[a.reader.status] || a.reader.status) + (a.reader.game ? ' · ' + a.reader.game : ''),
        )
      : null;
  const appRow = a =>
    t.tr(
      { rid: signature(a) + '@' + state.latestVersion },
      t.td(
        null,
        t.span(
          { className: () => 'odyle-status ' + contact(a.lastContactAt, now()) },
          () => contactLabels[contact(a.lastContactAt, now())],
        ),
      ),
      t.td(
        null,
        t.button(
          {
            type: 'button',
            className: 'odyle-link txt-bold',
            title: "Show only this account's packets",
            onclick: () => onlyAccount(a.user),
          },
          a.account || '—',
        ),
        a.device ? t.div({ className: 'txt-sm' }, a.device) : null,
        t.div({ className: 'txt-hint txt-sm txt-code' }, a.sessionId),
      ),
      t.td({ className: 'txt-nowrap' }, version(a), readerLine(a)),
      // A character belongs to the session that read it last, so older sessions lose it.
      t.td(
        null,
        a.character
          ? [
              t.div(null, place(a.character)),
              t.span(
                { className: () => 'odyle-reading ' + reading(a.character, now()).state },
                () => reading(a.character, now()).label,
              ),
            ]
          : () =>
              contact(a.lastContactAt, now()) === 'offline'
                ? t.span({ className: 'txt-hint' }, '—')
                : t.span({ className: 'odyle-reading waiting' }, 'Waiting for the game'),
      ),
      t.td(
        { className: 'txt-right' },
        a.character?.confirmed
          ? [
              t.div({ className: 'txt-bold' }, number(a.character.value)),
              t.div({ className: 'txt-hint txt-sm' }, () => 'changed ' + ago(a.character.lastReadingAt, now())),
            ]
          : '—',
      ),
      t.td(
        { className: 'txt-nowrap odyle-age' },
        t.div(null, () => ago(a.lastContactAt, now())),
        t.div(
          { className: 'txt-hint txt-sm', title: when(a.connectedAt) },
          () => 'connected ' + ago(a.connectedAt, now()),
        ),
      ),
      t.td({ className: 'txt-right' }, number(a.readings)),
    );
  // Every field of one packet, with shortcuts to the packets like it.
  const value = (key, v) => (key === 'at' ? when(v) + ' · ' + v : key === 'ms' ? v + ' ms' : String(v));
  const detail = p =>
    t.div(
      { className: 'odyle-packet-detail', onclick: e => e.stopPropagation() },
      t.dl(
        { className: 'odyle-fields' },
        fields(p).flatMap(([key, v]) => [
          t.dt({ className: 'txt-hint' }, key),
          t.dd({ className: key === 'error' ? 'txt-danger' : '' }, value(key, v)),
        ]),
      ),
      t.div(
        { className: 'flex odyle-detail-actions' },
        p.user
          ? t.button(
              {
                type: 'button',
                className: 'btn sm secondary',
                disabled: () => state.account === p.user,
                onclick: () => (state.account = p.user),
              },
              t.i({ className: 'ri-user-line', ariaHidden: true }),
              t.span({ className: 'txt' }, 'Only this account'),
            )
          : null,
        t.button(
          {
            type: 'button',
            className: 'btn sm secondary',
            disabled: () => state.kind === p.kind,
            onclick: () => (state.kind = p.kind),
          },
          t.i({ className: 'ri-filter-line', ariaHidden: true }),
          t.span({ className: 'txt' }, 'Only ' + p.kind),
        ),
        t.button(
          {
            type: 'button',
            className: 'btn sm transparent secondary',
            onclick: async () => {
              await app.utils.copyToClipboard(JSON.stringify(plain(p), null, 2));
              app.toasts.success('Packet ' + p.id + ' copied as JSON.');
            },
          },
          t.i({ className: 'ri-file-copy-line', ariaHidden: true }),
          t.span({ className: 'txt' }, 'Copy JSON'),
        ),
      ),
    );
  // Packets never change, so rows are keyed and kept: only new ones are drawn (and flash).
  // A click opens the packet's fields, unless it selected text to copy.
  const expand = p => {
    if (!String(window.getSelection?.() || '')) state.open = state.open === p.id ? 0 : p.id;
  };
  const packetRow = p =>
    t.div(
      {
        rid: p.id + '@' + p.at,
        className: () =>
          'odyle-packet' + (p.ok ? '' : ' rejected') + (p.fresh ? ' fresh' : '') + (state.open === p.id ? ' open' : ''),
        onclick: () => expand(p),
      },
      t.span({ className: 'txt-hint', title: when(p.at) }, clock(p.at)),
      t.button(
        {
          type: 'button',
          className: 'label sm odyle-kind ' + (p.ok ? kindClass[p.kind] || '' : 'danger'),
          title: 'Show only ' + p.kind + ' packets',
          onclick: e => {
            e.stopPropagation();
            state.kind = p.kind;
          },
        },
        p.ok ? p.kind : p.kind + ' rejected',
      ),
      p.user
        ? t.button(
            {
              type: 'button',
              className: 'odyle-link txt-bold txt-ellipsis',
              title: 'Show only ' + (p.account || 'this account') + "'s packets",
              onclick: e => {
                e.stopPropagation();
                state.account = p.user;
              },
            },
            p.account || '—',
          )
        : t.span({ className: 'txt-hint' }, '—'),
      t.button(
        {
          type: 'button',
          className: 'odyle-packet-text',
          ariaExpanded: () => state.open === p.id,
          title: 'Show every field',
          onclick: e => {
            e.stopPropagation();
            expand(p);
          },
        },
        describe(p),
        p.ok ? null : t.span({ className: 'txt-danger' }, ' — ' + p.error),
      ),
      t.span({ className: 'odyle-packet-ms txt-hint txt-nowrap' }, number(p.ms) + ' ms'),
      () => (state.open === p.id ? detail(p) : null),
    );
  const heads = ['Status', 'Account', 'App', 'Game', 'Odyle', 'Last contact', 'Readings'];

  return layout(
    '#/odyle',
    app.components.refreshButton({ onclick: load }),
    t.div(
      {
        className: 'odyle-monitor',
        onmount: async () => {
          load();
          poll = setInterval(load, 5000);
          tick = setInterval(() => (state.now = Date.now()), 1000);
          try {
            const stop = await app.pb.realtime.subscribe('odyle.admin.packets', e => arrive(e.packet));
            if (alive) unsubscribe = stop;
            else stop();
          } catch (error) {
            console.warn('Odyle live packets unavailable, the list refreshes every 5 seconds:', error);
          }
        },
        onunmount: () => {
          alive = false;
          clearInterval(poll);
          clearInterval(tick);
          unsubscribe?.();
        },
      },
      () => (state.failed ? t.div({ className: 'alert danger m-b-sm' }, state.failed) : null),
      t.div(
        { className: 'odyle-stats m-b-base' },
        stat(
          'Apps online',
          () => number(state.apps.filter(a => contact(a.lastContactAt, now()) === 'online').length),
          () =>
            number(state.apps.length) + (state.apps.length === 1 ? ' reader session open' : ' reader sessions open'),
        ),
        stat(
          'Reading the game',
          () =>
            number(
              state.apps.filter(
                a => contact(a.lastContactAt, now()) === 'online' && reading(a.character, now()).state === 'live',
              ).length,
            ),
          'live Odyle readings',
        ),
        stat(
          'Newest Windows app',
          () => state.latestVersion || '—',
          () =>
            outdated().length
              ? number(outdated().length) +
                (outdated().length === 1 ? ' connected app is older' : ' connected apps are older')
              : 'no connected app is older',
        ),
        stat(
          'Packets last minute',
          () => number(recent().length),
          () => number(recent().filter(p => p.kind === 'report' && p.ok).length) + ' readings saved',
        ),
        stat(
          'Rejected',
          () => number(state.feed.filter(p => !p.ok).length),
          () => 'of the last ' + number(state.feed.length) + ' packets',
        ),
      ),
      t.div(
        { className: 'flex m-b-sm odyle-apps-head' },
        t.div({ className: 'txt-lg' }, 'Connected apps'),
        t.span({ className: 'txt-hint txt-sm' }, 'one row per running Windows app (reader session), by account'),
        t.div({ className: 'm-r-auto' }),
        t.button(
          {
            type: 'button',
            className: () => 'btn sm secondary' + (state.updating ? ' loading' : ''),
            disabled: () => state.updating,
            title: 'Ask every connected Windows app to update to the newest release and restart',
            onclick: updateApps,
          },
          t.i({ className: 'ri-download-cloud-2-line', ariaHidden: true }),
          t.span({ className: 'txt' }, 'Update all apps now'),
        ),
      ),
      t.div(
        { className: 'flex m-b-sm odyle-update' },
        t.span({ className: 'txt-hint txt-sm' }, () => updateHint()),
        () =>
          state.updateFailed
            ? t.span({ className: 'txt-sm txt-danger odyle-update-result' }, state.updateFailed)
            : state.updated
              ? t.span({ className: 'txt-sm txt-bold odyle-update-result' }, updated())
              : null,
      ),
      t.div(
        { className: 'odyle-table m-b-base' },
        t.table(
          null,
          t.thead(
            null,
            t.tr(null, ...heads.map(h => t.th({ className: h === 'Odyle' || h === 'Readings' ? 'txt-right' : '' }, h))),
          ),
          t.tbody(null, () =>
            state.apps.length
              ? state.apps.map(appRow)
              : t.tr(
                  null,
                  t.td({ colSpan: heads.length, className: 'txt-hint txt-center' }, () =>
                    state.loading ? 'Loading…' : 'No Windows app is connected.',
                  ),
                ),
          ),
        ),
      ),
      t.div(
        { className: 'flex m-b-sm odyle-feed-head' },
        t.div({ className: 'txt-lg' }, 'Packet flow'),
        t.span({ className: () => 'odyle-live ' + (state.frozen ? 'paused' : '') }, () =>
          state.frozen ? 'Paused' : 'Live',
        ),
        t.div(
          { className: 'odyle-filters' },
          filters.map(f =>
            t.button(
              {
                type: 'button',
                className: () => 'btn sm ' + (state.filter === f.id ? 'secondary' : 'transparent'),
                onclick: () => (state.filter = f.id),
              },
              t.span({ className: 'txt' }, f.label),
            ),
          ),
        ),
        t.div({ className: 'm-r-auto' }),
        toggle(
          'odyle-heartbeats',
          'Heartbeats',
          () => state.heartbeats,
          checked => (state.heartbeats = checked),
        ),
        t.button(
          {
            type: 'button',
            className: 'btn sm secondary',
            onclick: () => (state.frozen = state.frozen ? null : state.feed.slice()),
          },
          t.i({ className: () => (state.frozen ? 'ri-play-line' : 'ri-pause-line'), ariaHidden: true }),
          t.span({ className: 'txt' }, () =>
            state.frozen ? 'Resume' + (waiting() ? ' (' + number(waiting()) + ' new)' : '') : 'Pause',
          ),
        ),
      ),
      t.div(
        { className: 'flex m-b-sm odyle-feed-tools' },
        t.div(
          { className: 'odyle-search' },
          t.i({ className: 'ri-search-line txt-hint', ariaHidden: true }),
          t.input({
            type: 'search',
            id: 'odyle-search',
            placeholder: 'Search packets: account, character, room, error, id…',
            ariaLabel: 'Search packets',
            value: () => state.search,
            oninput: e => (state.search = e.target.value),
          }),
        ),
        () => (state.kind ? chip('Kind', state.kind, () => (state.kind = '')) : null),
        () => (state.account ? chip('Account', accountName(), () => (state.account = '')) : null),
        t.div({ className: 'm-r-auto' }),
        t.span({ className: 'txt-hint txt-sm txt-nowrap' }, () =>
          narrowed()
            ? number(shown().length) + ' of ' + number((state.frozen || state.feed).length) + ' packets'
            : number(shown().length) + ' packets',
        ),
        t.button(
          {
            type: 'button',
            className: 'btn sm transparent secondary',
            disabled: () => !shown().length,
            title: 'The packets shown, as JSON',
            onclick: exportShown,
          },
          t.i({ className: 'ri-download-line', ariaHidden: true }),
          t.span({ className: 'txt' }, 'Export'),
        ),
      ),
      t.div({ className: 'odyle-feed' }, () =>
        shown().length
          ? shown().map(packetRow)
          : t.div({ className: 'odyle-packet txt-hint' }, () =>
              state.loading
                ? 'Loading…'
                : state.feed.length
                  ? 'No packets match these filters.'
                  : 'No packets since the server started.',
            ),
      ),
      t.p(
        { className: 'txt-hint txt-sm m-t-sm' },
        "Packets are Odyle's own requests: from the Windows app reader sessions, Odyle readings, heartbeats every 20 seconds, stale marks, character saves and pairings; from the dashboard every room, sharing, wishlist, run, task and account change. Click a packet for all its fields, its kind or account to show only those. Only safe fields are kept (never tokens, codes, keys, webhooks, notes or task titles). The newest 200 are kept in server memory only and a restart clears them; game traffic itself never reaches the server.",
      ),
    ),
  );
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
function ceiling(value) {
  for (let power = 1; ; power *= 10)
    for (const step of [2, 4, 6, 8, 10]) if (step * power >= value) return step * power;
}
const duration = ms => {
  const m = Math.floor(ms / 60000);
  return !(m >= 1)
    ? Math.max(0, Math.floor(ms / 1000) || 0) + 's'
    : m < 60
      ? m + 'm'
      : m < 1440
        ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm'
        : Math.floor(m / 1440) + 'd ' + Math.floor((m % 1440) / 60) + 'h';
};
const millis = ms =>
  typeof ms !== 'number'
    ? '—'
    : ms < 1000
      ? number(ms) + ' ms'
      : (ms / 1000).toLocaleString([], { maximumFractionDigits: 1 }) + ' s';
const share = (part, whole) =>
  whole ? ((part / whole) * 100).toLocaleString([], { maximumFractionDigits: 1 }) + ' %' : '—';
const minuteLabel = at =>
  Number.isFinite(timestamp(at))
    ? new Date(timestamp(at)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';
// Packet routes link to the packet list, filtered; reads are never listed as packets.
const packets = (kind, extra = '') => '#/odyle?kind=' + encodeURIComponent(kind) + extra;
// The stored days' columns (odyle-stats job, backend/odyle/stats.go).
const dayHeads = [
  ['day', 'Day'],
  ['accounts', 'Accounts'],
  ['activeAccounts', 'Active 24 h'],
  ['pairedAccounts', 'Paired'],
  ['readingAccounts', 'Reading'],
  ['sharingAccounts', 'Sharing'],
  ['roomsReading', 'Rooms together'],
  ['readings', 'Odyle changes'],
  ['roomsWithRuns', 'Rooms with runs'],
  ['wishlistEntries', 'Wishes'],
  ['taskAccounts', 'With tasks'],
  ['discordRooms', 'Discord'],
];
// A daily backup schedule ("minute hour * * *", UTC) in words; any other as PocketBase takes it.
function schedule(cron) {
  const daily = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(cron || '');
  return !cron ? 'Off' : daily ? 'Daily ' + daily[2].padStart(2, '0') + ':' + daily[1].padStart(2, '0') + ' UTC' : cron;
}

export function statusPage() {
  app.store.title = 'Server status';
  const empty = {
    serverNow: '',
    startedAt: '',
    build: {},
    runtime: {},
    database: {},
    counts: {},
    release: {},
    versions: [],
    traffic: { minutes: [], total: { count: 0, rejected: 0 }, routes: [], errors: [], private: 0 },
    activation: { now: {}, days: [] },
    backups: {},
    storage: {},
    proxy: { headers: [] },
  };
  // hover is the minute (its time) the chart's tooltip shows.
  const state = store({
    loading: true,
    failed: '',
    data: empty,
    offset: 0,
    now: Date.now(),
    hover: '',
    profiling: '',
    vacuuming: '',
    refreshing: false,
  });
  const now = () => state.now + state.offset;
  let poll = 0,
    tick = 0;
  async function load() {
    try {
      const data = await app.pb.send('/api/odyle/admin/status', { requestKey: null });
      if (Array.isArray(data?.traffic?.minutes)) {
        state.offset = timestamp(data.serverNow) - Date.now();
        state.data = data;
        state.failed = '';
      }
    } catch (error) {
      if (!error.isAbort) state.failed = error.message || 'The server status could not be loaded.';
    }
    state.loading = false;
  }
  const traffic = () => state.data.traffic,
    minutes = () => traffic().minutes,
    total = m => series.reduce((sum, s) => sum + m[s.id], 0);
  const top = () => ceiling(Math.max(0, ...minutes().map(total)));
  const busiest = () => Math.max(0, ...minutes().map(total));
  // Per minute over the hour, or over the minutes since a server start less than an hour ago.
  const perMinute = () =>
    traffic().total.count /
    Math.min(60, Math.max(1, Math.ceil((now() - timestamp(state.data.startedAt)) / 60000)) || 60);
  const counts = name => state.data.counts[name] || {};
  const latest = () => state.data.release.version || '';
  const reached = () => state.data.activation?.now || {},
    days = () => state.data.activation?.days || [];
  const backups = () => state.data.backups || {},
    storage = () => state.data.storage || {},
    proxy = () => state.data.proxy || { headers: [] };
  const readers = () =>
    state.data.readers || {
      reporting: 0,
      connected: 0,
      stuck: 0,
      statuses: {},
      games: [],
      refusedAdapters: [],
      alerts: false,
    };
  const clock = () => readers().clock || { checked: 0, matched: 0, checkedToday: 0, missedToday: 0 };
  const armory = () =>
    state.data.armory || {
      profiles: 0,
      hidden: 0,
      waiting: 0,
      fetching: false,
      done: 0,
      failed: 0,
      lastAt: '',
      lastError: '',
      lastErrorAt: '',
      blockedUntil: '',
      paused: false,
      images: 0,
      imageBytes: 0,
    };
  // The armory's queue: the lookups running (with how far they got) and waiting, readers' and the scout's.
  const lanes = () => armory().lanes || { readers: 1, scouts: 0 };
  const queue = () => armory().queue || [];
  const queueRow = q =>
    t.tr(
      { rid: q.state + q.serverId + '/' + q.characterId },
      t.td(
        null,
        q.state === 'fetching'
          ? t.span({ className: 'label sm success' }, 'running' + (q.progress ? ' · ' + q.progress.percent + '%' : ''))
          : t.span({ className: 'label sm' }, 'waiting #' + number(q.position)),
      ),
      t.td(null, q.name || t.span({ className: 'txt-hint txt-code' }, q.characterId)),
      t.td(null, (q.server || q.serverId) + ' · ' + q.region),
      t.td(null, q.scout ? 'Armory scout' : 'a reader'),
      t.td({ className: 'txt-nowrap' }, () => ago(q.since, now())),
    );
  // What the Armory scout still reads of PLAYNC: the top players' gear, the strongest first, and
  // the characters its searches found, for their combat power (the first 20 of each).
  const scout = () =>
    armory().scout || {
      builds: 0,
      neverBuilt: 0,
      buildQueue: [],
      checks: 0,
      checkQueue: [],
      own: 0,
      names: 0,
      nameQueue: [],
      level: 0,
      buildEvery: 0,
      lastBuildAt: '',
    };
  const span = seconds =>
    seconds < 5400
      ? Math.max(1, Math.round(seconds / 60)) + ' minutes'
      : seconds < 172800
        ? Math.round(seconds / 3600) + ' hours'
        : Math.round(seconds / 86400) + ' days';
  // PLAYNC's ids begin alike for every character of a server: an id is told apart by its end.
  const pendingName = c =>
    c.name ||
    t.span(
      { className: 'txt-hint odyle-id', title: c.characterId },
      c.characterId.length > 12 ? '…' + c.characterId.slice(-12) : c.characterId,
    );
  const pendingServer = c => (c.server || c.serverId) + ' · ' + region(c.region);
  const buildRow = (c, i) =>
    t.tr(
      { rid: i + '@' + signature(c) },
      t.td({ className: 'txt-right txt-hint' }, number(i + 1)),
      t.td(null, pendingName(c)),
      t.td(null, c.class),
      t.td({ className: 'txt-nowrap' }, pendingServer(c)),
      t.td({ className: 'txt-right' }, number(c.combatPower)),
      t.td(
        { className: 'txt-nowrap' },
        c.builtAt ? () => 'read ' + ago(c.builtAt, now()) : t.span({ className: 'label sm' }, 'never read'),
      ),
    );
  const checkRow = (c, i) =>
    t.tr(
      { rid: i + '@' + signature(c) },
      t.td({ className: 'txt-right txt-hint' }, number(i + 1)),
      t.td({ className: 'txt-nowrap' }, pendingName(c)),
      t.td({ className: 'txt-nowrap' }, pendingServer(c)),
      t.td(
        { className: 'txt-nowrap' },
        c.combatPower ? number(c.combatPower) + ' · 30+ days old' : t.span({ className: 'txt-hint' }, 'not yet'),
      ),
    );
  const nameRow = (n, i) =>
    t.tr(
      { rid: i + '@' + signature(n) },
      t.td({ className: 'txt-right txt-hint' }, number(i + 1)),
      t.td({ className: 'txt-nowrap' }, n.name),
      t.td({ className: 'txt-nowrap' }, n.server + ' · ' + region(n.region)),
    );
  const buildPace = () =>
    armory().paused
      ? 'paused with the armory'
      : !scout().buildEvery
        ? 'no scout lanes under Server controls, so none is read'
        : (lanes().scouts > 1
            ? number(lanes().scouts) + ' at once, each lane one every 3 minutes'
            : 'one every 3 minutes') +
          ' while no reader waits' +
          (scout().builds ? ', all in about ' + span(scout().builds * scout().buildEvery) : '');
  // The top players re-read for their age, and the refresh of every character the armory knows
  // (backend/odyle/rankrefresh.go): started by hand here, or by the server when the level cap rose
  // or most top players' combat power changed a lot.
  const recheck = () => armory().recheck || { rechecks: 0, recheckDays: 3, refresh: null };
  const refresh = () => recheck().refresh;
  const refreshing = () => Boolean(refresh() && !refresh().done);
  const refreshCause = r =>
    r.by === 'level'
      ? 'started by the server: the level cap rose to ' + number(r.level)
      : r.by === 'power'
        ? 'started by the server: ' +
          number(r.share) +
          '% of the top players re-read changed combat power by 5% or more'
        : 'started by hand';
  const refreshText = () => {
    const r = refresh();
    if (!r)
      return 'No refresh yet. After a game patch, Refresh every character has the scout read every character it knows again, the top players first. The server starts one itself when the level cap rises or most top players’ combat power changes by 5% or more, at most once a week.';
    const started = 'Refresh of every character ' + refreshCause(r) + ' ' + when(r.at);
    return r.done
      ? started + ' · done: every character read again'
      : started +
          ' · still to read: ' +
          number(r.top) +
          ' top players, ' +
          number(r.rows) +
          ' characters in all, the gear of ' +
          number(r.gear) +
          ' top players';
  };
  function refreshAll(stop) {
    app.modals.confirm(
      stop
        ? 'Stop the refresh? The characters not read again yet wait for their usual turn.'
        : 'Refresh every character the armory knows? The scout reads the combat power of every one again, the top players of every class first (within a day, some 7,000 characters a day) and nothing else until it is done, and the top players’ gear as its lanes allow.',
      async () => {
        state.refreshing = true;
        try {
          await app.pb.send('/api/odyle/admin/armory-refresh', { method: stop ? 'DELETE' : 'POST', requestKey: null });
          await load();
        } catch (error) {
          app.checkApiError(error);
        }
        state.refreshing = false;
      },
      null,
      { yesButton: stop ? 'Stop the refresh' : 'Refresh every character' },
    );
  }
  // Most of an hour's requests (20 or more) from private or loopback addresses come through
  // a reverse proxy, and rate limits count all of them as one client unless it is trusted.
  const proxied = () => traffic().total.count >= 20 && (traffic().private || 0) * 2 > traffic().total.count;
  const staleBackups = () => Boolean(state.data.serverNow) && !(now() - timestamp(backups().latest?.at) < 48 * 3600000);

  // Requests per minute, stacked by source. Each minute's column is its hover target; the
  // arrow keys move through the minutes when the chart has focus.
  const segment = (m, s, scale) =>
    m[s.id]
      ? t.div({
          className: 'odyle-segment ' + s.id,
          style: 'height:' + Math.max(2, Math.round((m[s.id] / scale) * plotHeight)) + 'px',
        })
      : null;
  const column = m => {
    const scale = top();
    return t.div(
      {
        rid: m.at + '@' + signature(m) + '@' + scale,
        className: () => 'odyle-minute' + (state.hover === m.at ? ' active' : ''),
        onpointerenter: () => (state.hover = m.at),
      },
      total(m)
        ? t.div(
            { className: 'odyle-bar' },
            series.map(s => segment(m, s, scale)),
          )
        : null,
    );
  };
  const hovered = () => minutes().findIndex(m => m.at === state.hover);
  const tip = () => {
    const i = hovered();
    if (i < 0) return null;
    // Beside the minute, towards the middle of the chart, so the bar stays in sight.
    const m = minutes()[i],
      side = i < minutes().length / 2 ? ' after' : ' before';
    return t.div(
      { className: 'odyle-tip' + side, style: 'left:' + ((i + 0.5) / minutes().length) * 100 + '%' },
      t.div(
        { className: 'txt-hint txt-sm' },
        minuteLabel(m.at) + ' – ' + minuteLabel(new Date(timestamp(m.at) + 60000).toISOString()),
      ),
      series.map(s =>
        t.div(
          { className: 'odyle-tip-row' },
          t.span({ className: 'odyle-key-line ' + s.id }),
          t.strong(null, number(m[s.id])),
          t.span({ className: 'txt-hint' }, s.label),
        ),
      ),
      t.div(
        { className: 'odyle-tip-row total' },
        t.strong(null, number(total(m))),
        t.span({ className: 'txt-hint' }, total(m) === 1 ? 'request' : 'requests'),
      ),
    );
  };
  function move(e) {
    const list = minutes(),
      i = hovered(),
      last = list.length - 1;
    const next = {
      ArrowLeft: Math.max(0, (i < 0 ? last : i) - 1),
      ArrowRight: Math.min(last, (i < 0 ? last : i) + 1),
      Home: 0,
      End: last,
    }[e.key];
    if (next === undefined || !list.length) return;
    e.preventDefault();
    state.hover = list[next].at;
  }
  const legend = () =>
    series.map(s =>
      t.span(
        { className: 'odyle-key' },
        t.span({ className: 'odyle-swatch ' + s.id }),
        s.id === 'rejected' ? t.i({ className: 'ri-error-warning-line', ariaHidden: true }) : null,
        s.label,
        ' ',
        t.strong(null, () => number(minutes().reduce((sum, m) => sum + m[s.id], 0))),
      ),
    );
  const chart = t.div(
    {
      className: 'odyle-chart',
      tabIndex: 0,
      role: 'group',
      ariaLabel: 'Requests per minute over the last hour. The arrow keys read each minute.',
      onkeydown: move,
      onfocus: () => {
        if (!state.hover && minutes().length) state.hover = minutes()[minutes().length - 1].at;
      },
      onblur: () => (state.hover = ''),
    },
    t.div({ className: 'odyle-legend' }, legend()),
    t.div(
      { className: 'odyle-plot', style: 'height:' + plotHeight + 'px' },
      t.div(
        { className: 'odyle-gridline', style: 'bottom:' + plotHeight + 'px' },
        t.span(null, () => number(top())),
      ),
      t.div(
        { className: 'odyle-gridline', style: 'bottom:' + plotHeight / 2 + 'px' },
        t.span(null, () => number(top() / 2)),
      ),
      t.div({ className: 'odyle-gridline base', style: 'bottom:0' }, t.span(null, '0')),
      t.div(
        {
          className: 'odyle-bars',
          onpointerleave: () => {
            if (document.activeElement !== chart) state.hover = '';
          },
        },
        () => minutes().map(column),
      ),
      t.div({ className: 'odyle-tip-layer', ariaLive: 'polite' }, tip),
    ),
    // A time under every quarter hour.
    t.div({ className: 'odyle-axis', ariaHidden: true }, () =>
      minutes().map(m =>
        t.span({ rid: m.at }, new Date(timestamp(m.at)).getMinutes() % 15 === 0 ? minuteLabel(m.at) : ''),
      ),
    ),
  );
  // The same minutes as a table, newest first, for reading without the chart.
  const minuteTable = () => {
    const busy = minutes().filter(total).reverse();
    return busy.length
      ? t.div(
          { className: 'odyle-table m-t-xs' },
          t.table(
            null,
            t.thead(
              null,
              t.tr(
                null,
                t.th(null, 'Minute'),
                series.map(s => t.th({ className: 'txt-right' }, s.label)),
                t.th({ className: 'txt-right' }, 'Total'),
              ),
            ),
            t.tbody(
              null,
              busy.map(m =>
                t.tr(
                  null,
                  t.td({ className: 'txt-nowrap' }, minuteLabel(m.at)),
                  series.map(s => t.td({ className: 'txt-right' }, number(m[s.id]))),
                  t.td({ className: 'txt-right txt-bold' }, number(total(m))),
                ),
              ),
            ),
          ),
        )
      : t.div({ className: 'txt-hint txt-sm m-t-xs' }, 'No requests in the last hour.');
  };

  const routeRow = r =>
    t.tr(
      { rid: signature(r) },
      t.td(
        { className: 'txt-code' },
        r.source === 'read' ? r.kind : t.a({ href: packets(r.kind), title: 'Show these packets' }, r.kind),
      ),
      t.td(null, sourceLabels[r.source] || r.source),
      t.td({ className: 'txt-right' }, number(r.count)),
      t.td(
        { className: 'txt-right txt-nowrap' },
        !r.rejected
          ? t.span({ className: 'txt-hint' }, '0')
          : r.source === 'read'
            ? t.span({ className: 'txt-danger' }, number(r.rejected) + ' · ' + share(r.rejected, r.count))
            : t.a(
                {
                  href: packets(r.kind, '&filter=rejected'),
                  className: 'txt-danger',
                  title: 'Show the rejected ones among the latest packets',
                },
                number(r.rejected) + ' · ' + share(r.rejected, r.count),
              ),
      ),
      t.td({ className: 'txt-right txt-nowrap' }, millis(r.averageMs)),
      t.td({ className: 'txt-right txt-nowrap' }, '≤ ' + millis(r.medianMs)),
      t.td({ className: 'txt-right txt-nowrap' }, '≤ ' + millis(r.p95Ms)),
      t.td({ className: 'txt-right txt-nowrap' }, millis(r.maxMs)),
    );
  const routeHeads = ['Route', 'Source', 'Requests', 'Rejected', 'Average', 'Median', '95 %', 'Slowest'];
  const reasonRow = r =>
    t.tr(
      { rid: signature(r) },
      t.td({ className: 'odyle-error' }, r.message),
      t.td({ className: 'txt-code txt-nowrap' }, r.kind),
      t.td({ className: 'txt-right' }, number(r.count)),
      t.td({ className: 'txt-nowrap odyle-age', title: when(r.lastAt) }, () => ago(r.lastAt, now())),
      t.td(
        { className: 'txt-right txt-nowrap' },
        r.kind.startsWith('GET ')
          ? null
          : t.a(
              { href: packets(r.kind, '&filter=rejected'), title: 'The rejected ones among the latest packets' },
              'Show packets',
            ),
      ),
    );
  const dayRow = d =>
    t.tr(
      { rid: signature(d) },
      dayHeads.map(([key]) =>
        key === 'day' ? t.td({ className: 'txt-nowrap' }, d.day) : t.td({ className: 'txt-right' }, number(d[key])),
      ),
    );
  const versionRow = v =>
    t.tr(
      { rid: signature(v) + '@' + latest() },
      t.td({ className: 'txt-code' }, v.version || t.span({ className: 'txt-hint' }, 'not sent (older app)')),
      t.td({ className: 'txt-right' }, number(v.apps)),
      t.td(
        null,
        !v.version || !latest()
          ? null
          : older(v.version, latest())
            ? t.span({ className: 'label sm warning' }, 'update available')
            : t.span({ className: 'txt-hint txt-sm' }, 'newest'),
      ),
    );
  const release = () => state.data.release;
  const build = () => state.data.build,
    run = () => state.data.runtime;
  const size = bytes => (typeof bytes === 'number' ? app.utils.formattedFileSize(bytes) : '—');
  // Go's profiles of the running server, saved as files for go tool pprof.
  async function profile(name, query = '') {
    state.profiling = name;
    try {
      const res = await fetch(app.pb.buildURL('/api/odyle/admin/pprof/' + name + query), {
        headers: { Authorization: app.pb.authStore.token },
      });
      if (!res.ok) throw new Error('The ' + name + ' profile could not be taken (' + res.status + ').');
      const link = t.a({
        href: URL.createObjectURL(await res.blob()),
        download: 'odyle-' + name + '-' + new Date().toISOString().slice(0, 19).replace(/:/g, '') + '.pb.gz',
      });
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch (error) {
      state.failed = error.message;
    }
    state.profiling = '';
  }
  const profileButton = (name, label, query) =>
    t.button(
      {
        type: 'button',
        className: 'btn sm secondary',
        disabled: () => Boolean(state.profiling),
        onclick: () => profile(name, query),
      },
      () => (state.profiling === name ? 'Taking…' : label),
    );
  // VACUUM rewrites a database file without the space deleted rows left (backend/odyle/vacuum.go).
  const database = () => state.data.database || {};
  const reclaimable = name =>
    database()[name + 'FreeBytes'] ? size(database()[name + 'FreeBytes']) + ' reclaimable' : 'nothing to reclaim';
  function lastVacuum(name) {
    const v = database().vacuums?.[name];
    return !v
      ? 'not vacuumed since the server started'
      : v.error
        ? 'last vacuum failed ' + ago(v.at, now())
        : 'vacuumed ' + ago(v.at, now()) + ', ' + size(v.beforeBytes) + ' → ' + size(v.afterBytes);
  }
  function vacuum(name, label) {
    app.modals.confirm(
      'Vacuum the ' +
        label +
        ' database? It rewrites its ' +
        size(database()[name + 'Bytes']) +
        ', needs about as much free disk space for a moment, and every write to it waits until it is done.',
      async () => {
        state.vacuuming = name;
        try {
          const data = await app.pb.send('/api/odyle/admin/vacuum/' + name, { method: 'POST', requestKey: null });
          state.data = { ...state.data, database: data.database };
          const r = data.result;
          if (r.error) app.toasts.error('The ' + label + ' vacuum failed: ' + r.error);
          else
            app.toasts.success(
              capital(label) +
                ' database vacuumed in ' +
                millis(r.ms) +
                ': ' +
                size(r.beforeBytes) +
                ' → ' +
                size(r.afterBytes) +
                '.',
            );
        } catch (error) {
          app.checkApiError(error);
        }
        state.vacuuming = '';
      },
      null,
      { yesButton: 'Vacuum' },
    );
  }
  const vacuumButton = (name, label) =>
    t.button(
      {
        type: 'button',
        className: () => 'btn sm secondary' + (state.vacuuming === name ? ' loading' : ''),
        disabled: () => Boolean(state.vacuuming || database().vacuuming),
        onclick: () => vacuum(name, label),
      },
      t.i({ className: 'ri-eraser-line', ariaHidden: true }),
      t.span({ className: 'txt' }, 'Vacuum ' + label),
    );

  return layout(
    '#/odyle/status',
    app.components.refreshButton({ onclick: load }),
    t.div(
      {
        onmount: () => {
          load();
          poll = setInterval(load, 10000);
          tick = setInterval(() => (state.now = Date.now()), 1000);
        },
        onunmount: () => {
          clearInterval(poll);
          clearInterval(tick);
        },
      },
      () => (state.failed ? t.div({ className: 'alert danger m-b-sm' }, state.failed) : null),
      () =>
        staleBackups()
          ? t.div(
              { className: 'alert warning m-b-sm' },
              backups().latest
                ? 'No backup in the last 48 hours: the newest is from ' + when(backups().latest.at) + '. '
                : 'There is no backup yet. ',
              !backups().schedule
                ? 'Scheduled backups are off; turn them on under '
                : backups().latest
                  ? 'Check the server log for failed backups, and make one now under '
                  : 'Backups run ' +
                    (/^Daily /.test(schedule(backups().schedule))
                      ? schedule(backups().schedule).replace('Daily ', 'daily at ')
                      : 'on the schedule ' + backups().schedule) +
                    '; make one now under ',
              t.a({ href: '#/settings/backups' }, 'Settings → Backups'),
              '.',
            )
          : null,
      () =>
        proxied()
          ? t.div(
              { className: 'alert warning m-b-sm' },
              number(traffic().private) +
                " of the last hour's " +
                number(traffic().total.count) +
                ' requests came from private or loopback addresses',
              proxy().headers.length
                ? ' although ' +
                    proxy().headers.join(', ') +
                    " is trusted. Check that your reverse proxy sets it with the client's address."
                : ' and no proxy header is trusted, so rate limits count everyone behind your reverse proxy as one client. Set ODYLE_TRUSTED_PROXY_HEADERS to the header your proxy writes (docs/deployment.md).',
            )
          : null,
      () =>
        readers().stuck
          ? t.div(
              { className: 'alert warning m-b-sm' },
              number(readers().stuck) +
                ' of ' +
                number(readers().connected) +
                (readers().connected === 1 ? ' app' : ' apps') +
                ' connected to the game have read no Odyle for 10 minutes' +
                (readers().games.length
                  ? ' (' +
                    readers()
                      .games.map(g => g.game)
                      .join(', ') +
                    ')'
                  : '') +
                '. After a game patch, pause the readers or switch the adapter off under ',
              t.a({ href: '#/odyle/controls' }, 'Server controls'),
              ", then follow the patch-day runbook in the Windows app's docs/packet-reader.md.",
            )
          : null,
      () =>
        clock().checkedToday >= 5 && clock().missedToday * 2 > clock().checkedToday
          ? t.div(
              { className: 'alert warning m-b-sm' },
              number(clock().missedToday) +
                ' of ' +
                number(clock().checkedToday) +
                ' login readings in the last 24 hours did not match the Odyle clock. A game patch may have changed the regeneration: check its rules under ',
              t.a({ href: '#/odyle/settings' }, 'Game settings'),
              ', or hide the Odyle clock there until they are right.',
            )
          : null,
      () =>
        readers().refusedAdapters.length
          ? t.div(
              { className: 'alert warning m-b-sm' },
              'Readings arrive under ' +
                readers().refusedAdapters.join(', ') +
                ', which this backend refuses, so they are not saved. Accept it under ',
              t.a({ href: '#/odyle/controls' }, 'Server controls'),
              ' or deploy the backend that lists it.',
            )
          : null,
      () =>
        [backups().setup, storage().setup, proxy().setup]
          .filter(Boolean)
          .map(problem => t.div({ className: 'alert warning m-b-sm odyle-error' }, problem)),
      // The server's own problems the operator alerts tell of (backend/odyle/alerts.go), but those warned of above.
      () =>
        (readers().serverProblems || [])
          .filter(p => !(p.key === 'backup' && staleBackups()) && !(p.key === 'armory' && armory().blockedUntil))
          .map(p => t.div({ className: 'alert warning m-b-sm odyle-error' }, p.message)),
      t.div(
        { className: 'odyle-stats m-b-base' },
        stat(
          'Server running',
          () => (state.data.startedAt ? duration(now() - timestamp(state.data.startedAt)) : '—'),
          () => (state.data.startedAt ? 'since ' + when(state.data.startedAt) : ''),
        ),
        stat(
          'Requests last hour',
          () => number(traffic().total.count),
          () =>
            perMinute().toLocaleString([], { maximumFractionDigits: 1 }) + ' a minute · busiest ' + number(busiest()),
        ),
        stat(
          'Rejected last hour',
          () => number(traffic().total.rejected),
          () => share(traffic().total.rejected, traffic().total.count) + ' of the requests',
        ),
        stat(
          'Handling time',
          () => (traffic().total.count ? '≤ ' + millis(traffic().total.p95Ms) : '—'),
          () =>
            traffic().total.count
              ? '95 % of requests · median ≤ ' +
                millis(traffic().total.medianMs) +
                ' · slowest ' +
                millis(traffic().total.maxMs)
              : 'no requests yet',
        ),
        stat(
          'Database',
          () => (state.data.database.dataBytes ? app.utils.formattedFileSize(state.data.database.dataBytes) : '—'),
          () =>
            state.data.database.logsBytes ? 'logs ' + app.utils.formattedFileSize(state.data.database.logsBytes) : '',
        ),
      ),
      t.div(
        { className: 'flex m-b-sm' },
        t.div({ className: 'txt-lg' }, 'Requests per minute'),
        t.span({ className: 'txt-hint txt-sm' }, 'the last hour, by source; rejected ones from any source'),
      ),
      t.div(
        { className: 'odyle-card m-b-base' },
        chart,
        t.details(
          { className: 'odyle-minutes' },
          t.summary({ className: 'txt-sm' }, 'Minutes as a table'),
          minuteTable,
        ),
      ),
      t.div(
        { className: 'flex m-b-sm' },
        t.div({ className: 'txt-lg' }, 'Routes'),
        t.span({ className: 'txt-hint txt-sm' }, 'the last hour, busiest first'),
      ),
      t.div(
        { className: 'odyle-table m-b-xs' },
        t.table(
          null,
          t.thead(
            null,
            t.tr(
              null,
              routeHeads.map((h, i) => t.th({ className: i > 1 ? 'txt-right' : '' }, h)),
            ),
          ),
          t.tbody(null, () =>
            traffic().routes.length
              ? traffic().routes.map(routeRow)
              : t.tr(
                  null,
                  t.td({ colSpan: routeHeads.length, className: 'txt-hint txt-center' }, () =>
                    state.loading ? 'Loading…' : 'No requests in the last hour.',
                  ),
                ),
          ),
        ),
      ),
      t.p(
        { className: 'txt-hint txt-sm m-b-base' },
        "Handling time is measured inside Odyle's route, from the request to its answer. Median and 95 % are upper bounds: times are counted in steps of 1, 2, 5, 10, 25, 50, 100, 250 and 500 ms, 1, 2.5 and 5 s.",
      ),
      t.div(
        { className: 'flex m-b-sm' },
        t.div({ className: 'txt-lg' }, 'Rejection reasons'),
        t.span({ className: 'txt-hint txt-sm' }, 'the last hour, most frequent first'),
      ),
      t.div(
        { className: 'odyle-table m-b-base' },
        t.table(
          null,
          t.thead(
            null,
            t.tr(
              null,
              t.th(null, 'Reason'),
              t.th(null, 'Route'),
              t.th({ className: 'txt-right' }, 'Count'),
              t.th(null, 'Last'),
              t.th(null, ''),
            ),
          ),
          t.tbody(null, () =>
            traffic().errors.length
              ? traffic().errors.map(reasonRow)
              : t.tr(
                  null,
                  t.td({ colSpan: 5, className: 'txt-hint txt-center' }, () =>
                    state.loading ? 'Loading…' : 'Nothing was rejected in the last hour.',
                  ),
                ),
          ),
        ),
      ),
      t.div({ className: 'flex m-b-sm' }, t.div({ className: 'txt-lg' }, 'Stored data')),
      t.div(
        { className: 'odyle-stats m-b-base' },
        stat(
          'Accounts',
          () => number(counts('accounts').total),
          () =>
            number(counts('accounts').active24h) +
            ' active in 24 h · ' +
            number(counts('accounts').active7d) +
            ' in 7 days',
        ),
        stat(
          'Characters',
          () => number(counts('characters').total),
          () => number(counts('characters').live) + ' with a live reading',
        ),
        stat(
          'Rooms',
          () => number(counts('rooms').total),
          () => number(counts('rooms').discordReminders) + ' with Discord reminders',
        ),
        stat(
          'Paired PCs',
          () => number(counts('pairedPcs').total),
          () =>
            number(counts('readerSessions').connected) +
            ' apps connected · ' +
            number(counts('readerSessions').open) +
            ' sessions open',
        ),
        stat(
          'Planned runs',
          () => number(counts('plannedRuns').total),
          () => number(counts('plannedRuns').upcoming) + ' still to start',
        ),
        stat('Odyle history', () => number(counts('historyPoints').total), 'changes of the last 30 days'),
        stat('Checklist tasks', () => number(counts('tasks').total), 'daily and weekly'),
      ),
      t.div(
        { className: 'flex m-b-sm' },
        t.div({ className: 'txt-lg' }, 'Activation'),
        t.span(
          { className: 'txt-hint txt-sm' },
          'accounts that reached each step and what they use, now; totals only, no account is followed',
        ),
      ),
      t.div(
        { className: 'odyle-stats m-b-sm' },
        stat(
          'Signed up',
          () => number(reached().accounts),
          () => number(reached().activeAccounts) + ' used Odyle in 24 h',
        ),
        stat(
          'Paired a PC',
          () => number(reached().pairedAccounts),
          () => share(reached().pairedAccounts, reached().accounts) + ' of the accounts',
        ),
        stat(
          'First reading',
          () => number(reached().readingAccounts),
          () => share(reached().readingAccounts, reached().pairedAccounts) + ' of those paired',
        ),
        stat(
          'Shared in a room',
          () => number(reached().sharingAccounts),
          () => share(reached().sharingAccounts, reached().readingAccounts) + ' of those reading',
        ),
        stat('Reading together', () => number(reached().roomsReading), 'rooms with 2 or more members read in 7 days'),
      ),
      t.div(
        { className: 'odyle-stats m-b-sm' },
        stat('Rooms with runs', () => number(reached().roomsWithRuns), 'from yesterday to 7 days ahead'),
        stat('Wishlist entries', () => number(reached().wishlistEntries), 'in all rooms'),
        stat('Accounts with tasks', () => number(reached().taskAccounts), 'daily or weekly'),
        stat('Discord reminders', () => number(reached().discordRooms), 'rooms with a webhook'),
        stat('Odyle changes', () => number(reached().readings), 'saved in the last 24 h'),
      ),
      t.div(
        { className: 'flex m-b-base odyle-chips' },
        t.span({ className: 'txt-hint txt-sm' }, 'Windows apps of the last 24 hours, one per PC:'),
        () =>
          (reached().appVersions || []).length
            ? reached()
                .appVersions.slice()
                .sort((a, b) => byVersion(a.version, b.version))
                .map(v => t.span({ className: 'label sm' }, (v.version || 'not sent') + ' · ' + number(v.apps)))
            : t.span({ className: 'txt-hint txt-sm' }, 'none'),
      ),
      t.div(
        { className: 'flex m-b-sm' },
        t.div({ className: 'txt-lg' }, 'Last 30 days'),
        t.span(
          { className: 'txt-hint txt-sm' },
          'the same totals, stored every night at 23:55 UTC by the Daily numbers job, newest first',
        ),
      ),
      t.div(
        { className: 'odyle-table m-b-base' },
        t.table(
          null,
          t.thead(
            null,
            t.tr(
              null,
              dayHeads.map(([key, label]) => t.th({ className: key === 'day' ? '' : 'txt-right' }, label)),
            ),
          ),
          t.tbody(null, () =>
            days().length
              ? days().map(dayRow)
              : t.tr(
                  null,
                  t.td({ colSpan: dayHeads.length, className: 'txt-hint txt-center' }, () =>
                    state.loading
                      ? 'Loading…'
                      : "No day stored yet. Run Daily numbers under Background jobs to store today's.",
                  ),
                ),
          ),
        ),
      ),
      t.div(
        { className: 'flex m-b-sm' },
        t.div({ className: 'txt-lg' }, 'Backups'),
        t.a({ className: 'txt-sm', href: '#/settings/backups' }, 'Settings → Backups'),
      ),
      t.div(
        { className: 'odyle-stats m-b-sm' },
        stat(
          'Last backup',
          () => (backups().latest ? ago(backups().latest.at, now()) : '—'),
          () => (backups().latest ? size(backups().latest.size) + ' · ' + backups().latest.name : 'none yet'),
        ),
        stat(
          'Schedule',
          () => schedule(backups().schedule),
          () => (backups().schedule ? 'keeps the newest ' + number(backups().keep) : 'backups only by hand'),
        ),
        stat(
          'Stored',
          () => number(backups().count),
          () => (backups().offHost ? 'off the host, in S3 storage' : 'on the data volume only'),
        ),
      ),
      () =>
        backups().error
          ? t.div(
              { className: 'alert warning m-b-sm odyle-error' },
              'The backups could not be listed: ' + backups().error,
            )
          : null,
      t.p({ className: 'txt-hint txt-sm m-b-base' }, () =>
        backups().offHost
          ? 'Backups go to S3 storage, set by ODYLE_BACKUP_S3_* or under Settings → Backups. Restore one there, or by hand as docs/deployment.md describes.'
          : 'Backups stay on the same disk as the data and would be lost with it. Set ODYLE_BACKUP_S3_* to keep them off the host (docs/deployment.md). Restore one under Settings → Backups.',
      ),
      t.div(
        { className: 'flex m-b-sm' },
        t.div({ className: 'txt-lg' }, 'Files'),
        t.a({ className: 'txt-sm', href: '#/settings/storage' }, 'Settings → Files storage'),
      ),
      t.div(
        { className: 'odyle-stats m-b-sm' },
        stat(
          'Kept in',
          () => (storage().offHost ? 'S3 storage' : 'the data volume'),
          () => (storage().offHost ? 'bucket ' + storage().bucket : 'pb_data/storage'),
        ),
        stat(
          'Moved into S3',
          () => (storage().moving ? 'moving…' : storage().moved ? number(storage().moved.files) : '—'),
          () =>
            storage().moved
              ? (storage().moved.files ? size(storage().moved.bytes) : 'nothing was left on disk') +
                ' · ' +
                ago(storage().moved.at, now()) +
                (storage().moved.failed ? ' · ' + number(storage().moved.failed) + ' failed' : '')
              : storage().offHost
                ? 'the files on disk move when the server starts'
                : 'the files on disk move once S3 storage is on',
        ),
      ),
      () =>
        storage().moved?.error
          ? t.div(
              { className: 'alert warning m-b-sm odyle-error' },
              'Some files could not be moved into S3 storage and stay on disk until the next start: ' +
                storage().moved.error,
            )
          : null,
      t.p({ className: 'txt-hint txt-sm m-b-base' }, () =>
        storage().offHost
          ? "Character portraits and the armory's images are kept in S3 storage, set by ODYLE_STORAGE_S3_* or under Settings → Files storage. Browsers still load them from this server and keep them. They are copies of PLAYNC's images, so backups leave them out."
          : "Character portraits and the armory's images are kept on the data volume. Set ODYLE_STORAGE_S3_* to keep them in S3 storage instead (docs/deployment.md); the files on disk then move there.",
      ),
      t.div(
        { className: 'flex m-b-sm' },
        t.div({ className: 'txt-lg' }, 'Database'),
        t.span({ className: 'txt-hint txt-sm' }, 'SQLite files on the data volume, with their write-ahead logs'),
      ),
      t.div(
        { className: 'odyle-stats m-b-sm' },
        stat(
          'Data',
          () => size(database().dataBytes),
          () => reclaimable('data') + ' · ' + lastVacuum('data'),
        ),
        stat(
          'Logs',
          () => size(database().logsBytes),
          () => reclaimable('logs') + ' · ' + lastVacuum('logs'),
        ),
      ),
      t.div({ className: 'flex m-b-xs odyle-profiles' }, vacuumButton('data', 'data'), vacuumButton('logs', 'logs')),
      t.p(
        { className: 'txt-hint txt-sm m-b-base' },
        'Deleted rows (expired sessions, old history, request logs) leave free pages inside the file. A vacuum rewrites the file without them and gives the space back to the disk; while it runs, every write to that database waits. Vacuum after a large clean-up, ideally at a quiet hour.',
      ),
      t.div(
        { className: 'flex m-b-sm' },
        t.div({ className: 'txt-lg' }, 'Server'),
        t.span({ className: 'txt-hint txt-sm' }, () =>
          [build().go, build().pocketbase ? 'PocketBase ' + build().pocketbase : '', build().platform]
            .filter(Boolean)
            .join(' · '),
        ),
      ),
      t.div(
        { className: 'odyle-stats m-b-sm' },
        stat(
          'Version',
          () => build().version || '—',
          () =>
            build().commit
              ? 'commit ' +
                build().commit.slice(0, 12) +
                (build().modified ? ' (modified)' : '') +
                (build().builtAt ? ' · ' + when(build().builtAt) : '')
              : '',
        ),
        stat(
          'Goroutines',
          () => number(run().goroutines),
          () => number(run().realtimeClients) + ' realtime connections',
        ),
        stat(
          'Memory',
          () => size(run().heapBytes),
          () => number(run().heapObjects) + ' objects · ' + size(run().systemBytes) + ' from the system',
        ),
        stat(
          'Garbage collection',
          () => number(run().gcCycles),
          () =>
            typeof run().lastPauseMs === 'number'
              ? 'cycles · last pause ' + millis(run().lastPauseMs) + ' · ' + millis(run().pauseTotalMs) + ' in all'
              : '',
        ),
        stat(
          'Processors',
          () => number(run().maxProcs),
          () => (typeof run().cpus === 'number' ? 'in use of ' + number(run().cpus) + ' CPUs' : ''),
        ),
        stat(
          'Trusted proxy',
          () => (proxy().headers.length ? proxy().headers.join(', ') : 'none'),
          () =>
            (proxy().headers.length ? (proxy().leftmost ? 'leftmost' : 'rightmost') + ' address · ' : '') +
            (traffic().total.count
              ? share(traffic().private, traffic().total.count) + " of the last hour's requests from private addresses"
              : 'no requests in the last hour'),
        ),
      ),
      t.div(
        { className: 'flex m-b-base odyle-profiles' },
        t.span({ className: 'txt-hint txt-sm' }, 'Profiles for go tool pprof:'),
        profileButton('profile', 'CPU, 30 s', '?seconds=30'),
        profileButton('heap', 'Heap'),
        profileButton('allocs', 'Allocations'),
        profileButton('goroutine', 'Goroutines'),
      ),
      t.div(
        { className: 'flex m-b-sm' },
        t.div({ className: 'txt-lg' }, 'Readers'),
        t.span({ className: 'txt-hint txt-sm' }, "what the connected apps' readers report with their heartbeats, now"),
      ),
      t.div(
        { className: 'odyle-stats m-b-sm' },
        stat(
          'Reporting',
          () => number(readers().reporting),
          () =>
            Object.entries(readers().statuses)
              .map(([s, n]) => number(n) + ' ' + (readerLabels[s] || s))
              .join(' · ') || 'no reports yet; apps send them from the next Windows release on',
        ),
        stat(
          'Listening without Odyle',
          () => number(readers().stuck),
          () => 'for 10 minutes, of ' + number(readers().connected) + ' connected to the game',
        ),
        stat(
          'Game builds',
          () =>
            readers().games.length
              ? readers()
                  .games.map(g => g.game.replace(/^Steam build /, ''))
                  .join(', ')
              : '—',
          () =>
            readers().games.length
              ? readers()
                  .games.map(g => number(g.apps) + ' on ' + g.game)
                  .join(' · ')
              : 'Steam builds the apps read',
        ),
        stat(
          'Odyle clock',
          () => (clock().checked ? Math.round((clock().matched / clock().checked) * 100) + '%' : '—'),
          () =>
            clock().checked
              ? number(clock().matched) +
                ' of ' +
                number(clock().checked) +
                ' login readings of the last 7 days matched its projection'
              : 'login readings after a tick, compared with its projection',
        ),
        stat(
          'Operator alerts',
          () => (readers().alerts ? 'on' : 'off'),
          () =>
            readers().alerts
              ? 'Discord, by the Reader health job every 5 minutes'
              : 'set ODYLE_ALERT_WEBHOOK to a Discord webhook',
        ),
      ),
      t.div(
        { className: 'flex m-b-sm' },
        t.div({ className: 'txt-lg' }, 'Armory'),
        t.span(
          { className: 'txt-hint txt-sm' },
          () =>
            'public character profiles from PLAYNC, up to ' +
            number(lanes().readers) +
            " readers' lookups and " +
            number(lanes().scouts) +
            " of the scout's at once (Server controls); counts since the server started",
        ),
      ),
      () =>
        armory().blockedUntil
          ? t.div(
              { className: 'alert warning m-b-sm' },
              'PLAYNC refused the armory lookups; the queue waits until ' +
                new Date(armory().blockedUntil).toLocaleTimeString() +
                '. Pausing the armory under ',
              t.a({ href: '#/odyle/controls' }, 'Server controls'),
              ' and resuming it ends the wait; if it keeps happening, leave it paused for a while.',
            )
          : null,
      t.div(
        { className: 'odyle-stats m-b-base' },
        stat(
          'Kept profiles',
          () => number(armory().profiles),
          () => number(armory().hidden) + ' hidden · kept 30 days after they were last opened',
        ),
        stat(
          'Queue',
          () =>
            armory().paused ? 'paused' : number(armory().waiting + (armory().running ?? (armory().fetching ? 1 : 0))),
          () =>
            armory().paused
              ? 'Server controls'
              : number(armory().running ?? 0) + ' running · ' + number(armory().waiting) + ' waiting',
        ),
        stat(
          'Top players',
          () => number(armory().ranked ?? 0),
          () => number(armory().built ?? 0) + ' with their gear read · Armory scout',
        ),
        stat(
          'Lookups',
          () => number(armory().done),
          () =>
            (armory().failed ? number(armory().failed) + ' failed · ' : '') +
            (armory().lastAt ? 'last ' + new Date(armory().lastAt).toLocaleString() : 'none yet'),
        ),
        stat(
          'Last error',
          () => (armory().lastError ? new Date(armory().lastErrorAt).toLocaleString() : 'none'),
          () => armory().lastError || 'PLAYNC answered every lookup',
        ),
        stat(
          'Images',
          () => number(armory().images || 0),
          () =>
            app.utils.formattedFileSize(armory().imageBytes || 0) +
            ' of icons and portraits, their files ' +
            (armory().imagesOffHost ? 'in S3 storage' : 'on the data volume'),
        ),
      ),
      t.div(
        { className: 'odyle-table m-b-sm' },
        t.table(
          null,
          t.thead(
            null,
            t.tr(
              null,
              t.th(null, 'Lookup'),
              t.th(null, 'Character'),
              t.th(null, 'Server'),
              t.th(null, 'For'),
              t.th(null, 'Since'),
            ),
          ),
          t.tbody(null, () =>
            queue().length
              ? queue().map(queueRow)
              : t.tr(
                  null,
                  t.td({ colSpan: 5, className: 'txt-hint txt-center' }, () =>
                    state.loading ? 'Loading…' : 'Nothing waits for PLAYNC.',
                  ),
                ),
          ),
        ),
      ),
      t.p(
        { className: 'txt-hint txt-sm m-b-base' },
        'Browse, search and delete the kept images under ',
        t.a({ href: '#/collections?collection=armory_images' }, 'Collections → armory_images'),
        '; a profile that names a deleted image fetches it again when it is opened. The queue names no address that asked.',
      ),
      t.div(
        { className: 'flex m-b-sm' },
        t.div({ className: 'txt-lg' }, 'Armory scout'),
        t.span(
          { className: 'txt-hint txt-sm' },
          'what the scout still reads of PLAYNC for the top players, in the order it reads it',
        ),
        t.div({ className: 'm-r-auto' }),
        t.button(
          {
            type: 'button',
            className: () => 'btn sm secondary' + (state.refreshing ? ' loading' : ''),
            disabled: () => state.refreshing,
            title: () =>
              refreshing()
                ? 'Stop the refresh: the characters not read again yet wait for their usual turn'
                : 'Have the scout read every character the armory knows again, the top players first (after a game patch)',
            onclick: () => refreshAll(refreshing()),
          },
          t.i({ className: () => (refreshing() ? 'ri-stop-circle-line' : 'ri-refresh-line'), ariaHidden: true }),
          t.span({ className: 'txt' }, () => (refreshing() ? 'Stop the refresh' : 'Refresh every character')),
        ),
      ),
      t.p({ className: () => 'txt-sm m-b-sm' + (refreshing() ? ' txt-bold' : ' txt-hint') }, () => refreshText()),
      t.div(
        { className: 'odyle-stats m-b-sm' },
        stat(
          'Gear to read',
          () => number(scout().builds),
          () =>
            (scout().builds
              ? number(scout().neverBuilt) +
                ' never read, ' +
                number(scout().builds - scout().neverBuilt) +
                (refreshing() ? ' read 14 or more days ago or before the refresh · ' : ' read 14 or more days ago · ')
              : '') + buildPace(),
        ),
        stat(
          'Top players to re-read',
          () => number(recheck().rechecks),
          () =>
            "combat power of each class's top 500 and the 250 below them, read again every " +
            number(recheck().recheckDays) +
            ' days or since the refresh, before names and searches',
        ),
        stat(
          'Combat power to read',
          () => number(scout().checks),
          () =>
            scout().level
              ? 'characters of level ' +
                number(scout().level) +
                ' its searches found, read between searches · in server memory'
              : 'characters its searches find, read between searches · in server memory',
        ),
        stat(
          'Odyle characters to check',
          () => number(scout().own ?? 0),
          () =>
            "played by Odyle's accounts, of the highest level, not checked for 30 days; read before names and searches",
        ),
        stat(
          'Names to find',
          () => number(scout().names ?? 0),
          () =>
            "party and force members the apps sent, searched for on the sending character's server · in server memory; then players met in PvP",
        ),
        stat(
          'Last gear read',
          () => (scout().lastBuildAt ? ago(scout().lastBuildAt, now()) : 'none yet'),
          () => (scout().lastBuildAt ? 'queued ' + when(scout().lastBuildAt) : 'since the server started'),
        ),
      ),
      t.div(
        { className: 'grid m-b-sm' },
        t.div(
          { className: 'col-lg-7' },
          t.div(
            { className: 'odyle-table' },
            t.table(
              null,
              t.thead(
                null,
                t.tr(
                  null,
                  t.th({ className: 'txt-right' }, '#'),
                  t.th(null, 'Character'),
                  t.th(null, 'Class'),
                  t.th(null, 'Server'),
                  t.th({ className: 'txt-right' }, 'Combat power'),
                  t.th(null, 'Gear'),
                ),
              ),
              t.tbody(null, () =>
                scout().buildQueue.length
                  ? scout().buildQueue.map(buildRow)
                  : t.tr(
                      null,
                      t.td({ colSpan: 6, className: 'txt-hint txt-center' }, () =>
                        state.loading ? 'Loading…' : 'The gear of every top player is read.',
                      ),
                    ),
              ),
            ),
          ),
          t.div({ className: 'field-help' }, () =>
            scout().builds > scout().buildQueue.length
              ? 'The first ' +
                number(scout().buildQueue.length) +
                ' of ' +
                number(scout().builds) +
                ', strongest first.'
              : 'Strongest first.',
          ),
        ),
        t.div(
          { className: 'col-lg-5' },
          t.div(
            { className: 'odyle-table' },
            t.table(
              null,
              t.thead(
                null,
                t.tr(
                  null,
                  t.th({ className: 'txt-right' }, '#'),
                  t.th(null, 'Character'),
                  t.th(null, 'Server'),
                  t.th(null, 'Combat power'),
                ),
              ),
              t.tbody(null, () =>
                scout().checkQueue.length
                  ? scout().checkQueue.map(checkRow)
                  : t.tr(
                      null,
                      t.td({ colSpan: 4, className: 'txt-hint txt-center' }, () =>
                        state.loading ? 'Loading…' : 'Nothing waits; the next step searches.',
                      ),
                    ),
              ),
            ),
          ),
          t.div({ className: 'field-help m-b-sm' }, () =>
            scout().checks > scout().checkQueue.length
              ? 'The first ' +
                number(scout().checkQueue.length) +
                ' of ' +
                number(scout().checks) +
                ', in the order it reads them.'
              : 'In the order it reads them.',
          ),
          t.div(
            { className: 'odyle-table' },
            t.table(
              null,
              t.thead(
                null,
                t.tr(null, t.th({ className: 'txt-right' }, '#'), t.th(null, 'Name to find'), t.th(null, 'Server')),
              ),
              t.tbody(null, () =>
                (scout().nameQueue || []).length
                  ? scout().nameQueue.map(nameRow)
                  : t.tr(
                      null,
                      t.td({ colSpan: 3, className: 'txt-hint txt-center' }, () =>
                        state.loading ? 'Loading…' : 'No party or force member waits.',
                      ),
                    ),
              ),
            ),
          ),
          t.div({ className: 'field-help' }, () =>
            scout().names > (scout().nameQueue || []).length
              ? 'The first ' +
                number(scout().nameQueue.length) +
                ' of ' +
                number(scout().names) +
                ', in the order it searches for them.'
              : 'In the order it searches for them.',
          ),
        ),
      ),
      t.p(
        { className: 'txt-hint txt-sm m-b-base' },
        "The search pages list a character's id and name; its combat power comes with its info page. A restart forgets the characters waiting for their combat power and the names waiting to be found, not the top players. Names are never kept with who sent them.",
      ),
      t.div({ className: 'flex m-b-sm' }, t.div({ className: 'txt-lg' }, 'Windows app')),
      t.div(
        { className: 'grid m-b-base' },
        t.div(
          { className: 'col-lg-5' },
          t.div(
            { className: 'odyle-card' },
            t.div({ className: 'txt-hint txt-sm' }, 'Newest release'),
            t.div({ className: 'txt-lg txt-bold' }, () => latest() || '—'),
            t.div({ className: 'txt-sm' }, () =>
              release().publishedAt ? 'published ' + when(release().publishedAt) : 'not known yet',
            ),
            t.div({ className: 'txt-hint txt-sm' }, () =>
              release().checkedAt
                ? 'GitHub checked ' +
                  ago(release().checkedAt, now()) +
                  (release().fetchedAt
                    ? ', last answered ' + ago(release().fetchedAt, now())
                    : ', no answer since the server started')
                : '',
            ),
            () =>
              release().error
                ? t.div({ className: 'alert warning m-t-xs odyle-error' }, 'The last lookup failed: ', release().error)
                : null,
            () =>
              release().repository
                ? t.a(
                    {
                      className: 'txt-sm',
                      href: 'https://github.com/' + release().repository + '/releases',
                      target: '_blank',
                      rel: 'noopener noreferrer',
                    },
                    'Releases on GitHub ↗',
                  )
                : null,
          ),
        ),
        t.div(
          { className: 'col-lg-7' },
          t.div(
            { className: 'odyle-table' },
            t.table(
              null,
              t.thead(
                null,
                t.tr(
                  null,
                  t.th(null, 'Connected app version'),
                  t.th({ className: 'txt-right' }, 'Apps'),
                  t.th(null, ''),
                ),
              ),
              t.tbody(null, () =>
                state.data.versions.length
                  ? state.data.versions
                      .slice()
                      .sort((a, b) => byVersion(a.version, b.version))
                      .map(versionRow)
                  : t.tr(
                      null,
                      t.td({ colSpan: 3, className: 'txt-hint txt-center' }, () =>
                        state.loading ? 'Loading…' : 'No Windows app is connected.',
                      ),
                    ),
              ),
            ),
          ),
          t.div({ className: 'field-help' }, 'Apps in contact within the last 90 seconds.'),
        ),
      ),
      t.p(
        { className: 'txt-hint txt-sm' },
        "Traffic counts every Odyle route, the dashboard's reads included, per minute in server memory only; a restart starts it over, and requests refused before Odyle handles them (no sign-in) are not counted. The page refreshes every 10 seconds.",
      ),
    ),
  );
}

// What each background job does; the backend's odyle/jobs.go holds the schedules and the records.
const jobInfo = {
  'odyle-expiry': {
    label: 'Clean-up',
    schedule: () => 'Every 5 minutes',
    unit: 'removed',
    about:
      'Removes invite links three days after they expired, expired pairing codes and reader sessions, Odyle history and places older than Game settings keep them, runs a day after they started and audit log entries older than a year.',
  },
  'odyle-portraits': {
    label: 'Portrait refresh',
    schedule: () => 'Every minute',
    unit: 'portraits checked',
    about:
      'Up to five characters a run, two at a time, get their official portrait from PLAYNC: ones not looked up yet, the others daily. A character the search does not list is tried again after an hour, six hours and a day, then weekly; characters no reader has seen for 60 days wait until one does. New characters are looked up as soon as they are saved, up to ten at a time.',
  },
  'odyle-reminders': {
    label: 'Discord reminders',
    schedule: () => 'Every minute',
    unit: 'reminders posted',
    about: "Posts planned runs to their room's Discord channel 15 minutes before they start.",
  },
  'odyle-retention': {
    label: 'Inactive accounts',
    schedule: () => 'Daily at 03:17 UTC (' + localHour(3, 17) + ' here)',
    unit: 'accounts deleted',
    about: 'Deletes accounts unused for the period set under Game settings, up to 200 a night.',
  },
  'odyle-old-characters': {
    label: 'Old characters',
    schedule: () => 'Daily at 03:29 UTC (' + localHour(3, 29) + ' here)',
    unit: 'characters deleted',
    about:
      'Deletes characters no Windows reader has read or seen for 12 months, with their history, up to 500 a night. Playing one again with the reader saves it anew.',
  },
  'odyle-stats': {
    label: 'Daily numbers',
    schedule: () => 'Daily at 23:55 UTC (' + localHour(23, 55) + ' here)',
    unit: 'days stored',
    about:
      "Stores the day's activation and feature-use totals shown under Server status, so their trend survives restarts; a run by hand replaces today's. Totals only, no account is recorded.",
  },
  'odyle-health': {
    label: 'Reader health',
    schedule: () => 'Every 5 minutes',
    unit: 'alerts posted',
    about:
      "Posts to the Discord webhook in ODYLE_ALERT_WEBHOOK when most apps connected to the game have read no Odyle for 10 minutes (a game patch, most likely) or readings arrive under a refused adapter, once when it starts and once when it clears. Without the variable it only keeps the readers' reports, which Server status shows.",
  },
  'odyle-cap-alerts': {
    label: 'Cap alerts',
    schedule: () => 'Hourly at :05',
    unit: 'alerts sent',
    about:
      "Tells players who turned cap alerts on when a character's natural pool, as the Odyle clock projects it, is about to reach its cap or is full: in their Windows app, open dashboards and by Web Push, outside their quiet hours. Never to rooms or Discord.",
  },
  'odyle-push': {
    label: 'Push reminders',
    schedule: () => 'Every minute',
    unit: 'notifications sent',
    about:
      'Sends planned-run reminders by Web Push to players going to a run who turned push on, at their reminder times and outside their quiet hours. Devices whose push service forgot them are removed.',
  },
  'odyle-party-ready': {
    label: 'Party ready',
    schedule: () => 'Every minute',
    unit: 'runs told',
    about:
      'From an hour before a planned run to half an hour after its start: once everyone going plays live with enough Odyle for a cube, tells each of them once (dashboards, Windows apps and push, by their notification settings).',
  },
  'odyle-armory': {
    label: 'Armory clean-up',
    schedule: () => 'Daily at 04:41 UTC (' + localHour(4, 41) + ' here)',
    unit: 'profiles and top players forgotten',
    about:
      "Deletes armory profiles nobody opened for 30 days, forgets the top players below their class's top 500 checked more than 30 days ago, and deletes the images no profile or top player names. Hidden ones stay, so the armory keeps them out. Then reads PLAYNC's class list again and downloads the class emblems the server lacks. Profiles are fetched from PLAYNC when readers open them, one at a time, not by this job.",
  },
  'odyle-armory-scout': {
    label: 'Armory scout',
    schedule: () => 'Every minute',
    unit: 'PLAYNC pages read',
    about:
      "PLAYNC lists no rankings for Global, so this builds the armory's top players by class: up to 5 pages a run, 10 seconds apart: the info pages of the characters it found, for their combat power; then those of each class's top 500 and the 250 below them whose combat power is 3 days old, and during a refresh (Server status) of every character read before it, the strongest first; then the characters Odyle's accounts play; then searches for the party and force members apps sent and the players met in PvP, by name; else PLAYNC's character search (random servers, classes and letters); while no reader waits, the gear of the strongest top-500 characters not read for 14 days or since the refresh, each of the scout's lanes one every 3 minutes at most, so they read at once. Paused with the armory, and while PLAYNC refuses the server.",
  },
  'odyle-release': {
    label: 'Release check',
    schedule: () => 'Every 2 minutes',
    unit: 'lookups',
    about:
      'Asks GitHub for the newest Windows release. A newer one is news for every open dashboard and running app at once, so run it by hand right after publishing a release.',
  },
  'odyle-announcement': {
    label: 'Announcement schedule',
    schedule: () => 'Every minute',
    unit: 'changes told',
    about:
      'When a scheduled announcement (Server controls) starts or ends, tells every open dashboard and running Windows app at once, so it shows or goes within a minute. A saved change is told when it is saved.',
  },
};
const skips = {
  paused: 'Skipped, paused under Server controls',
  off: 'Skipped, Game settings keep every account',
  clock: 'Skipped, the Odyle clock is hidden under Game settings',
};

export function jobsPage() {
  app.store.title = 'Background jobs';
  const state = store({ loading: true, failed: '', jobs: [], startedAt: '', offset: 0, now: Date.now(), starting: '' });
  const now = () => state.now + state.offset;
  let poll = 0,
    tick = 0;
  const accept = data => {
    if (!Array.isArray(data?.jobs)) return;
    state.offset = timestamp(data.serverNow) - Date.now();
    state.jobs = data.jobs;
    state.startedAt = data.startedAt;
    state.failed = '';
  };
  async function load() {
    try {
      accept(await app.pb.send('/api/odyle/admin/jobs', { requestKey: null }));
    } catch (error) {
      if (!error.isAbort) state.failed = error.message || 'The jobs could not be loaded.';
    }
    state.loading = false;
  }
  const summary = (job, result) =>
    result.skipped
      ? skips[result.skipped] || 'Skipped'
      : number(result.done || 0) +
        ' ' +
        jobInfo[job.name].unit +
        (result.failed ? ' · ' + number(result.failed) + ' failed' : '');
  async function start(job) {
    if (state.starting) return;
    state.starting = job.name;
    try {
      const data = await app.pb.send('/api/odyle/admin/jobs/' + encodeURIComponent(job.name), {
        method: 'POST',
        requestKey: null,
      });
      accept(data);
      app.toasts.success(jobInfo[job.name].label + ': ' + summary(job, data.result) + '.');
    } catch (error) {
      app.checkApiError(error);
    }
    state.starting = '';
  }
  const stateLabel = job =>
    job.state === 'paused'
      ? t.a(
          { href: '#/odyle/controls', className: 'label sm warning', title: 'Resume it under Server controls' },
          'Paused',
        )
      : job.state === 'off'
        ? t.span({ className: 'label sm' }, 'Off')
        : null;
  const fact = (label, ...value) =>
    t.div({ className: 'odyle-fact' }, t.div({ className: 'txt-hint txt-sm' }, label), ...value);
  // One card per job, keyed by its record: only a job that ran again is redrawn.
  const jobCard = job =>
    t.div(
      { rid: signature(job) + '@' + state.starting, className: 'odyle-job' },
      t.div(
        { className: 'flex odyle-job-head' },
        t.span({ className: 'txt-bold txt-lg' }, jobInfo[job.name].label),
        stateLabel(job),
        job.running ? t.span({ className: 'label sm info' }, 'Running') : null,
        t.div({ className: 'm-r-auto' }),
        t.span({ className: 'txt-hint txt-sm' }, jobInfo[job.name].schedule()),
        job.manual
          ? t.button(
              {
                type: 'button',
                className: () => 'btn sm secondary' + (state.starting === job.name ? ' loading' : ''),
                disabled: () => Boolean(state.starting) || job.state === 'paused' || job.running,
                title: job.state === 'paused' ? 'Paused under Server controls' : 'Run it now, outside its schedule',
                onclick: () => start(job),
              },
              t.i({ className: 'ri-play-line', ariaHidden: true }),
              t.span({ className: 'txt' }, 'Run now'),
            )
          : t.span({ className: 'label sm', title: 'It deletes accounts, so it never runs by hand' }, 'Schedule only'),
      ),
      t.div(
        { className: 'txt-hint txt-sm m-b-sm' },
        jobInfo[job.name].about,
        ' ',
        t.span({ className: 'txt-code' }, job.name),
      ),
      t.div(
        { className: 'odyle-facts' },
        fact(
          'Last run',
          job.lastRunAt
            ? [
                t.div({ title: when(job.lastRunAt) }, () => ago(job.lastRunAt, now())),
                t.div({ className: 'txt-hint txt-sm' }, number(job.ms) + ' ms' + (job.byHand ? ' · by hand' : '')),
              ]
            : t.div({ className: 'txt-hint' }, 'Not since the server started'),
        ),
        fact(
          'Result',
          job.lastRunAt
            ? t.div({ className: job.failed ? 'txt-danger' : job.skipped ? 'txt-hint' : '' }, summary(job, job))
            : t.div({ className: 'txt-hint' }, '—'),
        ),
        fact(
          'Since the server started',
          job.runs
            ? [
                t.div(
                  null,
                  number(job.runs) +
                    (job.runs === 1 ? ' run · ' : ' runs · ') +
                    number(job.totalDone) +
                    ' ' +
                    jobInfo[job.name].unit,
                ),
                job.failedRuns
                  ? t.div(
                      { className: 'txt-sm txt-danger' },
                      number(job.failedRuns) + (job.failedRuns === 1 ? ' run with failures' : ' runs with failures'),
                    )
                  : t.div({ className: 'txt-hint txt-sm' }, 'no failures'),
              ]
            : t.div({ className: 'txt-hint' }, '—'),
        ),
      ),
      // The last failure stays listed after later runs succeed.
      job.failedRuns
        ? t.div(
            { className: 'odyle-job-error' + (job.error ? ' current' : '') },
            t.span(
              { className: 'txt-sm txt-bold' },
              job.error ? 'Last run failed' : 'Last failure',
              ' ',
              t.span({ className: 'txt-hint', title: when(job.lastFailureAt) }, () => ago(job.lastFailureAt, now())),
            ),
            t.div({ className: 'odyle-error' }, job.lastError),
          )
        : null,
    );

  return layout(
    '#/odyle/jobs',
    app.components.refreshButton({ onclick: load }),
    t.div(
      {
        onmount: () => {
          load();
          poll = setInterval(load, 10000);
          tick = setInterval(() => (state.now = Date.now()), 1000);
        },
        onunmount: () => {
          clearInterval(poll);
          clearInterval(tick);
        },
      },
      () => (state.failed ? t.div({ className: 'alert danger m-b-sm' }, state.failed) : null),
      t.div(
        { className: 'flex m-b-sm' },
        t.div({ className: 'txt-lg' }, 'Scheduled jobs'),
        t.span({ className: 'txt-hint txt-sm', title: () => when(state.startedAt) }, () =>
          state.startedAt ? 'counted since the server started ' + ago(state.startedAt, now()) : '',
        ),
      ),
      t.div({ className: 'odyle-jobs m-b-base' }, () =>
        state.jobs.length
          ? state.jobs.map(jobCard)
          : t.div({ className: 'txt-hint txt-center' }, () => (state.loading ? 'Loading…' : 'No jobs.')),
      ),
      t.p(
        { className: 'txt-hint txt-sm' },
        'Each run is recorded in server memory, so a restart starts these counts over; details of every failure are also in the server log. The account clean-up only runs on its schedule.',
      ),
    ),
  );
}

// Both settings pages load the shared settings and save only their own fields, so one
// page never overwrites what the other changed. sync() refreshes text kept beside the form.
function settingsForm(keys, sync = () => {}) {
  const state = store({
    loading: true,
    saving: false,
    form: null,
    initial: 'null',
    data: null,
    get changed() {
      return state.initial !== JSON.stringify(state.form);
    },
  });
  const accept = data => {
    state.data = data;
    state.form = copy(Object.fromEntries(keys.map(key => [key, data.settings[key]])));
    state.initial = JSON.stringify(state.form);
    sync(state.form);
  };
  async function load() {
    try {
      accept(await app.pb.send('/api/odyle/admin/settings', { requestKey: null }));
      state.loading = false;
    } catch (error) {
      if (!error.isAbort) app.checkApiError(error);
    }
  }
  async function save(message) {
    if (state.saving || !state.changed) return;
    state.saving = true;
    try {
      accept(await app.pb.send('/api/odyle/admin/settings', { method: 'POST', body: state.form, requestKey: null }));
      app.toasts.success(message);
    } catch (error) {
      app.checkApiError(error);
    }
    state.saving = false;
  }
  const cancel = () => {
    state.form = JSON.parse(state.initial);
    sync(state.form);
  };
  // The newest change of the settings in the audit log, on either page.
  const changed = () => {
    const last = state.data?.lastChange;
    return last
      ? t.div(
          { className: 'col-lg-12 txt-hint txt-sm odyle-last-change' },
          'Last change ',
          t.span({ title: when(last.created) }, ago(last.created, timestamp(state.data.serverNow))),
          ' by ',
          last.actorEmail || 'a superuser',
          last.via === 'collections' ? ' under Collections' : '',
          ': ',
          last.summary,
          ' · ',
          t.a({ href: '#/odyle/audit?kind=settings' }, 'Audit log'),
        )
      : null;
  };
  const buttons = (...left) =>
    t.div(
      { className: 'col-lg-12' },
      t.div({ className: 'flex' }, ...left, t.div({ className: 'm-r-auto' }), () =>
        state.changed
          ? [
              t.button(
                { rid: 'cancel', type: 'button', className: 'btn transparent secondary', onclick: cancel },
                t.span({ className: 'txt' }, 'Cancel'),
              ),
              t.button(
                {
                  rid: 'save',
                  className: () => 'btn expanded-lg ' + (state.saving ? 'loading' : ''),
                  disabled: () => state.saving,
                },
                t.span({ className: 'txt' }, 'Save changes'),
              ),
            ]
          : null,
      ),
    );
  return { state, load, save, buttons, changed };
}

export function settingsPage() {
  app.store.title = 'Game settings';
  // Lines to add to the dungeon catalog at once (pasted or typed), and whether that box is open.
  const paste = store({ open: false, text: '' });
  // How many accounts the next clean-up would delete with the period in the form, saved or not.
  const retention = store({ days: null, data: null, failed: '' });
  let counting = 0;
  function countInactive(days) {
    clearTimeout(counting);
    Object.assign(retention, { days, data: null, failed: '' });
    if (!Number.isInteger(days) || days < 30 || days > 3650) return;
    counting = setTimeout(async () => {
      try {
        const data = await app.pb.send('/api/odyle/admin/retention', { query: { days }, requestKey: null });
        if (retention.days === days) retention.data = data;
      } catch (error) {
        if (!error.isAbort && retention.days === days)
          retention.failed = error.message || 'The inactive accounts could not be counted.';
      }
    }, 300);
  }
  const deletion = () => {
    const d = retention.data;
    if (retention.failed) return t.span({ className: 'txt-danger' }, retention.failed);
    if (!d) return null;
    const run = 'the next run at ' + String(d.runAt).slice(11, 16) + ' UTC (' + minuteLabel(d.runAt) + ' here)';
    return t.strong(
      null,
      !d.inactive
        ? 'With this period ' + run + ' would delete no account.'
        : 'With this period ' +
            run +
            ' would delete ' +
            number(d.deleted) +
            (d.deleted === 1 ? ' account' : ' accounts') +
            (d.inactive > d.deleted
              ? ', the first ' +
                number(d.deleted) +
                ' of ' +
                number(d.inactive) +
                ' unused that long; the rest follow on the next nights.'
              : '.'),
    );
  };
  const { state, load, save, buttons, changed } = settingsForm(
    [
      'odylePerCube',
      'dailyResetHour',
      'weeklyResetDay',
      'maintenance',
      'inactiveAccountDays',
      'historyDays',
      'locationDays',
      'pvpDays',
      'catalog',
      'classRoles',
      'clock',
      'taskTemplates',
      'slots',
      'maps',
    ],
    form => countInactive(form.inactiveAccountDays),
  );
  const integer = value => {
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  };
  // A kept period's help: what the expiry job keeps, or the allowed range.
  const kept = (days, before, after) =>
    Number.isInteger(days) && days >= 1 && days <= 3650
      ? before +
        number(days) +
        (days === 1 ? ' day' : ' days') +
        (days % 365 === 0 ? ' (' + number(days / 365) + (days === 365 ? ' year)' : ' years)') : '') +
        after +
        ' The expiry job deletes older ones every five minutes, so a shorter period applies at once.'
      : 'From 1 day to 3,650 days (ten years). 30 by default.';
  const lines = value =>
    value
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);
  const defaults = () => state.data?.defaults;
  // The dungeon catalog, one row per dungeon: cost 0 means Odyle per cube, party size 0 not
  // set. Names match regardless of case and spacing, as the server matches them.
  const sizes = [0, 4, 5, 10, 20],
    key = name => String(name).trim().replace(/\s+/g, ' ').toLowerCase();
  const dungeons = () => state.form.catalog;
  // The Odyle clock: lists of whole numbers typed as "1, 4, 7".
  const clock = () => state.form.clock || {};
  const numbers = value =>
    String(value)
      .split(/[\s,;]+/)
      .filter(Boolean)
      .map(part => integer(part))
      .filter(n => n !== null);
  const listed = list => (list || []).join(', ');
  function addDungeon() {
    dungeons().push({ name: '', cost: 0, partySize: 0, category: '', unconfirmed: false });
    const at = dungeons().length - 1;
    setTimeout(() => document.getElementById('odyle-dungeon-' + at + '-name')?.focus());
  }
  // A line of a list: name | Odyle per cube | party size | category | unconfirmed, split at
  // | or tabs (columns copied from a spreadsheet); only the name is needed.
  function fromLine(line) {
    const [name = '', cost = '', size = '', category = '', mark = ''] = line.split(/\t|\|/).map(part => part.trim());
    return {
      name,
      cost: integer(cost) ?? 0,
      partySize: sizes.includes(integer(size)) ? integer(size) : 0,
      category,
      unconfirmed: /^(unconfirmed|yes|true|x|\?)$/i.test(mark),
    };
  }
  // A dungeon the table already lists takes the values of its line and keeps its spelling.
  function addLines() {
    for (const entry of lines(paste.text).map(fromLine)) {
      const at = dungeons().findIndex(d => key(d.name) === key(entry.name));
      if (at < 0) dungeons().push(entry);
      else dungeons()[at] = { ...entry, name: dungeons()[at].name };
    }
    Object.assign(paste, { open: false, text: '' });
  }
  const cell = (className, ...content) => t.td({ className }, t.div({ className: 'field' }, ...content));
  // Class roles (#45): each class's role in a party, for the make-up of planned runs. Classes are
  // named as PLAYNC names them; the armory learns new ones (the answer's `classes`).
  const partyRoles = ['tank', 'healer', 'support', 'damage'];
  const roles = () => state.form.classRoles || (state.form.classRoles = []);
  const unmapped = () => (state.data?.classes || []).filter(name => !roles().some(r => key(r.class) === key(name)));
  function addRole(name) {
    roles().push({ class: name, role: 'damage' });
    const at = roles().length - 1;
    setTimeout(() => document.getElementById('odyle-role-' + at + (name ? '-role' : '-class'))?.focus());
  }
  const roleRow = (r, i) =>
    t.tr(
      { className: 'rate-limit-row' },
      cell(
        'col-label',
        t.input({
          id: 'odyle-role-' + i + '-class',
          type: 'text',
          required: true,
          maxLength: 40,
          placeholder: 'Class',
          ariaLabel: 'Class',
          'html-list': 'odyle-classes',
          value: () => r.class,
          oninput: e => (r.class = e.target.value),
        }),
      ),
      cell(
        'odyle-col-role',
        t.select(
          { id: 'odyle-role-' + i + '-role', ariaLabel: 'Role', onchange: e => (r.role = e.target.value) },
          partyRoles.map(role => t.option({ value: role, selected: () => r.role === role }, capital(role))),
        ),
      ),
      t.td(
        { className: 'col-action' },
        t.button(
          {
            type: 'button',
            className: 'btn sm secondary transparent circle',
            title: 'Remove',
            ariaLabel: () => 'Remove ' + (r.class.trim() || 'this class'),
            onclick: () => roles().splice(i, 1),
          },
          t.i({ className: 'ri-close-line', ariaHidden: true }),
        ),
      ),
    );
  // Game maps (location sharing): the game names maps by id only. Superusers name them and link each
  // to a map of TH.GL's AION 2 site, which the dashboard embeds; ids seen without a name are listed.
  // TH.GL's maps come with the places each lists (the answer's thglMaps, thgl.go).
  const thglMaps = () => state.data?.thglMaps || [];
  const placeKey = name => key(String(name).replace(/’/g, "'"));
  const thglNamed = name => thglMaps().find(m => placeKey(m.name) === placeKey(name));
  function thglOf(place) {
    const listing = thglMaps().filter(m => m.places.some(p => placeKey(p) === placeKey(place)));
    return thglNamed(place)?.name || (listing.length === 1 ? listing[0].name : '');
  }
  // What the server fills in when it saves (linkMap), filled in as soon as a field is left: a name
  // TH.GL lists links its map, and a TH.GL map of one place names the row.
  function linkLeftOut(m) {
    if (!m.thgl.trim() && m.name.trim()) m.thgl = thglOf(m.name);
    const known = thglNamed(m.thgl);
    if (!known) return;
    m.thgl = known.name;
    if (!m.name.trim() && known.places.length === 1) m.name = known.places[0];
  }
  const maps = () => state.form.maps || (state.form.maps = []);
  // A row keeps its elements while others are added or removed (rid), under ids of its own, so
  // adding a map draws one row instead of all of them, and a field being typed in stays.
  const rowKeys = new WeakMap();
  let rows = 0;
  const rowKey = m => rowKeys.get(m) ?? rowKeys.set(m, rows++).get(m);
  // Ids already in the table are not offered again; the list follows the ids typed, not the names.
  const unnamed = () => {
    const listed = new Set(maps().map(m => m.id));
    return (state.data?.unnamedMaps || []).filter(seen => !listed.has(seen.id));
  };
  function addMap(id) {
    let m = maps().find(row => id && row.id === id);
    if (!m) {
      maps().push({ id: id || null, name: '', thgl: '' });
      m = maps()[maps().length - 1];
    }
    setTimeout(() => document.getElementById('odyle-map-' + rowKey(m) + (id ? '-name' : '-id'))?.focus());
  }
  const mapRow = m => {
    const at = 'odyle-map-' + rowKey(m);
    return t.tr(
      { rid: m, className: 'rate-limit-row' },
      cell(
        'odyle-col-map',
        t.input({
          id: at + '-id',
          type: 'number',
          min: 1,
          max: 9999999,
          step: 1,
          required: true,
          placeholder: 'Map id',
          ariaLabel: 'Map id',
          value: () => m.id ?? '',
          oninput: e => (m.id = integer(e.target.value)),
        }),
      ),
      cell(
        'col-label',
        t.input({
          id: at + '-name',
          type: 'text',
          maxLength: 60,
          placeholder: 'Name',
          ariaLabel: 'Name',
          'html-list': 'odyle-thgl-places',
          value: () => m.name,
          oninput: e => (m.name = e.target.value),
          onchange: () => linkLeftOut(m),
        }),
      ),
      cell(
        'odyle-col-thgl',
        t.input({
          id: at + '-thgl',
          type: 'text',
          maxLength: 120,
          placeholder: 'TH.GL map',
          ariaLabel: 'TH.GL map',
          'html-list': 'odyle-thgl-maps',
          title: () => m.thgl,
          value: () => m.thgl,
          oninput: e => (m.thgl = e.target.value),
          onchange: () => linkLeftOut(m),
        }),
      ),
      t.td(
        { className: 'col-action' },
        t.button(
          {
            type: 'button',
            className: 'btn sm secondary transparent circle',
            title: 'Remove',
            ariaLabel: () => 'Remove ' + (m.name.trim() || 'map ' + (m.id ?? '')),
            onclick: () => maps().includes(m) && maps().splice(maps().indexOf(m), 1),
          },
          t.i({ className: 'ri-close-line', ariaHidden: true }),
        ),
      ),
    );
  };
  // The Global task list (#38): daily and weekly tasks players add to their checklists in one go.
  const templates = () => state.form.taskTemplates || (state.form.taskTemplates = []);
  function addTemplate() {
    templates().push({ title: '', cadence: 'daily' });
    const at = templates().length - 1;
    setTimeout(() => document.getElementById('odyle-template-' + at + '-title')?.focus());
  }
  const templateRow = (task, i) =>
    t.tr(
      { className: 'rate-limit-row' },
      cell(
        'col-label',
        t.input({
          id: 'odyle-template-' + i + '-title',
          type: 'text',
          required: true,
          maxLength: 60,
          placeholder: 'Task',
          ariaLabel: 'Task',
          value: () => task.title,
          oninput: e => (task.title = e.target.value),
        }),
      ),
      cell(
        'odyle-col-cadence',
        t.select(
          {
            id: 'odyle-template-' + i + '-cadence',
            ariaLabel: 'Cadence',
            onchange: e => (task.cadence = e.target.value),
          },
          ['daily', 'weekly'].map(c => t.option({ value: c, selected: () => task.cadence === c }, capital(c))),
        ),
      ),
      t.td(
        { className: 'col-action' },
        t.button(
          {
            type: 'button',
            className: 'btn sm secondary transparent circle',
            title: 'Remove',
            ariaLabel: () => 'Remove ' + (task.title.trim() || 'this task'),
            onclick: () => templates().splice(i, 1),
          },
          t.i({ className: 'ri-close-line', ariaHidden: true }),
        ),
      ),
    );
  const dungeonRow = (d, i) =>
    t.tr(
      { className: 'rate-limit-row' },
      cell(
        'col-label',
        t.input({
          id: 'odyle-dungeon-' + i + '-name',
          type: 'text',
          required: true,
          maxLength: 60,
          placeholder: 'Dungeon name',
          ariaLabel: 'Dungeon name',
          value: () => d.name,
          oninput: e => (d.name = e.target.value),
        }),
      ),
      cell(
        'odyle-col-cost',
        t.input({
          id: 'odyle-dungeon-' + i + '-cost',
          type: 'number',
          min: 0,
          max: 1000,
          step: 1,
          ariaLabel: 'Odyle per cube',
          placeholder: () => 'Default ' + (state.form.odylePerCube ?? ''),
          value: () => d.cost || '',
          oninput: e => (d.cost = integer(e.target.value) ?? 0),
        }),
      ),
      cell(
        'odyle-col-party',
        t.select(
          {
            id: 'odyle-dungeon-' + i + '-party',
            ariaLabel: 'Party size',
            onchange: e => (d.partySize = Number(e.target.value)),
          },
          sizes.map(n => t.option({ value: String(n), selected: () => d.partySize === n }, n ? String(n) : '–')),
        ),
      ),
      cell(
        'odyle-col-category',
        t.input({
          id: 'odyle-dungeon-' + i + '-category',
          type: 'text',
          maxLength: 30,
          placeholder: 'Category',
          ariaLabel: 'Category',
          'html-list': 'odyle-categories',
          value: () => d.category,
          oninput: e => (d.category = e.target.value),
        }),
      ),
      cell(
        'odyle-col-mark',
        t.input({
          id: 'odyle-dungeon-' + i + '-unconfirmed',
          type: 'checkbox',
          checked: () => d.unconfirmed,
          onchange: e => (d.unconfirmed = e.target.checked),
        }),
        t.label({ htmlFor: 'odyle-dungeon-' + i + '-unconfirmed' }, 'Unconfirmed'),
      ),
      t.td(
        { className: 'col-action' },
        t.button(
          {
            type: 'button',
            className: 'btn sm secondary transparent circle',
            title: 'Remove',
            ariaLabel: () => 'Remove ' + (d.name.trim() || 'this dungeon'),
            onclick: () => dungeons().splice(i, 1),
          },
          t.i({ className: 'ri-close-line', ariaHidden: true }),
        ),
      ),
    );
  load();
  return layout('#/odyle/settings', null, () =>
    state.loading
      ? t.div({ className: 'block txt-center' }, t.span({ className: 'loader lg' }))
      : t.form(
          {
            className: 'grid',
            inert: () => state.saving,
            onsubmit: e => {
              e.preventDefault();
              save('Saved the Odyle game settings.');
            },
          },
          t.div(
            { className: 'col-lg-12 txt-lg' },
            t.p(null, 'Server-wide rules for every room, the dashboard and the Windows app.'),
          ),
          changed,
          field(
            'odyle-per-cube',
            'Odyle per cube',
            t.input({
              id: 'odyle-per-cube',
              type: 'number',
              min: 1,
              max: 1000,
              step: 1,
              required: true,
              value: () => state.form.odylePerCube ?? '',
              oninput: e => (state.form.odylePerCube = integer(e.target.value)),
            }),
            'What one dungeon cube costs. Every room reports it as its cost and counts cubes with it; open dashboards follow within 15 seconds.',
          ),
          field(
            'odyle-daily-reset',
            'Daily reset (hour, UTC)',
            t.input({
              id: 'odyle-daily-reset',
              type: 'number',
              min: 0,
              max: 23,
              step: 1,
              required: true,
              value: () => state.form.dailyResetHour ?? '',
              oninput: e => (state.form.dailyResetHour = integer(e.target.value)),
            }),
            () =>
              Number.isInteger(state.form.dailyResetHour) &&
              state.form.dailyResetHour >= 0 &&
              state.form.dailyResetHour < 24
                ? 'Daily tasks uncheck at ' +
                  String(state.form.dailyResetHour).padStart(2, '0') +
                  ':00 UTC, ' +
                  localHour(state.form.dailyResetHour) +
                  ' in your time zone.'
                : 'An hour from 0 to 23.',
          ),
          field(
            'odyle-weekly-reset',
            'Weekly reset day',
            app.components.select({
              id: 'odyle-weekly-reset',
              required: true,
              options: days.map(d => ({ label: capital(d), value: d })),
              value: () => state.form.weeklyResetDay,
              onchange: e => (state.form.weeklyResetDay = e?.[0]?.value),
            }),
            'Weekly tasks uncheck on this day at the daily reset hour.',
          ),
          field(
            'odyle-maintenance-day',
            'Weekly maintenance',
            app.components.select({
              id: 'odyle-maintenance-day',
              options: [{ label: 'None', value: '' }, ...days.map(d => ({ label: capital(d), value: d }))],
              value: () => state.form.maintenance?.day || '',
              onchange: e =>
                (state.form.maintenance = { hour: 6, hours: 3, ...state.form.maintenance, day: e?.[0]?.value || '' }),
            }),
            "The game's regular maintenance. Planned runs that fall into it say so in every room.",
          ),
          field(
            'odyle-maintenance-hour',
            'Maintenance starts (hour, UTC)',
            t.input({
              id: 'odyle-maintenance-hour',
              type: 'number',
              min: 0,
              max: 23,
              step: 1,
              disabled: () => !state.form.maintenance?.day,
              value: () => (state.form.maintenance?.day ? state.form.maintenance.hour : ''),
              oninput: e => (state.form.maintenance = { ...state.form.maintenance, hour: integer(e.target.value) }),
            }),
            () =>
              state.form.maintenance?.day
                ? 'Starts at ' +
                  String(state.form.maintenance.hour).padStart(2, '0') +
                  ':00 UTC, ' +
                  localHour(state.form.maintenance.hour) +
                  ' in your time zone.'
                : 'Set a day first.',
          ),
          field(
            'odyle-maintenance-hours',
            'Maintenance lasts (hours)',
            t.input({
              id: 'odyle-maintenance-hours',
              type: 'number',
              min: 1,
              max: 12,
              step: 1,
              disabled: () => !state.form.maintenance?.day,
              value: () => (state.form.maintenance?.day ? state.form.maintenance.hours : ''),
              oninput: e => (state.form.maintenance = { ...state.form.maintenance, hours: integer(e.target.value) }),
            }),
            'From 1 to 12 hours.',
          ),
          field(
            'odyle-inactive',
            'Delete inactive accounts after (days)',
            t.input({
              id: 'odyle-inactive',
              type: 'number',
              min: 0,
              max: 3650,
              step: 1,
              required: true,
              value: () => state.form.inactiveAccountDays ?? '',
              oninput: e => {
                state.form.inactiveAccountDays = integer(e.target.value);
                countInactive(state.form.inactiveAccountDays);
              },
            }),
            () =>
              state.form.inactiveAccountDays
                ? [
                    'Every night, accounts that have not used the dashboard or the Windows app for ' +
                      number(state.form.inactiveAccountDays) +
                      ' days are deleted with their characters; rooms they own pass to another player or close. ',
                    deletion(),
                  ]
                : '0 keeps every account. Set 30 days or more to delete accounts that stopped using Odyle.',
          ),
          // How long the Odyle history, the places of location sharing and PvP events are kept (1 day to ten years).
          field(
            'odyle-history-days',
            'Keep Odyle history (days)',
            t.input({
              id: 'odyle-history-days',
              type: 'number',
              min: 1,
              max: 3650,
              step: 1,
              required: true,
              value: () => state.form.historyDays ?? '',
              oninput: e => (state.form.historyDays = integer(e.target.value)),
            }),
            () =>
              kept(
                state.form.historyDays,
                "Each change of a character's Odyle is kept for ",
                ', and players can chart and page through all of it. Longer periods take more disk space.',
              ),
          ),
          field(
            'odyle-location-days',
            'Keep places (days)',
            t.input({
              id: 'odyle-location-days',
              type: 'number',
              min: 1,
              max: 3650,
              step: 1,
              required: true,
              value: () => state.form.locationDays ?? '',
              oninput: e => (state.form.locationDays = integer(e.target.value)),
            }),
            () =>
              kept(
                state.form.locationDays,
                'Each place a player shares with location sharing is kept for ',
                '. Players see the period on their account page; turning sharing off still deletes their places at once.',
              ),
          ),
          field(
            'odyle-pvp-days',
            'Keep PvP events (days)',
            t.input({
              id: 'odyle-pvp-days',
              type: 'number',
              min: 1,
              max: 3650,
              step: 1,
              required: true,
              value: () => state.form.pvpDays ?? '',
              oninput: e => (state.form.pvpDays = integer(e.target.value)),
            }),
            () =>
              kept(
                state.form.pvpDays,
                'Each kill, assist and death of a player with PvP stats on is kept for ',
                ', with the name of the other player. Players see the period on their account page; turning PvP stats off still deletes their events at once.',
              ),
          ),
          section(
            'Dungeon catalog',
            'The dungeons rooms choose from for wishlists and planned runs, with what opening one cube of each costs. Rooms show the cost and how many cubes the party can open.',
          ),
          t.div(
            { className: 'col-lg-12' },
            t.div(
              { className: 'rate-limit-table-wrapper' },
              t.table(
                { className: 'rate-limit-table odyle-catalog' },
                t.thead(
                  { hidden: () => !dungeons().length },
                  t.tr(
                    null,
                    t.th({ className: 'col-label' }, 'Dungeon'),
                    t.th(null, 'Odyle per cube'),
                    t.th(null, 'Party'),
                    t.th(null, 'Category'),
                    t.th(null),
                    t.th({ className: 'col-action' }),
                  ),
                ),
                t.tbody(
                  null,
                  () => dungeons().map(dungeonRow),
                  t.tr(
                    { className: 'rate-limit-row' },
                    t.td(
                      { colSpan: 99, className: 'col-new-btn' },
                      t.button(
                        {
                          type: 'button',
                          className: 'btn secondary sm full-width',
                          disabled: () => dungeons().length >= 200,
                          onclick: addDungeon,
                        },
                        t.i({ className: 'ri-add-line', ariaHidden: true }),
                        t.span({ className: 'txt' }, 'Add dungeon'),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            t.datalist({ id: 'odyle-categories' }, () =>
              [
                ...new Set(
                  dungeons()
                    .map(d => d.category.trim())
                    .filter(Boolean),
                ),
              ].map(category => t.option({ value: category })),
            ),
            t.div({ className: 'field-help' }, () =>
              dungeons().length
                ? number(dungeons().length) +
                  (dungeons().length === 1 ? ' dungeon' : ' dungeons') +
                  '. New wishlist entries and planned runs must be one of them and take this spelling; existing entries stay. An empty cost uses Odyle per cube; mark a cost you have not checked in game as unconfirmed, and rooms say so.'
                : 'Empty: wishlists and planned runs take any dungeon name. Up to 200 dungeons.',
            ),
            t.button(
              {
                type: 'button',
                className: () => 'btn sm secondary m-t-sm ' + (paste.open ? '' : 'transparent'),
                onclick: () => (paste.open = !paste.open),
              },
              t.span({ className: 'txt' }, 'Add several from a list'),
              t.i({ ariaHidden: true, className: () => (paste.open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line') }),
            ),
            () =>
              paste.open
                ? t.div(
                    { className: 'm-t-sm' },
                    t.div(
                      { className: 'field' },
                      t.label({ htmlFor: 'odyle-dungeons' }, 'One dungeon per line'),
                      t.textarea({
                        id: 'odyle-dungeons',
                        rows: 6,
                        placeholder: 'Krao Cave | 20 | 5 | Exploration | unconfirmed',
                        value: () => paste.text,
                        oninput: e => (paste.text = e.target.value),
                      }),
                    ),
                    t.div(
                      { className: 'field-help' },
                      'Name | Odyle per cube | party size | category | unconfirmed; only the name is needed, and columns copied from a spreadsheet work too. A dungeon already in the table takes the values of its line. docs/deployment.md suggests a list for Global.',
                    ),
                    t.button(
                      {
                        type: 'button',
                        className: 'btn sm m-t-sm',
                        disabled: () => !lines(paste.text).length,
                        onclick: addLines,
                      },
                      t.span({ className: 'txt' }, 'Add to the catalog'),
                    ),
                  )
                : null,
          ),
          section(
            'Class roles',
            "Each class's role in a party. Planned runs show their party's make-up by class and say when three or more going have no tank or no healer. Classes come from PLAYNC only; players never choose them.",
          ),
          t.div(
            { className: 'col-lg-12' },
            t.div(
              { className: 'rate-limit-table-wrapper' },
              t.table(
                { className: 'rate-limit-table odyle-roles' },
                t.thead(
                  { hidden: () => !roles().length },
                  t.tr(
                    null,
                    t.th({ className: 'col-label' }, 'Class'),
                    t.th(null, 'Role'),
                    t.th({ className: 'col-action' }),
                  ),
                ),
                t.tbody(
                  null,
                  () => roles().map(roleRow),
                  t.tr(
                    { className: 'rate-limit-row' },
                    t.td(
                      { colSpan: 99, className: 'col-new-btn' },
                      t.button(
                        {
                          type: 'button',
                          className: 'btn secondary sm full-width',
                          disabled: () => roles().length >= 40,
                          onclick: () => addRole(''),
                        },
                        t.i({ className: 'ri-add-line', ariaHidden: true }),
                        t.span({ className: 'txt' }, 'Add class'),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            t.datalist({ id: 'odyle-classes' }, () =>
              (state.data?.classes || []).map(name => t.option({ value: name })),
            ),
            t.div({ className: 'field-help' }, () =>
              roles().length
                ? number(roles().length) +
                  (roles().length === 1 ? ' class' : ' classes') +
                  ' with a role. A class missing here shows in the make-up without one.'
                : 'Empty: runs show their classes without roles and never miss a tank or a healer.',
            ),
            () =>
              unmapped().length
                ? t.div(
                    { className: 'field-help' },
                    'Learned from PLAYNC without a role: ',
                    ...unmapped().map(name =>
                      t.button(
                        {
                          type: 'button',
                          className: 'btn sm secondary transparent',
                          disabled: () => roles().length >= 40,
                          onclick: () => addRole(name),
                        },
                        t.span({ className: 'txt' }, name),
                      ),
                    ),
                  )
                : null,
            t.button(
              {
                type: 'button',
                className: 'btn sm secondary transparent m-t-sm',
                onclick: () => (state.form.classRoles = copy(defaults().classRoles)),
              },
              t.span({ className: 'txt' }, 'Use the default roles'),
            ),
          ),
          section(
            'Maps',
            "Location sharing shows where players who turned it on were last seen. The game names its maps by id only: name each one after its place, and the TH.GL map that shows it links by itself when TH.GL lists the place (Altgard, Valka's Nest). Or pick one of TH.GL's maps: one that shows a single place also names the row. A map TH.GL adds later is its name in the address (aion2.th.gl/maps/<name>). Never copy names from other projects' tables.",
          ),
          t.div(
            { className: 'col-lg-12' },
            t.div(
              { className: 'rate-limit-table-wrapper' },
              t.table(
                { className: 'rate-limit-table odyle-maps' },
                t.thead(
                  { hidden: () => !maps().length },
                  t.tr(
                    null,
                    t.th(null, 'Map id'),
                    t.th({ className: 'col-label' }, 'Name'),
                    t.th(null, 'TH.GL map'),
                    t.th({ className: 'col-action' }),
                  ),
                ),
                t.tbody(
                  null,
                  () => maps().map(mapRow),
                  t.tr(
                    { className: 'rate-limit-row' },
                    t.td(
                      { colSpan: 99, className: 'col-new-btn' },
                      t.button(
                        {
                          type: 'button',
                          className: 'btn secondary sm full-width',
                          disabled: () => maps().length >= 500,
                          onclick: () => addMap(null),
                        },
                        t.i({ className: 'ri-add-line', ariaHidden: true }),
                        t.span({ className: 'txt' }, 'Add a map'),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            t.datalist({ id: 'odyle-thgl-maps' }, () => thglMaps().map(m => t.option({ value: m.name }))),
            t.datalist({ id: 'odyle-thgl-places' }, () =>
              [...new Set(thglMaps().flatMap(m => m.places))].map(place => t.option({ value: place })),
            ),
            t.div({ className: 'field-help' }, () =>
              maps().length
                ? number(maps().length) +
                  (maps().length === 1 ? ' map' : ' maps') +
                  '. Players see a map without a name as its id; one without a TH.GL map has no map to open.'
                : 'Empty: players see map ids instead of names.',
            ),
            // The buttons stay while the list changes (rid), so a click is never lost to a redraw.
            t.div(
              { className: 'field-help', hidden: () => !unnamed().length },
              'Seen in the last 30 days without a name: ',
              () =>
                unnamed().map(seen =>
                  t.button(
                    {
                      rid: seen,
                      type: 'button',
                      className: 'btn sm secondary transparent',
                      title: () =>
                        number(seen.characters) +
                        (seen.characters === 1 ? ' character, last ' : ' characters, last ') +
                        when(seen.lastAt),
                      onclick: () => addMap(seen.id),
                    },
                    t.span({ className: 'txt' }, String(seen.id)),
                  ),
                ),
            ),
          ),
          section(
            'Global task list',
            'Daily and weekly tasks of the game that players add to their checklists in one go, for their account or one of their characters. Players can still add their own.',
          ),
          t.div(
            { className: 'col-lg-12' },
            t.div(
              { className: 'rate-limit-table-wrapper' },
              t.table(
                { className: 'rate-limit-table odyle-templates' },
                t.thead(
                  { hidden: () => !templates().length },
                  t.tr(
                    null,
                    t.th({ className: 'col-label' }, 'Task'),
                    t.th(null, 'Cadence'),
                    t.th({ className: 'col-action' }),
                  ),
                ),
                t.tbody(
                  null,
                  () => templates().map(templateRow),
                  t.tr(
                    { className: 'rate-limit-row' },
                    t.td(
                      { colSpan: 99, className: 'col-new-btn' },
                      t.button(
                        {
                          type: 'button',
                          className: 'btn secondary sm full-width',
                          disabled: () => templates().length >= 100,
                          onclick: addTemplate,
                        },
                        t.i({ className: 'ri-add-line', ariaHidden: true }),
                        t.span({ className: 'txt' }, 'Add task'),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            t.div({ className: 'field-help' }, () =>
              templates().length
                ? number(templates().length) +
                  (templates().length === 1 ? ' task' : ' tasks') +
                  ' on the Global list. It applies to tasks added from now on; tasks players added stay as they are.'
                : 'Empty: players add their own tasks only. Up to 100 tasks, each title once.',
            ),
          ),
          section(
            'Odyle clock',
            "The natural pool regenerates at fixed UTC hours up to a cap. Dashboards and the Windows app show from these rules when the next tick comes, when the pool is full and an estimate for characters not read right now; they never store it. Each character's own readings refine it: the size of its last regeneration tick, and the cap its fullest natural pool of the last 30 days fits under.",
          ),
          field(
            'odyle-clock-hours',
            'Regeneration hours (UTC)',
            t.input({
              id: 'odyle-clock-hours',
              type: 'text',
              required: true,
              value: () => listed(clock().tickHours),
              onchange: e => (state.form.clock = { ...clock(), tickHours: numbers(e.target.value) }),
            }),
            () =>
              (clock().tickHours || []).length
                ? 'Ticks at ' +
                  clock()
                    .tickHours.map(h => String(h).padStart(2, '0') + ':00')
                    .join(', ') +
                  ' UTC; the first is ' +
                  localHour(clock().tickHours[0]) +
                  ' in your time zone.'
                : 'Whole UTC hours, separated by commas.',
          ),
          field(
            'odyle-clock-tick',
            'Odyle per tick',
            t.input({
              id: 'odyle-clock-tick',
              type: 'number',
              min: 1,
              max: 1000,
              step: 1,
              required: true,
              value: () => clock().tick ?? '',
              oninput: e => (state.form.clock = { ...clock(), tick: integer(e.target.value) }),
            }),
            "Used until a character's own regeneration ticks show another size.",
          ),
          field(
            'odyle-clock-caps',
            'Natural pool caps',
            t.input({
              id: 'odyle-clock-caps',
              type: 'text',
              required: true,
              value: () => listed(clock().caps),
              onchange: e => (state.form.clock = { ...clock(), caps: numbers(e.target.value) }),
            }),
            'Smallest first, for example 560 without the membership and 840 with it. A character counts under the smallest cap its fullest natural pool fits under.',
          ),
          t.div(
            { className: 'col-lg-12' },
            t.div(
              { className: 'field form-field-toggle' },
              t.input({
                id: 'odyle-clock-paused',
                type: 'checkbox',
                checked: () => Boolean(clock().paused),
                onchange: e => (state.form.clock = { ...clock(), paused: e.target.checked }),
              }),
              t.label({ htmlFor: 'odyle-clock-paused' }, 'Hide the Odyle clock'),
            ),
            t.div(
              { className: 'field-help' },
              'Turns off every estimate (next tick, full at, projected values) on dashboards and in the Windows app, for example after a game patch moved the schedule.',
            ),
          ),
          section(
            'Slot machine',
            'The easter egg of the dashboard (the logo clicked seven times): spins win cosmetics players wear next to their names in rooms. Nothing touches Odyle or characters.',
          ),
          field(
            'odyle-slots-daily',
            'Free spins a day',
            t.input({
              id: 'odyle-slots-daily',
              type: 'number',
              min: 0,
              max: 20,
              step: 1,
              required: true,
              value: () => state.form.slots?.dailySpins ?? '',
              oninput: e => (state.form.slots = { ...state.form.slots, dailySpins: integer(e.target.value) }),
            }),
            'Every account has these each day from the daily reset; unused ones do not carry over. 0 turns them off.',
          ),
          field(
            'odyle-slots-character',
            'Spins per character read',
            t.input({
              id: 'odyle-slots-character',
              type: 'number',
              min: 0,
              max: 10,
              step: 1,
              required: true,
              value: () => state.form.slots?.perCharacter ?? '',
              oninput: e => (state.form.slots = { ...state.form.slots, perCharacter: integer(e.target.value) }),
            }),
            'Earned once a day for each character the reader reads; these carry over. 0 turns them off.',
          ),
          t.div({ className: 'col-lg-12' }, t.hr()),
          // Resets the game rules only; the retention period and the dungeon catalog stay.
          buttons(
            t.button(
              {
                type: 'button',
                className: 'btn transparent secondary',
                onclick: () =>
                  (state.form = {
                    ...state.form,
                    odylePerCube: defaults().odylePerCube,
                    dailyResetHour: defaults().dailyResetHour,
                    weeklyResetDay: defaults().weeklyResetDay,
                    clock: { ...defaults().clock },
                    slots: { ...defaults().slots },
                  }),
              },
              t.span(
                { className: 'txt' },
                () =>
                  'Use defaults (' +
                  number(defaults()?.odylePerCube) +
                  ' · ' +
                  String(defaults()?.dailyResetHour ?? '').padStart(2, '0') +
                  ':00 UTC · ' +
                  capital(defaults()?.weeklyResetDay || '') +
                  ')',
              ),
            ),
          ),
        ),
  );
}

export function controlsPage() {
  app.store.title = 'Server controls';
  // extra is the extra adapter list as typed; form.adapters.extra is the list it saves.
  const text = store({ extra: '', blocked: '' });
  const { state, load, save, buttons, changed } = settingsForm(
    [
      'announcement',
      'announcementLevel',
      'announcementFrom',
      'announcementUntil',
      'portraitsPaused',
      'remindersPaused',
      'pairingPaused',
      'readerPaused',
      'armoryPaused',
      'armoryLanes',
      'scoutLanes',
      'aiPaused',
      'aiModel',
      'aiQuestions',
      'aiWeb',
      'adapters',
      'windowsBlocked',
    ],
    form => {
      text.extra = form.adapters.extra.join('\n');
      text.blocked = (form.windowsBlocked || []).join('\n');
      ai.key = '';
    },
  );
  // The armory AI (backend/odyle/armoryai.go, aiaccess.go): the API key typed (sent with the other
  // changes, never shown again), the accounts that may use it with what they asked, and the search
  // for accounts to let use it. Access changes at once, apart from Save changes.
  const ai = store({ key: '', data: null, query: '', found: null, busy: '' });
  const keyHint = () => state.data?.settings?.aiKeyHint || '';
  const typedKey = value => {
    ai.key = value;
    if (value.trim()) state.form.aiKey = value.trim();
    else delete state.form.aiKey;
  };
  async function loadAi() {
    try {
      ai.data = await app.pb.send('/api/odyle/admin/ai', { requestKey: null });
    } catch (error) {
      if (!error.isAbort) app.checkApiError(error);
    }
  }
  async function findAccounts() {
    const query = ai.query.trim();
    if (!query) return (ai.found = null);
    try {
      ai.found = (
        await app.pb.send('/api/odyle/admin/ai/accounts', { query: { q: query }, requestKey: null })
      ).accounts;
    } catch (error) {
      app.checkApiError(error);
    }
  }
  async function setAccess(account, allowed) {
    if (ai.busy) return;
    ai.busy = account.id;
    try {
      ai.data = await app.pb.send('/api/odyle/admin/ai/access', {
        method: 'POST',
        body: { user: account.id, allowed },
        requestKey: null,
      });
      if (ai.found) ai.found = ai.found.map(a => (a.id === account.id ? { ...a, allowed } : a));
      app.toasts.success(
        allowed
          ? account.displayName + ' may use the armory AI.'
          : account.displayName + ' may no longer use the armory AI.',
      );
    } catch (error) {
      app.checkApiError(error);
    }
    ai.busy = '';
  }
  const tokens = n => (typeof n === 'number' ? (n >= 1e6 ? (n / 1e6).toFixed(1) + ' M' : number(n)) : '—');
  const accessButton = a =>
    t.button(
      {
        type: 'button',
        className: () =>
          'btn sm ' + (a.allowed ? 'transparent danger' : 'secondary') + (ai.busy === a.id ? ' loading' : ''),
        disabled: () => Boolean(ai.busy),
        onclick: () => setAccess(a, !a.allowed),
      },
      t.span({ className: 'txt' }, a.allowed ? 'Remove access' : 'Let use the AI'),
    );
  const accountRow = a =>
    t.tr(
      { rid: a.id + a.allowed + a.asked30d },
      t.td(null, a.displayName, a.allowed ? null : ' ', t.span({ className: 'label sm' }, 'no access')),
      t.td({ className: 'txt-right' }, number(a.asked24h)),
      t.td({ className: 'txt-right' }, number(a.asked30d)),
      t.td({ className: 'txt-right txt-nowrap' }, tokens(a.inputTokens30d) + ' / ' + tokens(a.outputTokens30d)),
      t.td(
        { className: 'txt-nowrap', title: when(a.lastAt) },
        a.lastAt ? ago(a.lastAt, timestamp(state.data?.serverNow)) : '—',
      ),
      t.td({ className: 'txt-right' }, accessButton(a)),
    );
  // The announcement's schedule as the form holds it, saved or not: shown now, waiting for its
  // start, over, or impossible.
  const shortTime = ms =>
    new Date(ms).toLocaleString([], {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  function timing() {
    const from = timestamp(state.form.announcementFrom),
      until = timestamp(state.form.announcementUntil),
      at = Date.now();
    const end = Number.isFinite(until) ? ' until ' + shortTime(until) : '';
    if (Number.isFinite(from) && Number.isFinite(until) && until <= from)
      return { className: 'txt-danger', text: 'The end must come after the start.' };
    if (Number.isFinite(until) && until <= at)
      return {
        className: 'txt-bold',
        text:
          'Ended ' +
          shortTime(until) +
          ': players no longer see it. Clear the end to show it again, or the message to remove it.',
      };
    if (Number.isFinite(from) && from > at)
      return { className: 'txt-bold', text: 'Scheduled: players see it from ' + shortTime(from) + end + '.' };
    return { className: 'txt-hint', text: 'Players see it now' + end + '.' };
  }
  const lines = value =>
    value
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);
  const builtIn = () => state.data?.builtInAdapters || [];
  const adapters = next => (state.form.adapters = { ...state.form.adapters, ...next });
  // The adapters readings are stored from once these changes are saved.
  const accepted = () =>
    builtIn()
      .filter(name => !state.form.adapters.disabled.includes(name))
      .concat(state.form.adapters.extra);
  const acceptExtra = name => {
    const extra = [...state.form.adapters.extra, name];
    adapters({ extra });
    text.extra = extra.join('\n');
  };
  const switchField = (key, label, help) =>
    t.div(
      { className: 'col-lg-4' },
      toggle(
        'odyle-' + key,
        label,
        () => state.form[key],
        checked => (state.form[key] = checked),
      ),
      t.div({ className: 'field-help' }, help),
    );
  const seenRow = s =>
    t.tr(
      { rid: signature(s) + accepted().includes(s.name) },
      t.td({ className: 'txt-code' }, s.name),
      t.td({ className: 'txt-right' }, number(s.accepted)),
      t.td({ className: 'txt-right' }, number(s.rejected)),
      t.td({ className: 'txt-nowrap', title: when(s.lastAt) }, clock(s.lastAt)),
      t.td(
        { className: 'txt-right' },
        accepted().includes(s.name)
          ? t.span({ className: 'label sm success' }, 'Accepted')
          : t.button(
              { type: 'button', className: 'btn sm secondary', onclick: () => acceptExtra(s.name) },
              t.span({ className: 'txt' }, 'Accept'),
            ),
      ),
    );
  load();
  loadAi();
  return layout('#/odyle/controls', null, () =>
    state.loading
      ? t.div({ className: 'block txt-center' }, t.span({ className: 'loader lg' }))
      : t.form(
          {
            className: 'grid',
            inert: () => state.saving,
            onsubmit: e => {
              e.preventDefault();
              save('Saved the Odyle server controls.');
            },
          },
          changed,
          section(
            'Announcement',
            'A message above every page of the dashboard and on the Windows app card, for example planned maintenance or an update to install. Players see it within about a minute; leave it empty to remove it, or give it a start and an end, and it shows and goes by itself.',
          ),
          field(
            'odyle-announcement',
            'Message',
            t.textarea({
              id: 'odyle-announcement',
              rows: 2,
              maxLength: 300,
              placeholder: 'For example: Server maintenance on Thursday 10:00–11:00 UTC.',
              value: () => state.form.announcement,
              oninput: e => (state.form.announcement = e.target.value),
            }),
            () =>
              'One line of plain text, ' +
              number(state.form.announcement.trim().length) +
              ' of 300 characters. Updated Windows apps show it on their card too.',
            8,
          ),
          field(
            'odyle-announcement-level',
            'Style',
            app.components.select({
              id: 'odyle-announcement-level',
              required: true,
              options: [
                { label: 'Information', value: 'info' },
                { label: 'Warning', value: 'warning' },
              ],
              value: () => state.form.announcementLevel,
              onchange: e => (state.form.announcementLevel = e?.[0]?.value || 'info'),
            }),
            'Warnings stand out in amber.',
          ),
          // The schedule in the browser's local time, to the minute; the server keeps UTC.
          field(
            'odyle-announcement-from',
            'Show from',
            t.input({
              id: 'odyle-announcement-from',
              type: 'datetime-local',
              value: () => localInput(state.form.announcementFrom),
              onchange: e => (state.form.announcementFrom = fromLocal(e.target.value)),
            }),
            'In your time zone. Empty: as soon as it is saved.',
            6,
          ),
          field(
            'odyle-announcement-until',
            'Show until',
            t.input({
              id: 'odyle-announcement-until',
              type: 'datetime-local',
              value: () => localInput(state.form.announcementUntil),
              onchange: e => (state.form.announcementUntil = fromLocal(e.target.value)),
            }),
            'In your time zone. Empty: until you remove it. It goes within a minute of this time.',
            6,
          ),
          t.div({ className: 'col-lg-12' }, () =>
            state.form.announcement.trim()
              ? [
                  t.div(
                    { className: () => 'alert ' + (state.form.announcementLevel === 'warning' ? 'warning' : 'info') },
                    t.i({
                      className: state.form.announcementLevel === 'warning' ? 'ri-alert-line' : 'ri-information-line',
                      ariaHidden: true,
                    }),
                    t.span({ className: 'txt' }, state.form.announcement.trim().replace(/\s+/g, ' ')),
                  ),
                  t.div({ className: () => 'txt-sm odyle-timing ' + timing().className }, () => timing().text),
                ]
              : t.div({ className: 'txt-hint txt-sm' }, 'No announcement is shown.'),
          ),
          section(
            'Switches',
            'Pause a part of Odyle without a redeploy, for example while an outside service fails. Background jobs shows what each job did last.',
          ),
          switchField(
            'portraitsPaused',
            'Pause portrait refresh',
            'Stops asking PLAYNC for character portraits. New characters get theirs once it runs again.',
          ),
          switchField(
            'armoryPaused',
            'Pause the armory',
            'Stops every armory lookup and search at PLAYNC and empties its queue; resuming it ends a wait PLAYNC asked for. Kept profiles stay readable, marked with their age. To keep one character out for good, set hidden on its row under Collections → armory_profiles.',
          ),
          switchField(
            'remindersPaused',
            'Pause Discord reminders',
            'No planned run is posted to Discord. Runs that start while paused are not announced afterwards; saving a webhook still posts its test message.',
          ),
          switchField(
            'pairingPaused',
            'Pause new pairings',
            'The dashboard stops creating connection links and Windows apps cannot pair. PCs already paired keep signing in and reading.',
          ),
          switchField(
            'readerPaused',
            'Pause packet readers',
            'Paired Windows apps stop reading game packets and close Npcap within about 20 seconds, say so on their card and resume by themselves once this is off. Readings sent meanwhile are refused; apps from before this switch keep capturing, but their readings are refused too.',
          ),
          section(
            'Armory queue',
            "How many lookups of PLAYNC's character pages run at once. Each lookup reads some 25 pages a quarter of a second apart, and each lane rests 5 seconds between lookups, so more lanes ask PLAYNC more at once. Server status lists the queue.",
          ),
          field(
            'odyle-armory-lanes',
            "Readers' lookups at once",
            t.input({
              id: 'odyle-armory-lanes',
              type: 'number',
              min: 1,
              max: 10,
              step: 1,
              required: true,
              value: () => state.form.armoryLanes ?? '',
              oninput: e => {
                const n = parseInt(e.target.value, 10);
                state.form.armoryLanes = Number.isNaN(n) ? null : n;
              },
            }),
            'Profiles players open or refresh, 1 to 10 at once (3 by default). More lanes shorten the wait when many look characters up.',
          ),
          field(
            'odyle-scout-lanes',
            'Scout lookups at once',
            t.input({
              id: 'odyle-scout-lanes',
              type: 'number',
              min: 0,
              max: 5,
              step: 1,
              required: true,
              value: () => state.form.scoutLanes ?? '',
              oninput: e => {
                const n = parseInt(e.target.value, 10);
                state.form.scoutLanes = Number.isNaN(n) ? null : n;
              },
            }),
            "The Armory scout's reads of top players' gear, 0 to 5 (1 by default), beside the readers' and only while none of theirs waits; it reads one every 3 minutes divided among them. 0 reads no gear, while the scout still finds characters and their combat power.",
          ),
          section(
            'Armory AI',
            "Signed-in players you let use it ask about AION 2 characters in their own words on the armory's AI page, and Anthropic's Claude answers with the armory's data and, if you allow it, the web. Anthropic bills the API key below for every question, so let only players you trust use it and keep the questions per account low.",
          ),
          switchField(
            'aiPaused',
            'Pause the armory AI',
            'Players with access see that it is paused; nothing is sent to Anthropic meanwhile.',
          ),
          switchField(
            'aiWeb',
            'Let the AI search the web',
            'For game knowledge the armory does not hold (patch notes, guides, where items drop). Anthropic bills each web search on top of the tokens.',
          ),
          t.div({ className: 'col-lg-4' }),
          field(
            'odyle-ai-key',
            'Anthropic API key',
            t.input({
              id: 'odyle-ai-key',
              type: 'password',
              autocomplete: 'off',
              spellcheck: false,
              placeholder: () => (keyHint() ? 'Saved: ' + keyHint() + ' · paste a new key to replace it' : 'sk-ant-…'),
              value: () => ai.key,
              oninput: e => typedKey(e.target.value),
            }),
            () =>
              state.form.aiKey === ''
                ? 'The saved key is removed when you save the changes.'
                : keyHint()
                  ? 'A key is saved (' +
                    keyHint() +
                    '). It is never shown again, only its end. Create keys in the Anthropic Console (console.anthropic.com) under API keys; a key of its own for Odyle, with a spend limit on its workspace, keeps the costs in view.'
                  : 'No key is saved, so the AI cannot answer. Create one in the Anthropic Console (console.anthropic.com) under API keys and paste it here.',
            6,
          ),
          t.div({ className: 'col-lg-2' }, () =>
            keyHint() && state.form.aiKey !== ''
              ? t.button(
                  {
                    type: 'button',
                    className: 'btn sm transparent danger m-t-base',
                    onclick: () => {
                      ai.key = '';
                      state.form.aiKey = '';
                    },
                  },
                  t.span({ className: 'txt txt-nowrap' }, 'Remove key'),
                )
              : null,
          ),
          field(
            'odyle-ai-model',
            'Model',
            app.components.select({
              id: 'odyle-ai-model',
              required: true,
              options: [
                { label: 'Claude Opus 5.5 (best answers)', value: 'claude-opus-5-5' },
                { label: 'Claude Sonnet 5.5 (half the price)', value: 'claude-sonnet-5-5' },
                { label: 'Claude Haiku 5.5 (cheapest, simpler answers)', value: 'claude-haiku-5-5' },
              ],
              value: () => state.form.aiModel,
              onchange: e => (state.form.aiModel = e?.[0]?.value || 'claude-opus-5-5'),
            }),
            'Opus answers comparisons best. A question takes some 20,000 to 150,000 tokens, most of them read from the cache, depending on how much it looks up.',
          ),
          field(
            'odyle-ai-questions',
            'Questions per account in 24 hours',
            t.input({
              id: 'odyle-ai-questions',
              type: 'number',
              min: 1,
              max: 500,
              step: 1,
              required: true,
              value: () => state.form.aiQuestions ?? '',
              oninput: e => {
                const n = parseInt(e.target.value, 10);
                state.form.aiQuestions = Number.isNaN(n) ? null : n;
              },
            }),
            'Each account that may use the AI asks up to this many questions in any 24 hours, 1 to 500 (20 by default). Questions that took no tokens do not count.',
          ),
          t.div({ className: 'col-lg-12' }, () => {
            const totals = ai.data?.totals;
            return totals
              ? t.div(
                  { className: 'odyle-stats' },
                  stat('Questions', number(totals.asked24h), 'in 24 hours'),
                  stat(
                    'Questions',
                    number(totals.asked30d),
                    totals.failed30d ? 'in 30 days, ' + number(totals.failed30d) + ' failed' : 'in 30 days',
                  ),
                  stat(
                    'Input tokens',
                    tokens(totals.inputTokens30d),
                    tokens(totals.cachedTokens30d) + ' from the cache, 30 days',
                  ),
                  stat('Output tokens', tokens(totals.outputTokens30d), 'in 30 days'),
                  stat('Web searches', number(totals.webSearches30d), 'in 30 days'),
                )
              : t.div({ className: 'txt-hint txt-sm' }, 'Loading what the AI took…');
          }),
          t.div(
            { className: 'col-lg-12' },
            t.div({ className: 'txt-bold m-b-xs' }, 'Knowledge base'),
            t.p({ className: 'txt-hint txt-sm m-b-base' }, () => {
              const k = ai.data?.knowledge;
              const many = (n, one, more) => number(n) + ' ' + (n === 1 ? one : more);
              return [
                k
                  ? 'The AI follows ' +
                    many(k.rules, 'best practice', 'best practices') +
                    ' in every answer and reads ' +
                    (k.guides ? 'the ' + many(k.guides, 'guide', 'guides') : 'guides') +
                    ' on the mechanics a question touches' +
                    (k.disabled ? '; ' + many(k.disabled, 'entry is', 'entries are') + ' switched off' : '') +
                    (k.updated ? '; last changed ' + when(k.updated) : '') +
                    '. '
                  : 'Loading the knowledge base… ',
                'Read and correct them as patches change the game, add your own or switch one off on the ',
                t.a({ href: '#/odyle/knowledge' }, 'AI knowledge'),
                ' page. The next question reads the change, and it is written to the audit log.',
              ];
            }),
          ),
          t.div(
            { className: 'col-lg-12' },
            t.div({ className: 'txt-bold m-b-xs' }, 'Accounts'),
            t.div(
              { className: 'odyle-table m-b-sm' },
              t.table(
                null,
                t.thead(
                  null,
                  t.tr(
                    null,
                    t.th(null, 'Account'),
                    t.th({ className: 'txt-right' }, 'Questions, 24 h'),
                    t.th({ className: 'txt-right' }, '30 days'),
                    t.th({ className: 'txt-right' }, 'Tokens in / out, 30 days'),
                    t.th(null, 'Last asked'),
                    t.th(null, ''),
                  ),
                ),
                t.tbody(null, () =>
                  ai.data?.accounts?.length
                    ? ai.data.accounts.map(accountRow)
                    : t.tr(
                        null,
                        t.td({ colSpan: 6, className: 'txt-hint txt-center' }, () =>
                          ai.data ? 'No account may use the AI yet. Find one below.' : 'Loading…',
                        ),
                      ),
                ),
              ),
            ),
            t.div(
              { className: 'flex' },
              t.input({
                type: 'search',
                placeholder: 'Find an account by its display name',
                value: () => ai.query,
                oninput: e => (ai.query = e.target.value),
                onkeydown: e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    findAccounts();
                  }
                },
              }),
              t.button(
                { type: 'button', className: 'btn secondary', onclick: findAccounts },
                t.span({ className: 'txt' }, 'Find'),
              ),
            ),
            () =>
              ai.found
                ? ai.found.length
                  ? t.div(
                      { className: 'odyle-table m-t-sm' },
                      t.table(
                        null,
                        t.tbody(
                          null,
                          ai.found.map(a =>
                            t.tr(
                              { rid: a.id + a.allowed },
                              t.td(null, a.displayName),
                              t.td({ className: 'txt-hint' }, a.allowed ? 'may use the AI' : 'no access'),
                              t.td({ className: 'txt-right' }, accessButton(a)),
                            ),
                          ),
                        ),
                      ),
                    )
                  : t.div({ className: 'txt-hint txt-sm m-t-sm' }, 'No account has a display name holding that.')
                : null,
            t.div(
              { className: 'field-help' },
              'Letting an account use the AI, or no longer, takes effect at once and is written to the audit log. You can also switch armoryAi on an account under Collections → users. Odyle keeps who asked, when and the tokens it took for 30 days, never the questions or the answers.',
            ),
          ),
          section(
            'Packet adapters',
            'The Windows app names its decoder with every reading, and only readings from accepted adapters are stored. Built-in adapters come with the backend code; accept a new decoder here before the next deploy, or stop one that reads wrong values.',
          ),
          t.div(
            { className: 'col-lg-4' },
            t.div({ className: 'txt-bold m-b-xs' }, 'Built-in adapters'),
            builtIn().map(name =>
              toggle(
                'odyle-adapter-' + name,
                name,
                () => !state.form.adapters.disabled.includes(name),
                checked =>
                  adapters({
                    disabled: checked
                      ? state.form.adapters.disabled.filter(n => n !== name)
                      : [...state.form.adapters.disabled, name],
                  }),
              ),
            ),
            t.div({ className: 'field-help' }, 'Switched off, its readings are refused.'),
            () =>
              (state.data?.locationAdapters || []).length
                ? [
                    t.div({ className: 'txt-bold m-t-sm m-b-xs' }, 'Location adapters'),
                    ...state.data.locationAdapters.map(name =>
                      toggle(
                        'odyle-adapter-' + name,
                        name,
                        () => !state.form.adapters.disabled.includes(name),
                        checked =>
                          adapters({
                            disabled: checked
                              ? state.form.adapters.disabled.filter(n => n !== name)
                              : [...state.form.adapters.disabled, name],
                          }),
                      ),
                    ),
                    t.div(
                      { className: 'field-help' },
                      'Switched off, the places apps send for players who share their location are refused.',
                    ),
                  ]
                : null,
            () =>
              (state.data?.groupAdapters || []).length
                ? [
                    t.div({ className: 'txt-bold m-t-sm m-b-xs' }, 'Group adapters'),
                    ...state.data.groupAdapters.map(name =>
                      toggle(
                        'odyle-adapter-' + name,
                        name,
                        () => !state.form.adapters.disabled.includes(name),
                        checked =>
                          adapters({
                            disabled: checked
                              ? state.form.adapters.disabled.filter(n => n !== name)
                              : [...state.form.adapters.disabled, name],
                          }),
                      ),
                    ),
                    t.div(
                      { className: 'field-help' },
                      'Switched off, the party and force ids apps send are refused, and rooms stop putting their players together.',
                    ),
                  ]
                : null,
            () =>
              (state.data?.pvpAdapters || []).length
                ? [
                    t.div({ className: 'txt-bold m-t-sm m-b-xs' }, 'PvP adapters'),
                    ...state.data.pvpAdapters.map(name =>
                      toggle(
                        'odyle-adapter-' + name,
                        name,
                        () => !state.form.adapters.disabled.includes(name),
                        checked =>
                          adapters({
                            disabled: checked
                              ? state.form.adapters.disabled.filter(n => n !== name)
                              : [...state.form.adapters.disabled, name],
                          }),
                      ),
                    ),
                    t.div(
                      { className: 'field-help' },
                      'Switched off, the kills, assists and deaths apps send for players with PvP stats on are refused, and those apps stop reading PvP.',
                    ),
                  ]
                : null,
            () =>
              (state.data?.teammateAdapters || []).length
                ? [
                    t.div({ className: 'txt-bold m-t-sm m-b-xs' }, 'Teammate adapters'),
                    ...state.data.teammateAdapters.map(name =>
                      toggle(
                        'odyle-adapter-' + name,
                        name,
                        () => !state.form.adapters.disabled.includes(name),
                        checked =>
                          adapters({
                            disabled: checked
                              ? state.form.adapters.disabled.filter(n => n !== name)
                              : [...state.form.adapters.disabled, name],
                          }),
                      ),
                    ),
                    t.div(
                      { className: 'field-help' },
                      'Switched off, the names of party and force members apps send for the Armory scout are refused, and those apps stop sending them until they restart.',
                    ),
                  ]
                : null,
          ),
          field(
            'odyle-adapters-extra',
            'Also accept',
            t.textarea({
              id: 'odyle-adapters-extra',
              rows: 3,
              placeholder: 'One adapter name per line',
              value: () => text.extra,
              oninput: e => {
                text.extra = e.target.value;
                adapters({ extra: lines(e.target.value) });
              },
            }),
            'Letters, digits, dots, dashes and underscores, up to 20 names.',
            8,
          ),
          t.div({ className: 'col-lg-12' }, () =>
            accepted().length
              ? t.p(null, 'Readings are stored from: ', t.span({ className: 'txt-code' }, accepted().join(', ')), '.')
              : t.div({ className: 'alert danger' }, 'Keep at least one adapter accepted, or no reading can be saved.'),
          ),
          t.div(
            { className: 'col-lg-12' },
            t.div({ className: 'txt-bold m-b-xs' }, 'Seen in the latest packets'),
            () =>
              (state.data?.seenAdapters || []).length
                ? t.div(
                    { className: 'odyle-table' },
                    t.table(
                      null,
                      t.thead(
                        null,
                        t.tr(
                          null,
                          t.th(null, 'Adapter'),
                          t.th({ className: 'txt-right' }, 'Saved'),
                          t.th({ className: 'txt-right' }, 'Rejected'),
                          t.th(null, 'Last'),
                          t.th({ className: 'txt-right' }, ''),
                        ),
                      ),
                      t.tbody(null, () => state.data.seenAdapters.map(seenRow)),
                    ),
                  )
                : t.div({ className: 'txt-hint txt-sm' }, 'No readings among the latest 200 packets.'),
            t.div(
              { className: 'field-help' },
              'Rejected counts readings refused for any reason, an outdated sequence included.',
            ),
          ),
          section(
            'Windows app updates',
            'Hold back a Windows release that misbehaves. Apps from 0.18.0 never install a held-back version, and an app running one installs the latest release instead, older or not, within a minute. To roll back, hold the bad version here and mark its GitHub release as a pre-release, so the previous one is the latest again (docs/runbook.md).',
          ),
          field(
            'odyle-windows-blocked',
            'Hold back versions',
            t.textarea({
              id: 'odyle-windows-blocked',
              rows: 2,
              placeholder: 'One version per line, for example 0.18.0',
              value: () => text.blocked,
              oninput: e => {
                text.blocked = e.target.value;
                state.form.windowsBlocked = lines(e.target.value);
              },
            }),
            'Versions like 0.18.0, up to 20. Unpaired apps and apps from before 0.18.0 do not know this list.',
            8,
          ),
          t.div({ className: 'col-lg-12' }, t.hr()),
          buttons(),
        ),
  );
}

// The armory AI's knowledge base (backend/odyle/aiknowledge.go): the best practices it follows in
// every answer and the guides it reads when a question needs them. Superusers read each entry as
// the AI does (its Markdown drawn here), edit it, switch it off or on, add new ones and delete
// them; every change goes through the Odyle routes, which write it to the audit log, and the next
// question reads it. #/odyle/knowledge?entry=<name> opens an entry.
const kindNames = { rule: 'best practice', guide: 'guide' };
// A Markdown line that starts a block of its own (heading, list item, table row).
const markdownBlock = /^(#{1,4}\s|\s*[-*]\s+|\s*\d+[.)]\s+|\s*\|)/;
// Inline Markdown (**bold**, *italic*, `code`, [links](https://…)) as text and elements; links go
// only to web pages, in a new tab.
function markdownInline(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(/\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(t.strong(null, m[1]));
    else if (m[2] !== undefined) out.push(t.em(null, m[2]));
    else if (m[3] !== undefined) out.push(t.code(null, m[3]));
    else if (/^https?:\/\//.test(m[5]))
      out.push(t.a({ href: m[5], target: '_blank', rel: 'noopener noreferrer' }, m[4]));
    else out.push(m[4]);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
// A guide's Markdown drawn for reading: headings, paragraphs, lists, tables and the inline marks
// above. Everything is a text node; nothing is parsed as HTML.
function markdown(source) {
  const lines = String(source || '').split('\n');
  const blocks = [];
  let i = 0;
  const list = (test, strip, tag) => {
    const items = [];
    while (i < lines.length && test.test(lines[i])) {
      const indent = /^\s{2,}/.test(lines[i]);
      items.push(t.li({ className: indent ? 'odyle-md-sub' : '' }, ...markdownInline(lines[i].replace(strip, ''))));
      i++;
    }
    blocks.push(t[tag](null, ...items));
  };
  while (i < lines.length) {
    const line = lines[i];
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (!line.trim()) i++;
    else if (heading) {
      blocks.push(
        t['h' + Math.min(6, heading[1].length + 2)]({ className: 'odyle-md-heading' }, ...markdownInline(heading[2])),
      );
      i++;
    } else if (/^\s*[-*]\s+/.test(line)) list(/^\s*[-*]\s+/, /^\s*[-*]\s+/, 'ul');
    else if (/^\s*\d+[.)]\s+/.test(line)) list(/^\s*\d+[.)]\s+/, /^\s*\d+[.)]\s+/, 'ol');
    else if (/^\s*\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        if (!/^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i]) || !lines[i].includes('-'))
          rows.push(
            lines[i]
              .trim()
              .replace(/^\||\|$/g, '')
              .split('|')
              .map(cell => cell.trim()),
          );
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(
        t.div(
          { className: 'odyle-table odyle-md-table' },
          t.table(
            null,
            t.thead(null, t.tr(null, ...(head || []).map(cell => t.th(null, ...markdownInline(cell))))),
            t.tbody(null, ...body.map(row => t.tr(null, ...row.map(cell => t.td(null, ...markdownInline(cell)))))),
          ),
        ),
      );
    } else {
      const paragraph = [];
      while (i < lines.length && lines[i].trim() && !markdownBlock.test(lines[i])) paragraph.push(lines[i++].trim());
      blocks.push(t.p(null, ...markdownInline(paragraph.join(' '))));
    }
  }
  return blocks;
}
// The name the AI asks for a guide by, from its title: lower-case words and dashes.
const nameOf = title =>
  title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
const hostOf = href => {
  try {
    return new URL(href).host;
  } catch {
    return '';
  }
};
const editable = ['kind', 'title', 'name', 'summary', 'body', 'sources', 'position', 'disabled'];
const sameEntry = (a, b) => editable.every(key => String(a?.[key] ?? '') === String(b?.[key] ?? ''));

export function knowledgePage(route) {
  app.store.title = 'AI knowledge';
  // open is the entry shown (its saved copy; a new entry has id ''), draft what the form holds,
  // writing whether the form shows rather than the entry as the AI reads it, named whether the
  // name was typed (a new entry's name follows its title until it is).
  const state = store({
    loading: true,
    entries: [],
    counts: null,
    limits: null,
    search: '',
    open: null,
    draft: null,
    writing: false,
    named: false,
    saving: false,
    busy: '',
  });
  const wanted = route?.query?.entry?.[0] || '';
  async function load() {
    try {
      const data = await app.pb.send('/api/odyle/admin/ai/knowledge', { requestKey: null });
      Object.assign(state, { entries: data.entries, counts: data.counts, limits: data.limits, loading: false });
      if (wanted && !state.open) {
        const entry = data.entries.find(e => e.name === wanted);
        if (entry) show(entry);
      }
    } catch (error) {
      state.loading = false;
      if (!error.isAbort) app.checkApiError(error);
    }
  }
  const dirty = () => state.draft && !sameEntry(state.draft, state.open);
  function show(entry, writing = false) {
    // Copies: spreading an entry of the store keeps its marker, and the draft would not be reactive.
    state.open = copy(entry);
    state.draft = copy(entry);
    state.writing = writing;
    state.named = Boolean(entry.id);
    window.scrollTo(0, 0);
  }
  function create(kind) {
    leave(() =>
      show(
        { id: '', kind, title: '', name: '', summary: '', body: '', sources: '', position: null, disabled: false },
        true,
      ),
    );
  }
  // Runs next once unsaved changes, if any, are confirmed lost.
  function leave(next) {
    if (dirty()) app.modals.confirm('Discard the changes you have not saved?', next, null, { yesButton: 'Discard' });
    else next();
  }
  const close = () =>
    leave(() => {
      // The draft first: the entry view draws while a draft is open.
      state.draft = null;
      state.open = null;
    });
  async function save() {
    if (state.saving) return;
    state.saving = true;
    const draft = state.draft;
    try {
      const data = await app.pb.send('/api/odyle/admin/ai/knowledge', {
        method: 'POST',
        body: { ...Object.fromEntries(editable.map(key => [key, draft[key]])), id: draft.id || undefined },
        requestKey: null,
      });
      Object.assign(state, { entries: data.entries, counts: data.counts });
      show(data.entry);
      app.toasts.success(
        'Saved the ' + kindNames[data.entry.kind] + ' ' + data.entry.title + '. The AI uses it from the next question.',
      );
    } catch (error) {
      app.checkApiError(error);
    }
    state.saving = false;
  }
  // Switches an entry off or on from the list, as saved (a draft open elsewhere stays as it is).
  async function setDisabled(entry, disabled) {
    if (state.busy) return;
    state.busy = entry.id;
    try {
      const data = await app.pb.send('/api/odyle/admin/ai/knowledge', {
        method: 'POST',
        body: { ...Object.fromEntries(editable.map(key => [key, entry[key]])), id: entry.id, disabled },
        requestKey: null,
      });
      Object.assign(state, { entries: data.entries, counts: data.counts });
      app.toasts.success(
        (disabled ? 'Switched off the ' : 'Switched on the ') +
          kindNames[entry.kind] +
          ' ' +
          entry.title +
          (disabled ? '. The AI leaves it out from the next question.' : '. The AI uses it from the next question.'),
      );
    } catch (error) {
      // Draw the switch as saved again.
      state.entries = [...state.entries];
      app.checkApiError(error);
    }
    state.busy = '';
  }
  function remove() {
    const entry = state.open;
    app.modals.confirm(
      'Delete the ' +
        kindNames[entry.kind] +
        ' ' +
        entry.title +
        '? The AI no longer ' +
        (entry.kind === 'rule' ? 'follows' : 'reads') +
        ' it, and it cannot be brought back. Switching it off keeps it.',
      async () => {
        try {
          const data = await app.pb.send('/api/odyle/admin/ai/knowledge/' + encodeURIComponent(entry.id), {
            method: 'DELETE',
            requestKey: null,
          });
          Object.assign(state, { entries: data.entries, counts: data.counts, draft: null, open: null });
          app.toasts.success('Deleted the ' + kindNames[entry.kind] + ' ' + entry.title + '.');
        } catch (error) {
          app.checkApiError(error);
        }
      },
      null,
      { yesButton: 'Delete' },
    );
  }
  const changedOn = entry => (entry.updated ? new Date(timestamp(entry.updated)).toLocaleDateString() : '');
  const sourcesOf = entry =>
    String(entry.sources || '')
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);
  const matches = entry => {
    const words = state.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const haystack = [entry.title, entry.name, entry.summary, entry.body].join(' ').toLowerCase();
    return words.every(w => haystack.includes(w));
  };
  // PocketBase draws a switch from its label, so the label is there with its text for screen
  // readers only.
  const switchFor = entry =>
    t.div(
      {
        className: 'field odyle-toggle',
        title: () => (entry.disabled ? 'Switched off: the AI leaves it out' : 'In use'),
      },
      t.input({
        id: 'odyle-kb-on-' + entry.id,
        type: 'checkbox',
        className: 'switch',
        checked: () => !entry.disabled,
        disabled: () => Boolean(state.busy),
        onchange: e => setDisabled(entry, !e.target.checked),
      }),
      t.label(
        { htmlFor: 'odyle-kb-on-' + entry.id },
        t.span({ className: 'odyle-kb-hidden' }, (entry.disabled ? 'Switch on ' : 'Switch off ') + entry.title),
      ),
    );
  const row = entry =>
    t.div(
      {
        rid: entry.id + entry.updated + entry.disabled,
        className: 'odyle-kb-row' + (entry.disabled ? ' odyle-kb-off' : ''),
      },
      t.div({ className: 'odyle-kb-switch' }, switchFor(entry)),
      t.button(
        { type: 'button', className: 'odyle-kb-open', onclick: () => leave(() => show(entry)) },
        t.span({ className: 'odyle-kb-title' }, entry.title),
        entry.kind === 'guide' ? t.span({ className: 'odyle-id txt-hint' }, entry.name) : null,
        entry.disabled ? t.span({ className: 'label sm' }, 'Off') : null,
        t.span({ className: 'odyle-kb-text txt-hint' }, entry.kind === 'guide' ? entry.summary : entry.body),
      ),
      t.div(
        { className: 'odyle-kb-meta txt-hint txt-sm' },
        entry.kind === 'guide'
          ? t.span(null, sourcesOf(entry).length === 1 ? '1 source' : sourcesOf(entry).length + ' sources')
          : null,
        t.span({ title: when(entry.updated) }, changedOn(entry)),
      ),
    );
  const group = (kind, title, hint) => () => {
    const all = state.entries.filter(e => e.kind === kind);
    const shown = all.filter(matches);
    const used = state.counts ? (kind === 'rule' ? state.counts.rules : state.counts.guides) : 0;
    return [
      t.div(
        { className: 'odyle-kb-group-head' },
        t.div({ className: 'txt-lg' }, title),
        t.span(
          { className: 'txt-hint' },
          number(used) + ' in use' + (all.length > used ? ', ' + number(all.length - used) + ' off' : ''),
        ),
        t.button(
          { type: 'button', className: 'btn sm secondary m-l-auto', onclick: () => create(kind) },
          t.i({ className: 'ri-add-line', ariaHidden: true }),
          t.span({ className: 'txt' }, kind === 'rule' ? 'New best practice' : 'New guide'),
        ),
      ),
      t.p({ className: 'txt-hint txt-sm' }, hint),
      t.div(
        { className: 'odyle-kb-list' },
        shown.length
          ? shown.map(row)
          : t.div(
              { className: 'odyle-kb-row txt-hint' },
              all.length ? 'Nothing here matches the search.' : 'None yet.',
            ),
      ),
    ];
  };
  const limit = key => state.limits?.[key] || 0;
  const count = (value, max) => number(String(value || '').length) + ' of ' + number(max) + ' characters';
  // The entry as the AI reads it, unsaved changes included.
  // d is the draft the entry view was drawn for: state.draft turns null before the view goes.
  const reading = d => {
    const sources = sourcesOf(d);
    return t.div(
      { className: 'odyle-kb-read' },
      d.kind === 'guide' && d.summary
        ? t.p({ className: 'odyle-kb-summary' }, t.strong(null, 'What it answers: '), d.summary)
        : null,
      t.div({ className: 'odyle-md' }, ...markdown(d.body || '')),
      sources.length
        ? t.div(
            { className: 'odyle-kb-sources' },
            t.div({ className: 'txt-bold m-b-xs' }, 'Sources'),
            t.ul(
              null,
              ...sources.map(s => {
                const [href, ...rest] = s.split(/\s+/);
                return t.li(
                  null,
                  /^https?:\/\//.test(href)
                    ? t.a({ href, target: '_blank', rel: 'noopener noreferrer' }, rest.join(' ') || href)
                    : s,
                  /^https?:\/\//.test(href) && rest.length && hostOf(href)
                    ? t.span({ className: 'txt-hint' }, ' · ' + hostOf(href))
                    : null,
                );
              }),
            ),
          )
        : null,
    );
  };
  const writing = d => {
    const rule = () => d.kind === 'rule';
    return t.form(
      {
        className: 'grid',
        inert: () => state.saving,
        onsubmit: e => {
          e.preventDefault();
          save();
        },
      },
      field(
        'odyle-kb-kind',
        'Kind',
        t.select(
          { id: 'odyle-kb-kind', onchange: e => (d.kind = e.target.value) },
          t.option({ value: 'rule', selected: () => d.kind === 'rule' }, 'Best practice'),
          t.option({ value: 'guide', selected: () => d.kind === 'guide' }, 'Guide'),
        ),
        () =>
          rule()
            ? 'The AI follows every best practice in every answer.'
            : 'The AI reads a guide when a question needs it.',
        3,
      ),
      field(
        'odyle-kb-title',
        'Title',
        t.input({
          id: 'odyle-kb-title',
          type: 'text',
          required: true,
          maxLength: () => limit('title'),
          value: () => d.title,
          oninput: e => {
            d.title = e.target.value;
            if (!state.named) d.name = nameOf(d.title);
          },
        }),
        () => count(d.title, limit('title')),
        6,
      ),
      field(
        'odyle-kb-name',
        'Name',
        t.input({
          id: 'odyle-kb-name',
          type: 'text',
          required: true,
          maxLength: 60,
          pattern: '[a-z0-9]+(-[a-z0-9]+)*',
          className: 'odyle-id',
          value: () => d.name,
          oninput: e => {
            d.name = e.target.value;
            state.named = true;
          },
        }),
        'How the AI asks for it: lower-case words and dashes.',
        3,
      ),
      () =>
        rule()
          ? null
          : field(
              'odyle-kb-summary',
              'Summary',
              t.input({
                id: 'odyle-kb-summary',
                type: 'text',
                required: true,
                maxLength: () => limit('summary'),
                value: () => d.summary,
                oninput: e => (d.summary = e.target.value),
              }),
              () =>
                'One sentence: what the guide answers. The AI picks the guides to read by it. ' +
                count(d.summary, limit('summary')) +
                '.',
              12,
            ),
      field(
        'odyle-kb-body',
        () => (rule() ? 'Best practice' : 'Text (Markdown)'),
        t.textarea({
          id: 'odyle-kb-body',
          className: () => (rule() ? '' : 'odyle-kb-editor'),
          rows: () => (rule() ? 4 : 22),
          required: true,
          maxLength: () => (rule() ? limit('ruleLength') : limit('body')),
          value: () => d.body,
          oninput: e => (d.body = e.target.value),
        }),
        () =>
          (rule()
            ? 'A sentence or two the AI applies to every plan. Write a guide for more. '
            : 'Headings (##), lists (-), **bold**, tables and links; Read shows it drawn. Mark what is uncertain or only known for Korea and Taiwan. ') +
          count(d.body, rule() ? limit('ruleLength') : limit('body')) +
          '.',
        12,
      ),
      field(
        'odyle-kb-sources',
        'Sources',
        t.textarea({
          id: 'odyle-kb-sources',
          rows: 4,
          className: 'odyle-kb-sources-input',
          maxLength: () => limit('sources'),
          placeholder: 'https://… What the page is',
          value: () => d.sources,
          oninput: e => (d.sources = e.target.value),
        }),
        () =>
          'The pages it rests on, one a line: the address, then what it is. The AI reads the first ' +
          number(limit('sourcesRead')) +
          ' with a guide.',
        9,
      ),
      field(
        'odyle-kb-position',
        'Position',
        t.input({
          id: 'odyle-kb-position',
          type: 'number',
          min: 0,
          max: 9999,
          step: 1,
          placeholder: 'Last',
          value: () => d.position ?? '',
          oninput: e => {
            const n = parseInt(e.target.value, 10);
            d.position = Number.isNaN(n) ? null : n;
          },
        }),
        'Lower comes first, for the AI too.',
        3,
      ),
      t.div(
        { className: 'col-lg-12' },
        toggle(
          'odyle-kb-disabled',
          'Switched off: the AI leaves it out',
          () => d.disabled,
          on => (d.disabled = on),
        ),
      ),
      t.div(
        { className: 'col-lg-12 flex odyle-kb-actions' },
        t.button(
          {
            type: 'submit',
            className: () => 'btn expanded' + (state.saving ? ' loading' : ''),
            disabled: () => state.saving || (Boolean(d.id) && !dirty()),
          },
          t.span({ className: 'txt' }, 'Save'),
        ),
        t.button(
          { type: 'button', className: 'btn transparent secondary', onclick: close },
          t.span({ className: 'txt' }, 'Cancel'),
        ),
        () =>
          d.id
            ? t.button(
                { type: 'button', className: 'btn transparent danger m-l-auto', onclick: remove },
                t.i({ className: 'ri-delete-bin-7-line', ariaHidden: true }),
                t.span({ className: 'txt' }, 'Delete'),
              )
            : null,
      ),
    );
  };
  const entryView = () => {
    const d = state.draft;
    return t.div(
      { className: 'odyle-kb-entry' },
      t.button(
        { type: 'button', className: 'btn sm transparent secondary odyle-kb-back', onclick: close },
        t.i({ className: 'ri-arrow-left-line', ariaHidden: true }),
        t.span({ className: 'txt' }, 'All entries'),
      ),
      t.div(
        { className: 'odyle-kb-entry-head' },
        t.div(
          null,
          t.div(
            { className: 'txt-hint txt-sm' },
            () =>
              (d.kind === 'rule' ? 'Best practice' : 'Guide') +
              (d.name ? ' · ' + d.name : '') +
              (state.open?.id ? ' · changed ' + when(state.open.updated) : ' · new') +
              (d.disabled ? ' · switched off' : '') +
              (dirty() ? ' · not saved' : ''),
          ),
          t.h2({ className: 'odyle-kb-heading' }, () => d.title || 'Untitled'),
        ),
        t.div(
          { className: 'odyle-filters m-l-auto' },
          t.button(
            {
              type: 'button',
              className: () => 'btn sm ' + (state.writing ? 'transparent secondary' : 'secondary'),
              ariaPressed: () => !state.writing,
              onclick: () => (state.writing = false),
            },
            t.span({ className: 'txt' }, 'Read'),
          ),
          t.button(
            {
              type: 'button',
              className: () => 'btn sm ' + (state.writing ? 'secondary' : 'transparent secondary'),
              ariaPressed: () => state.writing,
              onclick: () => (state.writing = true),
            },
            t.span({ className: 'txt' }, 'Edit'),
          ),
        ),
      ),
      () => (state.writing ? writing(d) : reading(d)),
    );
  };
  load();
  return layout('#/odyle/knowledge', app.components.refreshButton({ onclick: () => leave(load) }), () =>
    state.loading
      ? t.div({ className: 'block txt-center' }, t.span({ className: 'loader lg' }))
      : state.draft
        ? entryView()
        : t.div(
            { className: 'odyle-kb' },
            t.p(
              { className: 'txt-hint' },
              "What the armory AI knows of AION 2's gear beyond the armory's data: the best practices it follows in every answer and the guides it reads on the mechanics a question touches. Correct them as patches change the game; the next question reads the change, and the ",
              t.a({ href: '#/odyle/audit?kind=ai-knowledge' }, 'audit log'),
              ' keeps who changed what. Who may use the AI is under ',
              t.a({ href: '#/odyle/controls' }, 'Server controls'),
              '.',
            ),
            t.div(
              { className: 'odyle-search odyle-kb-search' },
              t.i({ className: 'ri-search-line txt-hint', ariaHidden: true }),
              t.input({
                type: 'search',
                placeholder: 'Search titles, names and texts',
                ariaLabel: 'Search the knowledge base',
                value: () => state.search,
                oninput: e => (state.search = e.target.value),
              }),
            ),
            t.div(
              { className: 'odyle-section' },
              group(
                'rule',
                'Best practices',
                'The AI follows every one of these in every answer, in this order: a sentence or two each, up to ' +
                  number(limit('ruleLength')) +
                  ' characters and ' +
                  number(limit('rules')) +
                  ' in use.',
              ),
            ),
            t.div(
              { className: 'odyle-section' },
              group(
                'guide',
                'Guides',
                "The AI sees each guide's name, title and summary, and reads the guide itself when a question needs it, up to 4 at once.",
              ),
            ),
          ),
  );
}

// The audit log (backend/odyle/audit.go): what superusers did, newest first, 50 at a time,
// and what they do next as it happens. Links open it filtered: #/odyle/audit?kind=settings,
// ?actor=<superuser id>.
const auditKinds = [
  { id: '', label: 'All' },
  { id: 'settings', label: 'Settings' },
  { id: 'job', label: 'Jobs' },
  { id: 'update-apps', label: 'App updates' },
  { id: 'vacuum', label: 'Vacuums' },
  { id: 'armory-refresh', label: 'Armory refreshes' },
  { id: 'ai-access', label: 'AI access' },
  { id: 'ai-knowledge', label: 'AI knowledge' },
];
const auditLabels = {
  settings: 'settings',
  job: 'job run',
  'update-apps': 'update all apps',
  vacuum: 'vacuum',
  'armory-refresh': 'armory refresh',
  'ai-access': 'AI access',
  'ai-knowledge': 'AI knowledge',
};
const auditClass = { settings: 'info', 'update-apps': 'warning', 'armory-refresh': 'warning' };
const isoMoment = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/;
// A value an entry keeps, in words: switches on and off, nothing as none, moments in local time
// with their UTC, and list entries by their name first, then what they hold.
function auditText(v) {
  if (v === undefined || v === null || v === '') return 'none';
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'number') return number(v);
  if (typeof v === 'string') return isoMoment.test(v) ? when(v) + ' (' + v.slice(0, 16).replace('T', ' ') + ' UTC)' : v;
  if (Array.isArray(v)) return v.length ? v.map(auditText).join(', ') : 'none';
  const names = ['name', 'class', 'title', 'id'],
    pairs = Object.entries(v);
  return [
    ...pairs.filter(([key]) => names.includes(key)).map(([key, x]) => (key === 'id' ? 'map ' + x : String(x))),
    ...pairs
      .filter(([key, x]) => !names.includes(key) && x !== '' && x !== false && x !== 0 && x !== null)
      .map(([key, x]) => (x === true ? key : key + ' ' + auditText(x))),
  ].join(' · ');
}
// The rows of one changed setting: a value before and after, or each list entry added, removed
// or changed, the setting named on its first row only.
function changeRows(c) {
  if (!('added' in c || 'removed' in c || 'changed' in c || c.reordered))
    return [[c.label, auditText(c.before), auditText(c.after)]];
  const rows = [
    ...(c.added || []).map(v => [c.label, '—', 'added: ' + auditText(v)]),
    ...(c.removed || []).map(v => [c.label, auditText(v), 'removed']),
    ...(c.changed || []).map(e => [c.label, auditText(e.before), auditText(e.after)]),
  ];
  if (c.reordered) rows.push([c.label, '', 'in another order']);
  if (c.omitted) rows.push([c.label, '', number(c.omitted) + ' more, too many to keep']);
  return rows.map((row, i) => (i ? ['', row[1], row[2]] : row));
}
const bytes = n => (typeof n === 'number' ? (n / 1e6).toLocaleString([], { maximumFractionDigits: 1 }) + ' MB' : '—');

export function auditPage(route) {
  app.store.title = 'Audit log';
  const query = name => route?.query?.[name]?.[0] || '';
  // asked numbers the loads, so an older answer never replaces a newer one.
  const state = store({
    loading: true,
    failed: '',
    entries: [],
    more: false,
    actors: [],
    keptDays: 365,
    kind: auditKinds.some(k => k.id === query('kind')) ? query('kind') : '',
    actor: query('actor'),
    search: '',
    open: '',
    loadingMore: false,
    live: false,
    offset: 0,
    now: Date.now(),
  });
  const now = () => state.now + state.offset;
  let alive = true,
    tick = 0,
    typing = 0,
    asked = 0,
    unsubscribe = null;
  const filters = (extra = {}) => ({
    ...(state.kind ? { kind: state.kind } : {}),
    ...(state.actor ? { actor: state.actor } : {}),
    ...(state.search.trim() ? { q: state.search.trim() } : {}),
    ...extra,
  });
  async function load() {
    const ask = ++asked;
    try {
      const data = await app.pb.send('/api/odyle/admin/audit', { query: filters(), requestKey: null });
      if (ask === asked && Array.isArray(data?.entries))
        Object.assign(state, {
          offset: timestamp(data.serverNow) - Date.now(),
          entries: data.entries,
          more: data.more,
          actors: data.actors || [],
          keptDays: data.keptDays || 365,
          failed: '',
        });
    } catch (error) {
      if (!error.isAbort && ask === asked) state.failed = error.message || 'The audit log could not be loaded.';
    }
    if (ask === asked) state.loading = false;
  }
  const filter = next => {
    Object.assign(state, next);
    state.open = '';
    load();
  };
  async function older() {
    const last = state.entries.at(-1),
      ask = asked;
    if (!last || state.loadingMore) return;
    state.loadingMore = true;
    try {
      const data = await app.pb.send('/api/odyle/admin/audit', {
        query: filters({ before: last.created, beforeId: last.id }),
        requestKey: null,
      });
      if (ask === asked && Array.isArray(data?.entries)) {
        const known = new Set(state.entries.map(e => e.id));
        state.entries = [...state.entries, ...data.entries.filter(e => !known.has(e.id))];
        state.more = data.more;
      }
    } catch (error) {
      if (!error.isAbort) app.checkApiError(error);
    }
    state.loadingMore = false;
  }
  // A new entry arrives over realtime as its record; it joins the list when the filters keep it.
  const words = () => state.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = e =>
    (!state.kind || e.kind === state.kind) &&
    (!state.actor || e.actor === state.actor) &&
    words().every(word =>
      (e.summary + ' ' + e.actorEmail + ' ' + JSON.stringify(e.details)).toLowerCase().includes(word),
    );
  function arrive(record) {
    const entry = {
      id: record.id,
      created: record.created,
      kind: record.kind,
      via: record.via,
      actor: record.actor,
      actorEmail: record.actorEmail,
      summary: record.summary,
      details: record.details || {},
    };
    if (entry.actor && !state.actors.some(a => a.id === entry.actor))
      state.actors = [{ id: entry.actor, email: entry.actorEmail }, ...state.actors];
    if (matches(entry) && !state.entries.some(e => e.id === entry.id))
      state.entries = [{ ...entry, fresh: true }, ...state.entries];
  }
  const actorName = () =>
    state.actors.find(a => a.id === state.actor)?.email ||
    state.entries.find(e => e.actor === state.actor)?.actorEmail ||
    state.actor;
  const narrowed = () => state.kind || state.actor || words().length;
  function exportShown() {
    const entries = state.entries.map(({ fresh, ...entry }) => entry);
    app.utils.downloadJSON(
      {
        exportedAt: new Date().toISOString(),
        server: location.origin,
        filters: { kind: state.kind, actor: state.actor, search: state.search.trim() },
        entries,
      },
      'odyle-audit-' + new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-'),
    );
  }
  const chip = (label, value, clear) =>
    t.span(
      { className: 'label sm odyle-chip' },
      t.span({ className: 'txt-hint' }, label),
      ' ',
      value,
      t.button(
        {
          type: 'button',
          className: 'odyle-chip-clear',
          title: 'Clear',
          ariaLabel: 'Clear ' + label.toLowerCase(),
          onclick: clear,
        },
        t.i({ className: 'ri-close-line', ariaHidden: true }),
      ),
    );
  const moment = at =>
    Number.isFinite(timestamp(at))
      ? new Date(timestamp(at)).toLocaleString([], {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '';
  const fact = (label, value) => [t.dt({ className: 'txt-hint' }, label), t.dd(null, value)];
  function detail(e) {
    const d = e.details || {};
    let body = null;
    if (e.kind === 'settings')
      body = t.div(
        { className: 'odyle-table odyle-changes' },
        t.table(
          null,
          t.thead(null, t.tr(null, t.th(null, 'Setting'), t.th(null, 'Before'), t.th(null, 'After'))),
          t.tbody(
            null,
            (d.changes || [])
              .flatMap(changeRows)
              .map(([label, before, after]) =>
                t.tr(
                  null,
                  t.td({ className: 'txt-bold' }, label),
                  t.td({ className: 'txt-hint' }, before),
                  t.td(null, after),
                ),
              ),
          ),
        ),
      );
    else if (e.kind === 'job')
      body = t.dl(
        { className: 'odyle-fields' },
        fact('Job', (jobInfo[d.job]?.label || d.job) + ' · ' + d.job),
        fact('Done', number(d.done)),
        fact('Failed', number(d.failed)),
        d.skipped ? fact('Skipped', skips[d.skipped] || d.skipped) : null,
        d.error ? fact('Error', d.error) : null,
      );
    else if (e.kind === 'update-apps')
      body = t.dl(
        { className: 'odyle-fields' },
        fact('Version sent', d.version || 'none: each app looked up the newest release'),
        fact('Connections told', number(d.told)),
      );
    else if (e.kind === 'vacuum')
      body = t.dl(
        { className: 'odyle-fields' },
        fact('Database', d.file || d.database),
        fact('Before', bytes(d.beforeBytes)),
        fact('After', bytes(d.afterBytes)),
        fact('Took', millis(d.ms)),
        d.error ? fact('Error', d.error) : null,
      );
    return t.div(
      { className: 'odyle-packet-detail', onclick: ev => ev.stopPropagation() },
      body,
      t.div(
        { className: 'txt-hint txt-sm m-t-xs' },
        when(e.created) +
          ' · ' +
          (e.actorEmail || 'no superuser signed in') +
          (e.via === 'collections'
            ? ' · under Collections → ' + (e.kind === 'ai-knowledge' ? 'armory_ai_knowledge' : 'odyle_settings')
            : ' · on the Odyle pages'),
      ),
      t.div(
        { className: 'flex odyle-detail-actions m-t-xs' },
        e.actor
          ? t.button(
              {
                type: 'button',
                className: 'btn sm secondary',
                disabled: () => state.actor === e.actor,
                onclick: () => filter({ actor: e.actor }),
              },
              t.i({ className: 'ri-user-line', ariaHidden: true }),
              t.span({ className: 'txt' }, 'Only this superuser'),
            )
          : null,
        t.button(
          {
            type: 'button',
            className: 'btn sm transparent secondary',
            onclick: async () => {
              const { fresh, ...entry } = e;
              await app.utils.copyToClipboard(JSON.stringify(entry, null, 2));
              app.toasts.success('Entry copied as JSON.');
            },
          },
          t.i({ className: 'ri-file-copy-line', ariaHidden: true }),
          t.span({ className: 'txt' }, 'Copy JSON'),
        ),
      ),
    );
  }
  // A click opens what an entry changed, unless it selected text to copy.
  const expand = e => {
    if (!String(window.getSelection?.() || '')) state.open = state.open === e.id ? '' : e.id;
  };
  const entryRow = e =>
    t.div(
      {
        rid: e.id,
        className: () =>
          'odyle-packet odyle-audit-entry' + (e.fresh ? ' fresh' : '') + (state.open === e.id ? ' open' : ''),
        onclick: () => expand(e),
      },
      t.span({ className: 'txt-nowrap', title: when(e.created) }, moment(e.created)),
      t.button(
        {
          type: 'button',
          className: 'label sm odyle-kind ' + (auditClass[e.kind] || ''),
          title: 'Show only ' + (auditLabels[e.kind] || e.kind) + ' entries',
          onclick: ev => {
            ev.stopPropagation();
            filter({ kind: e.kind });
          },
        },
        auditLabels[e.kind] || e.kind,
      ),
      e.actor
        ? t.button(
            {
              type: 'button',
              className: 'odyle-link txt-bold txt-ellipsis',
              title: 'Show only what ' + (e.actorEmail || 'this superuser') + ' did',
              onclick: ev => {
                ev.stopPropagation();
                filter({ actor: e.actor });
              },
            },
            e.actorEmail || e.actor,
          )
        : t.span({ className: 'txt-hint' }, '—'),
      t.button(
        {
          type: 'button',
          className: 'odyle-packet-text',
          ariaExpanded: () => state.open === e.id,
          title: 'Show what it changed',
          onclick: ev => {
            ev.stopPropagation();
            expand(e);
          },
        },
        e.summary,
        e.via === 'collections' ? t.span({ className: 'txt-hint' }, ' · under Collections') : null,
      ),
      t.span({ className: 'odyle-packet-ms txt-hint txt-nowrap' }, () => ago(e.created, now())),
      () => (state.open === e.id ? detail(e) : null),
    );

  return layout(
    '#/odyle/audit',
    app.components.refreshButton({ onclick: load }),
    t.div(
      {
        className: 'odyle-audit',
        onmount: async () => {
          load();
          tick = setInterval(() => (state.now = Date.now()), 15000);
          try {
            const stop = await app.pb.collection('odyle_audit').subscribe('*', e => {
              if (e.action === 'create') arrive(e.record);
            });
            if (alive) {
              unsubscribe = stop;
              state.live = true;
            } else stop();
          } catch (error) {
            console.warn('Odyle audit log: new entries show after a refresh:', error);
          }
        },
        onunmount: () => {
          alive = false;
          clearInterval(tick);
          clearTimeout(typing);
          unsubscribe?.();
        },
      },
      () => (state.failed ? t.div({ className: 'alert danger m-b-sm' }, state.failed) : null),
      t.div(
        { className: 'flex m-b-sm odyle-feed-head' },
        t.div({ className: 'txt-lg' }, 'What superusers did'),
        () => (state.live ? t.span({ className: 'odyle-live' }, 'Live') : null),
        t.div(
          { className: 'odyle-filters' },
          auditKinds.map(k =>
            t.button(
              {
                type: 'button',
                className: () => 'btn sm ' + (state.kind === k.id ? 'secondary' : 'transparent'),
                onclick: () => filter({ kind: k.id }),
              },
              t.span({ className: 'txt' }, k.label),
            ),
          ),
        ),
      ),
      t.div(
        { className: 'flex m-b-sm odyle-feed-tools' },
        t.div(
          { className: 'odyle-search' },
          t.i({ className: 'ri-search-line txt-hint', ariaHidden: true }),
          t.input({
            type: 'search',
            id: 'odyle-audit-search',
            placeholder: 'Search: a setting, a dungeon, a job, an email…',
            ariaLabel: 'Search the audit log',
            value: () => state.search,
            oninput: e => {
              state.search = e.target.value;
              clearTimeout(typing);
              typing = setTimeout(() => filter({}), 300);
            },
          }),
        ),
        () => (state.actor ? chip('Superuser', actorName(), () => filter({ actor: '' })) : null),
        t.div({ className: 'm-r-auto' }),
        t.span(
          { className: 'txt-hint txt-sm txt-nowrap' },
          () =>
            number(state.entries.length) +
            (state.more ? '+' : '') +
            (state.entries.length === 1 ? ' entry' : ' entries') +
            (narrowed() ? ' match' + (state.entries.length === 1 && !state.more ? 'es' : '') : ''),
        ),
        t.button(
          {
            type: 'button',
            className: 'btn sm transparent secondary',
            disabled: () => !state.entries.length,
            title: 'The entries shown, as JSON',
            onclick: exportShown,
          },
          t.i({ className: 'ri-download-line', ariaHidden: true }),
          t.span({ className: 'txt' }, 'Export'),
        ),
      ),
      t.div({ className: 'odyle-feed odyle-audit-feed' }, () =>
        state.entries.length
          ? state.entries.map(entryRow)
          : t.div({ className: 'odyle-packet txt-hint' }, () =>
              state.loading
                ? 'Loading…'
                : narrowed()
                  ? 'No entry matches these filters.'
                  : 'Nothing recorded yet. Saving settings or server controls, running a job by hand, Update all apps now and vacuums show up here.',
            ),
      ),
      () =>
        state.more
          ? t.button(
              {
                type: 'button',
                className: () => 'btn sm secondary m-t-sm' + (state.loadingMore ? ' loading' : ''),
                disabled: () => state.loadingMore,
                onclick: older,
              },
              t.span({ className: 'txt' }, 'Show older entries'),
            )
          : null,
      t.p(
        { className: 'txt-hint txt-sm m-t-sm' },
        () =>
          'What superusers did to Odyle: the game settings and server controls they saved, on these pages or under Collections → odyle_settings, with every value that changed and what it was before; the jobs they ran by hand; Update all apps now; database vacuums; who may use the armory AI; and the entries of its knowledge base they added, changed or deleted. Entries are kept for ' +
          number(state.keptDays) +
          " days, and nobody can change or delete one, superusers included. Edits of other collections and PocketBase's own settings are not recorded here.",
      ),
    ),
  );
}
