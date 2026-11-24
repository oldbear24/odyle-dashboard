// The armory's AI (/armory/ai, backend/odyle/armoryai.go): signed-in players the server's operator
// lets use it ask about AION 2 Global characters in their own words, and Claude answers with the
// armory's data. Pure functions returning HTML: the page, the AI's Markdown and the conversation
// sent with a question. app/armoryai.js asks the backend and keeps the conversation in the tab
// (sessionStorage), never anywhere else.
import { t } from './i18n.js';
import { escape as esc, number, changedAt } from './model.js';
import { icon } from './icons.js';
import { link } from './routes.js';
import { armoryRoute } from './armorylinks.js';

// ---------------------------------------------------------------- Markdown

// Bold and italic in text already escaped.
const emphasis = html =>
  html
    .replace(/\*\*(?=\S)(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?=\S)([^*]+?)\*(?![*\w])/g, '$1<em>$2</em>');

// A link the AI wrote: to the armory's own pages (only paths its routes take) or to a web page
// (http or https, opened in a new tab); anything else stays text.
function anchor(label, url) {
  const text = emphasis(esc(label));
  if (url.startsWith('/')) {
    const path = url.split(/[?#]/)[0];
    return armoryRoute.test(path) ? `<a href="${esc(link(path))}">${text}</a>` : text;
  }
  return /^https?:\/\/[^\s<>"]+$/i.test(url)
    ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${text}</a>`
    : text;
}

// A line's inline Markdown: `code`, [links](url), **bold** and *italic*; everything else escaped.
// Code and links are set aside first (as private-use marks escaping leaves alone), so bold and
// italic may hold a link.
export function inline(raw) {
  const kept = [];
  const marked = String(raw)
    .replace(/[\uE000\uE001]/g, '')
    .replace(/`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, code, label, url) => {
      kept.push(code !== undefined ? `<code>${esc(code)}</code>` : anchor(label, url));
      return `\uE000${kept.length - 1}\uE001`;
    });
  return emphasis(esc(marked)).replace(/\uE000(\d+)\uE001/g, (m, i) => kept[i]);
}

const tableRow = line =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim());
const tableRule = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

