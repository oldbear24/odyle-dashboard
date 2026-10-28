// Player cards: an armory profile as a trading card on a page of its own
// (/armory/<region>/<server id>/<character id>/card), turning in 3D under the pointer, by drag
// and by keyboard. Everything on it comes from PLAYNC like the rest of the armory; only its
// look is chosen, by the player whose Odyle app read the character (backend/odyle/cards.go):
// one of three designs after AION's realms, and for players with the membership a holo
// finish. The page lets that player try the looks on the card before saving one.
import { t } from './i18n.js';
import { escape as esc } from './model.js';
import { icon } from './icons.js';
import { link, address } from './routes.js';
import { profilePath, imageUrl, classBadge, gradeClass } from './armory.js';

export const cardDesigns = () => [['elysea', t('Elysea'), t('Pearl and gold leaf under an Elyos sky')], ['asmodae', t('Asmodae'), t('Twilight violet with ember trim')], ['abyss', t('Abyss'), t('Obsidian split by aether light')]];
export const cardFinishes = () => [['', t('Plain'), t('A clean print')], ['prism', t('Prism holo'), t('Rainbow foil that shifts with the light')], ['starfall', t('Starfall holo'), t('Glitter scattered over the foil')], ['etched', t('Etched foil'), t('Engraved metal lines')]];
export const cardPath = answer => profilePath(answer) + '/card';
// The page's title in the tab, as the backend names it (backend/odyle/pages.go).
export const cardTitle = answer => answer?.profile ? t("{name}'s player card · {server} · Odyle Armory", { name: answer.profile.name, server: answer.profile.server || answer.server }) : t('A character on {server} · Odyle Armory', { server: answer?.server || '' });
// The design a card shows: its owner's, or by the character's race until one is chosen.
export function designOf(answer, chosen = '') {
  const known = cardDesigns().map(([key]) => key), pick = chosen || answer.card?.design;
  if (known.includes(pick)) return pick;
  return /asmodian/i.test(answer.profile?.race || '') ? 'asmodae' : 'elysea';
}
export const finishOf = (answer, chosen) => cardFinishes().some(([key]) => key === (chosen ?? answer.card?.finish)) ? (chosen ?? answer.card?.finish ?? '') : '';

const number = value => Number(value || 0).toLocaleString('en-US');
const grades = ['common', 'rare', 'legend', 'unique', 'epic', 'mythic'];
// The best grade among the equipped gear, shown as the card's set mark.
export function bestGrade(gear = []) {
  return gear.reduce((best, g) => Math.max(best, grades.indexOf(String(g.grade).toLowerCase())), 0);
}
// The two strongest skills on the skill bar, as the card's moves.
export function signatureSkills(skills = []) {
  const active = skills.filter(s => s.acquired && s.category === 'Active');
  return [...(active.some(s => s.equipped) ? active.filter(s => s.equipped) : active)].sort((a, b) => b.level - a.level).slice(0, 2);
}

// The front of the card.
function front(answer, images) {
  const p = answer.profile, primary = (p.stats || []).filter(s => s.primary).slice(0, 6);
  const portrait = imageUrl(images, p.portrait), race = /asmodian/i.test(p.race) ? t('Asmodians') : /elyos/i.test(p.race) ? t('Elyos') : p.race || '';
  const boards = (p.boards || []).reduce((n, b) => ({ open: n.open + b.open, total: n.total + b.total }), { open: 0, total: 0 });
  const grade = grades[bestGrade(p.gear)];
  const moves = signatureSkills(p.skills).map(s => `<li><span class="tcg-move-icon">${imageUrl(images, s.icon) ? `<img src="${esc(imageUrl(images, s.icon))}" alt="" decoding="async">` : ''}</span><span class="tcg-move-name">${esc(s.name)}</span><b>${esc(t('Lv {level}', { level: s.level }))}</b></li>`).join('');
  return `<div class="tcg-face tcg-front">
<div class="tcg-frame"></div>
<header class="tcg-name"><h2>${esc(p.name)}</h2><span class="tcg-level">${esc(t('Lv {level}', { level: p.level }))}${classBadge(images, answer.classIcon, p.class)}</span></header>
<div class="tcg-art"><span class="tcg-initials" aria-hidden="true">${esc([...String(p.name || '?')].slice(0, 2).join('').toUpperCase())}</span>${portrait ? `<img class="tcg-portrait" src="${esc(portrait)}" alt="" decoding="async">` : ''}</div>
<p class="tcg-type"><span>${esc(p.class || '')}</span><span>${esc(race)}</span></p>
${p.title ? `<p class="tcg-title ${gradeClass(p.titleGrade)}">${esc(p.title)}</p>` : ''}
<div class="tcg-panel">
<div class="tcg-power"><span>${t('Combat power')}</span><strong>${esc(number(p.combatPower))}</strong></div>
<div class="tcg-power is-minor"><span>${t('Item level')}</span><strong>${esc(number(p.itemLevel))}</strong></div>
${moves ? `<ul class="tcg-moves">${moves}</ul>` : ''}
${primary.length ? `<dl class="tcg-stats">${primary.map(s => `<div><dt>${esc(s.name)}</dt><dd>${esc(number(s.value))}</dd></div>`).join('')}</dl>` : ''}
</div>
<footer class="tcg-foot"><span>${boards.total ? esc(t('Daevanion {open}/{total}', { open: boards.open, total: boards.total })) : ''}${p.titles?.total ? `<br>${esc(t('Titles {owned}/{total}', { owned: p.titles.owned, total: p.titles.total }))}` : ''}</span><span class="tcg-mark"><i class="tcg-gem grade-${grade}" title="${esc(t('Best gear grade: {grade}', { grade: t(grade[0].toUpperCase() + grade.slice(1)) }))}"></i><span>odyle<em>.</em></span> ${esc(String(answer.region).toUpperCase())} ${esc(answer.serverId)}</span></footer>
<div class="tcg-shine"></div><div class="tcg-glare"></div>
</div>`;
}

