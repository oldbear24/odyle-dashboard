// The armory (#67): public AION 2 Global character profiles as PLAYNC's official character
// pages list them, kept by the backend and fetched from PLAYNC one at a time
// (backend/odyle/armory.go). Pages: #/armory (search), #/armory/find/<region>/<server>/<name>
// (a search, as character cards link it), #/armory/<search region>/<server id>/<character
// id>[/<tab>] (a profile: gear and stats, or its skills, daevanion, titles or appearance tab)
// and the profile's player card, /card, a page of its own (card.js).
// Nothing here is typed in or changed by players. Bookmarks (#72) are kept in the browser
// only, so they need no account. Images (the game's icons, the character's portrait) come
// from the Odyle server only (backend/odyle/armoryimages.go).
import { t, tn, locale } from './i18n.js';
import { age, escape as esc } from './model.js';
import { icon } from './icons.js';
import { link } from './routes.js';

export const regionNames = () => ({ GLOBAL_NA: t('North America East'), GLOBAL_NAW: t('North America West'), GLOBAL_EU: t('Europe'), GLOBAL_SA: t('South America'), GLOBAL_ASIA: t('Asia') });
// PLAYNC's search regions and the regions Odyle names them by.
const searchRegions = { nae: 'GLOBAL_NA', naw: 'GLOBAL_NAW', eu: 'GLOBAL_EU', la: 'GLOBAL_SA', as: 'GLOBAL_ASIA' };
const regionLabel = region => regionNames()[searchRegions[region]] || '';
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
// The character's page on PLAYNC's own site.
export const playncPage = answer => `https://aion2.plaync.com/en-us/characters/${encodeURIComponent(answer.serverId)}/${encodeURIComponent(answer.characterId)}?region=${encodeURIComponent(answer.region)}`;

const number = value => Number(value || 0).toLocaleString(locale());
const percent = (part, whole) => whole ? Math.min(100, Math.round(part / whole * 100)) : 0;

// Images the backend keeps, by file name; base is where it serves them.
const imageName = /^[A-Za-z0-9_-]{1,100}\.(?:png|jpg|webp)$/;
export const imageUrl = (base, name) => typeof name === 'string' && imageName.test(name) ? base + name : '';
const picture = (base, name, kind = '') => { const src = imageUrl(base, name); return src ? `<img class="armory-img ${kind}" src="${esc(src)}" alt="" loading="lazy" decoding="async" draggable="false">` : ''; };
const initials = name => [...String(name || '?')].slice(0, 2).join('').toUpperCase();
// A class's emblem from PLAYNC's character pages, as the backend keeps it (classes.go), before
// the class's name; nothing for a class without one.
export const classBadge = (base, file, name = '') => { const src = imageUrl(base, file); return src ? `<img class="class-icon" src="${esc(src)}" alt="" title="${esc(name)}" loading="lazy" decoding="async" draggable="false">` : ''; };

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
  return { region: answer.region, serverId: Number(answer.serverId), characterId: answer.characterId, name: p.name, server: p.server || answer.server, class: p.class, classIcon: answer.classIcon || '', level: p.level, combatPower: p.combatPower, itemLevel: p.itemLevel, portrait: p.portrait || '', fetchedAt: answer.fetchedAt, savedAt };
}
export const addBookmark = (list, answer, savedAt) => isBookmarked(list, answer) ? list : [bookmarkOf(answer, savedAt), ...list];
export const removeBookmark = (list, key) => list.filter(b => bookmarkKey(b) !== key);
// An opened profile brings its row up to date, in its place in the list.
export const refreshBookmark = (list, answer) => answer.profile ? list.map(b => bookmarkKey(b) === bookmarkKey(answer) ? bookmarkOf(answer, b.savedAt) : b) : list;
function bookmarkList(bookmarks, now, images) {
  if (!bookmarks.length) return '';
  const row = b => `<li><a href="${esc(link(profilePath(b)))}"><span class="armory-mini" aria-hidden="true">${esc(initials(b.name))}${picture(images, b.portrait)}</span><strong>${esc(b.name)}</strong><span>${classBadge(images, b.classIcon, b.class)}${esc([t('Level {level}', { level: b.level }), b.class, b.server].filter(Boolean).join(' · '))}</span><span class="armory-mark-power">${esc(number(b.combatPower))} CP · ${esc(t('item level {n}', { n: number(b.itemLevel) }))}<small>${esc(t('as of {age}', { age: age(b.fetchedAt, now) }))}</small></span>${icon('arrow')}</a><button class="close-button" data-armory-unmark="${esc(bookmarkKey(b))}" aria-label="${esc(t('Remove {name} from bookmarks', { name: b.name }))}" title="${esc(t('Remove {name} from bookmarks', { name: b.name }))}">×</button></li>`;
  return `<section class="armory-bookmarks"><div class="section-heading"><h2>${t('Bookmarked characters')} <span>${bookmarks.length}</span></h2></div><ul class="armory-results armory-marked">${bookmarks.map(row).join('')}</ul></section>`;
}
const slotNames = () => ({ MainHand: t('Main hand'), SubHand: t('Off hand'), Helmet: t('Helmet'), Shoulder: t('Shoulders'), Torso: t('Torso'), Pants: t('Pants'), Gloves: t('Gloves'), Boots: t('Boots'),
  Cape: t('Cape'), Belt: t('Belt'), Necklace: t('Necklace'), Amulet: t('Amulet'), Earring: t('Earring'), Ring: t('Ring'), Bracelet: t('Bracelet'), Rune: t('Rune'), Arcana: t('Arcana'), Wings: t('Wings'), Pet: t('Pet') });
