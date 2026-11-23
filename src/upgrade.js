// The armory's Upgrade tab (armory.js upgradeTab): a profile's gear, arcana sets, Daevanion
// boards and skill bar against a group of stronger characters of its class, as the backend works
// it out from the builds the armory keeps (backend/odyle/upgrades.go,
// GET /api/odyle/armory/upgrades/<class>): its next step (the nearest characters a little stronger
// than it) or the strongest. Each place of the gear gets what to do there, most worth first:
//   - fill an empty place most of the group fill;
//   - put in a new item: the next rung of the slot's ladder that a good share of the group wears,
//     with what it adds (item level, grade, main stats as the group has them);
//   - else take the item kept as far as the group takes it: enchant (up to the item's limit),
//     exceed once it is at its limit, engrave its empty stone slots, better stones, reroll the soul
//     binding stats most of the group roll;
//   - the long-term goal: the best item a few of the group wear there.
// The plan sorts these into quick wins, new gear, enchanting, polish and goals; the arcana's sets
// are looked at together. Pure: no page, no requests, no texts.

// Fewer of the group than this and the tab says the armory knows too few to compare with.
export const upgradeLeast = 3;

// The slot a piece of gear is compared in, as the backend counts them: a character's two
// earrings, rings, bracelets and runes are one slot each; the pet has nothing to compare.
export const upgradeSlot = slot =>
  /^(Earring|Ring|Bracelet|Rune)\d+$/.test(slot) ? slot.replace(/\d+$/, '') : slot === 'Pet' ? '' : String(slot || '');
const gradeRanks = { Common: 1, Rare: 2, Legend: 3, Unique: 4, Epic: 5, Mythic: 6 };
// A grade's place from the most common up; Special (runes, events) stands apart (0).
export const gradeRank = grade => gradeRanks[grade] || 0;
export const isArcana = slot => /^Arcana\d$/.test(String(slot || ''));

// How much a slot counts next to the others: the weapons more, the smaller accessories, the five
// arcana, runes and wings less.
const slotWeights = { MainHand: 1.6, SubHand: 1.2, Bracelet: 0.7, Amulet: 0.6, Belt: 0.6, Rune: 0.5, Wings: 0.5 };
export const slotWeight = slot => slotWeights[slot] ?? (isArcana(slot) ? 0.6 : 1);

// What one step counts for in an action's worth (times the slot's weight): the share of item
// level a new item adds, a grade, an enchantment or exceed level, an empty stone slot, a stone
// below the group's usual grade, a rolled stat missing (one rolled lower by the share it is
// behind), an empty place most fill, and a skill most keep on their bars that is learned but not on
// the bar (by the share that keep it).
const weights = {
  itemLevel: 200,
  grade: 15,
  enchant: 3,
  exceed: 4,
  stones: 2,
  stoneGrade: 1,
  rolled: 3,
  fill: 100,
  skill: 6,
};
// A rung of a slot's ladder counts as the next step once this share of the group's items there
// are it, and as a goal once two of them and this share are.
const nextShare = 0.1,
  goalShare = 0.02;

// A slot's or action's worth as words: big (25 and over), some (8 and over), small (above 0), even.
export const upgradeState = score => (score >= 25 ? 'big' : score >= 8 ? 'some' : score > 0 ? 'small' : 'even');

