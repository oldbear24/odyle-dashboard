// Builds (/builds): characters a player puts together by clicking, from what the armory keeps of a
// class (backend/odyle/buildcatalog.go): the gear slot by slot (item, enchantment, exceed level,
// stones, soul binding, the skills it raises), the skills with their levels and which are on the
// skill bar, and the open nodes of each Daevanion board, with notes. A build is a plan of its own
// (backend/odyle/builds.go): it changes nothing of a character and none of a character's values is
// typed in. Builds have no limits of the game (points, skill bar slots) to keep.
//
// A build is drawn as an armory profile (buildProfile), so the armory's tiles, item cards, gear
// summary and where its stats come from show it as they show a character. Pure functions: the page
// and the server are app/builds.js's. Its paths and titles are in buildlinks.js.
import { t, tn } from './i18n.js';
import { age, escape as esc, number } from './model.js';
import { icon } from './icons.js';
import { link } from './routes.js';
import { profilePath, classBadge, imageUrl } from './armorylinks.js';
import { buildPath, sharedPath, buildsPath } from './buildlinks.js';
import {
  picture,
  initials,
  gradeClass,
  gradeName,
  slotLabel,
  itemIcon,
  itemTip,
  armourSlots,
  accessorySlots,
  arcanaSlots,
  companionSlots,
} from './armory.js';
import { tileMeters, tileLabel, gearSummaryStrip, statSourcesPanel, skillBoostPanel } from './armorydetail.js';
import { boardNodes, boardSummary } from './armoryboard.js';

// The limits a plan keeps within (backend/odyle/builds.go).
export const planLimits = {
  stones: 8,
  gods: 4,
  sub: 12,
  skills: 8,
  enchant: 30,
  exceed: 10,
  level: 100,
  skillLevel: 50,
};
export const buildSlots = [...armourSlots, ...accessorySlots, ...arcanaSlots, ...companionSlots];

// The catalog's slot of a piece of gear: two earrings, rings, bracelets and runes share one.
export const catalogSlot = slot => /^(Earring|Ring|Bracelet|Rune)\d$/.exec(slot)?.[1] || slot;
export const slotOf = (catalog, slot) => (catalog?.slots || []).find(s => s.slot === catalogSlot(slot)) || null;
export const itemKey = item => `${item.name}|${item.grade || ''}`;
export const catalogItem = (catalog, slot, name, grade = '') =>
  slotOf(catalog, slot)?.items.find(i => i.name === name && (i.grade || '') === (grade || '')) || null;

// A plan with every list there, as the backend keeps it.
export function normalPlan(plan) {
  const p = plan || {};
  const out = {
    gear: Array.isArray(p.gear) ? p.gear : [],
    skills: Array.isArray(p.skills) ? p.skills : [],
    boards: Array.isArray(p.boards) ? p.boards : [],
    notes: typeof p.notes === 'string' ? p.notes : '',
  };
  if (p.from) out.from = p.from;
  return out;
}
const clamp = (n, low, high) => Math.min(high, Math.max(low, Math.round(Number(n) || 0)));
const short = (s, n) => String(s ?? '').slice(0, n);

// The name of a copy of a build ("Raid healer (copy)"), within the 60 characters (UTF-16 units, as
// the backend counts) a name has: a long name gives up its end.
export function copyName(name) {
  const base = [...String(name ?? '').trim()];
  const named = n =>
    t('{name} (copy)', { name: n < base.length ? base.slice(0, n).join('').trimEnd() + '…' : base.join('') });
  let n = base.length;
  while (n > 0 && named(n).length > 60) n--;
  return named(n);
}

// ---------------------------------------------------------------- A build as a profile

// A number as PLAYNC writes an item's values: "630", "13.5%".
const valueText = (v, percent) => `${Math.round(v * 100) / 100}${percent ? '%' : ''}`;

// A set as a build wears it: its pieces in the build marked, how many.
function setOf(set, worn) {
  const items = (set.items || []).map(i => ({ ...i, equipped: worn.has(i.name) }));
  return { ...set, items, equipped: worn.count };
}

// A piece of a build's gear as the armory shows an equipped item: its details from the catalog,
// its main stats at the enchantment and exceed level chosen, the stones, soul binding and skills
// chosen. An item the catalog no longer lists keeps its name, without details.
export function gearOf(entry, catalog) {
  const slot = slotOf(catalog, entry.slot),
    item = catalogItem(catalog, entry.slot, entry.name, entry.grade);
  const enchant = clamp(entry.enchant, 0, planLimits.enchant),
    exceed = clamp(entry.exceed, 0, planLimits.exceed);
  const known = (list, key) => new Map((list || []).map(x => [key(x), x]));
  const stones = known(slot?.stones, s => `${s.name}|${s.value || ''}|${s.grade || ''}`),
    gods = known(slot?.gods, s => `${s.name}|${s.grade || ''}`),
    boosts = known(slot?.boosts, b => b.name);
  const detailed = item && (item.itemLevel || item.main?.length || item.stoneSlots || item.category);
  const detail = detailed
    ? {
        category: item.category || '',
        kind: item.kind || '',
        itemLevel: item.itemLevel || 0,
        maxEnchant: item.maxEnchant || 0,
        maxExceed: item.maxExceed || 0,
        equipLevel: item.equipLevel || 0,
        race: item.race || '',
        classes: item.classes || [],
        main: [
          ...(item.main || []).map(s => ({
            name: s.name,
            ...(s.min ? { min: valueText(s.min, s.percent) } : {}),
            value: valueText(s.value, s.percent),
            ...(s.perEnchant && enchant ? { extra: valueText(s.perEnchant * enchant, s.percent) } : {}),
          })),
          ...(exceed
            ? (item.exceed || [])
                .filter(s => s.perLevel)
                .map(s => ({ name: s.name, value: '', extra: valueText(s.perLevel * exceed, s.percent), exceed: true }))
            : []),
        ],
        sub: (entry.sub || []).map(l => ({ name: l.name, value: l.value })),
        subCount: item.subCount || 0,
        soulBind: '',
        subSkills: (entry.skills || []).map(s => ({
          name: s.name,
          level: s.level,
          icon: boosts.get(s.name)?.icon || '',
        })),
        stoneSlots: item.stoneSlots || 0,
        stones: (entry.stones || []).map(s => ({
          ...s,
          icon: stones.get(`${s.name}|${s.value || ''}|${s.grade || ''}`)?.icon || '',
        })),
        godSlots: item.godSlots || 0,
        godStones: (entry.gods || []).map(s => {
          const seen = gods.get(`${s.name}|${s.grade || ''}`);
          return { ...s, desc: seen?.desc || '', icon: seen?.icon || '' };
        }),
        set: item.set || null,
        desc: '',
        sources: item.sources || [],
        skins: [],
        tradable: Boolean(item.tradable),
      }
    : null;
  return {
    slot: entry.slot,
    name: entry.name,
    grade: entry.grade || '',
    enchant,
    exceed,
    ...(entry.level ? { level: clamp(entry.level, 0, planLimits.level) } : {}),
    icon: item?.icon || '',
    detail,
  };
}

