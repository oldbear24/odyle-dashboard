// Player cards: an armory profile as a trading card on a page of its own
// (/armory/<region>/<server id>/<character id>/card), turning in 3D under the pointer, by drag
// and by keyboard, and saved as a picture (cardimage.js). Everything on it comes from PLAYNC
// like the rest of the armory; only its look is chosen, by the player whose Odyle app read the
// character (backend/odyle/cards.go): one of the designs after AION's realms, for players with
// the membership a holo finish, and the options: the layout, the back's design, which stats
// and skills it shows, the line under the class, the effect around the card on its page, the
// accent colour, the frame and the name's style. The page lets that player try looks on the
// card before saving one, in a picker with tabs. Each look has depth: what lies under the
// card's surface (its design's backdrop, the portrait, the foil) shifts as the card turns, and
// the effect around it is in the card's own 3D space, turning with it (card.css).
import { t } from './i18n.js';
import { escape as esc } from './model.js';
import { icon } from './icons.js';
import { link, address } from './routes.js';
import { profilePath, imageUrl, classBadge, gradeClass } from './armory.js';

export const cardDesigns = () => [['elysea', t('Elysea'), t('Pearl and gold leaf under an Elyos sky')], ['asmodae', t('Asmodae'), t('Twilight violet with ember trim')], ['abyss', t('Abyss'), t('Obsidian split by aether light')],
  ['balaur', t('Balaur'), t('Crimson dragon scale and black iron')], ['beluslan', t('Beluslan'), t('Glacier blue over Asmodian snowfields')], ['heiron', t('Heiron'), t('Forest green and bronze of the Elyos wilds')],
  ['sanctum', t('Sanctum'), t('White marble and gold of the Elyos capital')], ['pandaemonium', t('Pandaemonium'), t('Black iron and lantern light of the Asmodian capital')], ['eltnen', t('Eltnen'), t('Desert sand and copper under a high sun')],
  ['inggison', t('Inggison'), t('A twilight jungle of glowing blooms')], ['dredgion', t('Dredgion'), t('Balaur warship steel and warning lights')], ['tiamaranta', t('Tiamaranta'), t('Dragon gold over dark jade')]];
export const cardFinishes = () => [['', t('Plain'), t('A clean print')], ['prism', t('Prism holo'), t('Rainbow foil that shifts with the light')], ['starfall', t('Starfall holo'), t('Glitter scattered over the foil')], ['etched', t('Etched foil'), t('Engraved metal lines')],
  ['sunburst', t('Sunburst holo'), t('Rays of light fanning out from the shine')], ['ice', t('Cracked ice'), t('Shattered foil shards that catch the light')], ['scales', t('Dragon scale'), t('Balaur scales in burnished foil')], ['aether', t('Aether holo'), t('Bands of aether light drifting like an aurora')],
  ['opal', t('Opal holo'), t('A milky sheen that flashes every colour')], ['galaxy', t('Galaxy holo'), t('Stars and nebulae deep under the foil')], ['lenticular', t('Lenticular'), t('Fine ridges that change colour as the card turns')],
  ['brushed', t('Brushed metal'), t('Brushed steel with a streak of light')], ['stained', t('Stained glass'), t('Panes of coloured glass lit from behind')], ['shield', t('Aether shield'), t('A glowing grid like a shield of aether')]];
export const cardLayouts = () => [['classic', t('Classic')], ['full', t('Full art')]];
export const cardStatSets = () => [['primary', t('Main stats')], ['deity', t('Deity stats')]];
export const cardLines = () => [['title', t('Title')], ['legion', t('Legion')], ['none', t('Nothing')]];
// The effect around the card, the accent colours (with their colour), frames and name styles;
// "" is none, or the design's own.
export const cardAuras = () => [['', t('No effect')], ['glow', t('Glow')], ['embers', t('Embers')], ['stardust', t('Stardust')], ['runes', t('Runes')], ['storm', t('Storm')],
  ['wings', t('Wings')], ['orbit', t('Orbits')], ['feathers', t('Feathers')], ['shards', t('Shards')], ['rift', t('Rift')]];
