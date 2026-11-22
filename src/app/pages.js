// The pages that bring players back, whose views load with them (parts/): What's new, the
// privacy notice, the timers, achievements, your week and the slot machine.
import { t } from '../i18n.js';
import { escape as esc, timestamp } from '../model.js';
import { link, address } from '../routes.js';
import { windowsApp } from '../release.js';
import { state, storage, leaveRoomTopic, clearRoom } from './state.js';
import { pb, send } from './server.js';
import { toast, saveBlob, copyText, badge } from './ui.js';
import { onData, onAction } from './actions.js';
import { whatsnewPart, privacyPart, timersPart, achievementsPart, weekPart, slotsPart } from './parts.js';
import { shell, loadWindowsRelease, renderConnection } from './shell.js';
import { appVersion, seenVersion } from './notes.js';
import { go } from './router.js';
import { later } from './session.js';

// The privacy notice (#/privacy, privacy.js), open to anyone; its text loads with it.
export const privacyRender = () => {
  const notice = privacyPart.loaded();
  if (notice) shell(notice.privacyNotice(), 'privacy');
};
export async function privacyShow(ticket) {
  await privacyPart();
  if (ticket === state.navigation) privacyRender();
}
// What's new (#/changelog): the changelog, which loads with the page, and the newest Windows
// release's changes.
export function changelogRender() {
  const news = whatsnewPart.loaded();
  if (!news) return;
  const release = windowsApp(state.windowsRelease);
  shell(
    news.whatsNew(
      news.changelog,
      appVersion,
      release.version ? { ...release, changes: state.windowsRelease?.latest?.changes || [] } : null,
    ),
    'changelog',
  );
}
export async function changelogPage(ticket) {
  await whatsnewPart();
  if (ticket !== state.navigation) return;
  seenVersion();
  changelogRender();
  await loadWindowsRelease();
  if (ticket === state.navigation) changelogRender();
}

// The timers (/timers, timers.js): the game's resets, the Odyle clock and the dungeon catalog,
// open to anyone. While the page is shown its countdowns tick every second, it is drawn again
// once one of them passes and the rules are fetched again every ten minutes.
let timersGame = null,
  timersAt = 0,
  timersFailed = false,
  timersTimer = 0,
  timersDrawn = '';
const timersNow = () => Date.now() + state.serverOffset;
export function timersRender() {
  const timers = timersPart.loaded();
  if (!timers) return;
  const now = timersNow();
  timersDrawn = JSON.stringify(timers.timerTargets(timersGame, now));
  shell(
    timers.timersView({ game: timersGame, now, signedIn: pb.authStore.isValid && !state.demo, failed: timersFailed }),
    'timers',
  );
}
export async function loadTimers() {
  timersAt = Date.now();
  try {
    const game = await pb.send('/api/odyle/game', { requestKey: 'timers' });
    timersGame = game;
    timersFailed = false;
    if (game.serverNow) state.serverOffset = Date.parse(game.serverNow) - Date.now();
    if (!state.online) {
      state.online = true;
      renderConnection();
    }
  } catch (error) {
    timersFailed = !timersGame;
    throw error;
  }
}
export async function timersPage(ticket) {
  // The page (timers.js) loads with its first visit.
  await timersPart();
  if (ticket !== state.navigation) return;
  timersRender();
  clearInterval(timersTimer);
  timersTimer = setInterval(timersTick, 1000);
  try {
    await loadTimers();
  } finally {
    if (ticket === state.navigation) timersRender();
  }
}
function timersTick() {
  if (state.shown !== '/timers') {
    clearInterval(timersTimer);
    timersTimer = 0;
    return;
  }
  const timers = timersPart.loaded();
  if (document.hidden) return;
  const stale = Date.now() - timersAt > (timersGame ? 600000 : 15000);
  if (stale)
    loadTimers()
      .then(() => {
        if (state.shown === '/timers') timersRender();
      })
      .catch(() => {
        if (state.shown === '/timers' && !timersGame) timersRender();
      });
  if (!timersGame || !timers) return;
  const now = timersNow();
  if (JSON.stringify(timers.timerTargets(timersGame, now)) !== timersDrawn) return timersRender();
  document.querySelectorAll('[data-timer]').forEach(el => {
    el.textContent = timers.timerText(Number(el.dataset.timer) - now);
  });
}

// Achievements (/achievements, achievements.js): signed in the account's own, brought up to date
// and marked seen; signed out what there is to reach. The navigation counts those reached since
// the last look (from the rooms list and the account's news).
let achievementsData = null,
  achievementsFailed = false,
  achievementsNew = 0;
const achievementBadge = () =>
  achievementsNew > 0 && pb.authStore.isValid && !state.demo
    ? `<span class="nav-badge" aria-hidden="true">${achievementsNew}</span><span class="sr-only"> (${esc(t('{n} new', { n: achievementsNew }))})</span>`
    : '';
