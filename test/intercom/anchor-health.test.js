'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension, makeChromeStub } = require('../support/helpers');
const fx = require('../support/fixtures');

const NEW_CONVERSATION_URL =
  'https://app.intercom.com/a/inbox/demo1234/inbox/new-conversation?view=List';
const CONVERSATION_URL =
  'https://app.intercom.com/a/inbox/demo1234/inbox/team/900201/conversation/900476928560574';
const SETTINGS_URL = 'https://app.intercom.com/a/apps/demo1234/settings';

function draftShadowMarkup() {
  return `<div data-testid="new-conversation-view">
    <div data-testid="new-conversation-channel-picker"><button><span><span>Email</span></span></button></div>
    <div data-testid="composer-sender-area">
      <button data-test-sender-pill="true"><span>Support Kestrel Kids</span><span>help@kestrel-kids.example</span></button>
    </div>
    <div data-testid="draft-team-assignee">
      <button data-testid="team-assignee-selector"><span class="ml-2">Support Kestrel Kids</span></button>
    </div>
    <div data-testid="recipient-to-row">
      <div data-testid="recipient-to-input"><div data-testid="recipient-selector"><input role="combobox"></div></div>
    </div>
    <div data-testid="composer-orchestrator">
      <div data-testid="composer-editor-area">
        <div class="tiptap ProseMirror" contenteditable="true"><p></p></div>
      </div>
      <div data-testid="composer-actions-bar"><div><button data-testid="send-button">Send</button></div></div>
    </div>
  </div>`;
}

function runCheck(win) {
  return { report: win.buildAnchorHealthReport() };
}

function loadDraft({ url = NEW_CONVERSATION_URL, markup = draftShadowMarkup() } = {}) {
  const chrome = makeChromeStub();
  const win = loadExtension(
    '<!doctype html><html><body><div id="teammate-app-react"></div></body></html>',
    {
      url,
      chromeStub: chrome,
      beforeScripts(w) {
        w.document.getElementById('teammate-app-react')
          .attachShadow({ mode: 'open' }).innerHTML = markup;
      }
    }
  );
  return { win };
}

function anchorById(report, id) {
  return report.anchors.find(entry => entry.id === id);
}

test('the engine builds a report the capture can embed', () => {
  const { win } = loadDraft();
  const { report } = runCheck(win);

  assert.equal(report.ok, true);
  assert.equal(report.view, 'new-conversation');
  assert.ok(Array.isArray(report.anchors));
  assert.ok(report.summary.expected > 0);
});

test('a shadow-root-only anchor is found — the 2026-08-13 regression', () => {
  const { win } = loadDraft();
  const { report } = runCheck(win);

  assert.equal(report.shadowRootPresent, true);

  const sender = anchorById(report, 'draftSender');
  const pill = sender.selectors.find(entry => entry.key === 'draftSenderPill');

  assert.ok(pill.inShadow >= 1, 'the pill lives inside the shadow root');
  assert.equal(pill.inDocument, 0, 'and is invisible to a plain document query');
  assert.equal(sender.status, 'ok');
});

test('either-or grouping keeps an anchor healthy when one selector dies', () => {
  const { win } = loadDraft();
  const { report } = runCheck(win);

  const sender = anchorById(report, 'draftSender');
  const legacy = sender.selectors.find(entry => entry.key === 'senderSelectorField');

  assert.equal(legacy.count, 0, 'the dead ember anchor still reports zero');
  assert.equal(sender.status, 'ok', 'but the feature is healthy via a live selector');
});

test('a healthy new-conversation view reports nothing missing', () => {
  const { win } = loadDraft();
  const { report } = runCheck(win);

  assert.equal(report.summary.missing, 0, JSON.stringify(
    report.anchors.filter(a => a.status === 'missing').map(a => a.id)
  ));
});

test('a broken new-conversation view names the missing anchor', () => {
  const markup = draftShadowMarkup().replace(/data-testid="new-conversation-channel-picker"/, 'data-testid="gone"');
  const { win } = loadDraft({ markup });
  const { report } = runCheck(win);

  assert.equal(report.summary.missing, 1);
  assert.equal(anchorById(report, 'draftChannel').status, 'missing');
});

