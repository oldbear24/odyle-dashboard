// Personal daily and weekly checklists (/tasks). A task counts as done while it was checked
// after the current reset (07:00 UTC and Wednesday by default; the server names
// both from odyle_settings), so the lists clear by themselves and nothing is deleted.
// Loads with the page, or with the count of tasks left for the navigation (parts.js).
import { t, tn, locale } from '../i18n.js';
import { age, escape as esc, canonical } from '../model.js';
import { icon } from '../icons.js';
import { link } from '../routes.js';
import { isDone, nextReset, remaining, dayName, resetHour, scopes, inScope, left, templatesForm } from '../tasks.js';
import { state, storage, leaveRoomTopic, clearRoom } from './state.js';
import { pb, send } from './server.js';
import { modal, ask, toast, formError, closeModal, keepingDrafts, updateAges, badge } from './ui.js';
import { onData, onAction, onSubmit, onChange } from './actions.js';
import { shell } from './shell.js';
import { failure } from './session.js';

let tasks = [], renderedTasks = '', taskCharacters = [], taskTemplates = [], taskLimit = 40, tasksKnown = false, editingTask = '';
// The list shown (the account's, or a character's), kept per browser.
const taskScopeKey = 'odyle.taskScope';
function taskScope() { let id = ''; try { id = storage.getItem(taskScopeKey) || ''; } catch { /* storage blocked */ } return taskCharacters.some(c => c.id === id) ? id : ''; }
function taskPanel(cadence, now) {
  const { resets } = state, scope = taskScope(), list = tasks.filter(task => task.cadence === cadence && inScope(task, scope)), done = list.filter(task => isDone(task, now, resets)), at = nextReset(cadence, now, resets), label = cadence === 'daily' ? t('Daily') : t('Weekly');
  const when = new Date(at).toLocaleString(locale(), cadence === 'weekly' ? { weekday: 'long', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' });
  const rows = list.map((task, index) => {
    const checked = isDone(task, now, resets), name = esc(task.title);
    if (task.id === editingTask) return `<form id="task-edit-form" class="task-row task-edit" data-id="${esc(task.id)}"><input name="title" maxlength="60" autocomplete="off" required value="${name}" aria-label="${esc(t('New name of {task}', { task: task.title }))}"><button class="button primary" type="submit">${t('Save')}</button><button class="button secondary" type="button" data-action="cancel-task-edit">${t('Cancel')}</button></form>`;
    const move = (direction, glyph, text, hidden) => `<button class="task-tool" data-move-task="${esc(task.id)}" data-move="${direction}" title="${esc(text)}" aria-label="${esc(text)}" ${hidden ? 'disabled' : ''}>${glyph}</button>`;
    const tools = `<span class="task-tools">${move('up', '↑', t('Move {task} up', { task: task.title }), index === 0)}${move('down', '↓', t('Move {task} down', { task: task.title }), index === list.length - 1)}<button class="task-tool" data-edit-task="${esc(task.id)}" title="${esc(t('Rename {task}', { task: task.title }))}" aria-label="${esc(t('Rename {task}', { task: task.title }))}">✎</button></span>`;
    return `<div class="task-row ${checked ? 'done' : ''}"><label class="task-main"><input type="checkbox" data-task="${esc(task.id)}" ${checked ? 'checked' : ''}><span class="task-box">${icon('tick')}</span><span class="task-text"><strong>${esc(task.title)}</strong><small>${checked ? `${t('Done')} <span data-age="${esc(task.doneAt)}">${age(task.doneAt, now)}</span>` : cadence === 'daily' ? t('Still to do today') : t('Still to do this week')}</small></span></label>${tools}<button class="task-remove" data-remove-task="${esc(task.id)}" data-name="${name}" title="${esc(t('Remove {task}', { task: task.title }))}" aria-label="${esc(t('Remove {task}', { task: task.title }))}">×</button></div>`;
  }).join('');
  const empty = cadence === 'daily' ? t('No daily tasks yet. Add what you run every day; it unchecks itself at the daily reset.') : t('No weekly tasks yet. Add what you clear once a week; it unchecks itself at the weekly reset.');
  return `<section class="party-section task-panel"><div class="section-heading"><h2>${label} <span>${done.length} / ${list.length}</span></h2><span class="refresh-label">${t('Resets in')} <span data-reset="${cadence}">${remaining(at - now)}</span> · ${esc(when)}</span></div><div class="wish-panel"><div class="task-progress"><i style="width:${list.length ? done.length / list.length * 100 : 0}%"></i></div>${rows ? `<div class="task-list">${rows}</div>` : `<p class="wish-empty">${empty}</p>`}<form id="task-form-${cadence}" class="wish-form"><input name="title" maxlength="60" autocomplete="off" placeholder="${esc(cadence === 'daily' ? t('Add a daily task') : t('Add a weekly task'))}" aria-label="${esc(cadence === 'daily' ? t('Daily task') : t('Weekly task'))}" required><button class="button primary" type="submit">${icon('plus')} ${t('Add')}</button></form></div></section>`;
}
function tasksSignature() { const now = Date.now() + state.serverOffset; return canonical([tasks.map(task => [task.id, task.title, task.cadence, task.character || '', isDone(task, now, state.resets)]), state.resets, editingTask, taskCharacters.map(c => [c.id, c.characterName]), taskTemplates, taskScope()]); }
// The lists to switch between, each with what is left in it, the size of the shown one and the Global list.
function taskScopes(now) {
  const scope = taskScope(), size = tasks.filter(task => inScope(task, scope)).length;
  const tabs = taskCharacters.length ? `<div class="task-scopes" role="group" aria-label="${esc(t('Lists'))}">${scopes(taskCharacters).map(s => { const n = left(tasks, now, state.resets, s.id); return `<button class="chip-toggle" data-task-scope="${esc(s.id)}" aria-pressed="${s.id === scope}">${esc(s.name)}${n ? ` <span class="scope-left">${esc(t('{n} left', { n }))}</span>` : ''}</button>`; }).join('')}</div>` : '';
  const global = taskTemplates.length ? `<button class="button secondary small" data-action="task-templates">${icon('plus')} ${t('Add from the Global list')}</button>` : '';
  return `<div class="task-toolbar">${tabs}<span class="task-size">${esc(t('{n} of {limit} tasks in this list', { n: size, limit: taskLimit }))}</span>${global}</div>`;
}
export function tasksView() {
  renderedTasks = tasksSignature(); const now = Date.now() + state.serverOffset, { resets } = state;
  const local = new Date(nextReset('daily', now, resets)).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  keepingDrafts(() => shell(`<main class="dashboard tasks-page"><section class="heading"><div><h1>${t('Daily & weekly')}<span class="mint">.</span></h1><p>${esc(t('Your own checklist, saved to your account. Tasks uncheck themselves at the daily reset, {hour}:00 UTC ({local} your time), and at the weekly reset on {day}.', { hour: String(resetHour(resets)).padStart(2, '0'), local, day: t(dayName(resets)) }))} <a class="footer-link" href="${link('/timers')}">${t('All timers')}</a></p></div><span class="refresh-label"><i></i>${t('Private to you')}</span></section>${taskScopes(now)}<div class="task-grid">${taskPanel('daily', now)}${taskPanel('weekly', now)}</div></main>`, 'tasks'));
}
function updateResets() { const now = Date.now() + state.serverOffset; document.querySelectorAll('[data-reset]').forEach(el => { el.textContent = remaining(nextReset(el.dataset.reset, now, state.resets) - now); }); }
export function renderTasks() { if (tasksSignature() === renderedTasks) { updateAges(); updateResets(); } else tasksView(); }
function applyTasks(data) {
  tasks = data.tasks || []; if (data.resets) state.resets = data.resets;
  if (Array.isArray(data.characters)) taskCharacters = data.characters;
  if (Array.isArray(data.templates)) taskTemplates = data.templates;
  if (data.limit) taskLimit = data.limit;
  tasksKnown = true; renderTaskBadge();
}
// The navigation says how many tasks are left in all lists, once the checklist was fetched.
const taskBadge = () => { const n = tasksKnown && !state.demo ? left(tasks, Date.now() + state.serverOffset, state.resets) : 0; return n ? `<span class="nav-badge" aria-hidden="true">${n}</span><span class="sr-only"> (${esc(t('{n} left', { n }))})</span>` : ''; };
badge('tasks', taskBadge);
function renderTaskBadge() {
  document.querySelectorAll('[data-action="tasks"]').forEach(el => { el.querySelectorAll('.nav-badge, .nav-badge + .sr-only').forEach(x => x.remove()); el.insertAdjacentHTML('beforeend', taskBadge()); });
}
// Fetched once a session, for the badge, without opening the page.
export async function primeTasks() { try { applyTasks(await pb.send('/api/odyle/tasks', { requestKey: 'prime-tasks' })); } catch { /* the badge waits */ } }
export async function refreshTasks() {
  const data = await pb.send('/api/odyle/tasks');
  if (state.shown !== '/tasks') return; // navigated elsewhere while loading
  applyTasks(data); if (data.serverNow) state.serverOffset = Date.parse(data.serverNow) - Date.now(); state.online = true;
}
export async function tasksPage(ticket) {
  await leaveRoomTopic(); clearRoom(); editingTask = '';
  await refreshTasks(); if (ticket !== state.navigation) return; tasksView();
}
// Signing out empties the checklist.
export function forgetTasks() { tasks = []; }
// A task's answer: the account's tasks again, drawn at once.
async function saveTask(body) { applyTasks(await send('task', body)); }

onData({
  taskScope: el => { try { storage.setItem(taskScopeKey, el.dataset.taskScope); } catch { /* storage blocked */ } editingTask = ''; tasksView(); return document.querySelector(`[data-task-scope="${el.dataset.taskScope}"]`)?.focus(); },
}, true);
onData({
  editTask: el => { editingTask = el.dataset.editTask; tasksView(); return document.querySelector('#task-edit-form input')?.select(); },
  moveTask: async el => { el.disabled = true; await saveTask({ id: el.dataset.moveTask, move: el.dataset.move }); tasksView(); return document.querySelector(`[data-move-task="${el.dataset.moveTask}"][data-move="${el.dataset.move}"]:not(:disabled)`)?.focus(); },
  removeTask: el => ask(esc(t('Remove {task}?', { task: el.dataset.name })), t('It leaves your checklist for good. You can add it again at any time.'), t('Remove task'), { 'confirm-remove-task': el.dataset.removeTask }),
  confirmRemoveTask: async el => { await saveTask({ id: el.dataset.confirmRemoveTask, remove: true }); closeModal(); return tasksView(); },
});
onAction({
  'cancel-task-edit': () => { editingTask = ''; tasksView(); },
  'task-templates': () => { const scope = taskScope(), name = scopes(taskCharacters).find(s => s.id === scope)?.name || t('Account'); modal(esc(t('Add to {list}', { list: name })), `<p>${t('Tasks of the game the server keeps for everyone. Each is added once; you can rename or remove it later.')}</p>${templatesForm(taskTemplates, tasks, scope)}`); },
});
// A new task goes to the list shown.
async function addTask(form, data) { const scope = taskScope(); await saveTask({ title: data.title, cadence: form.id.slice(10), ...(scope ? { characterId: scope } : {}) }); form.reset(); tasksView(); }
onSubmit({
  'task-edit-form': async (form, data) => { await saveTask({ id: form.dataset.id, title: data.title }); editingTask = ''; tasksView(); },
  'task-form-daily': addTask,
  'task-form-weekly': addTask,
  'task-templates-form': async form => {
    const titles = [...form.querySelectorAll('input[name="template"]:checked:not(:disabled)')].map(input => input.value), scope = taskScope();
    if (!titles.length) { formError(form, t('Choose tasks from the Global list.')); return; }
    await saveTask({ templates: titles, ...(scope ? { characterId: scope } : {}) }); closeModal(); tasksView();
    toast(tn(titles.length, '{n} task added.', '{n} tasks added.'));
  },
});
// Ticking a task saves the time it was done; it shows as done until the next reset.
onChange({
  task: async el => {
    if (!el.matches('input[data-task]')) return;
    const id = el.dataset.task, done = el.checked; el.disabled = true;
    try { await saveTask({ id, done }); tasksView(); document.querySelector(`input[data-task="${id}"]`)?.focus(); }
    catch (error) { el.checked = !done; el.disabled = false; failure(error); }
  },
});
