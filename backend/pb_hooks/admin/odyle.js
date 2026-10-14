// Odyle page of the PocketBase superuser dashboard, imported by main.js: the Windows
// apps connected right now, the requests ("packets") they send as they arrive and
// the server-wide game settings. `app`, `t`, `store` and `watch` are globals of the
// PocketBase UI (extension API of PocketBase 0.37+, still marked experimental).
// Everything players control is rendered as text nodes, never as HTML.
const stylesheet = new URL('odyle.css', import.meta.url);
stylesheet.search = new URL(import.meta.url).search;
document.head.appendChild(t.link({ rel: 'stylesheet', href: stylesheet.href }));

const pages = [
  { href: '#/odyle', icon: 'ri-pulse-line', label: 'Apps & packets' },
  { href: '#/odyle/settings', icon: 'ri-equalizer-line', label: 'Game settings' },
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
// The companion sends a heartbeat every 20 seconds. As on the dashboard (src/model.js),
// 45 seconds without contact is late and 90 seconds is offline.
function contact(at, now) { const age = now - timestamp(at); return !(age < 90000) ? 'offline' : age >= 45000 ? 'late' : 'online'; }
const contactLabels = { online: 'Online', late: 'Late', offline: 'Offline' };
function reading(c, now) {
  if (!c) return { state: 'waiting', label: 'Waiting for the game' };
  if (!c.confirmed) return { state: 'waiting', label: 'Named, no reading yet' };
  return c.valid && now - timestamp(c.lastSeenAt) < 45000 ? { state: 'live', label: 'Live reading' } : { state: 'stale', label: 'Stale' };
}
const place = p => [p.characterName, p.server ? p.server + (p.region ? ' (' + region(p.region) + ')' : '') : ''].filter(Boolean).join(' · ');
function describe(p) {
  switch (p.kind) {
    case 'report': return (place(p) || 'Character') + ' → ' + number(p.value) + ' Odyle · #' + (p.sequence ?? '?') + ' · ' + (p.parserVersion || 'no adapter');
    case 'heartbeat': return p.characterId ? (p.characterName || p.characterId) + ' still in game' : 'App alive, no character in game';
    case 'session': return p.previousSessionId ? 'Reader session renewed, replaces ' + p.previousSessionId : 'New reader session';
    case 'invalidate': return (p.characterName || p.characterId || 'Character') + ' marked stale';
    case 'character': return (place(p) || 'Character') + ' saved';
    default: return p.kind;
  }
}
const kindClass = { report: 'success', session: 'info', character: 'info', invalidate: 'warning' };

function layout(active, actions, ...content) {
  return t.div({ className: 'page odyle-page' },
    app.components.pageSidebar({ className: 'odyle-sidebar' }, t.nav({ className: 'sidebar-content scrollable' },
      t.details({ className: 'nav-group', open: true }, t.summary({ tabIndex: -1, onclick: () => false }, 'Odyle'),
        pages.map(p => t.a({ href: p.href, className: 'nav-item' + (p.href === active ? ' active' : '') }, t.i({ className: p.icon, ariaHidden: true }), t.span({ className: 'txt' }, p.label)))))),
    t.div({ className: 'page-content full-height' },
      t.header({ className: 'page-header' }, t.nav({ className: 'breadcrumbs' }, t.div({ className: 'breadcrumb-item' }, 'Odyle'), t.div({ className: 'breadcrumb-item' }, () => app.store.title)), actions),
      t.div({ className: 'wrapper m-b-base' }, ...content),
      t.footer({ className: 'page-footer' }, app.components.credits())));
}

export function monitorPage() {
  app.store.title = 'Apps & packets';
  // feed is always current; frozen holds what is shown while the list is paused.
  const state = store({ loading: true, failed: '', apps: [], feed: [], frozen: null, heartbeats: true, offset: 0, now: Date.now() });
  const now = () => state.now + state.offset;
  let alive = true, poll = 0, tick = 0, unsubscribe = null;
  async function load() {
    try {
      const data = await app.pb.send('/api/odyle/admin/monitor', { requestKey: null });
      state.offset = timestamp(data.serverNow) - Date.now(); state.apps = data.apps;
      // The server keeps the newest 200; its list replaces whatever realtime added since.
      state.feed = data.packets.slice().reverse(); state.failed = '';
    } catch (error) { if (!error.isAbort) state.failed = error.message || 'The monitor could not be loaded.'; }
    state.loading = false;
  }
  function arrive(packet) {
    if (!packet || state.feed.some(p => p.id === packet.id)) return;
    state.feed = [{ ...packet, fresh: true }, ...state.feed].slice(0, 200);
  }
  const shown = () => (state.frozen || state.feed).filter(p => state.heartbeats || p.kind !== 'heartbeat' || !p.ok);
  const waiting = () => state.frozen ? state.feed.filter(p => p.id > (state.frozen[0]?.id || 0)).length : 0;
  const recent = () => state.feed.filter(p => now() - timestamp(p.at) < 60000);

  const stat = (label, value, hint) => t.div({ className: 'odyle-stat' }, t.span({ className: 'txt-hint txt-sm' }, label), t.strong(null, value), t.span({ className: 'txt-hint txt-sm' }, hint));
  const appRow = a => t.tr(null,
    t.td(null, t.span({ className: () => 'odyle-status ' + contact(a.lastContactAt, now()) }, () => contactLabels[contact(a.lastContactAt, now())])),
    t.td(null, t.div({ className: 'txt-bold' }, a.account || '—'), t.div({ className: 'txt-hint txt-sm txt-code' }, a.sessionId)),
    // A character belongs to the session that read it last, so older sessions lose it.
    t.td(null, a.character ? [t.div(null, place(a.character)), t.span({ className: () => 'odyle-reading ' + reading(a.character, now()).state }, () => reading(a.character, now()).label)] : () => contact(a.lastContactAt, now()) === 'offline' ? t.span({ className: 'txt-hint' }, '—') : t.span({ className: 'odyle-reading waiting' }, 'Waiting for the game')),
    t.td({ className: 'txt-right' }, a.character?.confirmed ? [t.div({ className: 'txt-bold' }, number(a.character.value)), t.div({ className: 'txt-hint txt-sm' }, () => 'changed ' + ago(a.character.lastReadingAt, now()))] : '—'),
    t.td({ className: 'txt-nowrap' }, () => ago(a.lastContactAt, now())),
    t.td({ className: 'txt-nowrap', title: when(a.connectedAt) }, () => ago(a.connectedAt, now())),
    t.td({ className: 'txt-right' }, number(a.readings)));
  // Packets never change, so rows are keyed and kept: only new ones are drawn (and flash).
  const packetRow = p => t.div({ rid: p.id + '@' + p.at, className: 'odyle-packet' + (p.ok ? '' : ' rejected') + (p.fresh ? ' fresh' : '') },
    t.span({ className: 'txt-hint', title: when(p.at) }, clock(p.at)),
    t.span({ className: 'label sm ' + (p.ok ? kindClass[p.kind] || '' : 'danger') }, p.ok ? p.kind : p.kind + ' rejected'),
    t.span({ className: 'txt-bold txt-ellipsis', title: p.account }, p.account || '—'),
    t.span({ className: 'odyle-packet-text' }, describe(p), p.ok ? null : t.span({ className: 'txt-danger' }, ' — ' + p.error)),
    t.span({ className: 'odyle-packet-ms txt-hint txt-nowrap' }, number(p.ms) + ' ms'));

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
      stat('Packets last minute', () => number(recent().length), () => number(recent().filter(p => p.kind === 'report' && p.ok).length) + ' readings saved'),
      stat('Rejected', () => number(state.feed.filter(p => !p.ok).length), () => 'of the last ' + number(state.feed.length) + ' packets')),
    t.div({ className: 'flex m-b-sm' }, t.div({ className: 'txt-lg' }, 'Connected apps'), t.span({ className: 'txt-hint txt-sm' }, 'one row per running Windows app (reader session)')),
    t.div({ className: 'odyle-table m-b-base' }, t.table(null,
      t.thead(null, t.tr(null, ...['Status', 'Account', 'Game', 'Odyle', 'Last contact', 'Connected', 'Readings'].map(h => t.th({ className: h === 'Odyle' || h === 'Readings' ? 'txt-right' : '' }, h)))),
      t.tbody(null, () => state.apps.length ? state.apps.map(appRow) : t.tr(null, t.td({ colSpan: 7, className: 'txt-hint txt-center' }, () => state.loading ? 'Loading…' : 'No Windows app is connected.'))))),
    t.div({ className: 'flex m-b-sm odyle-feed-head' },
      t.div({ className: 'txt-lg' }, 'Packet flow'),
      t.span({ className: () => 'odyle-live ' + (state.frozen ? 'paused' : '') }, () => state.frozen ? 'Paused' : 'Live'),
      t.div({ className: 'm-r-auto' }),
      t.div({ className: 'field odyle-toggle' }, t.input({ id: 'odyle-heartbeats', type: 'checkbox', className: 'switch', checked: () => state.heartbeats, onchange: e => state.heartbeats = e.target.checked }), t.label({ htmlFor: 'odyle-heartbeats' }, 'Heartbeats')),
      t.button({ type: 'button', className: 'btn sm secondary', onclick: () => state.frozen = state.frozen ? null : state.feed.slice() },
        t.i({ className: () => state.frozen ? 'ri-play-line' : 'ri-pause-line', ariaHidden: true }),
        t.span({ className: 'txt' }, () => state.frozen ? 'Resume' + (waiting() ? ' (' + number(waiting()) + ' new)' : '') : 'Pause'))),
    t.div({ className: 'odyle-feed' }, () => shown().length ? shown().map(packetRow) : t.div({ className: 'odyle-packet txt-hint' }, () => state.loading ? 'Loading…' : 'No packets since the server started.')),
    t.p({ className: 'txt-hint txt-sm m-t-sm' }, 'Packets are the requests behind the readings: reader sessions, Odyle readings, heartbeats every 20 seconds, stale marks and character saves (also from the dashboard). The newest 200 are kept in server memory only and a restart clears them; game traffic itself never reaches the server.')));
}

