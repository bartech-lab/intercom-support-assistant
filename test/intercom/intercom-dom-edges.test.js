'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

const NEW_CONVERSATION_URL = 'https://app.intercom.com/a/inbox/demo1234/inbox/new-conversation?view=List';
const CONVERSATION_URL = 'https://app.intercom.com/a/inbox/demo1234/inbox/team/900201/conversation/900476928560574';

function shadowPage(shadowMarkup, documentMarkup = '', url = NEW_CONVERSATION_URL) {
  return loadExtension(`<!doctype html><html><body>${documentMarkup}<div id="teammate-app-react"></div></body></html>`, {
    url,
    beforeScripts(w) {
      w.document.getElementById('teammate-app-react').attachShadow({ mode: 'open' }).innerHTML = shadowMarkup;
      w.setTimeout = () => 1;
      w.clearTimeout = () => {};
    }
  });
}

test('the Inbox shadow root is searched before the document and is the main root', () => {
  const win = shadowPage('<div id="in-shadow" class="probe"></div>', '<div id="in-document" class="probe"></div>');
  assert.equal(win.queryIntercom('.probe').id, 'in-shadow');
  assert.equal(win.getIntercomRoot(), win.document.getElementById('teammate-app-react').shadowRoot);
});

test('the React stream container is the last conversation stream fallback', () => {
  const win = shadowPage('<div data-testid="conversation-stream-scroll-container" id="react-stream"></div>');
  assert.equal(win.getConversationStream().id, 'react-stream');
});

test('anchor candidates come from the conversation stream only, trimmed and sorted', () => {
  const win = shadowPage(`<div data-testid="conversation-stream-scroll-container">
      <div data-testid="  zeta  "></div><div data-testid="alpha"></div>
    </div>
    <div data-testid="outside-stream"></div>`);
  const testids = Array.from(win.collectAnchorCandidates().testid);
  assert.deepEqual(testids, ['alpha', 'zeta']);
});

test('a DOM capture without the capture module answers capture-unavailable', () => {
  const win = shadowPage('<div></div>');
  win.ISA_DOM_CAPTURE = undefined;
  const result = win.buildDomCapture();
  assert.equal(result.ok, false);
  assert.equal(result.error, 'capture-unavailable');
});

test('anchor health flags a resolved anchor the view does not expect as unexpected', () => {
  const win = shadowPage(`<div data-testid="new-conversation-view">
      <div data-testid="draft-team-assignee"><button data-testid="team-assignee-selector">Billing</button></div>
      <div data-testid="composer-orchestrator"><div data-testid="composer-editor-area"><div class="ProseMirror" contenteditable="true"></div></div></div>
    </div>`);
  const anchors = win.buildAnchorHealthReport().anchors;
  const unexpectedOk = anchors.filter(anchor => !anchor.expected && anchor.status === 'ok');
  assert.ok(unexpectedOk.length > 0, 'the fixture resolves an anchor this view does not expect');
  assert.ok(anchors.some(anchor => anchor.expected && anchor.status === 'ok'));
});

test('anchor health reports an absent anchor as absent', () => {
  const win = loadExtension(fx.inboxHtml({
    composer: fx.composer({ mode: 'email' }),
    conversation: fx.conversationSpace({ customerText: '', agentText: 'Bonjour, merci.' }),
    sidebar: fx.sidebarSection({ teamInbox: 'Support Brightwell' }),
    toolbar: fx.conversationHeader({ close: false, reopen: true })
  }), { url: CONVERSATION_URL });
  const anchor = win.buildAnchorHealthReport().anchors.find(entry => entry.id === 'customerMessages');
  assert.equal(anchor.status, 'absent', JSON.stringify(anchor));
});
