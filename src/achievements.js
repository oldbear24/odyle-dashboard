import { t, tn, locale } from './i18n.js';
import { escape as esc, timestamp } from './model.js';
import { icon } from './icons.js';
import { link } from './routes.js';
import { swatch } from './slots.js';

// Achievements (/achievements): milestones each account reaches on its own, from what the reader
// sees of its own characters and what it does in Odyle (backend/odyle/achievements.go keeps the
// catalog, the goals and what each gives). Never ranked or compared: nobody else sees them, only
// the items an account wears next to its name. Signed out the page shows what there is to reach.

const number = n => Number(n).toLocaleString(locale());
// Each achievement's sign, name and how it is reached (goal: the count it needs).
const about = {
  'paired': ['🖥️', () => t('Connected'), () => t('Pair the Windows app with your account.')],
  'first-reading': ['📡', () => t('First reading'), () => t('Let the reader save a character\'s Odyle from the game.')],
  'party-up': ['🤝', () => t('Party up'), () => t('Create a room or join one.')],
  'open-book': ['📖', () => t('Open book'), () => t('Share a character in a room.')],
  'checklist': ['✅', () => t('Checklist'), () => t('Add a task to your daily or weekly checklist.')],
  'in-the-loop': ['🔔', () => t('In the loop'), () => t('Turn on push notifications on a phone or computer.')],
  'show-off': ['🃏', () => t('Show-off'), () => t('Choose a design for the player card of a character your reader reads.')],
  'first-cube': ['🎲', () => t('First cube'), () => t('Spend Odyle on a cube while the reader reads.')],
  'cube-hunter': ['📦', () => t('Cube hunter'), goal => t('Spend {goal} Odyle while the reader reads.', { goal: number(goal) })],
  'cube-master': ['🔷', () => t('Cube master'), goal => t('Spend {goal} Odyle while the reader reads.', { goal: number(goal) })],
  'odyle-legend': ['🌟', () => t('Odyle legend'), goal => t('Spend {goal} Odyle while the reader reads.', { goal: number(goal) })],
  'topped-up': ['🧪', () => t('Topped up'), () => t('Add Odyle with an item while the reader reads.')],
  'no-waste': ['💧', () => t('Not a drop wasted'), (goal, days) => t('Play a whole reset week with the reader on at least {days} days without a natural pool losing a tick at its cap.', { days })],
  'regular': ['📅', () => t('Regular'), goal => tn(goal, 'Play on {n} day with the reader.', 'Play on {n} days with the reader.')],
  'devoted': ['🕯️', () => t('Devoted'), goal => tn(goal, 'Play on {n} day with the reader.', 'Play on {n} days with the reader.')],
  'veteran': ['🏛️', () => t('Veteran'), goal => tn(goal, 'Play on {n} day with the reader.', 'Play on {n} days with the reader.')],
  'on-a-roll': ['🔥', () => t('On a roll'), goal => tn(goal, 'Play with the reader {n} day in a row.', 'Play with the reader {n} days in a row.')],
  'recruiter': ['📣', () => t('Recruiter'), () => t('A friend joins one of your rooms with an invite link you made.')],
  'rallying-cry': ['📯', () => t('Rallying cry'), goal => tn(goal, '{n} player joins your rooms with your invite links.', '{n} players join your rooms with your invite links.')],
  'legion-builder': ['🏰', () => t('Legion builder'), goal => tn(goal, '{n} player joins your rooms with your invite links.', '{n} players join your rooms with your invite links.')],
  'planner': ['🗓️', () => t('Planner'), () => t('Plan a run in a room.')],
  'raid-leader': ['🗺️', () => t('Raid leader'), goal => tn(goal, 'Plan {n} run.', 'Plan {n} runs.')],
  'town-crier': ['📢', () => t('Town crier'), () => t('Post a room\'s runs to Discord.')],
  'lucky-find': ['🗝️', () => t('Lucky find'), () => t('You found what Odyle keeps hidden.')],
  'jackpot': ['🎰', () => t('Jackpot'), () => t('Win a legendary item on the slot machine.')],
};
const groupNames = () => ({ start: t('Getting started'), odyle: t('Odyle'), habit: t('With the reader'), party: t('Party'), secret: t('Secrets') });
// The name of an achievement, for notices; its id while this dashboard does not know it yet.
export const achievementName = id => about[id]?.[1]() || id;

// How far the account is: reached, of all, and the spins and items they gave.
export function standing(data) {
  const unlocked = data?.unlocked || {}, catalog = data?.catalog || [];
  const reached = catalog.filter(a => unlocked[a.id]);
  return { reached: reached.length, total: catalog.length, spins: reached.reduce((n, a) => n + (a.spins || 0), 0), items: reached.filter(a => a.reward).length, rewards: catalog.filter(a => a.reward).length };
}

// What a notice of reached achievements says: "Achievement: First cube · +1 spin".
export function reachedText(notices) {
  const names = notices.map(n => achievementName(n.id)).join(', '), spins = notices.reduce((s, n) => s + (n.spins || 0), 0);
  const items = notices.filter(n => n.reward).length;
  return [tn(notices.length, 'Achievement reached: {names}', 'Achievements reached: {names}', { names }), spins ? tn(spins, '+{n} spin', '+{n} spins') : '', items ? tn(items, '+{n} item for your name', '+{n} items for your name') : ''].filter(Boolean).join(' · ');
}