export function settingsPage() {
  app.store.title = 'Game settings';
  // dungeonText is the catalog as typed; form.dungeons is the list it saves.
  const state = store({ loading: true, saving: false, form: null, dungeonText: '', initial: 'null', defaults: null, get changed() { return state.initial !== JSON.stringify(state.form); } });
  const accept = data => { state.form = { ...data.settings }; state.dungeonText = (data.settings.dungeons || []).join('\n'); state.initial = JSON.stringify(state.form); state.defaults = data.defaults; };
  async function load() {
    try { accept(await app.pb.send('/api/odyle/admin/settings', { requestKey: null })); state.loading = false; } catch (error) { if (!error.isAbort) app.checkApiError(error); }
  }
  async function save() {
    if (state.saving || !state.changed) return;
    state.saving = true;
    try { accept(await app.pb.send('/api/odyle/admin/settings', { method: 'POST', body: state.form, requestKey: null })); app.toasts.success('Saved the Odyle game settings.'); } catch (error) { app.checkApiError(error); }
    state.saving = false;
  }
  const integer = value => { const parsed = parseInt(value, 10); return Number.isNaN(parsed) ? null : parsed; };
  const localHour = hour => new Date(Date.UTC(2000, 0, 1, hour)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const field = (id, label, input, help, width = 4) => t.div({ className: 'col-lg-' + width }, t.div({ className: 'field' }, t.label({ htmlFor: id }, label), input), t.div({ className: 'field-help' }, help));
  // The dungeon catalog is edited as one name per line.
  const lines = value => value.split('\n').map(line => line.trim()).filter(Boolean);
  load();
  return layout('#/odyle/settings', null,
    () => state.loading ? t.div({ className: 'block txt-center' }, t.span({ className: 'loader lg' })) : t.form({ className: 'grid', inert: () => state.saving, onsubmit: e => { e.preventDefault(); save(); } },
      t.div({ className: 'col-lg-12 txt-lg' }, t.p(null, 'Server-wide rules for every room, the dashboard and the Windows app.')),
      field('odyle-per-cube', 'Odyle per cube', t.input({ id: 'odyle-per-cube', type: 'number', min: 1, max: 1000, step: 1, required: true, value: () => state.form.odylePerCube ?? '', oninput: e => state.form.odylePerCube = integer(e.target.value) }),
        'What one dungeon cube costs. Every room reports it as its cost and counts cubes with it; open dashboards follow within 15 seconds.'),
      field('odyle-daily-reset', 'Daily reset (hour, UTC)', t.input({ id: 'odyle-daily-reset', type: 'number', min: 0, max: 23, step: 1, required: true, value: () => state.form.dailyResetHour ?? '', oninput: e => state.form.dailyResetHour = integer(e.target.value) }),
        () => Number.isInteger(state.form.dailyResetHour) && state.form.dailyResetHour >= 0 && state.form.dailyResetHour < 24 ? 'Daily tasks uncheck at ' + String(state.form.dailyResetHour).padStart(2, '0') + ':00 UTC, ' + localHour(state.form.dailyResetHour) + ' in your time zone.' : 'An hour from 0 to 23.'),
      field('odyle-weekly-reset', 'Weekly reset day', app.components.select({ id: 'odyle-weekly-reset', required: true, options: days.map(d => ({ label: capital(d), value: d })), value: () => state.form.weeklyResetDay, onchange: e => state.form.weeklyResetDay = e?.[0]?.value }),
        'Weekly tasks uncheck on this day at the daily reset hour.'),
      field('odyle-inactive', 'Delete inactive accounts after (days)', t.input({ id: 'odyle-inactive', type: 'number', min: 0, max: 3650, step: 1, required: true, value: () => state.form.inactiveAccountDays ?? '', oninput: e => state.form.inactiveAccountDays = integer(e.target.value) }),
        () => state.form.inactiveAccountDays ? 'Every night, accounts that have not used the dashboard or the Windows app for ' + number(state.form.inactiveAccountDays) + ' days are deleted with their characters; rooms they own pass to another player or close.' : '0 keeps every account. Set 30 days or more to delete accounts that stopped using Odyle.'),
      field('odyle-dungeons', 'Dungeon catalog', t.textarea({ id: 'odyle-dungeons', rows: 6, placeholder: 'One dungeon per line', value: () => state.dungeonText, oninput: e => { state.dungeonText = e.target.value; state.form.dungeons = lines(e.target.value); } }),
        () => (state.form.dungeons || []).length ? number(state.form.dungeons.length) + ' dungeons. New wishlist entries and planned runs must be one of them and take this spelling; existing entries stay.' : 'Empty: wishlists and planned runs take any dungeon name. One name per line, up to 200.', 8),
      t.div({ className: 'col-lg-12' }, t.hr()),
      t.div({ className: 'col-lg-12' }, t.div({ className: 'flex' },
        // Resets the game rules only; the retention period and the dungeon catalog stay.
        t.button({ type: 'button', className: 'btn transparent secondary', onclick: () => state.form = { ...state.form, odylePerCube: state.defaults.odylePerCube, dailyResetHour: state.defaults.dailyResetHour, weeklyResetDay: state.defaults.weeklyResetDay } },
          t.span({ className: 'txt' }, () => 'Use defaults (' + number(state.defaults?.odylePerCube) + ' · ' + String(state.defaults?.dailyResetHour ?? '').padStart(2, '0') + ':00 UTC · ' + capital(state.defaults?.weeklyResetDay || '') + ')')),
        t.div({ className: 'm-r-auto' }),
        () => state.changed ? [
          t.button({ type: 'button', className: 'btn transparent secondary', onclick: () => { state.form = JSON.parse(state.initial); state.dungeonText = state.form.dungeons.join('\n'); } }, t.span({ className: 'txt' }, 'Cancel')),
          t.button({ className: () => 'btn expanded-lg ' + (state.saving ? 'loading' : ''), disabled: () => state.saving }, t.span({ className: 'txt' }, 'Save changes')),
        ] : null))));
}

