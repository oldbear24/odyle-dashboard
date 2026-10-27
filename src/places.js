import { t, tn, locale } from './i18n.js';
import { escape as esc, age, timestamp } from './model.js';
import { icon } from './icons.js';

// Location sharing (opt-in): where a character was last seen, as the game said it to the
// Windows app at a loading screen, on arrival, while flying or with some skills; the game says
// nothing while a character simply walks, so a place is the last known one and always shows its age. The game names
// maps by id only: superusers name them and link each to a map of TH.GL's AION 2 site, which
// the dialog embeds. Map art never comes from Odyle itself.

const sourceNames = { load: 'loading screen', arrival: 'arrived', flight: 'in flight', effect: 'skill or effect' };
export const sourceName = source => sourceNames[source] ? t(sourceNames[source]) : '';
export const mapOf = (id, maps = []) => maps.find(m => m.id === id) || null;
export const mapName = (id, maps = []) => mapOf(id, maps)?.name || t('Map {id}', { id });

// TH.GL's embed centred on a place. Its coordinates are the game's with the axes swapped
// (keys y:x), so the centre is y,x. Only teleport statues are shown as landmarks: every other
// marker of the site would hide the pin.
export function embedUrl(thgl, place, zoom = 3) {
  return `https://aion2.th.gl/embed/maps/${encodeURIComponent(thgl)}?center=${Math.round(place.y)},${Math.round(place.x)}&zoom=${zoom}&types=kibelisk,dungeon_kibelisk`;
}
// The full map on TH.GL's site, linked under the embed as TH.GL's embed terms ask.
export const mapPage = thgl => `https://aion2.th.gl/maps/${encodeURIComponent(thgl)}`;

// The line on a character's row: the map and how long ago, as a button that opens the dialog.
export function placeButton(c, maps, now) {
  const p = c.location;
  if (!p?.map || !c.id) return '';
  return `<button class="place-line" type="button" data-location="${esc(c.id)}" data-name="${esc(c.characterName)}" title="${esc(t('Where {name} was last seen', { name: c.characterName }))}">${icon('pin')}<span class="place-map-name">${esc(mapName(p.map, maps))}</span><span class="place-age" data-age="${esc(p.at)}">${age(p.at, now)}</span></button>`;
}

const when = at => new Date(timestamp(at)).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// The places of the dialog: the latest first (it may be newer than the history, which keeps a
// flight's places a minute apart), then the history.
export function placesOf(data) {
  const list = [...(data.locations || [])];
  if (data.location?.map && (!list.length || timestamp(data.location.at) > timestamp(list[0].at))) list.unshift(data.location);
  return list;
}

// The map of the picked place with a pin at its centre, or why there is none.
export function placeMap(place, maps, name) {
  const linked = mapOf(place.map, maps)?.thgl;
  if (!linked) return `<p class="place-nomap">${esc(t('{map} has no map linked yet. A superuser links it under Game settings.', { map: mapName(place.map, maps) }))}</p>`;
  return `<div class="place-frame"><iframe src="${esc(embedUrl(linked, place))}" title="${esc(t('Map of {map} by TH.GL', { map: mapName(place.map, maps) }))}" loading="lazy" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe><span class="place-pin" aria-hidden="true"></span><button class="button secondary small place-back" type="button" data-place-back hidden>${icon('pin')} ${esc(t('Back to {name}', { name }))}</button></div><p class="place-credit">${t('Map: TH.GL’s AION 2 map, centred on the place. Moving the map hides the pin.')} <a href="${esc(mapPage(linked))}" target="_blank" rel="noopener noreferrer">${t('Open on TH.GL')} ↗</a></p>`;
}

const placeRow = (p, i, picked, maps) => `<tr${i === picked ? ' class="is-picked"' : ''}><td>${esc(when(p.at))}</td><td>${esc(mapName(p.map, maps))}</td><td>${esc(sourceName(p.source))}</td><td>${i === picked ? `<span class="place-shown">${t('Shown')}</span>` : `<button class="text-button" type="button" data-place="${i}">${t('Show')}</button>`}</td></tr>`;

// The dialog's body: the picked place (the latest by default) on the map, and the 30 days.
export function locationBody({ data, maps, name, own = false, now, picked = 0, all = false }) {
  if (!data.shared) return `<p class="place-off">${own ? t('Location sharing is off for your account. Turn it on under Account & data to let your rooms see where your characters were last seen.') : esc(t('The player of {name} does not share their location.', { name }))}</p>`;
  const places = placesOf(data);
  if (!places.length) return `<p class="place-off">${t('No place in the last 30 days yet. The Windows app sends one at each loading screen, while gliding or flying and with some skills.')}</p>`;
  const p = places[Math.min(picked, places.length - 1)], limit = all ? Infinity : 12;
  const rows = places.slice(0, limit).map((place, i) => placeRow(place, i, picked, maps)).join('');
  const more = places.length - Math.min(places.length, limit);
  return `<p class="place-now"><strong>${esc(mapName(p.map, maps))}</strong> · ${esc(sourceName(p.source))} · <span data-age="${esc(p.at)}">${age(p.at, now)}</span></p>
<p class="place-note">${t('The game reports a place at each loading screen, while gliding or flying and with some skills, not while simply walking: this is where the character was then.')}</p>
<div class="place-map">${placeMap(p, maps, name)}</div>
<table class="history-table place-table"><thead><tr><th>${t('Seen')}</th><th>${t('Map')}</th><th>${t('How')}</th><th></th></tr></thead><tbody>${rows}</tbody></table>${more > 0 ? `<p class="history-more">${esc(tn(more, '{n} earlier place in the last 30 days', '{n} earlier places in the last 30 days'))} <button class="text-button" type="button" data-place-all>${t('Show all')}</button></p>` : ''}`;
}

// The account page's switch (Account & data).
export function locationCard(on = false) {
  return `<form id="location-form" class="setup-card"><h2>${t('Location sharing')}</h2><p>${t('Lets your rooms see where your characters were last seen: the map and the spot, with how long ago. The Windows app reads it from the game at each loading screen, while you glide or fly and with some skills; a plain walk sends nothing.')}</p>
<label class="check-row"><input type="checkbox" name="shareLocation" ${on ? 'checked' : ''}> <span>${t('Share my location with my rooms')}</span></label><small class="account-note">${t('Off by default. Places are kept for 30 days, and turning this off deletes them at once.')}</small><button class="button primary" type="submit">${t('Save location sharing')}</button></form>`;
}
