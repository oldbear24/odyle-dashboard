// The armory's AI page (armoryai.js, /armory/ai) for the accounts the server's operator lets use it
// (backend/odyle/armoryai.go). Whether the signed-in account may is asked once a session and again
// on the page; the armory's search page and profiles show the way to it then. The conversation is
// kept in this tab only (sessionStorage) and sent with each question; the answer streams in as it
// comes, one JSON object a line, and keeps coming while the reader is on another page.
import { retitle } from '../routes.js';
import { aiPath, aiTitle, profilePath } from '../armorylinks.js';
import { state, storage } from './state.js';
import { pb } from './server.js';
import { app } from './ui.js';
import { onData, onAction, onSubmit } from './actions.js';
import { armoryPart } from './parts.js';
import { shell } from './shell.js';
import { go } from './router.js';
import { failure } from './session.js';

const conversationKey = 'odyle.armory.ai';
// The backend's answer for the account signed in (statusFor), null before it.
let aiStatus = null,
  statusFor = '',
  statusLoading = null;
let conversation = null,
  streaming = false,
  statusLine = null,
  drawing = 0;

const signedIn = () => pb.authStore.isValid && pb.authStore.record?.collectionName === 'users';
const account = () => (signedIn() ? pb.authStore.record?.id || '' : '');

// Whether the account signed in may ask the AI, as far as known (aiAccess asks).
export const aiAllowed = () => Boolean(aiStatus?.allowed && statusFor === account() && account());

// What the backend says of the account: asked once, again with fresh, null when signed out.
export function aiAccess(fresh = false) {
  const id = account();
  if (!id) {
    aiStatus = null;
    statusFor = '';
    return Promise.resolve(null);
  }
  if (!fresh && statusFor === id && aiStatus) return Promise.resolve(aiStatus);
  statusLoading ??= pb
    .send('/api/odyle/armory/ai')
    .then(answer => {
      aiStatus = answer;
      statusFor = id;
      return answer;
    })
    .catch(error => {
      if (statusFor !== id) aiStatus = null;
      throw error;
    })
    .finally(() => {
      statusLoading = null;
    });
  return statusLoading;
}

function session() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
function load() {
  if (!conversation) {
    let raw = null;
    try {
      raw = session()?.getItem(conversationKey);
    } catch {
      /* storage blocked */
    }
    conversation = armoryPart.loaded().readConversation(raw);
  }
  return conversation;
}
function save() {
  try {
    session()?.setItem(conversationKey, JSON.stringify(conversation));
  } catch {
    /* storage full or blocked */
  }
}

const onPage = () => state.shown === aiPath;

function view() {
  const c = load();
  return {
    status: aiStatus,
    signedIn: signedIn(),
    turns: c.turns,
    focus: c.focus,
    streaming,
    statusLine,
    now: Date.now() + state.serverOffset,
  };
}

export function aiRender() {
  const armory = armoryPart.loaded();
  if (!armory || !onPage()) return;
  shell(armory.aiPage(view()), 'armory');
  retitle(aiTitle());
}

// The answer being written, drawn again at most once a frame, the rest of the page as it is.
function drawAnswer() {
  if (drawing) return;
  drawing = requestAnimationFrame(() => {
    drawing = 0;
    const turn = app.querySelector('.ai-log .ai-turn.is-ai:last-child');
    if (!onPage() || !turn) return;
    const nearEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
    const c = load();
    turn.outerHTML = armoryPart.loaded().aiTurn(c.turns.at(-1), true, view());
    if (nearEnd) window.scrollTo({ top: document.documentElement.scrollHeight });
  });
}

export async function aiShow(ticket) {
  aiRender();
  if (!signedIn()) return;
  try {
    await aiAccess(true);
  } catch (error) {
    if (error?.status === 401) return failure(error);
    aiStatus = { error: error?.message || 'Request could not be completed.' };
    statusFor = account();
  }
  if (ticket === state.navigation) aiRender();
}