// A Daevanion board of the catalog with the nodes the plan opens (its start always open), and
// what they give as PLAYNC's pages sum it up.
export function boardOf(board, open) {
  const nodes = (board.nodes || []).map(n => ({ ...n, o: n.t === 'Start' || open.has(`${n.r},${n.c}`) }));
  const opened = nodes.filter(n => n.o && n.t !== 'Start');
  const effects = n =>
    String(n.e || '')
      .split(/,\s+/)
      .map(e => e.trim())
      .filter(Boolean);
  return {
    id: board.id,
    name: board.name,
    icon: board.icon || '',
    total: board.total || nodes.filter(n => n.t !== 'Start').length,
    open: opened.length,
    nodes,
    statEffects: opened.filter(n => n.t === 'Stat').flatMap(effects),
    skillEffects: opened.filter(n => n.t === 'SkillLevel').flatMap(effects),
  };
}

// A build as an armory profile: its gear with details, every skill of the class at the level the
// plan gives it (0: not learned), and the class's boards with the plan's nodes open.
export function buildProfile(build, catalog) {
  const plan = normalPlan(build?.plan);
  let gear = plan.gear.filter(g => buildSlots.includes(g.slot)).map(g => gearOf(g, catalog));
  gear.sort((a, b) => buildSlots.indexOf(a.slot) - buildSlots.indexOf(b.slot));
  const pieces = new Map(),
    names = new Set(gear.map(g => g.name));
  for (const g of gear) if (g.detail?.set) pieces.set(g.detail.set.name, (pieces.get(g.detail.set.name) || 0) + 1);
  gear = gear.map(g =>
    g.detail?.set
      ? {
          ...g,
          detail: {
            ...g.detail,
            set: setOf(g.detail.set, { has: n => names.has(n), count: pieces.get(g.detail.set.name) }),
          },
        }
      : g,
  );
  const planned = new Map(plan.skills.map(s => [s.name, s]));
  const skills = (catalog?.skills || []).map(s => {
    const p = planned.get(s.name),
      level = p ? clamp(p.level, 0, planLimits.skillLevel) : 0;
    return {
      name: s.name,
      category: s.category || '',
      icon: s.icon || '',
      needLevel: s.needLevel || 0,
      maxLevel: s.maxLevel || 0,
      level,
      acquired: level > 0,
      equipped: Boolean(p?.bar),
    };
  });
  for (const s of plan.skills)
    if (!skills.some(k => k.name === s.name))
      skills.push({
        name: s.name,
        category: '',
        icon: '',
        needLevel: 0,
        maxLevel: s.level,
        level: s.level,
        acquired: s.level > 0,
        equipped: Boolean(s.bar),
      });
  const opened = new Map(plan.boards.map(b => [Number(b.id), new Set(b.nodes)]));
  const boards = (catalog?.boards || []).map(b => boardOf(b, opened.get(Number(b.id)) || new Set()));
  return {
    name: build?.name || '',
    class: build?.class || '',
    gear,
    skills,
    boards,
    stats: [],
    skins: [],
    titles: { owned: 0, total: 0, equipped: [] },
  };
}

// ---------------------------------------------------------------- Changes to a plan

// A board's node opened or closed (a start node stays open).
export function toggleNode(plan, boardId, cell) {
  const p = normalPlan(plan),
    id = Number(boardId);
  const board = p.boards.find(b => Number(b.id) === id) || { id, nodes: [] };
  const nodes = board.nodes.includes(cell) ? board.nodes.filter(n => n !== cell) : [...board.nodes, cell];
  return { ...p, boards: [...p.boards.filter(b => Number(b.id) !== id), ...(nodes.length ? [{ id, nodes }] : [])] };
}

// Every node of a catalog board opened, or none.
export function fillBoard(plan, board, open) {
  const p = normalPlan(plan),
    id = Number(board.id);
  const nodes = open ? (board.nodes || []).filter(n => n.t !== 'Start').map(n => `${n.r},${n.c}`) : [];
  return { ...p, boards: [...p.boards.filter(b => Number(b.id) !== id), ...(nodes.length ? [{ id, nodes }] : [])] };
}

// A skill's level or place on the skill bar changed: on the bar, a skill not learned is learned
// (level 1); at level 0 it leaves the bar. A skill at level 0 off the bar leaves the plan.
export function setSkill(plan, name, change) {
  const p = normalPlan(plan),
    was = p.skills.find(s => s.name === name) || { name, level: 0, bar: false };
  const next = { ...was, ...change };
  next.level = clamp(next.level, 0, planLimits.skillLevel);
  if ('bar' in change && change.bar && next.level === 0) next.level = 1;
  if (next.level === 0) next.bar = false;
  const others = p.skills.filter(s => s.name !== name);
  return { ...p, skills: next.level > 0 || next.bar ? [...others, next] : others };
}

// A slot filled with an entry, or emptied (null).
export function setGear(plan, slot, entry) {
  const p = normalPlan(plan);
  return { ...p, gear: [...p.gear.filter(g => g.slot !== slot), ...(entry ? [{ ...entry, slot }] : [])] };
}

// The slot editor's choices as a plan entry (null for an empty slot): the item, its enchantment,
// exceed level and pet level within its limits, and the stones, soul binding and skills chosen.
export function slotEntry(choice, catalog, slot) {
  if (!choice.item) return null;
  const [name, grade = ''] = String(choice.item).split('|');
  const item = catalogItem(catalog, slot, name, grade);
  const pick = (list, n) => (list || []).filter(Boolean).slice(0, n);
  const parts = (text, keys) => {
    const values = String(text).split('|');
    return Object.fromEntries(keys.map((k, i) => [k, values[i] || '']));
  };
  return {
    slot,
    name: short(name, 80),
    grade: short(grade, 20),
    enchant: clamp(choice.enchant, 0, Math.min(planLimits.enchant, item?.maxEnchant ?? planLimits.enchant)),
    exceed: clamp(choice.exceed, 0, Math.min(planLimits.exceed, item?.maxExceed ?? planLimits.exceed)),
    ...(Number(choice.level) > 0 ? { level: clamp(choice.level, 0, planLimits.level) } : {}),
    stones: pick(choice.stones, planLimits.stones).map(v => parts(v, ['name', 'value', 'grade'])),
    gods: pick(choice.gods, planLimits.gods).map(v => parts(v, ['name', 'grade'])),
    sub: pick(choice.sub, planLimits.sub).map(v => parts(v, ['name', 'value'])),
    skills: pick(choice.skills, planLimits.skills).map(v => {
      const { name: skill, level } = parts(v, ['name', 'level']);
      return { name: skill, level: clamp(level, 0, planLimits.skillLevel) };
    }),
  };
}

