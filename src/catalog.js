import { t, tn } from './i18n.js';
import { escape as esc } from './model.js';
// The dungeon catalog superusers keep (the snapshot's `catalog`): entries { name, cost,
// partySize, category, unconfirmed }, where cost 0 means the server-wide Odyle per cube
// and partySize 0 that it is not set. While the catalog is empty, wishlists and runs take
// any name.

// Dungeon names match as the server matches them: trimmed, inner spaces collapsed, any case.
export const dungeonKey = name => String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
// The catalog entry of a dungeon, or null when the catalog does not list it.
export const entryOf = (catalog, name) => catalog.find(d => dungeonKey(d.name) === dungeonKey(name)) || null;
// What one cube of a listed dungeon costs.
export const cubeCost = (entry, perCube) => entry?.cost > 0 ? entry.cost : perCube;
// The line under a listed dungeon on the wishlist and planned runs: its cost, party size
// and the cubes of it the room's party can open now. `party(cost)` is the room's party at
// that cost (readiness.js); the cubes show only while somebody is live. With more live
// players than the dungeon takes, the best of them go, so their lowest decides.
export function dungeonFacts(entry, { perCube, party }) {
  if (!entry) return '';
  const cost = cubeCost(entry, perCube), { players = [] } = party(cost), values = players.map(c => c.value).sort((a, b) => b - a);
  const going = entry.partySize > 0 ? values.slice(0, entry.partySize) : values, cubes = going.length ? Math.floor(going.at(-1) / cost) : 0;
  const parts = [entry.unconfirmed ? t('{cost} Odyle per cube (unconfirmed)', { cost }) : t('{cost} Odyle per cube', { cost }), entry.partySize ? tn(entry.partySize, '{n} player', '{n} players') : ''].filter(Boolean).map(esc);
  if (going.length) parts.push(`<span class="dungeon-cubes">${esc(tn(cubes, 'party can open {n} cube', 'party can open {n} cubes'))}${going.length < values.length ? ' ' + esc(t('(best {n} of {all})', { n: going.length, all: values.length })) : ''}</span>`);
  return `<small class="dungeon-facts">${parts.join(' · ')}</small>`;
}
// The dungeon field of the wishlist and run forms. With a catalog it is a list to pick
// from, grouped by category, each dungeon with its cost; `choices` are the dungeons
// offered (the whole catalog by default). Without a catalog it takes any name and
// suggests `suggestions` through the datalist `list`. `value` preselects a dungeon: a run
// being changed keeps its own, even one the catalog no longer lists.
export function dungeonField({ catalog, choices = catalog, suggestions = [], list, placeholder = '', value = '', perCube }) {
  const label = esc(t('Dungeon'));
  if (!catalog.length) return `<input name="dungeon" maxlength="60" list="${list}" autocomplete="off"${placeholder ? ` placeholder="${esc(placeholder)}"` : ''} aria-label="${label}" required${value ? ` value="${esc(value)}"` : ''}><datalist id="${list}">${suggestions.map(d => `<option value="${esc(d)}">`).join('')}</datalist>`;
  const chosen = value ? entryOf(choices, value) : null, groups = [];
  for (const d of choices) { const group = groups.find(g => g.name === d.category); if (group) group.items.push(d); else groups.push({ name: d.category, items: [d] }); }
  const option = d => `<option value="${esc(d.name)}"${d === chosen ? ' selected' : ''}>${esc(d.name)} · ${esc(t('{cost} Odyle', { cost: cubeCost(d, perCube) }))}</option>`;
  const options = groups.map(g => g.name ? `<optgroup label="${esc(g.name)}">${g.items.map(option).join('')}</optgroup>` : g.items.map(option).join('')).join('');
  const own = value && !chosen ? `<option value="${esc(value)}" selected>${esc(value)}</option>` : '';
  return `<select name="dungeon" required aria-label="${label}"><option value="" disabled${value ? '' : ' selected'}>${esc(placeholder || t('Choose a dungeon'))}</option>${own}${options}</select>`;
}
