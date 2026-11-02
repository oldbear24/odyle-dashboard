// Reader & privacy in the account menu (main.js): what Odyle does with characters, rooms, the
// checklist and the Windows app, how long it keeps a character's history (historyDays, as the
// server keeps it) and what the reader never does (scope, as the welcome page says it). It
// loads with the dialog.
import { t, tn } from './i18n.js';
import { escape as esc } from './model.js';
import { link } from './routes.js';

export function helpBody({ historyDays, scope }) {
  return [
    t('Sign in with Discord to create your account. Rooms and all character readings persist across sign-outs and room changes.'),
    t('Each character is shared per room: choose them under My rooms & characters → Room sharing, or inside the room: add one from the bar above the party and take it out with Remove from room on its card. Friends only see the characters you linked to that room. A viewer invite grants read-only room access.'),
    t('Each room keeps a dungeon wishlist and planned runs: add the dungeons you still need, join an entry with Need it too, plan a run with a time and join it with Going. The room owner can clear an entry for everyone.'),
    t('Daily & weekly is your own checklist: add the tasks you run every day or week and tick them off. They uncheck themselves at the daily and weekly reset of the Global service, so nothing is deleted and nothing needs re-adding.'),
    t('The Windows app is a free download from its GitHub releases; My rooms & characters links the newest version, and an installed app updates itself from new releases. It pairs once with a one-time link, stays paired until you disconnect it and reads game packets locally. Raw game traffic stays on your PC. Only normalized readings from a validated adapter may be shared.'),
    esc(tn(historyDays, 'The Windows app sends Odyle when it first reads it and whenever it changes; each change is kept for {n} day as the character’s history. A reading counts as live while the app reports the game connection; 45 seconds without that it turns stale and stays saved. Readings are decoded from the Global game stream by the reference adapter; manual entry is disabled.', 'The Windows app sends Odyle when it first reads it and whenever it changes; each change is kept for {n} days as the character’s history. A reading counts as live while the app reports the game connection; 45 seconds without that it turns stale and stays saved. Readings are decoded from the Global game stream by the reference adapter; manual entry is disabled.')),
    t('Account & data lets you download everything stored for you, sign out everywhere and delete your account.'),
    scope,
    `${t('What Odyle keeps and how long:')} <a href="${link('/privacy')}">${t('Privacy notice')}</a> · <a href="https://github.com/oldbear24/odyle-dashboard/issues" target="_blank" rel="noopener">${t('Report a problem or ask')}</a>`,
  ].map(p => `<p>${p}</p>`).join('');
}
