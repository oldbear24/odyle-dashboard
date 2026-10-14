// Entry of the Odyle extension for the PocketBase superuser dashboard; PocketBase
// concatenates it into /_/extensions.js. Routes must be registered right away, before
// the dashboard's router starts. Browsers keep extension files for 14 days, so keep
// this entry stable: the page code (odyle.js) is imported on the first visit under
// the content hash the backend reports, and a deploy reaches dashboards on reload.
let page = null;
function load() {
  page ||= app.pb.send('/api/odyle/admin/ui', { requestKey: null }).then(info => info.version, () => '')
    .then(version => import('./extensions/odyle/odyle.js?v=' + encodeURIComponent(version)));
  page.catch(() => { page = null; });
  return page;
}
app.store.headerLinks.push({ href: '#/odyle', icon: 'ri-pulse-line', label: 'Odyle' });
app.routes.superuserOnly('#/odyle', async route => (await load()).monitorPage(route));
app.routes.superuserOnly('#/odyle/settings', async route => (await load()).settingsPage(route));
