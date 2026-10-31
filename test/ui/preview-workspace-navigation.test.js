"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadPreview } = require("../support/helpers");

const DATA = { companies: {}, teamSignature: "" };

function page({ toolsLink = true, signatures = "<section id=\"signatures\" data-workspace-section><button id=\"sigControl\">S</button></section>", settings = "<section id=\"settings\" data-workspace-section=\"settings\"><button id=\"settingsControl\">Setting</button></section>", tools = "<section id=\"tools\" data-workspace-section><button id=\"toolsControl\">Tool</button></section>", extra = "" } = {}) {
  return "<!doctype html><html><body>" +
    "<nav>" +
    "<a href=\"#signatures\" data-section=\"signatures\">Signatures</a>" +
    "<a href=\"#settings\" data-section=\"settings\">Settings</a>" +
    (toolsLink ? "<a href=\"#tools\" data-section=\"tools\">Tools</a>" : "") +
    "</nav>" + signatures + settings + tools + extra +
    "<div id=\"status\"></div><div id=\"errorMessage\"></div><div id=\"content\"></div>" +
    "</body></html>";
}

function start(win, hash = "#signatures") {
  win.history.replaceState(null, "", `/preview${hash}`);
  win.SIGNATURE_DATA = DATA;
  win.init();
}

function link(win, section) {
  return win.document.querySelector(`a[data-section="${section}"]`);
}

function click(win, section) {
  link(win, section).dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
}

function spyFocus(win, el) {
  const calls = [];
  const original = win.HTMLElement.prototype.focus;
  el.focus = function focus(options) {
    calls.push(options);
    return original.call(this, options);
  };
  return calls;
}

function navigateByEvent(win, type, hash) {
  win.history.replaceState(null, "", `/preview${hash}`);
  const Ctor = type === "popstate" ? win.PopStateEvent : win.HashChangeEvent;
  win.dispatchEvent(new Ctor(type));
}

function setViewport(win, { scrollY, root, body }) {
  Object.defineProperty(win, "scrollY", { value: scrollY, configurable: true, writable: true });
  win.document.documentElement.scrollTop = root;
  win.document.body.scrollTop = body;
}

const UNTOUCHED = (el) => !el.hidden && !el.classList.contains("hidden") && !el.hasAttribute("aria-hidden");

test("duplicate claimants: id match wins over document order, first claimant wins when no id matches", () => {
  const win = loadPreview(page({
    settings: "<div id=\"settingsFirst\" data-workspace-section=\"settings\"></div><section id=\"settings\" data-workspace-section=\"settings\"></section>",
    tools: "<div id=\"toolsA\" data-workspace-section=\"tools\"></div><div id=\"toolsB\" data-workspace-section=\"tools\"></div>"
  }));
  start(win, "#signatures");
  const doc = win.document;
  const [settingsFirst, settings, toolsA, toolsB] = ["settingsFirst", "settings", "toolsA", "toolsB"].map((id) => doc.getElementById(id));

  assert.equal(settings.hidden, true);
  assert.equal(toolsA.hidden, true);
  assert.ok(UNTOUCHED(settingsFirst));
  assert.ok(UNTOUCHED(toolsB));

  click(win, "settings");
  assert.equal(settings.hidden, false);
  assert.equal(settings.getAttribute("aria-hidden"), "false");
  assert.ok(UNTOUCHED(settingsFirst));

  click(win, "tools");
  assert.equal(toolsA.hidden, false);
  assert.equal(settings.hidden, true);
  assert.ok(UNTOUCHED(toolsB));
  assert.ok(UNTOUCHED(settingsFirst));

  click(win, "signatures");
  assert.equal(toolsA.hidden, true);
  assert.ok(UNTOUCHED(toolsB));
});

test("an element with an empty data-workspace-section and id tools shows and hides as the tools section", () => {
  const win = loadPreview(page({
    tools: "<div id=\"toolsDecoy\"></div><section id=\"tools\" data-workspace-section=\"\"></section>"
  }));
  start(win, "#signatures");
  const tools = win.document.getElementById("tools");
  assert.equal(tools.hidden, true);
  click(win, "tools");
  assert.equal(tools.hidden, false);
  assert.equal(win.document.getElementById("signatures").hidden, true);
  assert.ok(UNTOUCHED(win.document.getElementById("toolsDecoy")));
});

