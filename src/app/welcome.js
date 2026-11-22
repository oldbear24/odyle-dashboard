// The welcome page; an invite link (code) adds its card, filled in from the public preview.
import { t } from '../i18n.js';
import { escape as esc } from '../model.js';
import { icon } from '../icons.js';
import { link } from '../routes.js';
import { joinCode, inviteLanding } from '../invites.js';
import { state, leaveRoomTopic, clearRoom } from './state.js';
import { pb, send } from './server.js';
import { shell, embedded, scopeNote } from './shell.js';
import { currentPath } from './router.js';

export function welcome(code = '') {
  shell(`<main class="welcome"><div class="eyebrow"><span class="tiny-diamond"></span> ${t('BUILT FOR YOUR NEXT RUN')}</div><h1>${t('Good runs start<br>with a ready party<span class="mint">.</span>')}</h1><p class="intro">${t('Sign in with Discord. Save the Odyle of every character.<br class="desktop-only"> Create a private room and bring your friends together.')}</p>${code ? inviteLanding(previewed(code)) : ''}${embedded() ? `<p class="join-note in-app-note">${icon('alert')}<span>${t('This page is open in a browser built into another app, where Discord sign-in often fails.')}</span><button class="text-button" data-action="open-elsewhere">${t('Open in your browser')} ${icon('arrow')}</button></p>` : ''}<div class="discord-card"><div class="setup-icon">${icon('people')}</div><h2>${t('One account. Every adventure.')}</h2><p>${t('Your rooms and character readings stay with your Discord account, even after you close the app.')}</p><button class="button discord-button" data-action="discord">${t('Continue with Discord')} ${icon('arrow')}</button><small>${t('First sign-in creates your account. No separate password.')}</small><p class="signin-help" hidden>${t('Continue in the Discord window that opened. Nothing happened?')} <button class="text-button" data-action="open-elsewhere">${t('Open in your browser')}</button></p></div><button class="text-button" data-action="demo">${t('Explore the demo workspace')} ${icon('arrow')}</button><button class="text-button" data-action="armory">${t('Look up a character in the armory')} ${icon('arrow')}</button><button class="text-button" data-action="timers">${t('AION 2 timers: resets and Odyle ticks')} ${icon('arrow')}</button><button class="text-button" data-action="achievements">${t('Achievements to collect')} ${icon('arrow')}</button><p class="welcome-note">${t('No game account needed. No public directory. Just your party.')} <a href="${link('/privacy')}">${t('Privacy')}</a></p>${scopeNote()}</main>`);
  if (code && !previewed(code)) previewInvite(code);
}
// What the invite link on screen opens (invites.js inviteLanding), asked once per code:
// the public preview takes the code in the body, so it never lands in a server log.
let preview = { code: '', answer: null };
const previewed = code => preview.code === code ? preview.answer : null;
async function previewInvite(code, again = false) {
  if (!again && previewed(code)) return preview.answer;
  try { preview = { code, answer: await send('invite-preview', { code }) }; } catch { return null; /* the general note stays */ }
  const slot = document.querySelector('.invite-landing');
  if (slot && joinCode(currentPath()) === code) slot.outerHTML = inviteLanding(preview.answer, pb.authStore.isValid);
  return preview.answer;
}
// An invite link that did not join stays on screen: what it opens and why it failed, or
// that it expired or does not work, instead of an empty library.
export async function inviteTrouble(code, error, ticket) {
  await leaveRoomTopic(); clearRoom();
  const answer = await previewInvite(code, true); if (ticket !== state.navigation) return;
  const why = !answer || answer.state === 'valid' ? `<p class="invite-problem" role="alert">${esc(t(error?.message || 'Request could not be completed.'))}</p>` : '';
  shell(`<main class="welcome invite-page"><div class="eyebrow"><span class="tiny-diamond"></span> ${t('ROOM INVITE')}</div><h1>${t('This invite did not work')}<span class="mint">.</span></h1>${inviteLanding(answer, true)}${why}<div class="invite-page-actions"><button class="button primary" data-action="library">${t('My rooms & characters')} ${icon('arrow')}</button></div></main>`, 'library');
}
