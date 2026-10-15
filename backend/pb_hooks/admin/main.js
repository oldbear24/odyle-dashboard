// Entry of the Odyle extension for the PocketBase superuser dashboard; PocketBase
// concatenates it into /_/extensions.js. Routes must be registered right away, before
// the dashboard's router starts. main.pb.js has browsers fetch this entry on every
// load; the other extension files are kept for 14 days, so the page code (odyle.js) is
// imported on the first visit under the content hash the backend reports, and a
// deploy reaches dashboards on reload.
let page = null;
function load() {
  page ||= app.pb.send('/api/odyle/admin/ui', { requestKey: null }).then(info => info.version, () => '')
    .then(version => import('./extensions/odyle/odyle.js?v=' + encodeURIComponent(version)));
  page.catch(() => { page = null; });
  return page;
}
// PocketBase's header scrolls sideways when its links do not fit, and on phones the
// Odyle link, the last one, ends up out of sight. There every link but the open page's
// shows only its icon (its label stays for screen readers), so all of them fit.
const header = document.createElement('style');
header.textContent = '@media (max-width:520px){.app-main-nav .header-link:not(.active) .txt{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}}';
document.head.append(header);
app.store.headerLinks.push({ href: '#/odyle', icon: 'ri-pulse-line', label: 'Odyle' });
app.routes.superuserOnly('#/odyle', async route => (await load()).monitorPage(route));
app.routes.superuserOnly('#/odyle/status', async route => (await load()).statusPage(route));
app.routes.superuserOnly('#/odyle/jobs', async route => (await load()).jobsPage(route));
app.routes.superuserOnly('#/odyle/settings', async route => (await load()).settingsPage(route));
app.routes.superuserOnly('#/odyle/controls', async route => (await load()).controlsPage(route));