// A value as PLAYNC writes it ("13%", "+120", "1,200"): its number and whether it is a share, or
// null without a number.
export function rolledValue(text) {
  const found = String(text ?? '').match(/-?[\d,]*\d(?:\.\d+)?/);
  return found ? { value: Number(found[0].replace(/,/g, '')), percent: String(text).includes('%') } : null;
}
// A share and a number of one name are two stats, as the backend counts them.
const statKey = (name, percent) => `${name}|${percent ? '%' : ''}`;
const statOf = key => ({ name: key.slice(0, key.lastIndexOf('|')), percent: key.endsWith('|%') });
// An item's rolled stats (soul binding) by key, a stat rolled twice summed.
function rolledOf(detail) {
  const out = new Map();
  for (const line of detail.sub) {
    const v = rolledValue(line.value);
    if (line.name && v) out.set(statKey(line.name, v.percent), (out.get(statKey(line.name, v.percent)) || 0) + v.value);
  }
  return out;
}
// An item's main stats by key: each line's value and what its enchantment and exceed level add
// (PLAYNC's extra; an exceed line has only that) summed, a weapon's attack by its upper value, as
// the backend sums the group's (mainStats in upgrades.go).
export function mainStatsOf(detail) {
  const out = new Map();
  for (const line of detail?.main || []) {
    const v = rolledValue(line.value),
      x = rolledValue(line.extra);
    if (!line.name || (!v && !x)) continue;
    const key = statKey(line.name, v ? v.percent : x.percent);
    out.set(key, (out.get(key) || 0) + (v?.value || 0) + (x?.value || 0));
  }
  return out;
}
// What one enchantment level adds to each main stat of an item, from what its enchantment adds
// now (PLAYNC's extra grows by the same each level); nothing known at +0.
function perEnchant(item) {
  const out = new Map(),
    n = Number(item.enchant) || 0;
  if (!n) return out;
  for (const line of item.detail?.main || []) {
    const v = rolledValue(line.value),
      x = rolledValue(line.extra);
    if (line.exceed || !line.name || !x?.value) continue;
    out.set(statKey(line.name, v ? v.percent : x.percent), x.value / n);
  }
  return out;
}
// The main stats one has more of than the other (the group's item at the enchantment they have it
// at against the item worn), in the item's order, three at most.
function statGains(mine, theirs, most = 3) {
  return (theirs || [])
    .map(s => ({ name: s.name, percent: s.percent, value: s.value - (mine.get(statKey(s.name, s.percent)) || 0) }))
    .filter(s => s.value > 0)
    .slice(0, most);
}
// What enchanting an item n levels adds, stat by stat.
const enchantGains = (item, n, most = 3) =>
  [...perEnchant(item)]
    .map(([key, step]) => ({ ...statOf(key), value: step * n }))
    .filter(s => s.value > 0)
    .slice(0, most);

// The rolled stats most of the group roll in a slot (at least half of the items whose rolled
// stats are known, once enough are), or none.
export const usualRolls = slot =>
  (slot.rolledItems || 0) >= upgradeLeast ? (slot.rolled || []).filter(r => r.count * 2 >= slot.rolledItems) : [];

// The rungs of a slot's ladder: the items the group wears there, the highest item level first (the
// most worn ones while the backend lists no ladder).
export const ladderOf = slot =>
  slot.ladder?.length
    ? slot.ladder
    : [...(slot.popular || [])].sort(
        (a, b) => b.itemLevel - a.itemLevel || gradeRank(b.grade) - gradeRank(a.grade) || b.count - a.count,
      );
// The share of the group's items in a slot that are this one.
export const shareOf = (rung, slot) => (slot.items ? Math.min(1, rung.count / slot.items) : 0);
// Above an item: a higher item level, or the same with a higher grade.
const above = (rung, level, grade) =>
  rung.itemLevel > level || (rung.itemLevel === level && gradeRank(rung.grade) > gradeRank(grade));