test("hidden property, hidden class and aria-hidden flip together on a switch and back", () => {
  const win = loadPreview(page());
  start(win, "#signatures");
  const state = (name) => {
    const el = win.document.getElementById(name);
    return [el.hidden, el.classList.contains("hidden"), el.getAttribute("aria-hidden")];
  };
  assert.deepEqual(state("signatures"), [false, false, "false"]);
  assert.deepEqual(state("settings"), [true, true, "true"]);
  assert.deepEqual(state("tools"), [true, true, "true"]);

  click(win, "settings");
  assert.deepEqual(state("signatures"), [true, true, "true"]);
  assert.deepEqual(state("settings"), [false, false, "false"]);
  assert.deepEqual(state("tools"), [true, true, "true"]);

  click(win, "signatures");
  assert.deepEqual(state("signatures"), [false, false, "false"]);
  assert.deepEqual(state("settings"), [true, true, "true"]);
});

test("focus inside the leaving section moves to the target link with preventScroll", () => {
  const win = loadPreview(page());
  start(win, "#settings");
  const target = link(win, "signatures");
  const calls = spyFocus(win, target);
  win.document.getElementById("settingsControl").focus();
  click(win, "signatures");
  assert.equal(win.document.activeElement, target);
  assert.equal(calls.length, 1);
  assert.deepEqual({ ...calls[0] }, { preventScroll: true });
});

test("a target section without a nav link gets tabindex -1 and focus; an existing tabindex is kept", () => {
  const bare = loadPreview(page({ toolsLink: false }));
  start(bare, "#settings");
  const tools = bare.document.getElementById("tools");
  const calls = spyFocus(bare, tools);
  bare.document.getElementById("settingsControl").focus();
  navigateByEvent(bare, "hashchange", "#tools");
  assert.equal(tools.hidden, false);
  assert.equal(tools.getAttribute("tabindex"), "-1");
  assert.equal(bare.document.activeElement, tools);
  assert.equal(calls.length, 1);
  assert.deepEqual({ ...calls[0] }, { preventScroll: true });

  const keep = loadPreview(page({
    toolsLink: false,
    tools: "<section id=\"tools\" data-workspace-section tabindex=\"0\"><button id=\"toolsControl\">Tool</button></section>"
  }));
  start(keep, "#settings");
  keep.document.getElementById("settingsControl").focus();
  navigateByEvent(keep, "hashchange", "#tools");
  const keptTools = keep.document.getElementById("tools");
  assert.equal(keptTools.getAttribute("tabindex"), "0");
  assert.equal(keep.document.activeElement, keptTools);
});

test("focus on body or on an element outside every section does not move", () => {
  const body = loadPreview(page());
  start(body, "#settings");
  body.document.activeElement.blur();
  assert.equal(body.document.activeElement, body.document.body);
  click(body, "tools");
  assert.equal(body.document.activeElement, body.document.body);

  const outside = loadPreview(page({ extra: "<button id=\"outside\">Out</button>" }));
  start(outside, "#settings");
  const button = outside.document.getElementById("outside");
  button.focus();
  assert.equal(outside.document.activeElement, button);
  click(outside, "tools");
  assert.equal(outside.document.activeElement, button);
  assert.equal(outside.document.getElementById("tools").hidden, false);
});

test("clicking the current section's link pushes no history and focuses the link with preventScroll", () => {
  const win = loadPreview(page());
  start(win, "#settings");
  const current = link(win, "settings");
  const calls = spyFocus(win, current);
  const length = win.history.length;
  click(win, "settings");
  assert.equal(win.history.length, length);
  assert.equal(win.location.hash, "#settings");
  assert.equal(win.document.activeElement, current);
  assert.equal(calls.length, 1);
  assert.deepEqual({ ...calls[0] }, { preventScroll: true });
  assert.equal(win.document.getElementById("settings").hidden, false);
});

test("viewport scroll is remembered from document.body.scrollTop alone and restored to body and documentElement", () => {
  const win = loadPreview(page());
  start(win, "#settings");
  setViewport(win, { scrollY: 0, root: 0, body: 175 });
  click(win, "tools");
  setViewport(win, { scrollY: 0, root: 0, body: 0 });
  click(win, "settings");
  assert.equal(win.document.body.scrollTop, 175);
  assert.equal(win.document.documentElement.scrollTop, 175);
});

