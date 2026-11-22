import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  onData,
  onAction,
  onSubmit,
  onChange,
  clickHandler,
  submitHandler,
  changeHandler,
} from '../../src/app/actions.js';

// A button as the dispatch sees it: its data-* attributes (dataset) and nothing else.
const button = dataset => ({ dataset });

onData({ testHistory: () => 'history', testShare: () => 'share' });
onData({ testScope: () => 'scope' }, true);
onAction({ 'test-close': () => 'close' });
onSubmit({ 'test-form': () => 'form' });
onChange({ testRole: () => 'role' });

test('a click goes to the handler of its data-* key, else of its data-action', () => {
  assert.equal(clickHandler(button({ testHistory: 'c1', name: 'Lumina' }))(), 'history');
  assert.equal(clickHandler(button({ testShare: 'c1', roomId: 'r1', enabled: 'true' }))(), 'share');
  assert.equal(clickHandler(button({ action: 'test-close' }))(), 'close');
  // Keys nobody registered (data-name, data-character) leave the data-action to decide.
  assert.equal(clickHandler(button({ character: 'c1', action: 'test-close' }))(), 'close');
  assert.equal(clickHandler(button({ action: 'nothing' })), null);
  assert.equal(clickHandler(button({})), null);
});

test('a key needs a value unless it was registered as present', () => {
  assert.equal(clickHandler(button({ testHistory: '' })), null);
  assert.equal(clickHandler(button({ testHistory: '', action: 'test-close' }))(), 'close');
  assert.equal(clickHandler(button({ testScope: '' }))(), 'scope');
});

test('forms go by their id and changes by their data-* key', () => {
  assert.equal(submitHandler({ id: 'test-form' })(), 'form');
  assert.equal(submitHandler({ id: 'other' }), null);
  assert.equal(changeHandler({ dataset: { testRole: 'm1' } })(), 'role');
  assert.equal(changeHandler({ dataset: {} }), null);
  assert.equal(changeHandler({}), null);
});

test('one key has one handler', () => {
  assert.throws(() => onData({ testHistory: () => 'again' }), /testHistory is handled twice/);
  assert.throws(() => onAction({ 'test-close': () => 'again' }), /handled twice/);
  assert.throws(() => onSubmit({ 'test-form': () => 'again' }), /handled twice/);
});
