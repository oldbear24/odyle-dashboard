// Parts of the dashboard load the first time they are needed (a page, a dialog, an action),
// not with the first page, which then downloads and starts sooner; main.js lists them. Once
// the first page is drawn, the others load while the browser is idle (prefetch): later pages
// open at once, the service worker keeps their files for visits without a connection, and a
// tab left open across a deploy already holds them.
//
// lazily(load, gone) is a part: calling it loads its module once and gives it; loaded() is the
// module once it is in (for redraws of a page or dialog it opened), else null; prefetch() loads
// it without failing. A load that fails is tried again the next time; the caller of the part
// gets what gone makes of the error.
export function lazily(load, gone = error => Promise.reject(error)) {
  let loading = null, module = null;
  const fetch = () => loading ??= load().then(m => (module = m), error => { loading = null; throw error; });
  const part = () => fetch().catch(gone);
  part.loaded = () => module;
  part.prefetch = () => fetch().then(() => true, () => false);
  return part;
}

// The server keeps only the files of its own build, so a tab opened before a deploy can find a
// part gone. It then loads the page again, which brings the new build: at most once a minute
// (the time is kept for the tab), so a part that keeps failing shows its error instead of
// loading the page again and again, and never offline, where that cannot help.
export const reloadKey = 'odyle.reloadedAt';
export function reloadOnce(store, now, online = true) {
  if (!online) return false;
  try {
    if (now - (Number(store.getItem(reloadKey)) || 0) < 60000) return false;
    store.setItem(reloadKey, String(now));
    return true;
  } catch { return false; }
}
