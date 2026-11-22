// This browser's notifications: reminders of the runs this account is going to, cap alerts,
// parties ready and run invitations, and Web Push on this device. Loads with the account page
// or the first tick of a signed-in tab (parts.js).
import { t, language, locale } from '../i18n.js';
import { timestamp } from '../model.js';
import { defaultNotifications, dueReminders, quietAt, capAlertText, deviceName } from '../notify.js';
import { startsIn } from '../runs.js';
import { state, storage } from './state.js';
import { pb, send } from './server.js';
import { toast } from './ui.js';

// Browser reminders of the runs this account is going to, at the account's reminder times
// (Account & data → Notifications) while a dashboard tab is open and this browser may show
// notifications; none in the quiet hours.
const remindedKey = 'odyle.reminded';
let upcomingAt = 0;
// The next tick looks at the upcoming runs again (settings changed).
export const remindAgain = () => {
  upcomingAt = 0;
};
const notifications = () => 'Notification' in window;
export function reminderState() {
  if (!notifications()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return Notification.permission === 'granted' ? 'on' : 'off';
}
export async function toggleReminders() {
  if (!notifications()) return toast(t('This browser cannot show notifications.'));
  if ((await Notification.requestPermission()) !== 'granted')
    return toast(t('Notifications are blocked for this site. Allow them in the browser settings.'));
  upcomingAt = 0;
  toast(t('This browser shows your notifications now.'));
}
// A notification in this browser, through the service worker when there is one.
async function notice(title, options) {
  try {
    const worker = await navigator.serviceWorker?.getRegistration();
    if (worker) await worker.showNotification(title, options);
    else new Notification(title, options);
  } catch {
    /* permission withdrawn meanwhile */
  }
}
const settingsNow = () => state.account?.notifications || state.notificationsSeen || defaultNotifications;
// Cap alerts show where the account wants them in browsers, once per alert across its open tabs.
export async function showCapAlerts(alerts) {
  const settings = settingsNow();
  if (!settings.kinds.cap || !settings.channels.browser || reminderState() !== 'on') return;
  for (const alert of alerts) {
    const { title, body } = capAlertText(alert);
    await notice(title, { body, tag: 'cap-' + alert.characterId + '-' + alert.state, icon: 'icon-192.png' });
  }
}
// A run planned from the wishlist invites those who wanted its dungeon (#45).
export async function showInvites(invites) {
  const settings = settingsNow();
  if (!settings.kinds.runs || !settings.channels.browser || reminderState() !== 'on') return;
  for (const n of invites) {
    // A call to a run now (Run now) says so, with its start in local time.
    if (n.now)
      await notice(t('{by} calls the party to {dungeon}', { by: n.by, dungeon: n.dungeon }), {
        body: t('{room} · starts {time}', {
          room: n.room,
          time: new Date(timestamp(n.startsAt)).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }),
        }),
        tag: 'invite-' + n.runId,
        icon: 'icon-192.png',
        requireInteraction: true,
      });
    else
      await notice(t('{by} invites you to {dungeon}', { by: n.by, dungeon: n.dungeon }), {
        body: t('{room} · {when}', {
          room: n.room,
          when: new Date(timestamp(n.startsAt)).toLocaleString(locale(), {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          }),
        }),
        tag: 'invite-' + n.runId,
        icon: 'icon-192.png',
      });
  }
}
// Everyone going to a run can claim a cube (#48): one notice per run and start, like a push.
export async function showPartyReady(notices) {
  const settings = settingsNow();
  if (settings.kinds.ready === false || !settings.channels.browser || reminderState() !== 'on') return;
  for (const n of notices)
    await notice(t('{dungeon}: the party is ready', { dungeon: n.dungeon }), {
      body: t('All {n} going can claim a cube · {room}', { n: n.of, room: n.room }),
      tag: 'ready-' + n.runId + '@' + n.startsAt,
      icon: 'icon-192.png',
    });
}
export async function remindRuns() {
  if (reminderState() !== 'on' || state.demo || !pb.authStore.isValid || Date.now() - upcomingAt < 60000) return;
  upcomingAt = Date.now();
  const data = await pb.send('/api/odyle/upcoming'),
    now = Date.parse(data.serverNow) || Date.now(),
    settings = data.notifications || defaultNotifications;
  state.notificationsSeen = settings;
  if (!settings.kinds.runs || !settings.channels.browser) return;
  let done;
  try {
    done = JSON.parse(storage.getItem(remindedKey)) || {};
  } catch {
    done = {};
  }
  for (const { run: r, at, key, marks } of dueReminders(data.runs, now, settings.leadMinutes, done)) {
    // One notification per run, start time and reminder time, also across tabs and reloads.
    for (const mark of marks) done[mark] = at;
    if (quietAt(settings, now)) continue;
    const title = t('{dungeon} starts {time}', { dungeon: r.dungeon, time: startsIn(at, now) }),
      options = { body: [r.room, r.note].filter(Boolean).join(' · '), tag: key, icon: 'icon-192.png' };
    await notice(title, options);
  }
  for (const key in done) if (done[key] < now - 86400000) delete done[key];
  try {
    storage.setItem(remindedKey, JSON.stringify(done));
  } catch {
    /* storage full or blocked */
  }
}