badge('achievements', achievementBadge);
function renderAchievementBadge() {
  document.querySelectorAll('a[data-action="achievements"]').forEach(el => {
    el.querySelector('.nav-badge')?.remove();
    el.querySelector('.sr-only')?.remove();
    el.insertAdjacentHTML('beforeend', achievementBadge());
  });
}
export function noteAchievements(list) {
  if (list?.achievements && state.shown !== '/achievements') {
    achievementsNew = list.achievements.new || 0;
    renderAchievementBadge();
  }
}
export function achievementsRender() {
  const page = achievementsPart.loaded();
  if (page)
    shell(
      page.achievementsView({
        data: achievementsData,
        signedIn: pb.authStore.isValid && !state.demo,
        failed: achievementsFailed,
      }),
      'achievements',
    );
}
export async function loadAchievements() {
  const signedIn = pb.authStore.isValid && !state.demo;
  try {
    achievementsData = signedIn
      ? await send('achievements')
      : await pb.send('/api/odyle/achievements', { requestKey: 'achievements' });
    achievementsFailed = false;
    if (signedIn) {
      achievementsNew = 0;
      renderAchievementBadge();
    }
  } catch (error) {
    achievementsFailed = !achievementsData;
    throw error;
  }
}
export async function achievementsPage(ticket) {
  if (achievementsData && Boolean(achievementsData.counts) !== (pb.authStore.isValid && !state.demo))
    achievementsData = null;
  // The page (achievements.js) loads with its first visit, or with the first achievement reached.
  await achievementsPart();
  if (ticket !== state.navigation) return;
  achievementsRender();
  try {
    await loadAchievements();
  } finally {
    if (ticket === state.navigation) achievementsRender();
  }
}
// Achievements reached meanwhile: a message of their own (beside the page's, which it never
// hides), the count in the navigation and, on the page, the page again.
let achievementTimer = 0;
function achievementNotice(text) {
  let el = document.querySelector('#achievement-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'achievement-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.addEventListener('click', () => el.classList.remove('show'));
    document.body.append(el);
  }
  el.innerHTML = `<span class="achievement-toast-sign" aria-hidden="true">🏆</span><p>${esc(text)}</p><a href="${link('/achievements')}">${t('See')}</a>`;
  el.classList.add('show');
  clearTimeout(achievementTimer);
  achievementTimer = setTimeout(() => el.classList.remove('show'), 8000);
}
export async function reachedAchievements(notices) {
  achievementNotice((await achievementsPart()).reachedText(notices));
  if (state.shown === '/achievements') {
    if (!later()) {
      await loadAchievements();
      achievementsRender();
    }
    return;
  }
  achievementsNew += notices.length;
  renderAchievementBadge();
}

// Your week in Odyle (/week, week.js): the account's reset week, this one or one before (weekBack;
// the server picks the week before while this one is under two days old). Its picture and text
// to share are made here and go nowhere unless the player posts them.
let weekData = null,
  weekFailed = false,
  weekBack = null;
const canShareFiles = () => {
  try {
    return (
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [new File([''], 'week.png', { type: 'image/png' })] })
    );
  } catch {
    return false;
  }
};
export function weekRender() {
  const week = weekPart.loaded();
  if (week)
    shell(
      week.weekView({
        data: weekData,
        now: Date.now() + state.serverOffset,
        failed: weekFailed,
        canShare: canShareFiles(),
      }),
      'week',
    );
}
export async function loadWeek() {
  try {
    weekData = await pb.send('/api/odyle/week', {
      requestKey: 'week',
      query: weekBack === null ? {} : { week: weekBack },
    });
    weekBack = weekData.week.back;
    weekFailed = false;
    if (weekData.serverNow) state.serverOffset = Date.parse(weekData.serverNow) - Date.now();
    if (weekData.week.back >= 1) seenWeek(weekData.week.from);
  } catch (error) {
    weekFailed = !weekData;
    throw error;
  }
}
export async function weekPage(ticket) {
  await leaveRoomTopic();
  clearRoom();
  if (weekData && weekData.week.back !== weekBack) weekData = null;
  // The page (week.js) loads with its first visit.
  await weekPart();
  if (ticket !== state.navigation) return;
  weekRender();
  try {
    await loadWeek();
  } finally {
    if (ticket === state.navigation) weekRender();
  }
}
// After the weekly reset, Rooms & characters says the week before is summed up, until it is
// opened or put away (odyle.weekSeen: the start of the last week seen, as a date; library.js).
export const weekSeenKey = 'odyle.weekSeen';
function seenWeek(from) {
  try {
    storage.setItem(weekSeenKey, new Date(timestamp(from)).toISOString().slice(0, 10));
  } catch {
    /* storage blocked */
  }
}
async function weekPicture() {
  const { weekSummary, weekImage } = weekPart.loaded(),
    summary = weekSummary(weekData, Date.now() + state.serverOffset),
    blob = await weekImage(summary, address('/'));
  if (!blob) throw new Error('This browser could not draw the picture.');
  return { summary, blob };
}