export const cardAccents = () => [['', t('From the design')], ['gold', t('Gold'), '#e3b54a'], ['silver', t('Silver'), '#d3dae2'], ['ember', t('Ember'), '#ff7a45'], ['jade', t('Jade'), '#4fd1a1'], ['azure', t('Azure'), '#4aa8ff'], ['violet', t('Violet'), '#b07cff'], ['rose', t('Rose'), '#ff6fa8']];
export const cardFrames = () => [['', t('From the design')], ['gilded', t('Gilded')], ['silver', t('Silvered')], ['radiant', t('Radiant')], ['none', t('No frame')]];
export const cardNameStyles = () => [['', t('Simple')], ['gold', t('Gold leaf')], ['glow', t('Glowing')]];
export const defaultOptions = () => ({ layout: 'classic', back: '', stats: 'primary', line: 'title', skills: [], aura: '', accent: '', frame: '', nameStyle: '' });
export const cardPath = answer => profilePath(answer) + '/card';
// The page's title in the tab, as the backend names it (backend/odyle/pages.go).
export const cardTitle = answer => answer?.profile ? t("{name}'s player card · {server} · Odyle Armory", { name: answer.profile.name, server: answer.profile.server || answer.server }) : t('A character on {server} · Odyle Armory', { server: answer?.server || '' });
const known = (list, key) => list.some(([k]) => k === key);
// The design a card shows: its owner's, or by the character's race until one is chosen.
export function designOf(answer, chosen = '') {
  const pick = chosen || answer.card?.design;
  if (known(cardDesigns(), pick)) return pick;
  return /asmodian/i.test(answer.profile?.race || '') ? 'asmodae' : 'elysea';
}
export const finishOf = (answer, chosen) => known(cardFinishes(), chosen ?? answer.card?.finish) ? (chosen ?? answer.card?.finish ?? '') : '';
// The look a card shows: what its player tries ({ design, finish, options }), else what was saved.
export function lookOf(answer, tried = {}) {
  const asked = { ...defaultOptions(), ...(answer.card?.options || {}), ...(tried.options || {}) }, d = defaultOptions();
  const options = {
    layout: known(cardLayouts(), asked.layout) ? asked.layout : d.layout, back: known(cardDesigns(), asked.back) ? asked.back : '',
    stats: known(cardStatSets(), asked.stats) ? asked.stats : d.stats, line: known(cardLines(), asked.line) ? asked.line : d.line,
    skills: (Array.isArray(asked.skills) ? asked.skills : []).filter(s => typeof s === 'string' && s).slice(0, 2),
    aura: known(cardAuras(), asked.aura) ? asked.aura : '', accent: known(cardAccents(), asked.accent) ? asked.accent : '',
    frame: known(cardFrames(), asked.frame) ? asked.frame : '', nameStyle: known(cardNameStyles(), asked.nameStyle) ? asked.nameStyle : '',
  };
  return { design: designOf(answer, tried.design), finish: finishOf(answer, tried.finish), options };
}
export const sameLook = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const number = value => Number(value || 0).toLocaleString('en-US');
const grades = ['common', 'rare', 'legend', 'unique', 'epic', 'mythic'];
// The best grade among the equipped gear, shown as the card's set mark.
export function bestGrade(gear = []) {
  return gear.reduce((best, g) => Math.max(best, grades.indexOf(String(g.grade).toLowerCase())), 0);
}
export const gradeName = gear => grades[bestGrade(gear)];
// The two strongest skills on the skill bar, as the card's moves.
export function signatureSkills(skills = []) {
  const active = skills.filter(s => s.acquired && s.category === 'Active');
  return [...(active.some(s => s.equipped) ? active.filter(s => s.equipped) : active)].sort((a, b) => b.level - a.level).slice(0, 2);
}
// The skills a card shows: those its player chose (learned ones), then the strongest on the bar.
export function cardSkills(skills = [], chosen = []) {
  const picked = chosen.map(name => skills.find(s => s.name === name && s.acquired)).filter(Boolean);
  return [...picked, ...signatureSkills(skills).filter(s => !picked.includes(s))].slice(0, 2);
}
// The stats a card shows: the primary ones, or the deity stats.
export const cardStats = (stats = [], set = 'primary') => stats.filter(s => set === 'deity' ? !s.primary : s.primary).slice(0, 6);
// The line under the class: the equipped title, the legion, or nothing.
export function cardLine(p, line) {
  if (line === 'legion' && p.legion) return { kind: 'legion', text: p.legion };
  if (line === 'title' && p.title) return { kind: 'title', text: p.title, grade: p.titleGrade };
  return null;
}
export const raceName = race => /asmodian/i.test(race) ? t('Asmodians') : /elyos/i.test(race) ? t('Elyos') : race || '';

