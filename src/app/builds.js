// Builds (builds.js, loaded with their first page): the account's builds (/builds), one of them,
// which its player edits by clicking and which saves itself a moment after each change, and a
// shared build (/builds/shared/<code>) for anyone with its link, read-only, which a signed-in
// reader can copy. The class's catalog (what a build can hold, backend/odyle/buildcatalog.go) is
// kept here per class for ten minutes. A build starts from an armory profile with Make a build.
import { t } from '../i18n.js';
import { escape as esc } from '../model.js';
import { retitle, address } from '../routes.js';
import { buildTarget, buildPath, buildsPath, sharedPath, buildTitle } from '../buildlinks.js';
import { state } from './state.js';
import { pb, send } from './server.js';
import { app, toast, modal, closeModal, ask, copyText } from './ui.js';
import { onAction, onData, onSubmit, onChange } from './actions.js';
import { buildsPart } from './parts.js';
import { shell } from './shell.js';
import { go } from './router.js';
import { failure } from './session.js';
import { armoryImages, armoryShown, bookmarks } from './armory.js';

let list = null, // the account's builds (GET /api/odyle/builds)
  current = null, // the build on screen: the backend's, with code for a shared one
  tab = '',
  board = '',
  missing = ''; // a shared link that shares nothing any more
const catalogs = new Map(); // class → { answer } or { error }, with at
const catalogKeep = 10 * 60000;

// A build its player edits: their own, on its own page (not its shared one).
const editable = () => Boolean(current?.id && !current.code && pb.authStore.isValid);

// ---------------------------------------------------------------- Saving

// Each change saves a moment later; one save at a time, the newest plan last.
let saveTimer = 0,
  inFlight = null,
  again = false,
  saving = '';
function noteSaving(value) {
  saving = value;
  const slot = document.querySelector('.build-save-slot'),
    part = buildsPart.loaded();
  if (slot && part) slot.innerHTML = part.saveNote(saving);
}
function scheduleSave() {
  clearTimeout(saveTimer);
  noteSaving('saving');
  saveTimer = setTimeout(() => {
    saveTimer = 0;
    save().catch(failure);
  }, 700);
}
async function save() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  if (!editable()) return;
  if (inFlight) {
    again = true;
    return;
  }
  const build = current;
  inFlight = send('build', { id: build.id, plan: build.plan });
  try {
    const answer = await inFlight;
    if (current === build) Object.assign(current, { updated: answer.build.updated, share: answer.build.share });
    if (!again) noteSaving('saved');
  } catch (error) {
    noteSaving('failed');
    if (error?.status === 404) {
      toast(t('This build no longer exists.'));
      if (current === build) {
        current = null;
        await go(buildsPath, true);
      }
    } else if (error?.status === 401) throw error;
  } finally {
    inFlight = null;
  }
  if (again) {
    again = false;
    await save();
  }
}
// Leaving a build saves what waits at once.
export function leaveBuilds() {
  if (saveTimer) save().catch(failure);
}
window.addEventListener('beforeunload', e => {
  if (saveTimer || inFlight) e.preventDefault();
});
// The plan changed: drawn again, the focus where it was, and saved a moment later.
function change(plan, focus = '') {
  current.plan = plan;
  buildsRender();
  if (focus) document.querySelector(focus)?.focus();
  scheduleSave();
}

// ---------------------------------------------------------------- Loading

const catalogOf = className => {
  const kept = catalogs.get(className);
  return kept ? kept.answer || { error: true } : null;
};
async function loadCatalog(className, ticket) {
  const kept = catalogs.get(className);
  if (kept && Date.now() - kept.at < (kept.answer ? catalogKeep : 30000)) return;
  try {
    catalogs.set(className, {
      at: Date.now(),
      answer: await pb.send(`/api/odyle/armory/catalog/${encodeURIComponent(className)}`),
    });
  } catch {
    catalogs.set(className, { at: Date.now(), answer: kept?.answer || null });
  }
  if (ticket === state.navigation && current?.class === className && !document.querySelector('#modal[open]'))
    buildsRender();
}

// The characters a build can be compared with: the one it was made from and the bookmarks of
// its class (or of no known class).
const keyOf = c => `${c.region}/${c.serverId}/${c.characterId}`;
let compareWith = '',
  compareTimer = 0;