// "Earring2" → "Earring", "Arcana3" → "Arcana 3"; skins' "EarringL" → "Earring" and "MaceMain"
// → "Main hand". Unknown slots keep PLAYNC's name.
export function slotLabel(slot) {
  const [, base, index] = String(slot).match(/^(.*?)(\d*)$/), names = slotNames();
  const name = names[base] || names[base.replace(/[LR]$/, '')] || (/.Main$/.test(base) ? names.MainHand : /.Sub$/.test(base) ? names.SubHand : base);
  return base === 'Arcana' && index ? `${name} ${index}` : name;
}
const grades = ['common', 'rare', 'legend', 'unique', 'epic', 'mythic', 'special'];
export const gradeClass = grade => grades.includes(String(grade).toLowerCase()) ? 'grade-' + String(grade).toLowerCase() : 'grade-common';
const gradeNames = () => ({ Common: t('Common'), Rare: t('Rare'), Legend: t('Legend'), Unique: t('Unique'), Epic: t('Epic'), Mythic: t('Mythic'), Special: t('Special') });
const gradeName = grade => gradeNames()[grade] || grade || '';

// The search form, with the region and server last searched.
export function armorySearch(regions, chosen, results = null, searching = false, bookmarks = [], now = Date.now(), images = '') {
  const region = regions.find(r => r.region === chosen.region) || regions.find(r => r.region === 'GLOBAL_EU') || regions[0];
  const names = regionNames(), group = (label, list) => `<optgroup label="${esc(label)}">${list.map(s => `<option ${s === chosen.server ? 'selected' : ''}>${esc(s)}</option>`).join('')}</optgroup>`;
  const list = results === null ? '' : results.length ? `<ul class="armory-results">${results.map(hit => `<li><a href="${esc(link(profilePath(hit)))}"><strong>${esc(hit.name)}${isBookmarked(bookmarks, hit) ? ` <span class="armory-star" title="${esc(t('Bookmarked'))}">★</span>` : ''}</strong><span>${esc(t('Level {level}', { level: hit.level }))} · ${hit.class ? `${classBadge(images, hit.classIcon, hit.class)}${esc(hit.class)} · ` : ''}${hit.race === 1 ? t('Elyos') : hit.race === 2 ? t('Asmodians') : ''} · ${esc(hit.server)}</span>${icon('arrow')}</a></li>`).join('')}</ul>`
    : `<p class="armory-empty">${t('PLAYNC lists no character of that name on this server.')}</p>`;
  return `<main class="dashboard armory"><div class="heading"><div><h1>${t('Look up a character')}</h1><p>${t('Everything PLAYNC\'s official character pages show of any AION 2 Global character: gear with each item\'s stats and stones, combat power, stats, skills, Daevanion boards, titles and skins. No sign-in needed.')}</p></div></div>
${bookmarkList(bookmarks, now, images)}<form id="armory-form" class="armory-form"><label>${t('Region')}<select name="region">${regions.map(r => `<option value="${esc(r.region)}" ${r === region ? 'selected' : ''}>${esc(names[r.region] || r.region)}</option>`).join('')}</select></label>
<label>${t('Server')}<select name="server">${group(t('Elyos'), region.elyos)}${group(t('Asmodians'), region.asmodian)}</select></label>
<label>${t('Character name')}<input name="name" required minlength="2" maxlength="16" pattern="[\\p{L}\\p{N}]{2,16}" autocomplete="off" value="${esc(chosen.name || '')}"></label><button class="button primary" type="submit" ${searching ? 'disabled' : ''}>${searching ? t('Searching…') : t('Search')}</button></form>
${list}<p class="armory-note">${icon('info')}<span>${t('Profiles come from PLAYNC. Odyle keeps a copy for everyone, refreshed at most every 6 hours, and asks PLAYNC for one character at a time, so a new profile can take a while.')}${bookmarks.length ? ' ' + t('Bookmarks are kept in this browser only, with the numbers from when each profile was last opened here.') : ' ' + t('Bookmark characters on their profile to list them here, without an account.')}</span></p></main>`;
}