// The front of the card.
function front(answer, images, look) {
  const p = answer.profile, stats = cardStats(p.stats, look.options.stats), line = cardLine(p, look.options.line);
  const portrait = imageUrl(images, p.portrait);
  const boards = (p.boards || []).reduce((n, b) => ({ open: n.open + b.open, total: n.total + b.total }), { open: 0, total: 0 });
  const grade = gradeName(p.gear);
  const moves = cardSkills(p.skills, look.options.skills).map(s => `<li><span class="tcg-move-icon">${imageUrl(images, s.icon) ? `<img src="${esc(imageUrl(images, s.icon))}" alt="" decoding="async" draggable="false">` : ''}</span><span class="tcg-move-name">${esc(s.name)}</span><b>${esc(t('Lv {level}', { level: s.level }))}</b></li>`).join('');
  return `<div class="tcg-face tcg-front">
<div class="tcg-depth" aria-hidden="true"></div><div class="tcg-frame"></div>
<header class="tcg-name"><h2>${esc(p.name)}</h2><span class="tcg-level">${esc(t('Lv {level}', { level: p.level }))}${classBadge(images, answer.classIcon, p.class)}</span></header>
<div class="tcg-art"><span class="tcg-initials" aria-hidden="true">${esc([...String(p.name || '?')].slice(0, 2).join('').toUpperCase())}</span>${portrait ? `<img class="tcg-portrait" src="${esc(portrait)}" alt="" decoding="async" draggable="false">` : ''}</div>
<p class="tcg-type"><span>${esc(p.class || '')}</span><span>${esc(raceName(p.race))}</span></p>
${line ? `<p class="tcg-line is-${line.kind}${line.grade ? ' ' + gradeClass(line.grade) : ''}">${line.kind === 'legion' ? esc(t('Legion {name}', { name: line.text })) : esc(line.text)}</p>` : ''}
<div class="tcg-panel">
<div class="tcg-power"><span>${t('Combat power')}</span><strong>${esc(number(p.combatPower))}</strong></div>
<div class="tcg-power is-minor"><span>${t('Item level')}</span><strong>${esc(number(p.itemLevel))}</strong></div>
${moves ? `<ul class="tcg-moves">${moves}</ul>` : ''}
${stats.length ? `<dl class="tcg-stats">${stats.map(s => `<div><dt>${esc(s.name)}</dt><dd>${esc(number(s.value))}</dd></div>`).join('')}</dl>` : ''}
</div>
<footer class="tcg-foot"><span>${boards.total ? esc(t('Daevanion {open}/{total}', { open: boards.open, total: boards.total })) : ''}${p.titles?.total ? `<br>${esc(t('Titles {owned}/{total}', { owned: p.titles.owned, total: p.titles.total }))}` : ''}</span><span class="tcg-mark"><i class="tcg-gem grade-${grade}" title="${esc(t('Best gear grade: {grade}', { grade: t(grade[0].toUpperCase() + grade.slice(1)) }))}"></i><span>odyle<em>.</em></span> ${esc(String(answer.region).toUpperCase())} ${esc(answer.serverId)}</span></footer>
<div class="tcg-shine"></div><div class="tcg-glare"></div>
</div>`;
}

// The card's thickness: thin layers between its faces, which show as its edge when it turns.
const edge = (layers = 12) => `<div class="tcg-edge" aria-hidden="true">${Array.from({ length: layers - 1 }, (_, i) => `<i style="--z:${((i + 1) / layers).toFixed(3)}"></i>`).join('')}</div>`;

// The back: the same for every card of a design, in the front's design or another.
const back = design => `<div class="tcg-face tcg-back${design ? ' design-' + design : ''}" aria-hidden="true"><div class="tcg-depth"></div><div class="tcg-frame"></div><div class="tcg-emblem"><span class="tcg-rings"></span>${icon('diamond')}<strong>odyle<em>.</em></strong><small>${t('AION 2 armory')}</small></div><div class="tcg-glare"></div></div>`;

// The card's faces and edge in a look with the effect around it, and the classes that look
// gives the card.
export const cardFaces = (answer, images, look) => `${cardAura(look)}${front(answer, images, look)}${edge()}${back(look.options.back)}`;
export const cardClasses = ({ design, finish, options: o }) => `tcg design-${design}${finish ? ' finish-' + finish : ''}${o.layout === 'full' ? ' layout-full' : ''}${['accent', 'frame', 'nameStyle'].map(k => o[k] ? ` ${k === 'nameStyle' ? 'name' : k}-${o[k]}` : '').join('')}`;

