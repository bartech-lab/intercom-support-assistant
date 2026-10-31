"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadExtension } = require("../support/helpers");
const fx = require("../support/fixtures");
const fa = require("../support/fixtures-attachments");

const URL = "https://app.intercom.com/a/inbox/demo1234/inbox/conversation/100";
const HREF = "https://files.example.com/a.pdf";

function part(entityId, uploads, options = {}) {
  return fa.attachmentMessagePart({ entityId, partId: `p${entityId}`, index: 1, uploads, ...options });
}

function load({ header = fa.attachmentConversationHeader({ conversationId: "100" }), parts = [], composer = fa.attachmentComposer() } = {}) {
  return loadExtension(fx.inboxHtml({ conversation: [header, fa.attachmentStream(parts)].join("\n"), composer }), { url: URL });
}

function records(win) {
  const controller = win.ISA_ATTACHMENTS_ADAPTER.getController();
  return controller ? Array.from(controller.getRecords()) : [];
}

test("a filename wrapped in whitespace is trimmed and an empty one is named for the user", () => {
  const win = load({ parts: [part("1", [fa.attachmentUpload({ filename: "\n  a.pdf  ", href: HREF }), fa.attachmentUpload({ filename: "  ", href: HREF })])] });
  win.refreshIntercomAttachments();
  assert.deepEqual(records(win).map(record => record.filename), ["a.pdf", "Unnamed attachment"]);
});

test("an upload link outside an upload block is ignored", () => {
  const stray = `<a data-testid="upload-link" href="${HREF}">stray.pdf</a>`;
  const win = load({ parts: [part("1", [stray, fa.attachmentUpload({ filename: "a.pdf", href: HREF })])] });
  assert.doesNotThrow(() => win.refreshIntercomAttachments());
  assert.deepEqual(records(win).map(record => record.filename), ["a.pdf"]);
});

test("a header whose more button and snooze button sit in different clusters mounts beside the more button", () => {
  const header = `<div data-testid="conversation-header" data-conversation-id="100">
    <div data-inbox-conversation-header-title="true"><span>t</span></div>
    <div id="more-cluster"><button data-test-conversation-header-more="true"></button></div>
    <div id="snooze-cluster"><button data-test-conversation-header-snooze="true"></button></div>
  </div>`;
  const win = load({ header, parts: [part("1", [fa.attachmentUpload({ filename: "a.pdf", href: HREF })])] });
  win.refreshIntercomAttachments();
  const button = win.getIntercomRoot().querySelector(".isa-attachments-button");
  assert.ok(button);
  assert.equal(button.closest("#more-cluster") !== null, true);
});

for (const [label, change, read] of [
  ["date", root => { root.querySelector('[data-testid="metadata"] [data-testid="tooltip-trigger"]').textContent = "1h"; }, r => r.date],
  ["download link", root => { root.querySelector('a[data-testid="upload-link"]').setAttribute("href", "https://files.example.com/b.pdf"); }, r => r.href],
  ["sender role", root => { root.querySelector('[data-testid="user-email-content"]').setAttribute("data-testid", "teammate-email-reply-part"); }, r => r.senderRole]
]) {
  test(`a changed ${label} alone reaches the panel`, () => {
    const win = load({ parts: [part("1", [fa.attachmentUpload({ filename: "a.pdf", href: HREF })])] });
    win.refreshIntercomAttachments();
    const before = read(records(win)[0]);
    change(win.getIntercomRoot());
    win.refreshIntercomAttachments();
    assert.notEqual(read(records(win)[0]), before);
  });
}

test("a mounted panel is removed when the header loses every host anchor", () => {
  const win = load({ parts: [part("1", [fa.attachmentUpload({ filename: "a.pdf", href: HREF })])] });
  win.refreshIntercomAttachments();
  assert.ok(win.ISA_ATTACHMENTS_ADAPTER.getController());
  const root = win.getIntercomRoot();
  root.querySelector('[data-testid="conversation-header"]').outerHTML =
    '<div data-testid="conversation-header" data-conversation-id="100"><div><div><span>no anchors</span></div></div></div>';
  win.refreshIntercomAttachments();
  assert.equal(win.ISA_ATTACHMENTS_ADAPTER.getController(), null);
  assert.equal(root.querySelector(".isa-attachments-button"), null);
});

test("without the composer orchestrator the reply composer root bounds the panel", () => {
  const composer = '<div data-conversation-reply-composer-root id="reply-root"></div>';
  const win = load({ composer, parts: [part("1", [fa.attachmentUpload({ filename: "a.pdf", href: HREF })])] });
  const root = win.getIntercomRoot();
  if (win.ISA_ATTACHMENTS_ADAPTER.getController()) {
    root.querySelector('[data-testid="conversation-header"]').outerHTML = '<div data-testid="conversation-header" data-conversation-id="100"></div>';
    win.refreshIntercomAttachments();
    root.querySelector('[data-testid="conversation-header"]').outerHTML = fa.attachmentConversationHeader({ conversationId: "100" });
  }
  assert.equal(root.querySelector('[data-testid="composer-orchestrator"]'), null);
  const seen = [];
  const create = win.ISA_ATTACHMENTS.createAttachmentPanel;
  win.ISA_ATTACHMENTS.createAttachmentPanel = options => { seen.push(options.composerBoundary); return create(options); };
  win.refreshIntercomAttachments();
  assert.equal(seen.length, 1);
  assert.equal(seen[0] && seen[0].id, "reply-root");
});

test("the mounted header cluster is claimed for this install", () => {
  const win = load({ parts: [part("1", [fa.attachmentUpload({ filename: "a.pdf", href: HREF })])] });
  win.refreshIntercomAttachments();
  const button = win.getIntercomRoot().querySelector(".isa-attachments-button");
  assert.ok(button.parentElement.getAttribute("data-isa-attachments-owner"));
});
