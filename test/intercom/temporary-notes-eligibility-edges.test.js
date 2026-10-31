"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "..", "src", "intercom-temporary-notes.js"), "utf8");

function load() {
  const context = vm.createContext({ console });
  context.window = context;
  vm.runInContext(SOURCE, context, { filename: "intercom-temporary-notes.js" });
  return context.ISA_TEMPORARY_NOTES;
}

const T = load();
const CREATED = Date.parse("2026-09-08T13:00:00.000Z");
const EXP = "2026-10-08T13:00:00.000Z";
const EXP_MS = Date.parse(EXP);
const footer = { workspaceId: "w1", contactId: "c1", expiresAt: EXP, token: "t1" };

function makeNote(over = {}) {
  return { id: "note-1", contactId: "c1", body: T.appendFooter("hello", footer), createdAt: CREATED, ...over };
}

function makeContext(over = {}) {
  return { workspaceId: "w1", contactId: "c1", serverNow: EXP_MS + 1, ...over };
}

function noContact(over = {}) {
  const note = makeNote(over);
  delete note.contactId;
  return note;
}

test("baseline: expired owned note is eligible", () => {
  const result = T.evaluateEligibility(makeNote(), makeContext());
  assert.equal(result.eligible, true);
  assert.equal(result.reason, "expired");
});

test("EL1: serverNow 1 ms before createdAt gives server-time-before-creation", () => {
  const result = T.evaluateEligibility(makeNote(), makeContext({ serverNow: CREATED - 1 }));
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "server-time-before-creation");
});

test("EL1: serverNow equal to createdAt with future expiry gives not-expired", () => {
  const result = T.evaluateEligibility(makeNote(), makeContext({ serverNow: CREATED }));
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "not-expired");
});

test("EL2: contactNoteIds without the note id gives missing-ownership", () => {
  const result = T.evaluateEligibility(noContact(), makeContext({ contactNoteIds: ["other"] }));
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "missing-ownership");
});

test("EL2: contactNoteIds containing the note id establishes ownership", () => {
  const result = T.evaluateEligibility(noContact(), makeContext({ contactNoteIds: ["note-1"] }));
  assert.equal(result.eligible, true);
  assert.equal(result.reason, "expired");
});

test("EL2: numeric note id 42 matches contactNoteIds entry \"42\"", () => {
  const note = noContact({ id: 42 });
  const hit = T.evaluateEligibility(note, makeContext({ contactNoteIds: ["42"] }));
  assert.equal(hit.eligible, true);
  assert.equal(hit.reason, "expired");
  const miss = T.evaluateEligibility(note, makeContext({ contactNoteIds: ["43"] }));
  assert.equal(miss.reason, "missing-ownership");
});

test("EL2: ownsNote true establishes ownership without contactId", () => {
  const result = T.evaluateEligibility(noContact(), makeContext({ ownsNote: true }));
  assert.equal(result.eligible, true);
  assert.equal(result.reason, "expired");
});

test("EL3: ownsNote must be exactly true", () => {
  for (const value of ["yes", 1]) {
    const result = T.evaluateEligibility(noContact(), makeContext({ ownsNote: value }));
    assert.equal(result.eligible, false, String(value));
    assert.equal(result.reason, "missing-ownership", String(value));
  }
});

test("EL4: differing expectedVersion gives stale-version", () => {
  const result = T.evaluateEligibility(makeNote({ version: 3 }), makeContext({ expectedVersion: 2 }));
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "stale-version");
});

test("EL4: equal expectedVersion continues evaluation", () => {
  const result = T.evaluateEligibility(makeNote({ version: 3 }), makeContext({ expectedVersion: 3 }));
  assert.equal(result.eligible, true);
  assert.equal(result.reason, "expired");
});

test("EL5: expectedUpdatedAt with missing note updatedAt gives stale-version", () => {
  const result = T.evaluateEligibility(makeNote(), makeContext({ expectedUpdatedAt: CREATED }));
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "stale-version");
});

test("EL5: unparseable expectedUpdatedAt gives stale-version even when note matches textually", () => {
  const result = T.evaluateEligibility(makeNote({ updatedAt: "garbage" }), makeContext({ expectedUpdatedAt: "garbage" }));
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "stale-version");
});

