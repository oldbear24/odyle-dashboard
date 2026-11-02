// The account's Windows readers as the sidebar, the account menu and rooms show them: the one
// online now and how it is named. Pairing one is the dialog in pairing.js, which loads with it;
// signing out of the browser forgets the code it asked for (forgetPairing).
import { t } from './i18n.js';
import { timestamp } from './model.js';

// The connection code this browser asked for while the app has not used it (pairing.js).
export const pairingKey = 'odyle.pairing';
export function forgetPairing(storage) { try { storage.removeItem(pairingKey); } catch { /* storage blocked */ } }
// A reader is online while it was in contact in the last 45 seconds (it sends a
// heartbeat every 20), as on the account page.
const onlineFor = 45000;
// The account page's reader sessions with the name of the PC each runs on, in the form
// rooms and snapshots list them (readers: sessionId, name, lastContactAt).
export function readerList(account) {
  return (account?.apps || []).map(a => ({ sessionId: a.sessionId, name: account.devices?.find(d => d.id === a.device)?.name || '', lastContactAt: a.lastContactAt, character: a.character || '' }));
}
// The reader in contact most recently while it is online; null when none is.
export function onlineReader(readers, now) {
  return (readers || []).filter(r => now - timestamp(r.lastContactAt) < onlineFor).sort((a, b) => timestamp(b.lastContactAt) - timestamp(a.lastContactAt))[0] || null;
}
export const readerLabel = name => name ? t('Reader online on {pc}', { pc: name }) : t('Reader online');
