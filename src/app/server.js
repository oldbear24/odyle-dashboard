// The Odyle server: the PocketBase client, the dashboard's POST routes and who this account is
// in the open room.
import PocketBase, { LocalAuthStore } from 'pocketbase';
import { state } from './state.js';

export const backend =
  import.meta.env.VITE_POCKETBASE_URL || (import.meta.env.DEV ? 'http://127.0.0.1:8090' : window.location.origin);
// Persisted in localStorage: the sign-in is shared by every tab of this browser and survives restarts.
export const pb = new PocketBase(backend, new LocalAuthStore('odyle.account'));
pb.autoCancellation(false);
// A refused token ends the sign-in only after a refresh fails too (expired), not as soon as the SDK sees a 401.
pb.autoClearAuthStore(false);

export async function send(action, body = {}) {
  const data = await pb.send('/api/odyle/' + action, { method: 'POST', body });
  if (data.serverNow) state.serverOffset = Date.parse(data.serverNow) - Date.now();
  return data;
}

export const me = () => state.members.find(m => m.user === pb.authStore.record?.id);
export const owner = () => state.demo || state.room?.owner === pb.authStore.record?.id;
// The owner or an officer (#43): invites, every run, clearing the wishlist for everyone and Discord reminders.
export const manager = () => owner() || me()?.role === 'officer';
export const mine = () => me()?.characters || [];
