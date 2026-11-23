// The armory profile's details beyond PLAYNC's own panels (armory.js calls these): the gear summary
// above the paper doll and the meters on each of its tiles, where the stats come from, what all
// Daevanion boards add up to, and what the gear and boards add to each skill. Pure functions that
// return HTML; the numbers come from armorystats.js, the styles from armorydetail.css.
import { t, tn } from './i18n.js';
import { escape as esc, number } from './model.js';
import {
  statBreakdown,
  statSources,
  statGroups,
  tileFacts,
  gearSummary,
  sumEffects,
  skillBoostTotals,
} from './armorystats.js';

const sourceNames = () => ({
  gear: t('Properties'),
  soul: t('Soul binding'),
  stones: t('Stones'),
  sets: t('Sets'),
  boards: t('Daevanion'),
  titles: t('Titles'),
});
const groupNames = () => ({
  primary: t('Primary stats'),
  offence: t('Offence'),
  defence: t('Defence'),
  utility: t('Utility'),
  deity: t('Deity stats'),
});
// Slots' names, each once, with how many: "Earring ×2, Belt".
const slotList = labels =>
  [...labels.reduce((m, l) => m.set(l, (m.get(l) || 0) + 1), new Map())]
    .map(([l, n]) => (n > 1 ? `${l} ×${n}` : l))
    .join(', ');
const tenth = n => Math.round(n * 10) / 10;
const amount = (n, percent) => number(tenth(n)) + (percent ? '%' : '');
// A share or total: one number, or a weapon's range "2,408–2,566".
const span = (v, percent) =>
  v.low === v.high ? amount(v.high, percent) : `${amount(v.low, percent)}–${amount(v.high, percent)}`;
const dots = (on, all) => '<i class="is-on"></i>'.repeat(on) + '<i></i>'.repeat(Math.max(0, all - on));

// ---------------------------------------------------------------- Paper doll tiles

// The tile's meters: enchantment of its maximum as a bar, exceed level, stones engraved of their
// slots and soul binding lines; shown, not read out (tileLabel says the same).
export function tileMeters(g) {
  const f = tileFacts(g);
  if (!f) return '';
  const parts = [];
  if (f.maxEnchant)
    parts.push(
      `<span class="gear-meter is-enchant${f.enchant >= f.maxEnchant ? ' is-full' : ''}"><span class="gear-bar"><i style="width:${Math.min(100, Math.round((f.enchant / f.maxEnchant) * 100))}%"></i></span>+${number(f.enchant)}/${number(f.maxEnchant)}</span>`,
    );
  if (f.maxExceed)
    parts.push(
      `<span class="gear-meter is-exceed${f.exceed >= f.maxExceed ? ' is-full' : ''}">✦${number(f.exceed)}/${number(f.maxExceed)}</span>`,
    );
  if (f.stoneSlots)
    parts.push(
      `<span class="gear-meter is-stones${f.stones >= f.stoneSlots ? ' is-full' : ''}">${dots(f.stones, f.stoneSlots)}</span>`,
    );
  if (f.soulLines) parts.push(`<span class="gear-meter is-soul">◈${number(f.soulLines)}</span>`);
  return parts.length ? `<span class="gear-meters" aria-hidden="true">${parts.join('')}</span>` : '';
}

// The meters in words, for the tile's label.
export function tileLabel(g) {
  const f = tileFacts(g);
  if (!f) return '';
  return [
    f.maxEnchant ? t('enchantment +{n} of {max}', { n: number(f.enchant), max: number(f.maxEnchant) }) : '',
    f.maxExceed ? t('exceed {n} of {max}', { n: number(f.exceed), max: number(f.maxExceed) }) : '',
    f.stoneSlots ? t('{n} of {max} stones', { n: number(f.stones), max: number(f.stoneSlots) }) : '',
    f.soulLines ? tn(f.soulLines, '{n} soul binding line', '{n} soul binding lines') : '',
  ]
    .filter(Boolean)
    .join(', ');
}

// What the item's card adds to its facts: the soul binding's lines, of those it can hold.
export function tipFacts(g) {
  const f = tileFacts(g);
  if (!f || !(f.soulLines || f.soulSlots)) return [];
  return [
    [t('Soul binding lines'), f.soulSlots ? `${number(f.soulLines)} / ${number(f.soulSlots)}` : number(f.soulLines)],
  ];
}

// ---------------------------------------------------------------- Gear summary

