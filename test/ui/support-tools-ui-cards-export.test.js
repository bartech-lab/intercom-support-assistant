"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");
const { unrefWindowTimers } = require("../support/helpers");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "..", "src", "support-tools-ui.js"), "utf8");
const IDS = ["isa-support-tools", "isa-settings-backup", "isa-debug-flags"];

const settled = () => new Promise(resolve => setTimeout(resolve, 0));

const healthWith = overrides => Object.assign({
  checkedAt: "2026-09-14T10:05:00.000Z",
  extension: { name: "Intercom Support Assistant", version: "2.0.1" },
  browser: { chromeVersion: "141.0.0.0", userAgent: "test" },
  notificationLevel: "granted",
  tabsError: null,
  tabs: []
}, overrides);

function makeStore(initial) {
  const local = Object.assign({}, initial);
  const area = data => ({
    get(query, callback) {
      if (query === null || query === undefined) {
        callback(Object.assign({}, data));
        return;
      }
      const keys = Array.isArray(query) ? query : Object.keys(query);
      const picked = {};
      keys.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(data, key)) picked[key] = data[key];
      });
      callback(picked);
    },
    set(values, callback) {
      Object.keys(values).forEach((key) => { data[key] = values[key]; });
      if (callback) callback();
    }
  });
  return {
    local: area(local),
    session: area({}),
    onChanged: { addListener: () => {} },
    data: { local }
  };
}

async function loadUi({ expanded = null, responder = null } = {}) {
  const attr = expanded === null ? "" : ` data-isa-expanded="${expanded}"`;
  const markup = IDS.map(id => `<div id="${id}"${attr}></div>`).join("");
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${markup}</body></html>`, {
    url: "https://example.test/preview-page.html",
    runScripts: "outside-only"
  });
  const win = unrefWindowTimers(dom.window);
  const store = makeStore({ isaAlertEnabled: true });
  const runtime = {
    lastError: null,
    getManifest: () => ({ version: "2.0.1", name: "Intercom Support Assistant" }),
    sendMessage(message, callback) {
      callback(responder ? responder(message) : { ok: true, health: healthWith({}) });
    }
  };
  win.chrome = { runtime, storage: store };
  win.SIGNATURE_DATA = { companies: { "Marlowe Books": {} } };

  const saved = [];
  const blobs = new Map();
  win.URL.createObjectURL = (blob) => {
    const url = `blob:test-${blobs.size}`;
    blobs.set(url, blob);
    return url;
  };
  win.URL.revokeObjectURL = () => {};
  win.Blob = class Blob {
    constructor(parts) {
      this.text = parts.join("");
    }
  };
  win.HTMLAnchorElement.prototype.click = function click() {
    if (this.download) {
      const blob = blobs.get(this.href);
      saved.push({ filename: this.download, content: blob ? blob.text : "" });
    }
  };

  vm.runInContext(SOURCE, dom.getInternalVMContext(), { filename: "support-tools-ui.js" });
  await settled();

  const card = id => win.document.getElementById(id);
  return {
    win,
    runtime,
    store,
    saved,
    card,
    pick: (id, hook) => card(id).querySelector(`[data-isa="${hook}"]`),
    click: element => element.dispatchEvent(new win.MouseEvent("click", { bubbles: true })),
    api: () => win.ISA_SUPPORT_TOOLS
  };
}

const CONTEXT = { schema: 1, note: "a </b> b", nested: { list: [1, 2, 3] } };

const contextScript = (html, id) => html.match(new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`));

test("injectCaptureContext inserts the context script right after a head tag with attributes", async () => {
  const ui = await loadUi();
  const api = ui.api();
  const head = '<head lang="en" data-x="1">';
  const out = api.injectCaptureContext(`<html>${head}<title>t</title></head><body></body></html>`, CONTEXT);
  const script = contextScript(out, api.contextMetaId);

  assert.ok(script, out);
  assert.equal(out.slice(out.indexOf(head) + head.length, out.indexOf(script[0])).trim(), "");
  assert.ok(out.indexOf(script[0]) > out.indexOf(head));
  assert.ok(out.indexOf(script[0]) < out.indexOf("<title>"));
  assert.deepEqual(JSON.parse(script[1]), CONTEXT);
  assert.equal(out.split(`id="${api.contextMetaId}"`).length, 2);
});

test("injectCaptureContext prepends the script when there is no head tag", async () => {
  const ui = await loadUi();
  const api = ui.api();
  const html = "<div>no head here</div>";
  const out = api.injectCaptureContext(html, CONTEXT);
  const script = contextScript(out, api.contextMetaId);

  assert.ok(script, out);
  assert.equal(out.slice(0, out.indexOf(script[0])).trim(), "");
  assert.ok(out.endsWith(html));
  assert.equal(out.slice(out.indexOf(script[0]) + script[0].length).trim(), html);
  assert.deepEqual(JSON.parse(script[1]), CONTEXT);
});

