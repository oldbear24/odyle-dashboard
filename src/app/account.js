// Account & data (/account): the account's name, its PCs and apps, notifications, what it shares,
// the calendar feed, its data and its deletion (account.js draws it). Loads with the page (parts.js).
import { t, tn } from '../i18n.js';
import { escape as esc, timestamp, canonical } from '../model.js';
import { accountView } from '../account.js';
import { defaultNotifications } from '../notify.js';
import { forgetPairing } from '../readers.js';
import { state, storage, leaveRoomTopic, clearRoom } from './state.js';
import { pb, send } from './server.js';
import { modal, ask, toast, formError, closeModal, keepingDrafts, updateAges, download } from './ui.js';
import { onData, onAction, onSubmit } from './actions.js';
import { shell } from './shell.js';
import { show } from './router.js';
import { logout, unwatchOwnTopic } from './session.js';
import {
  reminderState,
  toggleReminders,
  pushState,
  lookAtPush,
  pushOn,
  pushOff,
  remindAgain,
} from './notifications.js';

// The account page redraws when its apps change or go online, late or offline; ages tick in place.
let renderedAccount = '';
const contactState = at => {
  const quiet = Date.now() + state.serverOffset - timestamp(at);
  return quiet < 45000 ? 'online' : quiet < 90000 ? 'late' : 'offline';
};
const accountSignature = () => {
  const { account } = state;
  return canonical([
    account?.account,
    account?.characters,
    account?.apps.map(a => [a.sessionId, a.character, a.device, contactState(a.lastContactAt)]),
    account?.devices?.map(d => [d.id, d.name]),
  ]);
};
export function accountRender() {
  const { account } = state;
  if (!account) return;
  renderedAccount = accountSignature();
  keepingDrafts(() =>
    shell(
      accountView({
        ...account,
        notifications: account.notifications || defaultNotifications,
        reminders: reminderState(),
        push: { state: pushState(), devices: account.push?.devices || [] },
        now: Date.now() + state.serverOffset,
        calendarLink,
      }),
      'account',
    ),
  );
}
export function renderAccount() {
  if (accountSignature() !== renderedAccount) accountRender();
  else updateAges();
}
// The calendar feed's address, shown once after it was made (#35).
let calendarLink = '';
// News for the account page that came while a dialog was open (newsArrived).
let accountMissed = false;
export function newsArrived() {
  if (document.querySelector('#modal')?.open) accountMissed = true;
  else accountRender();
}
export function dialogClosed() {
  if (accountMissed && state.shown === '/account') {
    accountMissed = false;
    accountRender();
  }
}
export async function refreshAccount() {
  const data = await pb.send('/api/odyle/account');
  if (state.shown !== '/account') return;
  state.account = data;
  state.serverOffset = Date.parse(data.serverNow) - Date.now();
  state.online = true;
  await lookAtPush();
}
export async function accountPage(ticket) {
  await leaveRoomTopic();
  clearRoom();
  await refreshAccount();
  if (ticket !== state.navigation) return;
  accountRender();
}

