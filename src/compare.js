// Two armory characters side by side: /armory/<region>/<server id>/<character id>/compare/<region>/
// <server id>/<character id>, the first on the left. Each side is a profile the armory keeps
// (armory.js), fetched and asked for again while it waits for PLAYNC like any profile
// (app/compare.js). The page shows their numbers, gear slot by slot in the paper doll's order,
// stats, Daevanion boards, skill bars and arcana sets, each difference with the side ahead
// marked. The picker lists the characters to compare with: the browser's bookmarks, the
// strongest of the class and a search like the armory's own. Pure functions returning HTML,
// like armory.js; nothing here is typed in or changed by players.
import { t, tn } from './i18n.js';
import { escape as esc, number } from './model.js';
import { icon } from './icons.js';
import { link } from './routes.js';
import { profilePath, classBadge, imageUrl } from './armorylinks.js';
import {
  slotLabel,
  gradeClass,
  itemIcon,
  itemTip,
  lookupStatus,
  regionNames,
  regionLabel,
  picture,
  initials,
  bookmarkKey,
  armourSlots,
  accessorySlots,
  arcanaSlots,
  companionSlots,
  serverOptions,
} from './armory.js';

// ---------------------------------------------------------------- What differs

const count = value => (Number.isFinite(Number(value)) ? Number(value) : 0);
// The side ahead by a number: 'a', 'b', or '' when even or when either side has none.
const ahead = (a, b) => (a == null || b == null || a === b ? '' : a > b ? 'a' : 'b');
// A profile with every list it may lack, as the profile page reads it.
const filled = p => ({
  ...p,
  stats: p.stats || [],
  gear: p.gear || [],
  skills: p.skills || [],
  boards: p.boards || [],
  titles: { owned: 0, total: 0, equipped: [], ...p.titles },
});

// The numbers of the header: combat power, item level, Daevanion nodes open, titles owned and
// skills learned, each with the side ahead.
export function compareSummary(left, right) {
  const of = p => ({
    combatPower: count(p.combatPower),
    itemLevel: count(p.itemLevel),
    nodes: (p.boards || []).reduce((n, b) => n + count(b.open), 0),
    titles: count(p.titles?.owned),
    skills: (p.skills || []).filter(s => s.acquired).length,
  });
  const a = of(left),
    b = of(right);
  return ['combatPower', 'itemLevel', 'nodes', 'titles', 'skills'].map(key => ({
    key,
    a: a[key],
    b: b[key],
    better: ahead(a[key], b[key]),
  }));
}

// What the comparison reads of an item: its numbers, its soul binding and its set. Item level
// and stones are null while PLAYNC's item page is missing.
export function compareItemFacts(g) {
  if (!g) return null;
  const d = g.detail || null;
  return {
    name: g.name,
    grade: g.grade,
    enchant: count(g.enchant),
    exceed: count(g.exceed),
    level: count(g.level),
    itemLevel: d ? count(d.itemLevel) : null,
    stones: d ? (d.stones?.length || 0) + (d.godStones?.length || 0) : null,
    stoneSlots: d
      ? Math.max(count(d.stoneSlots) + count(d.godSlots), (d.stones?.length || 0) + (d.godStones?.length || 0))
      : null,
    sub: d
      ? [
          ...(d.sub || []).map(l => `${l.name} ${l.value}`),
          ...(d.subSkills || []).map(s => `${s.name} +${count(s.level)}`),
        ]
      : [],
    set: d?.set?.name || '',
  };
}

// One slot of both characters: the items (null for an empty slot), whether they are the same
// item, the side that alone wears one, and the side ahead by item level, enchantment, exceed,
// stones filled and (pets) level.
export function compareSlot(slot, left, right) {
  const a = compareItemFacts(left),
    b = compareItemFacts(right);
  const better = { itemLevel: '', enchant: '', exceed: '', stones: '', level: '' };
  if (a && b) for (const key of Object.keys(better)) better[key] = ahead(a[key], b[key]);
  return {
    slot,
    a,
    b,
    left: left || null,
    right: right || null,
    same: Boolean(a && b && a.name === b.name && a.grade === b.grade),
    only: a && !b ? 'a' : b && !a ? 'b' : '',
    better,
  };
}