const compared = new Map(); // key → the armory's answer, or { error }
function compareChoices() {
  const from = current?.plan?.from,
    out = [];
  if (from) out.push({ key: keyOf(from), label: t('{name} (made from)', { name: from.name }), ...from });
  for (const b of bookmarks())
    if ((!b.class || b.class === current?.class) && !out.some(c => c.key === keyOf(b)))
      out.push({ key: keyOf(b), label: [b.name, b.server].filter(Boolean).join(' · '), ...b });
  return out;
}
async function loadCompare(ticket) {
  clearTimeout(compareTimer);
  if (tab !== 'compare' || !current) return;
  const choices = compareChoices();
  if (!choices.some(c => c.key === compareWith)) compareWith = choices[0]?.key || '';
  const chosen = choices.find(c => c.key === compareWith);
  if (!chosen) return;
  const kept = compared.get(chosen.key);
  if (kept?.profile && !kept.partial) return;
  let answer;
  try {
    answer = await pb.send(`/api/odyle/armory/${chosen.region}/${chosen.serverId}/${chosen.characterId}`);
  } catch {
    answer = { error: true };
  }
  compared.set(chosen.key, answer);
  if (ticket !== state.navigation || tab !== 'compare' || compareWith !== chosen.key) return;
  buildsRender();
  // A profile the armory is still reading is asked for again when it says to.
  if (!answer.error && (!answer.profile || answer.partial) && ['queued', 'fetching', 'busy'].includes(answer.state))
    compareTimer = setTimeout(
      () => {
        compared.delete(chosen.key);
        if (ticket === state.navigation) loadCompare(ticket).catch(failure);
      },
      Math.max(2, answer.retryAfter || 5) * 1000,
    );
}

// ---------------------------------------------------------------- Pages

export function buildsRender() {
  const part = buildsPart.loaded();
  if (!part) return;
  const now = Date.now() + state.serverOffset,
    path = state.shown || '';
  if (path === buildsPath) {
    shell(part.buildsPage(list, now, armoryImages()), 'builds');
    return retitle(buildTitle(null, path));
  }
  if (missing) {
    shell(
      `<main class="dashboard builds-page"><div class="heading"><div><h1>${t('This build is not shared any more')}<span class="mint">.</span></h1><p>${t('Its player stopped sharing it, or the link is not complete. Ask them for a new link.')}</p></div></div><a class="text-button armory-back" href="./">${t('Odyle')}</a></main>`,
      'builds',
    );
    return retitle(buildTitle(null, path));
  }
  if (!current) return;
  const catalog = catalogOf(current.class);
  shell(
    part.buildPage(current, {
      tab,
      board,
      now,
      images: armoryImages(),
      editable: editable(),
      saving,
      signedIn: pb.authStore.isValid,
      classIcon:
        state.classIcons?.[current.class] ||
        list?.classes?.find(c => c.name === current.class)?.icon ||
        catalog?.icon ||
        '',
      catalog,
      compareChoices: compareChoices(),
      compareWith,
      compare: compareWith ? compared.get(compareWith) || null : null,
    }),
    'builds',
  );
  retitle(buildTitle(current));
}

function loading() {
  shell(
    `<main class="dashboard loading-page" aria-busy="true"><p class="loading-note" role="status"><span class="loading-spinner" aria-hidden="true"></span>${t('Loading your page…')}</p></main>`,
    'builds',
  );
}

async function listShow(ticket) {
  if (!list || !buildsPart.loaded()) loading();
  const [answer] = await Promise.all([pb.send('/api/odyle/builds'), buildsPart()]);
  if (ticket !== state.navigation) return;
  state.online = true;
  list = answer;
  current = null;
  buildsRender();
}

async function buildShow(target, ticket) {
  const same = current && !current.code && current.id === target.id;
  tab = target.tab;
  missing = '';
  if (same) {
    buildsRender();
    return loadCompare(ticket);
  }
  leaveBuilds();
  board = '';
  if (!buildsPart.loaded() || !current) loading();
  let answer;
  try {
    [answer] = await Promise.all([pb.send(`/api/odyle/builds/${target.id}`), buildsPart()]);
  } catch (error) {
    if (ticket !== state.navigation) return;
    if (![403, 404].includes(error?.status)) throw error;
    toast(t(error.message));
    return go(buildsPath, true);
  }
  if (ticket !== state.navigation) return;
  state.online = true;
  current = answer.build;
  saving = '';
  buildsRender();
  await loadCatalog(current.class, ticket);
  return loadCompare(ticket);
}

async function sharedShow(target, ticket) {
  const same = current?.code === target.code;
  tab = target.tab;
  if (same && !missing) {
    buildsRender();
    return loadCompare(ticket);
  }
  leaveBuilds();
  board = '';
  if (!buildsPart.loaded() || !current) loading();
  let answer;
  try {
    [answer] = await Promise.all([pb.send(`/api/odyle/builds/shared/${target.code}`), buildsPart()]);
  } catch (error) {
    if (ticket !== state.navigation) return;
    if (error?.status !== 404) throw error;
    current = null;
    missing = target.code;
    return buildsRender();
  }
  if (ticket !== state.navigation) return;
  state.online = true;
  missing = '';
  current = { ...answer.build, code: target.code };
  buildsRender();
  await loadCatalog(current.class, ticket);
  return loadCompare(ticket);
}