// Web Push on this device (backend push.go): the browser subscribes at its push service with
// the server's key, and the server keeps the subscription for the account. pushHere is
// unsupported, unavailable (no key or no service worker), blocked, on or off.
let pushHere = 'unsupported';
export const pushState = () => pushHere;
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && notifications();
async function checkPush() {
  if (!pushSupported()) return (pushHere = 'unsupported');
  const registration = await navigator.serviceWorker.getRegistration();
  if (!state.account?.push?.publicKey || !registration) return (pushHere = 'unavailable');
  if (Notification.permission === 'denied') return (pushHere = 'blocked');
  return (pushHere = (await registration.pushManager.getSubscription()) ? 'on' : 'off');
}
// What this device can do with push now, for the account page.
export const lookAtPush = () =>
  checkPush().catch(() => {
    pushHere = 'unsupported';
  });
async function pushSubscribed(subscription) {
  const json = subscription.toJSON(),
    result = await send('push-subscribe', {
      endpoint: json.endpoint,
      keys: json.keys,
      language: language(),
      device: deviceName(navigator.userAgent),
    });
  state.account.push = result.push;
}
export async function pushOn() {
  if ((await Notification.requestPermission()) !== 'granted') {
    pushHere = 'blocked';
    return toast(t('Notifications are blocked for this site. Allow them in the browser settings.'));
  }
  const registration = await navigator.serviceWorker.ready,
    key = Uint8Array.from(atob(state.account.push.publicKey.replace(/-/g, '+').replace(/_/g, '/')), c =>
      c.charCodeAt(0),
    );
  let subscription = await registration.pushManager.getSubscription();
  // A subscription made with another server key is renewed.
  try {
    subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  } catch {
    await subscription?.unsubscribe();
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  }
  await pushSubscribed(subscription);
  pushHere = 'on';
  toast(t('Push notifications are on for this device.'));
}
export async function pushOff() {
  const subscription = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
  if (subscription) {
    state.account.push = (await send('push-unsubscribe', { endpoint: subscription.endpoint })).push;
    await subscription.unsubscribe();
  }
  pushHere = 'off';
  toast(t('Push notifications are off for this device.'));
}
// Push messages are written in the language of the device that asked for them.
export async function pushLanguage() {
  if (pushHere === 'on')
    (await navigator.serviceWorker.getRegistration())?.pushManager
      .getSubscription()
      .then(s => s && pushSubscribed(s))
      .catch(() => {
        /* kept in the old language */
      });
}