test('a missing anchor reports the stable attributes actually present nearby', () => {
  const markup = draftShadowMarkup().replace(/data-testid="new-conversation-channel-picker"/, 'data-testid="gone"');
  const { win } = loadDraft({ markup });
  const { report } = runCheck(win);

  assert.ok(report.candidates, 'candidates collected when an anchor is missing');
  assert.ok(report.candidates.testid.includes('gone'), 'the renamed testid is offered');
  assert.ok(report.candidates.testid.includes('composer-orchestrator'));
  assert.ok(!report.candidates.testid.includes('new-conversation-channel-picker'));
  assert.ok(report.candidates.testid.length <= 40, 'the candidate list is capped');
});

test('a healthy view collects no candidates', () => {
  const { win } = loadDraft();
  const { report } = runCheck(win);

  assert.equal(report.summary.missing, 0);
  assert.equal(report.candidates, null);
});

test('the summary buckets account for every anchor row', () => {
  const markup = draftShadowMarkup().replace(/data-testid="new-conversation-channel-picker"/, 'data-testid="gone"');
  const { win } = loadDraft({ markup });
  const { report } = runCheck(win);
  const { ok, missing, skipped } = report.summary;

  assert.equal(ok + missing + skipped, report.anchors.length);
  assert.equal(ok, report.anchors.filter(entry => entry.status === 'ok').length);
  assert.equal(skipped, report.anchors.filter(entry => entry.status === 'skipped').length);
});

test('conversation-only anchors are skipped on the new-conversation view', () => {
  const { win } = loadDraft();
  const { report } = runCheck(win);

  assert.equal(anchorById(report, 'closeAction').expected, false);
  assert.equal(anchorById(report, 'closeAction').status, 'skipped');
});

test('the transient assign menu is never counted as a failure', () => {
  const { win } = loadDraft();
  const { report } = runCheck(win);

  const menu = anchorById(report, 'assignMenu');
  assert.equal(menu.transient, true);
  assert.equal(menu.expected, false);
});

test('an unrelated Intercom page reports no failures', () => {
  const { win } = loadDraft({ url: SETTINGS_URL });
  const { report } = runCheck(win);

  assert.equal(report.view, 'other');
  assert.equal(report.summary.missing, 0);
  assert.equal(report.summary.expected, 0);
});

test('a closed conversation does not report the close guard as missing', () => {
  const chrome = makeChromeStub();
  const win = loadExtension(
    fx.inboxHtml({
      composer: fx.composer({ mode: 'email' }),
      conversation: fx.conversationSpace({ customerText: 'Hello' }),
      sidebar: fx.sidebarSection({ teamInbox: 'Support Brightwell' }),
      list: fx.conversationList([fx.conversationListRow({ conversationId: '901', name: 'Customer One' })]),
      toolbar: '<div data-intercom-target="conversation-toolbar"><button><svg class="interface-icon o__standard o__standard__reopen-conversation"></svg></button></div>'
    }),
    { url: CONVERSATION_URL, chromeStub: chrome }
  );
  const { report } = runCheck(win);

  const state = anchorById(report, 'closeAction');
  assert.equal(state.status, 'ok', 'a reopen control proves the toolbar anchors are alive');
  assert.equal(state.selectors.find(s => s.key === 'modernCloseButton').count, 0);
  assert.equal(report.summary.missing, 0, JSON.stringify(
    report.anchors.filter(a => a.status === 'missing').map(a => a.id)
  ));
});

function loadAgentOnlyConversation({ conversation } = {}) {
  const chrome = makeChromeStub();
  const win = loadExtension(
    fx.inboxHtml({
      composer: fx.composer({ mode: 'email' }),
      conversation: conversation || fx.conversationSpace({
        customerText: '',
        agentText: 'Bonjour Margaux, merci pour votre e-mail.',
        noteHtml: 'asked to wait for the refund'
      }),
      sidebar: fx.sidebarSection({ teamInbox: 'Support Brightwell' }),
      list: fx.conversationList([fx.conversationListRow({ conversationId: '903', name: 'Customer Three' })]),
      toolbar: fx.conversationHeader({ close: false, reopen: true })
    }),
    { url: CONVERSATION_URL, chromeStub: chrome }
  );
  return { win };
}

