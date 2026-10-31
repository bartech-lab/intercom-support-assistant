'use strict';

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..", "..", "src");
const settled = () => new Promise(resolve => setTimeout(resolve, 0));

function load({ store = {}, signatureData, deferGet = false } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="isa-alert-settings"></div>
  </body></html>`, { url: "https://example.test/popup", runScripts: "outside-only" });
  const win = dom.window;
  const writes = [];
  const pendingReads = [];
  win.chrome = {
    runtime: { lastError: null },
    storage: {
      onChanged: { addListener() {} },
      local: {
        get(defaults, callback) {
          const result = {};
          Object.entries(defaults).forEach(([key, fallback]) => {
            result[key] = key in store ? store[key] : fallback;
          });
          if (deferGet) pendingReads.push(() => callback(result));
          else callback(result);
        },
        set(items, callback) {
          writes.push(items);
          Object.assign(store, items);
          if (callback) callback();
        }
      }
    }
  };
  win.SIGNATURE_DATA = signatureData;
  const ctx = dom.getInternalVMContext();
  for (const file of ["alert-sounds.js", "alert-settings-ui.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), ctx, { filename: file });
  }
  return { win, writes, store, pendingReads };
}

const rows = win => [...win.document.querySelectorAll("#isa-alert-settings [data-isa=\"inboxes\"] .isa-alert-inbox")]
  .filter(row => !row.querySelector("input[data-isa-your-inbox]"))
  .map(row => ({ value: row.querySelector("input").value, label: row.querySelector("span").textContent }));
const hintHidden = win => win.document.querySelector("#isa-alert-settings [data-isa=\"hint\"]").hidden;
const yourInbox = win => win.document.querySelector("#isa-alert-settings input[data-isa-your-inbox]");

const LABELS = [
  ["Urgent Germany", "Germany"],
  ["URGENT  Italy", "Italy"],
  ["Urgent Spain", "Spain"],
  ["Urgent Austria ", "Austria"],
  ["Germany Urgent ", "Germany Urgent"],
  ["Urgent ", "Urgent "]
];

test("L1: the Urgent prefix is stripped from inbox labels, case and spacing insensitive, trimmed, never emptied", async () => {
  const { win } = load({
    signatureData: {
      alertRoster: LABELS.map(([label], i) => ({ teamId: String(200 + i), label }))
    }
  });
  await settled();
  assert.deepEqual(rows(win).map(r => r.label), LABELS.map(([, shown]) => shown));
  win.close();
});

test("Y1: toggling Your inbox before settings load is ignored and the stored value wins", async () => {
  const { win, writes, store, pendingReads } = load({
    deferGet: true,
    store: { isaAlertYourInbox: false },
    signatureData: { alertRoster: [{ teamId: "1", label: "Urgent A" }] }
  });
  await settled();
  const box = yourInbox(win);
  box.disabled = false;
  box.click();
  assert.equal(writes.filter(w => "isaAlertYourInbox" in w).length, 0);
  assert.equal("isaAlertYourInbox" in store, true);
  assert.equal(store.isaAlertYourInbox, false);
  pendingReads.forEach(finish => finish());
  assert.equal(writes.filter(w => "isaAlertYourInbox" in w).length, 0);
  assert.equal(yourInbox(win).checked, false);
  win.close();
});

test("H1: the hint is shown when the roster is exactly the built-in fallback", async () => {
  const bare = load({ signatureData: { alertRoster: [] } });
  await settled();
  const fallbackRows = rows(bare.win);
  assert.ok(fallbackRows.length > 1);
  assert.equal(hintHidden(bare.win), false);
  bare.win.close();
  const same = load({
    signatureData: { alertRoster: [] },
    store: { isaAlertRoster: fallbackRows.map(r => ({ teamId: r.value, label: "Urgent " + r.label })) }
  });
  await settled();
  assert.equal(hintHidden(same.win), false);
  same.win.close();
});

test("H2: the hint is hidden when a retired fallback inbox is replaced by a real one at the same position", async () => {
  const { win } = load({
    signatureData: { alertRoster: [], retiredAlertInboxIds: ["900101"] },
    store: { isaAlertRoster: [{ teamId: "900001", label: "Urgent Other" }] }
  });
  await settled();
  assert.deepEqual(rows(win).map(r => r.value), ["900102", "900001"]);
  assert.equal(hintHidden(win), true);
  win.close();
});

test("H3: the hint is shown when every fallback inbox is retired and nothing is stored", async () => {
  const { win } = load({
    signatureData: { alertRoster: [], retiredAlertInboxIds: ["900101", "900102"] }
  });
  await settled();
  assert.equal(rows(win).length, 0);
  assert.equal(hintHidden(win), false);
  win.close();
});
