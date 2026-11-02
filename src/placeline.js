// Where a character was last seen, on its row (placeButton): the map's name and how long ago.
// The dialog it opens is places.js, which loads with it (main.js).
import { t } from './i18n.js';
import { escape as esc, age } from './model.js';
import { icon } from './icons.js';

export const mapOf = (id, maps = []) => maps.find(m => m.id === id) || null;
export const mapName = (id, maps = []) => mapOf(id, maps)?.name || t('Map {id}', { id });

// The line on a character's row: the map and how long ago, as a button that opens the dialog.
export function placeButton(c, maps, now) {
  const p = c.location;
  if (!p?.map || !c.id) return '';
  return `<button class="place-line" type="button" data-location="${esc(c.id)}" data-name="${esc(c.characterName)}" title="${esc(t('Where {name} was last seen', { name: c.characterName }))}">${icon('pin')}<span class="place-map-name">${esc(mapName(p.map, maps))}</span><span class="place-age" data-age="${esc(p.at)}">${age(p.at, now)}</span></button>`;
}
