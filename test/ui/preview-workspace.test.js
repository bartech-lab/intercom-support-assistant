"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadPreview } = require("../support/helpers");

const CONFIG = { english: "--<br>Best regards", german: "", french: "", italian: "", portuguese: "", spanish: "", dutch: "", emoji: "" };

function workspaceHtml({ toolsLink = true, extra = "" } = {}) {
  return "<!doctype html><html><body>" +
    "<nav>" +
    "<a href=\"#signatures\" data-section=\"signatures\">Signatures</a>" +
    "<a href=\"#settings\" data-section=\"settings\">Settings</a>" +
    (toolsLink ? "<a href=\"#tools\" data-section=\"tools\">Tools</a>" : "") +
    "</nav>" +
    "<section id=\"signatures\" data-workspace-section><div id=\"status\"></div><div id=\"errorMessage\"></div>" +
    "<div id=\"content\"><input id=\"searchInput\"><span id=\"resultCount\"></span><p id=\"searchEmpty\" hidden></p>" +
    "<div id=\"companyGrid\"></div><div id=\"teamGrid\"></div>" +
    "<span id=\"companyCount\"></span><span id=\"teamCount\"></span></div>" +
    "<p id=\"copyStatus\" aria-live=\"polite\"></p></section>" +
    "<section id=\"settings\" data-workspace-section=\"settings\"><button id=\"settingsControl\">Setting</button></section>" +
    "<section id=\"tools\" data-workspace-section><button id=\"toolsControl\">Tool</button></section>" +
    extra +
    "</body></html>";
}

function start(win, hash = "", data = { companies: {}, teamSignature: "" }) {
  win.history.replaceState(null, "", `/preview${hash}`);
  win.SIGNATURE_DATA = data;
  win.init();
}

function click(win, section) {
  win.document.querySelector(`a[data-section="${section}"]`).dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
}

function visible(el) {
  return !el.classList.contains("hidden");
}

test("search matches case-insensitively and hides non-matching cards", () => {
  const win = loadPreview(workspaceHtml());
  start(win, "#signatures", { companies: { "Alpha Corp": CONFIG, "Gamma Ltd": CONFIG }, teamSignature: "" });
  const cards = [...win.document.querySelectorAll(".company-card")];
  assert.equal(cards.length, 2);
  const gamma = cards.find((card) => /gamma/i.test(card.dataset.name || card.textContent));
  const alpha = cards.find((card) => card !== gamma);

  const search = win.document.getElementById("searchInput");
  search.value = "GAMMA";
  search.dispatchEvent(new win.Event("input", { bubbles: true }));
  assert.equal(visible(gamma), true);
  assert.equal(visible(alpha), false);

  search.value = "ALPHA CO";
  search.dispatchEvent(new win.Event("input", { bubbles: true }));
  assert.equal(visible(alpha), true);
  assert.equal(visible(gamma), false);
});

test("section lookup prefers the id match and accepts id-only sections", () => {
  const html = workspaceHtml({ extra: "<div id=\"decoy\" data-workspace-section=\"settings\"></div>" })
    .replace("<section id=\"tools\" data-workspace-section>", "<section id=\"tools\">");
  const win = loadPreview(html.replace("<section id=\"settings\"", "<div id=\"first\" data-workspace-section=\"settings\"></div><section id=\"settings\""));
  start(win, "#signatures");
  const doc = win.document;
  const first = doc.getElementById("first");
  const decoy = doc.getElementById("decoy");
  const settings = doc.getElementById("settings");
  const tools = doc.getElementById("tools");
  assert.equal(tools.hasAttribute("data-workspace-section"), false);
  assert.equal(tools.hidden, true);

  click(win, "settings");
  assert.equal(settings.hidden, false);
  assert.equal(first.hidden, false);
  assert.equal(decoy.hidden, false);
  assert.equal(first.hasAttribute("hidden"), false);

  click(win, "tools");
  assert.equal(tools.hidden, false);
  assert.equal(settings.hidden, true);
  assert.equal(first.hidden, false, "the non-id element is left alone");
  assert.equal(decoy.hidden, false, "the non-id element is left alone");

  click(win, "signatures");
  assert.equal(tools.hidden, true);
  assert.equal(doc.getElementById("signatures").hidden, false);
});

