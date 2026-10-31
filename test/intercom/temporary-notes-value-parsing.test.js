"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { spawnSync } = require("child_process");

const SOURCE_PATH = path.join(__dirname, "..", "..", "src", "intercom-temporary-notes.js");
const SOURCE = fs.readFileSync(SOURCE_PATH, "utf8");

let CONTEXT;

function load() {
  const context = vm.createContext({ console });
  context.window = context;
  vm.runInContext(SOURCE, context, { filename: "intercom-temporary-notes.js" });
  CONTEXT = context;
  return context.ISA_TEMPORARY_NOTES;
}

const T = load();
const EXP = "2026-10-08T13:00:00.000Z";

function marker(over = {}) {
  return T.buildMarker({ workspaceId: "w1", contactId: "c1", expiresAt: EXP, token: "t1", ...over });
}

test("V1: NaN workspaceId is not an identifier", () => {
  assert.equal(marker({ workspaceId: NaN }), null);
});

test("V1: Infinity contactId is not an identifier", () => {
  assert.equal(marker({ contactId: Infinity }), null);
});

test("V1: -Infinity token is not an identifier", () => {
  assert.equal(marker({ token: -Infinity }), null);
});

test("V1: finite numeric workspaceId 42 is accepted", () => {
  const result = marker({ workspaceId: 42 });
  assert.equal(typeof result, "string");
  assert.ok(result.includes("workspace=42"));
});

test("V2: serverNow Date before epoch gives missing-server-time", () => {
  const note = { id: "note-1", contactId: "c1", body: T.appendFooter("hello", { workspaceId: "w1", contactId: "c1", expiresAt: EXP, token: "t1" }), createdAt: Date.parse("2026-09-08T13:00:00.000Z") };
  const result = T.evaluateEligibility(note, { workspaceId: "w1", contactId: "c1", serverNow: vm.runInContext("new Date(-1000)", CONTEXT) });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "missing-server-time");
});

test("V2: serverNow ISO string before epoch gives missing-server-time", () => {
  const note = { id: "note-1", contactId: "c1", body: T.appendFooter("hello", { workspaceId: "w1", contactId: "c1", expiresAt: EXP, token: "t1" }), createdAt: Date.parse("2026-09-08T13:00:00.000Z") };
  const result = T.evaluateEligibility(note, { workspaceId: "w1", contactId: "c1", serverNow: "1969-12-31T23:59:59.000Z" });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "missing-server-time");
});

test("V2: buildMarker rejects pre-epoch expiresAt", () => {
  assert.equal(marker({ expiresAt: "1969-12-31T23:59:59.000Z" }), null);
});

const NOW_MS = 1700000000000;

function v3Note(expiresMs) {
  const expiresAt = new Date(expiresMs).toISOString();
  return {
    id: "note-1",
    contactId: "c1",
    body: T.appendFooter("hello", { workspaceId: "w1", contactId: "c1", expiresAt, token: "t1" }),
    createdAt: NOW_MS - 1000000
  };
}

function v3Eval(expiresMs, serverNow) {
  const result = T.evaluateEligibility(v3Note(expiresMs), { workspaceId: "w1", contactId: "c1", serverNow });
  return { eligible: result.eligible, reason: result.reason };
}

const V3_FORMS = [
  ["number seconds", 1700000000],
  ["string seconds", "1700000000"],
  ["padded string seconds", " 1700000000 "],
  ["number milliseconds", 1700000000000],
  ["string milliseconds", "1700000000000"],
  ["padded string milliseconds", " 1700000000000 "]
];

for (const [label, value] of V3_FORMS) {
  test("V3: serverNow " + label + " before expiry gives not-expired", () => {
    assert.deepEqual(v3Eval(NOW_MS + 1000, value), { eligible: false, reason: "not-expired" });
  });

  test("V3: serverNow " + label + " after expiry gives expired", () => {
    assert.deepEqual(v3Eval(NOW_MS - 1000, value), { eligible: true, reason: "expired" });
  });
}

const CHILD_SCRIPT = [
  'const fs = require("fs"); const vm = require("vm");',
  'const context = vm.createContext({ console });',
  'context.window = context;',
  'vm.runInContext(fs.readFileSync(process.env.ISA_SOURCE_PATH, "utf8"), context, { filename: "intercom-temporary-notes.js" });',
  'const T = context.ISA_TEMPORARY_NOTES;',
  'const out = {};',
  'for (const v of ["2026-03-29T02:30", "2026-03-29T03:30", "2026-02-30T10:00", "2026-10-25T02:30"]) out[v] = T.localMinuteToUtcIso(v);',
  'process.stdout.write(JSON.stringify(out));'
].join("\n");

function runWarsaw() {
  const env = { ...process.env, TZ: "Europe/Warsaw", ISA_SOURCE_PATH: SOURCE_PATH };
  const child = spawnSync(process.execPath, ["-e", CHILD_SCRIPT], { env, encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

test("V4: Warsaw spring-forward gap minute returns null", () => {
  assert.equal(runWarsaw()["2026-03-29T02:30"], null);
});

test("V4: Warsaw minute after the gap returns its UTC ISO string", () => {
  assert.equal(runWarsaw()["2026-03-29T03:30"], "2026-03-29T01:30:00.000Z");
});

test("V4: impossible calendar date returns null", () => {
  assert.equal(runWarsaw()["2026-02-30T10:00"], null);
});

test("V4: ambiguous fall-back minute returns an ISO string", () => {
  const value = runWarsaw()["2026-10-25T02:30"];
  assert.equal(typeof value, "string");
  assert.ok(["2026-10-25T00:30:00.000Z", "2026-10-25T01:30:00.000Z"].includes(value));
});

test("V5: marker alone at index 0 gives invalid-footer-layout", () => {
  const result = T.parseFooter(marker());
  assert.equal(result.valid, false);
  assert.equal(result.reason, "invalid-footer-layout");
  assert.deepEqual(Object.keys(result).sort(), ["reason", "valid"]);
});

test("V5: newline plus marker without readable line gives invalid-readable-deadline", () => {
  const result = T.parseFooter("\n" + marker());
  assert.equal(result.valid, false);
  assert.equal(result.reason, "invalid-readable-deadline");
  assert.deepEqual(Object.keys(result).sort(), ["reason", "valid"]);
});
