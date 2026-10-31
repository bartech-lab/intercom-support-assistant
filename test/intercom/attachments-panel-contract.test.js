'use strict';

const assert = require("assert/strict");
const test = require("node:test");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");
const { unrefWindowTimers } = require("../support/helpers");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "..", "src", "intercom-attachments.js"), "utf8");

function loadAttachments() {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    url: "https://app.intercom.com/a/inbox/team/123/conversation/456",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  unrefWindowTimers(dom.window);
  vm.runInContext(SOURCE, dom.getInternalVMContext(), { filename: "intercom-attachments.js" });
  return dom.window;
}

function makeRecord(win, filename) {
  const messageElement = win.document.createElement("div");
  win.document.body.appendChild(messageElement);
  return { messageElement, filename, senderRole: "customer", date: "3d", size: "10 KB" };
}

function makePanel(win, names, headerHost) {
  const header = headerHost || win.document.createElement("header");
  if (!headerHost) win.document.body.appendChild(header);
  return win.ISA_ATTACHMENTS.createAttachmentPanel({
    headerHost: header,
    conversationId: "one",
    records: names.map(name => makeRecord(win, name))
  });
}

function press(win, target, key) {
  const event = new win.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

test("the toggle starts collapsed and its dialog panel starts hidden", () => {
  const win = loadAttachments();
  const controller = makePanel(win, ["one.pdf"]);

  assert.equal(controller.button.getAttribute("aria-haspopup"), "dialog");
  assert.equal(controller.button.getAttribute("aria-expanded"), "false");
  assert.equal(controller.panel.getAttribute("role"), "dialog");
  assert.equal(controller.panel.getAttribute("aria-label"), "Attachments");
  assert.equal(controller.panel.hidden, true);
});

test("the panel close button is labelled Close attachments", () => {
  const win = loadAttachments();
  const controller = makePanel(win, ["one.pdf"]);

  const close = controller.panel.querySelector(".isa-attachment-panel-close");
  assert.ok(close);
  assert.equal(close.getAttribute("aria-label"), "Close attachments");
});

test("clicking the close button hides the panel and collapses the toggle", () => {
  const win = loadAttachments();
  const controller = makePanel(win, ["one.pdf"]);

  controller.open();
  assert.equal(controller.panel.hidden, false);
  assert.equal(controller.button.getAttribute("aria-expanded"), "true");
  controller.panel.querySelector("[aria-label=\"Close attachments\"]").click();

  assert.equal(controller.panel.hidden, true);
  assert.equal(controller.button.getAttribute("aria-expanded"), "false");
});

test("ArrowDown and ArrowUp move focus with wrap-around and prevent the default scroll", () => {
  const win = loadAttachments();
  const controller = makePanel(win, ["first.pdf", "second.pdf"]);
  controller.open();
  const rows = [...controller.list.querySelectorAll(".isa-attachment-row")];
  const close = controller.panel.querySelector(".isa-attachment-panel-close");

  close.focus();
  const wrapDown = press(win, close, "ArrowDown");
  assert.equal(win.document.activeElement, rows[0]);
  assert.equal(wrapDown.defaultPrevented, true);

  const down = press(win, rows[0], "ArrowDown");
  assert.equal(win.document.activeElement, rows[1]);
  assert.equal(down.defaultPrevented, true);

  const up = press(win, rows[1], "ArrowUp");
  assert.equal(win.document.activeElement, rows[0]);
  assert.equal(up.defaultPrevented, true);

  const wrapUp = press(win, rows[0], "ArrowUp");
  assert.equal(win.document.activeElement, close);
  assert.equal(wrapUp.defaultPrevented, true);
});

test("a panel mounted in a shadow root injects its own style element there", () => {
  const win = loadAttachments();
  const host = win.document.createElement("div");
  win.document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const header = win.document.createElement("header");
  shadow.appendChild(header);

  const controller = makePanel(win, ["one.pdf"], header);

  assert.equal(shadow.nodeType, 11);
  assert.ok(shadow.querySelector("style[data-isa-own=\"attachments\"]"));
  assert.ok(win.document.head.querySelector("style"));
  controller.destroy();
});

test("merging into the cache orders by order, then uploadIndex, then id", () => {
  const win = loadAttachments();

  const tied = win.isaAttachmentMergeCache("tie", [
    { id: "a", order: 1, uploadIndex: 1 },
    { id: "b", order: 1, uploadIndex: 0 }
  ]);
  assert.deepEqual(Array.from(tied, record => record.id), ["b", "a"]);

  const mixed = win.isaAttachmentMergeCache("mixed", [
    { id: "unordered", uploadIndex: 0 },
    { id: "z", order: 2, uploadIndex: 0 },
    { id: "y", order: 1, uploadIndex: 3 },
    { id: "x", order: 1, uploadIndex: 3 }
  ]);
  assert.deepEqual(Array.from(mixed, record => record.id), ["x", "y", "z", "unordered"]);
});
