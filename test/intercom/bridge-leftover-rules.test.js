'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');
const {
  TEAM,
  TAMSIN,
  WREN,
  build,
  row,
  chipText,
  CONTACT_A,
  CONTACT_B
} = require('../support/duplicate-conversations-harness');
const { ORIGIN: NOTE_ORIGIN, WORKSPACE, CONTACT, loadSidebar } = require('../support/temporary-notes-harness');

const ORIGIN = 'https://app.intercom.com';
const CONVERSATION_URL = `${ORIGIN}/a/inbox/team/123/conversation/456`;
const base = { __isaic: true, version: 1 };

function deliver(win, data) {
  win.dispatchEvent(new win.MessageEvent('message', { data, source: win, origin: ORIGIN }));
}

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const teamEnvelope = (id) => ({ ...base, kind: 'conversation-team', conversationId: String(id), teamId: '900201', source: 'summary' });
const language = (id, value, source = 'summary') => ({ ...base, kind: 'conversation-language', conversationId: String(id), language: value, source });
const hasTeam = (win, id) => win.eval(`networkTeamByConversation.has('${id}')`);

test('team cache keeps the 20 newest conversations and forgets the first after 21', () => {
  const win = loadExtension(fx.inboxHtml({}), { url: CONVERSATION_URL });
  range(1, 20).forEach((id) => deliver(win, teamEnvelope(id)));
  assert.equal(hasTeam(win, 1), true, 'first is kept at 20');
  deliver(win, teamEnvelope(21));
  assert.equal(hasTeam(win, 1), false);
  assert.equal(hasTeam(win, 2), true);
  assert.equal(hasTeam(win, 21), true);
});

test('an unrecognised network language does not overwrite a recognised one', () => {
  const win = loadExtension(fx.inboxHtml({}), { url: CONVERSATION_URL });
  deliver(win, language(456, 'German'));
  assert.equal(win.resolveNetworkLanguage('456'), 'german');
  deliver(win, language(456, 'Klingon'));
  assert.equal(win.resolveNetworkLanguage('456'), 'german');
});

function englishCachedWindow() {
  const win = loadExtension(fx.inboxHtml({
    sidebar: fx.sidebarSection({ conversationAttrs: [fx.conversationAttrRow('9001', 'Language', 'English')] })
  }), { url: CONVERSATION_URL });
  assert.equal(win.activeSignatureLanguage(), 'english');
  assert.equal(win.eval('cachedLanguageDetection').conversationId, '456');
  return win;
}

test('a network language for another conversation keeps the open conversation cached detection', () => {
  const win = englishCachedWindow();
  deliver(win, language(789, 'fr'));
  assert.equal(win.eval('cachedLanguageDetection').conversationId, '456');
  assert.equal(win.activeSignatureLanguage(), 'english');
});

const listIdentities = (inboxId, entries) => ({
  ...base,
  kind: 'inbox-list-identity',
  inboxType: 'team',
  inboxId,
  inboxKey: `team:${inboxId}:open`,
  state: 'open',
  identities: entries
});

test('list identities are forgotten for the current inbox after 50 other inboxes', () => {
  const win = build([row('1', TAMSIN)]);
  deliver(win, listIdentities(TEAM, [{ conversationId: '1', contactId: CONTACT_A }]));
  assert.notEqual(win.listIdentitiesForCurrentInbox(), null);
  range(1, 50).forEach((n) => deliver(win, listIdentities(String(8000 + n), [{ conversationId: '1', contactId: CONTACT_A }])));
  assert.equal(win.listIdentitiesForCurrentInbox(), null);
});

test('list identities for the current inbox survive 49 other inboxes', () => {
  const win = build([row('1', TAMSIN)]);
  deliver(win, listIdentities(TEAM, [{ conversationId: '1', contactId: CONTACT_A }]));
  range(1, 49).forEach((n) => deliver(win, listIdentities(String(8000 + n), [{ conversationId: '1', contactId: CONTACT_A }])));
  assert.notEqual(win.listIdentitiesForCurrentInbox(), null);
});

const stripLinkText = (win) =>
  [...win.document.querySelectorAll('.isa-duplicate-customer-strip a')].map((a) => a.textContent);