// A page of builds: the account's (signed in), one of them, or a shared one.
export function buildsShow(path, ticket) {
  const target = buildTarget(path);
  if (target.code) return sharedShow(target, ticket);
  if (target.id) return buildShow(target, ticket);
  return listShow(ticket);
}

// ---------------------------------------------------------------- Changes

const plan = () => current.plan;
const catalog = () => {
  const c = catalogOf(current?.class);
  return c && !c.error ? c : null;
};
const slotTitle = slot => buildsPart.loaded()?.slotLabel(slot) || slot;

// The slot editor: the build's entry there, what the player picks since.
let editing = '';
function readSlot(form) {
  const data = new FormData(form);
  return {
    item: data.get('item') || '',
    enchant: data.get('enchant'),
    exceed: data.get('exceed'),
    level: data.get('level'),
    stones: data.getAll('stone'),
    gods: data.getAll('god'),
    sub: data.getAll('sub'),
    skills: data.getAll('skill'),
  };
}
function openSlot(slot) {
  const part = buildsPart.loaded();
  if (!part || !editable()) return;
  if (!catalog()) return toast(t('What the armory knows of the class is still loading. Try again in a moment.'));
  editing = slot;
  const entry = plan().gear.find(g => g.slot === slot) || null;
  modal(
    esc(slotTitle(slot)),
    part.slotEditor(slot, catalog(), part.slotChoice(entry), armoryImages()),
    'wide build-dialog',
  );
  document.querySelector('#build-slot-form input[name="item"]:checked')?.focus();
}

// The item list follows the filter typed above it.
document.addEventListener('input', e => {
  if (e.target.matches?.('[data-build-filter]')) {
    const text = e.target.value.trim().toLowerCase();
    for (const row of e.target.form.querySelectorAll('.build-item'))
      row.hidden = Boolean(text) && !row.dataset.name.includes(text) && !row.querySelector('input:checked');
    return;
  }
  // Notes save as they are typed.
  if (e.target.matches?.('[data-build-notes]') && editable()) {
    current.plan = { ...plan(), notes: e.target.value };
    scheduleSave();
  }
});

