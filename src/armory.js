// The armory (#67): public AION 2 Global character profiles as PLAYNC's official character
// pages list them, kept by the backend and fetched from PLAYNC one at a time
// (backend/odyle/armory.go). Pages: #/armory (search), #/armory/find/<region>/<server>/<name>
// (a search, as character cards link it) and #/armory/<search region>/<server id>/<character
// id> (a profile). Nothing here is typed in or changed by players. Bookmarks (#72) are kept in
// the browser only, so they need no account.
import { t, tn, locale } from './i18n.js';
import { age, escape as esc } from './model.js';
import { icon } from './icons.js';

export const regionNames = () => ({ GLOBAL_NA: t('North America East'), GLOBAL_NAW: t('North America West'), GLOBAL_EU: t('Europe'), GLOBAL_SA: t('South America'), GLOBAL_ASIA: t('Asia') });
// PLAYNC's character ids are URL-safe Base64 with padding; search regions are its own codes.
export const armoryRoute = /^\/armory(?:\/find\/GLOBAL_(?:NAW?|EU|SA|ASIA)\/[A-Za-z]{2,20}\/[^/]{1,60}|\/(?:nae|naw|eu|la|as)\/[12]\d{3}\/[A-Za-z0-9_-]{8,90}={0,2})?$/;
export const profilePath = hit => `/armory/${hit.region}/${hit.serverId}/${hit.characterId}`;
// A character's own profile, once the daily lookup found it on PLAYNC (officialId), else "".
export const officialPath = c => {
  const path = c?.officialId && c.officialRegion && c.officialServerId ? profilePath({ region: c.officialRegion, serverId: c.officialServerId, characterId: c.officialId }) : '';
  return path && armoryRoute.test(path) ? path : '';
};
export const findPath = (region, server, name) => `/armory/find/${region}/${server}/${encodeURIComponent(name)}`;
// What a path asks for: { search } (the form), { find: { region, server, name } } or { profile: { region, serverId, characterId } }.
export function armoryTarget(path) {
  const parts = path.split('/').slice(2);
  if (parts[0] === 'find') { try { return { find: { region: parts[1], server: parts[2], name: decodeURIComponent(parts[3]) } }; } catch { return { search: true }; } }
  if (parts.length === 3) return { profile: { region: parts[0], serverId: parts[1], characterId: parts[2] } };
  return { search: true };
}

const number = value => Number(value || 0).toLocaleString(locale());

