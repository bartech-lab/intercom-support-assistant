'use strict';

const assert = require("assert/strict");
const test = require("node:test");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");
const { unrefWindowTimers } = require("../support/helpers");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "..", "src", "intercom-attachments.js"), "utf8");
const HIGHLIGHT = "isa-attachment-message-highlight";

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

function fakeView(win, { width = 1024, height = 768 } = {}) {
  const timers = { set: [], cleared: [] };
  let next = 1;
  return {
    timers,
    innerWidth: width,
    innerHeight: height,
    setTimeout: (fn, delay) => { timers.set.push(delay); return next++; },
    clearTimeout: (id) => { timers.cleared.push(id); },
    addEventListener: win.addEventListener.bind(win),
    removeEventListener: win.removeEventListener.bind(win)
  };
}

function message(win) {
  const element = win.document.createElement("div");
  win.document.body.appendChild(element);
  return element;
}

function makePanel(win, { names = ["a.pdf"], view, composer } = {}) {
  const header = win.document.createElement("header");
  win.document.body.appendChild(header);
  const records = names.map(filename => ({ messageElement: message(win), filename, senderRole: "customer" }));
  const panel = win.ISA_ATTACHMENTS.createAttachmentPanel({
    document: win.document, window: view, headerHost: header, conversationId: "one", records, composer
  });
  return { panel, records };
}

function anchorAt(panel, rect) {
  panel.button.getBoundingClientRect = () => rect;
}

const px = value => Number(String(value).replace("px", ""));

test("an empty id or file name falls back to the index and the unnamed label", () => {
  const win = loadAttachments();
  const record = win.ISA_ATTACHMENTS.normalizeRecord({ id: "", filename: "" }, 4);
  assert.equal(record.id, "4");
  assert.equal(record.filename, "Unnamed attachment");
});

test("record text is trimmed and the sender role is read case-insensitively", () => {
  const win = loadAttachments();
  const record = win.ISA_ATTACHMENTS.normalizeRecord({ filename: "  report.pdf  ", senderRole: " Teammate " }, 0);
  assert.equal(record.filename, "report.pdf");
  assert.equal(record.senderRole, "teammate");
  assert.equal(record.senderLabel, "Team");
});

test("a non-object record and a non-array list normalize to empty values", () => {
  const win = loadAttachments();
  const record = win.ISA_ATTACHMENTS.normalizeRecord("x", 2);
  assert.deepEqual(JSON.parse(JSON.stringify(record.source)), {});
  assert.equal(record.id, "2");
  assert.deepEqual(Array.from(win.ISA_ATTACHMENTS.normalizeRecords("nope")), []);
});

test("a stream index is kept only when numeric", () => {
  const win = loadAttachments();
  assert.equal(win.ISA_ATTACHMENTS.normalizeRecord({ streamIndex: "3" }, 0).streamIndex, 3);
  assert.equal(win.ISA_ATTACHMENTS.normalizeRecord({ streamIndex: "abc" }, 0).streamIndex, null);
});

test("a download link is kept only for an http or https url at the start", () => {
  const win = loadAttachments();
  const href = value => win.ISA_ATTACHMENTS.normalizeRecord({ href: value }, 0).href;
  assert.equal(href("http://files.example.com/a.pdf"), "http://files.example.com/a.pdf");
  assert.equal(href("HTTPS://files.example.com/a.pdf"), "HTTPS://files.example.com/a.pdf");
  assert.equal(href("javascript:alert(1)//https://files.example.com"), "");
});

test("the panel stays inside the viewport when the anchor is above or right of it", () => {
  const win = loadAttachments();
  const { panel } = makePanel(win, { view: fakeView(win) });
  anchorAt(panel, { bottom: -50, right: 2000 });
  panel.open();
  assert.equal(px(panel.panel.style.top), 8);
  assert.equal(px(panel.panel.style.left), 1024 - 320 - 8);
});

test("the panel height stops above the composer", () => {
  const win = loadAttachments();
  const composer = { getBoundingClientRect: () => ({ top: 500 }) };
  const { panel } = makePanel(win, { view: fakeView(win), composer });
  anchorAt(panel, { bottom: 100, right: 600 });
  panel.open();
  assert.equal(px(panel.panel.style.top), 106);
  assert.equal(px(panel.panel.style.maxHeight), 500 - 106 - 8);
});

test("a destroyed panel does not open", () => {
  const win = loadAttachments();
  const { panel } = makePanel(win);
  panel.destroy();
  panel.open();
  assert.equal(panel.panel.hidden, true);
});

test("jumping to a second message moves the highlight and restarts its 2.4 s timer", () => {
  const win = loadAttachments();
  const view = fakeView(win);
  const { panel, records } = makePanel(win, { names: ["a.pdf", "b.pdf"], view });
  records.forEach(record => { record.messageElement.scrollIntoView = () => {}; });
  const rows = () => panel.list.querySelectorAll(".isa-attachment-row");
  panel.open();
  rows()[0].click();
  panel.open();
  rows()[1].click();
  assert.equal(records[0].messageElement.classList.contains(HIGHLIGHT), false);
  assert.equal(records[1].messageElement.classList.contains(HIGHLIGHT), true);
  assert.deepEqual(view.timers.set, [2400, 2400]);
  assert.deepEqual(view.timers.cleared, [1]);
});

test("Escape closes the panel and consumes the key", () => {
  const win = loadAttachments();
  const { panel } = makePanel(win);
  panel.open();
  const event = new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  panel.panel.dispatchEvent(event);
  assert.equal(panel.panel.hidden, true);
  assert.equal(event.defaultPrevented, true);
});

test("scrolling the page that contains the panel keeps it open", () => {
  const win = loadAttachments();
  const { panel } = makePanel(win);
  panel.open();
  win.document.body.dispatchEvent(new win.Event("scroll"));
  assert.equal(panel.panel.hidden, false);
  const pane = win.document.createElement("div");
  win.document.body.appendChild(pane);
  pane.dispatchEvent(new win.Event("scroll"));
  assert.equal(panel.panel.hidden, true);
});

test("new records for the same conversation keep the panel open and placed", () => {
  const win = loadAttachments();
  const { panel } = makePanel(win, { view: fakeView(win) });
  anchorAt(panel, { bottom: 100, right: 600 });
  panel.open();
  anchorAt(panel, { bottom: 200, right: 600 });
  panel.setRecords([{ messageElement: message(win), filename: "c.pdf" }], "one");
  assert.equal(panel.panel.hidden, false);
  assert.equal(px(panel.panel.style.top), 206);
});
