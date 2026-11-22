// The dashboard's entry (index.html): the fonts and styles, the page's listeners, which hand
// each click, form and change to the part of the dashboard that drew it (app/actions.js), and
// the first page. The parts live in app/ (#192):
// - state.js (the shared state), server.js (the PocketBase client), ui.js (messages, dialogs,
//   redraws), actions.js (the dispatch tables) and parts.js (what loads lazily);
// - shell.js (the frame and the navigation), notes.js (announcements and releases), router.js
//   (pages and their addresses) and session.js (the sign-in, the tick and realtime news);
// - welcome.js, armory.js, pages.js (What's new, privacy, timers, achievements, week, slot
//   machine) and invites.js, which come with the first page;
// - library.js, room.js, cards.js, dialogs.js, tasks.js, account.js, notifications.js and
//   pairing.js: the signed-in dashboard, which loads with its pages (parts.js).
// src/*.js draw and compute without the page or the server; src/parts/*.js pair a lazily
// loaded view with its styles.
import { t, detect, useLanguage, useEnglishLocale, language } from './i18n.js';
import { adoptHash, retitle, pageTitle } from './routes.js';
import { state, storage } from './app/state.js';
import { pb } from './app/server.js';
import { app, setPressed, formError, failed } from './app/ui.js';
import { clickHandler, submitHandler, changeHandler } from './app/actions.js';
import {
  gone,
  prefetchParts,
  libraryPart,
  roomPart,
  tasksPart,
  accountPart,
  notificationsPart,
  pairingPart,
} from './app/parts.js';
import { checkRelease, loadAnnouncement } from './app/notes.js';
import { show, go, rerender, currentPath } from './app/router.js';
import { cardPreview } from './app/armory.js';
import { authenticated, renewal, failure, expired } from './app/session.js';
import './app/invites.js';
// The fonts come with the dashboard, so no visitor's address goes to a font service (#39).
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/manrope';
// The page preloads the Latin files of both fonts (vite.config.js); Czech also needs Latin Extended.
import dmSansLatinExt from '@fontsource-variable/dm-sans/files/dm-sans-latin-ext-wght-normal.woff2?url';
import manropeLatinExt from '@fontsource-variable/manrope/files/manrope-latin-ext-wght-normal.woff2?url';
import './style.css';
import './accounts.css';
import './features.css';
import './layout.css';

const languageKey = 'odyle.language';

// A form goes to its handler (by its id) one at a time; what fails says why inside the form.
app.addEventListener('submit', async e => {
  e.preventDefault();
  if (state.busy) return;
  state.busy = true;
  const form = e.target,
    data = Object.fromEntries(new FormData(form)),
    button = form.querySelector('[type="submit"]');
  button.disabled = true;
  form.querySelector('.form-error')?.remove();
  try {
    await submitHandler(form)?.(form, data);
  } catch (error) {
    if (error?.status === 401 && pb.authStore.token) expired();
    else if (form.isConnected) formError(form, t(error?.message || 'Request could not be completed.'));
    else failed(error);
  } finally {
    state.busy = false;
    if (button.isConnected) button.disabled = false;
  }
});
// A button goes to its handler (by its data-* attributes); the logo leads home.
app.addEventListener('click', async e => {
  const el = e.target.closest('button, .brand');
  setPressed(el && el === document.activeElement ? el : null);
  if (!el) return;
  try {
    if (el.matches('.brand')) {
      e.preventDefault();
      return await go('/');
    }
    await clickHandler(el)?.(el, e);
  } catch (error) {
    failure(error);
  }
});
app.addEventListener('change', async e => {
  const el = e.target;
  if (el.closest?.('#card-form')) return cardPreview(el.form);
  if (el.id === 'language-select') return changeLanguage(el.value);
  return changeHandler(el)?.(el, e);
});
async function changeLanguage(code) {
  // A dictionary gone with a deploy loads the new build, in the language asked for (gone).
  try {
    await useLanguage(code);
  } catch (error) {
    storage.setItem(languageKey, code);
    return Promise.resolve(error).then(gone).catch(failure);
  }
  document.documentElement.lang = language();
  retitle(pageTitle(currentPath(), document.title));
  storage.setItem(languageKey, language());
  await notificationsPart.loaded()?.pushLanguage();
  return rerender();
}
app.addEventListener('focusin', e => {
  if (e.target.matches?.('.link-field')) e.target.select();
});
// A closed dialog may have held back room changes (rename, roles); draw them now. A closed
// pairing dialog stops following its link.
app.addEventListener(
  'close',
  e => {
    if (e.target.id !== 'modal') return;
    pairingPart.loaded()?.stopPairing();
    if (state.room && !state.demo) roomPart.loaded()?.renderDashboard();
    accountPart.loaded()?.dialogClosed();
  },
  true,
);
// A picture that fails to load (removed meanwhile, server unreachable) uncovers the initials.
app.addEventListener(
  'error',
  e => {
    if (e.target.matches?.('.portrait img')) e.target.closest('.portrait-photo').remove();
  },
  true,
);
// An armory image the backend does not keep (yet) leaves its frame empty.
app.addEventListener(
  'error',
  e => {
    if (e.target.matches?.('img.armory-img')) {
      e.target.parentElement?.classList.add('is-empty');
      e.target.remove();
    }
  },
  true,
);
// The page language is ready before the first page is drawn; without its dictionary it stays English.
// The service worker keeps the dashboard's files for visits without a connection and
// shows run reminders; development builds go without it.
if (import.meta.env.PROD && 'serviceWorker' in navigator)
  navigator.serviceWorker.register('./sw.js').catch(() => {
    /* runs without offline files */
  });
adoptHash();
const startLanguage = detect(storage.getItem(languageKey), navigator.languages || [navigator.language]);
useEnglishLocale(navigator.languages || [navigator.language]);
if (startLanguage === 'cs')
  for (const href of [dmSansLatinExt, manropeLatinExt])
    document.head.append(
      Object.assign(document.createElement('link'), {
        rel: 'preload',
        as: 'font',
        type: 'font/woff2',
        href,
        crossOrigin: '',
      }),
    );
// A kept sign-in is renewed while the dictionary loads (#186).
const renewing = pb.authStore.isValid ? renewal() : null;
// The part the signed-in page needs loads alongside the renewal, so its code and its data do not
// wait for each other on a first visit (parts.js; the router loads it again and finds it loaded).
if (pb.authStore.isValid) {
  const path = currentPath();
  (path.startsWith('/room/')
    ? roomPart
    : path === '/tasks'
      ? tasksPart
      : path === '/account'
        ? accountPart
        : path === '/'
          ? libraryPart
          : null
  )?.prefetch();
}
useLanguage(startLanguage)
  .catch(() => useLanguage('en'))
  .then(() => {
    document.documentElement.lang = language();
    retitle(pageTitle(currentPath(), document.title));
    if (pb.authStore.isValid) return authenticated(renewing).catch(failure);
    loadAnnouncement(true).catch(() => {
      /* an older backend or no connection: no banner */
    });
    return show().catch(failure);
  })
  .then(prefetchParts);
// Whether a newer release is out, every minute at most, signed in or not (checkRelease).
setInterval(
  () =>
    checkRelease().catch(() => {
      /* the next minute tries again */
    }),
  15000,
);