// The strip above the paper doll: enchantment, items at their maximum, exceed, stones, soul binding,
// empty slots, and each set's bonuses on and the next one.
export function gearSummaryStrip(p, slotLabel) {
  const s = gearSummary(p);
  if (!s.detailed) return '';
  const share = Math.round(s.enchantShare * 100);
  const cells = [
    s.enchantable
      ? [
          t('Average enchantment'),
          `+${number(tenth(s.averageEnchant))}`,
          t('{p} % of the maximum', { p: share }),
          `<span class="armory-track" role="img" aria-label="${esc(t('{p} % of the maximum', { p: share }))}"><i style="width:${share}%"></i></span>`,
        ]
      : null,
    s.enchantable ? [t('At max enchantment'), `${number(s.atMax)} / ${number(s.enchantable)}`, t('items')] : null,
    s.maxExceed
      ? [
          t('Exceed'),
          `${number(s.exceed)} / ${number(s.maxExceed)}`,
          t('levels on {n} items', { n: number(s.exceedable) }),
        ]
      : null,
    s.stoneSlots || s.godSlots
      ? [
          t('Stones'),
          `${number(s.stones)} / ${number(s.stoneSlots)}`,
          s.godSlots
            ? t('slots filled · theostones {n} / {max}', { n: number(s.godStones), max: number(s.godSlots) })
            : t('slots filled'),
        ]
      : null,
    s.soulLines
      ? [
          t('Soul binding'),
          tn(s.soulLines, '{n} line', '{n} lines'),
          s.soulRate !== null ? t('average rate {p} %', { p: number(tenth(s.soulRate)) }) : '',
        ]
      : null,
    [
      t('Empty slots'),
      number(s.empty.length),
      s.empty.length ? slotList(s.empty.map(slotLabel)) : t('every slot is filled'),
    ],
  ].filter(Boolean);
  const sets = s.sets.length
    ? `<ul class="gear-summary-sets">${s.sets
        .map(set => {
          const on = set.active.length
            ? t('{n}-piece bonus on', { n: set.active[set.active.length - 1].count })
            : t('no bonus on yet');
          const next = set.next
            ? `<small class="${set.missing === 1 ? 'is-close' : ''}">${esc(
                tn(set.missing, '{n} piece to the {count}-piece bonus', '{n} pieces to the {count}-piece bonus', {
                  count: set.next.count,
                }),
              )}: ${set.next.effects.map(esc).join(', ')}</small>`
            : `<small>${t('every bonus is on')}</small>`;
          return `<li><strong>${esc(set.name)}</strong> <span>${number(set.equipped)} / ${number(set.pieces)} · ${esc(on)}</span>${next}</li>`;
        })
        .join('')}</ul>`
    : '';
  return `<div class="gear-summary"><dl>${cells.map(([label, value, small, extra = '']) => `<div><dt>${esc(label)}</dt><dd><strong>${esc(value)}</strong>${small ? `<small>${esc(small)}</small>` : ''}${extra}</dd></div>`).join('')}</dl>${sets}<p class="gear-legend" aria-hidden="true"><span><i class="gear-bar"><i style="width:70%"></i></i>${t('enchantment')}</span><span>✦ ${t('exceed')}</span><span><span class="gear-meter is-stones">${dots(1, 2)}</span>${t('stones')}</span><span>◈ ${t('soul binding lines')}</span></p></div>`;
}

// ---------------------------------------------------------------- Where stats come from