function groupedWindow() {
  const win = build([row('1', TAMSIN), row('3', WREN)], {
    url: `${ORIGIN}/a/inbox/demo1234/inbox/team/${TEAM}/conversation/1?view=List`
  });
  deliver(win, listIdentities(TEAM, [
    { conversationId: '1', contactId: CONTACT_A },
    { conversationId: '2', contactId: CONTACT_A },
    { conversationId: '3', contactId: CONTACT_B }
  ]));
  assert.deepEqual(stripLinkText(win), ['1', '2']);
  return win;
}

const conversationState = (conversationId, state) => ({ ...base, kind: 'conversation-state', conversationId, state });

test('a valid closed conversation-state removes the duplicate from its group', () => {
  const win = groupedWindow();
  deliver(win, conversationState('2', 'closed'));
  assert.equal(win.document.querySelector('.isa-duplicate-customer-strip'), null);
  assert.equal(chipText(win, '1'), null);
});

test('conversation-state with a malformed conversationId changes nothing', () => {
  for (const id of ['12a', 'a12', '2'.repeat(21)]) {
    const win = groupedWindow();
    deliver(win, conversationState(id, 'closed'));
    assert.deepEqual(stripLinkText(win), ['1', '2'], id);
  }
});

test('conversation-state with a malformed state changes nothing', () => {
  const win = groupedWindow();
  deliver(win, conversationState('2', 'Closed'));
  deliver(win, conversationState('2', 'closed_closed_closed'));
  deliver(win, conversationState('2', 'clo!sed'));
  assert.deepEqual(stripLinkText(win), ['1', '2']);
});

test('a closed state under another kind changes nothing', () => {
  const win = groupedWindow();
  deliver(win, { ...conversationState('2', 'closed'), kind: 'conversation-states' });
  assert.deepEqual(stripLinkText(win), ['1', '2']);
});

function armedDraft() {
  const win = loadSidebar();
  win.refreshTemporaryNoteControls();
  const toggle = win.document.querySelector('input[aria-label="Auto-delete"]');
  toggle.checked = true;
  toggle.dispatchEvent(new win.Event('change'));
  return { win, state: win.ISA_TEMPORARY_NOTES_UI.getDraft(`${WORKSPACE}:${CONTACT}`) };
}

function postSave(win, over) {
  win.handleIntercomBridgeMessage({
    source: win,
    origin: NOTE_ORIGIN,
    data: { ...base, kind: 'temporary-note-save', status: 'failed', reason: 'http-422', ...over }
  });
}

test('temporary-note-save with a well-formed token, revision and status updates the draft', () => {
  const { win, state } = armedDraft();
  state.token = 'abcdefgh';
  postSave(win, { token: 'abcdefgh', revision: state.revision });
  assert.equal(state.status, 'failed');
});

test('temporary-note-save with a malformed token, revision or status is ignored', () => {
  const cases = [
    ['7-char token', { token: 'abcdefg' }],
    ['leading bang token', { token: '!abcdefgh' }],
    ['trailing bang token', { token: 'abcdefgh!' }],
    ['129-char token', { token: 'a'.repeat(129) }],
    ['revision 1.5', { token: 'abcdefgh', revision: 1.5 }],
    ['status Saved', { token: 'abcdefgh', status: 'Saved' }]
  ];
  for (const [label, over] of cases) {
    const { win, state } = armedDraft();
    const before = state.status;
    state.token = over.token;
    state.revision = 'revision' in over ? over.revision : state.revision;
    postSave(win, { revision: state.revision, ...over });
    assert.equal(state.status, before, label);
  }
});

test('temporary-note-notes schedules a cleanup only for a well-formed workspace', () => {
  for (const [workspace, expected] of [[WORKSPACE, 1], ['!bad', 0], [`${WORKSPACE}!`, 0], ['a'.repeat(65), 0], ['a'.repeat(64), 1]]) {
    const win = loadSidebar();
    let observed = 0;
    win.scheduleTemporaryNoteCleanupFromObservation = () => { observed += 1; };
    win.handleIntercomBridgeMessage({
      source: win,
      origin: NOTE_ORIGIN,
      data: { ...base, kind: 'temporary-note-notes', workspace, notes: [] }
    });
    assert.equal(observed, expected, workspace);
  }
});