// A build of an armory profile: its gear with what is engraved and rolled on it, its learned skills
// with their levels and places on the skill bar, its open nodes, and the profile it came from.
export function planFromProfile(answer) {
  const p = answer?.profile || {};
  const gear = (p.gear || [])
    .filter(g => buildSlots.includes(g.slot) && g.name)
    .map(g => {
      const d = g.detail || {};
      return {
        slot: g.slot,
        name: short(g.name, 80),
        grade: /^[A-Za-z]{0,20}$/.test(g.grade || '') ? g.grade || '' : '',
        enchant: clamp(g.enchant, 0, planLimits.enchant),
        exceed: clamp(g.exceed, 0, planLimits.exceed),
        ...(g.level ? { level: clamp(g.level, 0, planLimits.level) } : {}),
        stones: (d.stones || [])
          .slice(0, planLimits.stones)
          .map(s => ({ name: short(s.name, 80), value: short(s.value, 20), grade: s.grade || '' })),
        gods: (d.godStones || [])
          .slice(0, planLimits.gods)
          .map(s => ({ name: short(s.name, 80), grade: s.grade || '' })),
        sub: (d.sub || [])
          .filter(l => l.name && l.value)
          .slice(0, planLimits.sub)
          .map(l => ({ name: short(l.name, 80), value: short(l.value, 20) })),
        skills: (d.subSkills || [])
          .slice(0, planLimits.skills)
          .map(s => ({ name: short(s.name, 80), level: clamp(s.level, 0, planLimits.skillLevel) })),
      };
    })
    .filter((g, i, all) => all.findIndex(o => o.slot === g.slot) === i);
  const skills = (p.skills || [])
    .filter(s => s.name && (s.acquired || s.equipped))
    .map(s => ({ name: short(s.name, 80), level: clamp(s.level, 0, planLimits.skillLevel), bar: Boolean(s.equipped) }))
    .filter((s, i, all) => all.findIndex(o => o.name === s.name) === i)
    .slice(0, 160);
  const boards = (p.boards || [])
    .filter(b => b.id && (b.nodes || []).some(n => n.o && n.t !== 'Start'))
    .map(b => ({ id: Number(b.id), nodes: b.nodes.filter(n => n.o && n.t !== 'Start').map(n => `${n.r},${n.c}`) }));
  return {
    name: short(t("{name}'s build", { name: p.name || '' }), 60),
    class: p.class || '',
    plan: {
      gear,
      skills,
      boards,
      notes: '',
      from: {
        region: answer.region,
        serverId: Number(answer.serverId),
        characterId: answer.characterId,
        name: short(p.name, 40),
      },
    },
  };
}

// ---------------------------------------------------------------- What a character still needs

// What a character lacks of a build (both as profiles): per slot, the item to get or how far to
// enchant and exceed it and the stones to engrave; per board, the nodes the build opens that the
// character has not; the skills the build keeps higher or on its skill bar.
export function buildGap(build, character) {
  const have = new Map((character?.gear || []).map(g => [g.slot, g]));
  const gear = [];
  for (const want of build.gear) {
    const own = have.get(want.slot);
    if (!own || own.name !== want.name || (own.grade || '') !== (want.grade || '')) {
      gear.push({ slot: want.slot, kind: 'item', want, have: own || null });
      continue;
    }
    const enchant = Math.max(0, want.enchant - (own.enchant || 0)),
      exceed = Math.max(0, want.exceed - (own.exceed || 0)),
      stones = Math.max(0, (want.detail?.stones || []).length - (own.detail?.stones || []).length);
    if (enchant || exceed || stones)
      gear.push({ slot: want.slot, kind: 'polish', want, have: own, enchant, exceed, stones });
  }
  const theirs = new Map((character?.boards || []).map(b => [Number(b.id), b]));
  const boards = [];
  for (const b of build.boards) {
    const other = theirs.get(Number(b.id)),
      open = new Set((other?.nodes || []).filter(n => n.o).map(n => `${n.r},${n.c}`));
    const missing = b.nodes.filter(n => n.o && n.t !== 'Start' && !open.has(`${n.r},${n.c}`));
    if (missing.length)
      boards.push({
        id: b.id,
        name: b.name,
        missing: missing.length,
        nodes: missing,
        known: Boolean(other?.nodes?.length),
      });
  }
  const skillsOf = new Map((character?.skills || []).map(s => [s.name, s]));
  const skills = [];
  for (const s of build.skills) {
    if (!s.level && !s.equipped) continue;
    const own = skillsOf.get(s.name) || { level: 0, equipped: false };
    const levels = Math.max(0, s.level - (own.level || 0)),
      bar = s.equipped && !own.equipped;
    if (levels || bar) skills.push({ name: s.name, icon: s.icon, want: s.level, have: own.level || 0, bar });
  }
  return { gear, boards, skills, done: !gear.length && !boards.length && !skills.length };
}

// ---------------------------------------------------------------- Pages

// The account's builds: a form for a new one (a name and a class the armory knows) and each build,
// the one changed last first.
export function buildsPage(answer, now = Date.now(), images = '') {
  const builds = answer?.builds || [],
    classes = answer?.classes || [],
    limit = answer?.limit || 50;
  const full = builds.length >= limit;
  // A card per build, its class's emblem framed beside it; a button beside the card's link
  // makes a copy of it.
  const card = b => {
    const facts = [
      tn(b.gear || 0, '{n} item', '{n} items'),
      tn(b.nodes || 0, '{n} node', '{n} nodes'),
      tn(b.bar || 0, '{n} skill on the bar', '{n} skills on the bar'),
    ];
    const art = classes.find(c => c.name === b.class)?.icon;
    const mark = classBadge(images, art, '') || `<b>${esc(initials(b.class))}</b>`;
    const copy = t('Make a copy of {name}', { name: b.name });
    return `<li class="build-card-item"><a class="build-card" href="${esc(link(buildPath(b.id)))}"><span class="build-card-mark" aria-hidden="true">${mark}</span><span class="build-card-body"><span class="build-card-class">${esc(b.class)}</span><strong>${esc(b.name)}</strong><span class="build-card-facts">${facts.map(f => `<span>${esc(f)}</span>`).join('')}</span><span class="build-card-meta">${b.share ? `<span class="build-shared">${icon('share')} ${t('Shared')}</span>` : ''}${b.from?.name ? `<span>${esc(t('from {name}', { name: b.from.name }))}</span>` : ''}<span>${esc(t('changed {age}', { age: age(b.updated, now) }))}</span></span></span></a><button type="button" class="build-card-copy" data-build-copy="${esc(b.id)}" title="${esc(copy)}" aria-label="${esc(copy)}" ${full ? 'disabled' : ''}>${icon('copy')}</button></li>`;
  };
  const options = classes.length
    ? classes.map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('')
    : '';
  const form = classes.length
    ? `<form id="build-new-form" class="build-new-form"><label>${t('Name')}<input name="name" maxlength="60" autocomplete="off" required placeholder="${esc(t('e.g. Raid healer'))}"></label><label>${t('Class')}<select name="class" required>${options}</select></label><button class="button primary" type="submit" ${full ? 'disabled' : ''}>${icon('plus')} ${t('New build')}</button></form>${full ? `<p class="build-hint">${esc(t('You can keep up to {n} builds. Delete one first.', { n: limit }))}</p>` : ''}`
    : `<p class="build-hint">${t('The armory knows no class yet. Builds start once it has kept a character.')}</p>`;
  const list = builds.length
    ? `<ul class="build-list">${builds.map(card).join('')}</ul>`
    : `<p class="armory-empty">${t('No build yet. Start one above, or open a character in the armory and choose Copy to builds.')}</p>`;
  return `<main class="dashboard builds-page"><div class="heading"><div><h1>${t('Builds')}<span class="mint">.</span></h1><p>${t('Put a character together by clicking: gear with its enchantment, stones and soul binding, skills and the Daevanion boards, from what the armory knows of each class. Share a build with a link.')}</p></div><div class="heading-actions"><a class="button secondary" href="${esc(link('/armory'))}">${icon('search')} ${t('Armory')}</a></div></div>
<section class="armory-panel build-start"><div class="section-heading"><h2>${t('New build')} <span>${number(builds.length)} / ${number(limit)}</span></h2></div>${form}<p class="build-hint">${icon('info')}<span>${t('To start from a character, open its armory profile and choose Copy to builds: its gear, skills and nodes come along.')}</span></p></section>
<section class="build-section"><div class="section-heading"><h2>${t('Your builds')}</h2></div>${list}</section></main>`;
}

