// A character's PvP counts on its row (pvpButton), while its player has PvP stats on: kills and
// deaths, with the assists in its tooltip. The dialog it opens is pvp.js, which loads with it
// (main.js).
import { t, tn, locale } from './i18n.js';
import { escape as esc } from './model.js';
import { icon } from './icons.js';

const number = n => (Number(n) || 0).toLocaleString(locale());

export function pvpButton(c) {
  const p = c.pvp;
  if (!p || !c.id) return '';
  const kills = Number(p.kills) || 0, assists = Number(p.assists) || 0, deaths = Number(p.deaths) || 0;
  const title = t('PvP of {name}: kills {kills} · assists {assists} · deaths {deaths}', { name: c.characterName, kills: number(kills), assists: number(assists), deaths: number(deaths) });
  return `<button class="place-line pvp-line" type="button" data-pvp="${esc(c.id)}" data-name="${esc(c.characterName)}" title="${esc(title)}">${icon('swords')}<span class="pvp-count">${esc(tn(kills, '{n} kill', '{n} kills'))}</span><span class="place-age">${esc(tn(deaths, '{n} death', '{n} deaths'))}</span></button>`;
}