// The AI about a profile (its page's Ask the AI): a new conversation about it, unless one is open.
export function askAbout(answer) {
  if (!answer?.profile) return go(aiPath);
  const c = load(),
    path = profilePath(answer);
  if (c.focus?.path !== path) {
    conversation = { turns: [], focus: { name: answer.profile.name, path } };
    save();
  }
  return go(aiPath);
}

// What a line of the answer says.
function heard(event, turn) {
  switch (event.type) {
    case 'text':
      turn.text += String(event.text || '');
      statusLine = null;
      break;
    case 'break':
      if (turn.text && !turn.text.endsWith('\n\n')) turn.text += '\n\n';
      break;
    case 'status':
      statusLine = { text: String(event.text || ''), params: event.params || {} };
      break;
    case 'sources':
      turn.sources = Array.isArray(event.sources) ? event.sources : [];
      break;
    case 'done':
      if (aiStatus) aiStatus = { ...aiStatus, remaining: event.remaining, freeAt: event.freeAt || '' };
      break;
    case 'error':
      turn.error = String(event.message || 'Request could not be completed.');
      break;
  }
}

// Asks the conversation's question and follows the answer to its end.
async function ask(question) {
  if (streaming || !question) return;
  const armory = armoryPart.loaded(),
    c = load();
  const body = { messages: armory.conversationOf(c.turns, question) };
  try {
    body.region = JSON.parse(storage.getItem('odyle.armory'))?.region || '';
  } catch {
    /* storage blocked */
  }
  const focus = c.focus?.path.split('/');
  if (focus?.length === 5) body.profile = { region: focus[2], serverId: Number(focus[3]), characterId: focus[4] };
  c.turns.push({ role: 'user', text: question }, { role: 'assistant', text: '', error: '', sources: [] });
  const turn = c.turns.at(-1);
  streaming = true;
  statusLine = { text: 'Thinking…', params: {} };
  save();
  aiRender();
  window.scrollTo({ top: document.documentElement.scrollHeight });
  try {
    const response = await fetch(pb.buildURL('/api/odyle/armory/ai'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: pb.authStore.token },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      let message = 'Request could not be completed.';
      try {
        message = (await response.json()).message || message;
      } catch {
        /* not JSON */
      }
      turn.error = message;
      if (response.status === 403) aiStatus = { ...aiStatus, allowed: false };
    } else {
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let rest = '';
      for (;;) {
        const { value, done } = await reader.read();
        const read = armory.readLines(
          rest + (done ? decoder.decode() + '\n' : decoder.decode(value, { stream: true })),
        );
        rest = read.rest;
        for (const event of read.events) heard(event, turn);
        if (done) break;
        drawAnswer();
      }
      if (!turn.text.trim() && !turn.error) turn.error = 'The AI gave no answer. Try again.';
    }
  } catch {
    if (!turn.error) turn.error = 'The AI service did not answer. Try again in a minute.';
  } finally {
    streaming = false;
    statusLine = null;
    save();
    aiRender();
    app.querySelector('#ai-question')?.focus();
  }
}

// Enter asks, Shift+Enter starts a new line.
document.addEventListener('keydown', e => {
  if (e.target.id !== 'ai-question' || e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
  e.preventDefault();
  e.target.form?.requestSubmit();
});

onData({
  aiExample: el => ask(el.dataset.aiExample),
});
onAction({
  'ai-new': () => {
    if (streaming) return;
    conversation = { turns: [], focus: load().focus };
    save();
    aiRender();
  },
  'ai-unfocus': () => {
    conversation = { turns: [], focus: null };
    save();
    aiRender();
  },
});
onSubmit({
  // The answer streams in by itself: the form is free at once.
  'armory-ai-form': (form, data) => {
    const question = String(data.question || '').trim();
    if (question) ask(question).catch(failure);
  },
});