// Where the profile's lookup stands, in words.
export function lookupLine(answer, now) {
  const kept = answer.profile && answer.fetchedAt;
  switch (answer.state) {
    case 'queued': return answer.position ? tn(answer.position, 'Fetching from PLAYNC · about {s} s, {n} character ahead', 'Fetching from PLAYNC · about {s} s, {n} characters ahead', { s: answer.wait }) : t('Fetching from PLAYNC · about {s} s', { s: answer.wait });
    case 'fetching': return progressLine(answer.progress);
    case 'failed': return t('PLAYNC did not answer ({error}). Odyle tries again in {n} min.', { error: t(answer.lookupError || 'Request could not be completed.'), n: Math.max(1, Math.ceil(answer.retryAfter / 60)) });
    case 'busy': return t('Many lookups are waiting. Odyle asks again in a moment.');
    case 'paused': return kept ? t('The armory is paused; this is the kept copy.') : t('The armory is paused for now. Try again later.');
    default: return kept ? t('Data from PLAYNC {age}', { age: age(answer.fetchedAt, now) }) : '';
  }
}
export const waiting = answer => ['queued', 'fetching', 'busy'].includes(answer.state);
// The step the running lookup is at (backend/odyle/armory.go armoryProgress).
function progressLine(progress) {
  const { step, done = 0, total = 0 } = progress || {}, of = { done: number(done), total: number(total) };
  if (step === 'images' && total) return t('Downloading icons · {done} of {total}', of);
  if (step === 'items' && total) return t('Reading item details · {done} of {total}', of);
  if (step === 'boards' && total) return t('Reading Daevanion boards · {done} of {total}', of);
  return step === 'profile' ? t('Reading the character page…') : t('Fetching from PLAYNC now…');
}
// Where the lookup stands, with its progress bar while it runs and Refresh when it may.
export function lookupStatus(answer, now, refreshable) {
  const busy = waiting(answer), progress = answer.state === 'fetching' && answer.progress, percent = Math.min(100, Math.max(0, Number(progress?.percent) || 0));
  const bar = progress ? `<span class="armory-track armory-progress" role="progressbar" aria-label="${esc(t('Lookup progress'))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><i style="width:${percent}%"></i></span>` : '';
  return `<div class="armory-status ${busy ? 'is-waiting' : answer.state === 'failed' ? 'is-failed' : ''}" role="status">${busy ? '<span class="armory-spinner" aria-hidden="true"></span>' : icon('info')}<span>${esc(lookupLine(answer, now))}${bar}</span>${refreshable ? `<button class="button secondary" data-action="armory-refresh">${t('Refresh')}</button>` : ''}</div>`;
}

// ---------------------------------------------------------------- Profile

// The paper doll: weapons and armour on the left, accessories on the right, then the arcana and
// the companions. Slots PLAYNC adds later go with the accessories.
const armourSlots = ['MainHand', 'SubHand', 'Helmet', 'Shoulder', 'Torso', 'Pants', 'Gloves', 'Boots', 'Cape', 'Belt'];
const accessorySlots = ['Necklace', 'Amulet', 'Earring1', 'Earring2', 'Ring1', 'Ring2', 'Bracelet1', 'Bracelet2', 'Rune1', 'Rune2'];
const arcanaSlots = ['Arcana1', 'Arcana2', 'Arcana3', 'Arcana4', 'Arcana5'];
const companionSlots = ['Wings', 'Pet'];
const skillGroups = () => [['Active', t('Active skills')], ['Passive', t('Passive skills')], ['Dp', t('Stigma skills')]];
const titleCategories = () => ({ Attack: t('Offensive'), Defense: t('Defensive'), Etc: t('Other') });

// An icon in its grade's frame, with the enchantment (+15) and exceed level on it.
function itemIcon(images, item, size = '') {
  const art = picture(images, item.icon);
  return `<span class="armory-icon ${size} ${gradeClass(item.grade)}${art ? '' : ' is-empty'}" aria-hidden="true">${art}${item.enchant ? `<b class="armory-enchant">+${number(item.enchant)}</b>` : ''}${item.exceed ? `<i class="armory-exceed">✦${number(item.exceed)}</i>` : ''}${item.level ? `<b class="armory-enchant">${esc(t('Lv {level}', { level: item.level }))}</b>` : ''}</span>`;
}
const lines = list => list.map(l => l.exceed
  ? `<li class="is-exceed"><span>${esc(l.name)}</span><b>${esc(l.extra || l.value)}</b></li>`
  : `<li><span>${esc(l.name)}</span><b>${esc(l.min ? `${l.min} ~ ${l.value}` : l.value)}${l.extra ? ` <em>(+${esc(l.extra)})</em>` : ''}</b></li>`).join('');