test("EL5: different instants give stale-version", () => {
  const result = T.evaluateEligibility(makeNote({ updatedAt: CREATED + 1 }), makeContext({ expectedUpdatedAt: CREATED }));
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "stale-version");
});

test("EL5: same instant as ISO string and millisecond number passes, including updated_at", () => {
  const iso = new Date(CREATED).toISOString();
  const camel = T.evaluateEligibility(makeNote({ updatedAt: iso }), makeContext({ expectedUpdatedAt: CREATED }));
  assert.equal(camel.eligible, true);
  assert.equal(camel.reason, "expired");
  const snake = T.evaluateEligibility(makeNote({ updated_at: CREATED }), makeContext({ expectedUpdatedAt: iso }));
  assert.equal(snake.eligible, true);
  assert.equal(snake.reason, "expired");
});

test("EL6: contactId wins over contact_id", () => {
  const ok = T.evaluateEligibility(makeNote({ contactId: "c1", contact_id: "zzz" }), makeContext());
  assert.equal(ok.eligible, true);
  assert.equal(ok.reason, "expired");
  const swapped = T.evaluateEligibility(makeNote({ contactId: "zzz", contact_id: "c1" }), makeContext());
  assert.equal(swapped.eligible, false);
  assert.equal(swapped.reason, "ownership-mismatch");
});

test("EL6: createdAt wins over created_at", () => {
  const later = makeNote({ createdAt: CREATED, created_at: EXP_MS + 10 });
  assert.equal(T.evaluateEligibility(later, makeContext()).reason, "expired");
  const earlier = makeNote({ createdAt: EXP_MS + 10, created_at: CREATED });
  assert.equal(T.evaluateEligibility(earlier, makeContext()).reason, "server-time-before-creation");
});

test("EL7: createdAt in seconds behaves like milliseconds", () => {
  const seconds = Math.floor(CREATED / 1000);
  assert.equal(T.evaluateEligibility(makeNote({ createdAt: seconds }), makeContext()).reason, "expired");
  const before = T.evaluateEligibility(makeNote({ createdAt: seconds }), makeContext({ serverNow: CREATED - 1000 }));
  assert.equal(before.reason, "server-time-before-creation");
  const equal = T.evaluateEligibility(makeNote({ createdAt: seconds }), makeContext({ serverNow: seconds * 1000 }));
  assert.equal(equal.reason, "not-expired");
});

test("EL7: serverNow in seconds behaves like milliseconds", () => {
  const result = T.evaluateEligibility(makeNote(), makeContext({ serverNow: Math.floor(EXP_MS / 1000) + 1 }));
  assert.equal(result.eligible, true);
  assert.equal(result.reason, "expired");
});

test("EL7: serverNow exactly 100000000000 is milliseconds", () => {
  const result = T.evaluateEligibility(makeNote({ createdAt: 900045045597 }), makeContext({ serverNow: 100000000000 }));
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "server-time-before-creation");
});

test("EL7: createdAt exactly 100000000000 is milliseconds", () => {
  const same = T.evaluateEligibility(makeNote({ createdAt: 100000000000 }), makeContext({ serverNow: 100000000000 }));
  assert.equal(same.reason, "not-expired");
});

test("EL7: createdAt 90090105085 is seconds", () => {
  const result = T.evaluateEligibility(makeNote({ createdAt: 90090105085 }), makeContext({ serverNow: 100000000000 }));
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "server-time-before-creation");
});

test("EL8: normalizeInstant rejects a nonexistent calendar date", () => {
  assert.equal(T.normalizeInstant("2026-02-30T00:00:00.000Z"), null);
});

test("EL8: normalizeInstant returns timestamp and iso for a real instant", () => {
  const input = "2026-02-28T00:00:00.000Z";
  const result = T.normalizeInstant(input);
  assert.equal(result.iso, input);
  assert.equal(result.timestamp, Date.parse(input));
});

test("EL9: parseMarker rejects a marker whose expires is a nonexistent date", () => {
  const marker = T.buildMarker(footer);
  assert.equal(typeof marker, "string");
  assert.notEqual(T.parseMarker(marker), null);
  const edited = marker.replace(EXP, "2026-02-30T00:00:00.000Z");
  assert.notEqual(edited, marker);
  assert.equal(T.parseMarker(edited), null);
});