// Both characters' gear in the paper doll's groups and order, slots PLAYNC adds later with the
// accessories; a slot empty on both sides and a group with no slot left are left out.
export function compareGear(left, right) {
  const a = new Map((left.gear || []).map(g => [g.slot, g])),
    b = new Map((right.gear || []).map(g => [g.slot, g]));
  const known = new Set([...armourSlots, ...accessorySlots, ...arcanaSlots, ...companionSlots]);
  const others = [...new Set([...a.keys(), ...b.keys()])].filter(slot => !known.has(slot));
  return [
    ['armour', armourSlots],
    ['accessories', [...accessorySlots, ...others]],
    ['arcana', arcanaSlots],
    ['companions', companionSlots],
  ]
    .map(([group, slots]) => ({
      group,
      rows: slots.filter(slot => a.has(slot) || b.has(slot)).map(slot => compareSlot(slot, a.get(slot), b.get(slot))),
    }))
    .filter(g => g.rows.length);
}

// Lists of both characters joined by key, in the left one's order and then the right one's.
function joined(left, right, key) {
  const rows = new Map();
  for (const item of left) if (!rows.has(key(item))) rows.set(key(item), { a: item, b: null });
  for (const item of right) {
    const row = rows.get(key(item));
    if (row && !row.b) row.b = item;
    else if (!row) rows.set(key(item), { a: null, b: item });
  }
  return [...rows.values()];
}

// The stats, primary and deity, by stat, with the side ahead.
export function compareStats(left, right) {
  const rows = joined(left.stats || [], right.stats || [], s => s.type || s.name).map(({ a, b }) => {
    const s = a || b;
    return {
      name: s.name,
      deity: s.deity || '',
      primary: Boolean(s.primary),
      a: a ? count(a.value) : null,
      b: b ? count(b.value) : null,
      better: ahead(a ? count(a.value) : null, b ? count(b.value) : null),
    };
  });
  return { primary: rows.filter(r => r.primary), deity: rows.filter(r => !r.primary) };
}

// The Daevanion boards by name: nodes open of all, with the side ahead.
export function compareBoards(left, right) {
  return joined(left.boards || [], right.boards || [], b => b.name).map(({ a, b }) => ({
    name: (a || b).name,
    a: a ? { open: count(a.open), total: count(a.total) } : null,
    b: b ? { open: count(b.open), total: count(b.total) } : null,
    better: ahead(a ? count(a.open) : null, b ? count(b.open) : null),
  }));
}

// The skills on the skill bars: those both keep (with each one's level and the side ahead), and
// those only one of them keeps.
export function compareSkills(left, right) {
  const bar = p => (p.skills || []).filter(s => s.equipped);
  const rows = joined(bar(left), bar(right), s => s.name);
  return {
    both: rows
      .filter(r => r.a && r.b)
      .map(({ a, b }) => ({
        name: a.name,
        icon: a.icon || b.icon || '',
        a: count(a.level),
        b: count(b.level),
        better: ahead(count(a.level), count(b.level)),
      })),
    onlyA: rows.filter(r => r.a && !r.b).map(({ a }) => ({ name: a.name, icon: a.icon || '', level: count(a.level) })),
    onlyB: rows.filter(r => r.b && !r.a).map(({ b }) => ({ name: b.name, icon: b.icon || '', level: count(b.level) })),
  };
}

// The sets both wear pieces of (arcana mostly): each set once, the pieces each side wears.
export function compareSets(left, right) {
  const sets = p => {
    const found = new Map();
    for (const g of p.gear || []) {
      const s = g.detail?.set;
      if (s && !found.has(s.name)) found.set(s.name, s);
    }
    return [...found.values()];
  };
  const of = s =>
    s
      ? {
          equipped: count(s.equipped),
          pieces: (s.items || []).filter(i => i.equipped).map(i => i.name),
          bonuses: (s.bonuses || []).filter(b => count(s.equipped) >= count(b.count)).length,
        }
      : null;
  return joined(sets(left), sets(right), s => s.name).map(({ a, b }) => ({
    name: (a || b).name,
    total: (a || b).items?.length || 0,
    a: of(a),
    b: of(b),
    better: ahead(a ? count(a.equipped) : null, b ? count(b.equipped) : null),
  }));
}

// ---------------------------------------------------------------- The page