// An item's card, shown over its slot on hover or focus: what PLAYNC's item page lists, or
// (loading) that it is on its way.
function itemTip(images, g, loading) {
  const d = g.detail, names = gradeNames();
  const kind = d?.category ? `${names[g.grade] || g.grade} · ${d.category}` : names[g.grade] || g.grade || '';
  const facts = d ? [
    [t('Item level'), number(d.itemLevel)],
    d.maxEnchant ? [t('Enchantment'), `+${number(g.enchant)} / ${number(d.maxEnchant)}`] : null,
    d.maxExceed ? [t('Exceed'), `${number(g.exceed)} / ${number(d.maxExceed)}`] : null,
    d.equipLevel ? [t('Equip level'), number(d.equipLevel)] : null,
    d.classes?.length ? [t('Class'), d.classes.join(', ')] : null,
    d.race && d.race !== 'All' ? [t('Faction'), d.race] : null,
  ].filter(Boolean) : [g.enchant ? [t('Enchantment'), `+${number(g.enchant)}`] : null, g.exceed ? [t('Exceed'), number(g.exceed)] : null, g.level ? [t('Level'), number(g.level)] : null].filter(Boolean);
  const section = (title, body) => body ? `<section><h4>${title}</h4>${body}</section>` : '';
  let body = '';
  if (d) {
    const stoneTitle = d.kind === 'Accessory' ? t('Soulstone engraving') : t('Manastone engraving');
    const stones = (list, slots) => list.length || slots ? `<ul class="armory-stones">${list.map(s => `<li class="${gradeClass(s.grade)}">${picture(images, s.icon, 'armory-stone-art') || '<i class="armory-stone-art"></i>'}<span>${esc(s.name)} ${esc(s.value || '')}${s.desc ? `<small>${esc(s.desc)}</small>` : ''}</span></li>`).join('')}${Array.from({ length: Math.max(0, slots - list.length) }, () => `<li class="is-open"><i class="armory-stone-art"></i><span>${t('Empty slot')}</span></li>`).join('')}</ul>` : '';
    const soul = d.sub.length || d.subSkills.length ? `${d.sub.length ? `<ul class="armory-lines">${lines(d.sub)}</ul>` : ''}${d.subSkills.length ? `<ul class="armory-subskills">${d.subSkills.map(s => `<li>${picture(images, s.icon, 'armory-skill-art')}<span>${esc(s.name)}</span><b>+${number(s.level)}</b></li>`).join('')}</ul>` : ''}` : '';
    const set = d.set ? `<section class="armory-set"><h4>${esc(t('Set: {name}', { name: d.set.name }))} <span>${number(d.set.equipped)} / ${number(d.set.items.length)}</span></h4><ul class="armory-set-items">${d.set.items.map(i => `<li class="${gradeClass(i.grade)}${i.equipped ? ' is-on' : ''}">${esc(i.name)}</li>`).join('')}</ul><ul class="armory-set-bonuses">${d.set.bonuses.map(b => `<li class="${d.set.equipped >= b.count ? 'is-on' : ''}"><b>${esc(t('{n} pieces', { n: b.count }))}</b><span>${b.effects.map(esc).join('<br>')}</span></li>`).join('')}</ul></section>` : '';
    body = section(t('Properties'), d.main.length ? `<ul class="armory-lines">${lines(d.main)}</ul>` : '')
      + section(`${t('Soul binding')}${d.soulBind && d.soulBind !== '100' ? ` <em>${esc(d.soulBind)}%</em>` : ''}`, soul)
      + section(stoneTitle, stones(d.stones, d.stoneSlots))
      + section(t('Theostone engraving'), stones(d.godStones, d.godSlots))
      + set
      + (d.desc ? `<p class="armory-tip-desc">${esc(d.desc)}</p>` : '')
      + `<footer>${[d.skins.length ? `${t('Skin')}: ${d.skins.map(esc).join(', ')}` : '', d.sources.length ? `${t('How to obtain')}: ${d.sources.map(esc).join(', ')}` : '', d.tradable ? t('Tradable') : t('Not tradable')].filter(Boolean).map(s => `<span>${s}</span>`).join('')}</footer>`;
  }
  if (!d && loading) body = `<p class="armory-tip-desc">${t('Odyle is reading this item\'s details from PLAYNC…')}</p>`;
  return `<div class="armory-tip" role="tooltip"><header class="${gradeClass(g.grade)}">${itemIcon(images, g, 'is-large')}<div><strong>${g.enchant ? `+${number(g.enchant)} ` : ''}${esc(g.name)}</strong><small>${esc(kind)}</small></div></header>${facts.length ? `<dl class="armory-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}${body}</div>`;
}