function card(a, { data, signedIn }) {
  const [sign, name, text] = about[a.id] || ['🏅', () => a.id, () => ''];
  const at = data.unlocked?.[a.id], count = Math.min(data.counts?.[a.counter] || 0, a.goal), hidden = a.secret && !at;
  const fresh = at && data.seen !== undefined && at > (data.seen || '');
  const item = a.reward ? data.items?.find(i => i.id === a.reward) : null, worn = item && data.equipped?.[item.kind] === item.id;
  const wear = item && at && signedIn ? `<button class="text-button" data-wear-item="${worn ? '' : esc(item.id)}" data-kind="${esc(item.kind)}">${worn ? t('Take off') : t('Wear')}</button>` : '';
  const reward = [a.spins ? `<span class="ach-spins">${esc(tn(a.spins, '+{n} spin', '+{n} spins'))}</span>` : '', item && !hidden ? `<span class="ach-item" title="${esc(t('Only this achievement gives it'))}">${swatch(item)}<span>${esc(t(item.name))}</span></span>` : ''].filter(Boolean).join('');
  const progress = !at && !hidden && a.goal > 1 && signedIn ? `<div class="ach-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${a.goal}" aria-valuenow="${count}" aria-label="${esc(name())}"><i style="width:${Math.round(count / a.goal * 100)}%"></i></div><small class="ach-count">${esc(t('{count} of {goal}', { count: number(count), goal: number(a.goal) }))}</small>` : '';
  const state = at ? `<small class="ach-when">${icon('tick')}${esc(t('Reached {date}', { date: new Date(timestamp(at)).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' }) }))}</small>` : '';
  return `<article class="ach-card${at ? ' is-reached' : ''}${hidden ? ' is-secret' : ''}">${fresh ? `<span class="ach-new">${t('New')}</span>` : ''}<span class="ach-sign" aria-hidden="true">${hidden ? '🔒' : sign}</span><div class="ach-body"><h3>${hidden ? t('Secret achievement') : esc(name())}</h3><p>${hidden ? t('Keep exploring Odyle.') : esc(text(a.goal, data.noWasteDays || 5))}</p>${progress}${state}${reward || wear ? `<div class="ach-reward">${reward}${wear}</div>` : ''}</div></article>`;
}

// The page. data: the answer of POST /api/odyle/achievements (signed in) or GET (the catalog),
// or null while it loads.
export function achievementsView({ data, signedIn = false, failed = false }) {
  const heading = `<section class="heading"><div><div class="eyebrow"><span class="tiny-diamond"></span> ${t('YOUR OWN MILESTONES')}</div><h1>${t('Achievements')}<span class="mint">.</span></h1><p>${t('Reached by playing with Odyle. Nobody else sees them, only the items you wear next to your name. No rankings.')}</p></div>${signedIn ? `<a class="button secondary" href="${link('/week')}">${icon('chart')} ${t('Your week in Odyle')}</a>` : ''}</section>`;
  if (!data) return `<main class="dashboard achievements-page">${heading}<p class="intro">${failed ? t('The achievements could not be loaded. Try again in a moment.') : t('Loading…')}</p></main>`;
  const s = standing(data), names = groupNames();
  const summary = signedIn ? `<section class="metric-panel ach-summary"><div class="party-metrics"><div class="metric is-main"><span class="metric-label">${t('Reached')}</span><strong>${number(s.reached)}<span>/ ${number(s.total)}</span></strong><small>${esc(t('{percent} % of all', { percent: s.total ? Math.round(s.reached / s.total * 100) : 0 }))}</small></div><div class="metric"><span class="metric-label">${t('Spins earned')}</span><strong>${number(s.spins)}</strong><small>${data.found ? `<a class="footer-link" href="${link('/slots')}">${t('Spend them on the slot machine')}</a>` : esc(t('They wait in a slot machine hidden somewhere in Odyle.'))}</small></div><div class="metric"><span class="metric-label">${t('Items for your name')}</span><strong>${number(s.items)}<span>/ ${number(s.rewards)}</span></strong><small>${t('Worn next to your name in your rooms')}</small></div><div class="metric"><span class="metric-label">${t('Days with the reader')}</span><strong>${number(data.counts?.days || 0)}</strong><small>${esc(tn(data.counts?.best || 0, 'Best run: {n} day in a row', 'Best run: {n} days in a row'))}</small></div></div><div class="ach-bar" aria-hidden="true"><i style="width:${s.total ? Math.round(s.reached / s.total * 100) : 0}%"></i></div></section>`
    : `<section class="party-section timers-cta"><div class="setup-card"><div class="setup-icon">${icon('trophy')}</div><h2>${esc(tn(s.total, 'Start collecting: {n} achievement to reach', 'Start collecting: {n} achievements to reach'))}</h2><p>${t('Sign in with Discord and pair the Windows reader: the Odyle your characters spend, the days you play and the friends you bring count by themselves. Each achievement brings slot machine spins, some an item for your name that nothing else gives.')}</p><div class="timers-actions"><button class="button discord-button" data-action="discord">${t('Continue with Discord')} ${icon('arrow')}</button><button class="button secondary" data-action="demo">${t('Explore the demo workspace')}</button></div></div></section>`;
  const sections = Object.entries(names).map(([group, title]) => {
    const list = data.catalog.filter(a => a.group === group);
    if (!list.length) return '';
    const done = list.filter(a => data.unlocked?.[a.id]).length;
    return `<section class="party-section"><div class="section-heading"><h2>${esc(title)} <span>${signedIn ? `${done}/${list.length}` : list.length}</span></h2></div><div class="ach-grid">${list.map(a => card(a, { data, signedIn })).join('')}</div></section>`;
  }).join('');
  return `<main class="dashboard achievements-page">${heading}${summary}${sections}</main>`;
}
