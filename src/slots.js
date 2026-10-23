// The Odyle slot machine (#107), an easter egg: the logo clicked seven times opens #/slots.
// Spins come every day (dailySpins free ones, unused ones lapse) and from playing (perCharacter
// a day for each character the reader reads); each may win a cosmetic item for the account,
// rolled on the server (backend/odyle/slots.go). Equipped items show next to the account's name
// in its rooms (lookName, frameClass).
import { t, tn } from './i18n.js';
import { escape as esc } from './model.js';

export const rarities = ['common', 'rare', 'epic', 'legendary'];
// A win shows three alike, its rarity's face; a spin that wins nothing shows three different
// faces, never two alike (no near miss).
export const reelFaces = { common: '🍀', rare: '🌙', epic: '🐉', legendary: '💎' };
const kinds = [['color', 'Name colours'], ['frame', 'Avatar frames'], ['badge', 'Badges']];
const rarityLabel = rarity => t({ common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' }[rarity] || rarity);

// Only values of the server's catalog shape reach a style attribute.
const safeColor = value => /^#[0-9a-f]{6}$/i.test(value || '') || /^linear-gradient\(\d+deg(,#[0-9a-f]{6})+\)$/i.test(value || '') ? value : '';
const colorStyle = value => !safeColor(value) ? '' : value.startsWith('linear-gradient') ? `background:${value};-webkit-background-clip:text;background-clip:text;color:transparent` : `color:${value}`;
export const frameClass = look => /^[a-z]+$/.test(look?.frame || '') ? ` frame-${look.frame}` : '';
export function lookName(name, look) {
  const style = colorStyle(look?.color), badge = look?.badge && look.badge.length <= 8 ? `<span class="look-badge" aria-hidden="true">${esc(look.badge)}</span>` : '';
  return `${style ? `<span class="look-name" style="${style}">${esc(name)}</span>` : esc(name)}${badge}`;
}
// The look an account wears, from its collection (what rooms are sent).
export function lookOf(state) {
  const look = {};
  for (const [kind] of kinds) { const item = state?.catalog?.find(c => c.id === state.equipped?.[kind]); if (item && state.owned.includes(item.id)) look[kind] = item.value; }
  return look;
}
const swatch = item => item.kind === 'color' ? `<span class="slot-swatch" style="${colorStyle(item.value)}">Aa</span>` : item.kind === 'frame' ? `<span class="portrait slot-frame${frameClass({ frame: item.value })}">Od</span>` : `<span class="slot-emoji">${esc(item.value)}</span>`;

// Three different faces for a spin that won nothing, picked from the spin's seed.
export function missFaces(seed = 0) {
  const all = Object.values(reelFaces), first = seed % all.length, second = (first + 1 + (Math.floor(seed / 4) % (all.length - 1))) % all.length;
  const third = all.findIndex((_, i) => i !== first && i !== second);
  return [all[first], all[second], all[third]];
}
// How spins come, as the server's rules say (the free spins of the day, then the earned ones).
function spinSources(state) {
  const daily = state.dailySpins ?? 0, perCharacter = state.perCharacter ?? 1;
  return [daily > 0 ? tn(daily, 'You get {n} free spin every day; unused ones do not carry over.', 'You get {n} free spins every day; unused ones do not carry over.') : '',
    perCharacter > 0 ? tn(perCharacter, 'Every character your reader reads earns {n} more a day.', 'Every character your reader reads earns {n} more a day.') : '',
    t('Spins win cosmetics for your name in rooms.')].filter(Boolean).join(' ');
}
export function slotsView({ state, spinning = false, last = null, name = '', sound = true }) {
  if (!state) return `<main class="dashboard slots-page"><p class="intro">${t('Loading…')}</p></main>`;
  const spins = state.spins, faces = spinning ? Object.values(reelFaces) : last?.won ? Array(3).fill(reelFaces[last.won.rarity]) : last?.lost ? missFaces(last.seed) : ['🍀', '🌙', '💎'];
  const reels = faces.slice(0, 3).map((face, i) => `<span class="slot-reel ${spinning ? 'spinning' : ''}" style="--reel:${i}">${spinning ? `<span class="slot-strip">${[...Object.values(reelFaces), ...Object.values(reelFaces)].map(f => `<span>${f}</span>`).join('')}</span>` : `<span>${face}</span>`}</span>`).join('');
  const result = !spinning && last?.lost ? `<p class="slot-result" role="status">${t('No win this time.')}</p>` : !spinning && last ? `<p class="slot-result rarity-${esc(last.won.rarity)}" role="status">${last.duplicate ? esc(t('{item} again: already yours, +1 shard.', { item: t(last.won.name) })) : esc(t('You won {item} · {rarity}!', { item: t(last.won.name), rarity: rarityLabel(last.won.rarity) }))}</p>` : `<p class="slot-result" role="status">${spinning ? t('Spinning…') : ''}</p>`;
  const look = lookOf(state);
  const groups = kinds.map(([kind, title]) => {
    const items = state.catalog.filter(c => c.kind === kind).sort((a, b) => rarities.indexOf(a.rarity) - rarities.indexOf(b.rarity));
    const tiles = items.map(item => {
      const owned = state.owned.includes(item.id), worn = state.equipped?.[kind] === item.id;
      const action = !owned ? '' : worn ? `<button class="text-button" data-slot-equip="" data-kind="${kind}">${t('Take off')}</button>` : `<button class="text-button" data-slot-equip="${esc(item.id)}" data-kind="${kind}">${t('Wear')}</button>`;
      return `<div class="slot-item rarity-${esc(item.rarity)} ${owned ? '' : 'locked'} ${worn ? 'worn' : ''}">${owned ? swatch(item) : '<span class="slot-locked" aria-hidden="true">?</span>'}<strong>${owned ? esc(t(item.name)) : t('Not found yet')}</strong><small>${esc(rarityLabel(item.rarity))}${worn ? ' · ' + t('worn') : ''}</small>${action}</div>`;
    }).join('');
    const count = items.filter(i => state.owned.includes(i.id)).length;
    return `<section class="party-section slot-group"><div class="section-heading"><h2>${t(title)} <span>${count}/${items.length}</span></h2></div><div class="slot-items">${tiles}</div></section>`;
  }).join('');
  return `<main class="dashboard slots-page"><section class="heading"><div><div class="eyebrow"><span class="tiny-diamond"></span> ${t('YOU FOUND IT')}</div><h1>${t('Odyle slot machine')}<span class="mint">.</span></h1><p>${esc(spinSources(state))}</p></div></section>`
    + `<section class="slot-machine"><div class="slot-window" aria-hidden="true">${reels}</div>${result}<div class="slot-controls"><button class="button primary slot-spin" data-action="slot-spin" ${spins < 1 || spinning ? 'disabled' : ''}>${t('Spin')}</button><button class="icon-button slot-sound" data-action="slot-sound" aria-pressed="${sound}" title="${esc(sound ? t('Sound on') : t('Sound off'))}" aria-label="${esc(t('Sound'))}">${sound ? '🔊' : '🔇'}</button><span class="slot-spins">${esc(tn(spins, '{n} spin left', '{n} spins left'))}${state.daily > 0 ? ` (${esc(t('{n} free today', { n: state.daily }))})` : ''} · ${esc(t('Shards {n}/{of}', { n: state.shards, of: state.shardsForSpin }))}</span></div>`
    + `<p class="slot-preview">${t('In rooms:')} <span class="portrait slot-frame${frameClass(look)}">${esc(name.slice(0, 2).toUpperCase())}</span> ${lookName(name, look)}</p>`
    + `<small class="slot-odds">${esc(t('A spin wins {chance} % of the time; wins are common 60 %, rare 27 %, epic 10 %, legendary 3 %. A duplicate gives a shard, three shards a spin. Cosmetic only, nothing to buy.', { chance: state.winChance ?? 15 }))}</small></section>${groups}</main>`;
}
