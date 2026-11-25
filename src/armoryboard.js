// The Daevanion tab's board (armory.js draws it): what each node gives in a few letters ("ATK +3"),
// which of the character's skills a skill node raises (with its icon), what the board's nodes give
// together, open and all, and where the arrow keys move between nodes. Pure functions; names and
// numbers are PLAYNC's, in English like the rest of the game's texts.
import { parseEffect } from './armorystats.js';

// The few letters a stat node shows, by the stat's name without PvE, PvP or Boss in front (that
// shows above the letters). Other stats show their words' initials; the board's list says what
// each stands for.
const codes = {
  attack: 'ATK',
  'attack bonus': 'ATK',
  defense: 'DEF',
  'defense bonus': 'DEF',
  hp: 'HP',
  'max hp': 'HP',
  mp: 'MP',
  'max mp': 'MP',
  'critical hit': 'CRIT',
  'critical hit resist': 'C.RES',
  'critical damage boost': 'C.DMG',
  'critical damage tolerance': 'C.TOL',
  accuracy: 'ACC',
  evasion: 'EVA',
  'cooldown reduction': 'CDR',
  'combat speed': 'SPD',
  'multi-hit chance': 'MULTI',
  'multi-hit resist': 'M.RES',
  'damage boost': 'DMG',
  'damage tolerance': 'D.TOL',
  'status effect chance': 'S.EFF',
  'status effect resist': 'S.RES',
};
const prefixes = { pve: 'PvE', pvp: 'PvP', boss: 'Boss' };

// "PvE Critical Hit Resist" → { prefix: 'PvE', code: 'C.RES' }; "Healing Boost" → { prefix: '', code: 'HB' }.
export function statCode(name) {
  const words = String(name || '').trim(),
    m = words.match(/^(PvE|PvP|Boss)\s+(.+)$/i),
    base = (m ? m[2] : words).toLowerCase();
  const code =
    codes[base] ||
    base
      .split(/[\s-]+/)
      .filter(Boolean)
      .map(w => w[0])
      .join('')
      .slice(0, 4)
      .toUpperCase();
  return { prefix: m ? prefixes[m[1].toLowerCase()] : '', code: code || '?' };
}

// A node's effects as PLAYNC lists them, joined by the backend: "Boss Attack +3, Boss Defense +30".
const effectsOf = text =>
  String(text || '')
    .split(/,\s+/)
    .map(e => e.trim())
    .filter(Boolean);

// A board's nodes with what each gives: stat nodes their stats ({ name, value, percent, prefix, code,
// text }), skill nodes the skill they raise ({ name, levels }) and, when the character has it, the
// skill as its profile lists it (icon, level, learned, on the skill bar).
export function boardNodes(board, skills = []) {
  const known = new Map(skills.map(s => [String(s.name).toLowerCase(), s]));
  return (board?.nodes || []).map(n => {
    const kind = String(n.t || '').toLowerCase(),
      effects = effectsOf(n.e);
    const node = {
      row: Number(n.r) || 0,
      col: Number(n.c) || 0,
      grade: n.g || '',
      kind,
      open: Boolean(n.o),
      name: n.n || '',
      effects,
      stats: [],
      skill: null,
    };
    const raise = kind === 'skilllevel' ? String(effects[0] || '').match(/^(.*?)\s*\+(\d+)$/) : null;
    if (raise) node.skill = { name: raise[1], levels: Number(raise[2]), of: known.get(raise[1].toLowerCase()) || null };
    else
      for (const e of effects) {
        const stat = parseEffect(e);
        if (stat) node.stats.push({ ...stat, ...statCode(stat.name), text: e });
      }
    return node;
  });
}

const round = n => Math.round(n * 1000) / 1000;

// What a board's nodes give: each stat and skill with how many of its nodes are open of all, and
// what the open ones add ("Attack Bonus": 7 of 10 nodes, +21), the most nodes first.
export function boardSummary(nodes) {
  const stats = new Map(),
    skills = new Map();
  for (const n of nodes) {
    for (const s of n.stats) {
      const key = `${s.name.toLowerCase()}${s.percent ? ' %' : ''}`,
        row = stats.get(key) || {
          name: s.name,
          prefix: s.prefix,
          code: s.code,
          percent: s.percent,
          open: 0,
          total: 0,
          value: 0,
        };
      row.total++;
      if (n.open) {
        row.open++;
        row.value = round(row.value + s.value);
      }
      stats.set(key, row);
    }
    if (n.skill) {
      const key = n.skill.name.toLowerCase(),
        row = skills.get(key) || { name: n.skill.name, of: n.skill.of, open: 0, total: 0, levels: 0 };
      row.total++;
      if (n.open) {
        row.open++;
        row.levels += n.skill.levels;
      }
      skills.set(key, row);
    }
  }
  const order = (a, b) => b.total - a.total || b.open - a.open || a.name.localeCompare(b.name);
  return { stats: [...stats.values()].sort(order), skills: [...skills.values()].sort(order) };
}

// The node an arrow key moves to from nodes[from] ({ row, col } each), -1 for none: the nearest one
// that way, a step aside counting as two along, so the row or column goes on past a gap. Home and
// End go to the first and the last node.
export function nodeStep(nodes, from, key) {
  if (!nodes.length) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return nodes.length - 1;
  const way = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[key],
    here = nodes[from];
  if (!way || !here) return -1;
  let best = -1,
    score = Infinity;
  nodes.forEach((n, i) => {
    const along = (n.row - here.row) * way[0] + (n.col - here.col) * way[1],
      aside = Math.abs(way[0] ? n.col - here.col : n.row - here.row);
    if (along > 0 && along + 2 * aside < score) {
      score = along + 2 * aside;
      best = i;
    }
  });
  return best;
}