// One piece of gear (or an empty place) against its slot in the group: the rungs above it (the
// next step and the goal), what to do there (actions, most worth first, each with its worth) and
// the place's score, the sum of their worth.
export function slotAdvice(item, slot, sample) {
  const rungs = ladderOf(slot),
    weight = slotWeight(slot.slot),
    common = slot.popular?.[0] || rungs[0] || null;
  const row = {
    slot: item?.slot || slot.slot,
    item,
    ref: slot,
    common,
    next: null,
    goal: null,
    actions: [],
    score: 0,
    state: 'even',
    wearsCommon: Boolean(item && common && common.name === item.name && common.grade === item.grade),
  };
  const act = action => row.actions.push(action);
  if (!item) {
    // A place most of the group fill counts as the biggest upgrade there is.
    if (common && slot.players * 2 >= sample)
      act({ kind: 'fill', target: common, share: shareOf(common, slot), value: weights.fill * weight });
  } else {
    // The item's own rung: by name and grade, as some items come in two grades under one name.
    const d = item.detail,
      own = rungs.find(r => r.name === item.name && r.grade === item.grade);
    const level = d?.itemLevel || own?.itemLevel || 0;
    // Without its item level, a higher grade alone says an item is better.
    const higher = rungs.filter(
      r => r !== own && (level ? above(r, level, item.grade) : gradeRank(r.grade) > gradeRank(item.grade)),
    );
    row.next =
      higher
        .filter(r => shareOf(r, slot) >= nextShare)
        .sort((a, b) => a.itemLevel - b.itemLevel || gradeRank(a.grade) - gradeRank(b.grade) || b.count - a.count)[0] ||
      null;
    const goal =
      higher
        .filter(r => r.count >= 2 && shareOf(r, slot) >= goalShare)
        .sort((a, b) => b.itemLevel - a.itemLevel || gradeRank(b.grade) - gradeRank(a.grade) || b.count - a.count)[0] ||
      null;
    row.goal = goal && goal !== row.next ? goal : null;
    if (row.next) {
      // A new item: what the next rung adds. The item worn is not worth enchanting further.
      const next = row.next,
        gain = level && next.itemLevel ? Math.max(0, next.itemLevel - level) : 0,
        grade = Math.max(0, gradeRank(next.grade) - gradeRank(item.grade));
      act({
        kind: 'replace',
        target: next,
        share: shareOf(next, slot),
        itemLevel: { from: level, to: next.itemLevel || 0 },
        grade,
        stats: d ? statGains(mainStatsOf(d), next.main) : [],
        value: ((weights.itemLevel * gain) / Math.max(1, next.itemLevel) + weights.grade * grade) * weight,
      });
    } else {
      // Kept: as far as the group takes it, within the item's limits.
      const enchant = Number(item.enchant) || 0,
        exceed = Number(item.exceed) || 0;
      const max = d?.maxEnchant || own?.maxEnchant || 0,
        theirs = own ? own.enchant : slot.enchant || 0;
      const to = max ? Math.min(theirs, max) : theirs;
      if (to > enchant)
        act({
          kind: 'enchant',
          from: enchant,
          to,
          max,
          stats: enchantGains(item, to - enchant),
          value: weights.enchant * (to - enchant) * weight,
        });
      // Exceed levels go on an item at its enchantment's limit.
      const maxExceed = d?.maxExceed || own?.maxExceed || 0,
        exceedTo = Math.min(own ? own.exceed : slot.exceed || 0, maxExceed);
      if (max && Math.max(enchant, to) >= max && exceedTo > exceed)
        act({
          kind: 'exceed',
          from: exceed,
          to: exceedTo,
          max: maxExceed,
          after: to > enchant,
          value: weights.exceed * (exceedTo - exceed) * weight,
        });
      const empty = d?.stoneSlots ? Math.max(0, d.stoneSlots - (d.stones?.length || 0)) : 0;
      if (empty)
        act({
          kind: 'stones',
          empty,
          names: (slot.stoneNames || []).slice(0, 3).map(s => s.name),
          value: weights.stones * empty * weight,
        });
      const usual = gradeRank(slot.stoneGrade),
        low = usual ? (d?.stones || []).filter(s => gradeRank(s.grade) && gradeRank(s.grade) < usual).length : 0;
      if (low)
        act({ kind: 'stoneGrade', count: low, grade: slot.stoneGrade, value: weights.stoneGrade * low * weight });
      if (Array.isArray(d?.sub)) {
        const mine = rolledOf(d);
        const stats = usualRolls(slot)
          .map(r => ({
            name: r.name,
            percent: r.percent,
            theirs: r.value,
            mine: mine.get(statKey(r.name, r.percent)) ?? null,
            share: slot.rolledItems ? r.count / slot.rolledItems : 0,
          }))
          .filter(r => r.mine === null || r.mine < r.theirs);
        const behind = stats.reduce(
          (sum, r) => sum + (r.mine === null ? 1 : r.theirs > 0 ? Math.min(1, (r.theirs - r.mine) / r.theirs) : 0),
          0,
        );
        if (stats.length) act({ kind: 'reroll', stats, value: weights.rolled * behind * weight });
      }
    }
    if (row.goal)
      act({
        kind: 'goal',
        target: row.goal,
        share: shareOf(row.goal, slot),
        itemLevel: { from: level, to: row.goal.itemLevel || 0 },
        value: 0,
      });
  }
  row.actions.sort((a, b) => b.value - a.value);
  row.score = Math.round(row.actions.reduce((sum, a) => sum + a.value, 0));
  row.state = upgradeState(row.score);
  return row;
}

