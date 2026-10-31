'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadBackground } = require('../support/background-harness');

const PREVIEW_URL = 'chrome-extension://test/preview-page.html';

function openPreview(state, section) {
  const message = { type: 'open-preview' };
  if (section !== undefined) message.section = section;
  state.listeners.message(message, {}, () => {});
}

const createdUrls = state => state.tabsCreated.map(props => props.url);

test('the preview opens a new tab when none is open', () => {
  const state = loadBackground();
  openPreview(state);

  assert.deepEqual(createdUrls(state), [PREVIEW_URL]);
  assert.equal(state.tabUpdates.length, 0);
});

test('an already-open preview tab is focused instead of duplicated', () => {
  const state = loadBackground({ openTabs: [{ id: 7, windowId: 3, url: PREVIEW_URL }] });
  openPreview(state);

  assert.deepEqual(createdUrls(state), [], 'no duplicate tab');
  assert.equal(state.tabUpdates.length, 1);
  assert.equal(state.tabUpdates[0].tabId, 7);
  assert.equal(state.tabUpdates[0].props.active, true);
  assert.equal(Object.hasOwn(state.tabUpdates[0].props, 'url'), false,
    'same section does not rewrite the URL');
  assert.equal(state.windowUpdates.length, 1);
  assert.equal(state.windowUpdates[0].windowId, 3);
  assert.equal(state.windowUpdates[0].props.focused, true);
});

test('the open preview tab is found without any remembered id, so a worker restart cannot duplicate it', () => {
  const state = loadBackground({ openTabs: [{ id: 7, windowId: 3, url: PREVIEW_URL }] });
  openPreview(state);
  openPreview(state);

  assert.deepEqual(createdUrls(state), [], 'every click reuses the same tab');
  assert.equal(state.tabUpdates.length, 2);
});

test('a preview tab carrying a hash fragment still counts as open', () => {
  const state = loadBackground({ openTabs: [{ id: 8, windowId: 1, url: `${PREVIEW_URL}#brightwell` }] });
  openPreview(state);

  assert.deepEqual(createdUrls(state), []);
  assert.equal(state.tabUpdates[0].tabId, 8);
});

test('another extension page is not mistaken for the preview', () => {
  const state = loadBackground({ openTabs: [{ id: 9, windowId: 1, url: 'chrome-extension://test/popup.html' }] });
  openPreview(state);

  assert.deepEqual(createdUrls(state), [PREVIEW_URL]);
  assert.equal(state.tabUpdates.length, 0);
});

test('a failed tab query falls back to opening a tab', () => {
  const state = loadBackground({
    queryError: { message: 'no tabs permission' },
    openTabs: [{ id: 7, windowId: 3, url: PREVIEW_URL }]
  });
  openPreview(state);

  assert.deepEqual(createdUrls(state), [PREVIEW_URL]);
});

test('preview sections open directly and invalid sections default to signatures', () => {
  const settings = loadBackground();
  openPreview(settings, 'settings');
  assert.deepEqual(createdUrls(settings), [`${PREVIEW_URL}#settings`]);

  const invalid = loadBackground();
  openPreview(invalid, 'unknown');
  assert.deepEqual(createdUrls(invalid), [PREVIEW_URL]);
});

test('opening another preview section updates only the fragment', () => {
  const state = loadBackground({ openTabs: [{ id: 7, windowId: 3, url: `${PREVIEW_URL}#settings` }] });
  openPreview(state, 'tools');

  assert.deepEqual(createdUrls(state), []);
  assert.equal(state.tabUpdates[0].tabId, 7);
  assert.equal(state.tabUpdates[0].props.active, true);
  assert.equal(state.tabUpdates[0].props.url, `${PREVIEW_URL}#tools`);
});

test('focusing a tab with the same section does not rewrite its fragment', () => {
  const state = loadBackground({ openTabs: [{ id: 7, windowId: 3, url: `${PREVIEW_URL}#tools` }] });
  openPreview(state, 'tools');

  assert.equal(state.tabUpdates[0].tabId, 7);
  assert.equal(state.tabUpdates[0].props.active, true);
  assert.equal(Object.hasOwn(state.tabUpdates[0].props, 'url'), false);
});

test('a failed section update falls back to opening the requested section', () => {
  const state = loadBackground({
    openTabs: [{ id: 7, windowId: 3, url: `${PREVIEW_URL}#settings` }],
    updateError: { message: 'No tab with id 7' }
  });
  openPreview(state, 'tools');

  assert.deepEqual(createdUrls(state), [`${PREVIEW_URL}#tools`]);
  assert.equal(state.windowUpdates.length, 0, 'no window focus after a failed update');
});

test('a synchronous tab query failure falls back to opening the requested section', () => {
  const state = loadBackground({ queryThrow: new Error('query failed') });
  openPreview(state, 'tools');

  assert.deepEqual(createdUrls(state), [`${PREVIEW_URL}#tools`]);
});

test('a synchronous tab update failure falls back to opening the requested section', () => {
  const state = loadBackground({
    openTabs: [{ id: 7, windowId: 3, url: `${PREVIEW_URL}#settings` }],
    updateThrow: new Error('update failed')
  });
  openPreview(state, 'tools');

  assert.deepEqual(createdUrls(state), [`${PREVIEW_URL}#tools`]);
});

test('a different section to signatures writes the explicit signatures fragment', () => {
  const state = loadBackground({ openTabs: [{ id: 7, windowId: 3, url: `${PREVIEW_URL}#tools` }] });
  openPreview(state, 'signatures');

  assert.equal(state.tabUpdates[0].props.url, `${PREVIEW_URL}#signatures`);
});

test('a failed window focus does not create a duplicate preview tab', () => {
  const state = loadBackground({
    openTabs: [{ id: 7, windowId: 3, url: `${PREVIEW_URL}#settings` }],
    windowUpdateThrow: new Error('window focus failed')
  });
  openPreview(state, 'settings');

  assert.deepEqual(createdUrls(state), []);
  assert.equal(state.tabUpdates.length, 1);
  assert.equal(state.windowUpdates.length, 1);
});

test('a tab that vanishes between the query and the update falls back to opening one', () => {
  const state = loadBackground({
    openTabs: [{ id: 7, windowId: 3, url: PREVIEW_URL }],
    updateError: { message: 'No tab with id 7' }
  });
  openPreview(state);

  assert.deepEqual(createdUrls(state), [PREVIEW_URL]);
  assert.equal(state.windowUpdates.length, 0, 'no window focus after a failed update');
});

test('reopening the same workspace asks that tab to start at the top', () => {
  const state = loadBackground({ openTabs: [{ id: 9, windowId: 1, url: 'chrome-extension://test/preview-page.html#signatures' }] });
  state.listeners.message({ type: 'open-preview', section: 'signatures' }, {}, () => {});
  assert.equal(state.workspaceMessages.length, 1);
  assert.equal(state.workspaceMessages[0].type, 'workspace-open');
  assert.equal(state.workspaceMessages[0].tabId, 9);
  assert.equal(state.workspaceMessages[0].section, 'signatures');
});
