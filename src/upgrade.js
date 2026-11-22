// The armory's Upgrade tab (armory.js upgradeTab): a profile's gear, arcana sets, Daevanion
// boards and skill bar against what the strongest characters of its class wear, as the backend
// works it out from the profiles the armory keeps (backend/odyle/upgrades.go,
// GET /api/odyle/armory/upgrades/<class>). Pure: no page, no requests, no texts.

// Fewer of the strongest than this and the tab says the armory knows too few to compare with.
export const upgradeLeast = 3;

// The slot a piece of gear is compared in, as the backend counts them: a character's two
// earrings, rings, bracelets and runes are one slot each; the pet has nothing to compare.
export const upgradeSlot = slot =>
  /^(Earring|Ring|Bracelet|Rune)\d+$/.test(slot) ? slot.replace(/\d+$/, '') : slot === 'Pet' ? '' : String(slot || '');
const gradeRanks = { Common: 1, Rare: 2, Legend: 3, Unique: 4, Epic: 5, Mythic: 6 };
// A grade's place from the most common up; Special (runes, events) stands apart (0).
export const gradeRank = grade => gradeRanks[grade] || 0;

// How much one step behind counts for in a slot's score: the item level by the share it is
// behind, the rest per level, grade or empty stone slot, and per rolled stat missing (a rolled
// stat rolled lower by the share it is behind).
const weights = { itemLevel: 200, enchant: 3, exceed: 4, grade: 15, stones: 2, rolled: 3 };
// A slot's score as words: big (25 and over), some (8 and over), small (above 0), even.
export const upgradeState = score => (score >= 25 ? 'big' : score >= 8 ? 'some' : score > 0 ? 'small' : 'even');

// A rolled stat's value as PLAYNC writes it ("13%", "+120", "1,200"): its number and whether it
// is a share, or null without a number.
export function rolledValue(text) {
  const found = String(text ?? '').match(/-?[\d,]*\d(?:\.\d+)?/);
  return found ? { value: Number(found[0].replace(/,/g, '')), percent: String(text).includes('%') } : null;
}
// A share and a number of one name are two stats, as the backend counts them.
const rolledKey = (name, percent) => `${name}|${percent ? '%' : ''}`;
// An item's rolled stats (soul binding) by key, a stat rolled twice summed.
function rolledOf(detail) {
  const out = new Map();
  for (const line of detail.sub) {
    const v = rolledValue(line.value);
    if (line.name && v)
      out.set(rolledKey(line.name, v.percent), (out.get(rolledKey(line.name, v.percent)) || 0) + v.value);
  }
  return out;
}
// The rolled stats most of the strongest roll in a slot (at least half of the items whose rolled
// stats are known, once enough are), or none.
export const usualRolls = slot =>
  (slot.rolledItems || 0) >= upgradeLeast ? (slot.rolled || []).filter(r => r.count * 2 >= slot.rolledItems) : [];

// One piece of gear (or an empty place) against its slot among the strongest: what it is behind
// by (item level, enchantment, exceed level and grade below theirs, stone slots left empty, the
// stats most of them roll that it rolls lower or not at all) and a score that orders the slots by
// how much an upgrade there gives.
export function compareSlot(item, slot, sample) {
  const best = slot.popular?.[0] || null;
  if (!item) {
    // A place most of the strongest fill counts as the biggest upgrade there is.
    const score = slot.players * 2 >= sample ? 100 : 0;
    return {
      slot: slot.slot,
      item: null,
      ref: slot,
      best,
      wearsBest: false,
      gaps: { empty: true },
      score,
      state: upgradeState(score),
    };
  }
  const d = item.detail,
    gaps = {};
  if (d?.itemLevel && slot.itemLevel) gaps.itemLevel = slot.itemLevel - d.itemLevel;
  gaps.enchant = (slot.enchant || 0) - (item.enchant || 0);
  gaps.exceed = (slot.exceed || 0) - (item.exceed || 0);
  if (gradeRank(item.grade) && gradeRank(slot.grade)) gaps.grade = gradeRank(slot.grade) - gradeRank(item.grade);
  if (d?.stoneSlots) gaps.stones = Math.max(0, d.stoneSlots - (d.stones?.length || 0));
  if (Array.isArray(d?.sub)) {
    const mine = rolledOf(d);
    const rolled = usualRolls(slot)
      .map(r => ({
        name: r.name,
        percent: r.percent,
        theirs: r.value,
        mine: mine.get(rolledKey(r.name, r.percent)) ?? null,
      }))
      .filter(r => r.mine === null || r.mine < r.theirs);
    if (rolled.length) gaps.rolled = rolled;
  }
  const behind = key => Math.max(0, gaps[key] || 0);
  const rolled = (gaps.rolled || []).reduce(
    (sum, r) => sum + (r.mine === null ? 1 : r.theirs > 0 ? Math.min(1, (r.theirs - r.mine) / r.theirs) : 0),
    0,
  );
  const score = Math.round(
    (gaps.itemLevel > 0 ? (weights.itemLevel * gaps.itemLevel) / slot.itemLevel : 0) +
      weights.enchant * behind('enchant') +
      weights.exceed * behind('exceed') +
      weights.grade * behind('grade') +
      weights.stones * behind('stones') +
      weights.rolled * rolled,
  );
  return {
    slot: item.slot,
    item,
    ref: slot,
    best,
    wearsBest: Boolean(best && best.name === item.name),
    gaps,
    score,
    state: upgradeState(score),
  };
}

const levelOf = g => g?.detail?.itemLevel || 0;

// The plan: the profile against the strongest of its class (reference, the backend's answer,
// which leaves the profile out of them), or null while the armory knows too few of them.
export function upgradePlan(profile, reference) {
  const players = reference?.players || [],
    powers = reference?.combatPowers || players.map(p => p.combatPower);
  const sample = reference?.sample ?? players.length,
    power = Number(profile.combatPower) || 0;
  if (sample < upgradeLeast) return null;
  const gear = (profile.gear || []).filter(g => upgradeSlot(g.slot));
  const rows = [];
  for (const slot of reference.slots || []) {
    // As many places as the strongest fill in this slot (two earrings), or as the profile wears.
    const worn = gear.filter(g => upgradeSlot(g.slot) === slot.slot).sort((a, b) => levelOf(b) - levelOf(a));
    const places = Math.max(worn.length, Math.round(slot.items / Math.max(1, slot.players)) || 1);
    for (let i = 0; i < places; i++) rows.push(compareSlot(worn[i] || null, slot, sample));
  }
  const picks = rows
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  // Its place: where its combat power puts it among the strongest.
  const place = powers.filter(p => p > power).length + 1;
  const sets = new Map();
  for (const g of gear)
    if (g.detail?.set?.name)
      sets.set(g.detail.set.name, Math.max(sets.get(g.detail.set.name) || 0, Number(g.detail.set.equipped) || 0));
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
  return {
    sample,
    place,
    below: place > sample,
    combatPower: { mine: power, gap: (reference.combatPower?.median || 0) - power, ...reference.combatPower },
    itemLevel: {
      mine: Number(profile.itemLevel) || 0,
      gap: (reference.itemLevel?.median || 0) - (Number(profile.itemLevel) || 0),
      ...reference.itemLevel,
    },
    rows,
    picks,
    sets: (reference.sets || []).map(s => ({ ...s, mine: sets.get(s.name) || 0 })),
    boards,
    skills,
  };
}