// The effect around the card on its page, in its accent colour: in the card's 3D space, so it
// turns with the card, its sparks, feathers and shards in front of the card and behind it, in
// places that stay the same from one visit to the next (card.css).
const scatter = (i, k) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
// Left or right of the card, which covers the middle of the effect's box.
const beside = r => r < 0.5 ? 2 + r * 34 : 66 + r * 32;
// How far in front of the card (or behind it, below 0.5) in cqw: at least near, at most far.
const depth = (r, near, far) => ((r < 0.5 ? -1 : 1) * (near + Math.abs(r * 2 - 1) * (far - near))).toFixed(1) + 'cqw';
const sparks = (n, style) => Array.from({ length: n }, (_, i) => `<i style="${style(i, scatter(i, 1), scatter(i, 2), scatter(i, 3))}"></i>`).join('');
// A plane behind each face, the back's turned with it.
const planes = kind => `<b class="tcg-plane ${kind}"></b><b class="tcg-plane ${kind} is-back"></b>`;
// A ring around the card, tilted back by tilt and rolled by roll degrees, turning once in t seconds.
const ring = (kind, size, tilt, roll, t, at = 50) => `<b class="tcg-ring ${kind}" style="--w:${size}cqw;--tilt:${tilt}deg;--roll:${roll}deg;--t:${t}s;--at:${at}%"><b></b></b>`;
// A wing of feathers of light, its shoulder on the left: long flight feathers along the arm
// and shorter ones over them (card.css mirrors it for the left wing).
const wing = (() => {
  const feather = (x, y, angle, length, width, kind) => `<path class="${kind}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${angle.toFixed(1)})" d="M0 0C${(length * 0.3).toFixed(1)} ${-width} ${(length * 0.75).toFixed(1)} ${(-width * 0.7).toFixed(1)} ${length.toFixed(1)} 0C${(length * 0.75).toFixed(1)} ${(width * 0.45).toFixed(1)} ${(length * 0.3).toFixed(1)} ${(width * 0.55).toFixed(1)} 0 0Z"/>`;
  const row = (count, angles, lengths, width, kind) => Array.from({ length: count }, (_, i) => { const f = i / (count - 1); return feather(f * 50, 60 - f * 50, angles[0] + (angles[1] - angles[0]) * f, lengths[0] + (lengths[1] - lengths[0]) * f, width, kind); });
  return `<svg viewBox="-12 -14 160 120" focusable="false">${[...row(12, [100, -10], [40, 92], 7, 'is-flight'), ...row(8, [96, 4], [22, 40], 6, 'is-covert')].join('')}</svg>`;
})();
export function cardAura(look) {
  const aura = look.options.aura;
  const inside = {
    glow: () => planes('tcg-halo'),
    embers: () => sparks(18, (i, a, b, c) => `--x:${(i % 3 ? beside(a) : 22 + a * 56).toFixed(1)}%;--z:${depth(c, i % 3 ? 0 : 7, 30)};--s:${(0.9 + b * 1.5).toFixed(2)}cqw;--t:${(5 + b * 4).toFixed(1)}s;--d:${(-a * 9).toFixed(1)}s;--drift:${((b - 0.5) * 24).toFixed(1)}cqw`),
    stardust: () => sparks(26, (i, a, b, c) => { const above = i % 3 === 0; return `--x:${(above ? 14 + a * 72 : beside(a)).toFixed(1)}%;--y:${(above ? (b < 0.5 ? 1 + b * 16 : 84 + (b - 0.5) * 28) : 3 + b * 92).toFixed(1)}%;--z:${depth(c, 3, 30)};--s:${(2.4 + b * 3.2).toFixed(2)}cqw;--t:${(2.6 + a * 3).toFixed(1)}s;--d:${(-b * 5).toFixed(1)}s`; }),
    runes: () => planes('tcg-circle') + planes('tcg-circle is-inner') + ring('is-runes', 118, 72, 0, 50, 84),
    storm: () => planes('tcg-flash') + sparks(5, (i, a, b, c) => `--x:${beside(i % 2 ? 0.55 + a * 0.4 : a * 0.45).toFixed(1)}%;--y:${(6 + b * 70).toFixed(1)}%;--z:${depth(c, 4, 26)};--r:${((a - 0.5) * 40).toFixed(0)}deg;--d:${(-i * 1.1).toFixed(1)}s`),
    wings: () => `<i class="tcg-wing is-left">${wing}</i><i class="tcg-wing is-right">${wing}</i>`,
    orbit: () => ring('is-orbit', 150, 74, -16, 9) + ring('is-orbit', 128, 68, 24, 7) + ring('is-orbit', 172, 80, 4, 13),
    feathers: () => sparks(14, (i, a, b, c) => `--x:${(3 + a * 94).toFixed(1)}%;--z:${depth(c, 8, 34)};--s:${(3 + b * 2.4).toFixed(2)}cqw;--t:${(9 + b * 6).toFixed(1)}s;--d:${(-a * 15).toFixed(1)}s;--sway:${((b - 0.5) * 30).toFixed(1)}cqw;--axis:${(a - 0.5).toFixed(2)} 1 ${(c - 0.5).toFixed(2)}`),
    shards: () => sparks(10, (i, a, b, c) => { const above = i % 4 === 0; return `--x:${(above ? 26 + a * 48 : beside(a)).toFixed(1)}%;--y:${(above ? (b < 0.5 ? 2 + b * 14 : 86 + (b - 0.5) * 20) : 6 + b * 84).toFixed(1)}%;--z:${depth(c, 0, 28)};--s:${(3 + b * 3.5).toFixed(2)}cqw;--t:${(8 + a * 8).toFixed(1)}s;--d:${(-b * 8).toFixed(1)}s;--axis:${(0.2 + a).toFixed(2)} 1 ${(c * 0.6).toFixed(2)}`; }),
    rift: () => planes('tcg-vortex') + planes('tcg-vortex is-inner'),
  }[aura];
  return `<div class="tcg-aura${aura ? ' aura-' + aura : ''}" aria-hidden="true">${inside ? inside() : ''}</div>`;
}

