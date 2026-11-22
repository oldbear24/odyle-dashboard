// What every part of the dashboard draws with: the page's root, messages (the toast and what
// screen readers read out), dialogs, form errors, redraws that keep what the user typed, ages
// that tick in place, copying and downloads.
import { t } from '../i18n.js';
import { escape as esc, age } from '../model.js';
import { state } from './state.js';

export const app = document.querySelector('#app');
// The messages that screen readers read out live outside #app, which pages draw anew (#199):
// the toast, and a polite and an urgent region that say what really changed (an announcement,
// a new release, the connection), so a redraw never reads anything out again.
function liveRegion(id, attributes, className = '') {
  const el = document.createElement('div');
  el.id = id;
  el.className = className;
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
  document.body.append(el);
  return el;
}
const toastBox = liveRegion('toast', { role: 'status', 'aria-live': 'polite' }),
  politeRegion = liveRegion('live-polite', { 'aria-live': 'polite' }, 'sr-only'),
  urgentRegion = liveRegion('live-urgent', { role: 'alert' }, 'sr-only');
toastBox.addEventListener('click', () => toastBox.classList.remove('show'));
export function announce(text, urgent = false) {
  const el = urgent ? urgentRegion : politeRegion;
  el.textContent = '';
  setTimeout(() => {
    el.textContent = text;
  }, 100);
}

let toastTimer;
export function toast(message) {
  const el = toastBox;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 6000);
}
// A failed form also says why inside the form, next to what has to change, for screen
// readers (role=alert) and for anyone who missed the toast.
export function formError(form, message) {
  form.querySelector('.form-error')?.remove();
  form.insertAdjacentHTML('beforeend', `<p class="form-error" role="alert">${esc(message)}</p>`);
}
// Backend and SDK errors arrive in English; t() shows them in the page's language.
export const failed = error => toast(t(error?.message || 'Request could not be completed.'));

// The dialog keeps its title and close button in view: only its body scrolls. The same dialog
// drawn again (a countdown, a saved change) keeps where its reader scrolled to. `wide` is
// true or the dialog's classes.
export function modal(title, body, wide = false) {
  const el = document.querySelector('#modal'),
    again = el.open && el.dataset.title === title ? el.querySelector('.modal-body')?.scrollTop || 0 : 0;
  el.className = wide === true ? 'wide' : wide || '';
  el.dataset.title = title;
  el.innerHTML = `<div class="modal-head"><h2 id="modal-title">${title}</h2><button data-action="close-dialog" class="close-button" aria-label="${esc(t('Close dialog'))}">×</button></div><div class="modal-body">${body}</div>`;
  if (!el.open) el.showModal();
  if (again) el.querySelector('.modal-body').scrollTop = again;
}
// Draws a part of the open dialog again (html is the whole part) and puts the focus back on
// the pager button the reader used, or on the page number when that button now leads nowhere.
export function redraw(selector, html, used) {
  const part = document.querySelector('#modal ' + selector);
  if (!part) return;
  const step = used?.closest?.('.pager')
    ? `.pager-step.${used.classList.contains('newer') ? 'newer' : 'older'}${used.classList.contains('edge') ? '.edge' : ':not(.edge)'}`
    : '';
  part.outerHTML = html;
  const fresh = document.querySelector('#modal ' + selector);
  if (!step || !fresh) return;
  const again = fresh.querySelector(step),
    at = fresh.querySelector('.pager-at');
  if (again && !again.disabled) again.focus();
  else if (at) {
    at.tabIndex = -1;
    at.focus();
  }
}
export const closeModal = () => document.querySelector('#modal')?.close();
export const signInPrompt = text =>
  modal(
    t('Sign in to continue'),
    `<p>${text}</p><button class="button discord-button" data-action="exit-demo">${t('Sign in with Discord')}</button>`,
  );
// Asks before a change; Keep it closes the dialog, or goes back to the one named.
export function ask(title, text, button, data, back = 'close-dialog') {
  modal(
    title,
    `<p>${text}</p><button class="button danger" ${Object.entries(data)
      .map(([k, v]) => `data-${k}="${esc(v)}"`)
      .join(' ')}>${button}</button><button class="button secondary" data-action="${back}">${t('Keep it')}</button>`,
  );
}

