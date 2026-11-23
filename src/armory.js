// The armory (#67): public AION 2 Global character profiles as PLAYNC's official character
// pages list them, kept by the backend and fetched from PLAYNC one at a time
// (backend/odyle/armory.go). Pages: #/armory (search), #/armory/find/<region>/<server>/<name>
// (a search, as character cards link it), #/armory/<search region>/<server id>/<character
// id>[/<tab>] (a profile: gear and stats, or its skills, daevanion, titles, appearance or upgrade tab)
// and the profile's player card, /card, a page of its own (card.js).
// Nothing here is typed in or changed by players. Bookmarks (#72) are kept in the browser
// only, so they need no account. Images (the game's icons, the character's portrait) come
// from the Odyle server only (backend/odyle/armoryimages.go). Its paths, the titles of its pages
// and the class emblems are in armorylinks.js, which the rest of the dashboard uses without
// loading this module: it loads with the armory's first page (app/armory.js).
import { t, tn } from './i18n.js';
import { age, escape as esc, number } from './model.js';
import { icon } from './icons.js';
import { link } from './routes.js';
import { armoryRoute, profilePath, topPath, imageUrl, classBadge } from './armorylinks.js';
import { upgradePlan, upgradeLeast, usualRolls } from './upgrade.js';
import { progressPanel, powerChange } from './armoryhistory.js';

export const regionNames = () => ({
  GLOBAL_NA: t('North America East'),
  GLOBAL_NAW: t('North America West'),
  GLOBAL_EU: t('Europe'),
  GLOBAL_SA: t('South America'),
  GLOBAL_ASIA: t('Asia'),
});
// PLAYNC's search regions and the regions Odyle names them by.
const searchRegions = { nae: 'GLOBAL_NA', naw: 'GLOBAL_NAW', eu: 'GLOBAL_EU', la: 'GLOBAL_SA', as: 'GLOBAL_ASIA' };
const regionLabel = region => regionNames()[searchRegions[region]] || '';
// The character's page on PLAYNC's own site.
export const playncPage = answer =>
  `https://aion2.plaync.com/en-us/characters/${encodeURIComponent(answer.serverId)}/${encodeURIComponent(answer.characterId)}?region=${encodeURIComponent(answer.region)}`;

const percent = (part, whole) => (whole ? Math.min(100, Math.round((part / whole) * 100)) : 0);

const picture = (base, name, kind = '') => {
  const src = imageUrl(base, name);
  return src
    ? `<img class="armory-img ${kind}" src="${esc(src)}" alt="" loading="lazy" decoding="async" draggable="false">`
    : '';
};
const initials = name => [...String(name || '?')].slice(0, 2).join('').toUpperCase();

