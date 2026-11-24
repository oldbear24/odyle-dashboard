import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  markdown,
  inline,
  conversationOf,
  readConversation,
  readLines,
  aiPage,
  aiTurn,
  examples,
} from '../../src/armoryai.js';

test("the AI's Markdown becomes HTML with nothing it wrote as HTML", () => {
  assert.equal(inline('**Kai** has *more* `CP`'), '<strong>Kai</strong> has <em>more</em> <code>CP</code>');
  assert.equal(inline('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  // Links to the armory's own pages and to web pages; anything else stays text.
  assert.equal(
    inline('[Kai](/armory/eu/2304/S2FpS2FpS2FpS2Fp)'),
    '<a href="#/armory/eu/2304/S2FpS2FpS2FpS2Fp">Kai</a>',
  );
  assert.equal(
    inline('[guide](https://example.com/a?b=1&c=2)'),
    '<a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">guide</a>',
  );
  assert.equal(inline('[x](javascript:alert(1))'), 'x)');
  assert.equal(inline('[rooms](/room/abc)'), 'rooms');
  assert.equal(inline('[a"b](/armory/ai)'), '<a href="#/armory/ai">a&quot;b</a>');
  // Bold and italic may hold a link; marks the AI wrote that look like the set-aside ones are dropped.
  assert.equal(
    inline('Found **[Kai](/armory/eu/2304/S2FpS2FpS2FpS2Fp)** and *[guide](https://example.com)*'),
    'Found <strong><a href="#/armory/eu/2304/S2FpS2FpS2FpS2Fp">Kai</a></strong> and <em><a href="https://example.com" target="_blank" rel="noopener noreferrer">guide</a></em>',
  );
  assert.equal(inline('a\uE0000\uE001b'), 'a0b');
  // Underscores in names are no emphasis.
  assert.equal(inline('Kai_Lumiel and 2 * 3 * 4'), 'Kai_Lumiel and 2 * 3 * 4');
  const html = markdown(
    [
      '## Kai vs Mira',
      '',
      'Kai is **stronger**.',
      'By a lot.',
      '',
      '- Weapon: +15',
      '- Helmet: +10',
      '',
      '1. Enchant the weapon',
      '2. Fill the stones',
      '',
      '| Slot | Kai | Mira |',
      '| --- | --- | ---: |',
      '| Weapon | **+15** | +12 |',
      '| Helmet | +10 | <b>+9</b> |',
      '',
      '> From the Upgrade tab',
      '',
      '```',
      'a <b> c',
      '```',
    ].join('\n'),
  );
  assert.equal(
    html,
    '<h3>Kai vs Mira</h3><p>Kai is <strong>stronger</strong>.<br>By a lot.</p><ul><li>Weapon: +15</li><li>Helmet: +10</li></ul><ol><li>Enchant the weapon</li><li>Fill the stones</li></ol>' +
      '<div class="ai-table"><table><thead><tr><th>Slot</th><th>Kai</th><th>Mira</th></tr></thead><tbody><tr><td>Weapon</td><td><strong>+15</strong></td><td>+12</td></tr><tr><td>Helmet</td><td>+10</td><td>&lt;b&gt;+9&lt;/b&gt;</td></tr></tbody></table></div>' +
      '<blockquote>From the Upgrade tab</blockquote><pre><code>a &lt;b&gt; c</code></pre>',
  );
  // An answer still being written: an open table or code block is drawn as far as it goes.
  assert.equal(
    markdown('| A | B |\n| --- | --- |\n| 1'),
    '<div class="ai-table"><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table></div>',
  );
  assert.equal(markdown('```\nx'), '<pre><code>x</code></pre>');
  assert.equal(markdown(''), '');
});

test('a question is sent with the latest of the conversation, failed answers left out', () => {
  const turns = [
    { role: 'user', text: 'Hi' },
    { role: 'assistant', text: 'Hello' },
    { role: 'user', text: 'Broken' },
    { role: 'assistant', text: '', error: 'The AI service is busy. Try again in a minute.' },
    { role: 'user', text: 'Kai?' },
    { role: 'assistant', text: 'x'.repeat(13000) },
  ];
  const sent = conversationOf(turns, 'And Mira?');
  assert.deepEqual(
    sent.map(m => [m.role, m.text.length]),
    [
      ['user', 2],
      ['assistant', 5],
      ['user', 4],
      ['assistant', 12000],
      ['user', 9],
    ],
  );
  // At most 20 messages: the oldest go.
  const long = [];
  for (let i = 0; i < 30; i++) long.push({ role: 'user', text: 'q' + i }, { role: 'assistant', text: 'a' + i });
  const kept = conversationOf(long, 'last');
  assert.equal(kept.length, 19);
  assert.equal(kept[0].text, 'q21');
  assert.equal(kept.at(-1).text, 'last');
});

test('a kept conversation is read as far as it makes sense', () => {
  assert.deepEqual(readConversation('nonsense'), { turns: [], focus: null, draft: '' });
  assert.deepEqual(readConversation(null), { turns: [], focus: null, draft: '' });
  assert.equal(readConversation(JSON.stringify({ draft: 'x'.repeat(3000) })).draft.length, 2000);
  const read = readConversation(
    JSON.stringify({
      turns: [
        { role: 'user', text: 'Hi' },
        { role: 'system', text: 'no' },
        {
          role: 'assistant',
          text: 'Hello',
          sources: [{ url: 'javascript:x' }, { url: 'https://example.com', title: 'Ex' }],
        },
      ],
      focus: { name: 'Kai', path: '/armory/eu/2304/S2FpS2FpS2FpS2Fp' },
    }),
  );
  assert.equal(read.turns.length, 2);
  assert.deepEqual(read.turns[1].sources, [{ url: 'https://example.com', title: 'Ex' }]);
  assert.equal(read.focus.name, 'Kai');
  assert.equal(readConversation(JSON.stringify({ focus: { name: 'X', path: '/room/x' } })).focus, null);
});

test('the answer is read line by line as it streams', () => {
  assert.deepEqual(readLines('{"type":"text","text":"Ka"}\n{"type":"te'), {
    events: [{ type: 'text', text: 'Ka' }],
    rest: '{"type":"te',
  });
  assert.deepEqual(readLines('not json\n\n{"type":"done"}\n'), { events: [{ type: 'done' }], rest: '' });
});

test('the page says why an account cannot ask, or shows the conversation and the question box', () => {
  assert.match(aiPage({ status: null, signedIn: false }), /Sign in to ask the armory AI/);
  assert.match(aiPage({ status: null, signedIn: true }), /Loading…/);
  assert.match(aiPage({ status: { allowed: false }, signedIn: true }), /Your account may not use the armory AI/);
  assert.match(
    aiPage({ status: { allowed: true, configured: false }, signedIn: true }),
    /not set up on this server yet/,
  );
  assert.match(aiPage({ status: { allowed: true, configured: true, paused: true }, signedIn: true }), /paused for now/);
  const status = {
    allowed: true,
    configured: true,
    ready: true,
    limit: 20,
    remaining: 17,
    used: 3,
    web: true,
    model: 'Claude Opus 5.5',
  };
  const empty = aiPage({
    status,
    signedIn: true,
    turns: [],
    focus: { name: 'Kai', path: '/armory/eu/2304/S2FpS2FpS2FpS2Fp' },
  });
  assert.match(empty, /data-ai-example="What should Kai upgrade first\?"/);
  assert.match(
    empty,
    /<a href="#\/armory\/eu\/2304\/S2FpS2FpS2FpS2Fp">Kai<\/a><button class="close-button" data-action="ai-unfocus"/,
  );
  assert.match(
    empty,
    /<textarea id="ai-question" name="question"[^>]*required placeholder="Ask about your gear or a character…" ><\/textarea>/,
  );
  assert.match(empty, /17 of 20 questions left in 24 hours\./);
  assert.match(empty, /Claude Opus 5\.5 by Anthropic answers with the armory’s data and the web\./);
  // Upgrades first, about the profile when there is one; the web's example only with the web on.
  assert.deepEqual(examples(null, false), [
    'What should my character upgrade first?',
    'Which stats do the strongest Chanters roll on their gear?',
    'Which arcana sets do the strongest Templars run?',
  ]);
  assert.equal(examples({ name: 'Kai' }, true).at(-1), 'Where do the items Kai should get next come from?');
  // A question waiting to be asked (the Upgrade tab's) is in the box, escaped.
  assert.match(
    aiPage({ status, signedIn: true, turns: [], draft: 'What should <Kai> upgrade first?' }),
    /<textarea id="ai-question"[^>]*>What should &lt;Kai&gt; upgrade first\?<\/textarea>/,
  );
  const turns = [
    { role: 'user', text: 'Who is <Kai>?' },
    { role: 'assistant', text: 'Kai is **strong**', sources: [{ url: 'https://example.com', title: 'Guide' }] },
  ];
  const writing = aiPage({
    status,
    signedIn: true,
    turns,
    streaming: true,
    statusLine: { text: 'Searching for {name}…', params: { name: 'Kai' } },
  });
  assert.match(writing, /<article class="ai-turn is-user"><p>Who is &lt;Kai&gt;\?<\/p><\/article>/);
  assert.match(
    writing,
    /<article class="ai-turn is-ai is-streaming"><div class="ai-answer"><p>Kai is <strong>strong<\/strong><\/p><\/div><p class="ai-working" role="status">[^]*Searching for Kai…<\/p>/,
  );
  assert.match(writing, /<a href="https:\/\/example.com" target="_blank" rel="noopener noreferrer">Guide<\/a>/);
  assert.match(writing, /<button class="button primary" type="submit" disabled>Answering…<\/button>/);
  assert.match(writing, /data-action="ai-new" disabled/);
  const failed = aiTurn(
    { role: 'assistant', text: '', error: 'The AI service is busy. Try again in a minute.' },
    true,
    {},
  );
  assert.match(failed, /<p class="ai-error" role="alert">[^]*The AI service is busy\. Try again in a minute\.<\/p>/);
  const spent = aiPage({
    status: { ...status, remaining: 0, freeAt: '2026-11-25T10:00:00.000Z' },
    signedIn: true,
    turns,
  });
  assert.match(spent, /placeholder="No questions left for now\." disabled>/);
  assert.match(spent, /You can ask again from /);
});