test('a thread the customer never wrote in reports customerMessages as absent, not missing', () => {
  const { win } = loadAgentOnlyConversation();
  const { report } = runCheck(win);

  const anchor = anchorById(report, 'customerMessages');
  assert.equal(anchor.status, 'absent');
  assert.equal(anchor.expected, true);
  assert.equal(anchor.absentEvidence.key, 'agentReplyPart');
  assert.equal(anchor.absentEvidence.count, 1);
  assert.equal(report.summary.missing, 0, JSON.stringify(
    report.anchors.filter(a => a.status === 'missing').map(a => a.id)
  ));
  assert.deepEqual(Array.from(report.anchors.filter(a => a.status === 'absent').map(a => a.id)), ['customerMessages', 'escalationStatus']);
});

test('customerMessages stays missing when the agent-reply anchor is gone too', () => {
  const conversation = fx.conversationSpace({
    customerText: 'Hello',
    agentText: 'Hi there'
  }).replace(/data-testid="user-email-content" /g, '')
    .replace(/email-html-content--inbound/g, 'renamed-by-intercom')
    .replace(/data-testid="teammate-email-reply-part"/g, 'data-testid="renamed-too"');
  const { win } = loadAgentOnlyConversation({ conversation });
  const { report } = runCheck(win);

  const anchor = anchorById(report, 'customerMessages');
  assert.equal(anchor.status, 'missing', 'a real selector death must not hide behind absent');
  assert.equal(anchor.absentEvidence, null);
  assert.ok(report.candidates, 'a missing anchor still collects replacement candidates');
});

test('the summary buckets, absent included, account for every anchor row', () => {
  const { win } = loadAgentOnlyConversation();
  const { report } = runCheck(win);
  const { ok, missing, absent, skipped } = report.summary;

  assert.equal(ok + missing + absent + skipped, report.anchors.length);
});

test('a closed conversation with only the modern Re-open button reports the close guard as ok', () => {
  const chrome = makeChromeStub();
  const win = loadExtension(
    fx.inboxHtml({
      composer: fx.composer({ mode: 'email' }),
      conversation: fx.conversationSpace({ customerText: 'Hello' }),
      sidebar: fx.sidebarSection({ teamInbox: 'Support Brightwell' }),
      list: fx.conversationList([fx.conversationListRow({ conversationId: '902', name: 'Customer Two' })]),
      toolbar: fx.conversationHeader({ close: false, reopen: true })
    }),
    { url: CONVERSATION_URL, chromeStub: chrome }
  );
  const { report } = runCheck(win);

  const state = anchorById(report, 'closeAction');
  assert.equal(state.status, 'ok');
  assert.equal(state.selectors.find(s => s.key === 'modernCloseButton').count, 0);
  assert.equal(state.selectors.find(s => s.key === 'modernReopenButton').count, 1);
  assert.equal(report.summary.missing, 0, JSON.stringify(
    report.anchors.filter(a => a.status === 'missing').map(a => a.id)
  ));
});

test('a conversation view without a shadow root is evaluated against the document', () => {
  const chrome = makeChromeStub();
  const win = loadExtension(
    fx.inboxHtml({
      composer: fx.composer({ mode: 'email' }),
      conversation: fx.conversationSpace({ customerText: 'Hello' }),
      sidebar: fx.sidebarSection({ teamInbox: 'Support Brightwell' })
    }),
    { url: CONVERSATION_URL, chromeStub: chrome }
  );
  const { report } = runCheck(win);

  assert.equal(report.view, 'conversation');
  assert.equal(report.shadowRootPresent, false);
  assert.equal(anchorById(report, 'composer').status, 'ok');
  assert.equal(anchorById(report, 'conversationSurface').status, 'ok');
});

test('the candidate list is cut to exactly 40 testids when more are present', () => {
  const extra = Array.from({ length: 60 }, (_, index) => `<div data-testid="extra-${index}"></div>`).join('');
  const markup = draftShadowMarkup().replace(/data-testid="new-conversation-channel-picker"/, 'data-testid="gone"')
    + extra;
  const { win } = loadDraft({ markup });
  const { report } = runCheck(win);

  assert.equal(report.candidates.testid.length, 40);
});

