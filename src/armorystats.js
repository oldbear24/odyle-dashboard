// Where a character's stats come from, and its gear at a glance (armorydetail.js shows both): pure
// functions over a kept profile (backend/odyle/armory.go armoryProfile), with no texts of their own.
//
// The sources are what the profile lists as numbers: the items' properties (detail.main: value plus
// the enchantment's extra; an exceed line has only its extra), their soul binding (detail.sub), the
// manastones and soulstones engraved in them (detail.stones), the bonuses of the sets with enough
// pieces on (detail.set.bonuses), the open Daevanion nodes (boards[].statEffects) and the titles worn
// (titles.equipped[].effects). A line counts only when it reads "Name +12", "Name +1.5%", "Name -2.8%"
// or "Name 630"; anything else ("+60 PvE Attack when HP is 70% or more") is left out, never guessed,
// and listed as not counted. A flat value and a percent of the same name are two stats.
//
// A weapon's attack is a range ("Attack 446 ~ 604 (+174)"): it counts as low = minimum + extra and
// high = value + extra, and every total it is part of keeps both ends. All other lines add the same to
// both. Godstones (theostones) say what they do in words, so they are listed apart.

export const statSources = ['gear', 'soul', 'stones', 'sets', 'boards', 'titles'];
export const statGroups = ['primary', 'offence', 'defence', 'utility', 'deity'];

// The doll's slots an item can fill (the companions apart).
export const dollSlots = [
  'MainHand',
  'SubHand',
  'Helmet',
  'Shoulder',
  'Torso',
  'Pants',
  'Gloves',
  'Boots',
  'Cape',
  'Belt',
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
  'Arcana1',
  'Arcana2',
  'Arcana3',
  'Arcana4',
  'Arcana5',
];
const companions = new Set(['Wings', 'Pet']);

// A number as PLAYNC writes it: "630", "+10", "1,100", "9.6%", "-2.8%" (also with a typographic minus).
const valuePattern = /^([+\-−]?)\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(%?)$/;
export function parseValue(text) {
  const m = String(text ?? '')
    .trim()
    .match(valuePattern);
  if (!m) return null;
  const n = Number(m[2].replace(/,/g, '') + (m[3] ? '.' + m[3] : ''));
  return { value: m[1] && m[1] !== '+' ? -n : n, percent: m[4] === '%' };
}