// The tabs of a build's page.
export function buildTabsOf() {
  return [
    ['', t('Gear & stats')],
    ['skills', t('Skills')],
    ['daevanion', t('Daevanion')],
    ['compare', t('Compare')],
  ];
}

// One slot of the paper doll: in a build its player edits, a button that opens the slot's editor;
// the item's card on hover or focus.
function slotTile(images, slot, g, editable) {
  const label = slotLabel(slot);
  const text = g
    ? `<span class="armory-gear-text"><small>${esc(label)}${g.detail?.category && /^(MainHand|SubHand|Arcana\d)$/.test(slot) ? ` · ${esc(g.detail.category)}` : ''}</small><strong>${esc(g.name)}</strong>${g.detail?.itemLevel ? `<span>${esc(t('item level {n}', { n: number(g.detail.itemLevel) }))}</span>` : g.grade ? `<span>${esc(gradeName(g.grade))}</span>` : ''}${tileMeters(g)}</span>`
    : `<span class="armory-gear-text"><small>${esc(label)}</small><strong>${editable ? t('Choose an item') : t('Empty')}</strong></span>`;
  const art = g ? itemIcon(images, g) : `<span class="armory-icon is-empty" aria-hidden="true"></span>`;
  const what = g
    ? [`${label}: ${g.enchant ? `+${g.enchant} ` : ''}${g.name}`, tileLabel(g)].filter(Boolean).join(', ')
    : `${label}: ${t('Empty')}`;
  const tip = g ? itemTip(images, g, false) : '';
  if (editable)
    return `<li class="armory-gear-slot build-slot-tile ${g ? gradeClass(g.grade) : 'is-empty'}"><button type="button" class="build-slot" data-build-slot="${esc(slot)}" aria-haspopup="dialog">${art}${text}<span class="build-slot-edit" aria-hidden="true">${icon('gear')}</span><span class="sr-only">${t('Change the item')}</span></button>${tip}</li>`;
  return g
    ? `<li class="armory-gear-slot ${gradeClass(g.grade)}" tabindex="0" aria-label="${esc(what)}">${art}${text}${tip}</li>`
    : `<li class="armory-gear-slot is-empty">${art}${text}</li>`;
}

function gearTab(p, images, editable, notes) {
  const bySlot = new Map(p.gear.map(g => [g.slot, g]));
  const tile = slot => slotTile(images, slot, bySlot.get(slot), editable);
  const column = (title, slots) =>
    `<div class="armory-doll-column"><h3>${title}</h3><ul class="armory-gear">${slots.map(tile).join('')}</ul></div>`;
  const notesPanel = editable
    ? `<aside class="armory-panel build-notes"><div class="section-heading"><h2>${t('Notes')}</h2></div><label class="sr-only" for="build-notes">${t('Notes')}</label><textarea id="build-notes" name="notes" maxlength="2000" rows="8" data-build-notes="1" placeholder="${esc(t('Rotation, where the items come from, what to get first…'))}">${esc(notes)}</textarea><p class="build-hint">${t('Saved with the build as you type.')}</p></aside>`
    : notes
      ? `<aside class="armory-panel build-notes"><div class="section-heading"><h2>${t('Notes')}</h2></div><p class="build-notes-text">${esc(notes)}</p></aside>`
      : '';
  return `<div class="armory-loadout build-loadout"><section class="armory-panel armory-doll">${p.gear.length ? gearSummaryStrip(p, slotLabel) : ''}<div class="armory-doll-columns">${column(t('Weapons and armour'), armourSlots)}${column(t('Accessories'), accessorySlots)}</div><div class="armory-doll-row"><h3>${t('Arcana')}</h3><ul class="armory-gear is-row">${arcanaSlots.map(tile).join('')}</ul></div><div class="armory-doll-row"><h3>${t('Pet and wings')}</h3><ul class="armory-gear is-row">${companionSlots.map(tile).join('')}</ul></div></section>${notesPanel}</div>${p.gear.some(g => g.detail) ? statSourcesPanel(p, slotLabel) : ''}`;
}

const skillGroups = () => [
  ['Active', t('Active skills')],
  ['Passive', t('Passive skills')],
  ['Dp', t('Stigma skills')],
];

// The skills of the class: each with its level and whether it is on the skill bar, and what the
// build's gear and boards add to it; in a build its player edits, buttons that change them.
function skillsTab(p, images, editable) {
  const boosts = new Map();
  const add = (name, key, n) => {
    const row = boosts.get(name) || { gear: 0, boards: 0 };
    row[key] += n;
    boosts.set(name, row);
  };
  for (const g of p.gear) for (const s of g.detail?.subSkills || []) add(s.name, 'gear', Number(s.level) || 0);
  for (const b of p.boards)
    for (const e of b.skillEffects || []) {
      const m = String(e).match(/^(.*?)\s*\+(\d+)$/);
      if (m) add(m[1], 'boards', Number(m[2]));
    }
  const row = s => {
    const extra = boosts.get(s.name);
    const more = [
      extra?.gear ? t('+{n} from gear', { n: extra.gear }) : '',
      extra?.boards ? t('+{n} from Daevanion', { n: extra.boards }) : '',
    ].filter(Boolean);
    const state = !s.level ? t('Not learned') : s.equipped ? t('On the skill bar') : t('Learned');
    const art = `<span class="armory-icon is-skill${imageUrl(images, s.icon) ? '' : ' is-empty'}" aria-hidden="true">${picture(images, s.icon)}</span>`;
    const controls = editable
      ? `<span class="build-stepper" role="group" aria-label="${esc(t('Level of {name}', { name: s.name }))}"><button type="button" class="build-step" data-build-level="${esc(s.name)}" data-step="-1" aria-label="${esc(t('Lower {name}', { name: s.name }))}" ${s.level <= 0 ? 'disabled' : ''}>−</button><b>${number(s.level)}</b><button type="button" class="build-step" data-build-level="${esc(s.name)}" data-step="1" aria-label="${esc(t('Raise {name}', { name: s.name }))}" ${s.level >= planLimits.skillLevel ? 'disabled' : ''}>+</button></span><button type="button" class="button secondary build-bar" data-build-bar="${esc(s.name)}" aria-pressed="${s.equipped}">${s.equipped ? icon('tick') + ' ' : ''}${s.category === 'Dp' ? t('Chosen') : t('On the bar')}</button>`
      : `<b class="build-level">${esc(t('Level {level}', { level: s.level }))}</b>`;
    return `<li class="build-skill${s.equipped ? ' is-equipped' : ''}${s.level ? '' : ' is-locked'}">${art}<span class="build-skill-text"><strong>${esc(s.name)}</strong><small>${esc([state, s.maxLevel ? t('up to level {n} seen', { n: s.maxLevel }) : '', ...more].filter(Boolean).join(' · '))}</small></span>${controls}</li>`;
  };
  const groups = skillGroups()
    .map(([category, title]) => [title, p.skills.filter(s => s.category === category)])
    .filter(([, list]) => list.length);
  const others = p.skills.filter(s => !skillGroups().some(([category]) => category === s.category));
  if (others.length) groups.push([t('Other skills'), others]);
  if (!groups.length)
    return `<section class="armory-panel"><p class="armory-empty">${t('The armory knows no skill of this class yet.')}</p></section>`;
  return `${skillBoostPanel(p)}${groups.map(([title, list]) => `<section class="armory-panel"><div class="section-heading"><h2>${esc(title)} <span>${number(list.filter(s => s.equipped).length)} ${esc(t('on the bar'))} · ${number(list.filter(s => s.level).length)} / ${number(list.length)}</span></h2></div><ul class="build-skills">${list.map(row).join('')}</ul></section>`).join('')}`;
}