for (const id of IDS) {
  test(`${id}: a card without data-isa-expanded starts collapsed and toggles both ways`, async () => {
    const ui = await loadUi();
    const toggle = ui.pick(id, "toggle");
    const chevron = ui.pick(id, "chevron");
    const body = ui.pick(id, "body");

    assert.equal(body.hasAttribute("hidden"), true);
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.equal(chevron.textContent, "Show");

    ui.click(toggle);
    assert.equal(body.hasAttribute("hidden"), false);
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    assert.equal(chevron.textContent, "Hide");

    ui.click(toggle);
    assert.equal(body.hasAttribute("hidden"), true);
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.equal(chevron.textContent, "Show");
  });

  test(`${id}: a card with data-isa-expanded="true" starts open and collapses on click`, async () => {
    const ui = await loadUi({ expanded: "true" });
    const toggle = ui.pick(id, "toggle");
    const chevron = ui.pick(id, "chevron");
    const body = ui.pick(id, "body");

    assert.equal(body.hasAttribute("hidden"), false);
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    assert.equal(chevron.textContent, "Hide");

    ui.click(toggle);
    assert.equal(body.hasAttribute("hidden"), true);
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.equal(chevron.textContent, "Show");

    ui.click(toggle);
    assert.equal(body.hasAttribute("hidden"), false);
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    assert.equal(chevron.textContent, "Hide");
  });
}

async function healthRow(notificationLevel, label) {
  const ui = await loadUi({
    expanded: "true",
    responder: () => ({ ok: true, health: healthWith({ notificationLevel }) })
  });
  ui.click(ui.pick("isa-support-tools", "check"));
  await settled();
  const rows = [...ui.pick("isa-support-tools", "result").querySelectorAll(".isa-st-lines li")];
  return rows.find(item => item.textContent.startsWith(label));
}

test("a granted Notifications value is marked ok and not bad", async () => {
  const cell = (await healthRow("granted", "Notifications")).children[1];

  assert.equal(cell.textContent, "granted");
  assert.equal(cell.classList.contains("isa-st-ok"), true);
  assert.equal(cell.classList.contains("isa-st-bad"), false);
});

test("a denied Notifications value is marked bad and not ok", async () => {
  const cell = (await healthRow("denied", "Notifications")).children[1];

  assert.equal(cell.classList.contains("isa-st-bad"), true);
  assert.equal(cell.classList.contains("isa-st-ok"), false);
});

test("a Build line without a tone carries neither ok nor bad", async () => {
  const cell = (await healthRow("granted", "Build")).children[1];

  assert.equal(cell.classList.contains("isa-st-ok"), false);
  assert.equal(cell.classList.contains("isa-st-bad"), false);
});

const failingGet = ui => (query, callback) => {
  ui.runtime.lastError = { message: "read-broke" };
  callback(undefined);
  ui.runtime.lastError = null;
};

test("export disables the button as Exporting... while reading and restores it after", async () => {
  const ui = await loadUi({ expanded: "true" });
  const button = ui.pick("isa-settings-backup", "export");
  assert.equal(button.textContent, "Export settings");
  const real = ui.store.local.get;
  const pending = [];
  ui.store.local.get = (query, callback) => { pending.push(() => real(query, callback)); };

  ui.click(button);
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, "Exporting...");
  assert.equal(ui.saved.length, 0);

  pending.forEach(run => run());
  await settled();
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "Export settings");
  assert.equal(ui.saved.length, 1);
});

test("export restores the button after a failed storage read and shows a note", async () => {
  const ui = await loadUi({ expanded: "true" });
  const button = ui.pick("isa-settings-backup", "export");
  ui.store.local.get = failingGet(ui);

  ui.click(button);
  await settled();
  await settled();

  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "Export settings");
  assert.equal(ui.saved.length, 0);
  assert.match(ui.pick("isa-settings-backup", "result").textContent, /read-broke/);
});

test("a new export clears the previous failure note", async () => {
  const ui = await loadUi({ expanded: "true" });
  const goodGet = ui.store.local.get;
  ui.store.local.get = failingGet(ui);
  ui.click(ui.pick("isa-settings-backup", "export"));
  await settled();
  await settled();
  assert.match(ui.pick("isa-settings-backup", "result").textContent, /read-broke/);

  ui.store.local.get = goodGet;
  ui.click(ui.pick("isa-settings-backup", "export"));
  await settled();
  await settled();

  assert.equal(/read-broke/.test(ui.card("isa-settings-backup").textContent), false);
  assert.equal(ui.saved.length, 1);
});

test("the exported payload lists skippedKeys equal to derivedKeys", async () => {
  const ui = await loadUi({ expanded: "true" });
  ui.click(ui.pick("isa-settings-backup", "export"));
  await settled();
  await settled();

  const derived = Array.from(ui.api().derivedKeys);
  assert.ok(derived.length > 0);
  assert.deepEqual(JSON.parse(ui.saved[0].content).skippedKeys, derived);
});

test("clicking Import resets the file input value before opening the picker", async () => {
  const ui = await loadUi({ expanded: "true" });
  const input = ui.pick("isa-settings-backup", "file");
  const seen = [];
  Object.defineProperty(input, "value", { value: "C:\\fakepath\\backup.json", writable: true, configurable: true });
  input.click = () => { seen.push(input.value); };

  ui.click(ui.pick("isa-settings-backup", "import"));

  assert.deepEqual(seen, [""]);
});