// A node of the board opens or closes when pressed (it is no button: its card is inside it).
function toggleAt(node) {
  const grid = node.closest('[data-build-grid]'),
    part = buildsPart.loaded();
  if (!grid || !part || !editable()) return;
  const cell = node.dataset.buildNode;
  change(part.toggleNode(plan(), grid.dataset.buildGrid, cell), `[data-build-node="${cell}"]`);
  const fresh = document.querySelector(`[data-build-node="${cell}"]`);
  if (fresh) {
    for (const n of fresh.parentElement.querySelectorAll(':scope > .armory-node')) n.tabIndex = -1;
    fresh.tabIndex = 0;
    fresh.focus();
  }
}
app.addEventListener('click', e => {
  const node = e.target.closest?.('[data-build-node]');
  if (node) toggleAt(node);
});
app.addEventListener('keydown', e => {
  const node = e.target.closest?.('[data-build-node]');
  if (!node || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  toggleAt(node);
});

onData({
  buildSlot: el => openSlot(el.dataset.buildSlot),
  buildBoard: el => {
    board = el.dataset.buildBoard;
    buildsRender();
    return document.querySelector(`[data-build-board="${CSS.escape(board)}"]`)?.focus();
  },
  buildFill: el => {
    const b = catalog()?.boards.find(x => String(x.id) === el.dataset.buildFill);
    if (b)
      change(buildsPart.loaded().fillBoard(plan(), b, true), `[data-build-fill="${CSS.escape(el.dataset.buildFill)}"]`);
  },
  buildClear: el => {
    const b = catalog()?.boards.find(x => String(x.id) === el.dataset.buildClear);
    if (b)
      change(
        buildsPart.loaded().fillBoard(plan(), b, false),
        `[data-build-fill="${CSS.escape(el.dataset.buildClear)}"]`,
      );
  },
  buildLevel: el => {
    const name = el.dataset.buildLevel,
      was = plan().skills.find(s => s.name === name)?.level || 0;
    change(
      buildsPart.loaded().setSkill(plan(), name, { level: was + Number(el.dataset.step) }),
      `[data-build-level="${CSS.escape(name)}"][data-step="${el.dataset.step}"]`,
    );
  },
  buildBar: el => {
    const name = el.dataset.buildBar,
      bar = Boolean(plan().skills.find(s => s.name === name)?.bar);
    change(buildsPart.loaded().setSkill(plan(), name, { bar: !bar }), `[data-build-bar="${CSS.escape(name)}"]`);
  },
  buildRemove: async el => {
    const id = el.dataset.buildRemove;
    await send('build', { id, remove: true });
    closeModal();
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (current?.id === id) current = null;
    list = null;
    toast(t('Build deleted.'));
    return go(buildsPath, true);
  },
});
onChange({
  // Another item picked: the rest of the editor follows it at the enchantment most who wear it
  // have (the build's own item at its own), the stones and stats picked kept.
  buildItem: el => {
    const part = buildsPart.loaded(),
      form = el.form;
    if (!part || !form || !editing) return;
    const picked = readSlot(form),
      [name, grade = ''] = picked.item.split('|');
    const item = part.catalogItem(catalog(), editing, name, grade),
      entry = plan().gear.find(g => g.slot === editing) || null;
    const levels =
      entry && part.itemKey(entry) === picked.item
        ? { enchant: entry.enchant || 0, exceed: entry.exceed || 0, level: entry.level || 0 }
        : { enchant: item?.enchant || 0, exceed: 0, level: item?.maxLevel || 0 };
    form.querySelector('.build-item-details').innerHTML = part.slotDetails(editing, catalog(), {
      ...picked,
      ...levels,
    });
  },
  buildCompare: el => {
    compareWith = el.value;
    buildsRender();
    return loadCompare(state.navigation);
  },
});
onSubmit({
  'build-new-form': async (form, data) => {
    const answer = await send('build', { name: data.name, class: data.class });
    list = null;
    await go(buildPath(answer.build.id));
    toast(t('Build made. Choose its gear, skills and nodes.'));
  },
  'build-slot-form': form => {
    const part = buildsPart.loaded();
    if (!part || !editing) return;
    const slot = editing,
      entry = part.slotEntry(readSlot(form), catalog(), slot);
    editing = '';
    closeModal();
    change(part.setGear(plan(), slot, entry), `[data-build-slot="${slot}"]`);
  },
  'build-rename-form': async (form, data) => {
    const answer = await send('build', { id: current.id, name: data.name });
    Object.assign(current, { name: answer.build.name, updated: answer.build.updated });
    closeModal();
    buildsRender();
    toast(t('Build renamed.'));
  },
});
onAction({
  builds: async () => {
    closeModal();
    await go(buildsPath);
  },
  'build-rename': () => modal(t('Rename the build'), buildsPart.loaded().renameForm(current.name)),
  'build-share': async () => {
    await save();
    const answer = await send('build', { id: current.id, share: true });
    current.share = answer.build.share;
    buildsRender();
    const copied = await copyText(address(sharedPath(current.share)));
    toast(
      copied
        ? t('Shared. The link is copied: anyone with it can open the build.')
        : t('Shared: anyone with the link can open the build.'),
    );
  },
  'build-unshare': async () => {
    const answer = await send('build', { id: current.id, share: false });
    current.share = answer.build.share;
    buildsRender();
    toast(t('The build is private again. Its link no longer opens it.'));
  },
  'build-copy-link': async () => {
    const code = current?.code || current?.share;
    if (!code) return;
    toast((await copyText(address(sharedPath(code)))) ? t('Link copied.') : address(sharedPath(code)));
  },
  'build-delete': () =>
    ask(
      t('Delete the build?'),
      t('{name} goes for good, and its link stops working.', { name: esc(current.name) }),
      t('Delete'),
      { 'build-remove': current.id },
    ),
  'build-save-copy': async () => {
    const answer = await send('build', { copy: current.code });
    list = null;
    await go(buildPath(answer.build.id));
    toast(t('Saved to your builds. Change it as you like.'));
  },
  'build-sign-in': () =>
    modal(
      t('Sign in to continue'),
      `<p>${t('Sign in to keep a copy of this build and change it.')}</p><button class="button discord-button" data-action="discord">${t('Continue with Discord')}</button>`,
    ),
  // An armory profile's Make a build: its gear, skills and nodes as a new build.
  'build-from-profile': async () => {
    const answer = armoryShown();
    if (!answer?.profile) return;
    const part = await buildsPart(),
      made = part.planFromProfile(answer);
    const result = await send('build', made);
    list = null;
    await go(buildPath(result.build.id));
    toast(t('Build made from {name}. Change what you plan to.', { name: answer.profile.name }));
  },
});