// The breakdown of every stat by source, its theostones, and the lines left out.
export function statSourcesPanel(p, slotLabel) {
  const b = statBreakdown(p);
  if (!b.rows.length && !b.godstones.length) return '';
  const names = sourceNames(),
    groups = groupNames();
  // Only the sources that give anything get a column.
  const used = statSources.filter(s => b.rows.some(r => r.by[s]));
  const head = `<thead><tr><th scope="col">${t('Stat')}</th>${used.map(s => `<th scope="col">${esc(names[s])}</th>`).join('')}<th scope="col">${t('Total')}</th></tr></thead>`;
  const row = r =>
    `<tr><th scope="row">${esc(r.name)}${r.character !== null ? `<small>${esc(t('PLAYNC shows {n}', { n: number(r.character) }))}</small>` : ''}</th>${used
      .map(
        s =>
          `<td data-label="${esc(names[s])}"${r.by[s] ? '' : ' class="is-none"'}>${r.by[s] ? esc(span(r.by[s], r.percent)) : '·'}</td>`,
      )
      .join('')}<td class="stat-total" data-label="${esc(t('Total'))}">${esc(span(r.total, r.percent))}</td></tr>`;
  const bodies = statGroups
    .map(g => [g, b.rows.filter(r => r.group === g)])
    .filter(([, list]) => list.length)
    .map(
      ([g, list]) =>
        `<tbody><tr class="stat-group"><th scope="colgroup" colspan="${used.length + 2}">${esc(groups[g])}</th></tr>${list.map(row).join('')}</tbody>`,
    )
    .join('');
  const ranged = b.rows.some(r => r.total.low !== r.total.high);
  const table = b.rows.length
    ? `<div class="stat-sources-wrap"><table class="stat-sources">${head}${bodies}</table></div>`
    : '';
  const godstones = b.godstones.length
    ? `<h3>${t('Theostones')}</h3><ul class="stat-godstones">${b.godstones.map(s => `<li><strong>${esc(s.name)}</strong><small>${esc(slotLabel(s.slot))}</small>${s.desc ? `<span>${esc(s.desc)}</span>` : ''}</li>`).join('')}</ul>`
    : '';
  const skipped = b.skipped.length
    ? `<details class="stat-skipped"><summary>${esc(tn(b.skipped.length, '{n} effect not counted', '{n} effects not counted'))}</summary><p>${t('These effects are no plain stat value (they work only under a condition, or say what they do in words), so they are not in the table.')}</p><ul>${b.skipped.map(s => `<li><small>${esc(names[s.source])}</small>${esc(s.text)}</li>`).join('')}</ul></details>`
    : '';
  return `<section class="armory-panel stat-sources-panel"><div class="section-heading"><h2>${t('Where stats come from')}</h2></div><p class="stat-sources-intro">${t("What the equipped items' properties, soul binding and stones, the sets, the open Daevanion nodes and the titles worn add to each stat. A flat value and a percentage of the same stat are separate rows. The character's level and class add more, so PLAYNC's stats are higher.")}${ranged ? ' ' + t("A weapon's attack is a range: the lowest hit (its minimum plus the enchantment bonus) to the highest (its maximum plus the bonus), and totals with it show both ends.") : ''}</p>${table}${godstones}${skipped}</section>`;
}

// ---------------------------------------------------------------- Daevanion and skills

// What every board's open nodes add up to, by stat.
export function boardTotalsPanel(p) {
  const boards = (p.boards || []).filter(b => b.statEffects?.length);
  const rows = sumEffects(boards.flatMap(b => b.statEffects));
  if (boards.length < 2 || !rows.length) return '';
  return `<section class="armory-panel board-totals-panel"><div class="section-heading"><h2>${t('All boards together')} <span>${esc(tn(boards.length, '{n} board', '{n} boards'))}</span></h2></div><ul class="board-totals">${rows.map(r => `<li><span>${esc(r.name)}</span><b>+${esc(amount(r.value, r.percent))}</b></li>`).join('')}</ul></section>`;
}

// What the gear's soul binding and the Daevanion boards add to each skill's level.
export function skillBoostPanel(p) {
  const rows = skillBoostTotals(p);
  if (!rows.length) return '';
  const gear = rows.reduce((n, r) => n + r.gear, 0),
    boards = rows.reduce((n, r) => n + r.boards, 0);
  const cell = n => (n ? `+${number(n)}` : '·');
  return `<section class="armory-panel skill-boost-panel"><div class="section-heading"><h2>${t('Skill levels from gear and Daevanion')} <span>${esc(tn(rows.length, '{n} skill', '{n} skills'))}</span></h2></div><p class="stat-sources-intro">${esc(t('Gear adds {gear} skill levels, Daevanion {boards}.', { gear: number(gear), boards: number(boards) }))}</p><div class="stat-sources-wrap"><table class="stat-sources skill-boosts"><thead><tr><th scope="col">${t('Skill')}</th><th scope="col">${t('From gear')}</th><th scope="col">${t('From Daevanion')}</th><th scope="col">${t('Total')}</th></tr></thead><tbody>${rows.map(r => `<tr><th scope="row">${esc(r.name)}</th><td data-label="${esc(t('From gear'))}"${r.gear ? '' : ' class="is-none"'}>${cell(r.gear)}</td><td data-label="${esc(t('From Daevanion'))}"${r.boards ? '' : ' class="is-none"'}>${cell(r.boards)}</td><td class="stat-total" data-label="${esc(t('Total'))}">+${number(r.total)}</td></tr>`).join('')}</tbody></table></div></section>`;
}
