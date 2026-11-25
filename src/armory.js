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
import { armoryRoute, profilePath, topPath, aiPath, imageUrl, classBadge } from './armorylinks.js';
import { upgradePlan, upgradeLeast, planParts, shareOf } from './upgrade.js';
import {
  tileMeters,
  tileLabel,
  tipFacts,
  gearSummaryStrip,
  statSourcesPanel,
  boardTotalsPanel,
  skillBoostPanel,
} from './armorydetail.js';
import { progressPanel, powerChange } from './armoryhistory.js';
import { boardNodes, boardSummary } from './armoryboard.js';

export const regionNames = () => ({
  GLOBAL_NA: t('North America East'),
  GLOBAL_NAW: t('North America West'),
  GLOBAL_EU: t('Europe'),
  GLOBAL_SA: t('South America'),
  GLOBAL_ASIA: t('Asia'),
});
// PLAYNC's search regions and the regions Odyle names them by.
const searchRegions = { nae: 'GLOBAL_NA', naw: 'GLOBAL_NAW', eu: 'GLOBAL_EU', la: 'GLOBAL_SA', as: 'GLOBAL_ASIA' };
export const regionLabel = region => regionNames()[searchRegions[region]] || '';
// The character's page on PLAYNC's own site.
export const playncPage = answer =>
  `https://aion2.plaync.com/en-us/characters/${encodeURIComponent(answer.serverId)}/${encodeURIComponent(answer.characterId)}?region=${encodeURIComponent(answer.region)}`;

const percent = (part, whole) => (whole ? Math.min(100, Math.round((part / whole) * 100)) : 0);

export const picture = (base, name, kind = '') => {
  const src = imageUrl(base, name);
  return src
    ? `<img class="armory-img ${kind}" src="${esc(src)}" alt="" loading="lazy" decoding="async" draggable="false">`
    : '';
};
export const initials = name => [...String(name || '?')].slice(0, 2).join('').toUpperCase();

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

// The servers of a region for the search's server list: any server first, then each race's, the
// chosen one selected.
export function serverOptions(region, chosen = '') {
  if (!region) return '';
  const group = (label, list = []) =>
    `<optgroup label="${esc(label)}">${list.map(s => `<option ${s === chosen ? 'selected' : ''}>${esc(s)}</option>`).join('')}</optgroup>`;
  return `<option value="" ${chosen ? '' : 'selected'}>${esc(t('Any server'))}</option>${group(t('Elyos'), region.elyos)}${group(t('Asmodians'), region.asmodian)}`;
}

// The characters Odyle knows that the search box suggests while its text is typed
// (backend/odyle/armoryfind.go), each a link to its profile; active is the one the arrow keys
// moved to (-1 for none).
export function suggestionList(results, images = '', active = -1) {
  return results
    .map(
      (c, i) =>
        `<li role="option" id="armory-suggestion-${i}" aria-selected="${i === active}"${i === active ? ' class="is-active"' : ''}><a href="${esc(link(profilePath(c)))}" tabindex="-1"><span class="armory-mini" aria-hidden="true">${esc(initials(c.name))}${picture(images, c.portrait)}</span><span class="armory-suggest-who"><strong>${esc(c.name)}</strong><small>${classBadge(images, c.classIcon, c.class)}${esc([c.level ? t('Level {level}', { level: c.level }) : '', c.class, c.server, regionLabel(c.region)].filter(Boolean).join(' · '))}</small></span>${c.combatPower ? `<span class="armory-suggest-power">${esc(number(c.combatPower))} CP</span>` : ''}</a></li>`,
    )
    .join('');
}

// One character a search found: its name, level, class, faction and server, and its combat power
// and portrait when Odyle knows them.
function hitRow(hit, bookmarks, images) {
  const race = hit.race === 1 ? t('Elyos') : hit.race === 2 ? t('Asmodians') : '';
  const facts = [
    t('Level {level}', { level: hit.level }),
    hit.class ? `${classBadge(images, hit.classIcon, hit.class)}${esc(hit.class)}` : '',
    esc(race),
    esc(hit.server),
  ]
    .filter(Boolean)
    .join(' · ');
  return `<li><a href="${esc(link(profilePath(hit)))}"><span class="armory-mini" aria-hidden="true">${esc(initials(hit.name))}${picture(images, hit.portrait)}</span><strong>${esc(hit.name)}${isBookmarked(bookmarks, hit) ? ` <span class="armory-star" title="${esc(t('Bookmarked'))}">★</span>` : ''}</strong><span>${facts}</span>${hit.combatPower ? `<b class="armory-hit-power">${esc(number(hit.combatPower))} CP</b>` : ''}${icon('arrow')}</a></li>`;
}