// One slot of the paper doll, its card on hover or focus; an empty slot says so.
function slotTile(images, slot, g, loading) {
  const label = slotLabel(slot);
  if (!g) return `<li class="armory-gear-slot is-empty"><span class="armory-icon is-empty" aria-hidden="true"></span><span class="armory-gear-text"><small>${esc(label)}</small><strong>${t('Empty')}</strong></span></li>`;
  const d = g.detail, extra = d ? [d.itemLevel ? t('item level {n}', { n: number(d.itemLevel) }) : '', d.stones?.length ? tn(d.stones.length, '{n} stone', '{n} stones') : ''].filter(Boolean).join(' · ') : [gradeName(g.grade), g.exceed ? t('exceed {n}', { n: g.exceed }) : ''].filter(Boolean).join(' · ');
  // Weapons and arcana say what they are (Orb, Chalice); other slots' types repeat the slot.
  const kind = d?.category && /^(MainHand|SubHand|Arcana\d)$/.test(slot) ? ` · ${esc(d.category)}` : '';
  return `<li class="armory-gear-slot ${gradeClass(g.grade)}" tabindex="0" aria-label="${esc(`${label}: ${g.enchant ? `+${g.enchant} ` : ''}${g.name}`)}">${itemIcon(images, g)}<span class="armory-gear-text"><small>${esc(label)}${kind}</small><strong>${esc(g.name)}</strong>${extra ? `<span>${esc(extra)}</span>` : ''}</span>${itemTip(images, g, loading)}</li>`;
}

