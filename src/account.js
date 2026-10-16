import { t, tn, languages, language } from './i18n.js';
import { escape as esc, age } from './model.js';
import { icon } from './icons.js';
import { defaultNotifications, leadChoices, leadLabel, browserZone } from './notify.js';
// The account page (#/account): profile, language, the paired Windows PCs and the apps
// reading for the account, and the account's data: download it, sign out everywhere or delete it.
// The account's notifications: what, where and quiet hours, saved for every browser and
// Windows app; this browser's permission is asked here too.
function notificationsCard(n, reminders) {
  const leads = [...new Set([...leadChoices, ...n.leadMinutes])].sort((a, b) => a - b);
  const check = (name, on, label, extra = '') => `<label class="check-row"><input type="checkbox" name="${name}" ${on ? 'checked' : ''} ${extra}> <span>${label}</span></label>`;
  const here = reminders === 'unsupported' ? t('This browser cannot show notifications.') : reminders === 'blocked' ? t('Notifications are blocked for this site. Allow them in the browser settings.') : reminders === 'on' ? t('This browser may show them.') : '';
  const zone = n.quiet.from ? n.quiet.timeZone : browserZone();
  return `<form id="notifications-form" class="setup-card notifications-card"><h2>${t('Notifications')}</h2><p>${t('For this account in every browser and Windows app. Room owners can also post runs to Discord under Room settings.')}</p>
<fieldset><legend>${t('Planned runs')}</legend>${check('runs', n.kinds.runs, t('Remind me of runs I am going to'))}<div class="lead-choices" role="group" aria-label="${esc(t('Reminder times'))}">${leads.map(m => `<label class="chip-check"><input type="checkbox" name="lead" value="${m}" ${n.leadMinutes.includes(m) ? 'checked' : ''}><span>${esc(leadLabel(m))}</span></label>`).join('')}</div><small class="account-note">${t('Up to three times before each run.')}</small></fieldset>
<fieldset><legend>${t('Where')}</legend>${check('tray', n.channels.tray, t('Windows app (tray)'))}${check('browser', n.channels.browser, t('Browsers with the dashboard open'))}${here ? `<small class="account-note">${here}</small>` : reminders === 'off' ? `<button class="button secondary small" type="button" data-action="reminders">${t('Allow in this browser')}</button>` : ''}</fieldset>
<fieldset><legend>${t('Quiet hours')}</legend><div class="quiet-hours"><label>${t('From')}<input type="time" name="quietFrom" value="${esc(n.quiet.from)}"></label><label>${t('To')}<input type="time" name="quietTo" value="${esc(n.quiet.to)}"></label></div><input type="hidden" name="timeZone" value="${esc(zone)}"><small class="account-note">${esc(t('No notifications in this span, in {zone}. Leave both empty for none.', { zone }))}</small></fieldset>
<button class="button primary" type="submit">${t('Save notifications')}</button></form>`;
}
export function accountView({ account, apps, devices = [], characters, limits, reminders = 'off', notifications = defaultNotifications, now }) {
  const late = a => now - Date.parse(String(a.lastContactAt).replace(' ', 'T'));
  const reading = a => a ? `<span class="status ${late(a) < 45000 ? 'live' : late(a) < 90000 ? 'stale' : 'offline'}"><i></i>${late(a) < 45000 ? t('Online') : late(a) < 90000 ? t('Late') : t('Offline')}</span><small class="account-note">${a.character ? esc(a.character) : t('No character in game')} · ${t('last contact')} <span data-age="${esc(a.lastContactAt)}">${age(a.lastContactAt, now)}</span></small>`
    : `<span class="status offline"><i></i>${t('Not reading')}</span><small class="account-note">${t('No reader session in the last day')}</small>`;
  // Paired PCs with the reader session each has open; sessions of apps paired before
  // devices had names, or opened without a device key, are listed on their own.
  const pcRows = devices.map(d => {
    const name = d.name || t('Windows PC');
    return `<div class="wish-row device-row"><div class="wish-name"><strong>${esc(name)}</strong><small>${t('paired')} <span data-age="${esc(d.pairedAt)}">${age(d.pairedAt, now)}</span>${d.lastSignInAt ? ` · ${t('signed in')} <span data-age="${esc(d.lastSignInAt)}">${age(d.lastSignInAt, now)}</span>` : ''}</small></div>${reading(apps.find(a => a.device === d.id))}<div class="wish-actions"><button class="remove" data-forget-device="${esc(d.id)}" data-name="${esc(name)}" title="${esc(t('Unpair {name} from your account', { name }))}">${t('Remove PC')}</button></div></div>`;
  });
  const others = apps.filter(a => !devices.some(d => d.id === a.device)).map(a => `<div class="wish-row"><div class="wish-name"><strong>${t('Windows app')}</strong><small>${t('connected')} <span data-age="${esc(a.connectedAt)}">${age(a.connectedAt, now)}</span></small></div>${reading(a)}</div>`);
  const appRows = [...pcRows, ...others].join('');
  return `<main class="dashboard account-page"><section class="heading"><div><div class="eyebrow"><span class="tiny-diamond"></span> ${t('YOUR ACCOUNT')}</div><h1>${t('Account & data')}<span class="mint">.</span></h1><p>${account.email ? esc(t('Signed in with Discord · {email}', { email: account.email })) : t('Signed in with Discord')}</p></div></section>
<div class="account-grid">
<form id="profile-form" class="setup-card"><h2>${t('Display name')}</h2><p>${t('Room members see this name next to your characters.')}</p><label>${t('Display name')}<input name="displayName" maxlength="40" autocomplete="nickname" required value="${esc(account.displayName)}"></label><button class="button primary" type="submit">${t('Save name')}</button></form>
<div class="setup-card"><h2>${t('Language')}</h2><p>${t('Used for the whole dashboard in this browser.')}</p><label>${t('Language')}<select id="language-select">${languages.map(l => `<option value="${l.code}" ${l.code === language() ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label></div>
${notificationsCard(notifications, reminders)}
</div>
<section class="party-section"><div class="section-heading"><h2>${t('Windows apps')} <span>${pcRows.length + others.length}</span></h2><button class="button secondary" data-action="desktop">${t('Pair Windows app')} ${icon('arrow')}</button></div><div class="wish-panel">${appRows ? `<div class="wish-list">${appRows}</div>` : `<p class="wish-empty">${t('No Windows app is paired with this account.')}</p>`}<p class="wish-note account-foot">${t('Lost a PC? Remove it above: it stops reading within a minute and needs a new connection link. Shared your account by mistake? Sign out everywhere: every browser and Windows app loses access and needs to sign in or pair again. This browser stays signed in.')} <button class="text-button" data-action="sign-out-everywhere">${t('Sign out everywhere')} ${icon('arrow')}</button></p></div></section>
<section class="party-section"><div class="section-heading"><h2>${t('Your data')}</h2><span class="refresh-label">${esc(tn(characters, '{n} character saved', '{n} characters saved'))} · ${esc(t('up to {limit}', { limit: limits.characters }))}</span></div><div class="account-grid">
<div class="setup-card"><h2>${t('Download my data')}</h2><p>${t('One JSON file with your account, characters and their Odyle history, rooms, wishlist entries, planned runs, tasks and Windows app sessions.')}</p><button class="button secondary" data-action="export">${icon('download')} ${t('Download my data')}</button></div>
<div class="setup-card danger-card"><h2>${t('Delete account')}</h2><p>${t('Deletes your account, characters, history, memberships, wishlist entries and tasks for good. Rooms you own pass to their longest-standing player, or close if there is none.')}</p><button class="button danger" data-action="delete-account">${icon('trash')} ${t('Delete account')}</button></div>
</div></section></main>`;
}