// The plan's parts, in the order the tab shows them, and the part of each kind of action.
export const planParts = ['quick', 'gear', 'enchant', 'polish', 'goal'];
const partOf = {
  fill: 'quick',
  stones: 'quick',
  skill: 'quick',
  set: 'quick',
  replace: 'gear',
  enchant: 'enchant',
  exceed: 'enchant',
  reroll: 'polish',
  stoneGrade: 'polish',
  goal: 'goal',
  board: 'goal',
};
// The plan's steps: the actions of all places, one step for the same action on both places of a
// pair (two earrings to the same new earrings) and for the same kind of action on the arcana, its
// worth the biggest of theirs and half of each other's.
function planSteps(rows, extra) {
  const steps = new Map();
  for (const row of rows)
    for (const action of row.actions) {
      const arcana = isArcana(row.ref.slot),
        slot = arcana ? 'Arcana' : row.ref.slot;
      const key = arcana ? `Arcana|${action.kind}` : `${slot}|${action.kind}|${action.target?.name || ''}`;
      if (!steps.has(key)) steps.set(key, { kind: action.kind, slot, entries: [] });
      steps.get(key).entries.push({ row, action });
    }
  const out = [...steps.values(), ...extra].map(step => {
    const values = step.entries.map(e => e.action.value).sort((a, b) => b - a);
    const value = values[0] + values.slice(1).reduce((sum, v) => sum + v / 2, 0);
    return { ...step, part: partOf[step.kind], value, state: upgradeState(Math.round(value)) };
  });
  const plan = Object.fromEntries(planParts.map(part => [part, []]));
  for (const step of out) plan[step.part]?.push(step);
  for (const part of planParts) plan[part].sort((a, b) => b.value - a.value || goalGain(b) - goalGain(a));
  return plan;
}
const goalGain = step => step.entries[0]?.action.itemLevel?.to - step.entries[0]?.action.itemLevel?.from || 0;

// The arcana together: the sets the group wears pieces of (the usual ones: most of them), the
// character's own pieces of each with the bonuses on and the next one, and the places whose usual
// arcana belongs to another set than the one worn there.
function arcanaPlan(profile, reference, rows, sample) {
  const places = rows.filter(r => isArcana(r.ref.slot));
  if (!places.length) return null;
  const arcanaSets = new Set(
    (reference.slots || [])
      .filter(s => isArcana(s.slot))
      .flatMap(s => ladderOf(s).map(r => r.set))
      .filter(Boolean),
  );
  // The character's sets, each once, with its pieces on (the most any of its pieces says).
  const mine = new Map();
  for (const g of profile.gear || [])
    if (g.detail?.set?.name) {
      const set = g.detail.set,
        kept = mine.get(set.name);
      if (!kept || (Number(set.equipped) || 0) > kept.pieces)
        mine.set(set.name, { pieces: Number(set.equipped) || 0, bonuses: set.bonuses || [], arcana: isArcana(g.slot) });
      else if (isArcana(g.slot)) kept.arcana = true;
    }
  const sets = (reference.sets || [])
    .filter(s => arcanaSets.has(s.name) || mine.get(s.name)?.arcana)
    .map(s => {
      const own = mine.get(s.name),
        bonuses = own?.bonuses?.length ? own.bonuses : s.bonuses || [],
        pieces = own?.pieces || 0;
      return {
        name: s.name,
        players: s.players,
        pieces: s.pieces,
        usual: s.players * 2 >= sample,
        mine: pieces,
        on: bonuses.filter(b => b.count <= pieces),
        next: bonuses.filter(b => b.count > pieces).sort((a, b) => a.count - b.count)[0] || null,
      };
    });
  // Sets the character wears arcana of that none of the group does.
  for (const [name, own] of mine)
    if (own.arcana && !sets.some(s => s.name === name))
      sets.push({
        name,
        players: 0,
        pieces: 0,
        usual: false,
        mine: own.pieces,
        on: own.bonuses.filter(b => b.count <= own.pieces),
        next: own.bonuses.filter(b => b.count > own.pieces).sort((a, b) => a.count - b.count)[0] || null,
      });
  const swaps = places
    .filter(r => r.item?.detail?.set?.name && r.common?.set && r.common.set !== r.item.detail.set.name)
    .map(r => ({ slot: r.item.slot, from: r.item, to: r.common }));
  return {
    places: places.map(r => ({ ...r, boosts: (r.ref.boostItems || 0) >= upgradeLeast ? slotBoosts(r.ref, r.item) : [] })),
    sets,
    swaps,
    usual: sets.filter(s => s.usual),
  };
}

const levelOf = g => g?.detail?.itemLevel || 0;