// "Attack Bonus +30" → { name: 'Attack Bonus', value: 30, percent: false }; null for anything else. A
// name starts with a letter and has no digits, plus or percent signs (hyphens are fine: "Multi-hit
// Chance"), so "+60 PvE Attack when HP is 70% or more" and "Restores 1,500 MP when MP is 20% or less"
// are no stat lines.
export function parseEffect(text) {
  const m = String(text ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .match(/^([A-Za-zÀ-ɏ][^\d+%]*?)\s+([+\-−]?\s*[\d,.]+\s*%?)$/);
  if (!m) return null;
  const v = parseValue(m[2]);
  return v ? { name: m[1].trim(), ...v } : null;
}

const round = n => Math.round(n * 1000) / 1000;
const keyOf = (name, percent) => `${name.toLowerCase()}${percent ? ' %' : ''}`;

// Which group a stat goes with: the character's primary and deity stats by their names in its
// stats panel (an arcana's "Time [Siel]" is the deity stat Time), the rest by words in their names.
export function statGroup(name, profileStats = []) {
  const plain = name.replace(/\s*\[.*\]$/, '').toLowerCase();
  const own = profileStats.find(s => String(s.name).toLowerCase() === plain);
  if (own) return own.primary ? 'primary' : 'deity';
  if (/\[.+\]$/.test(name)) return 'deity';
  const n = name.toLowerCase();
  if (/(^|\s)mp(\s|$)|regen|natural|move speed|flight|potion|stamina|mp cost/.test(n)) return 'utility';
  if (/defen|resist|toleran|evasion|block|endurance|^hp$|^hp |regeneration|^recovery/.test(n)) return 'defence';
  if (
    /attack|damage|critical|accuracy|penetration|multi-hit|double|perfect|combat speed|cooldown|status effect/.test(n)
  )
    return 'offence';
  return 'utility';
}

// Every stat the profile's gear, sets, boards and titles give, with each source's share: rows of
// { key, name, percent, group, by: { gear: { low, high }, … }, total: { low, high }, character }, in
// statGroups order, each group's flat stats before its percentages, the largest first. character is
// the value of the stats panel's stat of that name, for the primary and deity stats. skipped lists
// the lines that are no stat line ({ source, text }, each text once), godstones the theostones.
export function statBreakdown(profile) {
  const p = profile || {},
    gear = (p.gear || []).filter(g => g.detail && !companions.has(g.slot)),
    stats = p.stats || [];
  const rows = new Map(),
    skipped = new Map();
  const add = (source, name, low, high, percent) => {
    const key = keyOf(name, percent);
    let row = rows.get(key);
    if (!row) {
      row = { key, name, percent, by: {}, total: { low: 0, high: 0 } };
      rows.set(key, row);
    }
    const share = row.by[source] || (row.by[source] = { low: 0, high: 0 });
    share.low = round(share.low + low);
    share.high = round(share.high + high);
    row.total.low = round(row.total.low + low);
    row.total.high = round(row.total.high + high);
  };
  const skip = (source, text) => {
    const k = `${source}\n${text}`;
    if (String(text || '').trim() && !skipped.has(k)) skipped.set(k, { source, text: String(text) });
  };
  const effect = (source, text) => {
    const e = parseEffect(text);
    if (e) add(source, e.name, e.value, e.value, e.percent);
    else skip(source, text);
  };
  for (const g of gear) {
    const d = g.detail;
    for (const l of d.main || []) {
      if (l.exceed) {
        const v = parseValue(l.extra || l.value);
        if (v) add('gear', l.name, v.value, v.value, v.percent);
        else skip('gear', `${l.name} ${l.extra || l.value}`);
        continue;
      }
      const v = parseValue(l.value),
        min = l.min ? parseValue(l.min) : null,
        extra = l.extra ? parseValue(l.extra) : null;
      if (
        !v ||
        (l.min && (!min || min.percent !== v.percent)) ||
        (l.extra && (!extra || extra.percent !== v.percent))
      ) {
        skip('gear', `${l.name} ${l.min ? `${l.min} ~ ` : ''}${l.value}${l.extra ? ` (+${l.extra})` : ''}`);
        continue;
      }
      const plus = extra ? extra.value : 0;
      add('gear', l.name, (min ? min.value : v.value) + plus, v.value + plus, v.percent);
    }
    for (const l of d.sub || []) {
      const v = parseValue(l.value);
      if (v) add('soul', l.name, v.value, v.value, v.percent);
      else skip('soul', `${l.name} ${l.value}`);
    }
    for (const s of d.stones || []) {
      const v = parseValue(s.value);
      if (v) add('stones', s.name, v.value, v.value, v.percent);
      else skip('stones', `${s.name} ${s.value || ''}`.trim());
    }
  }
  // Each set once (every piece lists it), with the bonuses it has enough pieces on for.
  for (const set of activeSets(gear)) for (const b of set.active) for (const e of b.effects || []) effect('sets', e);
  for (const b of p.boards || []) for (const e of b.statEffects || []) effect('boards', e);
  for (const title of p.titles?.equipped || []) for (const e of title.effects || []) effect('titles', e);
  const list = [...rows.values()]
    .filter(r => r.total.low || r.total.high)
    .map(r => {
      const group = statGroup(r.name, stats);
      const plain = r.name.replace(/\s*\[.*\]$/, '').toLowerCase(),
        own =
          !r.percent && (group === 'primary' || group === 'deity')
            ? stats.find(s => String(s.name).toLowerCase() === plain)
            : null;
      return { ...r, group, character: own ? Number(own.value) || 0 : null };
    });
  list.sort(
    (a, b) =>
      statGroups.indexOf(a.group) - statGroups.indexOf(b.group) ||
      Number(a.percent) - Number(b.percent) ||
      Math.abs(b.total.high) - Math.abs(a.total.high) ||
      a.name.localeCompare(b.name),
  );
  const godstones = [];
  for (const g of gear) for (const s of g.detail.godStones || []) godstones.push({ slot: g.slot, item: g.name, ...s });
  return { rows: list, skipped: [...skipped.values()], godstones };
}

// The sets of the given items, each once: { name, equipped, pieces, active (bonuses with enough
// pieces on), next (the first bonus without), missing (pieces to it) }.
export function activeSets(gear) {
  const sets = new Map();
  for (const g of gear || []) {
    const s = g.detail?.set;
    if (s?.name && !sets.has(s.name)) sets.set(s.name, s);
  }
  return [...sets.values()].map(s => {
    const equipped = Number(s.equipped) || 0,
      bonuses = [...(s.bonuses || [])].sort((a, b) => a.count - b.count);
    const next = bonuses.find(b => b.count > equipped) || null;
    return {
      name: s.name,
      equipped,
      pieces: (s.items || []).length,
      active: bonuses.filter(b => b.count <= equipped),
      next,
      missing: next ? next.count - equipped : 0,
    };
  });
}

// What a doll tile shows at a glance: enchantment of its maximum, exceed level of its maximum, stones
// engraved of their slots and the soul binding's lines (of those it can hold, when PLAYNC's count is
// not below the lines rolled: a weapon lists one more line than it, a bracelet lines with a count of 0).
export function tileFacts(g) {
  const d = g?.detail;
  if (!d) return null;
  const lines = (d.sub || []).length,
    subCount = Number(d.subCount) || 0;
  return {
    enchant: Number(g.enchant) || 0,
    maxEnchant: Number(d.maxEnchant) || 0,
    exceed: Number(g.exceed) || 0,
    maxExceed: Number(d.maxExceed) || 0,
    stones: Math.min((d.stones || []).length, Number(d.stoneSlots) || 0),
    stoneSlots: Number(d.stoneSlots) || 0,
    godStones: Math.min((d.godStones || []).length, Number(d.godSlots) || 0),
    godSlots: Number(d.godSlots) || 0,
    soulLines: lines,
    soulSlots: subCount >= lines ? subCount : 0,
  };
}

// The strip above the doll: average enchantment and its share of the maximum, items at their maximum,
// exceed levels, stone slots filled, soul binding rate, the doll's empty slots and the sets.
export function gearSummary(profile) {
  const gear = (profile?.gear || []).filter(g => !companions.has(g.slot)),
    detailed = gear.filter(g => g.detail);
  const enchantable = detailed.filter(g => Number(g.detail.maxEnchant) > 0);
  const sum = (list, f) => list.reduce((n, x) => n + f(x), 0);
  const enchant = sum(enchantable, g => Math.min(Number(g.enchant) || 0, Number(g.detail.maxEnchant))),
    maxEnchant = sum(enchantable, g => Number(g.detail.maxEnchant));
  const exceedable = detailed.filter(g => Number(g.detail.maxExceed) > 0);
  const facts = detailed.map(tileFacts);
  // The soul binding rate means something on items that roll soul binding (subCount above 0).
  const bound = detailed.filter(g => Number(g.detail.subCount) > 0 && parseValue(g.detail.soulBind));
  const filled = new Set(gear.map(g => g.slot));
  return {
    items: gear.length,
    detailed: detailed.length,
    enchantable: enchantable.length,
    averageEnchant: enchantable.length ? enchant / enchantable.length : 0,
    averageMax: enchantable.length ? maxEnchant / enchantable.length : 0,
    enchantShare: maxEnchant ? enchant / maxEnchant : 0,
    atMax: enchantable.filter(g => Number(g.enchant) >= Number(g.detail.maxEnchant)).length,
    exceedable: exceedable.length,
    exceed: sum(exceedable, g => Math.min(Number(g.exceed) || 0, Number(g.detail.maxExceed))),
    maxExceed: sum(exceedable, g => Number(g.detail.maxExceed)),
    stones: sum(facts, f => f.stones),
    stoneSlots: sum(facts, f => f.stoneSlots),
    godStones: sum(facts, f => f.godStones),
    godSlots: sum(facts, f => f.godSlots),
    soulLines: sum(facts, f => f.soulLines),
    soulRate: bound.length ? sum(bound, g => parseValue(g.detail.soulBind).value) / bound.length : null,
    empty: dollSlots.filter(s => !filled.has(s)),
    sets: activeSets(detailed),
  };
}

// Stat lines summed by name ("HP +900" on two boards → HP 1,800), flat and percent apart, the largest
// first; lines that are no stat line are left out.
export function sumEffects(texts) {
  const rows = new Map();
  for (const text of texts || []) {
    const e = parseEffect(text);
    if (!e) continue;
    const key = keyOf(e.name, e.percent),
      row = rows.get(key) || { name: e.name, percent: e.percent, value: 0 };
    row.value = round(row.value + e.value);
    rows.set(key, row);
  }
  return [...rows.values()].sort(
    (a, b) => Number(a.percent) - Number(b.percent) || b.value - a.value || a.name.localeCompare(b.name),
  );
}

// What the gear's soul bindings ("Overhead Slam" level 4 on an arcana) and the open Daevanion nodes
// ("Rush Strike +1") add to each skill: [{ name, gear, boards, total }], the largest first.
export function skillBoostTotals(profile) {
  const rows = new Map(),
    row = name => rows.get(name) || rows.set(name, { name, gear: 0, boards: 0, total: 0 }).get(name);
  for (const g of profile?.gear || [])
    for (const s of g.detail?.subSkills || []) {
      const r = row(s.name),
        n = Number(s.level) || 0;
      r.gear += n;
      r.total += n;
    }
  for (const b of profile?.boards || [])
    for (const e of b.skillEffects || []) {
      const m = String(e).match(/^(.*?)\s*\+(\d+)$/);
      if (!m) continue;
      const r = row(m[1]),
        n = Number(m[2]);
      r.boards += n;
      r.total += n;
    }
  return [...rows.values()].filter(r => r.total).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}
