// Discord sign-in opens a window and waits for its answer over realtime (the SDK's
// authWithOAuth2). Browsers built into other apps often cannot do that: they block the
// window, open it where the page never hears back, or suspend the page meanwhile. The
// dashboard then offers its own link to open in a real browser.

// Browsers built into apps, by the marks they leave in the user agent: Facebook,
// Messenger, Instagram, LINE, WeChat, Snapchat, TikTok and Discord, Android's WebView
// (wv) and iOS web views without Safari's mark. An installed web app (standalone) has no
// Safari mark either, but is no in-app browser. Apps that open links in the system's
// own browser view (Discord does on some phones) cannot be told apart; the help under
// the sign-in button covers them.
const marks = /FBAN|FBAV|FB_IAB|FBIOS|Instagram|\bLine\/|MicroMessenger|Snapchat|BytedanceWebview|musical_ly|TikTok|\b[Dd]iscord\/|; ?wv\)/;
export function inAppBrowser(userAgent = '', standalone = false) {
  if (marks.test(userAgent)) return true;
  return !standalone && /\b(iPhone|iPad|iPod)\b/.test(userAgent) && /AppleWebKit/.test(userAgent) && !/Safari\//.test(userAgent);
}
// The link to open elsewhere: this page with its route, so an invite link (#/join/<code>)
// still joins after signing in there, without a query an app may have added.
export function signInLink(page) { const url = new URL(page); url.search = ''; return url.href; }