const nodeValue = s => `+${number(Math.round(s.value * 10) / 10)}${s.percent ? '%' : ''}`;
const nodeCode = (stats, kind = 'armory-node-code') =>
  `<span class="${kind}">${stats[0]?.prefix ? `<small>${esc(stats[0].prefix)}</small>` : ''}<b>${esc(stats.map(s => s.code).join('/'))}</b></span>`;
const percent = (part, whole) => (whole ? Math.min(100, Math.round((part / whole) * 100)) : 0);

// The class's Daevanion boards with the build's nodes open: in a build its player edits, a node
// opens or closes when pressed (app/builds.js), and each board opens or closes whole.
function daevanionTab(p, images, chosen, editable) {
  if (!p.boards.length)
    return `<section class="armory-panel"><p class="armory-empty">${t('The armory knows no Daevanion board of this class yet: it learns them from the profiles players open.')}</p></section>`;
  const board = p.boards.find(b => String(b.id) === String(chosen)) || p.boards[0];
  const pick = b =>
    `<button type="button" class="armory-board-pick${b === board ? ' is-active' : ''}" data-build-board="${esc(b.id)}" aria-pressed="${b === board}">${picture(images, b.icon, 'armory-board-art')}<span><strong>${esc(b.name)}</strong><small>${number(b.open)} / ${number(b.total)}</small></span><span class="armory-track"><i style="width:${percent(b.open, b.total)}%"></i></span></button>`;
  const nodes = boardNodes(board, p.skills);
  const top = Math.min(...nodes.map(n => n.row)),
    left = Math.min(...nodes.map(n => n.col));
  const rows = nodes.length ? Math.max(...nodes.map(n => n.row)) - top + 1 : 1,
    cols = nodes.length ? Math.max(...nodes.map(n => n.col)) - left + 1 : 1;
  const face = n =>
    n.skill
      ? `<span class="armory-node-face" aria-hidden="true">${picture(images, n.skill.of?.icon) || `<b>${esc(initials(n.skill.name))}</b>`}<em>+${number(n.skill.levels)}</em></span>`
      : n.stats.length
        ? n.stats.length > 1
          ? `<span class="armory-node-face is-pair" aria-hidden="true">${n.stats[0].prefix ? `<small>${esc(n.stats[0].prefix)}</small>` : ''}${n.stats.map(s => `<span><b>${esc(s.code)}</b> <em>${nodeValue(s)}</em></span>`).join('')}</span>`
          : `<span class="armory-node-face" aria-hidden="true">${nodeCode(n.stats)}<em>${nodeValue(n.stats[0])}</em></span>`
        : '<span class="armory-node-face" aria-hidden="true"></span>';
  const what = n => (n.kind === 'start' ? t('Start') : n.effects.join(', ') || n.name);
  // What a stat node shows ("PvE ATK +3"): a node that is a button is named with it first.
  const faceText = n =>
    [n.stats[0]?.prefix, ...n.stats.map(s => `${s.code} ${nodeValue(s)}`)].filter(Boolean).join(' ');
  const side = n => {
    const col = n.col - left + 1,
      row = n.row - top + 1;
    return `${col <= cols / 3 ? ' is-west' : col > cols - cols / 3 ? ' is-east' : ''}${row > rows - rows / 3 ? ' is-south' : ''}`;
  };
  const tip = n =>
    `<div class="armory-tip armory-node-tip" role="tooltip"><header class="${gradeClass(n.grade)}">${n.stats.length ? nodeCode(n.stats, 'armory-node-code is-chip') : ''}<div><strong>${esc(what(n))}</strong><small>${esc(n.kind === 'start' ? board.name : [gradeName(n.grade), n.open ? t('Open') : t('Closed')].filter(Boolean).join(' · '))}</small></div></header></div>`;
  // A node is a toggle where the player edits (role button, pressed while open); the arrow keys
  // move between nodes (app/armory.js), so the board is one stop of the Tab key.
  const node = (n, i) => {
    const toggle = editable && n.kind !== 'start';
    return `<div class="armory-node ${gradeClass(n.grade)} is-${esc(n.kind)}${n.open ? ' is-open' : ''}${toggle ? ' is-toggle' : ''}${side(n)}" ${toggle ? `role="button" aria-pressed="${n.open}" data-build-node="${n.row},${n.col}"` : 'role="listitem"'} tabindex="${i ? -1 : 0}" style="grid-row:${n.row - top + 1};grid-column:${n.col - left + 1}" aria-label="${esc(`${toggle && n.stats.length ? faceText(n) + ': ' : ''}${what(n)}, ${n.open ? t('open') : t('closed')}`)}">${face(n)}${tip(n)}</div>`;
  };
  const summary = boardSummary(nodes);
  const count = r =>
    `<small>${esc(tn(r.total, '{open} of {n} node', '{open} of {n} nodes', { open: number(r.open) }))}</small>`;
  const statRows = summary.stats.map(
    r =>
      `<li class="${r.open ? '' : 'is-none'}">${nodeCode([r], 'armory-node-code is-chip')}<span>${esc(r.name)}${r.open ? ` <b>${nodeValue(r)}</b>` : ''}${count(r)}</span></li>`,
  );
  const skillRows = summary.skills.map(
    r =>
      `<li class="${r.open ? '' : 'is-none'}"><span class="armory-icon is-skill is-small${imageUrl(images, r.of?.icon) ? '' : ' is-empty'}" aria-hidden="true">${picture(images, r.of?.icon)}</span><span>${esc(r.name)}${r.open ? ` <b>+${number(r.levels)}</b>` : ''}${count(r)}</span></li>`,
  );
  const list = (title, items) =>
    items.length ? `<h4>${title}</h4><ul class="armory-board-list">${items.join('')}</ul>` : '';
  const open = p.boards.reduce((n, b) => n + b.open, 0),
    total = p.boards.reduce((n, b) => n + b.total, 0);
  const tools = editable
    ? `<div class="build-board-tools"><button type="button" class="button secondary" data-build-fill="${esc(board.id)}">${t('Open every node')}</button><button type="button" class="button secondary" data-build-clear="${esc(board.id)}" ${board.open ? '' : 'disabled'}>${t('Close every node')}</button></div>`
    : '';
  return `<section class="armory-panel"><div class="section-heading"><h2>${t('Daevanion')} <span>${number(open)} / ${number(total)}</span></h2></div><div class="armory-board-picks">${p.boards.map(pick).join('')}</div></section>
<section class="armory-panel armory-board build-board"><div class="armory-board-view"><div><h3>${esc(board.name)} <span>${number(board.open)} / ${number(board.total)} · ${percent(board.open, board.total)} %</span></h3>${editable ? `<p class="build-hint">${t('Press a node to open or close it. Points are not counted: plan freely.')}</p>` : ''}<div class="armory-board-scroll"><div class="armory-board-grid" style="--cols:${cols};grid-template-columns:repeat(${cols},minmax(0,1fr));grid-template-rows:repeat(${rows},auto)" role="${editable ? 'group' : 'list'}" data-build-grid="${esc(board.id)}" aria-label="${esc(t('{name}: {open} of {total} nodes open', { name: board.name, open: number(board.open), total: number(board.total) }))}">${nodes.map(node).join('')}</div></div><p class="armory-legend"><span class="is-open"></span>${t('Open')}<span></span>${t('Closed')}</p>${tools}</div><aside class="armory-board-effects"><h3>${t('Board effect')}</h3>${list(t('Stat effect'), statRows) + list(t('Skill effect'), skillRows) || `<p class="armory-empty">${t('No effect yet.')}</p>`}</aside></div></section>`;
}

