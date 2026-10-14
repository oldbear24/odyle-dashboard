import { t, tn, languages, language } from './i18n.js';
import { escape as esc, age } from './model.js';
import { icon } from './icons.js';
// The account page (#/account): profile, language, the Windows apps reading for the
// account, and the account's data: download it, sign out everywhere or delete it.
export function accountView({ account, apps, characters, limits, now }) {
  const appRows = apps.map(a => {
    const late = now - Date.parse(String(a.lastContactAt).replace(' ', 'T'));
    return `<div class="wish-row"><div class="wish-name"><strong>${a.character ? esc(a.character) : t('No character in game')}</strong><small>${t('Windows app')} · ${t('connected')} <span data-age="${esc(a.connectedAt)}">${age(a.connectedAt, now)}</span></small></div><span class="status ${late < 45000 ? 'live' : late < 90000 ? 'stale' : 'offline'}"><i></i>${late < 45000 ? t('Online') : late < 90000 ? t('Late') : t('Offline')}</span><small class="account-note">${t('last contact')} <span data-age="${esc(a.lastContactAt)}">${age(a.lastContactAt, now)}</span></small></div>`;
  }).join('');
  return `<main class="dashboard account-page"><section class="heading"><div><div class="eyebrow"><span class="tiny-diamond"></span> ${t('YOUR ACCOUNT')}</div><h1>${t('Account & data')}<span class="mint">.</span></h1><p>${account.email ? esc(t('Signed in with Discord · {email}', { email: account.email })) : t('Signed in with Discord')}</p></div></section>
<div class="account-grid">
<form id="profile-form" class="setup-card"><h2>${t('Display name')}</h2><p>${t('Room members see this name next to your characters.')}</p><label>${t('Display name')}<input name="displayName" maxlength="40" autocomplete="nickname" required value="${esc(account.displayName)}"></label><button class="button primary" type="submit">${t('Save name')}</button></form>
<div class="setup-card"><h2>${t('Language')}</h2><p>${t('Used for the whole dashboard in this browser.')}</p><label>${t('Language')}<select id="language-select">${languages.map(l => `<option value="${l.code}" ${l.code === language() ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label></div>
</div>
<section class="party-section"><div class="section-heading"><h2>${t('Windows apps')} <span>${apps.length}</span></h2><button class="button secondary" data-action="desktop">${t('Pair Windows app')} ${icon('arrow')}</button></div><div class="wish-panel">${appRows ? `<div class="wish-list">${appRows}</div>` : `<p class="wish-empty">${t('No Windows app has read for this account in the last day.')}</p>`}<p class="wish-note account-foot">${t('Lost a PC or shared a connection link by mistake? Sign out everywhere: every browser and Windows app loses access and needs to sign in or pair again. This browser stays signed in.')} <button class="text-button" data-action="sign-out-everywhere">${t('Sign out everywhere')} ${icon('arrow')}</button></p></div></section>
<section class="party-section"><div class="section-heading"><h2>${t('Your data')}</h2><span class="refresh-label">${esc(tn(characters, '{n} character saved', '{n} characters saved'))} · ${esc(t('up to {limit}', { limit: limits.characters }))}</span></div><div class="account-grid">
<div class="setup-card"><h2>${t('Download my data')}</h2><p>${t('One JSON file with your account, characters and their Odyle history, rooms, wishlist entries, planned runs, tasks and Windows app sessions.')}</p><button class="button secondary" data-action="export">${icon('download')} ${t('Download my data')}</button></div>
<div class="setup-card danger-card"><h2>${t('Delete account')}</h2><p>${t('Deletes your account, characters, history, memberships, wishlist entries and tasks for good. Rooms you own pass to their longest-standing player, or close if there is none.')}</p><button class="button danger" data-action="delete-account">${icon('trash')} ${t('Delete account')}</button></div>
</div></section></main>`;
}
