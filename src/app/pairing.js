// The pairing dialog (Pair Windows app, Connect reader; pairing.js draws it). It shows this
// browser's unused connection link again, or asks for one, with a countdown to its
// expiry; an account whose reader is online sees that reader first. While it is open, the
// account's news (or, without realtime, a look every ten seconds) tells it when the PC
// paired and what it reads. When pairing is paused, it says so and keeps the downloads.
// Loads with its first opening (shell.js, parts.js).
import { t } from '../i18n.js';
import { escape as esc, timestamp } from '../model.js';
import { windowsApp } from '../release.js';
import { connectionLink } from '../connection.js';
import { forgetPairing, readerList, onlineReader } from '../readers.js';
import { savedPairing, pairedWith, rememberPairing, pairingSlot, downloadPanel, countdown } from '../pairing.js';
import { state, storage } from './state.js';
import { pb, send, backend } from './server.js';
import { modal } from './ui.js';
import { onAction } from './actions.js';
import { loadWindowsRelease, scopeNote } from './shell.js';
import { expired } from './session.js';

let pairing = null,
  pairingTimer = 0;
export async function desktopDialog(another = false) {
  const [data] = await Promise.all([pairingAccount(), loadWindowsRelease()]),
    now = Date.now() + state.serverOffset;
  const p = (pairing = { user: pb.authStore.record.id, step: 'loading', account: data, checkedAt: Date.now() });
  const saved = savedPairing(storage, p.user, now),
    paired = saved && pairedWith(data?.devices, saved),
    reading = onlineReader(readerList(data), now);
  // A link used since this browser asked for it: the PC it paired.
  if (paired) {
    forgetPairing(storage);
    Object.assign(p, { step: 'paired', device: paired.id });
  } else if (reading && !another) Object.assign(p, { step: 'online', reader: reading });
  const view = pairingView(p);
  modal(
    t('Connect your packet reader'),
    `<div class="pairing-slot" data-shown="${esc(shownOf(view))}">${pairingSlot(view)}</div>${downloadPanel(windowsApp(state.windowsRelease))}<div class="info-panel"><h3>${t('How it works')}</h3><p>${t('Start the reader before you log into your character. It detects the character, reads the Odyle snapshot from the game and sends the value again only when it changes. Nothing is injected and no raw traffic leaves your PC.')}</p></div>${scopeNote()}`,
  );
  clearInterval(pairingTimer);
  pairingTimer = setInterval(pairingTick, 1000);
  if (p.step === 'loading') await openLink(p);
}
// The account's PCs and readers; null when the server cannot tell now.
async function pairingAccount() {
  try {
    const data = await pb.send('/api/odyle/account');
    state.serverOffset = Date.parse(data.serverNow) - Date.now();
    state.readers = readerList(data);
    return data;
  } catch (error) {
    if (error?.status === 401) throw error;
    return null;
  }
}
// This browser's link while it is unused, else a new one.
async function openLink(p) {
  const saved = savedPairing(storage, p.user, Date.now() + state.serverOffset);
  if (saved && !pairedWith(p.account?.devices, saved)) {
    showLink(p, saved);
    return renderPairing();
  }
  forgetPairing(storage);
  Object.assign(p, { step: 'loading' });
  renderPairing();
  try {
    const pair = await send('desktop-code');
    if (pairing !== p) return;
    rememberPairing(storage, p.user, pair);
    showLink(p, pair);
  } catch (error) {
    if (error?.status === 401) {
      stopPairing();
      return expired();
    }
    if (pairing !== p) return;
    Object.assign(p, { step: 'refused', problem: error?.message || 'Request could not be completed.' });
  }
  renderPairing();
}
function showLink(p, pair) {
  try {
    Object.assign(p, { step: 'link', pair, link: connectionLink(backend, pair.code) });
  } catch (error) {
    Object.assign(p, { step: 'refused', problem: error.message });
  }
}
const pairingReading = p => p.account?.apps?.find(a => a.device === p.device && a.character)?.character || '';
function pairingView(p) {
  if (p.step === 'link')
    return { step: 'link', link: p.link, left: timestamp(p.pair.expiresAt) - Date.now() - state.serverOffset };
  if (p.step === 'refused')
    return {
      step: 'refused',
      problem: p.problem,
      paused: p.problem === 'Pairing new PCs is paused for now. Try again later.',
    };
  if (p.step === 'paired')
    return {
      step: 'paired',
      pc: p.account?.devices?.find(d => d.id === p.device)?.name || '',
      character: pairingReading(p),
    };
  if (p.step === 'online') return { step: 'online', pc: p.reader.name, character: p.reader.character };
  return { step: p.step };
}
// What the slot shows, without the countdown that pairingTick keeps current in place.
const shownOf = v => JSON.stringify({ ...v, left: undefined });
// A check that finds nothing new (`changed` only) leaves the slot alone, so focus, a
// selected link and a screen reader's last announcement stay.
function renderPairing(changed = false) {
  const el = document.querySelector('#modal[open] .pairing-slot');
  if (!el || !pairing) return;
  const view = pairingView(pairing),
    shown = shownOf(view);
  if (changed && el.dataset.shown === shown) return;
  el.dataset.shown = shown;
  el.innerHTML = pairingSlot(view);
}
// A closed dialog stops following its link (main.js), as does signing out.
export function stopPairing() {
  clearInterval(pairingTimer);
  pairingTimer = 0;
  pairing = null;
}
// Waiting for the PC to pair, or for its first character.
const pairingWaits = p => p.step === 'link' || p.step === 'expired' || (p.step === 'paired' && !pairingReading(p));
function pairingTick() {
  if (!pairing || !document.querySelector('#modal[open] .pairing-slot')) return stopPairing();
  if (pairing.step === 'link') {
    const left = timestamp(pairing.pair.expiresAt) - Date.now() - state.serverOffset,
      el = document.querySelector('#modal [data-pair-expires]');
    if (left <= 0) {
      forgetPairing(storage);
      pairing.step = 'expired';
      renderPairing();
    } else if (el) el.textContent = countdown(left);
  }
  if (!state.live && !document.hidden && pairingWaits(pairing) && Date.now() - pairing.checkedAt >= 10000)
    checkPairing();
}
// Asks the account page's data whether the link paired a PC and what that PC reads; news
// arriving meanwhile asks once more afterwards.
async function checkPairing() {
  const p = pairing;
  if (!p || !pairingWaits(p)) return;
  if (p.checking) {
    p.again = true;
    return;
  }
  p.checking = true;
  try {
    do {
      p.again = false;
      p.checkedAt = Date.now();
      const data = await pairingAccount();
      if (pairing !== p) return;
      if (!data) continue;
      p.account = data;
      const paired = p.step !== 'paired' && p.pair && pairedWith(data.devices, p.pair);
      if (paired) {
        forgetPairing(storage);
        Object.assign(p, { step: 'paired', device: paired.id });
      }
      renderPairing(true);
    } while (p.again);
  } catch (error) {
    if (error?.status === 401) {
      stopPairing();
      expired();
    }
  } finally {
    p.checking = false;
  }
}
// The account's news while the dialog is open: whether its PC paired or reads now; a hidden
// tab looks once it is shown (tabShown).
export function pairingNews() {
  if (!pairing) return;
  if (document.hidden) pairing.missed = true;
  else checkPairing();
}
export function tabShown() {
  if (pairing?.missed) {
    pairing.missed = false;
    checkPairing();
  }
}

onAction({
  'pair-another': async () => {
    if (pairing) await openLink(pairing);
  },
  'new-pairing': async () => {
    if (pairing) {
      forgetPairing(storage);
      await openLink(pairing);
    }
  },
});