// The skills the character's arcana (or its other gear) raise, each one's levels summed.
function raisedBy(gear, arcana) {
  const out = new Map();
  for (const g of gear)
    if (upgradeSlot(g.slot) && isArcana(g.slot) === arcana)
      for (const s of g.detail?.subSkills || [])
        if (s.name) out.set(s.name, (out.get(s.name) || 0) + (Number(s.level) || 0));
  return out;
}
// The skills the group's arcana (or other gear) raise against the character's: how many of them
// raise each (of those whose arcana or gear raise any), by how much (the median of their sums),
// and by how much the character's do; the skills only the character's raise after them.
function boostsOf(list, players, mine) {
  const out = (list || []).map(b => ({
    name: b.name,
    icon: b.icon,
    players: b.count,
    share: players ? b.count / players : 0,
    level: b.level,
    mine: mine.get(b.name) || 0,
  }));
  for (const [name, level] of mine)
    if (!out.some(b => b.name === name)) out.push({ name, icon: '', players: 0, share: 0, level: 0, mine: level });
  return out;
}
// A slot's skills raised (an arcana's), with how many of its items raise each, against those of the
// item worn there.
export function slotBoosts(slot, item) {
  const mine = new Map((item?.detail?.subSkills || []).map(s => [s.name, Number(s.level) || 0]));
  return boostsOf(slot.boosts, slot.boostItems, mine);
}

// The plan: the profile against the group (reference, the backend's answer, which leaves the
// profile out of it), or null while the armory knows too few of them.
export function upgradePlan(profile, reference) {
  const players = reference?.players || [],
    powers = reference?.combatPowers || players.map(p => p.combatPower);
  const sample = reference?.sample ?? players.length,
    power = Number(profile.combatPower) || 0;
  if (sample < upgradeLeast) return null;
  const gear = (profile.gear || []).filter(g => upgradeSlot(g.slot));
  const rows = [];
  for (const slot of reference.slots || []) {
    // As many places as the group fill in this slot (two earrings), or as the profile wears.
    const worn = gear.filter(g => upgradeSlot(g.slot) === slot.slot).sort((a, b) => levelOf(b) - levelOf(a));
    const places = Math.max(worn.length, Math.round(slot.items / Math.max(1, slot.players)) || 1);
    for (let i = 0; i < places; i++) rows.push(slotAdvice(worn[i] || null, slot, sample));
  }
  // Its place: where its combat power puts it among them.
  const place = powers.filter(p => p > power).length + 1;
  const boards = (reference.boards || [])
    .map(b => {
      const mine = (profile.boards || []).find(x => x.name === b.name);
      return { ...b, mine: mine?.open || 0, gap: b.open - (mine?.open || 0) };
    })
    .sort((a, b) => b.gap - a.gap);
  const skills = (reference.skills || [])
    .filter(s => s.players * 4 >= sample)
    .slice(0, 12)
    .map(s => {
      const mine = (profile.skills || []).find(x => x.name === s.name);
      return { ...s, equipped: Boolean(mine?.equipped), acquired: Boolean(mine?.acquired), mine: mine?.level || 0 };
    });
  // Beside the gear: skills most of them keep on their bars that are learned but not on it, and the
  // Daevanion boards behind theirs.
  const extra = [
    ...skills
      .filter(s => s.acquired && !s.equipped && s.players * 2 >= sample)
      .map(s => ({
        kind: 'skill',
        slot: '',
        entries: [{ row: null, action: { kind: 'skill', skill: s, share: s.players / sample, value: weights.skill * (s.players / sample) } }],
      })),
    ...boards
      .filter(b => b.gap > 0)
      .map(b => ({ kind: 'board', slot: '', entries: [{ row: null, action: { kind: 'board', board: b, value: 0 } }] })),
  ];
  const arcana = arcanaPlan(profile, reference, rows, sample);
  return {
    group: reference.group || 'top',
    sample,
    excluded: reference.excluded || 0,
    place,
    below: place > sample,
    combatPower: { mine: power, gap: (reference.combatPower?.median || 0) - power, ...reference.combatPower },
    itemLevel: {
      mine: Number(profile.itemLevel) || 0,
      gap: (reference.itemLevel?.median || 0) - (Number(profile.itemLevel) || 0),
      ...reference.itemLevel,
    },
    rows,
    steps: planSteps(rows, extra),
    arcana,
    sets: (reference.sets || []).map(s => ({ ...s, mine: arcanaMine(profile, s.name) })),
    boards,
    skills,
    // The skills arcana and other gear raise, once enough of the group's are known.
    boosts: {
      arcana:
        (reference.arcanaPlayers || 0) >= upgradeLeast
          ? boostsOf(reference.arcanaSkills, reference.arcanaPlayers, raisedBy(gear, true))
          : [],
      gear:
        (reference.gearPlayers || 0) >= upgradeLeast
          ? boostsOf(reference.gearSkills, reference.gearPlayers, raisedBy(gear, false))
          : [],
    },
  };
}
// The pieces of a set the character wears.
const arcanaMine = (profile, name) =>
  Math.max(0, ...(profile.gear || []).filter(g => g.detail?.set?.name === name).map(g => Number(g.detail.set.equipped) || 0));