// The form fields the user changed: a half-typed entry, a picked dungeon, a ticked box.
const ticked = i => i.type === 'checkbox' || i.type === 'radio';
const changedField = i =>
  ticked(i)
    ? i.checked !== i.defaultChecked
    : i.options
      ? i.selectedIndex !== [...i.options].reduce((at, o, n) => (o.defaultSelected ? n : at), 0)
      : Boolean(i.value) && i.value !== i.defaultValue;
const formFields = () => [
  ...document.querySelectorAll(
    'form[id] input[name]:not([type=hidden]), form[id] select[name], form[id] textarea[name]',
  ),
];
// Whether a form on the page holds unsaved input (a new release waits for it, #197).
export const drafted = () => formFields().some(changedField);
// The control that had the focus, as selectors that find it after a redraw (#199): its id, else
// its tag with its data-* attributes, then with fewer of them (Going becomes Can't go), else a
// link by its address. A button disabled while its request ran lost the focus to the page, so
// the button pressed with the focus on it (pressed, set by each click) stands in for it.
let pressed = null;
export function setPressed(el) {
  pressed = el;
}
function focusKeys() {
  const active = document.activeElement,
    el = active && active !== document.body ? active : pressed?.isConnected ? pressed : null;
  if (!el || !app.contains(el) || el.closest('#modal')) return [];
  if (el.id) return ['#' + CSS.escape(el.id)];
  const tag = el.tagName.toLowerCase(),
    data = [...el.attributes].filter(a => a.name.startsWith('data-')).map(a => `[${a.name}="${CSS.escape(a.value)}"]`);
  if (data.length) return data.map((_, n) => tag + data.slice(0, data.length - n).join(''));
  return el.getAttribute('href') ? [`${tag}[href="${CSS.escape(el.getAttribute('href'))}"]`] : [];
}
// Full redraws keep a half-typed form entry, a picked dungeon (wishlist, run, task forms) or a
// changed checkbox, the focus and where tables were scrolled to; what the user did not change
// shows what the redraw brings.
export function keepingDrafts(render) {
  const focused = focusKeys(),
    scrolled = [...app.querySelectorAll('.table-scroll')].map(el => [el.scrollLeft, el.scrollTop]);
  const drafts = formFields()
    .filter(i => changedField(i) || i === document.activeElement)
    .map(i => ({
      selector: `#${i.form.id} [name="${i.name}"]` + (ticked(i) ? `[value="${CSS.escape(i.value)}"]` : ''),
      ticked: ticked(i),
      checked: i.checked,
      value: i.value,
      focused: i === document.activeElement,
      start: i.selectionStart,
      end: i.selectionEnd,
    }));
  render();
  for (const d of drafts) {
    const input = document.querySelector(d.selector);
    if (!input || (input.options && ![...input.options].some(o => o.value === d.value))) continue;
    if (d.ticked) input.checked = d.checked;
    else input.value = d.value;
    if (d.focused) {
      input.focus();
      if (input.setSelectionRange && d.start !== null)
        try {
          input.setSelectionRange(d.start, d.end);
        } catch {
          /* inputs without a text selection */
        }
    }
  }
  const tables = app.querySelectorAll('.table-scroll');
  if (tables.length === scrolled.length)
    tables.forEach((el, i) => {
      [el.scrollLeft, el.scrollTop] = scrolled[i];
    });
  if (document.activeElement && document.activeElement !== document.body) return;
  for (const selector of focused) {
    const el = app.querySelector(selector);
    if (el && !el.disabled) {
      el.focus({ preventScroll: true });
      break;
    }
  }
}

// The count beside a page in the navigation (shell.js): tasks left (tasks.js), achievements
// reached since the last look (pages.js). Each registers how it counts.
const badges = {};
export const badge = (action, count) => {
  badges[action] = count;
};
export const badgeOf = action => badges[action]?.() || '';

// Ages ("2m ago") tick in place; the character rows add their countdowns (cards.js onAges).
const agers = [];
export const onAges = update => {
  agers.push(update);
};
export function updateAges() {
  const now = Date.now() + state.serverOffset;
  document.querySelectorAll('[data-age]').forEach(el => {
    el.textContent = age(el.dataset.age, now);
  });
  for (const update of agers) update(now);
}

// The clipboard API is missing or refused in some browsers (in-app ones, plain HTTP); a
// selected text field copies there. False when neither works.
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* tried below */
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.readOnly = true;
  field.style.cssText = 'position:fixed;top:0;opacity:0';
  (document.querySelector('#modal[open]') || document.body).append(field);
  field.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
  }
}
export function download(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const saveBlob = (blob, name) => {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
};