// Bookmarks: characters this browser keeps in a list, newest first, each with the numbers of
// its profile as last opened here. main.js keeps them in localStorage (odyle.armory.bookmarks).
export const bookmarkLimit = 50;
export const bookmarkKey = c => `${c.region}/${c.serverId}/${c.characterId}`;
// Saved bookmarks as far as they still make sense; anything else in storage is left out.
export function readBookmarks(raw) {
  let list;
  try { list = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.filter(b => b && typeof b === 'object' && typeof b.name === 'string' && b.name && armoryRoute.test(profilePath(b)) && !seen.has(bookmarkKey(b)) && seen.add(bookmarkKey(b))).slice(0, bookmarkLimit);
}
export const isBookmarked = (list, character) => list.some(b => bookmarkKey(b) === bookmarkKey(character));
// A profile answer as a bookmark row.
export function bookmarkOf(answer, savedAt) {
  const p = answer.profile;
  return { region: answer.region, serverId: Number(answer.serverId), characterId: answer.characterId, name: p.name, server: p.server || answer.server, class: p.class, level: p.level, combatPower: p.combatPower, itemLevel: p.itemLevel, fetchedAt: answer.fetchedAt, savedAt };
}
export const addBookmark = (list, answer, savedAt) => isBookmarked(list, answer) ? list : [bookmarkOf(answer, savedAt), ...list];
export const removeBookmark = (list, key) => list.filter(b => bookmarkKey(b) !== key);
// An opened profile brings its row up to date, in its place in the list.
export const refreshBookmark = (list, answer) => answer.profile ? list.map(b => bookmarkKey(b) === bookmarkKey(answer) ? bookmarkOf(answer, b.savedAt) : b) : list;
function bookmarkList(bookmarks, now) {
  if (!bookmarks.length) return '';
  const row = b => `<li><a href="#${esc(profilePath(b))}"><strong>${esc(b.name)}</strong><span>${esc([t('Level {level}', { level: b.level }), b.class, b.server].filter(Boolean).join(' · '))}</span><span class="armory-mark-power">${esc(number(b.combatPower))} CP · ${esc(t('item level {n}', { n: number(b.itemLevel) }))}<small>${esc(t('as of {age}', { age: age(b.fetchedAt, now) }))}</small></span>${icon('arrow')}</a><button class="close-button" data-armory-unmark="${esc(bookmarkKey(b))}" aria-label="${esc(t('Remove {name} from bookmarks', { name: b.name }))}" title="${esc(t('Remove {name} from bookmarks', { name: b.name }))}">×</button></li>`;
  return `<section class="armory-bookmarks"><div class="section-heading"><h2>${t('Bookmarked characters')} <span>${bookmarks.length}</span></h2></div><ul class="armory-results armory-marked">${bookmarks.map(row).join('')}</ul></section>`;
}
const slotNames = () => ({ MainHand: t('Main hand'), SubHand: t('Off hand'), Helmet: t('Helmet'), Shoulder: t('Shoulders'), Torso: t('Torso'), Pants: t('Pants'), Gloves: t('Gloves'), Boots: t('Boots'),
  Cape: t('Cape'), Belt: t('Belt'), Necklace: t('Necklace'), Amulet: t('Amulet'), Earring: t('Earring'), Ring: t('Ring'), Bracelet: t('Bracelet'), Rune: t('Rune'), Arcana: t('Arcana'), Wings: t('Wings'), Pet: t('Pet') });
// "Earring2" → "Earring", "Arcana3" → "Arcana 3"; unknown slots keep PLAYNC's name.
export function slotLabel(slot) {
  const [, base, index] = String(slot).match(/^(.*?)(\d*)$/), name = slotNames()[base] || base;
  return base === 'Arcana' && index ? `${name} ${index}` : name;
}
const grades = ['common', 'rare', 'legend', 'unique', 'epic', 'mythic', 'special'];
export const gradeClass = grade => grades.includes(String(grade).toLowerCase()) ? 'grade-' + String(grade).toLowerCase() : 'grade-common';
const gradeNames = () => ({ Common: t('Common'), Rare: t('Rare'), Legend: t('Legend'), Unique: t('Unique'), Epic: t('Epic'), Mythic: t('Mythic'), Special: t('Special') });

// The search form, with the region and server last searched.
export function armorySearch(regions, chosen, results = null, searching = false, bookmarks = [], now = Date.now()) {
  const region = regions.find(r => r.region === chosen.region) || regions.find(r => r.region === 'GLOBAL_EU') || regions[0];
  const names = regionNames(), group = (label, list) => `<optgroup label="${esc(label)}">${list.map(s => `<option ${s === chosen.server ? 'selected' : ''}>${esc(s)}</option>`).join('')}</optgroup>`;
  const list = results === null ? '' : results.length ? `<ul class="armory-results">${results.map(hit => `<li><a href="#${esc(profilePath(hit))}"><strong>${esc(hit.name)}${isBookmarked(bookmarks, hit) ? ` <span class="armory-star" title="${esc(t('Bookmarked'))}">★</span>` : ''}</strong><span>${esc(t('Level {level}', { level: hit.level }))} · ${hit.race === 1 ? t('Elyos') : hit.race === 2 ? t('Asmodians') : ''} · ${esc(hit.server)}</span>${icon('arrow')}</a></li>`).join('')}</ul>`
    : `<p class="armory-empty">${t('PLAYNC lists no character of that name on this server.')}</p>`;
  return `<main class="dashboard armory"><div class="heading"><div><h1>${t('Look up a character')}</h1><p>${t('Gear, combat power, item level and stats of any AION 2 Global character, as PLAYNC\'s official character pages list them. No sign-in needed.')}</p></div></div>
${bookmarkList(bookmarks, now)}<form id="armory-form" class="armory-form"><label>${t('Region')}<select name="region">${regions.map(r => `<option value="${esc(r.region)}" ${r === region ? 'selected' : ''}>${esc(names[r.region] || r.region)}</option>`).join('')}</select></label>
<label>${t('Server')}<select name="server">${group(t('Elyos'), region.elyos)}${group(t('Asmodians'), region.asmodian)}</select></label>
<label>${t('Character name')}<input name="name" required minlength="2" maxlength="16" pattern="[\\p{L}\\p{N}]{2,16}" autocomplete="off" value="${esc(chosen.name || '')}"></label><button class="button primary" type="submit" ${searching ? 'disabled' : ''}>${searching ? t('Searching…') : t('Search')}</button></form>
${list}<p class="armory-note">${icon('info')}<span>${t('Profiles come from PLAYNC. Odyle keeps a copy for everyone, refreshed at most every 6 hours, and asks PLAYNC for one character at a time, so a new profile can take a while.')}${bookmarks.length ? ' ' + t('Bookmarks are kept in this browser only, with the numbers from when each profile was last opened here.') : ' ' + t('Bookmark characters on their profile to list them here, without an account.')}</span></p></main>`;
}

// Where the profile's lookup stands, in words.
export function lookupLine(answer, now) {
  const kept = answer.profile && answer.fetchedAt;
  switch (answer.state) {
    case 'queued': return answer.position ? tn(answer.position, 'Fetching from PLAYNC · about {s} s, {n} character ahead', 'Fetching from PLAYNC · about {s} s, {n} characters ahead', { s: answer.wait }) : t('Fetching from PLAYNC · about {s} s', { s: answer.wait });
    case 'fetching': return t('Fetching from PLAYNC now…');
    case 'failed': return t('PLAYNC did not answer ({error}). Odyle tries again in {n} min.', { error: t(answer.lookupError || 'Request could not be completed.'), n: Math.max(1, Math.ceil(answer.retryAfter / 60)) });
    case 'busy': return t('Many lookups are waiting. Odyle asks again in a moment.');
    case 'paused': return kept ? t('The armory is paused; this is the kept copy.') : t('The armory is paused for now. Try again later.');
    default: return kept ? t('Data from PLAYNC {age}', { age: age(answer.fetchedAt, now) }) : '';
  }
}
export const waiting = answer => ['queued', 'fetching', 'busy'].includes(answer.state);

// A profile page: the kept profile (or the wait for it) and where its lookup stands.
export function armoryProfile(answer, now, refreshable, bookmarked = false) {
  const p = answer.profile, line = lookupLine(answer, now), busy = waiting(answer);
  const status = `<div class="armory-status ${busy ? 'is-waiting' : answer.state === 'failed' ? 'is-failed' : ''}" role="status">${busy ? '<span class="armory-spinner" aria-hidden="true"></span>' : icon('info')}<span>${esc(line)}</span>${refreshable ? `<button class="button secondary" data-action="armory-refresh">${t('Refresh')}</button>` : ''}</div>`;
  const back = `<a class="text-button armory-back" href="#/armory">${icon('arrow')} ${t('Search another character')}</a>`;
  if (!p) return `<main class="dashboard armory"><div class="heading"><div><h1>${esc(t('A character on {server}', { server: answer.server }))}</h1><p>${t('This character is not in the armory yet. Odyle fetches it from PLAYNC, one character at a time; this page fills in by itself.')}</p></div></div>${status}${back}</main>`;
  const primary = p.stats.filter(s => s.primary), deity = p.stats.filter(s => !s.primary), names = gradeNames();
  const stat = s => `<div class="armory-stat"><span>${esc(s.name)}${s.deity ? `<small>${esc(s.deity)}</small>` : ''}</span><strong>${number(s.value)}</strong></div>`;
  const gear = p.gear.map(g => `<li class="armory-item ${gradeClass(g.grade)}"><span class="armory-slot">${esc(slotLabel(g.slot))}</span><strong>${esc(g.name)}</strong><span class="armory-grade">${esc([names[g.grade] || g.grade, g.enchant && '+' + g.enchant, g.exceed && t('exceed {n}', { n: g.exceed }), g.level && t('Level {level}', { level: g.level })].filter(Boolean).join(' · '))}</span></li>`).join('');
  const boards = p.boards.map(b => `<div class="armory-board"><span>${esc(b.name)}</span><span class="armory-track"><i style="width:${b.total ? Math.min(100, b.open / b.total * 100) : 0}%"></i></span><small>${number(b.open)} / ${number(b.total)}</small></div>`).join('');
  return `<main class="dashboard armory"><div class="heading"><div><h1>${esc(p.name)}</h1><p>${esc([t('Level {level}', { level: p.level }), p.class, p.race, p.server].filter(Boolean).join(' · '))}${p.title ? ` · <span class="armory-title ${gradeClass(p.titleGrade)}">${esc(p.title)}</span>` : ''}</p></div><div class="heading-actions"><button class="button secondary armory-bookmark" data-action="armory-bookmark" aria-pressed="${bookmarked}" title="${esc(bookmarked ? t('Remove {name} from bookmarks', { name: p.name }) : t('Bookmark {name} in this browser', { name: p.name }))}">${bookmarked ? '★ ' + t('Bookmarked') : '☆ ' + t('Bookmark')}</button></div></div>${status}
<section class="metric-panel armory-power"><div class="party-metrics"><div class="metric is-main"><span class="metric-label">${t('Combat power')}</span><strong>${number(p.combatPower)}</strong><small>CP</small></div><div class="metric"><span class="metric-label">${t('GP · item level')}</span><strong>${number(p.itemLevel)}</strong><small>${t('of the equipped gear')}</small></div></div></section>
<section class="armory-section"><div class="section-heading"><h2>${t('Gear')}</h2></div>${gear ? `<ul class="armory-gear">${gear}</ul>` : `<p class="armory-empty">${t('PLAYNC lists no equipped items.')}</p>`}</section>
<div class="armory-columns"><section class="armory-section"><div class="section-heading"><h2>${t('Stats')}</h2></div><div class="armory-stats">${primary.map(stat).join('')}</div>${deity.length ? `<h3>${t('Deity stats')}</h3><div class="armory-stats">${deity.map(stat).join('')}</div>` : ''}</section>
${boards ? `<section class="armory-section"><div class="section-heading"><h2>${t('Daevanion')}</h2></div>${boards}</section>` : ''}</div>${back}</main>`;
}