// The card's thickness: thin layers between its faces, which show as its edge when it turns.
const edge = (layers = 12) => `<div class="tcg-edge" aria-hidden="true">${Array.from({ length: layers - 1 }, (_, i) => `<i style="--z:${((i + 1) / layers).toFixed(3)}"></i>`).join('')}</div>`;

// The back: the same for every card of a design.
const back = () => `<div class="tcg-face tcg-back" aria-hidden="true"><div class="tcg-frame"></div><div class="tcg-emblem"><span class="tcg-rings"></span>${icon('diamond')}<strong>odyle<em>.</em></strong><small>${t('AION 2 armory')}</small></div><div class="tcg-glare"></div></div>`;

// The look picker for the card's owner: designs, finishes (holo for members) and Save.
function studio(answer, design, finish) {
  const card = answer.card || {};
  if (!card.mine) return `<p class="card-owner-note">${icon('info')}<span>${esc(t('The player whose Odyle app reads {name} chooses this card\'s design.', { name: answer.profile.name }))}</span></p>`;
  const option = (name, [key, label, hint], chosen, locked = false) => `<label class="card-choice is-${esc(key || 'plain')}${locked ? ' is-locked' : ''}"><input type="radio" name="${name}" value="${esc(key)}" ${key === chosen ? 'checked' : ''} ${locked ? 'disabled' : ''}><span class="card-swatch" aria-hidden="true"></span><span class="card-choice-text"><strong>${esc(label)}</strong><small>${esc(hint)}</small></span></label>`;
  const changed = design !== designOf(answer) || finish !== finishOf(answer);
  return `<form id="card-form" class="card-studio"><fieldset><legend>${t('Design')}</legend>${cardDesigns().map(d => option('design', d, design)).join('')}</fieldset>
<fieldset><legend>${t('Finish')}</legend>${cardFinishes().map(f => option('finish', f, finish, f[0] !== '' && !card.holo)).join('')}${card.holo ? '' : `<p class="card-locked">${icon('star')}<span>${t('Holo finishes are for players with the membership (Account & data).')}</span></p>`}</fieldset>
<button class="button primary" type="submit" ${changed ? '' : 'disabled'}>${t('Save card')}</button></form>`;
}

// The page: the card on its stage, what to do with it, and the owner's look picker. design
// and finish are what the page shows (the owner may be trying looks before saving).
export function cardPage(answer, view = {}) {
  const images = view.images || '', p = answer.profile;
  const head = `<header class="card-bar"><a href="${link('/')}" class="brand" aria-label="${esc(t('Odyle home'))}"><span class="brand-symbol">${icon('diamond')}</span><span class="brand-name">odyle<span class="brand-dot">.</span></span></a><a class="text-button card-back" href="${esc(link(profilePath(answer)))}">${icon('arrow')} ${p ? esc(t('{name}\'s profile', { name: p.name })) : t('Back to the profile')}</a></header>`;
  if (!p) return `<main class="card-page">${head}<section class="card-wait">${view.status || ''}<p>${t('The card is drawn once Odyle has fetched this character from PLAYNC.')}</p></section><div id="toast" role="status" aria-live="polite"></div></main>`;
  const design = designOf(answer, view.design), finish = finishOf(answer, view.finish);
  const label = t('Player card of {name}: level {level} {class} on {server}, {power} combat power.', { name: p.name, level: p.level, class: p.class, server: p.server || answer.server, power: number(p.combatPower) });
  return `<main class="card-page design-${design}">${head}<h1 class="sr-only">${esc(cardTitle(answer))}</h1>
<div class="card-layout${answer.card?.mine ? ' has-studio' : ''}"><section class="card-stage" aria-label="${esc(t('Player card'))}">
<div class="tcg-scene"><article class="tcg design-${design}${finish ? ' finish-' + finish : ''}" tabindex="0" aria-roledescription="${esc(t('player card'))}" aria-label="${esc(label)}"><div class="tcg-body">${front(answer, images)}${edge()}${back()}</div></article><div class="tcg-shadow" aria-hidden="true"></div></div>
<p class="card-hint">${t('Drag the card in any direction to turn it. Double-click or press Enter to flip it.')}</p>
<div class="card-actions"><button class="button secondary" data-action="card-flip">${t('Flip card')}</button><button class="button secondary" data-copy="${esc(address(cardPath(answer)))}" data-copied="${esc(t('Link copied.'))}">${icon('link')} ${t('Copy link')}</button></div>
${answer.card?.mine ? '' : studio(answer, design, finish)}</section>${answer.card?.mine ? studio(answer, design, finish) : ''}</div>
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
// the nearer face, upright. The light on its foil and glare follows the face's angle.
// Returns flip(); it stops by itself once the card leaves the page, and waits while the tab
// is hidden (no animation frames). With reduced motion it neither sways nor turns on.
export function animateCard(card, window = globalThis) {
  const body = card.querySelector('.tcg-body'), shadow = card.parentElement?.querySelector('.tcg-shadow');
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const { about, times, toward, normal, rest, css } = orientation;
  const state = { q: [0, 0, 0, 1], target: [0, 0, 0, 1], spin: [0, 0], drag: null, lean: null, frame: 0 };
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
    body.style.transform = css(shown);
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
