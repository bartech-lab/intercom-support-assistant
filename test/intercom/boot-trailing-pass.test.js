'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

const TRAILING_ONLY_GAPS = [
  'refreshInProgressActionHighlights',
  'refreshMultiRecipientEmailHighlights'
];

function spyOn(win, names) {
  const calls = Object.fromEntries(names.map(name => [name, 0]));
  for (const name of names) {
    const original = win[name];
    win[name] = (...args) => {
      calls[name] += 1;
      return original(...args);
    };
  }
  return calls;
}

test('a mutation inside the throttle window still runs every row pass on the trailing edge', async () => {
  const win = loadExtension(fx.inboxHtml({
    list: fx.conversationList([]),
    composer: fx.composer({ mode: 'email' })
  }));
  const list = win.document.querySelector('[data-intercom-target-conversation-list]');

  list.appendChild(win.document.createElement('div'));
  await delay(0);

  const calls = spyOn(win, TRAILING_ONLY_GAPS);
  const sync = spyOn(win, ['syncTeamInboxFromSender']);
  list.appendChild(win.document.createElement('div'));
  await delay(0);
  assert.deepEqual(Object.values(calls), [0, 0], 'the throttled mutation defers its passes');

  await delay(150);
  for (const name of TRAILING_ONLY_GAPS) {
    assert.ok(calls[name] >= 1, `${name} ran on the trailing pass`);
  }
  assert.equal(sync.syncTeamInboxFromSender, 0, 'the Team Inbox sync drives Intercom UI, so it stays on the leading edge');
});

const TRAILING_PASSES = [
  'refreshInProgressActionHighlights',
  'refreshMultiRecipientEmailHighlights',
  'refreshDuplicateCustomerHighlights',
  'refreshSupportOriginHighlights',
  'refreshComposerLanguageState',
  'refreshIntercomAttachments',
  'refreshTemporaryNoteControls',
  'refreshTemporaryNoteFooters',
  'refreshTemporaryNoteCleanupContext'
];

test('the trailing edge runs each of its nine passes', async () => {
  const win = loadExtension(fx.inboxHtml({
    list: fx.conversationList([]),
    composer: fx.composer({ mode: 'email' })
  }));
  const list = win.document.querySelector('[data-intercom-target-conversation-list]');

  list.appendChild(win.document.createElement('div'));
  await delay(0);

  const calls = spyOn(win, TRAILING_PASSES);
  list.appendChild(win.document.createElement('div'));
  await delay(0);
  assert.deepEqual(Object.values(calls), TRAILING_PASSES.map(() => 0), 'the throttled mutation defers every pass');

  await delay(150);
  for (const name of TRAILING_PASSES) {
    assert.equal(calls[name], 1, `${name} ran once on the trailing pass`);
  }
});