// The AI's Markdown as HTML: paragraphs, headings, bullet and numbered lists, tables, quotes, code
// blocks and the inline marks. No HTML it wrote reaches the page: all of it is escaped first.
export function markdown(text) {
  const lines = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const out = [];
  let paragraph = [],
    list = null;
  const flush = () => {
    if (paragraph.length) out.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
    paragraph = [];
    if (list) out.push(`<${list.kind}>${list.items.map(item => `<li>${inline(item)}</li>`).join('')}</${list.kind}>`);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flush();
      const code = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    if (/^\s*\|/.test(line) && tableRule.test(lines[i + 1] || '')) {
      flush();
      const head = tableRow(line),
        rows = [];
      for (i += 2; i < lines.length && /^\s*\|/.test(lines[i]); i++) rows.push(tableRow(lines[i]));
      i--;
      out.push(
        `<div class="ai-table"><table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`,
      );
      continue;
    }
    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (heading) {
      flush();
      out.push(
        `<${heading[1].length <= 2 ? 'h3' : 'h4'}>${inline(heading[2])}</${heading[1].length <= 2 ? 'h3' : 'h4'}>`,
      );
      continue;
    }
    const bullet = line.match(/^\s*[-*•+]\s+(.*)$/),
      numbered = line.match(/^\s*\d{1,3}[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol';
      if (paragraph.length || (list && list.kind !== kind)) flush();
      list ??= { kind, items: [] };
      list.items.push((bullet || numbered)[1]);
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flush();
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flush();
      out.push('<hr>');
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (list) flush();
    paragraph.push(line.trim());
  }
  flush();
  return out.join('');
}

// ---------------------------------------------------------------- Conversation

// The longest conversation the backend takes: 20 messages, answers of up to 12,000 characters.
export const aiTurns = 20,
  aiQuestionLength = 2000,
  aiAnswerLength = 12000;

// What is sent with a question: the conversation's questions and their answers, the latest ones
// (a question whose answer failed is left out with it), then the question itself.
export function conversationOf(turns, question) {
  const pairs = [];
  for (let i = 0; i < turns.length - 1; i++) {
    const asked = turns[i],
      answered = turns[i + 1];
    if (asked.role === 'user' && answered.role === 'assistant' && !answered.error && answered.text.trim()) {
      pairs.push([
        { role: 'user', text: asked.text.slice(0, aiQuestionLength) },
        { role: 'assistant', text: answered.text.slice(0, aiAnswerLength) },
      ]);
      i++;
    }
  }
  const kept = pairs.slice(-Math.floor((aiTurns - 1) / 2)).flat();
  return [...kept, { role: 'user', text: question }];
}

// A conversation kept in the tab, as far as it still makes sense: its messages, the profile it is
// about and a question waiting to be asked (draft).
export function readConversation(raw) {
  let kept;
  try {
    kept = JSON.parse(raw);
  } catch {
    return { turns: [], focus: null, draft: '' };
  }
  const turns = (Array.isArray(kept?.turns) ? kept.turns : [])
    .filter(turn => turn && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.text === 'string')
    .map(turn => ({
      role: turn.role,
      text: turn.text,
      error: typeof turn.error === 'string' ? turn.error : '',
      sources: Array.isArray(turn.sources)
        ? turn.sources.filter(s => s && typeof s.url === 'string' && /^https?:\/\//i.test(s.url))
        : [],
    }))
    .slice(-60);
  const f = kept?.focus;
  const focus = f && typeof f.name === 'string' && armoryRoute.test(f.path || '') ? f : null;
  const draft = typeof kept?.draft === 'string' ? kept.draft.slice(0, aiQuestionLength) : '';
  return { turns, focus, draft };
}

// ---------------------------------------------------------------- Page

// The examples an empty conversation offers: upgrades first, about the profile it was opened from
// when there is one.
export function examples(focus, web) {
  const list = focus
    ? [
        t('What should {name} upgrade first?', { name: focus.name }),
        t('Make an upgrade plan for {name}, step by step.', { name: focus.name }),
        t('Which stones and stats should {name} aim for?', { name: focus.name }),
      ]
    : [
        t('What should my character upgrade first?'),
        t('Which stats do the strongest Chanters roll on their gear?'),
        t('Which arcana sets do the strongest Templars run?'),
      ];
  if (web)
    list.push(
      focus
        ? t('Where do the items {name} should get next come from?', { name: focus.name })
        : t('Where does the best Gladiator weapon drop?'),
    );
  return list;
}

// Why the account cannot ask (status: the backend's answer, null while it loads; signed in or not).
function closed(status, signedIn) {
  if (!signedIn)
    return `<p class="armory-empty">${t('Sign in to ask the armory AI. Only the accounts the server’s operator lets use it can ask.')}</p><a class="button primary" href="${esc(link('/'))}">${t('Sign in')}</a>`;
  if (!status)
    return `<p class="armory-empty upgrade-wait"><span class="armory-spinner" aria-hidden="true"></span>${t('Loading…')}</p>`;
  if (status.error) return `<p class="armory-empty">${esc(t(status.error))}</p>`;
  if (!status.allowed)
    return `<p class="armory-empty">${t('Your account may not use the armory AI. The server’s operator decides who can.')}</p>`;
  if (!status.configured) return `<p class="armory-empty">${t('The armory AI is not set up on this server yet.')}</p>`;
  if (status.paused) return `<p class="armory-empty">${t('The armory AI is paused for now. Try again later.')}</p>`;
  return '';
}

// One message of the conversation: the account's question, or the AI's answer with what it is
// doing while it writes (the last one, while view.streaming), why it failed and the pages it cites.
export function aiTurn(turn, last, view) {
  if (turn.role === 'user') return `<article class="ai-turn is-user"><p>${esc(turn.text)}</p></article>`;
  const streaming = last && view.streaming;
  const sources = turn.sources?.length
    ? `<details class="ai-sources"><summary>${t('Sources')} <span>${turn.sources.length}</span></summary><ul>${turn.sources.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.url)}</a></li>`).join('')}</ul></details>`
    : '';
  const wait =
    streaming && view.statusLine
      ? `<p class="ai-working" role="status"><span class="armory-spinner" aria-hidden="true"></span>${esc(t(view.statusLine.text, view.statusLine.params))}</p>`
      : '';
  const error = turn.error ? `<p class="ai-error" role="alert">${icon('alert')}${esc(t(turn.error))}</p>` : '';
  return `<article class="ai-turn is-ai${streaming ? ' is-streaming' : ''}"><div class="ai-answer">${markdown(turn.text)}</div>${wait}${error}${sources}</article>`;
}

// The AI's page. view: { status, signedIn, turns, focus, streaming, statusLine, now }.
export function aiPage(view) {
  const { status, signedIn, turns = [], focus = null, streaming = false } = view;
  const blocked = closed(status, signedIn);
  const heading = `<div class="heading"><div><h1>${icon('spark')} ${t('Ask the armory AI')}</h1><p>${t('Ask in your own words how to upgrade your gear: what to improve first, which items, stones and stats the stronger players of your class use, and where they come from. It finds and compares other characters too.')}</p></div><div class="heading-actions">${turns.length && !blocked ? `<button class="button secondary" data-action="ai-new" ${streaming ? 'disabled' : ''}>${t('New conversation')}</button>` : ''}<a class="button secondary" href="${esc(link('/armory'))}">${icon('search')} ${t('Search the armory')}</a></div></div>`;
  if (blocked)
    return `<main class="dashboard armory armory-ai">${heading}<section class="armory-panel ai-closed">${blocked}</section></main>`;
  const about = focus
    ? `<p class="ai-focus">${t('About')} <a href="${esc(link(focus.path))}">${esc(focus.name)}</a>${turns.length ? '' : `<button class="close-button" data-action="ai-unfocus" aria-label="${esc(t('Ask about any character'))}" title="${esc(t('Ask about any character'))}">×</button>`}</p>`
    : '';
  const log = turns.length
    ? turns.map((turn, i) => aiTurn(turn, i === turns.length - 1, view)).join('')
    : `<div class="ai-examples"><p>${t('For example:')}</p><ul>${examples(focus, status.web)
        .map(
          text =>
            `<li><button type="button" class="ai-example" data-ai-example="${esc(text)}">${esc(text)}</button></li>`,
        )
        .join('')}</ul></div>`;
  const left = status.remaining > 0;
  const freeAt =
    !left && status.freeAt
      ? ' ' + t('You can ask again from {time}.', { time: changedAt(status.freeAt, view.now || Date.now()) })
      : '';
  const form = `<form id="armory-ai-form" class="ai-form"><label class="sr-only" for="ai-question">${t('Your question')}</label><textarea id="ai-question" name="question" rows="2" maxlength="2000" required placeholder="${esc(left ? t('Ask about your gear or a character…') : t('No questions left for now.'))}" ${left && !streaming ? '' : 'disabled'}>${esc(view.draft || '')}</textarea><button class="button primary" type="submit" ${left && !streaming ? '' : 'disabled'}>${streaming ? t('Answering…') : t('Ask')}</button></form>`;
  const note = `<p class="armory-note">${icon('info')}<span>${t('{n} of {limit} questions left in 24 hours.', { n: number(Math.max(0, status.remaining)), limit: number(status.limit) })}${freeAt} ${esc(status.web ? t('{model} by Anthropic answers with the armory’s data and the web. Answers can be wrong: check the profiles they link.', { model: status.model || 'Claude' }) : t('{model} by Anthropic answers with the armory’s data. Answers can be wrong: check the profiles they link.', { model: status.model || 'Claude' }))} ${t('Your questions go to Anthropic to be answered; Odyle keeps only that you asked, and this tab the conversation.')}</span></p>`;
  return `<main class="dashboard armory armory-ai">${heading}${about}<section class="ai-log" aria-live="polite" aria-busy="${streaming}">${log}</section>${form}${note}</main>`;
}

// ---------------------------------------------------------------- Stream

// The lines of an answer as they arrive: whole lines of JSON from the text so far, and what is
// left of an unfinished line.
export function readLines(buffer) {
  const lines = buffer.split('\n'),
    rest = lines.pop();
  const events = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      /* not a line of the answer */
    }
  }
  return { events, rest };
}