test('a React sidebar with only conversation attribute rows reports attribute labels as ok', () => {
  const chrome = makeChromeStub();
  const win = loadExtension(
    fx.inboxHtml({
      composer: fx.composer({ mode: 'email' }),
      conversation: fx.conversationSpace({ customerText: 'Hello' }),
      sidebar: fx.reactSidebarSection({ conversationAttrs: [fx.reactConversationAttrRow('9006910', 'Brand', 'Kestrel Kids')] })
    }),
    { url: CONVERSATION_URL, chromeStub: chrome }
  );
  const label = anchorById(runCheck(win).report, 'attributeLabel');

  assert.equal(label.status, 'ok');
  assert.equal(label.selectors.find(entry => entry.key === 'reactConversationAttributeLabel').count, 1);
});

function loadSidebarRow(labelMarkup) {
  const row = `<div class="flex flex-row items-center min-h-8" data-testid="sidebar-conversation-attribute-9006910">
    <div class="w-1/3">${labelMarkup}</div><div class="w-3/5 px-1 min-w-0"><span>Kestrel Kids</span></div>
  </div>`;
  return loadExtension(
    fx.inboxHtml({
      composer: fx.composer({ mode: 'email' }),
      conversation: fx.conversationSpace({ customerText: 'Hello' }),
      sidebar: fx.reactSidebarSection({ conversationAttrs: [row] })
    }),
    { url: CONVERSATION_URL, chromeStub: makeChromeStub() }
  );
}

test('row labels found only by the broad backup report attributeLabel as degraded, not ok or missing', () => {
  const { report } = runCheck(loadSidebarRow('<span class="truncate">Brand</span>'));
  const { ok, missing, absent, degraded, skipped } = report.summary;

  assert.equal(anchorById(report, 'attributeLabel').status, 'degraded');
  assert.equal(degraded, 1);
  assert.equal(ok + missing + absent + degraded + skipped, report.anchors.length);
});

test('rows with no label text at all keep attributeLabel missing', () => {
  const { report } = runCheck(loadSidebarRow('<span class="truncate"></span>'));

  assert.equal(anchorById(report, 'attributeLabel').status, 'missing');
});

const STATUS_CONVERSATION_ID = '900476928560574';

function loadStatusConversation(conversationAttrs) {
  return loadExtension(
    fx.inboxHtml({
      composer: fx.composer({ mode: 'email' }),
      conversation: fx.conversationSpace({ customerText: 'Hello' }),
      sidebar: fx.sidebarSection({ conversationAttrs })
    }),
    { url: CONVERSATION_URL, chromeStub: makeChromeStub() }
  );
}

function deliverStatus(win, conversationId = STATUS_CONVERSATION_ID) {
  const post = data => win.dispatchEvent(new win.MessageEvent('message', { data, source: win, origin: 'https://app.intercom.com' }));
  post({ __isaic: true, version: 1, kind: 'escalation-status-visibility', teamIds: ['900201'], observedAt: 1 });
  post({ __isaic: true, version: 1, kind: 'conversation-team', conversationId, teamId: '900201', source: 'summary' });
  post({ __isaic: true, version: 1, kind: 'conversation-escalation-status', conversationId, inProgress: true, source: 'stream' });
}

test('a rendered Escalation Status row reports escalationStatus ok, whatever the network says', () => {
  const win = loadStatusConversation([fx.conversationAttrRow('3001', 'Escalation Status', 'DONE')]);
  deliverStatus(win);
  assert.equal(anchorById(runCheck(win).report, 'escalationStatus').status, 'ok');
});

test('a missing Escalation Status row answered by the network reports degraded', () => {
  const win = loadStatusConversation([]);
  deliverStatus(win);
  const anchor = anchorById(runCheck(win).report, 'escalationStatus');
  assert.equal(anchor.status, 'degraded');
  assert.equal(anchor.expected, true);
});

test('a missing Escalation Status row with no network value reports absent, never missing', () => {
  const win = loadStatusConversation([]);
  assert.equal(anchorById(runCheck(win).report, 'escalationStatus').status, 'absent');
});

test('a network value for another conversation does not make the open one degraded', () => {
  const win = loadStatusConversation([]);
  deliverStatus(win, '900903972229001');
  assert.equal(anchorById(runCheck(win).report, 'escalationStatus').status, 'absent');
});

test('escalationStatus is skipped outside a conversation', () => {
  const { win } = loadDraft();
  assert.equal(anchorById(runCheck(win).report, 'escalationStatus').status, 'skipped');
});