onData({
  forgetDevice: el =>
    ask(
      esc(t('Remove {name}?', { name: el.dataset.name })),
      t(
        'This PC stops reading for your account within a minute and needs a new connection link to pair again. Other browsers and PCs stay signed in.',
      ),
      t('Remove PC'),
      { 'confirm-forget-device': el.dataset.forgetDevice },
    ),
  confirmForgetDevice: async el => {
    await send('forget-device', { deviceId: el.dataset.confirmForgetDevice });
    closeModal();
    await refreshAccount();
    accountRender();
    return toast(t('The PC was unpaired.'));
  },
  copyCalendar: async el => {
    await navigator.clipboard.writeText(el.dataset.copyCalendar).then(
      () => toast(t('Calendar link copied.')),
      () => toast(t('Copy the link from the field.')),
    );
  },
});
onAction({
  reminders: async () => {
    await toggleReminders();
    accountRender();
  },
  'push-on': async () => {
    await pushOn();
    accountRender();
  },
  'push-off': async () => {
    await pushOff();
    accountRender();
  },
  'push-test': async () => {
    const result = await send('push-test', {});
    state.account.push = result.push;
    toast(tn(result.sent, 'Sent a test to {n} device.', 'Sent a test to {n} devices.'));
  },
  'calendar-on': async () => {
    const made = await send('calendar', { enabled: true });
    calendarLink = location.origin + made.path;
    state.account.calendar = made.calendar;
    accountRender();
  },
  'calendar-off': async () => {
    const made = await send('calendar', { enabled: false });
    calendarLink = '';
    state.account.calendar = made.calendar;
    accountRender();
    toast(t('Calendar feed stopped.'));
  },
  export: async () =>
    download(
      JSON.stringify(await pb.send('/api/odyle/export'), null, 2),
      `odyle-data-${new Date().toISOString().slice(0, 10)}.json`,
      'application/json',
    ),
  'sign-out-everywhere': () =>
    ask(
      t('Sign out everywhere?'),
      t(
        'Every other browser and every paired Windows app loses access and must sign in or pair again. Your calendar link stops working, so you will need a new one. This browser stays signed in.',
      ),
      t('Sign out everywhere'),
      { action: 'confirm-sign-out-everywhere' },
    ),
  // The new token ends every realtime sign-in of the account, this browser's too: subscribe again with it.
  'confirm-sign-out-everywhere': async () => {
    const data = await send('sign-out-everywhere');
    pb.authStore.save(data.token, data.record);
    forgetPairing(storage);
    closeModal();
    toast(t('Signed out everywhere else. Pair your Windows app again to keep reading.'));
    await unwatchOwnTopic();
    await show(true);
  },
  'delete-account': () =>
    modal(
      t('Delete your account?'),
      `<p>${t('Your characters, their history, your memberships, wishlist entries and tasks are deleted for good. Rooms you own pass to their longest-standing player, or close if there is none. Download your data first if you want to keep it.')}</p><label>${esc(t('Type {name} to confirm', { name: pb.authStore.record.displayName }))}<input id="delete-confirm" autocomplete="off"></label><button class="button danger" data-action="confirm-delete-account">${t('Delete account for good')}</button><button class="button secondary" data-action="close-dialog">${t('Keep it')}</button>`,
    ),
  'confirm-delete-account': async () => {
    if (document.querySelector('#delete-confirm')?.value.trim() !== pb.authStore.record.displayName)
      return toast(t('Type your display name exactly as shown to confirm.'));
    await send('delete-account', { confirm: true });
    closeModal();
    await logout();
    toast(t('Your account was deleted.'));
  },
});
// The account's settings: each answer is drawn at once.
async function saved(action, body, apply, message) {
  const result = await send(action, body);
  apply(result);
  accountRender();
  if (message) toast(message(result));
}
onSubmit({
  'notifications-form': async (form, data) => {
    const leads = new FormData(form).getAll('lead').map(Number);
    if (!leads.length || leads.length > 3) {
      formError(form, t('Choose one to three reminder times.'));
      return;
    }
    const result = await send('notifications', {
      channels: {
        tray: Boolean(data.tray),
        browser: Boolean(data.browser),
        push: Boolean(data.push),
        discord: Boolean(data.discord),
      },
      leadMinutes: leads,
      kinds: {
        ...(state.account.notifications || defaultNotifications).kinds,
        runs: Boolean(data.runs),
        cap: Boolean(data.cap),
        tasks: Boolean(data.tasks),
        ready: Boolean(data.ready),
      },
      capTicks: Number(data.capTicks ?? 1),
      quiet: {
        from: data.quietFrom || '',
        to: data.quietTo || '',
        timeZone: data.quietFrom || data.quietTo ? data.timeZone : '',
      },
    });
    state.account.notifications = result.notifications;
    remindAgain();
    accountRender();
    toast(t('Notifications saved.'));
  },
  'location-form': (form, data) =>
    saved(
      'location-sharing',
      { enabled: data.shareLocation === 'on' },
      result => {
        state.account.shareLocation = result.shareLocation;
      },
      result =>
        result.shareLocation
          ? t('Saved: your rooms see where your characters were last seen.')
          : t('Saved: location sharing is off, and the saved places are deleted.'),
    ),
  'teammates-form': (form, data) =>
    saved(
      'teammates-sharing',
      { enabled: data.shareTeammates === 'on' },
      result => {
        state.account.shareTeammates = result.shareTeammates;
      },
      result =>
        result.shareTeammates
          ? t("Saved: the Windows app sends your party and force members' names to the armory.")
          : t("Saved: the Windows app no longer sends your party and force members' names."),
    ),
  'pvp-form': (form, data) =>
    saved(
      'pvp-stats',
      { enabled: data.pvpStats === 'on' },
      result => {
        state.account.pvpStats = result.pvpStats;
      },
      result =>
        result.pvpStats
          ? t("Saved: your characters' PvP kills, assists and deaths are counted from now on.")
          : t('Saved: PvP stats are off, and the saved events are deleted.'),
    ),
  'membership-form': (form, data) =>
    saved(
      'membership',
      { membership: data.membership || '' },
      result => {
        state.account.membership = result.membership;
      },
      result =>
        result.membership === 'yes'
          ? t('Saved: the Odyle clock counts with the membership cap.')
          : result.membership === 'no'
            ? t('Saved: the Odyle clock counts with the cap without the membership.')
            : t('Saved: the Odyle clock goes by your readings again.'),
    ),
  'profile-form': (form, data) =>
    saved(
      'profile',
      { displayName: data.displayName },
      result => {
        pb.authStore.save(pb.authStore.token, result.record);
        state.account.account.displayName = result.record.displayName;
      },
      () => t('Display name saved.'),
    ),
});