// Bookmarks: characters this browser keeps in a list, newest first, each with the numbers of
// its profile as last opened here. app/armory.js keeps them in localStorage (odyle.armory.bookmarks).
export const bookmarkLimit = 50;
export const bookmarkKey = c => `${c.region}/${c.serverId}/${c.characterId}`;
// Saved bookmarks as far as they still make sense; anything else in storage is left out.
export function readBookmarks(raw) {
  let list;
  try {
    list = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list
    .filter(
      b =>
        b &&
        typeof b === 'object' &&
        typeof b.name === 'string' &&
        b.name &&
        armoryRoute.test(profilePath(b)) &&
        !seen.has(bookmarkKey(b)) &&
        seen.add(bookmarkKey(b)),
    )
    .slice(0, bookmarkLimit);
}
export const isBookmarked = (list, character) => list.some(b => bookmarkKey(b) === bookmarkKey(character));
// A profile answer as a bookmark row.
export function bookmarkOf(answer, savedAt) {
  const p = answer.profile;
  return {
    region: answer.region,
    serverId: Number(answer.serverId),
    characterId: answer.characterId,
    name: p.name,
    server: p.server || answer.server,
    class: p.class,
    classIcon: answer.classIcon || '',
    level: p.level,
    combatPower: p.combatPower,
    itemLevel: p.itemLevel,
    portrait: p.portrait || '',
    fetchedAt: answer.fetchedAt,
    savedAt,
  };
}
export const addBookmark = (list, answer, savedAt) =>
  isBookmarked(list, answer) ? list : [bookmarkOf(answer, savedAt), ...list];
export const removeBookmark = (list, key) => list.filter(b => bookmarkKey(b) !== key);
// An opened profile brings its row up to date, in its place in the list.
export const refreshBookmark = (list, answer) =>
  answer.profile ? list.map(b => (bookmarkKey(b) === bookmarkKey(answer) ? bookmarkOf(answer, b.savedAt) : b)) : list;
function bookmarkList(bookmarks, now, images) {
  if (!bookmarks.length) return '';
  const row = b =>
    `<li><a href="${esc(link(profilePath(b)))}"><span class="armory-mini" aria-hidden="true">${esc(initials(b.name))}${picture(images, b.portrait)}</span><strong>${esc(b.name)}</strong><span>${classBadge(images, b.classIcon, b.class)}${esc([t('Level {level}', { level: b.level }), b.class, b.server].filter(Boolean).join(' · '))}</span><span class="armory-mark-power">${esc(number(b.combatPower))} CP · ${esc(t('item level {n}', { n: number(b.itemLevel) }))}<small>${esc(t('as of {age}', { age: age(b.fetchedAt, now) }))}</small></span>${icon('arrow')}</a><button class="close-button" data-armory-unmark="${esc(bookmarkKey(b))}" aria-label="${esc(t('Remove {name} from bookmarks', { name: b.name }))}" title="${esc(t('Remove {name} from bookmarks', { name: b.name }))}">×</button></li>`;
  return `<section class="armory-bookmarks"><div class="section-heading"><h2>${t('Bookmarked characters')} <span>${bookmarks.length}</span></h2></div><ul class="armory-results armory-marked">${bookmarks.map(row).join('')}</ul></section>`;
}
const slotNames = () => ({
  MainHand: t('Main hand'),
  SubHand: t('Off hand'),
  Helmet: t('Helmet'),
  Shoulder: t('Shoulders'),
  Torso: t('Torso'),
  Pants: t('Pants'),
  Gloves: t('Gloves'),
  Boots: t('Boots'),
  Cape: t('Cape'),
  Belt: t('Belt'),
  Necklace: t('Necklace'),
  Amulet: t('Amulet'),
  Earring: t('Earring'),
  Ring: t('Ring'),
  Bracelet: t('Bracelet'),
  Rune: t('Rune'),
  Arcana: t('Arcana'),
  Wings: t('Wings'),
  Pet: t('Pet'),
});
// "Earring2" → "Earring", "Arcana3" → "Arcana 3"; skins' "EarringL" → "Earring" and "MaceMain"
// → "Main hand". Unknown slots keep PLAYNC's name.
export function slotLabel(slot) {
  const [, base, index] = String(slot).match(/^(.*?)(\d*)$/),
    names = slotNames();
  const name =
    names[base] ||
    names[base.replace(/[LR]$/, '')] ||
    (/.Main$/.test(base) ? names.MainHand : /.Sub$/.test(base) ? names.SubHand : base);
  return base === 'Arcana' && index ? `${name} ${index}` : name;
}
const grades = ['common', 'rare', 'legend', 'unique', 'epic', 'mythic', 'special'];
export const gradeClass = grade =>
  grades.includes(String(grade).toLowerCase()) ? 'grade-' + String(grade).toLowerCase() : 'grade-common';
const gradeNames = () => ({
  Common: t('Common'),
  Rare: t('Rare'),
  Legend: t('Legend'),
  Unique: t('Unique'),
  Epic: t('Epic'),
  Mythic: t('Mythic'),
  Special: t('Special'),
});
const gradeName = grade => gradeNames()[grade] || grade || '';

// The search form, with the region and server last searched.
export function armorySearch(
  regions,
  chosen,
  results = null,
  searching = false,
  bookmarks = [],
  now = Date.now(),
  images = '',
) {
  const region =
    regions.find(r => r.region === chosen.region) || regions.find(r => r.region === 'GLOBAL_EU') || regions[0];
  const names = regionNames(),
    group = (label, list) =>
      `<optgroup label="${esc(label)}">${list.map(s => `<option ${s === chosen.server ? 'selected' : ''}>${esc(s)}</option>`).join('')}</optgroup>`;
  const list =
    results === null
      ? ''
      : results.length
        ? `<ul class="armory-results">${results.map(hit => `<li><a href="${esc(link(profilePath(hit)))}"><strong>${esc(hit.name)}${isBookmarked(bookmarks, hit) ? ` <span class="armory-star" title="${esc(t('Bookmarked'))}">★</span>` : ''}</strong><span>${esc(t('Level {level}', { level: hit.level }))} · ${hit.class ? `${classBadge(images, hit.classIcon, hit.class)}${esc(hit.class)} · ` : ''}${hit.race === 1 ? t('Elyos') : hit.race === 2 ? t('Asmodians') : ''} · ${esc(hit.server)}</span>${icon('arrow')}</a></li>`).join('')}</ul>`
        : `<p class="armory-empty">${t('PLAYNC lists no character of that name on this server.')}</p>`;
  return `<main class="dashboard armory"><div class="heading"><div><h1>${t('Look up a character')}</h1><p>${t("Everything PLAYNC's official character pages show of any AION 2 Global character: gear with each item's stats and stones, combat power, stats, skills, Daevanion boards, titles and skins. No sign-in needed.")}</p></div><div class="heading-actions"><a class="button secondary" href="${esc(link(topPath()))}">${icon('trophy')} ${t('Top players by class')}</a></div></div>
${bookmarkList(bookmarks, now, images)}<form id="armory-form" class="armory-form"><label>${t('Region')}<select name="region">${regions.map(r => `<option value="${esc(r.region)}" ${r === region ? 'selected' : ''}>${esc(names[r.region] || r.region)}</option>`).join('')}</select></label>
<label>${t('Server')}<select name="server">${group(t('Elyos'), region.elyos)}${group(t('Asmodians'), region.asmodian)}</select></label>
<label>${t('Character name')}<input name="name" required minlength="2" maxlength="16" pattern="[\\p{L}\\p{N}]{2,16}" autocomplete="off" value="${esc(chosen.name || '')}"></label><button class="button primary" type="submit" ${searching ? 'disabled' : ''}>${searching ? t('Searching…') : t('Search')}</button></form>
${list}<p class="armory-note">${icon('info')}<span>${t('Profiles come from PLAYNC. Odyle keeps a copy for everyone, refreshed at most every 6 hours, and asks PLAYNC for one character at a time, so a new profile can take a while.')}${bookmarks.length ? ' ' + t('Bookmarks are kept in this browser only, with the numbers from when each profile was last opened here.') : ' ' + t('Bookmark characters on their profile to list them here, without an account.')}</span></p></main>`;
}

// ---------------------------------------------------------------- Top players

// The top players page (/armory/top/<class>): the strongest characters of a class Odyle knows by
// combat power (backend/odyle/ranks.go), with a tab for each class; answer is the backend's, null
// while it loads.
export function armoryTop(answer, images = '', chosen = '') {
  const classes = answer?.classes || [],
    current = answer?.class || chosen;
  const tabs = classes.length
    ? `<nav class="armory-tabs top-classes" aria-label="${esc(t('Classes'))}">${classes.map(c => `<a href="${esc(link(topPath(c.name)))}"${c.name === current ? ' aria-current="page"' : ''}>${classBadge(images, c.icon, c.name)}${esc(c.name)}${c.characters ? ` <small>${esc(number(c.characters))}</small>` : ''}</a>`).join('')}</nav>`
    : '';
  const row = p =>
    `<li><a href="${esc(link(profilePath(p)))}"><span class="top-place">${esc(number(p.place))}</span><span class="armory-mini" aria-hidden="true">${esc(initials(p.name))}${picture(images, p.portrait)}</span><span class="top-who"><strong>${esc(p.name)}</strong><small>${esc([p.server, regionLabel(p.region), t('Level {level}', { level: p.level })].filter(Boolean).join(' · '))}</small></span><span class="top-power"><strong>${esc(number(p.combatPower))} <small>CP</small></strong><small>${esc(t('item level {n}', { n: number(p.itemLevel) }))}</small></span></a></li>`;
  const players = answer?.players || [];
  const list = !answer
    ? `<p class="armory-empty upgrade-wait"><span class="armory-spinner" aria-hidden="true"></span>${t('Loading the top players…')}</p>`
    : players.length
      ? `<ol class="top-list">${players.map(row).join('')}</ol>`
      : `<p class="armory-empty">${esc(t('Odyle knows no {class} character yet.', { class: current }))}</p>`;
  const heading = current
    ? `<div class="section-heading"><h2>${classBadge(images, classes.find(c => c.name === current)?.icon, current)}${esc(t('Strongest {class} characters', { class: current }))} <span>${esc(number(players.length))}</span></h2></div>`
    : '';
  return `<main class="dashboard armory armory-top"><div class="heading"><div><h1>${t('Top players by class')}</h1><p>${t("The strongest characters of each class that Odyle knows on AION 2 Global, by combat power, from every region. Open one to see its gear, or your own character's Upgrade tab to compare with them.")}</p></div></div>
${tabs}<section class="armory-panel">${heading}${list}</section><p class="armory-note">${icon('info')}<span>${esc(t("PLAYNC's Global pages list no rankings and its character search lists no combat power, so this is what Odyle knows: every character anyone looked up, and those its scout reads slowly from PLAYNC's character search, some 7,000 pages a day. It grows more complete over time, but it is no full ranking. Odyle knows {n} {class} characters.", { n: number(answer?.characters || 0), class: current }))}</span></p><a class="text-button armory-back" href="${link('/armory')}">${icon('arrow')} ${t('Search another character')}</a></main>`;
}

// Where the profile's lookup stands, in words.
export function lookupLine(answer, now) {
  const kept = answer.profile && answer.fetchedAt;
  switch (answer.state) {
    case 'queued':
      return answer.position
        ? tn(
            answer.position,
            'Fetching from PLAYNC · about {s} s, {n} character ahead',
            'Fetching from PLAYNC · about {s} s, {n} characters ahead',
            { s: answer.wait },
          )
        : t('Fetching from PLAYNC · about {s} s', { s: answer.wait });
    case 'fetching':
      return progressLine(answer.progress);
    case 'failed':
      return t('PLAYNC did not answer ({error}). Odyle tries again in {n} min.', {
        error: t(answer.lookupError || 'Request could not be completed.'),
        n: Math.max(1, Math.ceil(answer.retryAfter / 60)),
      });
    case 'busy':
      return t('Many lookups are waiting. Odyle asks again in a moment.');
    case 'paused':
      return kept
        ? t('The armory is paused; this is the kept copy.')
        : t('The armory is paused for now. Try again later.');
    default:
      return kept ? t('Data from PLAYNC {age}', { age: age(answer.fetchedAt, now) }) : '';
  }
}
export const waiting = answer => ['queued', 'fetching', 'busy'].includes(answer.state);
// The step the running lookup is at (backend/odyle/armoryqueue.go armoryProgress).
function progressLine(progress) {
  const { step, done = 0, total = 0 } = progress || {},
    of = { done: number(done), total: number(total) };
  if (step === 'images' && total) return t('Downloading icons · {done} of {total}', of);
  if (step === 'items' && total) return t('Reading item details · {done} of {total}', of);
  if (step === 'boards' && total) return t('Reading Daevanion boards · {done} of {total}', of);
  return step === 'profile' ? t('Reading the character page…') : t('Fetching from PLAYNC now…');
}
// Where the lookup stands, with its progress bar while it runs and Refresh when it may.
export function lookupStatus(answer, now, refreshable) {
  const busy = waiting(answer),
    progress = answer.state === 'fetching' && answer.progress,
    filled = Math.min(100, Math.max(0, Number(progress?.percent) || 0));
  const bar = progress
    ? `<span class="armory-track armory-progress" role="progressbar" aria-label="${esc(t('Lookup progress'))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${filled}"><i style="width:${filled}%"></i></span>`
    : '';
  return `<div class="armory-status ${busy ? 'is-waiting' : answer.state === 'failed' ? 'is-failed' : ''}" role="status">${busy ? '<span class="armory-spinner" aria-hidden="true"></span>' : icon('info')}<span>${esc(lookupLine(answer, now))}${bar}</span>${refreshable ? `<button class="button secondary" data-action="armory-refresh">${t('Refresh')}</button>` : ''}</div>`;
}

// ---------------------------------------------------------------- Profile

// The paper doll: weapons and armour on the left, accessories on the right, then the arcana and
// the companions. Slots PLAYNC adds later go with the accessories.
const armourSlots = ['MainHand', 'SubHand', 'Helmet', 'Shoulder', 'Torso', 'Pants', 'Gloves', 'Boots', 'Cape', 'Belt'];
const accessorySlots = [
  'Necklace',
  'Amulet',
  'Earring1',
  'Earring2',
  'Ring1',
  'Ring2',
  'Bracelet1',
  'Bracelet2',
  'Rune1',
  'Rune2',
];
const arcanaSlots = ['Arcana1', 'Arcana2', 'Arcana3', 'Arcana4', 'Arcana5'];
const companionSlots = ['Wings', 'Pet'];
const skillGroups = () => [
  ['Active', t('Active skills')],
  ['Passive', t('Passive skills')],
  ['Dp', t('Stigma skills')],
];
const titleCategories = () => ({ Attack: t('Offensive'), Defense: t('Defensive'), Etc: t('Other') });

// An icon in its grade's frame, with the enchantment (+15) and exceed level on it.
function itemIcon(images, item, size = '') {
  const art = picture(images, item.icon);
  return `<span class="armory-icon ${size} ${gradeClass(item.grade)}${art ? '' : ' is-empty'}" aria-hidden="true">${art}${item.enchant ? `<b class="armory-enchant">+${number(item.enchant)}</b>` : ''}${item.exceed ? `<i class="armory-exceed">✦${number(item.exceed)}</i>` : ''}${item.level ? `<b class="armory-enchant">${esc(t('Lv {level}', { level: item.level }))}</b>` : ''}</span>`;
}
const lines = list =>
  list
    .map(l =>
      l.exceed
        ? `<li class="is-exceed"><span>${esc(l.name)}</span><b>${esc(l.extra || l.value)}</b></li>`
        : `<li><span>${esc(l.name)}</span><b>${esc(l.min ? `${l.min} ~ ${l.value}` : l.value)}${l.extra ? ` <em>(+${esc(l.extra)})</em>` : ''}</b></li>`,
    )
    .join('');

// An item's card, shown over its slot on hover or focus: what PLAYNC's item page lists, or
// (loading) that it is on its way.
function itemTip(images, g, loading) {
  const d = g.detail,
    names = gradeNames();
  const kind = d?.category ? `${names[g.grade] || g.grade} · ${d.category}` : names[g.grade] || g.grade || '';
  const facts = d
    ? [
        [t('Item level'), number(d.itemLevel)],
        d.maxEnchant ? [t('Enchantment'), `+${number(g.enchant)} / ${number(d.maxEnchant)}`] : null,
        d.maxExceed ? [t('Exceed'), `${number(g.exceed)} / ${number(d.maxExceed)}`] : null,
        d.equipLevel ? [t('Equip level'), number(d.equipLevel)] : null,
        d.classes?.length ? [t('Class'), d.classes.join(', ')] : null,
        d.race && d.race !== 'All' ? [t('Faction'), d.race] : null,
      ].filter(Boolean)
    : [
        g.enchant ? [t('Enchantment'), `+${number(g.enchant)}`] : null,
        g.exceed ? [t('Exceed'), number(g.exceed)] : null,
        g.level ? [t('Level'), number(g.level)] : null,
      ].filter(Boolean);
  const section = (title, body) => (body ? `<section><h4>${title}</h4>${body}</section>` : '');
  let body = '';
  if (d) {
    const stoneTitle = d.kind === 'Accessory' ? t('Soulstone engraving') : t('Manastone engraving');
    const stones = (list, slots) =>
      list.length || slots
        ? `<ul class="armory-stones">${list.map(s => `<li class="${gradeClass(s.grade)}">${picture(images, s.icon, 'armory-stone-art') || '<i class="armory-stone-art"></i>'}<span>${esc(s.name)} ${esc(s.value || '')}${s.desc ? `<small>${esc(s.desc)}</small>` : ''}</span></li>`).join('')}${Array.from({ length: Math.max(0, slots - list.length) }, () => `<li class="is-open"><i class="armory-stone-art"></i><span>${t('Empty slot')}</span></li>`).join('')}</ul>`
        : '';
    const soul =
      d.sub.length || d.subSkills.length
        ? `${d.sub.length ? `<ul class="armory-lines">${lines(d.sub)}</ul>` : ''}${d.subSkills.length ? `<ul class="armory-subskills">${d.subSkills.map(s => `<li>${picture(images, s.icon, 'armory-skill-art')}<span>${esc(s.name)}</span><b>+${number(s.level)}</b></li>`).join('')}</ul>` : ''}`
        : '';
    const set = d.set
      ? `<section class="armory-set"><h4>${esc(t('Set: {name}', { name: d.set.name }))} <span>${number(d.set.equipped)} / ${number(d.set.items.length)}</span></h4><ul class="armory-set-items">${d.set.items.map(i => `<li class="${gradeClass(i.grade)}${i.equipped ? ' is-on' : ''}">${esc(i.name)}</li>`).join('')}</ul><ul class="armory-set-bonuses">${d.set.bonuses.map(b => `<li class="${d.set.equipped >= b.count ? 'is-on' : ''}"><b>${esc(t('{n} pieces', { n: b.count }))}</b><span>${b.effects.map(esc).join('<br>')}</span></li>`).join('')}</ul></section>`
      : '';
    body =
      section(t('Properties'), d.main.length ? `<ul class="armory-lines">${lines(d.main)}</ul>` : '') +
      section(
        `${t('Soul binding')}${d.soulBind && d.soulBind !== '100' ? ` <em>${esc(d.soulBind)}%</em>` : ''}`,
        soul,
      ) +
      section(stoneTitle, stones(d.stones, d.stoneSlots)) +
      section(t('Theostone engraving'), stones(d.godStones, d.godSlots)) +
      set +
      (d.desc ? `<p class="armory-tip-desc">${esc(d.desc)}</p>` : '') +
      `<footer>${[
        d.skins.length ? `${t('Skin')}: ${d.skins.map(esc).join(', ')}` : '',
        d.sources.length ? `${t('How to obtain')}: ${d.sources.map(esc).join(', ')}` : '',
        d.tradable ? t('Tradable') : t('Not tradable'),
      ]
        .filter(Boolean)
        .map(s => `<span>${s}</span>`)
        .join('')}</footer>`;
  }
  if (!d && loading) body = `<p class="armory-tip-desc">${t("Odyle is reading this item's details from PLAYNC…")}</p>`;
  return `<div class="armory-tip" role="tooltip"><header class="${gradeClass(g.grade)}">${itemIcon(images, g, 'is-large')}<div><strong>${g.enchant ? `+${number(g.enchant)} ` : ''}${esc(g.name)}</strong><small>${esc(kind)}</small></div></header>${facts.length ? `<dl class="armory-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}${body}</div>`;
}

// One slot of the paper doll, its card on hover or focus; an empty slot says so.
function slotTile(images, slot, g, loading) {
  const label = slotLabel(slot);
  if (!g)
    return `<li class="armory-gear-slot is-empty"><span class="armory-icon is-empty" aria-hidden="true"></span><span class="armory-gear-text"><small>${esc(label)}</small><strong>${t('Empty')}</strong></span></li>`;
  const d = g.detail,
    extra = d
      ? [
          d.itemLevel ? t('item level {n}', { n: number(d.itemLevel) }) : '',
          d.stones?.length ? tn(d.stones.length, '{n} stone', '{n} stones') : '',
        ]
          .filter(Boolean)
          .join(' · ')
      : [gradeName(g.grade), g.exceed ? t('exceed {n}', { n: g.exceed }) : ''].filter(Boolean).join(' · ');
  // Weapons and arcana say what they are (Orb, Chalice); other slots' types repeat the slot.
  const kind = d?.category && /^(MainHand|SubHand|Arcana\d)$/.test(slot) ? ` · ${esc(d.category)}` : '';
  return `<li class="armory-gear-slot ${gradeClass(g.grade)}" tabindex="0" aria-label="${esc(`${label}: ${g.enchant ? `+${g.enchant} ` : ''}${g.name}`)}">${itemIcon(images, g)}<span class="armory-gear-text"><small>${esc(label)}${kind}</small><strong>${esc(g.name)}</strong>${extra ? `<span>${esc(extra)}</span>` : ''}</span>${itemTip(images, g, loading)}</li>`;
}

function statsPanel(p) {
  const stat = s =>
    `<li class="armory-stat"><div><span>${esc(s.name)}${s.deity ? `<small>${esc(s.deity)}</small>` : ''}</span><strong>${number(s.value)}</strong></div>${s.effects?.length ? `<ul>${s.effects.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}</li>`;
  const primary = p.stats.filter(s => s.primary),
    deity = p.stats.filter(s => !s.primary);
  return `<aside class="armory-panel armory-statpanel"><div class="section-heading"><h2>${t('Stats')}</h2></div><ul class="armory-stats">${primary.map(stat).join('')}</ul>${deity.length ? `<h3>${t('Deity stats')}</h3><ul class="armory-stats is-deity">${deity.map(stat).join('')}</ul>` : ''}</aside>`;
}

function gearTab(p, images, loading) {
  const bySlot = new Map(p.gear.map(g => [g.slot, g])),
    known = new Set([...armourSlots, ...accessorySlots, ...arcanaSlots, ...companionSlots]);
  const others = p.gear.filter(g => !known.has(g.slot)).map(g => g.slot);
  const tile = slot => slotTile(images, slot, bySlot.get(slot), loading);
  const column = (title, slots) =>
    `<div class="armory-doll-column"><h3>${title}</h3><ul class="armory-gear">${slots.map(tile).join('')}</ul></div>`;
  if (!p.gear.length)
    return `<div class="armory-loadout"><section class="armory-panel"><p class="armory-empty">${t('PLAYNC lists no equipped items.')}</p></section>${statsPanel(p)}</div>`;
  // The arcana's sets, each once, with how many of its pieces are on.
  const sets = [...new Map(p.gear.filter(g => g.detail?.set).map(g => [g.detail.set.name, g.detail.set])).values()];
  const setList = sets.length
    ? `<ul class="armory-sets">${sets
        .map(
          s =>
            `<li><strong>${esc(s.name)}</strong> <span>${number(s.equipped)} / ${number(s.items.length)}</span>${s.bonuses
              .filter(b => s.equipped >= b.count)
              .map(b => `<small>${esc(t('{n} pieces', { n: b.count }))}: ${b.effects.map(esc).join(', ')}</small>`)
              .join('')}</li>`,
        )
        .join('')}</ul>`
    : '';
  const arcana = arcanaSlots.some(s => bySlot.has(s))
    ? `<div class="armory-doll-row"><h3>${t('Arcana')}</h3><ul class="armory-gear is-row">${arcanaSlots.map(tile).join('')}</ul>${setList}</div>`
    : '';
  return `<div class="armory-loadout"><section class="armory-panel armory-doll"><div class="armory-doll-columns">${column(t('Weapons and armour'), armourSlots)}${column(t('Accessories'), [...accessorySlots, ...others])}</div>${arcana}<div class="armory-doll-row"><h3>${t('Pet and wings')}</h3><ul class="armory-gear is-row">${companionSlots.map(tile).join('')}</ul></div></section>${statsPanel(p)}</div>`;
}

// What the gear's soul bindings and the open Daevanion nodes add to each skill ("Bolt +1").
function skillBoosts(p) {
  const gear = new Map(),
    boards = new Map(),
    add = (map, name, n) => map.set(name, (map.get(name) || 0) + n);
  for (const g of p.gear) for (const s of g.detail?.subSkills || []) add(gear, s.name, Number(s.level) || 0);
  for (const b of p.boards)
    for (const e of b.skillEffects || []) {
      const m = String(e).match(/^(.*?)\s*\+(\d+)$/);
      if (m) add(boards, m[1], Number(m[2]));
    }
  return { gear, boards };
}

function skillsTab(p, images) {
  const boosts = skillBoosts(p);
  const tile = s => {
    const fromGear = boosts.gear.get(s.name),
      fromBoards = boosts.boards.get(s.name),
      state = !s.acquired ? t('Not learned yet') : s.equipped ? t('On the skill bar') : t('Learned');
    return (
      `<li class="armory-skill${s.equipped ? ' is-equipped' : ''}${s.acquired ? '' : ' is-locked'}" tabindex="0" aria-label="${esc(`${s.name}, ${t('Level {level}', { level: s.level })}, ${state}`)}"><span class="armory-icon is-skill${imageUrl(images, s.icon) ? '' : ' is-empty'}" aria-hidden="true">${picture(images, s.icon)}${s.level ? `<b class="armory-enchant">${number(s.level)}</b>` : ''}</span><strong>${esc(s.name)}</strong>` +
      `<div class="armory-tip is-small" role="tooltip"><header><strong>${esc(s.name)}</strong><small>${esc(state)}</small></header><dl class="armory-facts"><div><dt>${t('Skill level')}</dt><dd>${number(s.level)}</dd></div><div><dt>${t('Learned at level')}</dt><dd>${number(s.needLevel)}</dd></div>${fromGear ? `<div><dt>${t('From gear')}</dt><dd>+${number(fromGear)}</dd></div>` : ''}${fromBoards ? `<div><dt>${t('From Daevanion')}</dt><dd>+${number(fromBoards)}</dd></div>` : ''}</dl></div></li>`
    );
  };
  const groups = skillGroups()
    .map(([category, title]) => [title, p.skills.filter(s => s.category === category)])
    .filter(([, list]) => list.length);
  const others = p.skills.filter(s => !skillGroups().some(([category]) => category === s.category));
  if (others.length) groups.push([t('Other skills'), others]);
  return `<p class="armory-legend"><span class="is-equipped"></span>${t('On the skill bar')}<span class="is-locked"></span>${t('Not learned yet')}</p>${groups.map(([title, list]) => `<section class="armory-panel"><div class="section-heading"><h2>${esc(title)} <span>${number(list.filter(s => s.acquired).length)} / ${number(list.length)}</span></h2></div><ul class="armory-skills">${list.map(tile).join('')}</ul></section>`).join('')}`;
}

function daevanionTab(p, images, chosen, loading) {
  const board = p.boards.find(b => String(b.id) === String(chosen)) || p.boards.find(b => b.open > 0) || p.boards[0];
  const pick = b =>
    `<button type="button" class="armory-board-pick${b === board ? ' is-active' : ''}" data-armory-board="${esc(b.id)}" aria-pressed="${b === board}">${picture(images, b.icon, 'armory-board-art')}<span><strong>${esc(b.name)}</strong><small>${number(b.open)} / ${number(b.total)}</small></span><span class="armory-track"><i style="width:${percent(b.open, b.total)}%"></i></span></button>`;
  // The board's nodes from its first row and column on: PLAYNC's grid has empty edges.
  const nodes = board.nodes || [],
    top = Math.min(...nodes.map(n => n.r)),
    left = Math.min(...nodes.map(n => n.c));
  const rows = nodes.length ? Math.max(...nodes.map(n => n.r)) - top + 1 : 1,
    cols = nodes.length ? Math.max(...nodes.map(n => n.c)) - left + 1 : 1;
  const label = n => n.e || n.n || '';
  const grid = nodes.length
    ? `<div class="armory-board-grid" style="grid-template-columns:repeat(${cols},minmax(0,1fr));grid-template-rows:repeat(${rows},auto)" role="img" aria-label="${esc(t('{name}: {open} of {total} nodes open', { name: board.name, open: number(board.open), total: number(board.total) }))}">${nodes.map(n => `<span class="armory-node ${gradeClass(n.g)} is-${esc(String(n.t).toLowerCase())}${n.o ? ' is-open' : ''}" style="grid-row:${Number(n.r) - top + 1};grid-column:${Number(n.c) - left + 1}" title="${esc(label(n))}${n.o ? '' : ` · ${esc(t('closed'))}`}"></span>`).join('')}</div>`
    : `<p class="armory-empty">${!board.open ? t('No node of this board is open yet.') : loading ? t('Odyle is reading this board from PLAYNC…') : t("PLAYNC did not list this board's nodes.")}</p>`;
  const effects = (title, list) =>
    list?.length ? `<h4>${title}</h4><ul>${list.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : '';
  const open = p.boards.reduce((n, b) => n + b.open, 0),
    total = p.boards.reduce((n, b) => n + b.total, 0);
  return `<section class="armory-panel"><div class="section-heading"><h2>${t('Daevanion')} <span>${number(open)} / ${number(total)}</span></h2></div><div class="armory-board-picks">${p.boards.map(pick).join('')}</div></section>
<section class="armory-panel armory-board"><div class="armory-board-view"><div><h3>${esc(board.name)} <span>${number(board.open)} / ${number(board.total)} · ${percent(board.open, board.total)} %</span></h3>${grid}<p class="armory-legend"><span class="is-open"></span>${t('Open')}<span></span>${t('Closed')}</p></div><aside class="armory-board-effects"><h3>${t('Board effect')}</h3>${effects(t('Stat effect'), board.statEffects)}${effects(t('Skill effect'), board.skillEffects)}${board.statEffects?.length || board.skillEffects?.length ? '' : `<p class="armory-empty">${t('No effect yet.')}</p>`}</aside></div></section>`;
}

function titlesTab(p) {
  const names = titleCategories(),
    titles = p.titles;
  const card = c =>
    `<li class="armory-panel armory-title-card"><div class="armory-title-top"><span>${esc(names[c.category] || c.category)}</span><small>${number(c.owned)} / ${number(c.total)}</small></div><span class="armory-track"><i style="width:${percent(c.owned, c.total)}%"></i></span>${c.name ? `<strong class="${gradeClass(c.grade)}">${esc(c.name)}</strong>` : `<strong class="is-none">${t('No title worn')}</strong>`}${c.effects?.length ? `<h4>${t('When worn')}</h4><ul>${c.effects.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}${c.stats?.length ? `<h4>${t('Title stats')}</h4><ul>${c.stats.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}</li>`;
  return `<section class="armory-panel armory-title-summary"><div><span>${t('Titles owned')}</span><strong>${number(titles.owned)} <small>/ ${number(titles.total)}</small></strong></div><span class="armory-track"><i style="width:${percent(titles.owned, titles.total)}%"></i></span></section><ul class="armory-title-cards">${titles.equipped.map(card).join('')}</ul>`;
}

function appearanceTab(p, images) {
  const tile = (label, item) =>
    `<li class="armory-gear-slot ${gradeClass(item.grade)}">${itemIcon(images, { ...item, enchant: 0, exceed: 0 })}<span class="armory-gear-text"><small>${esc(label)}</small><strong>${esc(item.name)}</strong>${item.grade ? `<span>${esc(gradeName(item.grade))}</span>` : ''}</span></li>`;
  const companions = p.gear.filter(g => companionSlots.includes(g.slot));
  return `<section class="armory-panel"><div class="section-heading"><h2>${t('Skins')} <span>${number(p.skins.length)}</span></h2></div>${p.skins.length ? `<ul class="armory-gear is-grid">${p.skins.map(s => tile(slotLabel(s.slot), s)).join('')}</ul>` : `<p class="armory-empty">${t('No skin is worn over the gear.')}</p>`}</section>${companions.length ? `<section class="armory-panel"><div class="section-heading"><h2>${t('Pet and wings')}</h2></div><ul class="armory-gear is-grid">${companions.map(g => tile(slotLabel(g.slot), g)).join('')}</ul></section>` : ''}`;
}

// ---------------------------------------------------------------- Upgrade

const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '±') + number(Math.abs(n));
const stateNames = () => ({
  big: t('Big upgrade'),
  some: t('Worth an upgrade'),
  small: t('Small upgrade'),
  even: t('On par'),
});
// A rolled stat's value: a share ("13%") or a number.
const rolledText = (value, inPercent) => number(value) + (inPercent ? '%' : '');
// What a piece of gear is behind the strongest by, in words.
function upgradeReasons(row, sample) {
  const g = row.item,
    d = g?.detail,
    ref = row.ref,
    gaps = row.gaps;
  if (!g)
    return [t('{n} of the {total} strongest wear something here', { n: number(ref.players), total: number(sample) })];
  return [
    gaps.itemLevel > 0
      ? t('Item level {mine} → {theirs}', { mine: number(d.itemLevel), theirs: number(ref.itemLevel) })
      : '',
    gaps.grade > 0 ? t('Grade {mine} → {theirs}', { mine: gradeName(g.grade), theirs: gradeName(ref.grade) }) : '',
    gaps.enchant > 0
      ? t('Enchantment +{mine} → +{theirs}', { mine: number(g.enchant), theirs: number(ref.enchant) })
      : '',
    gaps.exceed > 0 ? t('Exceed {mine} → {theirs}', { mine: number(g.exceed), theirs: number(ref.exceed) }) : '',
    gaps.stones > 0 ? tn(gaps.stones, '{n} empty stone slot', '{n} empty stone slots') : '',
    ...(gaps.rolled || []).map(r =>
      r.mine === null
        ? t('Rolled {stat}: none → {theirs}', { stat: r.name, theirs: rolledText(r.theirs, r.percent) })
        : t('Rolled {stat} {mine} → {theirs}', {
            stat: r.name,
            mine: rolledText(r.mine, r.percent),
            theirs: rolledText(r.theirs, r.percent),
          }),
    ),
  ].filter(Boolean);
}
// The item the strongest wear most in a slot: how many of them, how far they enchant it, where it comes from.
function popularItem(images, item, total) {
  const facts = [
    t('{p} % of the strongest', { p: percent(item.count, total) }),
    item.enchant ? t('usually +{n}', { n: number(item.enchant) }) : '',
    item.itemLevel ? t('item level {n}', { n: number(item.itemLevel) }) : '',
  ].filter(Boolean);
  return `<div class="upgrade-item ${gradeClass(item.grade)}">${itemIcon(images, { ...item, enchant: 0, exceed: 0 })}<span><strong>${esc(item.name)}</strong><small>${esc(facts.join(' · '))}</small></span></div>`;
}
function yourItem(images, g) {
  if (!g)
    return `<div class="upgrade-item is-empty"><span class="armory-icon is-empty" aria-hidden="true"></span><span><strong>${t('Empty')}</strong></span></div>`;
  const facts = [
    gradeName(g.grade),
    g.detail?.itemLevel ? t('item level {n}', { n: number(g.detail.itemLevel) }) : '',
  ].filter(Boolean);
  return `<div class="upgrade-item ${gradeClass(g.grade)}">${itemIcon(images, g)}<span><strong>${g.enchant ? `+${number(g.enchant)} ` : ''}${esc(g.name)}</strong><small>${esc(facts.join(' · '))}</small></span></div>`;
}
function upgradePick(images, row, index, sample) {
  const ref = row.ref,
    best = row.best,
    reasons = upgradeReasons(row, sample);
  const others = ref.popular
    .slice(1)
    .map(i => esc(i.name))
    .join(', ');
  const rolls = usualRolls(ref)
    .map(r => esc(`${r.name} ${rolledText(r.value, r.percent)}`))
    .join(', ');
  const target =
    best && !row.wearsBest
      ? popularItem(images, best, ref.items)
      : `<p class="upgrade-same">${row.wearsBest ? t('The strongest wear this item most too; take it further.') : t('No item stands out here.')}</p>`;
  return (
    `<li class="upgrade-pick is-${row.state}"><div class="upgrade-pick-head"><span class="upgrade-rank" aria-hidden="true">${index + 1}</span><h3>${esc(slotLabel(row.slot))}</h3><span class="upgrade-badge">${esc(stateNames()[row.state])}</span></div>` +
    `<div class="upgrade-compare"><div><small>${t('Yours')}</small>${yourItem(images, row.item)}</div><span class="upgrade-arrow" aria-hidden="true">→</span><div><small>${t('The strongest wear')}</small>${target}</div></div>` +
    `<ul class="upgrade-reasons">${reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` +
    `<dl class="upgrade-facts">${best?.sources?.length ? `<div><dt>${t('How to obtain')}</dt><dd>${best.sources.map(esc).join(', ')}</dd></div>` : ''}${rolls ? `<div><dt>${t('Stats they roll')}</dt><dd>${rolls}</dd></div>` : ''}${ref.stoneNames?.length ? `<div><dt>${t('Stones they engrave')}</dt><dd>${ref.stoneNames.map(s => esc(s.name)).join(', ')}</dd></div>` : ''}${others ? `<div><dt>${t('Also worn')}</dt><dd>${others}</dd></div>` : ''}</dl></li>`
  );
}
function upgradeRow(images, row, sample) {
  const best = row.best,
    reasons = upgradeReasons(row, sample);
  return (
    `<li class="upgrade-row is-${row.state}"><div class="upgrade-row-slot"><small>${esc(slotLabel(row.slot))}</small>${yourItem(images, row.item)}</div><div class="upgrade-row-best"><small>${t('Worn most by the strongest')}</small>${best ? popularItem(images, best, row.ref.items) : ''}</div>` +
    `<div class="upgrade-row-gap"><span class="upgrade-badge">${esc(stateNames()[row.state])}</span>${row.score > 0 ? `<small>${esc(reasons.join(' · '))}</small>` : ''}</div></li>`
  );
}

// The Upgrade tab: where the profile's gear falls furthest behind the strongest characters of its
// class the armory keeps, and what they wear there (upgrade.js); upgrade is the backend's
// comparison, null while it loads.
function upgradeTab(answer, p, images, upgrade) {
  const of = { class: p.class || t('this class') };
  if (!upgrade)
    return `<section class="armory-panel"><p class="armory-empty upgrade-wait"><span class="armory-spinner" aria-hidden="true"></span>${esc(t('Comparing with the strongest {class} characters the armory keeps…', of))}</p></section>`;
  if (upgrade.error)
    return `<section class="armory-panel"><p class="armory-empty">${t('The comparison did not load. Odyle tries again when you open this tab.')}</p></section>`;
  const plan = upgradePlan(p, upgrade);
  const note = `<p class="armory-note">${icon('info')}<span>${t("The strongest are the characters of the class with the most combat power whose gear Odyle knows, from every Global region: those anyone looked up and those Odyle's scout finds with PLAYNC's character search, which lists no combat power, so the list grows more complete over time. The comparison is worked out again every 10 minutes.")}</span></p>`;
  if (!plan)
    return `<section class="armory-panel"><div class="section-heading"><h2>${t('Upgrades')}</h2></div><p class="armory-empty">${esc(t('The armory keeps too few {class} characters to compare with yet ({n} of {least}). Every character anyone looks up joins the comparison.', { ...of, n: number(upgrade.players?.length || 0), least: upgradeLeast }))}</p></section>${note}`;
  const n = plan.sample,
    cp = plan.combatPower,
    il = plan.itemLevel;
  // Its place by combat power among the strongest (the backend leaves the profile out of them).
  const place = plan.below
    ? [t('Your place'), t('below them'), t('of the {n} strongest', { n: number(n) })]
    : [t('Your place'), `#${number(plan.place)}`, t('with the {n} strongest', { n: number(n) })];
  const metrics = [
    [
      t('Combat power'),
      number(cp.mine),
      t('their median {value} ({gap})', { value: number(cp.median), gap: signed(-cp.gap) }),
      true,
    ],
    [
      t('Item level'),
      number(il.mine),
      t('their median {value} ({gap})', { value: number(il.median), gap: signed(-il.gap) }),
    ],
    place,
  ];
  const player = q =>
    `<li><a href="${esc(link(profilePath(q)))}"><span class="armory-mini" aria-hidden="true">${esc(initials(q.name))}${picture(images, q.portrait)}</span><strong>${esc(q.name)}</strong><span>${esc([q.server, `${number(q.combatPower)} CP`].filter(Boolean).join(' · '))}</span></a></li>`;
  const intro =
    `<section class="armory-panel upgrade-intro"><div class="section-heading"><h2>${t('Upgrades')}</h2></div><p>${esc(t('Compared with the {n} strongest {class} characters the armory keeps, from every Global region, by combat power.', { ...of, n: number(n) }))}</p>` +
    `<dl class="armory-power">${metrics.map(([label, value, small, main]) => `<div class="${main ? 'is-main' : ''}"><dt>${esc(label)}</dt><dd><strong>${esc(value)}</strong><small>${esc(small)}</small></dd></div>`).join('')}</dl>` +
    `<details class="upgrade-players-box"><summary>${esc(t('The {n} strongest {class} characters', { ...of, n: number(upgrade.players.length) }))}</summary><ol class="upgrade-players">${upgrade.players.map(player).join('')}</ol><a class="text-button" href="${esc(link(topPath(p.class)))}">${esc(t('All top {class} players', of))} ${icon('arrow')}</a></details></section>`;
  const picks = `<section class="armory-panel"><div class="section-heading"><h2>${t('Best upgrades')}</h2></div>${plan.picks.length ? `<ol class="upgrade-picks">${plan.picks.map((row, i) => upgradePick(images, row, i, n)).join('')}</ol>` : `<p class="armory-empty">${esc(t('The gear is on par with the strongest {class} characters in every slot.', of))}</p>`}</section>`;
  const rows = plan.rows.length
    ? `<section class="armory-panel"><details class="upgrade-all"><summary><h2>${t('Every slot')} <span>${number(plan.rows.length)}</span></h2></summary><ul class="upgrade-rows">${plan.rows.map(row => upgradeRow(images, row, n)).join('')}</ul></details></section>`
    : '';
  const sets = plan.sets.length
    ? `<section class="armory-panel"><div class="section-heading"><h2>${t('Arcana and sets')}</h2></div><ul class="upgrade-sets">${plan.sets.map(s => `<li class="${s.mine ? 'is-mine' : ''}"><strong>${esc(s.name)}</strong><span>${esc(t('{n} of the {total} strongest, usually {pieces} pieces', { n: number(s.players), total: number(n), pieces: number(s.pieces) }))}</span><small>${s.mine ? esc(t('Yours: {n} pieces', { n: number(s.mine) })) : t('Not worn')}</small></li>`).join('')}</ul></section>`
    : '';
  const boards = plan.boards.length
    ? `<section class="armory-panel"><div class="section-heading"><h2>${t('Daevanion')}</h2></div><ul class="upgrade-boards">${plan.boards.map(b => `<li class="${b.gap > 0 ? 'is-behind' : ''}"><span><strong>${esc(b.name)}</strong><small>${esc(t('{mine} of {total} nodes · the strongest {theirs}', { mine: number(b.mine), total: number(b.total), theirs: number(b.open) }))}</small></span><span class="armory-track upgrade-track" role="img" aria-label="${esc(t('{mine} of {total} nodes · the strongest {theirs}', { mine: number(b.mine), total: number(b.total), theirs: number(b.open) }))}"><i style="width:${percent(b.mine, b.total)}%"></i><b style="left:${percent(b.open, b.total)}%"></b></span></li>`).join('')}</ul><p class="armory-legend"><span class="is-open"></span>${t('Yours')}<span class="is-mark"></span>${t('Median of the strongest')}</p></section>`
    : '';
  const skills = plan.skills.length
    ? `<section class="armory-panel"><div class="section-heading"><h2>${t('On the skill bars of the strongest')}</h2></div><ul class="upgrade-skills">${plan.skills.map(s => `<li class="${s.equipped ? 'is-equipped' : s.acquired ? '' : 'is-locked'}"><span class="armory-icon is-skill${imageUrl(images, s.icon) ? '' : ' is-empty'}" aria-hidden="true">${picture(images, s.icon)}</span><span><strong>${esc(s.name)}</strong><small>${esc([t('{n} of the {total} strongest, level {level}', { n: number(s.players), total: number(n), level: number(s.level) }), s.equipped ? t('on your bar, level {level}', { level: number(s.mine) }) : s.acquired ? t('learned, not on your bar') : t('Not learned yet')].join(' · '))}</small></span></li>`).join('')}</ul></section>`
    : '';
  return intro + picks + rows + sets + boards + skills + note;
}

// The tabs a profile has: gear and stats always, the others once the kept copy holds them; the
// upgrades once it lists gear and a class to compare with.
export function profileTabs(p) {
  return [
    ['', t('Gear & stats')],
    ['skills', t('Skills'), p.skills?.length],
    ['daevanion', t('Daevanion'), p.boards?.length],
    ['titles', t('Titles'), p.titles?.total],
    ['appearance', t('Appearance'), p.skins?.length || p.gear?.some(g => companionSlots.includes(g.slot))],
    ['upgrade', t('Upgrade'), p.class && p.gear?.some(g => !companionSlots.includes(g.slot))],
  ].filter(([key, , has]) => key === '' || has);
}

// A profile page: the kept profile (or the wait for it, or what the running lookup read so
// far: partial) and where its lookup stands. view names the tab, the Daevanion board shown,
// where the backend serves images and, for the Upgrade tab, the comparison with the strongest
// of the class (null while it loads, { error } when it did not).
export function armoryProfile(answer, now, refreshable, bookmarked = false, view = {}) {
  const p = answer.profile,
    images = view.images || '',
    loading = Boolean(answer.partial);
  const status = lookupStatus(answer, now, refreshable);
  const back = `<a class="text-button armory-back" href="${link('/armory')}">${icon('arrow')} ${t('Search another character')}</a>`;
  if (!p)
    return `<main class="dashboard armory"><div class="heading"><div><h1>${esc(t('A character on {server}', { server: answer.server }))}</h1><p>${t('This character is not in the armory yet. Odyle fetches it from PLAYNC, one character at a time; this page fills in by itself.')}</p></div></div>${status}${back}</main>`;
  const profile = {
    ...p,
    stats: p.stats || [],
    gear: p.gear || [],
    skills: p.skills || [],
    skins: p.skins || [],
    boards: p.boards || [],
    titles: { owned: 0, total: 0, equipped: [], ...p.titles },
  };
  const tabs = profileTabs(profile),
    tab = tabs.some(([key]) => key === view.tab) ? view.tab : '';
  const race = /asmodian/i.test(profile.race) ? 'is-asmodian' : /elyos/i.test(profile.race) ? 'is-elyos' : '';
  const boardsOpen = profile.boards.reduce((n, b) => n + b.open, 0),
    boardsTotal = profile.boards.reduce((n, b) => n + b.total, 0);
  const metrics = [
    [t('Combat power'), number(profile.combatPower), 'CP', true, powerChange(answer.history)],
    [t('Item level'), number(profile.itemLevel), t('of the equipped gear')],
    boardsTotal
      ? [
          t('Daevanion'),
          `${percent(boardsOpen, boardsTotal)} %`,
          t('{open} of {total} nodes', { open: number(boardsOpen), total: number(boardsTotal) }),
        ]
      : null,
    profile.titles.total
      ? [t('Titles'), number(profile.titles.owned), t('of {n}', { n: number(profile.titles.total) })]
      : null,
    profile.skills.length
      ? [
          t('Skills'),
          number(profile.skills.filter(s => s.acquired).length),
          t('of {n} learned', { n: number(profile.skills.length) }),
        ]
      : null,
  ].filter(Boolean);
  const hero = `<section class="armory-hero ${race}"><div class="armory-portrait" aria-hidden="true"><span>${esc(initials(profile.name))}</span>${picture(images, profile.portrait)}</div>
<div class="armory-identity"><p class="armory-eyebrow">${esc([profile.server || answer.server, regionLabel(answer.region)].filter(Boolean).join(' · '))}</p><h1>${esc(profile.name)}</h1>${profile.title ? `<p class="armory-title ${gradeClass(profile.titleGrade)}">${esc(profile.title)}</p>` : ''}<p class="armory-tags"><span>${esc(t('Level {level}', { level: profile.level }))}</span>${profile.class ? `<span>${classBadge(images, answer.classIcon, profile.class)}${esc(profile.class)}</span>` : ''}${[
    profile.race,
    profile.gender,
  ]
    .filter(Boolean)
    .map(s => `<span>${esc(s)}</span>`)
    .join(
      '',
    )}${profile.legion ? `<span class="armory-legion" title="${esc(t('Legion'))}">${icon('people')}${esc(profile.legion)}</span>` : ''}</p></div>
<div class="armory-hero-actions"><button class="button secondary armory-bookmark" data-action="armory-bookmark" aria-pressed="${bookmarked}" title="${esc(bookmarked ? t('Remove {name} from bookmarks', { name: profile.name }) : t('Bookmark {name} in this browser', { name: profile.name }))}">${bookmarked ? '★ ' + t('Bookmarked') : '☆ ' + t('Bookmark')}</button><a class="button secondary armory-card-link" href="${esc(link(profilePath(answer) + '/card'))}">${icon('star')} ${t('Player card')}</a><a class="button secondary" href="${esc(playncPage(answer))}" target="_blank" rel="noopener noreferrer">${t('Official page')} ↗</a></div>
<dl class="armory-power">${metrics.map(([label, value, small, main, change]) => `<div class="${main ? 'is-main' : ''}"><dt>${esc(label)}</dt><dd><strong>${esc(value)}</strong><small>${esc(small)}</small></dd>${change ? `<dd class="armory-power-change">${esc(change)}</dd>` : ''}</div>`).join('')}</dl></section>`;
  const nav = `<nav class="armory-tabs" aria-label="${esc(t('Profile sections'))}">${tabs.map(([key, label]) => `<a href="${esc(link(profilePath(answer, key)))}"${key === tab ? ' aria-current="page"' : ''}>${esc(label)}</a>`).join('')}</nav>`;
  const content =
    tab === 'skills'
      ? skillsTab(profile, images)
      : tab === 'daevanion'
        ? daevanionTab(profile, images, view.board, loading)
        : tab === 'titles'
          ? titlesTab(profile)
          : tab === 'appearance'
            ? appearanceTab(profile, images)
            : tab === 'upgrade'
              ? upgradeTab(answer, profile, images, view.upgrade)
              : progressPanel(answer.history) + gearTab(profile, images, loading);
  return `<main class="dashboard armory armory-profile">${hero}${status}${nav}<div class="armory-tab">${content}</div>${back}</main>`;
}
