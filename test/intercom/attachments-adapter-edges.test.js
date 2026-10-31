"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadExtension } = require("../support/helpers");
const fx = require("../support/fixtures");
const fa = require("../support/fixtures-attachments");

function inboxUrl(conversationId, segment = "conversation") {
  return `https://app.intercom.com/a/inbox/demo1234/inbox/${segment}/${conversationId}`;
}

function upload(filename, href) {
  const options = { filename };
  if (href !== undefined) options.href = href;
  return fa.attachmentUpload(options);
}

function part(entityId, uploads, index = 1) {
  return fa.attachmentMessagePart({ entityId, partId: `p${entityId}`, index, uploads });
}

function load({ id = "100", url = inboxUrl(id), header, parts = [], stream = fa.attachmentStream(parts), extra = "" } = {}) {
  const head = header !== undefined ? header : fa.attachmentConversationHeader({ conversationId: id });
  const win = loadExtension(fx.inboxHtml({ conversation: [head, stream, extra].join("\n"), composer: fa.attachmentComposer() }), { url });
  return win;
}

function records(win) {
  const controller = win.ISA_ATTACHMENTS_ADAPTER.getController();
  return controller ? controller.getRecords() : [];
}

function names(win) {
  return Array.from(records(win).map(record => record.filename));
}

function mounted(win) {
  return win.getIntercomRoot().querySelector(".isa-attachments-button");
}

function switchTo(win, id, parts) {
  const root = win.getIntercomRoot();
  root.querySelector('[data-testid="conversation-header"]').outerHTML =
    fa.attachmentConversationHeader({ conversationId: id });
  root.querySelector('[data-testid="conversation-stream-scroll-container"]').outerHTML = fa.attachmentStream(parts);
  win.history.replaceState({}, "", inboxUrl(id));
  win.refreshIntercomAttachments();
}

function visit(win, id, filename) {
  switchTo(win, id, [part(`e${id}`, [upload(filename)])]);
}

test("javascript: and data: upload hrefs yield records with an empty href and no panel link", () => {
  const win = load({
    parts: [part("1", [
      upload("js.pdf", "javascript:alert(1)"),
      upload("data.pdf", "data:text/html,x")
    ])]
  });

  win.refreshIntercomAttachments();

  const found = Array.from(records(win));
  assert.deepEqual(found.map(record => record.filename), ["js.pdf", "data.pdf"]);
  for (const record of found) assert.equal(record.href, "");
  win.ISA_ATTACHMENTS_ADAPTER.getController().open();
  const hrefs = Array.from(win.document.querySelectorAll(".isa-attachment-download")).map(link => link.getAttribute("href"));
  assert.deepEqual(hrefs, []);
});

test("an uppercase HTTPS scheme keeps its href", () => {
  const win = load({ parts: [part("1", [upload("up.pdf", "HTTPS://example.com/a.pdf")])] });

  win.refreshIntercomAttachments();

  assert.equal(records(win)[0].href.toLowerCase(), "https://example.com/a.pdf");
  assert.ok(records(win)[0].href.length > 0);
  win.ISA_ATTACHMENTS_ADAPTER.getController().open();
  const link = win.document.querySelector(".isa-attachment-download");
  assert.ok(link);
  assert.equal(link.getAttribute("href").toLowerCase(), "https://example.com/a.pdf");
});

test("two uploads with the same filename in one part yield two records", () => {
  const win = load({ parts: [part("1", [upload("same.pdf"), upload("same.pdf")])] });

  win.refreshIntercomAttachments();

  assert.deepEqual(names(win), ["same.pdf", "same.pdf"]);
});

test("a numeric data-index becomes the stream index", () => {
  const win = load({ parts: [part("1", [upload("a.pdf")], 12)] });

  win.refreshIntercomAttachments();

  assert.equal(records(win)[0].streamIndex, 12);
});

test("a non-numeric data-index never yields NaN as the stream index", () => {
  const win = load({ parts: [part("1", [upload("a.pdf")], "x")] });

  win.refreshIntercomAttachments();

  assert.equal(records(win).length, 1);
  assert.equal(Number.isNaN(records(win)[0].streamIndex), false);
});

for (const segment of ["conversations", "conversation"]) {
  test(`without a getConversationId global the id is read from the /${segment}/ route`, () => {
    const win = load({
      id: "123",
      url: inboxUrl("123", segment),
      parts: [part("1", [upload("a.pdf")])]
    });
    win.getConversationId = undefined;

    win.refreshIntercomAttachments();

    assert.ok(mounted(win));
    assert.deepEqual(names(win), ["a.pdf"]);
  });
}

function bareHeader(titleDepth) {
  const title = `<div data-inbox-conversation-header-title="true"><span>t</span></div>`;
  const inner = titleDepth === 1 ? `<div>${title}</div>` : `<div><div>${title}</div></div>`;
  return `<div data-testid="conversation-header" data-conversation-id="123">${inner}</div>`;
}

test("the title host mounts when the title parent is a direct child of the header", () => {
  const win = load({ id: "123", header: bareHeader(1), parts: [part("1", [upload("a.pdf")])] });

  win.refreshIntercomAttachments();

  assert.ok(mounted(win));
});

test("the title host does not mount when the title sits one level deeper", () => {
  const win = load({ id: "123", header: bareHeader(2), parts: [part("1", [upload("a.pdf")])] });

  win.refreshIntercomAttachments();

  assert.equal(mounted(win), null);
});

test("a conversation seen with 5 other conversations still lists its cached upload", () => {
  const win = load({ id: "1", parts: [part("e1", [upload("x.pdf")])] });
  win.refreshIntercomAttachments();
  for (const id of ["2", "3", "4", "5", "6"]) visit(win, id, `c${id}.pdf`);

  switchTo(win, "1", [part("e1b", [upload("fresh.pdf")])]);

  assert.ok(names(win).includes("x.pdf"));
  assert.ok(names(win).includes("fresh.pdf"));
});

test("a conversation seen with 6 other conversations loses its cached upload", () => {
  const win = load({ id: "1", parts: [part("e1", [upload("x.pdf")])] });
  win.refreshIntercomAttachments();
  for (const id of ["2", "3", "4", "5", "6", "7"]) visit(win, id, `c${id}.pdf`);

  switchTo(win, "1", [part("e1b", [upload("fresh.pdf")])]);

  assert.deepEqual(names(win), ["fresh.pdf"]);
});

test("revisiting a conversation makes it most recent in the cache", () => {
  const win = load({ id: "1", parts: [part("e1", [upload("x.pdf")])] });
  win.refreshIntercomAttachments();
  for (const id of ["2", "3", "4", "5", "6"]) visit(win, id, `c${id}.pdf`);
  switchTo(win, "1", [part("e1b", [upload("fresh.pdf")])]);
  assert.ok(names(win).includes("x.pdf"));
  for (const id of ["7", "8"]) visit(win, id, `c${id}.pdf`);

  switchTo(win, "1", [part("e1c", [upload("fresh.pdf")])]);
  assert.ok(names(win).includes("x.pdf"));

  switchTo(win, "2", [part("e2b", [upload("fresh2.pdf")])]);
  assert.equal(names(win).includes("c2.pdf"), false);
  assert.ok(names(win).includes("fresh2.pdf"));
});