test("initial hash is normalised in place without growing history", () => {
  const upper = loadPreview(workspaceHtml());
  upper.history.replaceState(null, "", "/preview#SETTINGS");
  const before = upper.history.length;
  upper.SIGNATURE_DATA = { companies: {}, teamSignature: "" };
  upper.init();
  assert.equal(upper.location.hash, "#settings");
  assert.equal(upper.document.getElementById("settings").hidden, false);
  assert.equal(upper.document.getElementById("signatures").hidden, true);
  assert.equal(upper.history.length, before);

  for (const hash of ["#bogus", ""]) {
    const win = loadPreview(workspaceHtml());
    win.history.replaceState(null, "", `/preview${hash}`);
    const length = win.history.length;
    win.SIGNATURE_DATA = { companies: {}, teamSignature: "" };
    win.init();
    assert.equal(win.location.hash, "#signatures", hash || "no hash");
    assert.equal(win.document.getElementById("signatures").hidden, false);
    assert.equal(win.document.getElementById("settings").hidden, true);
    assert.equal(win.history.length, length, hash || "no hash");
  }
});

test("focus moves only when it would be lost, or is kept inside the shown section", () => {
  const win = loadPreview(workspaceHtml({ toolsLink: false }));
  start(win, "#settings");
  const doc = win.document;
  const settingsControl = doc.getElementById("settingsControl");
  const signaturesLink = doc.querySelector("a[data-section=\"signatures\"]");

  settingsControl.focus();
  assert.equal(doc.activeElement, settingsControl);
  click(win, "signatures");
  assert.equal(doc.activeElement, signaturesLink, "focus inside the hidden section moves to the new section nav link");

  const bare = loadPreview(workspaceHtml({ toolsLink: false }));
  start(bare, "#settings");
  bare.document.getElementById("settingsControl").focus();
  bare.__isaWorkspaceNavigation.apply("tools");
  assert.equal(bare.document.getElementById("tools").getAttribute("tabindex"), "-1");
  assert.equal(bare.document.activeElement, bare.document.getElementById("tools"));

  const keep = loadPreview(workspaceHtml({ toolsLink: false }).replace("<section id=\"tools\"", "<section id=\"tools\" tabindex=\"0\""));
  start(keep, "#settings");
  keep.document.getElementById("settingsControl").focus();
  keep.__isaWorkspaceNavigation.apply("tools");
  assert.equal(keep.document.getElementById("tools").getAttribute("tabindex"), "0");
  assert.equal(keep.document.activeElement, keep.document.getElementById("tools"));

  const body = loadPreview(workspaceHtml());
  start(body, "#settings");
  body.document.activeElement.blur();
  assert.equal(body.document.activeElement, body.document.body);
  click(body, "tools");
  assert.equal(body.document.activeElement, body.document.body);

  const inside = loadPreview(workspaceHtml());
  start(inside, "#settings");
  inside.document.getElementById("settingsControl").focus();
  inside.__isaWorkspaceNavigation.apply("settings");
  assert.equal(inside.document.activeElement, inside.document.getElementById("settingsControl"));
});

test("scroll positions are remembered per section and new sections open at the top", () => {
  const win = loadPreview(workspaceHtml());
  start(win, "#signatures");
  const doc = win.document;
  const settings = doc.getElementById("settings");
  const tools = doc.getElementById("tools");

  click(win, "settings");
  settings.scrollTop = 41;
  doc.documentElement.scrollTop = 230;
  click(win, "tools");
  assert.equal(tools.scrollTop, 0);
  assert.equal(doc.documentElement.scrollTop, 0, "an unseen section opens at viewport scroll 0");
  click(win, "settings");
  assert.equal(settings.scrollTop, 41);
  assert.equal(doc.documentElement.scrollTop, 230);
});

test("only the current nav link is marked active", () => {
  const win = loadPreview(workspaceHtml());
  start(win, "#signatures");
  const link = (name) => win.document.querySelector(`a[data-section="${name}"]`);
  const state = (name) => [link(name).getAttribute("aria-current"), link(name).classList.contains("active")];
  assert.deepEqual(state("signatures"), ["page", true]);
  assert.deepEqual(state("settings"), [null, false]);

  click(win, "settings");
  assert.deepEqual(state("settings"), ["page", true]);
  assert.deepEqual(state("signatures"), [null, false]);
  assert.deepEqual(state("tools"), [null, false]);

  click(win, "tools");
  assert.deepEqual(state("tools"), ["page", true]);
  assert.deepEqual(state("settings"), [null, false]);
  assert.equal(win.document.querySelectorAll("a[aria-current]").length, 1);
});