// What a character still needs of the build (buildGap): the character it was made from, or one
// of the bookmarks, chosen above.
function compareTab(p, view) {
  const choices = view.compareChoices || [],
    chosen = view.compareWith || '';
  const select = choices.length
    ? `<label class="build-compare-pick">${t('Compare with')}<select data-build-compare="1">${choices.map(c => `<option value="${esc(c.key)}" ${c.key === chosen ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label>`
    : '';
  const intro = `<section class="armory-panel build-compare-head"><div class="section-heading"><h2>${t('What a character still needs')}</h2></div><p>${t('Compare the build with the character it was made from, or with a character you bookmarked in the armory.')}</p>${select}</section>`;
  if (!choices.length)
    return `${intro}<section class="armory-panel"><p class="armory-empty">${t('This build was not made from a character. Bookmark characters in the armory to compare it with them.')}</p></section>`;
  const answer = view.compare;
  if (!answer)
    return `${intro}<section class="armory-panel"><p class="armory-empty" role="status">${t('Loading the character…')}</p></section>`;
  if (answer.error || !answer.profile)
    return `${intro}<section class="armory-panel"><p class="armory-empty">${t('The armory does not keep this character yet. Open its profile, then come back.')}</p></section>`;
  const c = answer.profile;
  if (c.class && p.class && c.class !== p.class)
    return `${intro}<section class="armory-panel"><p class="armory-empty">${esc(t('{name} is a {class}: this build is for another class.', { name: c.name, class: c.class }))}</p></section>`;
  const gap = buildGap(p, c);
  const images = view.images || '';
  const who = `<a href="${esc(link(profilePath(answer)))}">${esc(c.name)}</a>`;
  if (gap.done)
    return `${intro}<section class="armory-panel build-gap-done"><p>${icon('tick')} ${t('{name} already has everything this build holds.', { name: who })}</p></section>`;
  const item = g =>
    g
      ? `${itemIcon(images, g, 'is-small')}<span>${g.enchant ? `+${number(g.enchant)} ` : ''}${esc(g.name)}</span>`
      : `<span class="is-none">${t('Empty')}</span>`;
  const gearRows = gap.gear.map(r => {
    const steps =
      r.kind === 'item'
        ? t('Get the item')
        : [
            r.enchant ? t('{n} more enchantment levels', { n: r.enchant }) : '',
            r.exceed ? t('{n} more exceed levels', { n: r.exceed }) : '',
            r.stones ? tn(r.stones, '{n} more stone', '{n} more stones') : '',
          ]
            .filter(Boolean)
            .join(' · ');
    return `<li><span class="build-gap-slot">${esc(slotLabel(r.slot))}</span><span class="build-gap-item">${item(r.have)}</span><span class="build-gap-arrow" aria-hidden="true">${icon('arrow')}</span><span class="build-gap-item">${item(r.want)}</span><small>${esc(steps)}</small></li>`;
  });
  const boardRows = gap.boards.map(b => {
    const summary = sumNodes(b.nodes);
    return `<li><strong>${esc(b.name)}</strong> <span>${esc(tn(b.missing, '{n} node to open', '{n} nodes to open'))}</span>${summary ? `<small>${esc(summary)}</small>` : ''}${b.known ? '' : `<small>${t("PLAYNC did not list this board's nodes for the character: its open nodes may be fewer than these.")}</small>`}</li>`;
  });
  const skillRows = gap.skills.map(
    s =>
      `<li><span class="armory-icon is-skill is-small${imageUrl(images, s.icon) ? '' : ' is-empty'}" aria-hidden="true">${picture(images, s.icon)}</span><strong>${esc(s.name)}</strong><span>${esc([s.want > s.have ? t('level {have} → {want}', { have: s.have, want: s.want }) : '', s.bar ? t('put on the skill bar') : ''].filter(Boolean).join(' · '))}</span></li>`,
  );
  const part = (title, rows, kind) =>
    rows.length
      ? `<section class="armory-panel"><div class="section-heading"><h2>${title} <span>${number(rows.length)}</span></h2></div><ul class="build-gap ${kind}">${rows.join('')}</ul></section>`
      : '';
  return `${intro}<p class="build-gap-who">${t('What {name} still needs for this build:', { name: who })}</p>${part(t('Gear'), gearRows, 'is-gear')}${part(t('Daevanion'), boardRows, 'is-boards')}${part(t('Skills'), skillRows, 'is-skills')}`;
}

// Missing nodes summed up by what they give ("Attack +9, Bolt +1").
function sumNodes(nodes) {
  const totals = new Map();
  for (const n of boardNodes({ nodes }, []))
    for (const s of n.stats) {
      const key = `${s.name}${s.percent ? '%' : ''}`,
        row = totals.get(key) || { name: s.name, percent: s.percent, value: 0 };
      row.value += s.value;
      totals.set(key, row);
    }
  return [...totals.values()]
    .sort((a, b) => b.value - a.value)
    .slice(0, 6)
    .map(r => `${r.name} ${nodeValue(r)}`)
    .join(', ');
}

// Where saving stands, for a build its player edits (app/builds.js redraws it in place).
export const saveNote = saving =>
  saving === 'saving'
    ? `<span class="build-save is-saving" role="status"><span class="armory-spinner" aria-hidden="true"></span>${t('Saving…')}</span>`
    : saving === 'failed'
      ? `<span class="build-save is-failed" role="status">${icon('alert')} ${t('Not saved. Odyle tries again with your next change.')}</span>`
      : saving === 'saved'
        ? `<span class="build-save" role="status">${icon('tick')} ${t('Saved')}</span>`
        : '';

// A build's page: its name and class, what it holds at a glance, the actions its player has (share,
// rename, delete) or a reader has (save a copy), and its tabs. view: { tab, board, images, editable,
// saving, signedIn, classIcon, catalog (the class's, null while it loads, { error }), compare… }.
export function buildPage(build, view = {}) {
  const catalog = view.catalog && !view.catalog.error ? view.catalog : null;
  const p = buildProfile(build, catalog),
    images = view.images || '',
    editable = Boolean(view.editable);
  const tabs = buildTabsOf(),
    tab = tabs.some(([key]) => key === view.tab) ? view.tab : '';
  const shared = Boolean(build.code);
  const path = key => (shared ? sharedPath(build.code, key) : buildPath(build.id, key));
  const plan = normalPlan(build.plan);
  const nodes = p.boards.reduce((n, b) => n + b.open, 0),
    total = p.boards.reduce((n, b) => n + b.total, 0);
  const enchantable = p.gear.filter(g => g.detail?.maxEnchant);
  const metrics = [
    [t('Items'), number(p.gear.length), t('of {n} slots', { n: buildSlots.length })],
    enchantable.length
      ? [
          t('Enchantment'),
          `+${number(Math.round((enchantable.reduce((n, g) => n + g.enchant, 0) / enchantable.length) * 10) / 10)}`,
          t('on average'),
        ]
      : null,
    [
      t('Daevanion'),
      total ? `${percent(nodes, total)} %` : number(nodes),
      t('{open} of {total} nodes', { open: number(nodes), total: number(total) }),
    ],
    [t('Skill bar'), number(p.skills.filter(s => s.equipped).length), t('skills on it')],
  ].filter(Boolean);
  const from = plan.from?.name
    ? `<span>${icon('user')}<a href="${esc(link(profilePath(plan.from)))}">${esc(t('from {name}', { name: plan.from.name }))}</a></span>`
    : '';
  const copyLink = `<button class="button secondary" data-action="build-copy-link">${icon('link')} ${t('Copy link')}</button>`,
    copy = `<button class="button secondary" data-action="build-duplicate">${icon('copy')} ${t('Make a copy')}</button>`;
  const actions = editable
    ? `${build.share ? `${copyLink}<button class="button secondary" data-action="build-unshare">${t('Stop sharing')}</button>` : `<button class="button primary" data-action="build-share">${icon('share')} ${t('Share')}</button>`}${copy}<button class="button secondary" data-action="build-rename" aria-haspopup="dialog">${icon('gear')} ${t('Rename')}</button><button class="button secondary" data-action="build-delete" aria-haspopup="dialog">${icon('trash')} ${t('Delete')}</button>`
    : build.mine
      ? `<a class="button primary" href="${esc(link(buildPath(build.id, tab)))}">${icon('gear')} ${t('Edit this build')}</a>${copy}${copyLink}`
      : view.signedIn
        ? `<button class="button primary" data-action="build-save-copy">${icon('copy')} ${t('Save a copy')}</button>${copyLink}`
        : `<button class="button primary" data-action="build-sign-in">${icon('copy')} ${t('Sign in to save a copy')}</button>${copyLink}`;
  const eyebrow = shared ? t('Shared build') : build.share ? t('Your build · shared') : t('Your build · private');
  const hero = `<section class="armory-hero build-hero"><div class="armory-portrait build-mark" aria-hidden="true">${classBadge(images, view.classIcon, '') || `<span>${esc(initials(build.class))}</span>`}</div>
<div class="armory-identity"><p class="armory-eyebrow">${esc(eyebrow)}</p><h1>${esc(build.name)}</h1><p class="armory-tags"><span>${classBadge(images, view.classIcon, build.class)}${esc(build.class)}</span>${from}${build.updated ? `<span>${esc(t('changed {age}', { age: age(build.updated, view.now || Date.now()) }))}</span>` : ''}</p></div>
<div class="armory-hero-actions">${actions}${editable ? `<div class="build-save-slot" aria-live="polite">${saveNote(view.saving)}</div>` : ''}</div>
<dl class="armory-power">${metrics.map(([label, value, small], i) => `<div class="${i ? '' : 'is-main'}"><dt>${esc(label)}</dt><dd><strong>${esc(value)}</strong><small>${esc(small)}</small></dd></div>`).join('')}</dl></section>`;
  const catalogNote = !view.catalog
    ? `<div class="armory-status is-waiting" role="status"><span class="armory-spinner" aria-hidden="true"></span><span>${t('Loading what the armory knows of the class…')}</span></div>`
    : view.catalog.error
      ? `<div class="armory-status is-failed" role="status">${icon('alert')}<span>${t('What the armory knows of the class did not load. The build shows without item details.')}</span></div>`
      : !catalog.characters
        ? `<div class="armory-status" role="status">${icon('info')}<span>${esc(t('The armory keeps no {class} yet, so there is nothing to choose from. It learns a class from the profiles players open.', { class: build.class }))}</span></div>`
        : editable
          ? `<p class="armory-note">${icon('info')}<span>${esc(tn(catalog.characters, 'Items, stones, skills and nodes to choose from come from the {n} {class} the armory keeps. Values at other enchantment levels are estimates.', 'Items, stones, skills and nodes to choose from come from the {n} {class}s the armory keeps. Values at other enchantment levels are estimates.', { class: build.class }))}</span></p>`
          : '';
  const nav = `<nav class="armory-tabs" aria-label="${esc(t('Build sections'))}">${tabs.map(([key, label]) => `<a href="${esc(link(path(key)))}"${key === tab ? ' aria-current="page"' : ''}>${esc(label)}</a>`).join('')}</nav>`;
  const content =
    tab === 'skills'
      ? skillsTab(p, images, editable)
      : tab === 'daevanion'
        ? daevanionTab(p, images, view.board, editable)
        : tab === 'compare'
          ? compareTab(p, { ...view, images })
          : gearTab(p, images, editable, plan.notes);
  const back = view.signedIn
    ? `<a class="text-button armory-back" href="${esc(link(buildsPath))}">${icon('arrow')} ${t('All your builds')}</a>`
    : `<a class="text-button armory-back" href="${esc(link('/armory'))}">${icon('arrow')} ${t('Armory')}</a>`;
  return `<main class="dashboard armory build-page${editable ? ' is-editing' : ''}">${hero}${catalogNote}${nav}<div class="armory-tab">${content}</div>${back}</main>`;
}

// ---------------------------------------------------------------- The slot editor

// What a slot's editor shows chosen at first: the build's entry there.
export function slotChoice(entry) {
  if (!entry) return { item: '', enchant: 0, exceed: 0, level: 0, stones: [], gods: [], sub: [], skills: [] };
  return {
    item: itemKey(entry),
    enchant: entry.enchant || 0,
    exceed: entry.exceed || 0,
    level: entry.level || 0,
    stones: (entry.stones || []).map(s => `${s.name}|${s.value || ''}|${s.grade || ''}`),
    gods: (entry.gods || []).map(s => `${s.name}|${s.grade || ''}`),
    sub: (entry.sub || []).map(l => `${l.name}|${l.value}`),
    skills: (entry.skills || []).map(s => `${s.name}|${s.level}`),
  };
}

const range = (from, to) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
const options = (list, chosen, empty) =>
  `${empty ? `<option value="">${esc(empty)}</option>` : ''}${list.map(([value, label]) => `<option value="${esc(value)}" ${String(value) === String(chosen) ? 'selected' : ''}>${esc(label)}</option>`).join('')}`;

// The rest of the editor for the item chosen: its enchantment, exceed level (a pet its level), the
// stones in its slots, the theostones, the soul binding's stats and the skills it raises.
export function slotDetails(slot, catalog, choice) {
  const s = slotOf(catalog, slot);
  if (!choice.item) return `<p class="build-hint">${t('No item: the slot stays empty.')}</p>`;
  const [name, grade = ''] = choice.item.split('|');
  const item = catalogItem(catalog, slot, name, grade) || {
    name,
    grade,
    maxEnchant: choice.enchant,
    maxExceed: choice.exceed,
  };
  const fields = [];
  const select = (label, field, list, chosen, empty) =>
    `<label>${esc(label)}<select name="${field}">${options(list, chosen, empty)}</select></label>`;
  if (item.maxEnchant || choice.enchant)
    fields.push(
      select(
        t('Enchantment'),
        'enchant',
        range(0, Math.max(item.maxEnchant || 0, choice.enchant)).map(n => [n, `+${n}`]),
        choice.enchant,
      ),
    );
  if (item.maxExceed || choice.exceed)
    fields.push(
      select(
        t('Exceed'),
        'exceed',
        range(0, Math.max(item.maxExceed || 0, choice.exceed)).map(n => [n, n ? `✦${n}` : '0']),
        choice.exceed,
      ),
    );
  if (item.maxLevel || choice.level)
    fields.push(
      select(
        t('Level'),
        'level',
        range(0, Math.max(item.maxLevel || 0, choice.level)).map(n => [n, String(n)]),
        choice.level,
      ),
    );
  const group = (title, body) =>
    body ? `<fieldset class="build-picks"><legend>${title}</legend>${body}</fieldset>` : '';
  const many = (field, count, list, chosen, label, empty) =>
    range(0, count - 1)
      .map(i => {
        const value = chosen[i] || '';
        const known = list.some(([v]) => v === value);
        const all = value && !known ? [[value, value.split('|').filter(Boolean).join(' ')], ...list] : list;
        return `<label class="build-pick"><span class="sr-only">${esc(label(i + 1))}</span><select name="${field}">${options(all, value, empty)}</select></label>`;
      })
      .join('');
  const stoneList = (s?.stones || []).map(x => [
    `${x.name}|${x.value || ''}|${x.grade || ''}`,
    `${x.name} ${x.value || ''} · ${gradeName(x.grade)}`.trim(),
  ]);
  const stoneSlots = Math.min(planLimits.stones, Math.max(item.stoneSlots || 0, choice.stones.length));
  const isAccessory = /^(Necklace|Amulet|Earring|Ring|Bracelet)/.test(slot) || item.kind === 'Accessory';
  const stones = stoneSlots
    ? group(
        isAccessory ? t('Soulstones') : t('Manastones'),
        many('stone', stoneSlots, stoneList, choice.stones, n => t('Stone slot {n}', { n }), t('Empty slot')),
      )
    : '';
  const godList = (s?.gods || []).map(x => [`${x.name}|${x.grade || ''}`, `${x.name} · ${gradeName(x.grade)}`]);
  const godSlots = Math.min(planLimits.gods, Math.max(item.godSlots || 0, choice.gods.length));
  const gods = godSlots
    ? group(
        t('Theostones'),
        many('god', godSlots, godList, choice.gods, n => t('Theostone slot {n}', { n }), t('Empty slot')),
      )
    : '';
  // Soul binding: each stat the slot's items roll at the lowest, usual and highest value seen.
  const rolled = [];
  for (const r of s?.rolled || [])
    for (const [v, how] of [
      [r.value, t('usual')],
      [r.high, t('highest seen')],
      [r.low, t('lowest seen')],
    ]) {
      const text = `${Math.round(v * 100) / 100}${r.percent ? '%' : ''}`;
      if (!rolled.some(([value]) => value === `${r.name}|${text}`))
        rolled.push([`${r.name}|${text}`, `${r.name} ${text} (${how})`]);
    }
  // A weapon rolls one line more than PLAYNC's count says, so one more is offered.
  const subCount = Math.min(
    planLimits.sub,
    Math.max((item.subCount || 0) + (rolled.length ? 1 : 0), choice.sub.length),
  );
  const sub = subCount
    ? group(
        t('Soul binding'),
        many('sub', subCount, rolled, choice.sub, n => t('Soul binding stat {n}', { n }), t('None')),
      )
    : '';
  // Skills the slot's items raise (an arcana's, a soul binding's), each at the levels seen.
  const boosts = [];
  for (const b of s?.boosts || [])
    for (const n of range(1, Math.max(1, b.high || b.level || 1))) boosts.push([`${b.name}|${n}`, `${b.name} +${n}`]);
  const raises = boosts.length
    ? Math.min(planLimits.skills, Math.max(/^Arcana/.test(slot) ? 4 : 1, choice.skills.length))
    : 0;
  const skills = raises
    ? group(
        t('Skills it raises'),
        many('skill', raises, boosts, choice.skills, n => t('Raised skill {n}', { n }), t('None')),
      )
    : '';
  const facts = [
    item.itemLevel ? t('item level {n}', { n: number(item.itemLevel) }) : '',
    item.set ? t('Set: {name}', { name: item.set.name }) : '',
    item.sources?.length ? `${t('How to obtain')}: ${item.sources.join(', ')}` : '',
  ].filter(Boolean);
  return `${facts.length ? `<p class="build-item-facts">${esc(facts.join(' · '))}</p>` : ''}${fields.length ? `<div class="build-levels">${fields.join('')}</div>` : ''}${stones}${gods}${sub}${skills}`;
}

// The editor of one slot: every item the armory saw there for the class (filterable), then the
// details of the one chosen (slotDetails). choice is what slotChoice gives.
export function slotEditor(slot, catalog, choice, images = '') {
  const s = slotOf(catalog, slot);
  const items = [...(s?.items || [])];
  if (choice.item && !items.some(i => itemKey(i) === choice.item)) {
    const [name, grade = ''] = choice.item.split('|');
    items.unshift({ name, grade, count: 0 });
  }
  const row = i => {
    const key = itemKey(i);
    const facts = [
      gradeName(i.grade),
      i.itemLevel ? t('item level {n}', { n: number(i.itemLevel) }) : '',
      i.count ? tn(i.count, 'worn by {n}', 'worn by {n}') : '',
    ].filter(Boolean);
    return `<label class="build-item ${gradeClass(i.grade)}" data-name="${esc(i.name.toLowerCase())}"><input type="radio" name="item" value="${esc(key)}" ${key === choice.item ? 'checked' : ''} data-build-item="1">${itemIcon(images, { ...i, enchant: 0, exceed: 0, level: 0 }, 'is-small')}<span><strong>${esc(i.name)}</strong><small>${esc(facts.join(' · '))}</small></span></label>`;
  };
  const list = items.length
    ? `<input type="search" class="build-item-filter" data-build-filter="1" placeholder="${esc(t('Filter items'))}" aria-label="${esc(t('Filter items'))}" autocomplete="off"><div class="build-item-list" role="radiogroup" aria-label="${esc(t('Item'))}"><label class="build-item is-none" data-name=""><input type="radio" name="item" value="" ${choice.item ? '' : 'checked'} data-build-item="1"><span class="armory-icon is-small is-empty" aria-hidden="true"></span><span><strong>${t('Empty')}</strong><small>${t('No item in this slot')}</small></span></label>${items.map(row).join('')}</div>`
    : `<p class="build-hint">${t('The armory has seen no item in this slot for the class yet.')}</p>`;
  return `<form id="build-slot-form" class="build-slot-form" data-slot="${esc(slot)}"><fieldset class="build-items"><legend>${t('Item')}</legend>${list}</fieldset><div class="build-item-details">${slotDetails(slot, catalog, choice)}</div><div class="build-dialog-actions"><button class="button primary" type="submit">${icon('tick')} ${t('Done')}</button><button class="button secondary" type="button" data-action="close-dialog">${t('Cancel')}</button></div></form>`;
}

// The rename dialog's form.
export const renameForm = name =>
  `<form id="build-rename-form" class="build-rename-form"><label>${t('Name')}<input name="name" maxlength="60" autocomplete="off" required value="${esc(name)}"></label><div class="build-dialog-actions"><button class="button primary" type="submit">${t('Save name')}</button><button class="button secondary" type="button" data-action="close-dialog">${t('Cancel')}</button></div></form>`;
