// The way into a room's party for a member who has not added a character to it yet (#52): four
// steps from the account's own state, the first one not done with its action, gone once a
// character is added here. A character saved once means the app was paired and read it.
import { t } from './i18n.js';

export function setupSteps({ paired, online, saved, shared }) {
  const steps = [
    { key: 'install', done: paired || saved },
    { key: 'run', done: online || saved },
    { key: 'read', done: saved },
    { key: 'add', done: shared },
  ];
  const current = steps.findIndex(s => !s.done);
  return steps.map((s, i) => ({ ...s, state: s.done ? 'done' : i === current ? 'now' : 'later' }));
}

// actions: HTML for the steps that have one ({ install, add }), placed under the current step.
export function setupTracker(state, actions = {}) {
  const steps = setupSteps(state);
  if (steps.every(s => s.done)) return '';
  const text = {
    install: [t('Install Odyle for Windows and pair it'), t('Windows may warn about an unknown app: choose More info → Run anyway. The reader also needs Npcap from npcap.com, installed with its default options.')],
    run: [t('Keep Odyle running while you play'), t('It starts reading by itself on the PC you paired.')],
    read: [t('Log in to the character once'), t('Enter the game with the character you want here; the reader saves it with its Odyle.')],
    add: [t('Add it to this room'), t('Your characters start private; choose which ones this room sees.')],
  };
  const at = steps.findIndex(s => s.state === 'now');
  const items = steps.map((s, i) => {
    const [title, detail] = text[s.key];
    const action = s.state === 'now' && actions[s.key] ? `<div class="setup-action">${actions[s.key]}</div>` : '';
    return `<li class="setup-step ${s.state}"><span class="setup-mark" aria-hidden="true">${s.done ? '✓' : i + 1}</span><div><strong>${title}</strong>${s.state === 'now' ? `<small>${detail}</small>` : ''}${action}</div><span class="sr-only">${s.done ? t('done') : s.state === 'now' ? t('next step') : t('later')}</span></li>`;
  }).join('');
  return `<section class="setup-tracker" aria-label="${t('Get your character into this room')}"><div class="setup-head"><strong>${t('Get your character into this room')}</strong><span>${t('Step {k} of {n}', { k: at + 1, n: steps.length })}</span></div><ol>${items}</ol></section>`;
}
