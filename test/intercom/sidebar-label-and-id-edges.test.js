'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');

const page = (sidebar = '') => `<!doctype html><html><body>${sidebar}</body></html>`;

test('a required-field marker of one or more stars is dropped from a label', () => {
  const win = loadExtension(page());
  assert.equal(win.normalizeLabelText('Language *'), 'language');
  assert.equal(win.normalizeLabelText('Language **'), 'language');
  assert.equal(win.normalizeLabelText('Language**  '), 'language');
  assert.equal(win.normalizeLabelText('Star*rating'), 'star*rating');
});

const reactRow = (value) => `<div data-testid="sidebar-conversation-id"><span>ID</span><span data-test-attribute-value>${value}</span></div>`;
const legacyRow = (value) => `<div><span class="inbox2__attribute__label">ID</span>${value}</div>`;

test('the React conversation id is read only when the value is all digits', () => {
  assert.equal(loadExtension(page(reactRow('12345'))).getSidebarConversationId(), '12345');
  assert.equal(loadExtension(page(reactRow('12345abc'))).getSidebarConversationId(), null);
  assert.equal(loadExtension(page(reactRow('#12345'))).getSidebarConversationId(), null);
});

test('the labelled conversation id row is read only when the value is all digits', () => {
  assert.equal(loadExtension(page(legacyRow('67890'))).getSidebarConversationId(), '67890');
  assert.equal(loadExtension(page(legacyRow('67890 copied'))).getSidebarConversationId(), null);
  assert.equal(loadExtension(page(legacyRow('id 67890'))).getSidebarConversationId(), null);
});