test("viewport scroll ignores a non-numeric window.scrollY and uses the largest numeric source", () => {
  const win = loadPreview(page());
  start(win, "#settings");
  setViewport(win, { scrollY: undefined, root: 60, body: 90 });
  click(win, "tools");
  setViewport(win, { scrollY: 0, root: 0, body: 0 });
  click(win, "settings");
  assert.equal(win.document.body.scrollTop, 90);
  assert.equal(win.document.documentElement.scrollTop, 90);

  click(win, "signatures");
  setViewport(win, { scrollY: 400, root: 60, body: 90 });
  click(win, "tools");
  click(win, "signatures");
  assert.equal(win.document.body.scrollTop, 400);
  assert.equal(win.document.documentElement.scrollTop, 400);
});

test("element scrollTop is remembered per section and a never-visited section opens at 0", () => {
  const win = loadPreview(page());
  start(win, "#signatures");
  const doc = win.document;
  const [signatures, settings, tools] = ["signatures", "settings", "tools"].map((id) => doc.getElementById(id));
  signatures.scrollTop = 11;
  click(win, "settings");
  settings.scrollTop = 22;
  tools.scrollTop = 999;
  click(win, "signatures");
  assert.equal(signatures.scrollTop, 11);
  click(win, "settings");
  assert.equal(settings.scrollTop, 22);
  click(win, "tools");
  assert.equal(tools.scrollTop, 0);
});

test("history.scrollRestoration is manual after start", () => {
  const win = loadPreview(page());
  win.history.scrollRestoration = "auto";
  assert.equal(win.history.scrollRestoration, "auto");
  start(win, "#signatures");
  assert.equal(win.history.scrollRestoration, "manual");
});

test("hashchange to a wrongly cased or unknown hash is normalised in place and shows the right section", () => {
  const win = loadPreview(page());
  start(win, "#signatures");
  const length = win.history.length;

  navigateByEvent(win, "hashchange", "#TOOLS");
  assert.equal(win.location.hash, "#tools");
  assert.equal(win.history.length, length);
  assert.equal(win.document.getElementById("tools").hidden, false);
  assert.equal(win.document.getElementById("signatures").hidden, true);

  navigateByEvent(win, "hashchange", "#bogus");
  assert.equal(win.location.hash, "#signatures");
  assert.equal(win.history.length, length);
  assert.equal(win.document.getElementById("signatures").hidden, false);
  assert.equal(win.document.getElementById("tools").hidden, true);

  navigateByEvent(win, "popstate", "#Settings");
  assert.equal(win.location.hash, "#settings");
  assert.equal(win.history.length, length);
  assert.equal(win.document.getElementById("settings").hidden, false);
  assert.equal(win.document.getElementById("signatures").hidden, true);
});

test("starting twice reuses the first instance: one click pushes one entry and switches once", () => {
  const win = loadPreview(page());
  start(win, "#settings");
  win.init();
  const target = link(win, "signatures");
  const focusCalls = spyFocus(win, target);
  let pushes = 0;
  const realPush = win.history.pushState.bind(win.history);
  win.history.pushState = (...args) => { pushes += 1; return realPush(...args); };
  const length = win.history.length;
  win.document.getElementById("settingsControl").focus();
  click(win, "signatures");
  assert.equal(pushes, 1);
  assert.equal(win.history.length, length + 1);
  assert.equal(focusCalls.length, 1);
  assert.equal(win.document.getElementById("signatures").hidden, false);
  assert.equal(win.document.getElementById("settings").hidden, true);
});

test("an empty data-workspace-section takes its id, so an earlier tools element is not a signatures claimant", () => {
  const win = loadPreview(page({
    signatures: "<div id=\"tools\" data-workspace-section=\"\"></div><section id=\"signatures\"></section>",
    tools: ""
  }));
  start(win, "#signatures");
  const doc = win.document;
  const tools = doc.getElementById("tools");
  const signatures = doc.getElementById("signatures");
  assert.equal(signatures.hidden, false);
  assert.equal(tools.hidden, true);

  click(win, "tools");
  assert.equal(tools.hidden, false);
  assert.equal(signatures.hidden, true);

  click(win, "signatures");
  assert.equal(signatures.hidden, false);
  assert.equal(tools.hidden, true);
});

test("starting twice with focus on body: one click pushes one entry and never focuses the link", () => {
  const win = loadPreview(page());
  start(win, "#signatures");
  win.init();
  win.document.activeElement.blur();
  assert.equal(win.document.activeElement, win.document.body);
  const settingsLink = link(win, "settings");
  const focusCalls = spyFocus(win, settingsLink);
  const length = win.history.length;
  click(win, "settings");
  assert.equal(win.document.getElementById("settings").hidden, false);
  assert.equal(win.history.length, length + 1);
  assert.equal(focusCalls.length, 0);
  assert.equal(win.document.activeElement, win.document.body);
});