// The slot machine (#107, slots.js): the logo clicked seven times within three seconds opens it.
let slotState = null,
  slotSpinning = false,
  slotLast = null,
  logoClicks = [];
// The machine's sounds, on unless this browser turned them off (sounds.js).
const slotSoundKey = 'odyle.slotSound',
  slotSound = () => {
    try {
      return storage.getItem(slotSoundKey) !== 'off';
    } catch {
      return true;
    }
  };
export function slotsRender() {
  const machine = slotsPart.loaded();
  if (machine)
    shell(
      machine.slotsView({
        state: slotState,
        spinning: slotSpinning,
        last: slotLast,
        name: pb.authStore.record?.displayName || '',
        sound: slotSound(),
      }),
      'slots',
    );
}
export async function slotsPage(ticket) {
  slotLast = null;
  await slotsPart();
  if (ticket !== state.navigation) return;
  slotsRender();
  const answer = await send('slots');
  if (ticket !== state.navigation) return;
  slotState = answer;
  slotsRender();
}
async function spinSlot() {
  const machine = slotsPart.loaded();
  if (!machine || slotSpinning || !slotState || slotState.spins < 1) return;
  slotSpinning = true;
  slotLast = null;
  slotsRender();
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches,
    sound = slotSound();
  if (sound && !still) machine.playSpin(1400);
  try {
    const [result] = await Promise.all([send('slot-spin'), new Promise(done => setTimeout(done, still ? 0 : 1400))]);
    slotState = result;
    slotLast = {
      won: result.won,
      duplicate: result.duplicate,
      lost: Boolean(result.lost),
      seed: Math.floor(Math.random() * 64),
    };
    if (sound) {
      if (result.lost) machine.playLose();
      else machine.playWin(result.won?.rarity);
    }
  } finally {
    slotSpinning = false;
    if (state.shown === '/slots') slotsRender();
  }
}
document.addEventListener('click', e => {
  if (!e.target.closest?.('a.brand') || !pb.authStore.isValid || state.demo) return;
  const now = Date.now();
  logoClicks = [...logoClicks.filter(at => now - at < 3000), now];
  if (logoClicks.length >= 7) {
    logoClicks = [];
    e.preventDefault();
    go('/slots');
  }
});

// The account's achievements and week stay with it, not with the next one signing in here.
export function forgetPages() {
  achievementsData = null;
  achievementsNew = 0;
  weekData = null;
  weekBack = null;
}

onData(
  {
    slotEquip: async el => {
      if (!el.dataset.kind) return;
      slotState = await send('slot-equip', { kind: el.dataset.kind, id: el.dataset.slotEquip });
      slotsRender();
    },
    weekBack: async el => {
      if (!weekData) return;
      weekBack = Math.max(0, Number(el.dataset.weekBack));
      el.disabled = true;
      await loadWeek();
      weekRender();
    },
    wearItem: async el => {
      if (!el.dataset.kind || !achievementsData) return;
      const worn = await send('slot-equip', { kind: el.dataset.kind, id: el.dataset.wearItem });
      achievementsData = { ...achievementsData, owned: worn.owned, equipped: worn.equipped };
      achievementsRender();
      toast(el.dataset.wearItem ? t('Worn next to your name in your rooms.') : t('Taken off.'));
    },
  },
  true,
);
onAction({
  'slot-spin': () => spinSlot(),
  'slot-sound': () => {
    try {
      storage.setItem(slotSoundKey, slotSound() ? 'off' : 'on');
    } catch {
      /* storage blocked: stays on */
    }
    slotsRender();
  },
  'week-ready': async () => {
    weekBack = 1;
    await go('/week');
  },
  'week-later': el => {
    try {
      storage.setItem(weekSeenKey, el.dataset.week);
    } catch {
      /* storage blocked */
    }
    document.querySelector('.week-ready')?.remove();
  },
  'week-image': async () => {
    const { summary, blob } = await weekPicture();
    saveBlob(blob, weekPart.loaded().weekImageName(summary));
    toast(t('The picture of your week is in your downloads.'));
  },
  'week-copy': async () => {
    const { weekText, weekSummary } = weekPart.loaded();
    toast(
      (await copyText(weekText(weekSummary(weekData, Date.now() + state.serverOffset), address('/'))))
        ? t('Copied. Paste it in Discord.')
        : t('Copying is blocked here. Select the text and copy it yourself.'),
    );
  },
  'week-share': async () => {
    const { summary, blob } = await weekPicture();
    const { weekImageName, weekText } = weekPart.loaded();
    try {
      await navigator.share({
        files: [new File([blob], weekImageName(summary), { type: 'image/png' })],
        text: weekText(summary, address('/')),
      });
    } catch (error) {
      if (error?.name !== 'AbortError') throw error;
    }
  },
});
