// Discord reminders under Room settings (#33): the room owner connects a channel webhook and
// chooses when runs are posted; the backend posts each run, edits the post after a change and
// marks it when the run is cancelled or done (backend/odyle/discord.go). The webhook URL never
// comes back from the server; its name in Discord and how the last delivery went do.
import { t } from './i18n.js';
import { age, escape as esc } from './model.js';
import { leadLabel } from './notify.js';

export const discordLeadChoices = [5, 10, 15, 30, 60, 120];
export const leadsOf = room => Array.isArray(room?.discordLeads) && room.discordLeads.length ? [...room.discordLeads].sort((a, b) => b - a) : [15];
const statusOf = room => room?.discordStatus && typeof room.discordStatus === 'object' ? room.discordStatus : {};

// When runs are posted, in words: "1 h and 15 min before it starts, and as it starts".
export function postTimes(room) {
  const leads = leadsOf(room).map(leadLabel);
  const before = leads.length > 1 ? t('{list} and {last}', { list: leads.slice(0, -1).join(', '), last: leads.at(-1) }) : leads[0];
  return room?.discordStartPost ? t('{before} before it starts, and as it starts', { before }) : t('{before} before it starts', { before });
}

// How the webhook last fared, for its owner: { tone: 'ok' | 'warn', text }, or null.
export function deliveryLine(room, now) {
  const s = statusOf(room);
  if (!room?.discordReminders) return s.dropped && s.droppedAt ? { tone: 'warn', text: t('Reminders stopped {age}: Discord no longer knew the webhook (deleted, or its channel is gone). Paste a new one to turn them on again.', { age: age(s.droppedAt, now) }) } : null;
  if (s.error && s.errorAt) return { tone: 'warn', text: t('The last post failed {age}: {error}', { age: age(s.errorAt, now), error: s.error }) };
  if (s.okAt) return { tone: 'ok', text: t('Last post delivered {age}.', { age: age(s.okAt, now) }) };
  return null;
}

export function discordSettings(room, now) {
  const on = Boolean(room.discordReminders), leads = leadsOf(room), line = deliveryLine(room, now);
  const posting = on && room.discordName ? ' ' + t('Posting as {name}, in {language}.', { name: room.discordName, language: room.discordLanguage === 'cs' ? t('Czech') : t('English') }) : '';
  const intro = on ? t('Reminders are on: each planned run is posted to your Discord channel {when}.', { when: postTimes(room) }) + posting
    : t('Post each planned run to a Discord channel before it starts, with a link back to the room; the post follows changes and shows when a run is cancelled. In Discord, open the channel settings → Integrations → Webhooks, create one and paste its URL here.');
  const status = line ? `<p class="discord-status ${line.tone}" role="status">${esc(line.text)}</p>` : '';
  const choices = discordLeadChoices.map(m => `<label class="chip-check"><input type="checkbox" name="lead" value="${m}" ${leads.includes(m) ? 'checked' : ''}><span>${esc(leadLabel(m))}</span></label>`).join('');
  const options = `<form id="discord-options-form" class="discord-options"><div class="lead-choices" role="group" aria-label="${esc(t('Reminder times'))}">${choices}</div><label class="check-row"><input type="checkbox" name="startPost" ${room.discordStartPost ? 'checked' : ''}> <span>${t('Also post when a run starts')}</span></label><small class="account-note">${t('Up to three times before each run. Going members who turned on Discord mentions in their notifications are pinged in the first post.')}</small>${on ? `<button class="button secondary small" type="submit">${t('Save times')}</button>` : ''}</form>`;
  const connect = `<form id="discord-form" class="rename-form"><label>${on ? t('Replace the webhook URL') : t('Webhook URL')}<input name="webhook" type="url" autocomplete="off" required placeholder="https://discord.com/api/webhooks/…"></label><button class="button secondary" type="submit">${on ? t('Replace') : t('Connect')}</button></form>`;
  return `<h3 class="modal-sub">${t('Discord reminders')}</h3><p>${esc(intro)}</p>${status}${options}${connect}${on ? `<button class="text-button" data-action="discord-off">${t('Stop Discord reminders')}</button>` : ''}`;
}

// The times chosen in the form: one to three leads, or an error to show.
export function chosenTimes(form) {
  const leads = [...form.querySelectorAll('input[name="lead"]:checked')].map(input => Number(input.value));
  if (!leads.length || leads.length > 3) return { error: t('Choose one to three reminder times.') };
  return { leads, startPost: Boolean(form.querySelector('input[name="startPost"]')?.checked) };
}
