// What the rest of the dashboard needs of the armory without loading it (armory.js loads with
// its first page, main.js): its paths, which page a path asks for, the title of its search and
// profiles, and the class emblems character rows show.
import { t } from './i18n.js';
import { escape as esc } from './model.js';

// A profile's tabs after its first one (gear and stats), as their paths name them.
export const armoryTabs = ['skills', 'daevanion', 'titles', 'appearance'];
// PLAYNC's character ids are URL-safe Base64 with padding; search regions are its own codes.
export const armoryRoute = /^\/armory(?:\/find\/GLOBAL_(?:NAW?|EU|SA|ASIA)\/[A-Za-z]{2,20}\/[^/]{1,60}|\/(?:nae|naw|eu|la|as)\/[12]\d{3}\/[A-Za-z0-9_-]{8,90}={0,2}(?:\/(?:skills|daevanion|titles|appearance|card))?)?$/;
export const profilePath = (hit, tab = '') => `/armory/${hit.region}/${hit.serverId}/${hit.characterId}${armoryTabs.includes(tab) ? '/' + tab : ''}`;
// A character's own profile, once the daily lookup found it on PLAYNC (officialId), else "".
export const officialPath = c => {
  const path = c?.officialId && c.officialRegion && c.officialServerId ? profilePath({ region: c.officialRegion, serverId: c.officialServerId, characterId: c.officialId }) : '';
  return path && armoryRoute.test(path) ? path : '';
};
export const findPath = (region, server, name) => `/armory/find/${region}/${server}/${encodeURIComponent(name)}`;
// What a path asks for: { search } (the form), { find: { region, server, name } }, { profile: { region, serverId, characterId, tab } }
// or { card: { region, serverId, characterId } }.
export function armoryTarget(path) {
  const parts = path.split('/').slice(2);
  if (parts[0] === 'find') { try { return { find: { region: parts[1], server: parts[2], name: decodeURIComponent(parts[3]) } }; } catch { return { search: true }; } }
  if (parts.length === 4 && parts[3] === 'card') return { card: { region: parts[0], serverId: parts[1], characterId: parts[2] } };
  if (parts.length === 3 || parts.length === 4 && armoryTabs.includes(parts[3])) return { profile: { region: parts[0], serverId: parts[1], characterId: parts[2], tab: parts[3] || '' } };
  return { search: true };
}

// Images the backend keeps, by file name; base is where it serves them.
const imageName = /^[A-Za-z0-9_-]{1,100}\.(?:png|jpg|webp)$/;
export const imageUrl = (base, name) => typeof name === 'string' && imageName.test(name) ? base + name : '';

// A class's emblem from PLAYNC's character pages, as the backend keeps it (classes.go), before
// the class's name; nothing for a class without one.
export const classBadge = (base, file, name = '') => { const src = imageUrl(base, file); return src ? `<img class="class-icon" src="${esc(src)}" alt="" title="${esc(name)}" loading="lazy" decoding="async" draggable="false">` : ''; };

// The page's title in the tab, as the backend names it (backend/odyle/pages.go): the search,
// a profile (by its tab) or a profile not fetched yet.
export function armoryTitle(answer, tab = '') {
  const p = answer?.profile;
  if (!answer) return t('AION 2 armory: look up any Global character · Odyle');
  if (!p) return t('A character on {server} · Odyle Armory', { server: answer.server });
  const of = { name: p.name, level: p.level, class: p.class, server: p.server || answer.server };
  return { skills: t("{name}'s skills · {server} · Odyle Armory", of), daevanion: t("{name}'s Daevanion boards · {server} · Odyle Armory", of), titles: t("{name}'s titles · {server} · Odyle Armory", of), appearance: t("{name}'s appearance · {server} · Odyle Armory", of) }[tab]
    || t('{name} · Level {level} {class} on {server} · Odyle Armory', of);
}