// The look picker's tabs: the design and the back, the finish, the effects and styles around
// and on the card, and what the card shows.
export const studioTabs = () => [['design', t('Design')], ['finish', t('Finish')], ['effects', t('Effects')], ['content', t('Contents')]];
// The look picker for the card's owner, its choices under tabs (tab is the open one), and Save.
function studio(answer, look, tab = 'design') {
  const card = answer.card || {}, p = answer.profile;
  if (!card.mine) return `<p class="card-owner-note">${icon('info')}<span>${esc(t('The player whose Odyle app reads {name} chooses this card\'s design.', { name: p.name }))}</span></p>`;
  if (!studioTabs().some(([key]) => key === tab)) tab = 'design';
  // A tile with a swatch of each design or finish; the chosen one's line says what it is.
  const tile = (name, [key, label, hint], chosen, locked = false) => `<label class="card-choice is-${esc(key || 'plain')}${locked ? ' is-locked' : ''}" title="${esc(hint)}"><input type="radio" name="${name}" value="${esc(key)}" ${key === chosen ? 'checked' : ''} ${locked ? 'disabled' : ''}><span class="card-swatch${name === 'design' ? ' design-' + esc(key) : ''}" aria-hidden="true">${locked ? icon('star') : ''}</span><strong>${esc(label)}</strong></label>`;
  const tiles = (name, list, chosen, locked) => `<div class="card-choices">${list.map(item => tile(name, item, chosen, locked?.(item[0]))).join('')}</div><p class="card-about" data-about="${name}">${esc(list.find(([key]) => key === chosen)?.[2] || '')}</p>`;
  const pills = (name, list, chosen, off = () => false) => `<div class="card-pills">${list.map(([key, label, colour]) => `<label class="card-pill"><input type="radio" name="${name}" value="${esc(key)}" ${key === chosen ? 'checked' : ''} ${off(key) ? 'disabled' : ''}><span>${colour ? `<i class="card-dot" style="--dot:${esc(colour)}"></i>` : ''}${esc(label)}</span></label>`).join('')}</div>`;
  const learned = (p.skills || []).filter(s => s.acquired).sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
  const skill = i => `<label class="card-select">${i ? t('Second skill') : t('First skill')}<select name="skill${i}"><option value="">${t('Strongest on the skill bar')}</option>${learned.map(s => `<option value="${esc(s.name)}" ${look.options.skills[i] === s.name ? 'selected' : ''}>${esc(`${s.name} · ${t('Lv {level}', { level: s.level })}`)}</option>`).join('')}</select></label>`;
  const changed = !sameLook(look, lookOf(answer));
  const panels = {
    design: `<fieldset><legend class="sr-only">${t('Design')}</legend>${tiles('design', cardDesigns(), look.design)}</fieldset>
<fieldset><legend>${t('Back of the card')}</legend><label class="card-select">${t('Design of the back')}<select name="back"><option value="">${t('Same as the front')}</option>${cardDesigns().map(([key, label]) => `<option value="${key}" ${look.options.back === key ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label></fieldset>`,
    finish: `<fieldset><legend class="sr-only">${t('Finish')}</legend>${tiles('finish', cardFinishes(), look.finish, key => key !== '' && !card.holo)}${card.holo ? '' : `<p class="card-locked">${icon('star')}<span>${t('Holo finishes are for players with the membership (Account & data).')}</span></p>`}</fieldset>`,
    effects: `<fieldset><legend>${t('Effect around the card')}</legend>${pills('aura', cardAuras(), look.options.aura)}</fieldset>
<fieldset><legend>${t('Accent colour')}</legend>${pills('accent', cardAccents(), look.options.accent)}</fieldset>
<fieldset><legend>${t('Frame')}</legend>${pills('frame', cardFrames(), look.options.frame)}</fieldset>
<fieldset><legend>${t('Name style')}</legend>${pills('nameStyle', cardNameStyles(), look.options.nameStyle)}</fieldset>`,
    content: `<fieldset><legend>${t('Layout')}</legend>${pills('layout', cardLayouts(), look.options.layout)}</fieldset>
<fieldset><legend>${t('Under the class')}</legend>${pills('line', cardLines(), look.options.line, key => key === 'legion' && !p.legion || key === 'title' && !p.title)}</fieldset>
<fieldset><legend>${t('Stats')}</legend>${pills('stats', cardStatSets(), look.options.stats, key => key === 'deity' && !(p.stats || []).some(s => !s.primary))}</fieldset>
<fieldset><legend>${t('Skills')}</legend><div class="card-skills">${skill(0)}${skill(1)}</div></fieldset>`,
  };
  return `<form id="card-form" class="card-studio"><div class="card-tabs" role="tablist" aria-label="${esc(t('Card look'))}">${studioTabs().map(([key, label]) => `<button type="button" role="tab" id="card-tab-${key}" aria-controls="card-panel-${key}" aria-selected="${key === tab}" tabindex="${key === tab ? 0 : -1}" data-card-tab="${key}">${esc(label)}</button>`).join('')}</div>
${studioTabs().map(([key]) => `<div class="card-panel" role="tabpanel" id="card-panel-${key}" aria-labelledby="card-tab-${key}" data-card-panel="${key}"${key === tab ? '' : ' hidden'}>${panels[key]}</div>`).join('\n')}
<button class="button primary" type="submit" ${changed ? '' : 'disabled'}>${t('Save card')}</button></form>`;
}
// Opens a tab of the look picker; the others keep what was chosen on them.
export function openStudioTab(form, tab) {
  for (const button of form.querySelectorAll('[data-card-tab]')) { const open = button.dataset.cardTab === tab; button.setAttribute('aria-selected', String(open)); button.tabIndex = open ? 0 : -1; }
  for (const panel of form.querySelectorAll('[data-card-panel]')) panel.hidden = panel.dataset.cardPanel !== tab;
}
// The line under the designs and finishes, for the one now chosen.
export function studioAbout(form) {
  const lists = { design: cardDesigns(), finish: cardFinishes() }, data = new FormData(form);
  for (const line of form.querySelectorAll('[data-about]')) line.textContent = lists[line.dataset.about]?.find(([key]) => key === String(data.get(line.dataset.about) ?? ''))?.[2] || '';
}
// The look a picker's form asks for.
export function formLook(form) {
  const data = new FormData(form), value = name => String(data.get(name) ?? '');
  return { design: value('design'), finish: value('finish'), options: { layout: value('layout') || 'classic', back: value('back'), stats: value('stats') || 'primary', line: value('line') || 'title', skills: [value('skill0'), value('skill1')].filter(Boolean).filter((s, i, all) => all.indexOf(s) === i), aura: value('aura'), accent: value('accent'), frame: value('frame'), nameStyle: value('nameStyle') } };
}

// The page: the card on its stage, what to do with it, and the owner's look picker. view.look
// is what the owner tries on the card before saving it, view.tab the picker's open tab.
export function cardPage(answer, view = {}) {
  const images = view.images || '', p = answer.profile;
  const head = `<header class="card-bar"><a href="${link('/')}" class="brand" aria-label="${esc(t('Odyle home'))}"><span class="brand-symbol">${icon('diamond')}</span><span class="brand-name">odyle<span class="brand-dot">.</span></span></a><a class="text-button card-back" href="${esc(link(profilePath(answer)))}">${icon('arrow')} ${p ? esc(t('{name}\'s profile', { name: p.name })) : t('Back to the profile')}</a></header>`;
  if (!p) return `<main class="card-page">${head}<section class="card-wait">${view.status || ''}<p>${t('The card is drawn once Odyle has fetched this character from PLAYNC.')}</p></section><div id="toast" role="status" aria-live="polite"></div></main>`;
  const look = lookOf(answer, view.look);
  const label = t('Player card of {name}: level {level} {class} on {server}, {power} combat power.', { name: p.name, level: p.level, class: p.class, server: p.server || answer.server, power: number(p.combatPower) });
  return `<main class="card-page design-${look.design}">${head}<h1 class="sr-only">${esc(cardTitle(answer))}</h1>
<div class="card-layout${answer.card?.mine ? ' has-studio' : ''}"><section class="card-stage" aria-label="${esc(t('Player card'))}">
<div class="tcg-scene"><article class="${cardClasses(look)}" tabindex="0" aria-roledescription="${esc(t('player card'))}" aria-label="${esc(label)}"><div class="tcg-body">${cardFaces(answer, images, look)}</div></article><div class="tcg-shadow" aria-hidden="true"></div></div>
<p class="card-hint">${t('Drag the card in any direction to turn it. Double-click or press Enter to flip it.')}</p>
<div class="card-actions"><button class="button secondary" data-action="card-flip">${t('Flip card')}</button><button class="button secondary" data-action="card-image">${icon('download')} ${t('Save image')}</button><button class="button secondary" data-copy="${esc(address(cardPath(answer)))}" data-copied="${esc(t('Link copied.'))}">${icon('link')} ${t('Copy link')}</button></div>
${answer.card?.mine ? '' : studio(answer, look)}</section>${answer.card?.mine ? studio(answer, look, view.tab) : ''}</div>
<p class="card-source">${t('Card data from PLAYNC\'s official character pages, as Odyle keeps it.')}</p>
<div id="toast" role="status" aria-live="polite"></div></main>`;
}

// ---------------------------------------------------------------- Motion

// The card's orientation is a quaternion [x, y, z, w], turned in the screen's frame, so a
// drag turns it the way the pointer goes whatever way up it is. CSS draws it as rotate3d().
const radians = Math.PI / 180;
export const orientation = {
  // A turn about the axis (x, y, z) by deg degrees.
  about(x, y, z, deg) { const length = Math.hypot(x, y, z) || 1, half = deg * radians / 2, s = Math.sin(half) / length; return [x * s, y * s, z * s, Math.cos(half)]; },
  // a after b: b first, then a in the screen's frame.
  times([ax, ay, az, aw], [bx, by, bz, bw]) { return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz]; },
  unit(q) { const length = Math.hypot(...q) || 1; return q.map(v => v / length); },
  // From a toward b by t (0 to 1), the short way round.
  toward(a, b, t) {
    let dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
    if (dot < 0) { b = b.map(v => -v); dot = -dot; }
    if (dot > 0.9995) return orientation.unit(a.map((v, i) => v + (b[i] - v) * t));
    const angle = Math.acos(dot), s = Math.sin(angle), wa = Math.sin((1 - t) * angle) / s, wb = Math.sin(t * angle) / s;
    return a.map((v, i) => v * wa + b[i] * wb);
  },
  // Where the front faces: its normal (z toward the viewer).
  normal([x, y, z, w]) { return [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)]; },
  // The turn back.
  inverse([x, y, z, w]) { return [-x, -y, -z, w]; },
  // Where the viewer is, seen from the face that shows (x right, y down along it): what lies
  // under its surface shifts this way, by its depth, and what stands out of it the other way.
  view(q) { const [x, y, z] = orientation.normal(orientation.inverse(q)); return z < 0 ? [-x, y] : [x, y]; },
  // The face that shows, upright: the front, or the back turned about the vertical axis. A
  // card turned over top to bottom stays on its back and rights itself.
  rest(q) { return orientation.normal(q)[2] >= 0 ? [0, 0, 0, 1] : [0, 1, 0, 0]; },
  css(q) {
    const [x, y, z, w] = orientation.unit(q), s = Math.sqrt(Math.max(0, 1 - w * w));
    return s < 1e-6 ? 'rotate3d(0, 1, 0, 0deg)' : `rotate3d(${(x / s).toFixed(4)}, ${(y / s).toFixed(4)}, ${(z / s).toFixed(4)}, ${(2 * Math.acos(Math.max(-1, Math.min(1, w))) / radians).toFixed(2)}deg)`;
  },
};
// A drag of dx, dy pixels as a turn in the screen's frame: sideways about the vertical axis,
// up and down about the horizontal one, diagonally about both.
export const dragTurn = (dx, dy, perPixel = 0.5) => orientation.about(-dy, dx, 0, Math.hypot(dx, dy) * perPixel);

// Turns the card on screen: it sways a little on its own and leans toward the pointer.
// Dragged in any direction it turns that way, keeps turning a moment after, and settles on
// the nearer face, upright. The light on its foil and glare follows the face's angle, what
// lies under its surface shifts with it (--tx, --ty), and the sparks around it keep facing
// the viewer (--unturn). Returns flip(); it stops by itself once the card leaves the page,
// and waits while the tab is hidden (no animation frames). With reduced motion it neither
// sways nor turns on.
export function animateCard(card, window = globalThis) {
  const body = card.querySelector('.tcg-body'), shadow = card.parentElement?.querySelector('.tcg-shadow');
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const { about, times, toward, normal, inverse, view, rest, css } = orientation;
  const state = { q: [0, 0, 0, 1], target: [0, 0, 0, 1], spin: [0, 0], drag: null, lean: null, frame: 0 };
  // Chromium (the only engine with navigator.userAgentData) draws it at twice the resolution (card.css).
  if (window.navigator?.userAgentData) card.classList.add('is-sharp');
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const settle = () => { state.target = rest(state.q); };
  function draw(time) {
    if (!card.isConnected) return;
    const speed = Math.hypot(...state.spin);
    if (!state.drag) {
      if (!still && speed > 0.15) { state.q = times(about(state.spin[0], state.spin[1], 0, speed), state.q); state.spin = state.spin.map(v => v * 0.93); if (Math.hypot(...state.spin) <= 0.15) settle(); }
      else state.q = still ? state.target : toward(state.q, state.target, 0.09);
    }
    // On top of where it rests: the sway, or the lean toward the pointer.
    const lean = state.lean && !state.drag ? times(about(1, 0, 0, (0.5 - state.lean.y) * 18), about(0, 1, 0, (state.lean.x - 0.5) * 26))
      : still || state.drag || speed > 0.15 ? [0, 0, 0, 1] : times(about(1, 0, 0, Math.cos(time / 3700) * 3), about(0, 1, 0, Math.sin(time / 2600) * 9));
    const shown = times(lean, state.q), [nx, ny, nz] = normal(shown), turned = nz < 0;
    // The light: where the pointer is, else where the face's angle puts it.
    const side = turned ? -1 : 1;
    const px = state.lean && !state.drag ? state.lean.x * 100 : clamp(50 - nx * side * 90, 0, 100), py = state.lean && !state.drag ? state.lean.y * 100 : clamp(50 - ny * side * 90, 0, 100);
    const hyp = clamp(Math.hypot(px - 50, py - 50) / 50, 0, 1);
    card.style.setProperty('--px', px.toFixed(1) + '%'); card.style.setProperty('--py', py.toFixed(1) + '%'); card.style.setProperty('--hyp', hyp.toFixed(3));
    const [tx, ty] = view(shown);
    card.style.setProperty('--tx', tx.toFixed(3)); card.style.setProperty('--ty', ty.toFixed(3));
    body.style.transform = css(shown); body.style.setProperty('--unturn', css(inverse(shown)));
    if (shadow) shadow.style.transform = `scale(${(0.55 + 0.45 * Math.abs(nz)).toFixed(3)}, ${(0.7 + 0.3 * Math.abs(nz)).toFixed(3)})`;
    card.classList.toggle('is-turned', turned);
    state.frame = window.requestAnimationFrame(draw);
  }
  const point = e => { const r = card.getBoundingClientRect(); return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) }; };
  card.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    state.drag = { x: e.clientX, y: e.clientY, at: e.timeStamp }; state.spin = [0, 0]; state.lean = null;
    card.setPointerCapture?.(e.pointerId); card.classList.add('is-dragging');
  });
  card.addEventListener('pointermove', e => {
    if (!state.drag) { if (e.pointerType === 'mouse') state.lean = point(e); return; }
    const dx = e.clientX - state.drag.x, dy = e.clientY - state.drag.y, dt = Math.max(1, e.timeStamp - state.drag.at);
    if (!dx && !dy) return;
    Object.assign(state.drag, { x: e.clientX, y: e.clientY, at: e.timeStamp });
    state.q = times(dragTurn(dx, dy), state.q);
    // The turn's speed in degrees a frame, as the axis it turns about, for the follow-through.
    const k = 0.5 * 16 / dt, limit = Math.min(1, 18 / (Math.hypot(dx, dy) * k));
    state.spin = [-dy * k * limit, dx * k * limit];
  });
  // Let go while moving, it turns on a moment; held still first, it just settles.
  const release = e => {
    if (!state.drag) return;
    if (e.timeStamp - state.drag.at > 80) state.spin = [0, 0];
    state.drag = null; card.classList.remove('is-dragging');
    if (still || Math.hypot(...state.spin) <= 0.15) { state.spin = [0, 0]; settle(); }
  };
  card.addEventListener('pointerup', release); card.addEventListener('pointercancel', release);
  // A drag that starts on the portrait or an icon turns the card instead of dragging the picture away.
  card.addEventListener('dragstart', e => e.preventDefault());
  card.addEventListener('pointerleave', () => { state.lean = null; });
  const flip = () => { state.spin = [0, 0]; state.target = times(about(0, 1, 0, 180), rest(state.q)); };
  card.addEventListener('dblclick', flip);
  // The arrow keys turn it 30 degrees that way, where it then rests.
  const keys = { ArrowLeft: [0, 1, -30], ArrowRight: [0, 1, 30], ArrowUp: [1, 0, 30], ArrowDown: [1, 0, -30] };
  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); }
    else if (keys[e.key]) { e.preventDefault(); const [x, y, deg] = keys[e.key]; state.spin = [0, 0]; state.target = times(about(x, y, 0, deg), state.target); }
  });
  state.frame = window.requestAnimationFrame(draw);
  return flip;
}
