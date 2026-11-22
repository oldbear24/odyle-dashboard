import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useLanguage } from '../../src/i18n.js';
import { pageCount, pageOf, fillers, pager } from '../../src/pager.js';

test('a list has at least one page, however short', () => {
  assert.equal(pageCount(0, 10), 1);
  assert.equal(pageCount(1, 10), 1);
  assert.equal(pageCount(10, 10), 1);
  assert.equal(pageCount(11, 10), 2);
  assert.equal(pageCount(95, 10), 10);
});

test('a page of a held list is shaped like a paged answer and stays inside the list', () => {
  const list = Array.from({ length: 25 }, (_, i) => i + 1);
  assert.deepEqual(pageOf(list, 1, 10), {
    items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    page: 1,
    pages: 3,
    total: 25,
    perPage: 10,
  });
  assert.deepEqual(pageOf(list, 3, 10).items, [21, 22, 23, 24, 25]);
  // A page past either end is the nearest one.
  assert.equal(pageOf(list, 0, 10).page, 1);
  assert.equal(pageOf(list, -4, 10).page, 1);
  assert.equal(pageOf(list, 99, 10).page, 3);
  assert.deepEqual(pageOf(list, 99, 10).items, [21, 22, 23, 24, 25]);
  assert.deepEqual(pageOf([], 5, 10), { items: [], page: 1, pages: 1, total: 0, perPage: 10 });
});

test('a short last page is filled to the height of a full one, but a single page is not', () => {
  const rows = html => (html.match(/<tr /g) || []).length;
  const filled = fillers({ pages: 3, perPage: 10 }, 4, 3);
  assert.equal(rows(filled), 6);
  assert.equal((filled.match(/<td>&nbsp;<\/td>/g) || []).length, 18);
  assert.ok(filled.includes('aria-hidden="true"'));
  assert.equal(fillers({ pages: 3, perPage: 10 }, 10, 3), '');
  assert.equal(fillers({ pages: 1, perPage: 10 }, 4, 3), '');
});

test('the buttons under a list go to the newest, newer, older and oldest pages and rest where there are none', async () => {
  assert.equal(pager({ page: 1, pages: 1 }, 'data-page', 'History'), '');
  const buttons = html =>
    [
      ...html.matchAll(
        /<button class="pager-step ([^"]+)" type="button" data-page="(\d+)"( disabled)? title="([^"]*)"/g,
      ),
    ].map(m => ({ cls: m[1], to: Number(m[2]), disabled: Boolean(m[3]), name: m[4] }));
  const middle = pager({ page: 3, pages: 7 }, 'data-page', 'History <pages>');
  assert.deepEqual(buttons(middle), [
    { cls: 'newer edge', to: 1, disabled: false, name: 'Newest' },
    { cls: 'newer', to: 2, disabled: false, name: 'Newer' },
    { cls: 'older', to: 4, disabled: false, name: 'Older' },
    { cls: 'older edge', to: 7, disabled: false, name: 'Oldest' },
  ]);
  assert.ok(middle.includes('Page 3 of 7'));
  assert.ok(middle.includes('aria-label="History &lt;pages&gt;"'), 'the label is escaped');
  assert.deepEqual(
    buttons(pager({ page: 1, pages: 7 }, 'data-page', 'History')).map(b => b.disabled),
    [true, true, false, false],
  );
  assert.deepEqual(
    buttons(pager({ page: 7, pages: 7 }, 'data-page', 'History')).map(b => b.disabled),
    [false, false, true, true],
  );
  // Numbers are written the reader's way.
  try {
    await useLanguage('cs');
    const czech = pager({ page: 1234, pages: 5000 }, 'data-page', 'Historie');
    assert.ok(/Strana 1 ?234 z 5 ?000/.test(czech.replace(/\s/g, ' ')), czech);
  } finally {
    await useLanguage('en');
  }
});