const percent = (part, whole) => (whole ? Math.min(100, Math.round((part / whole) * 100)) : 0);
const raceClass = p => (/asmodian/i.test(p?.race) ? 'is-asmodian' : /elyos/i.test(p?.race) ? 'is-elyos' : '');
const sideName = (side, fallback) => side?.answer?.profile?.name || fallback;

// A number of one side, with how far ahead it is when it is.
function valueCell(value, other, better, side, show = number) {
  if (value == null) return `<td class="is-none">—</td>`;
  const on = better === side;
  return `<td${on ? ' class="is-better"' : ''}><span>${esc(show(value))}</span>${on && other != null ? `<small class="compare-gap">+${esc(show(value - other))}</small>` : ''}</td>`;
}
function table(caption, names, rows) {
  return `<table class="compare-table"><caption class="sr-only">${esc(caption)}</caption><thead><tr><th scope="col"><span class="sr-only">${esc(caption)}</span></th><th scope="col">${esc(names[0])}</th><th scope="col">${esc(names[1])}</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

// One side's header: who it is, where its lookup stands, and the button that picks another.
function sideHead(side, index, view) {
  const images = view.images || '',
    answer = side?.answer,
    p = answer?.profile;
  const status = answer
    ? `<div class="compare-status" data-compare-status="${index}">${lookupStatus(answer, view.now, false)}</div>`
    : side?.error
      ? `<div class="compare-status" data-compare-status="${index}"><div class="armory-status is-failed" role="status">${icon('alert')}<span>${esc(t(side.error))}</span></div></div>`
      : `<div class="compare-status" data-compare-status="${index}"><div class="armory-status is-waiting" role="status"><span class="armory-spinner" aria-hidden="true"></span><span>${t('Loading…')}</span></div></div>`;
  const change = `<button class="button secondary compare-change" data-compare-change="${index}" aria-haspopup="dialog">${t('Pick another')}</button>`;
  const at = side?.target || {};
  const where = [p?.server || answer?.server, regionLabel(at.region)].filter(Boolean).join(' · ');
  const who = p
    ? `<h2><a href="${esc(link(profilePath(at)))}">${esc(p.name)}</a></h2><p class="armory-tags"><span>${esc(t('Level {level}', { level: p.level }))}</span>${p.class ? `<span>${classBadge(images, answer.classIcon, p.class)}${esc(p.class)}</span>` : ''}</p>`
    : `<h2>${esc(answer?.server ? t('A character on {server}', { server: answer.server }) : t('A character'))}</h2>`;
  return `<article class="compare-side ${raceClass(p)}"><div class="armory-portrait" aria-hidden="true"><span>${esc(initials(p?.name || '?'))}</span>${picture(images, p?.portrait)}</div><div class="compare-who"><p class="armory-eyebrow">${esc(where)}</p>${who}</div>${change}${status}</article>`;
}

function summaryPanel(left, right, names) {
  const labels = {
    combatPower: t('Combat power'),
    itemLevel: t('Item level'),
    nodes: t('Daevanion nodes open'),
    titles: t('Titles owned'),
    skills: t('Skills learned'),
  };
  const rows = compareSummary(left, right).map(
    r =>
      `<tr${r.key === 'combatPower' ? ' class="is-main"' : ''}><th scope="row">${esc(labels[r.key])}</th>${valueCell(r.a, r.b, r.better, 'a')}${valueCell(r.b, r.a, r.better, 'b')}</tr>`,
  );
  return `<section class="armory-panel compare-summary"><div class="section-heading"><h2>${t('Overview')}</h2></div>${table(t('Overview'), names, rows)}</section>`;
}

// One side of a slot: the item with its card on hover or focus, its numbers (the better ones
// marked) and its soul binding and set.
function itemCell(images, row, side, name) {
  const g = side === 'a' ? row.left : row.right,
    f = side === 'a' ? row.a : row.b,
    other = side === 'a' ? row.b : row.a,
    label = slotLabel(row.slot);
  if (!g)
    return `<div class="armory-gear-slot compare-item is-empty"><span class="armory-icon is-empty" aria-hidden="true"></span><span class="compare-item-text"><strong>${t('Empty')}</strong></span></div>`;
  const chip = (key, text, shown) =>
    shown ? `<span class="compare-chip${row.better[key] === side ? ' is-better' : ''}">${esc(text)}</span>` : '';
  const chips = [
    chip('itemLevel', t('item level {n}', { n: number(f.itemLevel) }), f.itemLevel),
    chip('enchant', `+${number(f.enchant)}`, f.enchant || other?.enchant),
    chip('exceed', t('exceed {n}', { n: number(f.exceed) }), f.exceed || other?.exceed),
    chip('stones', t('{n} / {total} stones', { n: number(f.stones), total: number(f.stoneSlots) }), f.stoneSlots),
    chip('level', t('Lv {level}', { level: number(f.level) }), f.level),
  ].join('');
  return `<div class="armory-gear-slot compare-item ${gradeClass(g.grade)}${row.only === side ? ' is-only' : ''}" tabindex="0" aria-label="${esc(`${name}, ${label}: ${g.enchant ? `+${g.enchant} ` : ''}${g.name}`)}">${itemIcon(images, g)}<span class="compare-item-text"><strong>${esc(g.name)}</strong>${chips ? `<span class="compare-chips">${chips}</span>` : ''}${f.sub.length ? `<small class="compare-sub">${f.sub.map(esc).join(' · ')}</small>` : ''}${f.set ? `<small class="compare-set">${esc(t('Set: {name}', { name: f.set }))}</small>` : ''}</span>${itemTip(images, g, false)}</div>`;
}

function gearPanel(left, right, names, images) {
  const titles = {
    armour: t('Weapons and armour'),
    accessories: t('Accessories'),
    arcana: t('Arcana'),
    companions: t('Pet and wings'),
  };
  const groups = compareGear(left, right);
  if (!groups.length) return '';
  const row = r => {
    const tag = r.same
      ? t('Same item')
      : r.only
        ? t('Only {name}', { name: names[r.only === 'a' ? 0 : 1] })
        : t('Different item');
    return `<li class="compare-slot ${r.same ? 'is-same' : 'is-different'}"><div class="compare-slot-head"><h4>${esc(slotLabel(r.slot))}</h4><em>${esc(tag)}</em></div><div class="compare-pair">${itemCell(images, r, 'a', names[0])}${itemCell(images, r, 'b', names[1])}</div></li>`;
  };
  return `<section class="armory-panel compare-gear"><div class="section-heading"><h2>${t('Gear')}</h2></div><div class="compare-names" aria-hidden="true"><span>${esc(names[0])}</span><span>${esc(names[1])}</span></div>${groups.map(g => `<h3>${esc(titles[g.group])}</h3><ul class="compare-slots">${g.rows.map(row).join('')}</ul>`).join('')}</section>`;
}

function statsPanel(left, right, names) {
  const { primary, deity } = compareStats(left, right);
  if (!primary.length && !deity.length) return '';
  const rows = list =>
    list.map(
      s =>
        `<tr><th scope="row">${esc(s.name)}${s.deity ? ` <small>${esc(s.deity)}</small>` : ''}</th>${valueCell(s.a, s.b, s.better, 'a')}${valueCell(s.b, s.a, s.better, 'b')}</tr>`,
    );
  return `<section class="armory-panel compare-stats"><div class="section-heading"><h2>${t('Stats')}</h2></div>${primary.length ? table(t('Stats'), names, rows(primary)) : ''}${deity.length ? `<h3>${t('Deity stats')}</h3>${table(t('Deity stats'), names, rows(deity))}` : ''}</section>`;
}

function boardsPanel(left, right, names) {
  const boards = compareBoards(left, right);
  if (!boards.length) return '';
  const cell = (b, other, better, side) =>
    b
      ? `<td${better === side ? ' class="is-better"' : ''}><span>${esc(`${number(b.open)} / ${number(b.total)}`)}</span>${better === side && other ? `<small class="compare-gap">+${number(b.open - other.open)}</small>` : ''}<span class="armory-track" aria-hidden="true"><i style="width:${percent(b.open, b.total)}%"></i></span></td>`
      : `<td class="is-none">—</td>`;
  const rows = boards.map(
    b => `<tr><th scope="row">${esc(b.name)}</th>${cell(b.a, b.b, b.better, 'a')}${cell(b.b, b.a, b.better, 'b')}</tr>`,
  );
  return `<section class="armory-panel compare-boards"><div class="section-heading"><h2>${t('Daevanion')}</h2></div>${table(t('Daevanion nodes open'), names, rows)}</section>`;
}

function skillsPanel(left, right, names, images) {
  const { both, onlyA, onlyB } = compareSkills(left, right);
  if (!both.length && !onlyA.length && !onlyB.length) return '';
  const art = s =>
    `<span class="armory-icon is-skill${imageUrl(images, s.icon) ? '' : ' is-empty'}" aria-hidden="true">${picture(images, s.icon)}</span>`;
  const rows = both.map(
    s =>
      `<tr><th scope="row"><span class="compare-skill">${art(s)}${esc(s.name)}</span></th>${valueCell(s.a, s.b, s.better, 'a')}${valueCell(s.b, s.a, s.better, 'b')}</tr>`,
  );
  const only = (list, name) =>
    `<div><h3>${esc(t('Only on the skill bar of {name}', { name }))} <span>${number(list.length)}</span></h3>${list.length ? `<ul class="compare-only">${list.map(s => `<li><span class="compare-skill">${art(s)}${esc(s.name)}</span><b>${esc(t('Lv {level}', { level: number(s.level) }))}</b></li>`).join('')}</ul>` : `<p class="armory-empty">${t('None')}</p>`}</div>`;
  return `<section class="armory-panel compare-skills"><div class="section-heading"><h2>${t('Skills on the skill bar')}</h2></div>${both.length ? `<h3>${esc(t('On both skill bars'))} <span>${number(both.length)}</span></h3>${table(t('Skill level'), names, rows)}` : ''}<div class="compare-pair is-lists">${only(onlyA, names[0])}${only(onlyB, names[1])}</div></section>`;
}

function setsPanel(left, right, names) {
  const sets = compareSets(left, right);
  if (!sets.length) return '';
  const cell = (s, total, better, side) =>
    s
      ? `<td${better === side ? ' class="is-better"' : ''}><span>${esc(tn(s.equipped, '{n} piece', '{n} pieces'))} <small>/ ${number(total)}</small></span>${s.pieces.length ? `<small class="compare-pieces">${s.pieces.map(esc).join(', ')}</small>` : ''}</td>`
      : `<td class="is-none">—</td>`;
  const rows = sets.map(
    s =>
      `<tr><th scope="row">${esc(s.name)}</th>${cell(s.a, s.total, s.better, 'a')}${cell(s.b, s.total, s.better, 'b')}</tr>`,
  );
  return `<section class="armory-panel compare-sets"><div class="section-heading"><h2>${t('Sets')}</h2></div>${table(t('Sets'), names, rows)}</section>`;
}

// The compare page. sides are { target, answer, error } (answer null while it loads, error why
// it did not); view names where the backend serves images and the time now.
export function comparePage(sides, view = {}) {
  const images = view.images || '',
    now = view.now || Date.now();
  const names = [sideName(sides[0], t('Left')), sideName(sides[1], t('Right'))];
  const heads = `<section class="compare-heads" aria-label="${esc(t('Characters compared'))}">${sideHead(sides[0], 0, { images, now })}<button class="button secondary compare-swap" data-action="compare-swap" title="${esc(t('Swap sides'))}" aria-label="${esc(t('Swap sides'))}">⇄</button>${sideHead(sides[1], 1, { images, now })}</section>`;
  const [a, b] = sides.map(s => (s?.answer?.profile ? filled(s.answer.profile) : null));
  const body =
    a && b
      ? summaryPanel(a, b, names) +
        gearPanel(a, b, names, images) +
        statsPanel(a, b, names) +
        boardsPanel(a, b, names) +
        skillsPanel(a, b, names, images) +
        setsPanel(a, b, names)
      : `<p class="armory-note">${icon('info')}<span>${t('The comparison fills in by itself once the armory keeps both characters.')}</span></p>`;
  return `<main class="dashboard armory armory-compare"><div class="heading"><div><h1>${t('Compare characters')}</h1><p>${t('Two characters side by side, slot by slot, as PLAYNC lists them. The better value of each pair is marked.')}</p></div></div>${heads}${body}<a class="text-button armory-back" href="${link('/armory')}">${icon('arrow')} ${t('Search another character')}</a></main>`;
}

// ---------------------------------------------------------------- The picker

// The servers of a region for the picker's search, any server first, the chosen one selected.
export const compareServerOptions = (region, chosen = '') => serverOptions(region, chosen);

// A character to pick: a bookmark, a top player or a search hit.
function candidate(c, images, power = true) {
  const facts = [c.level ? t('Level {level}', { level: c.level }) : '', c.class, c.server].filter(Boolean).join(' · ');
  return `<li><button type="button" class="compare-candidate" data-compare-pick="${esc(bookmarkKey(c))}"><span class="armory-mini" aria-hidden="true">${esc(initials(c.name))}${picture(images, c.portrait)}</span><span class="compare-candidate-who"><strong>${esc(c.name)}</strong><small>${classBadge(images, c.classIcon, c.class)}${esc(facts)}</small></span>${power && c.combatPower ? `<span class="compare-candidate-power">${esc(number(c.combatPower))} CP<small>${esc(t('item level {n}', { n: number(c.itemLevel) }))}</small></span>` : ''}</button></li>`;
}
const others = (list, base) => list.filter(c => bookmarkKey(c) !== bookmarkKey(base));

// The strongest of the class, first 20 (top: the backend's answer, null while it loads,
// { error } when it did not).
export function comparePickerTop(view) {
  const { base, top, images = '' } = view;
  if (!base.class) return '';
  const players = top?.players ? others(top.players, base).slice(0, 20) : [];
  const body = !top
    ? `<p class="armory-empty upgrade-wait"><span class="armory-spinner" aria-hidden="true"></span>${t('Loading the top players…')}</p>`
    : top.error || !players.length
      ? `<p class="armory-empty">${esc(t('Odyle knows no other {class} character yet.', { class: base.class }))}</p>`
      : `<ul class="compare-candidates">${players.map(c => candidate(c, images)).join('')}</ul>`;
  return `<section class="compare-picker-top"><h3>${esc(t('Strongest {class} characters', { class: base.class }))}</h3>${body}</section>`;
}

// What the picker's search found (results: null before a search).
export function comparePickerResults(view) {
  const { base, results, searching, images = '' } = view;
  const list = results ? others(results, base) : [];
  const body = searching
    ? `<p class="armory-empty upgrade-wait"><span class="armory-spinner" aria-hidden="true"></span>${t('Searching…')}</p>`
    : results === null || results === undefined
      ? ''
      : list.length
        ? `<ul class="compare-candidates">${list.map(c => candidate(c, images, false)).join('')}</ul>`
        : `<p class="armory-empty">${view.chosen?.server ? t('PLAYNC lists no character of that name on this server.') : t('PLAYNC lists no character with that name in this region.')}</p>`;
  return `<div class="compare-picker-results" aria-live="polite">${body}</div>`;
}

// The picker: whom to compare base with. view holds the bookmarks, the top players and the
// search's results, the regions and the region and server last searched.
export function comparePicker(view) {
  const { base, bookmarks = [], regions = [], chosen = {}, images = '' } = view;
  const marks = others(bookmarks, base);
  const region =
    regions.find(r => r.region === chosen.region) || regions.find(r => r.region === 'GLOBAL_EU') || regions[0];
  const names = regionNames();
  const form = region
    ? `<form id="compare-search" class="armory-form compare-form"><label>${t('Region')}<select name="region" data-compare-region="1">${regions.map(r => `<option value="${esc(r.region)}" ${r === region ? 'selected' : ''}>${esc(names[r.region] || r.region)}</option>`).join('')}</select></label><label>${t('Server')}<select name="server">${compareServerOptions(region, chosen.server)}</select></label><label>${t('Character')}<input name="name" type="search" required minlength="2" maxlength="40" autocomplete="off" spellcheck="false" placeholder="${esc(t('A name or part of it, e.g. Kai or Kai Lumiel'))}"></label><button class="button primary" type="submit">${t('Search')}</button></form>`
    : '';
  return `<div class="compare-picker"><p class="compare-picker-intro">${esc(base.name ? t('Pick a character to put next to {name}.', { name: base.name }) : t('Pick a character to compare with.'))}</p>${marks.length ? `<section class="compare-picker-marks"><h3>${t('Bookmarked characters')}</h3><ul class="compare-candidates">${marks.map(c => candidate(c, images)).join('')}</ul></section>` : ''}${comparePickerTop(view)}<section class="compare-picker-search"><h3>${t('Look up a character')}</h3>${form}${comparePickerResults(view)}</section></div>`;
}