function statsPanel(p) {
  const stat = s => `<li class="armory-stat"><div><span>${esc(s.name)}${s.deity ? `<small>${esc(s.deity)}</small>` : ''}</span><strong>${number(s.value)}</strong></div>${s.effects?.length ? `<ul>${s.effects.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}</li>`;
  const primary = p.stats.filter(s => s.primary), deity = p.stats.filter(s => !s.primary);
  return `<aside class="armory-panel armory-statpanel"><div class="section-heading"><h2>${t('Stats')}</h2></div><ul class="armory-stats">${primary.map(stat).join('')}</ul>${deity.length ? `<h3>${t('Deity stats')}</h3><ul class="armory-stats is-deity">${deity.map(stat).join('')}</ul>` : ''}</aside>`;
}

function gearTab(p, images, loading) {
  const bySlot = new Map(p.gear.map(g => [g.slot, g])), known = new Set([...armourSlots, ...accessorySlots, ...arcanaSlots, ...companionSlots]);
  const others = p.gear.filter(g => !known.has(g.slot)).map(g => g.slot);
  const tile = slot => slotTile(images, slot, bySlot.get(slot), loading);
  const column = (title, slots) => `<div class="armory-doll-column"><h3>${title}</h3><ul class="armory-gear">${slots.map(tile).join('')}</ul></div>`;
  if (!p.gear.length) return `<div class="armory-loadout"><section class="armory-panel"><p class="armory-empty">${t('PLAYNC lists no equipped items.')}</p></section>${statsPanel(p)}</div>`;
  // The arcana's sets, each once, with how many of its pieces are on.
  const sets = [...new Map(p.gear.filter(g => g.detail?.set).map(g => [g.detail.set.name, g.detail.set])).values()];
  const setList = sets.length ? `<ul class="armory-sets">${sets.map(s => `<li><strong>${esc(s.name)}</strong> <span>${number(s.equipped)} / ${number(s.items.length)}</span>${s.bonuses.filter(b => s.equipped >= b.count).map(b => `<small>${esc(t('{n} pieces', { n: b.count }))}: ${b.effects.map(esc).join(', ')}</small>`).join('')}</li>`).join('')}</ul>` : '';
  const arcana = arcanaSlots.some(s => bySlot.has(s)) ? `<div class="armory-doll-row"><h3>${t('Arcana')}</h3><ul class="armory-gear is-row">${arcanaSlots.map(tile).join('')}</ul>${setList}</div>` : '';
  return `<div class="armory-loadout"><section class="armory-panel armory-doll"><div class="armory-doll-columns">${column(t('Weapons and armour'), armourSlots)}${column(t('Accessories'), [...accessorySlots, ...others])}</div>${arcana}<div class="armory-doll-row"><h3>${t('Pet and wings')}</h3><ul class="armory-gear is-row">${companionSlots.map(tile).join('')}</ul></div></section>${statsPanel(p)}</div>`;
}

// What the gear's soul bindings and the open Daevanion nodes add to each skill ("Bolt +1").
function skillBoosts(p) {
  const gear = new Map(), boards = new Map(), add = (map, name, n) => map.set(name, (map.get(name) || 0) + n);
  for (const g of p.gear) for (const s of g.detail?.subSkills || []) add(gear, s.name, Number(s.level) || 0);
  for (const b of p.boards) for (const e of b.skillEffects || []) { const m = String(e).match(/^(.*?)\s*\+(\d+)$/); if (m) add(boards, m[1], Number(m[2])); }
  return { gear, boards };
}

function skillsTab(p, images) {
  const boosts = skillBoosts(p);
  const tile = s => {
    const fromGear = boosts.gear.get(s.name), fromBoards = boosts.boards.get(s.name), state = !s.acquired ? t('Not learned yet') : s.equipped ? t('On the skill bar') : t('Learned');
    return `<li class="armory-skill${s.equipped ? ' is-equipped' : ''}${s.acquired ? '' : ' is-locked'}" tabindex="0" aria-label="${esc(`${s.name}, ${t('Level {level}', { level: s.level })}, ${state}`)}"><span class="armory-icon is-skill${imageUrl(images, s.icon) ? '' : ' is-empty'}" aria-hidden="true">${picture(images, s.icon)}${s.level ? `<b class="armory-enchant">${number(s.level)}</b>` : ''}</span><strong>${esc(s.name)}</strong>`
      + `<div class="armory-tip is-small" role="tooltip"><header><strong>${esc(s.name)}</strong><small>${esc(state)}</small></header><dl class="armory-facts"><div><dt>${t('Skill level')}</dt><dd>${number(s.level)}</dd></div><div><dt>${t('Learned at level')}</dt><dd>${number(s.needLevel)}</dd></div>${fromGear ? `<div><dt>${t('From gear')}</dt><dd>+${number(fromGear)}</dd></div>` : ''}${fromBoards ? `<div><dt>${t('From Daevanion')}</dt><dd>+${number(fromBoards)}</dd></div>` : ''}</dl></div></li>`;
  };
  const groups = skillGroups().map(([category, title]) => [title, p.skills.filter(s => s.category === category)]).filter(([, list]) => list.length);
  const others = p.skills.filter(s => !skillGroups().some(([category]) => category === s.category));
  if (others.length) groups.push([t('Other skills'), others]);
  return `<p class="armory-legend"><span class="is-equipped"></span>${t('On the skill bar')}<span class="is-locked"></span>${t('Not learned yet')}</p>${groups.map(([title, list]) => `<section class="armory-panel"><div class="section-heading"><h2>${esc(title)} <span>${number(list.filter(s => s.acquired).length)} / ${number(list.length)}</span></h2></div><ul class="armory-skills">${list.map(tile).join('')}</ul></section>`).join('')}`;
}

function daevanionTab(p, images, chosen, loading) {
  const board = p.boards.find(b => String(b.id) === String(chosen)) || p.boards.find(b => b.open > 0) || p.boards[0];
  const pick = b => `<button type="button" class="armory-board-pick${b === board ? ' is-active' : ''}" data-armory-board="${esc(b.id)}" aria-pressed="${b === board}">${picture(images, b.icon, 'armory-board-art')}<span><strong>${esc(b.name)}</strong><small>${number(b.open)} / ${number(b.total)}</small></span><span class="armory-track"><i style="width:${percent(b.open, b.total)}%"></i></span></button>`;
  // The board's nodes from its first row and column on: PLAYNC's grid has empty edges.
  const nodes = board.nodes || [], top = Math.min(...nodes.map(n => n.r)), left = Math.min(...nodes.map(n => n.c));
  const rows = nodes.length ? Math.max(...nodes.map(n => n.r)) - top + 1 : 1, cols = nodes.length ? Math.max(...nodes.map(n => n.c)) - left + 1 : 1;
  const label = n => n.e || n.n || '';
  const grid = nodes.length ? `<div class="armory-board-grid" style="grid-template-columns:repeat(${cols},minmax(0,1fr));grid-template-rows:repeat(${rows},auto)" role="img" aria-label="${esc(t('{name}: {open} of {total} nodes open', { name: board.name, open: number(board.open), total: number(board.total) }))}">${nodes.map(n => `<span class="armory-node ${gradeClass(n.g)} is-${esc(String(n.t).toLowerCase())}${n.o ? ' is-open' : ''}" style="grid-row:${Number(n.r) - top + 1};grid-column:${Number(n.c) - left + 1}" title="${esc(label(n))}${n.o ? '' : ` · ${esc(t('closed'))}`}"></span>`).join('')}</div>`
    : `<p class="armory-empty">${!board.open ? t('No node of this board is open yet.') : loading ? t('Odyle is reading this board from PLAYNC…') : t('PLAYNC did not list this board\'s nodes.')}</p>`;
  const effects = (title, list) => list?.length ? `<h4>${title}</h4><ul>${list.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : '';
  const open = p.boards.reduce((n, b) => n + b.open, 0), total = p.boards.reduce((n, b) => n + b.total, 0);
  return `<section class="armory-panel"><div class="section-heading"><h2>${t('Daevanion')} <span>${number(open)} / ${number(total)}</span></h2></div><div class="armory-board-picks">${p.boards.map(pick).join('')}</div></section>
<section class="armory-panel armory-board"><div class="armory-board-view"><div><h3>${esc(board.name)} <span>${number(board.open)} / ${number(board.total)} · ${percent(board.open, board.total)} %</span></h3>${grid}<p class="armory-legend"><span class="is-open"></span>${t('Open')}<span></span>${t('Closed')}</p></div><aside class="armory-board-effects"><h3>${t('Board effect')}</h3>${effects(t('Stat effect'), board.statEffects)}${effects(t('Skill effect'), board.skillEffects)}${board.statEffects?.length || board.skillEffects?.length ? '' : `<p class="armory-empty">${t('No effect yet.')}</p>`}</aside></div></section>`;
}

function titlesTab(p) {
  const names = titleCategories(), titles = p.titles;
  const card = c => `<li class="armory-panel armory-title-card"><div class="armory-title-top"><span>${esc(names[c.category] || c.category)}</span><small>${number(c.owned)} / ${number(c.total)}</small></div><span class="armory-track"><i style="width:${percent(c.owned, c.total)}%"></i></span>${c.name ? `<strong class="${gradeClass(c.grade)}">${esc(c.name)}</strong>` : `<strong class="is-none">${t('No title worn')}</strong>`}${c.effects?.length ? `<h4>${t('When worn')}</h4><ul>${c.effects.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}${c.stats?.length ? `<h4>${t('Title stats')}</h4><ul>${c.stats.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}</li>`;
  return `<section class="armory-panel armory-title-summary"><div><span>${t('Titles owned')}</span><strong>${number(titles.owned)} <small>/ ${number(titles.total)}</small></strong></div><span class="armory-track"><i style="width:${percent(titles.owned, titles.total)}%"></i></span></section><ul class="armory-title-cards">${titles.equipped.map(card).join('')}</ul>`;
}

function appearanceTab(p, images) {
  const tile = (label, item) => `<li class="armory-gear-slot ${gradeClass(item.grade)}">${itemIcon(images, { ...item, enchant: 0, exceed: 0 })}<span class="armory-gear-text"><small>${esc(label)}</small><strong>${esc(item.name)}</strong>${item.grade ? `<span>${esc(gradeName(item.grade))}</span>` : ''}</span></li>`;
  const companions = p.gear.filter(g => companionSlots.includes(g.slot));
  return `<section class="armory-panel"><div class="section-heading"><h2>${t('Skins')} <span>${number(p.skins.length)}</span></h2></div>${p.skins.length ? `<ul class="armory-gear is-grid">${p.skins.map(s => tile(slotLabel(s.slot), s)).join('')}</ul>` : `<p class="armory-empty">${t('No skin is worn over the gear.')}</p>`}</section>${companions.length ? `<section class="armory-panel"><div class="section-heading"><h2>${t('Pet and wings')}</h2></div><ul class="armory-gear is-grid">${companions.map(g => tile(slotLabel(g.slot), g)).join('')}</ul></section>` : ''}`;
}

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

// The tabs a profile has: gear and stats always, the others once the kept copy holds them.
export function profileTabs(p) {
  return [['', t('Gear & stats')], ['skills', t('Skills'), p.skills?.length], ['daevanion', t('Daevanion'), p.boards?.length], ['titles', t('Titles'), p.titles?.total], ['appearance', t('Appearance'), p.skins?.length || p.gear?.some(g => companionSlots.includes(g.slot))]]
    .filter(([key, , has]) => key === '' || has);
}

// A profile page: the kept profile (or the wait for it, or what the running lookup read so
// far: partial) and where its lookup stands. view names the tab, the Daevanion board shown
// and where the backend serves images.
export function armoryProfile(answer, now, refreshable, bookmarked = false, view = {}) {
  const p = answer.profile, images = view.images || '', loading = Boolean(answer.partial);
  const status = lookupStatus(answer, now, refreshable);
  const back = `<a class="text-button armory-back" href="${link('/armory')}">${icon('arrow')} ${t('Search another character')}</a>`;
  if (!p) return `<main class="dashboard armory"><div class="heading"><div><h1>${esc(t('A character on {server}', { server: answer.server }))}</h1><p>${t('This character is not in the armory yet. Odyle fetches it from PLAYNC, one character at a time; this page fills in by itself.')}</p></div></div>${status}${back}</main>`;
  const profile = { ...p, stats: p.stats || [], gear: p.gear || [], skills: p.skills || [], skins: p.skins || [], boards: p.boards || [], titles: { owned: 0, total: 0, equipped: [], ...p.titles } };
  const tabs = profileTabs(profile), tab = tabs.some(([key]) => key === view.tab) ? view.tab : '';
  const race = /asmodian/i.test(profile.race) ? 'is-asmodian' : /elyos/i.test(profile.race) ? 'is-elyos' : '';
  const boardsOpen = profile.boards.reduce((n, b) => n + b.open, 0), boardsTotal = profile.boards.reduce((n, b) => n + b.total, 0);
  const metrics = [[t('Combat power'), number(profile.combatPower), 'CP', true], [t('Item level'), number(profile.itemLevel), t('of the equipped gear')],
    boardsTotal ? [t('Daevanion'), `${percent(boardsOpen, boardsTotal)} %`, t('{open} of {total} nodes', { open: number(boardsOpen), total: number(boardsTotal) })] : null,
    profile.titles.total ? [t('Titles'), number(profile.titles.owned), t('of {n}', { n: number(profile.titles.total) })] : null,
    profile.skills.length ? [t('Skills'), number(profile.skills.filter(s => s.acquired).length), t('of {n} learned', { n: number(profile.skills.length) })] : null].filter(Boolean);
  const hero = `<section class="armory-hero ${race}"><div class="armory-portrait" aria-hidden="true"><span>${esc(initials(profile.name))}</span>${picture(images, profile.portrait)}</div>
<div class="armory-identity"><p class="armory-eyebrow">${esc([profile.server || answer.server, regionLabel(answer.region)].filter(Boolean).join(' · '))}</p><h1>${esc(profile.name)}</h1>${profile.title ? `<p class="armory-title ${gradeClass(profile.titleGrade)}">${esc(profile.title)}</p>` : ''}<p class="armory-tags"><span>${esc(t('Level {level}', { level: profile.level }))}</span>${profile.class ? `<span>${classBadge(images, answer.classIcon, profile.class)}${esc(profile.class)}</span>` : ''}${[profile.race, profile.gender].filter(Boolean).map(s => `<span>${esc(s)}</span>`).join('')}${profile.legion ? `<span class="armory-legion" title="${esc(t('Legion'))}">${icon('people')}${esc(profile.legion)}</span>` : ''}</p></div>
<div class="armory-hero-actions"><button class="button secondary armory-bookmark" data-action="armory-bookmark" aria-pressed="${bookmarked}" title="${esc(bookmarked ? t('Remove {name} from bookmarks', { name: profile.name }) : t('Bookmark {name} in this browser', { name: profile.name }))}">${bookmarked ? '★ ' + t('Bookmarked') : '☆ ' + t('Bookmark')}</button><a class="button secondary armory-card-link" href="${esc(link(profilePath(answer) + '/card'))}">${icon('star')} ${t('Player card')}</a><a class="button secondary" href="${esc(playncPage(answer))}" target="_blank" rel="noopener noreferrer">${t('Official page')} ↗</a></div>
<dl class="armory-power">${metrics.map(([label, value, small, main]) => `<div class="${main ? 'is-main' : ''}"><dt>${esc(label)}</dt><dd><strong>${esc(value)}</strong><small>${esc(small)}</small></dd></div>`).join('')}</dl></section>`;
  const nav = `<nav class="armory-tabs" aria-label="${esc(t('Profile sections'))}">${tabs.map(([key, label]) => `<a href="${esc(link(profilePath(answer, key)))}"${key === tab ? ' aria-current="page"' : ''}>${esc(label)}</a>`).join('')}</nav>`;
  const content = tab === 'skills' ? skillsTab(profile, images) : tab === 'daevanion' ? daevanionTab(profile, images, view.board, loading) : tab === 'titles' ? titlesTab(profile) : tab === 'appearance' ? appearanceTab(profile, images) : gearTab(profile, images, loading);
  return `<main class="dashboard armory armory-profile">${hero}${status}${nav}<div class="armory-tab">${content}</div>${back}</main>`;
}