// The search form, with the region and server last searched and the text of the search shown;
// ai is whether the signed-in account may ask the AI (app/armoryai.js).
export function armorySearch(
  regions,
  chosen,
  results = null,
  searching = false,
  bookmarks = [],
  now = Date.now(),
  images = '',
  ai = false,
) {
  const region =
    regions.find(r => r.region === chosen.region) || regions.find(r => r.region === 'GLOBAL_EU') || regions[0];
  const names = regionNames();
  const list =
    results === null
      ? ''
      : results.length
        ? `<ul class="armory-results">${results.map(hit => hitRow(hit, bookmarks, images)).join('')}</ul>`
        : `<p class="armory-empty">${chosen.server ? t('PLAYNC lists no character of that name on this server.') : t('PLAYNC lists no character with that name in this region.')}</p>`;
  const askAi = ai
    ? `<a class="button secondary armory-ai-link" href="${esc(link(aiPath))}">${icon('spark')} ${t('Ask the AI')}</a>`
    : '';
  return `<main class="dashboard armory"><div class="heading"><div><h1>${t('Look up a character')}</h1><p>${t("Everything PLAYNC's official character pages show of any AION 2 Global character: gear with each item's stats and stones, combat power, stats, skills, Daevanion boards, titles and skins. No sign-in needed.")}</p></div><div class="heading-actions">${askAi}<a class="button secondary" href="${esc(link(topPath()))}">${icon('trophy')} ${t('Top players by class')}</a></div></div>
${bookmarkList(bookmarks, now, images)}<form id="armory-form" class="armory-form armory-find" role="search"><label class="armory-query">${t('Character')}<span class="armory-combo"><input name="name" type="search" required minlength="2" maxlength="40" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="armory-suggestions" placeholder="${esc(t('A name or part of it, e.g. Kai or Kai Lumiel'))}" value="${esc(chosen.name || '')}"><ul id="armory-suggestions" class="armory-suggestions" role="listbox" aria-label="${esc(t('Characters Odyle knows'))}" hidden></ul></span></label>
<label>${t('Region')}<select name="region" data-armory-region="1">${regions.map(r => `<option value="${esc(r.region)}" ${r === region ? 'selected' : ''}>${esc(names[r.region] || r.region)}</option>`).join('')}</select></label>
<label>${t('Server')}<select name="server">${serverOptions(region, chosen.server)}</select></label><button class="button primary" type="submit" ${searching ? 'disabled' : ''}>${searching ? t('Searching…') : t('Search')}</button></form>
<p class="armory-hint">${t('Part of a name is enough and the server is optional: Odyle then searches every server of the region. Characters Odyle already knows are suggested as you type, from every region.')}</p>
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
export { armourSlots, accessorySlots, arcanaSlots, companionSlots };
const skillGroups = () => [
  ['Active', t('Active skills')],
  ['Passive', t('Passive skills')],
  ['Dp', t('Stigma skills')],
];
const titleCategories = () => ({ Attack: t('Offensive'), Defense: t('Defensive'), Etc: t('Other') });

// An icon in its grade's frame, with the enchantment (+15) and exceed level on it.
export function itemIcon(images, item, size = '') {
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
export function itemTip(images, g, loading) {
  const d = g.detail,
    names = gradeNames();
  const kind = d?.category ? `${names[g.grade] || g.grade} · ${d.category}` : names[g.grade] || g.grade || '';
  const facts = d
    ? [
        [t('Item level'), number(d.itemLevel)],
        d.maxEnchant ? [t('Enchantment'), `+${number(g.enchant)} / ${number(d.maxEnchant)}`] : null,
        d.maxExceed ? [t('Exceed'), `${number(g.exceed)} / ${number(d.maxExceed)}`] : null,
        d.equipLevel ? [t('Equip level'), number(d.equipLevel)] : null,
        ...tipFacts(g),
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
      ? d.itemLevel
        ? t('item level {n}', { n: number(d.itemLevel) })
        : ''
      : [gradeName(g.grade), g.exceed ? t('exceed {n}', { n: g.exceed }) : ''].filter(Boolean).join(' · ');
  // Weapons and arcana say what they are (Orb, Chalice); other slots' types repeat the slot.
  const kind = d?.category && /^(MainHand|SubHand|Arcana\d)$/.test(slot) ? ` · ${esc(d.category)}` : '';
  return `<li class="armory-gear-slot ${gradeClass(g.grade)}" tabindex="0" aria-label="${esc([`${label}: ${g.enchant ? `+${g.enchant} ` : ''}${g.name}`, tileLabel(g)].filter(Boolean).join(', '))}">${itemIcon(images, g)}<span class="armory-gear-text"><small>${esc(label)}${kind}</small><strong>${esc(g.name)}</strong>${extra ? `<span>${esc(extra)}</span>` : ''}${tileMeters(g)}</span>${itemTip(images, g, loading)}</li>`;
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
  return `<div class="armory-loadout"><section class="armory-panel armory-doll">${gearSummaryStrip(p, slotLabel)}<div class="armory-doll-columns">${column(t('Weapons and armour'), armourSlots)}${column(t('Accessories'), [...accessorySlots, ...others])}</div>${arcana}<div class="armory-doll-row"><h3>${t('Pet and wings')}</h3><ul class="armory-gear is-row">${companionSlots.map(tile).join('')}</ul></div></section>${statsPanel(p)}</div>${statSourcesPanel(p, slotLabel)}`;
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
  return `${skillBoostPanel(p)}<p class="armory-legend"><span class="is-equipped"></span>${t('On the skill bar')}<span class="is-locked"></span>${t('Not learned yet')}</p>${groups.map(([title, list]) => `<section class="armory-panel"><div class="section-heading"><h2>${esc(title)} <span>${number(list.filter(s => s.acquired).length)} / ${number(list.length)}</span></h2></div><ul class="armory-skills">${list.map(tile).join('')}</ul></section>`).join('')}`;
}

// A Daevanion value as the nodes show it: "+3", "+1.5%".
const nodeValue = s => `+${number(Math.round(s.value * 10) / 10)}${s.percent ? '%' : ''}`;
// The letters a stat shows on its node and in the board's list ("PvE" above "ATK").
const nodeCode = (stats, kind = 'armory-node-code') =>
  `<span class="${kind}">${stats[0]?.prefix ? `<small>${esc(stats[0].prefix)}</small>` : ''}<b>${esc(stats.map(s => s.code).join('/'))}</b></span>`;

function daevanionTab(p, images, chosen, loading) {
  const board = p.boards.find(b => String(b.id) === String(chosen)) || p.boards.find(b => b.open > 0) || p.boards[0];
  const pick = b =>
    `<button type="button" class="armory-board-pick${b === board ? ' is-active' : ''}" data-armory-board="${esc(b.id)}" aria-pressed="${b === board}">${picture(images, b.icon, 'armory-board-art')}<span><strong>${esc(b.name)}</strong><small>${number(b.open)} / ${number(b.total)}</small></span><span class="armory-track"><i style="width:${percent(b.open, b.total)}%"></i></span></button>`;
  // The board's nodes from its first row and column on: PLAYNC's grid has empty edges.
  const nodes = boardNodes(board, p.skills),
    top = Math.min(...nodes.map(n => n.row)),
    left = Math.min(...nodes.map(n => n.col));
  const rows = nodes.length ? Math.max(...nodes.map(n => n.row)) - top + 1 : 1,
    cols = nodes.length ? Math.max(...nodes.map(n => n.col)) - left + 1 : 1;
  const boosts = skillBoosts(p).boards;
  const skillArt = (skill, kind = '') => {
    const art = picture(images, skill.of?.icon);
    return `<span class="armory-icon is-skill${kind}${art ? '' : ' is-empty'}" aria-hidden="true">${art}</span>`;
  };
  // Each node shows what it gives: a skill node the skill's icon, a stat node its letters and value.
  // Its card, on hover or focus, says it in full.
  const face = n =>
    n.skill
      ? `<span class="armory-node-face" aria-hidden="true">${picture(images, n.skill.of?.icon) || `<b>${esc(initials(n.skill.name))}</b>`}<em>+${number(n.skill.levels)}</em></span>`
      : n.stats.length
        ? n.stats.length > 1
          ? `<span class="armory-node-face is-pair" aria-hidden="true">${n.stats[0].prefix ? `<small>${esc(n.stats[0].prefix)}</small>` : ''}${n.stats.map(s => `<span><b>${esc(s.code)}</b> <em>${nodeValue(s)}</em></span>`).join('')}</span>`
          : `<span class="armory-node-face" aria-hidden="true">${nodeCode(n.stats)}<em>${nodeValue(n.stats[0])}</em></span>`
        : '<span class="armory-node-face" aria-hidden="true"></span>';
  const what = n => (n.kind === 'start' ? t('Start') : n.effects.join(', ') || n.name);
  const tip = n => {
    const state = n.open ? t('Open') : t('Closed'),
      kind = n.kind === 'start' ? board.name : [gradeName(n.grade), state].filter(Boolean).join(' · ');
    const effectLines =
      n.effects.length > 1 ? `<ul class="armory-lines">${n.effects.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : '';
    const skill = n.skill?.of;
    const facts = skill
      ? `<dl class="armory-facts"><div><dt>${t('Skill level')}</dt><dd>${number(skill.level)}</dd></div>${boosts.get(skill.name) ? `<div><dt>${t('From Daevanion')}</dt><dd>+${number(boosts.get(skill.name))}</dd></div>` : ''}</dl><p class="armory-node-skill">${esc(!skill.acquired ? t('Not learned yet') : skill.equipped ? t('On the skill bar') : t('Learned'))}</p>`
      : '';
    return `<div class="armory-tip armory-node-tip" role="tooltip"><header class="${gradeClass(n.grade)}">${n.skill ? skillArt(n.skill, ' is-small') : n.stats.length ? nodeCode(n.stats, 'armory-node-code is-chip') : ''}<div><strong>${esc(n.effects.length > 1 ? n.stats.map(s => s.name).join(', ') || what(n) : what(n))}</strong><small>${esc(kind)}</small></div></header>${effectLines}${facts}</div>`;
  };
  // The card opens beside the node, away from the board's nearest edge.
  const side = n => {
    const col = n.col - left + 1,
      row = n.row - top + 1;
    return `${col <= cols / 3 ? ' is-west' : col > cols - cols / 3 ? ' is-east' : ''}${row > rows - rows / 3 ? ' is-south' : ''}`;
  };
  // The arrow keys move between nodes (app/armory.js), so the board is one stop of the Tab key.
  const node = (n, i) =>
    `<div class="armory-node ${gradeClass(n.grade)} is-${esc(n.kind)}${n.open ? ' is-open' : ''}${side(n)}" role="listitem" tabindex="${i ? -1 : 0}" style="grid-row:${n.row - top + 1};grid-column:${n.col - left + 1}" aria-label="${esc(`${what(n)}, ${n.open ? t('open') : t('closed')}`)}">${face(n)}${tip(n)}</div>`;
  const grid = nodes.length
    ? `<div class="armory-board-scroll"><div class="armory-board-grid" style="--cols:${cols};grid-template-columns:repeat(${cols},minmax(0,1fr));grid-template-rows:repeat(${rows},auto)" role="list" aria-label="${esc(t('{name}: {open} of {total} nodes open', { name: board.name, open: number(board.open), total: number(board.total) }))}">${nodes.map(node).join('')}</div></div>`
    : `<p class="armory-empty">${!board.open ? t('No node of this board is open yet.') : loading ? t('Odyle is reading this board from PLAYNC…') : t("PLAYNC did not list this board's nodes.")}</p>`;
  // What the board gives: each stat and skill, how many of its nodes are open and what they add.
  const summary = boardSummary(nodes);
  const count = r =>
    `<small>${esc(tn(r.total, '{open} of {n} node', '{open} of {n} nodes', { open: number(r.open) }))}</small>`;
  const statRows = summary.stats.map(
    r =>
      `<li class="${r.open ? '' : 'is-none'}">${nodeCode([r], 'armory-node-code is-chip')}<span>${esc(r.name)}${r.open ? ` <b>${nodeValue(r)}</b>` : ''}${count(r)}</span></li>`,
  );
  const skillRows = summary.skills.map(
    r =>
      `<li class="${r.open ? '' : 'is-none'}">${skillArt(r, ' is-small')}<span>${esc(r.name)}${r.open ? ` <b>+${number(r.levels)}</b>` : ''}${count(r)}</span></li>`,
  );
  const list = (title, items) =>
    items.length ? `<h4>${title}</h4><ul class="armory-board-list">${items.join('')}</ul>` : '';
  // Without nodes (kept before they were read), the effects PLAYNC adds up for the open ones.
  const effects = (title, items) =>
    items?.length ? `<h4>${title}</h4><ul>${items.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : '';
  const aside = nodes.length
    ? list(t('Stat effect'), statRows) + list(t('Skill effect'), skillRows)
    : effects(t('Stat effect'), board.statEffects) + effects(t('Skill effect'), board.skillEffects);
  const open = p.boards.reduce((n, b) => n + b.open, 0),
    total = p.boards.reduce((n, b) => n + b.total, 0);
  return `<section class="armory-panel"><div class="section-heading"><h2>${t('Daevanion')} <span>${number(open)} / ${number(total)}</span></h2></div><div class="armory-board-picks">${p.boards.map(pick).join('')}</div></section>
<section class="armory-panel armory-board"><div class="armory-board-view"><div><h3>${esc(board.name)} <span>${number(board.open)} / ${number(board.total)} · ${percent(board.open, board.total)} %</span></h3>${grid}<p class="armory-legend"><span class="is-open"></span>${t('Open')}<span></span>${t('Closed')}</p></div><aside class="armory-board-effects"><h3>${t('Board effect')}</h3>${aside || `<p class="armory-empty">${t('No effect yet.')}</p>`}</aside></div></section>${boardTotalsPanel(p)}`;
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
// A value: a share ("13%", to a tenth) or a number (whole).
const rolledText = (value, inPercent) =>
  inPercent ? number(Math.round(value * 10) / 10) + '%' : number(Math.round(value));
// A stat with what it gains ("Attack +120").
const gainText = s => `${s.name} +${rolledText(s.value, s.percent)}`;
const shareText = share => t('{p} % of them', { p: Math.round(share * 100) });
// A place of the gear as the plan names it: the slot, with how many places a step covers.
function stepSlot(step) {
  if (step.kind === 'skill' || step.kind === 'board') return '';
  const label = slotLabel(step.slot);
  return step.entries.length > 1 ? `${label} · ${number(step.entries.length)}×` : label;
}
// An item as the plan shows it: its icon in its grade's frame, its name and a line of facts.
function planItem(images, item, facts) {
  if (!item)
    return `<div class="upgrade-item is-empty"><span class="armory-icon is-empty" aria-hidden="true"></span><span><strong>${t('Empty')}</strong></span></div>`;
  return `<div class="upgrade-item ${gradeClass(item.grade)}">${itemIcon(images, item)}<span><strong>${item.enchant ? `+${number(item.enchant)} ` : ''}${esc(item.name)}</strong>${facts.length ? `<small>${esc(facts.filter(Boolean).join(' · '))}</small>` : ''}</span></div>`;
}
// The character's own item: its grade and item level.
const yourItem = (images, g) =>
  planItem(
    images,
    g,
    g ? [gradeName(g.grade), g.detail?.itemLevel ? t('item level {n}', { n: number(g.detail.itemLevel) }) : ''] : [],
  );
// An item the group wears: how many of them, how far they enchant it, its item level.
const theirItem = (images, item, share) =>
  planItem(images, { ...item, enchant: 0, exceed: 0 }, [
    share ? shareText(share) : '',
    item.enchant ? t('usually +{n}', { n: number(item.enchant) }) : '',
    item.itemLevel ? t('item level {n}', { n: number(item.itemLevel) }) : '',
  ]);
// The item worn and the one they wear, one above the other (in narrow cards).
const smallCompare = (images, item, target, share, label) =>
  `<div class="upgrade-compare is-small"><div><small>${t('Yours')}</small>${yourItem(images, item)}</div><div><small>${esc(label)}</small>${target ? theirItem(images, target, share) : ''}</div></div>`;
// Enchantment or exceed levels as a meter: those the item has, those to go, and the item's limit.
function levelMeter(from, to, max, label) {
  const top = Math.max(max, to, 1);
  const cells = Array.from({ length: top }, (_, i) =>
    i < from ? '<i class="is-have"></i>' : i < to ? '<i class="is-to"></i>' : '<i></i>',
  ).join('');
  return `<span class="upgrade-meter" role="img" aria-label="${esc(label)}">${cells}</span>`;
}

// Whether a step's places get different items (the arcana, each of its own kind).
const manyTargets = step =>
  new Set(step.entries.map(e => e.action.target && e.action.target.name + '|' + e.action.target.grade)).size > 1;
// What a step says to do, in a few words.
function stepTitle(step) {
  const a = step.entries[0].action,
    n = step.entries.length;
  switch (step.kind) {
    case 'fill':
      return manyTargets(step)
        ? tn(n, 'Fill {n} empty place', 'Fill {n} empty places')
        : t('Fill it: {item}', { item: a.target.name });
    case 'replace':
      return manyTargets(step)
        ? tn(n, 'Replace {n} item', 'Replace {n} items')
        : t('Replace with {item}', { item: a.target.name });
    case 'enchant':
      return step.entries.length > 1
        ? tn(step.entries.length, 'Enchant {n} item further', 'Enchant {n} items further')
        : t('Enchant +{from} → +{to}', { from: number(a.from), to: number(a.to) });
    case 'exceed':
      return step.entries.length > 1
        ? tn(step.entries.length, 'Exceed {n} item', 'Exceed {n} items')
        : t('Exceed {from} → {to}', { from: number(a.from), to: number(a.to) });
    case 'stones': {
      const empty = step.entries.reduce((sum, e) => sum + e.action.empty, 0);
      return tn(empty, 'Engrave {n} empty stone slot', 'Engrave {n} empty stone slots');
    }
    case 'stoneGrade':
      return t('Better stones');
    case 'reroll':
      return t('Reroll the soul binding');
    case 'goal':
      return manyTargets(step)
        ? tn(n, 'Later: {n} better item', 'Later: {n} better items')
        : t('Later: {item}', { item: a.target.name });
    case 'skill':
      return t('Put {skill} on your skill bar', { skill: a.skill.name });
    case 'board':
      return t('Open more of {board}', { board: a.board.name });
  }
  return '';
}
// What a step is about, shown under its title: the item worn and the one to get, a meter, facts.
function stepBody(images, step) {
  const first = step.entries[0],
    a = first.action,
    facts = [];
  const where = e => (step.entries.length > 1 ? `${slotLabel(e.row.item?.slot || e.row.slot)}: ` : '');
  let visual = '';
  switch (step.kind) {
    case 'fill':
    case 'replace':
    case 'goal': {
      const theirs = step.kind === 'goal' ? t('The best of them wear') : t('They wear');
      // Places that get different items: each place with its own.
      if (manyTargets(step)) {
        visual = `<ul class="upgrade-swaps">${step.entries.map(e => `<li><h5>${esc(slotLabel(e.row.item?.slot || e.row.slot))}</h5>${smallCompare(images, e.row.item, e.action.target, e.action.share, theirs)}</li>`).join('')}</ul>`;
        break;
      }
      visual = `<div class="upgrade-compare"><div><small>${t('Yours')}</small>${yourItem(images, first.row.item)}</div><span class="upgrade-arrow" aria-hidden="true">→</span><div><small>${theirs}</small>${theirItem(images, a.target, a.share)}</div></div>`;
      if (a.itemLevel?.from && a.itemLevel.to > a.itemLevel.from)
        facts.push(
          t('Item level {mine} → {theirs} ({gain})', {
            mine: number(a.itemLevel.from),
            theirs: number(a.itemLevel.to),
            gain: signed(a.itemLevel.to - a.itemLevel.from),
          }),
        );
      if (a.grade > 0)
        facts.push(
          t('Grade {mine} → {theirs}', { mine: gradeName(first.row.item.grade), theirs: gradeName(a.target.grade) }),
        );
      if (a.stats?.length) facts.push(t('As they have it: {stats}', { stats: a.stats.map(gainText).join(', ') }));
      if (step.kind !== 'goal' && a.target.maxEnchant && a.target.enchant)
        facts.push(
          t('They enchant it to +{n} of +{max}', { n: number(a.target.enchant), max: number(a.target.maxEnchant) }),
        );
      if (a.target.sources?.length) facts.push(`${t('How to obtain')}: ${a.target.sources.join(', ')}`);
      break;
    }
    case 'enchant':
    case 'exceed': {
      const label = e =>
        step.kind === 'enchant'
          ? t('Enchantment +{from} → +{to} of +{max}', {
              from: number(e.action.from),
              to: number(e.action.to),
              max: number(e.action.max || e.action.to),
            })
          : t('Exceed {from} → {to} of {max}', {
              from: number(e.action.from),
              to: number(e.action.to),
              max: number(e.action.max || e.action.to),
            });
      visual = `<ul class="upgrade-meters">${step.entries
        .map(
          e =>
            `<li><span>${esc(slotLabel(e.row.item.slot))}</span>${levelMeter(e.action.from, e.action.to, e.action.max, label(e))}<b>${step.kind === 'enchant' ? `+${number(e.action.from)} → +${number(e.action.to)}` : `${number(e.action.from)} → ${number(e.action.to)}`}</b></li>`,
        )
        .join('')}</ul>`;
      if (step.kind === 'enchant' && step.entries.length === 1 && a.stats?.length)
        facts.push(t('About {stats}', { stats: a.stats.map(gainText).join(', ') }));
      if (step.kind === 'exceed' && a.after) facts.push(t('Once it is at its enchantment limit'));
      break;
    }
    case 'stones':
      if (step.entries.length > 1)
        facts.push(...step.entries.map(e => `${where(e)}${tn(e.action.empty, '{n} empty', '{n} empty')}`));
      if (a.names?.length) facts.push(t('They engrave: {stones}', { stones: a.names.join(', ') }));
      break;
    case 'stoneGrade':
      facts.push(
        ...step.entries.map(
          e =>
            `${where(e)}${tn(e.action.count, '{n} stone below their usual {grade}', '{n} stones below their usual {grade}', { grade: gradeName(e.action.grade) })}`,
        ),
      );
      break;
    case 'reroll':
      for (const e of step.entries)
        for (const r of e.action.stats)
          facts.push(
            `${where(e)}${
              r.mine === null
                ? t('{stat}: none → {theirs} ({share})', {
                    stat: r.name,
                    theirs: rolledText(r.theirs, r.percent),
                    share: shareText(r.share),
                  })
                : t('{stat}: {mine} → {theirs} ({share})', {
                    stat: r.name,
                    mine: rolledText(r.mine, r.percent),
                    theirs: rolledText(r.theirs, r.percent),
                    share: shareText(r.share),
                  })
            }`,
          );
      break;
    case 'skill':
      facts.push(
        t('{share} keep it on their bar, level {level}; yours is level {mine}', {
          share: shareText(a.share),
          level: number(a.skill.level),
          mine: number(a.skill.mine),
        }),
      );
      break;
    case 'board':
      visual = `<span class="armory-track upgrade-track" role="img" aria-label="${esc(t('{mine} of {total} nodes · they open {theirs}', { mine: number(a.board.mine), total: number(a.board.total), theirs: number(a.board.open) }))}"><i style="width:${percent(a.board.mine, a.board.total)}%"></i><b style="left:${percent(a.board.open, a.board.total)}%"></b></span>`;
      facts.push(
        t('{mine} of {total} nodes · they open {theirs}', {
          mine: number(a.board.mine),
          total: number(a.board.total),
          theirs: number(a.board.open),
        }),
      );
      break;
  }
  return `${visual}${facts.length ? `<ul class="upgrade-reasons">${facts.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}`;
}
function planStep(images, step) {
  const slot = stepSlot(step);
  return `<li class="upgrade-step is-${step.state} is-${step.kind}"><div class="upgrade-step-head">${slot ? `<small>${esc(slot)}</small>` : ''}<h4>${esc(stepTitle(step))}</h4>${step.part === 'goal' ? '' : `<span class="upgrade-badge">${esc(stateNames()[step.state])}</span>`}</div>${stepBody(images, step)}</li>`;
}
const partNames = () => ({
  quick: [t('Quick wins'), t('Cheap steps you can take now.')],
  gear: [t('New gear'), t('Items a good share of them moved on to.')],
  enchant: [t('Enchanting'), t('Items worth keeping, taken as far as they take theirs.')],
  polish: [t('Polish'), t('Stones and soul binding, once the rest is done.')],
  goal: [t('Goals'), t('The best items a few of them wear, and the Daevanion boards.')],
});
// The plan: each part with its first steps, the rest behind a summary.
function upgradePlanList(images, plan) {
  const shown = 4,
    names = partNames();
  const parts = planParts
    .filter(part => plan.steps[part].length)
    .map(part => {
      const steps = plan.steps[part],
        [title, about] = names[part];
      const more =
        steps.length > shown
          ? `<details class="upgrade-more"><summary>${esc(tn(steps.length - shown, '{n} more', '{n} more'))}</summary><ol class="upgrade-steps">${steps
              .slice(shown)
              .map(s => planStep(images, s))
              .join('')}</ol></details>`
          : '';
      return `<div class="upgrade-part is-${part}"><h3>${esc(title)} <span>${number(steps.length)}</span></h3><p>${esc(about)}</p><ol class="upgrade-steps">${steps
        .slice(0, shown)
        .map(s => planStep(images, s))
        .join('')}</ol>${more}</div>`;
    });
  return parts.length ? parts.join('') : '';
}

// The arcana together: the sets most of them wear pieces of against the character's, each set's
// bonuses on and the next one, the arcana to swap for another set, and each arcana with the skills
// it raises against theirs.
function arcanaSection(images, plan) {
  const arcana = plan.arcana;
  if (!arcana) return '';
  const chip = (pieces, name, extra = '') =>
    `<li><b>${number(pieces)}×</b> ${esc(name)}${extra ? ` <small>${esc(extra)}</small>` : ''}</li>`;
  const usual = arcana.usual.length
    ? `<div><h3>${t('They wear')}</h3><ul class="upgrade-chips">${arcana.usual.map(s => chip(s.pieces, s.name, shareText(s.players / plan.sample))).join('')}</ul></div>`
    : '';
  const mineSets = arcana.sets.filter(s => s.mine);
  const yours = `<div><h3>${t('Yours')}</h3>${mineSets.length ? `<ul class="upgrade-chips is-mine">${mineSets.map(s => chip(s.mine, s.name)).join('')}</ul>` : `<p class="armory-empty">${t('No set')}</p>`}</div>`;
  const bonuses = mineSets
    .map(
      s =>
        `<li><strong>${esc(s.name)}</strong>${s.on.map(b => `<span class="is-on">${esc(t('{n} pieces', { n: b.count }))}: ${b.effects.map(esc).join(', ')}</span>`).join('')}${s.next ? `<span class="is-next">${esc(tn(s.next.count - s.mine, '{n} more piece', '{n} more pieces'))} (${esc(t('{n} pieces', { n: s.next.count }))}): ${s.next.effects.map(esc).join(', ')}</span>` : ''}</li>`,
    )
    .join('');
  const swaps = arcana.swaps.length
    ? `<h3>${t('Swap for their sets')}</h3><ul class="upgrade-reasons">${arcana.swaps.map(s => `<li>${esc(t('{slot}: {mine} ({mineSet}) → {theirs} ({theirSet})', { slot: slotLabel(s.slot), mine: s.from.name, mineSet: s.from.detail.set.name, theirs: s.to.name, theirSet: s.to.set }))}</li>`).join('')}</ul>`
    : '';
  const boost = b =>
    `<li class="${b.players ? (b.mine >= b.level ? 'is-even' : b.mine ? 'is-behind' : 'is-missing') : 'is-extra'}"><span>${esc(b.name)}</span><small>${b.players ? esc(t('+{level} · {share}', { level: number(b.level), share: shareText(b.share) })) : esc(t('only yours'))}</small><b>${b.mine ? `+${number(b.mine)}` : '–'}</b></li>`;
  const places = arcana.places
    .map(
      r =>
        `<li class="upgrade-arcana-place is-${r.state}"><h4>${esc(slotLabel(r.item?.slot || r.slot))}</h4>${smallCompare(images, r.item, r.common, r.common ? shareOf(r.common, r.ref) : 0, t('They wear'))}${r.boosts.length ? `<ul class="upgrade-boost-list" aria-label="${esc(t('Skills it raises'))}">${r.boosts.slice(0, 6).map(boost).join('')}</ul>` : ''}</li>`,
    )
    .join('');
  return `<section class="armory-panel upgrade-arcana"><div class="section-heading"><h2>${t('Arcana')}</h2></div><div class="upgrade-arcana-sets">${usual}${yours}</div>${bonuses ? `<ul class="upgrade-set-bonuses">${bonuses}</ul>` : ''}${swaps}<ul class="upgrade-arcana-places">${places}</ul></section>`;
}

// The skills the group's arcana and other gear raise against the character's.
function boostSection(plan) {
  const { arcana, gear } = plan.boosts;
  if (!arcana.length && !gear.length) return '';
  const row = b =>
    `<li class="${b.players ? (b.mine >= b.level ? 'is-even' : b.mine ? 'is-behind' : 'is-missing') : 'is-extra'}"><span>${esc(b.name)}</span><small>${b.players ? esc(t('+{level} · {share}', { level: number(b.level), share: shareText(b.share) })) : esc(t('only yours'))}</small><b>${b.mine ? `+${number(b.mine)}` : '–'}</b></li>`;
  const column = (title, list) =>
    list.length
      ? `<div><h3>${esc(title)}</h3><ul class="upgrade-boost-list">${list.slice(0, 16).map(row).join('')}</ul></div>`
      : '';
  return `<section class="armory-panel upgrade-boosts"><div class="section-heading"><h2>${t('Skills raised by gear')}</h2></div><p>${t('What their arcana and other gear add to their skills (the median of each one’s sum), and what yours add.')}</p><div class="upgrade-boost-columns">${column(t('From arcana'), arcana)}${column(t('From other gear'), gear)}</div><p class="armory-legend"><span class="is-behind"></span>${t('Below theirs')}<span class="is-missing"></span>${t('Missing')}</p></section>`;
}

// One place in the table of every slot: the item worn, the next step there and what to do.
function upgradeRow(images, row) {
  const first = row.actions[0],
    target = row.next || (row.item ? null : row.common);
  const todo = first
    ? stepTitle({ kind: first.kind, entries: [{ row, action: first }] })
    : row.item
      ? t('On par with them')
      : t('Few of them wear something here');
  return (
    `<li class="upgrade-row is-${row.state}"><div class="upgrade-row-slot"><small>${esc(slotLabel(row.item?.slot || row.slot))}</small>${yourItem(images, row.item)}</div><div class="upgrade-row-best"><small>${row.next ? t('Next step') : t('Worn most')}</small>${target ? theirItem(images, target, shareOf(target, row.ref)) : row.common ? theirItem(images, row.common, shareOf(row.common, row.ref)) : ''}</div>` +
    `<div class="upgrade-row-gap"><span class="upgrade-badge">${esc(stateNames()[row.state])}</span><small>${esc(todo)}</small></div></li>`
  );
}

// The Upgrade tab: what to do to catch up with the next step (the nearest characters a little
// stronger) or with the strongest characters of the class the armory keeps (upgrade.js); upgrade
// is the backend's comparison (null while it loads), group the one asked for.
function upgradeTab(answer, p, images, upgrade, group = 'next', ai = false) {
  const of = { class: p.class || t('this class') };
  const switcher = `<div class="upgrade-groups" role="group" aria-label="${esc(t('Compare with'))}">${[
    ['next', t('The next step')],
    ['top', t('The strongest')],
  ]
    .map(
      ([key, label]) =>
        `<button type="button" class="${key === group ? 'is-active' : ''}" data-armory-upgrade-group="${key}" aria-pressed="${key === group}">${esc(label)}</button>`,
    )
    .join('')}</div>`;
  // The armory's AI makes a plan of these, for the accounts that may ask it (armoryai.js).
  const askAi = ai
    ? `<button type="button" class="button secondary armory-ai-link" data-action="ai-upgrade-plan">${icon('spark')} ${t('Ask the AI for a plan')}</button>`
    : '';
  const heading = `<div class="section-heading"><h2>${t('Upgrades')}</h2>${switcher}${askAi}</div>`;
  if (!upgrade)
    return `<section class="armory-panel upgrade-intro">${heading}<p class="armory-empty upgrade-wait"><span class="armory-spinner" aria-hidden="true"></span>${esc(group === 'next' ? t('Comparing with the {class} characters a step above…', of) : t('Comparing with the strongest {class} characters the armory keeps…', of))}</p></section>`;
  if (upgrade.error)
    return `<section class="armory-panel upgrade-intro">${heading}<p class="armory-empty">${t('The comparison did not load. Odyle tries again when you open this tab.')}</p></section>`;
  const plan = upgradePlan(p, upgrade);
  const note = `<p class="armory-note">${icon('info')}<span>${t("Odyle compares with the characters of the class whose gear it knows, from every Global region: those anyone looked up and those its scout reads from PLAYNC's pages, so the comparison grows more complete over time. The next step is the nearest characters 5 to 100 % stronger than this one. Characters whose combat power their item level does not give are left out. The comparison is worked out again every 10 minutes.")}</span></p>`;
  if (!plan)
    return `<section class="armory-panel upgrade-intro">${heading}<p class="armory-empty">${esc(t('The armory keeps too few {class} characters to compare with yet ({n} of {least}). Every character anyone looks up joins the comparison.', { ...of, n: number(upgrade.players?.length || 0), least: upgradeLeast }))}</p></section>${note}`;
  const n = plan.sample,
    cp = plan.combatPower,
    il = plan.itemLevel,
    next = plan.group === 'next';
  const third = next
    ? [t('The next step'), `${number(cp.low)}–${number(cp.high)}`, t('combat power')]
    : plan.below
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
    third,
  ];
  const player = q =>
    `<li><a href="${esc(link(profilePath(q)))}"><span class="armory-mini" aria-hidden="true">${esc(initials(q.name))}${picture(images, q.portrait)}</span><strong>${esc(q.name)}</strong><span>${esc([q.server, `${number(q.combatPower)} CP`].filter(Boolean).join(' · '))}</span></a></li>`;
  const about = next
    ? t(
        'Compared with {n} {class} characters a step above, from every Global region: what they did that this character has not yet.',
        { ...of, n: number(n) },
      )
    : t(
        'Compared with the {n} strongest {class} characters the armory keeps, from every Global region, by combat power.',
        { ...of, n: number(n) },
      );
  const fallback =
    group === 'next' && !next
      ? `<p class="upgrade-fallback">${icon('info')}<span>${esc(t('Odyle knows too few {class} characters a step above this one yet, so this compares with the strongest.', of))}</span></p>`
      : '';
  const excluded = plan.excluded
    ? `<small class="upgrade-excluded">${esc(tn(plan.excluded, '{n} character left out: its combat power does not match its item level.', '{n} characters left out: their combat power does not match their item level.'))}</small>`
    : '';
  const intro =
    `<section class="armory-panel upgrade-intro">${heading}<p>${esc(about)}</p>${fallback}` +
    `<dl class="armory-power">${metrics.map(([label, value, small, main]) => `<div class="${main ? 'is-main' : ''}"><dt>${esc(label)}</dt><dd><strong>${esc(value)}</strong><small>${esc(small)}</small></dd></div>`).join('')}</dl>` +
    `<details class="upgrade-players-box"><summary>${esc(next ? t('The strongest {n} of them', { n: number(upgrade.players.length) }) : t('The {n} strongest {class} characters', { ...of, n: number(upgrade.players.length) }))}</summary><ol class="upgrade-players">${upgrade.players.map(player).join('')}</ol><a class="text-button" href="${esc(link(topPath(p.class)))}">${esc(t('All top {class} players', of))} ${icon('arrow')}</a></details>${excluded}</section>`;
  const steps = upgradePlanList(images, plan);
  const planBox = `<section class="armory-panel upgrade-plan"><div class="section-heading"><h2>${t('What to do next')}</h2></div>${steps || `<p class="armory-empty">${esc(next ? t('The gear is on par with the {class} characters a step above in every slot.', of) : t('The gear is on par with the strongest {class} characters in every slot.', of))}</p>`}</section>`;
  const rows = plan.rows.length
    ? `<section class="armory-panel"><details class="upgrade-all"><summary><h2>${t('Every slot')} <span>${number(plan.rows.length)}</span></h2></summary><ul class="upgrade-rows">${plan.rows.map(row => upgradeRow(images, row)).join('')}</ul></details></section>`
    : '';
  const boards = plan.boards.length
    ? `<section class="armory-panel"><div class="section-heading"><h2>${t('Daevanion')}</h2></div><ul class="upgrade-boards">${plan.boards.map(b => `<li class="${b.gap > 0 ? 'is-behind' : ''}"><span><strong>${esc(b.name)}</strong><small>${esc(t('{mine} of {total} nodes · they open {theirs}', { mine: number(b.mine), total: number(b.total), theirs: number(b.open) }))}</small></span><span class="armory-track upgrade-track" role="img" aria-label="${esc(t('{mine} of {total} nodes · they open {theirs}', { mine: number(b.mine), total: number(b.total), theirs: number(b.open) }))}"><i style="width:${percent(b.mine, b.total)}%"></i><b style="left:${percent(b.open, b.total)}%"></b></span></li>`).join('')}</ul><p class="armory-legend"><span class="is-open"></span>${t('Yours')}<span class="is-mark"></span>${t('Their median')}</p></section>`
    : '';
  const skills = plan.skills.length
    ? `<section class="armory-panel"><div class="section-heading"><h2>${t('On their skill bars')}</h2></div><ul class="upgrade-skills">${plan.skills.map(s => `<li class="${s.equipped ? 'is-equipped' : s.acquired ? '' : 'is-locked'}"><span class="armory-icon is-skill${imageUrl(images, s.icon) ? '' : ' is-empty'}" aria-hidden="true">${picture(images, s.icon)}</span><span><strong>${esc(s.name)}</strong><small>${esc([t('{n} of {total}, level {level}', { n: number(s.players), total: number(n), level: number(s.level) }), s.equipped ? t('on your bar, level {level}', { level: number(s.mine) }) : s.acquired ? t('learned, not on your bar') : t('Not learned yet')].join(' · '))}</small></span></li>`).join('')}</ul></section>`
    : '';
  return intro + planBox + arcanaSection(images, plan) + boostSection(plan) + rows + boards + skills + note;
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
<div class="armory-hero-actions"><button class="button secondary armory-bookmark" data-action="armory-bookmark" aria-pressed="${bookmarked}" title="${esc(bookmarked ? t('Remove {name} from bookmarks', { name: profile.name }) : t('Bookmark {name} in this browser', { name: profile.name }))}">${bookmarked ? '★ ' + t('Bookmarked') : '☆ ' + t('Bookmark')}</button><button class="button secondary armory-compare" data-action="armory-compare" aria-haspopup="dialog">${icon('swords')} ${t('Compare')}</button>${view.ai ? `<button class="button secondary armory-ai-link" data-action="ai-ask-about">${icon('spark')} ${t('Ask the AI')}</button>` : ''}<a class="button secondary armory-card-link" href="${esc(link(profilePath(answer) + '/card'))}">${icon('star')} ${t('Player card')}</a><a class="button secondary" href="${esc(playncPage(answer))}" target="_blank" rel="noopener noreferrer">${t('Official page')} ↗</a></div>
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
              ? upgradeTab(answer, profile, images, view.upgrade, view.upgradeGroup, view.ai)
              : progressPanel(answer.history) + gearTab(profile, images, loading);
  return `<main class="dashboard armory armory-profile">${hero}${status}${nav}<div class="armory-tab">${content}</div>${back}</main>`;
}
