// Page addresses. Served by the Odyle backend, every page has its own path (/armory/eu/…,
// /tasks): the backend answers each with the dashboard, named for what it shows so search
// engines and link previews see it (backend/web), with a base back to the dashboard's root
// and a mark (meta odyle-routes) that says so. Anywhere else (a static host, the development
// server) pages keep hash routes (#/armory/eu/…), which any host serves. Old hash links open
// their page under its path. Invite links keep their code in the fragment (#/join/<code>), so
// it never reaches a server or its logs.
let marked = null;
// Whether pages have paths here.
export function usesPaths() {
  if (marked === null) marked = typeof document !== 'undefined' && document.querySelector('meta[name="odyle-routes"]')?.content === 'paths';
  return marked;
}
const kept = path => path.startsWith('/join/');
// The dashboard's root, as an address and a path ('/' unless it is served under a folder).
const rootURL = () => new URL('./', document.baseURI);
// The href of a page: relative to the base with paths, its fragment without.
export function link(path) {
  if (!usesPaths()) return '#' + path;
  return kept(path) ? './#' + path : path === '/' ? './' : '.' + path;
}
// The full address of a page, to copy or post elsewhere.
export function address(path) {
  if (!usesPaths()) { const url = new URL(location.href); url.search = ''; url.hash = path; return url.href; }
  return new URL(link(path), rootURL()).href;
}
// The page the address bar names: its path (or an invite's fragment), or its fragment.
export function current() {
  if (!usesPaths() || kept(location.hash.slice(1))) return location.hash.slice(1);
  const root = rootURL().pathname;
  return location.pathname.startsWith(root) ? '/' + location.pathname.slice(root.length) : '/';
}
// The page a link leads to within the dashboard, or '' for anything else (another site, the
// API, a file). Without paths links are fragments, which the browser follows by itself.
export function linked(href) {
  if (!usesPaths()) return '';
  let url;
  try { url = new URL(href, document.baseURI); } catch { return ''; }
  const root = rootURL();
  if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname)) return '';
  if (kept(url.hash.slice(1))) return url.hash.slice(1);
  if (url.hash) return '';
  return '/' + url.pathname.slice(root.pathname.length);
}
// Shows path in the address bar, as a new history entry or in place of the current one.
export function visit(path, replace = false) {
  if (!usesPaths()) {
    if (location.hash === '#' + path) return;
    if (replace) history.replaceState(null, '', '#' + path); else location.hash = path;
    return;
  }
  const target = new URL(link(path), document.baseURI).href;
  if (location.href !== target) history[replace ? 'replaceState' : 'pushState'](null, '', target);
}
// An old hash link (#/armory/…) opened where pages have paths: its page under its path.
export function adoptHash() {
  if (!usesPaths() || !/^#\//.test(location.hash) || kept(location.hash.slice(1))) return false;
  history.replaceState(null, '', link(location.hash.slice(1)));
  return true;
}
// Whether this visit names no page, so the dashboard may resume the last one.
export const bare = () => usesPaths() ? current() === '/' && !location.hash : !/^#\//.test(location.hash);

// Each page's title in the tab, and for search engines that run the page: the same names
// the backend gives it (backend/odyle/pages.go), in the reader's language.
export function retitle(title) { if (typeof document !== 'undefined' && document.title !== title) document.title = title; }
