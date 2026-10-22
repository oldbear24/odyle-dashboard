// Room features under Room settings: the parts of a room its owner turns on and off for every
// member. The backend keeps the choice on the room and answers every feature with whether it
// is on (backend/odyle/board.go); a room from a server without features has all of them on.
import { t } from './i18n.js';
import { escape as esc } from './model.js';

export const roomFeatures = () => [
  ['board', t('Information board'), t('A note from you and the officers at the top of the room. Turned off, its text is kept for later.')],
  ['runs', t('Planned runs'), t('Runs with a time that members join, with reminders and Discord posts. Turning them off cancels the runs planned now.')],
  ['wishlist', t('Dungeon wishlist'), t('The dungeons members still need to run. Turned off, its entries are kept for later.')],
  ['week', t('The party’s week'), t('What the shared characters spent since the weekly reset, under the room’s name.')],
];

export const featureOn = (room, feature) => room?.features?.[feature] !== false;

// One checkbox per feature, saved together.
export function featuresForm(room) {
  const rows = roomFeatures().map(([key, name, note]) => `<label class="check-row feature-row"><input type="checkbox" name="${key}" ${featureOn(room, key) ? 'checked' : ''}><span><strong>${esc(name)}</strong><small class="account-note">${esc(note)}</small></span></label>`).join('');
  return `<h3 class="modal-sub">${t('Room features')}</h3><p>${t('Choose what this room offers. What you turn off disappears for every member.')}</p><form id="features-form" class="feature-options">${rows}<button class="button secondary" type="submit">${t('Save features')}</button></form>`;
}

// What the form changes: { feature: on } for each feature that differs from the room's.
export function changedFeatures(form, room) {
  const out = {};
  for (const [key] of roomFeatures()) {
    const on = Boolean(form.querySelector(`input[name="${key}"]`)?.checked);
    if (on !== featureOn(room, key)) out[key] = on;
  }
  return out;
}
