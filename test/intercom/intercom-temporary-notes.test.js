'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'intercom-temporary-notes.js'), 'utf8');

function load() {
  const context = vm.createContext({ console });
  vm.runInContext(SOURCE, context, { filename: 'intercom-temporary-notes.js' });
  return context;
}

const SUBMITTED = '2026-09-08T13:00:00.000Z';
const EXPIRY = '2026-10-08T13:00:00.000Z';
const BASE_NOTE = {
  id: 'note-1',
  contactId: 'contact-1',
  createdAt: SUBMITTED,
  updatedAt: SUBMITTED
};

function temporaryBody(win, overrides = {}) {
  return win.appendAutoDeleteFooter('Private note', {
    workspaceId: overrides.workspaceId || 'workspace-1',
    contactId: overrides.contactId || 'contact-1',
    expiresAt: overrides.expiresAt || EXPIRY,
    token: overrides.token || 'token-1'
  });
}

const MINUTE_MS = 60000;
const DAY_MS = 86400000;
const MAX_MS = 3650 * DAY_MS;

test('delays accept whole milliseconds from one minute through 3650 days only', () => {
  const win = load();
  assert.equal(win.normalizeAutoDeleteDelayMs(MINUTE_MS), MINUTE_MS);
  assert.equal(win.normalizeAutoDeleteDelayMs(String(MAX_MS)), MAX_MS);
  assert.equal(win.normalizeAutoDeleteDelayMs(` ${DAY_MS} `), DAY_MS);
  for (const value of [MINUTE_MS - 1, MAX_MS + 1, 0, 1.5, '1.5', '', 'abc', Infinity, null]) {
    assert.equal(win.normalizeAutoDeleteDelayMs(value), null, String(value));
  }
});

test('unit delays convert hours, days, and weeks, and reject fractional, negative, and unknown units', () => {
  const win = load();
  assert.equal(win.autoDeleteDelayFromUnits('36', 'hours'), 36 * 60 * 60 * 1000);
  assert.equal(win.autoDeleteDelayFromUnits(2, 'days'), 2 * DAY_MS);
  assert.equal(win.autoDeleteDelayFromUnits('1', 'weeks'), 7 * DAY_MS);
  for (const [amount, unit] of [[0, 'hours'], [1.5, 'days'], [-1, 'days'], [1, 'minutes'], [1, ''], [522, 'weeks']]) {
    assert.equal(win.autoDeleteDelayFromUnits(amount, unit), null, `${amount} ${unit}`);
  }
});

test('every preset resolves to the delay its label claims', () => {
  const win = load();
  const presets = win.ISA_TEMPORARY_NOTES.presets;
  assert.deepEqual(Array.from(presets, preset => preset.label),
    ['1 hour', '4 hours', '12 hours', '1 day', '3 days', '7 days', '30 days', '90 days']);
  for (const preset of presets) {
    assert.equal(String(preset.delayMs), preset.id, preset.label);
    assert.equal(win.normalizeAutoDeleteDelayMs(preset.id), preset.delayMs, preset.label);
  }
  assert.equal(win.ISA_TEMPORARY_NOTES.defaultDelayMs, 30 * DAY_MS);
});

test('lifetimes are tagged, so a relative payload carrying an instant and an absolute payload carrying a delay both fail closed', () => {
  const win = load();
  assert.deepEqual(Object.assign({}, win.normalizeAutoDeleteLifetime({ mode: 'relative', delayMs: DAY_MS })),
    { mode: 'relative', delayMs: DAY_MS });
  assert.equal(win.normalizeAutoDeleteLifetime({ mode: 'relative', expiresAt: EXPIRY }), null);
  assert.equal(win.normalizeAutoDeleteLifetime({ mode: 'absolute', delayMs: DAY_MS }), null);
  assert.equal(win.normalizeAutoDeleteLifetime({ mode: 'relative', delayMs: DAY_MS, expiresAt: EXPIRY }), null);
});

test('a lifetime with no mode, an unknown mode, an extra key, an array, or null fails closed', () => {
  const win = load();
  for (const value of [null, undefined, [], 'relative', { delayMs: DAY_MS },
    { mode: 'weekly', delayMs: DAY_MS }, { mode: 'relative', delayMs: DAY_MS, extra: 1 }]) {
    assert.equal(win.normalizeAutoDeleteLifetime(value), null, JSON.stringify(value));
  }
});

test('absolute lifetimes require a millisecond UTC instant that round-trips through its own ISO form', () => {
  const win = load();
  const absolute = win.normalizeAutoDeleteLifetime({ mode: 'absolute', expiresAt: EXPIRY });
  assert.equal(absolute.expiresAt, EXPIRY);
  assert.equal(absolute.expiresAtMs, Date.parse(EXPIRY));
  for (const value of ['2026-10-08T13:00:00Z', '2026-10-08T13:00', '2026-13-08T13:00:00.000Z', Date.parse(EXPIRY)]) {
    assert.equal(win.normalizeAutoDeleteLifetime({ mode: 'absolute', expiresAt: value }), null, String(value));
  }
});

test('a local wall-clock minute converts to a UTC instant with zero seconds and milliseconds', () => {
  const win = load();
  const iso = win.localMinuteToUtcIso('2026-10-08T15:27');
  assert.match(iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
  assert.equal(win.formatLocalMinuteInput(iso), '2026-10-08T15:27');

  const previousTz = process.env.TZ;
  process.env.TZ = 'Europe/Warsaw';
  try {
    assert.equal(win.localMinuteToUtcIso('2026-10-08T15:27'), '2026-10-08T13:27:00.000Z',
      'a Warsaw summer-time minute is two hours ahead of UTC');
  } finally {
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  }
});

test('an overflow calendar date, a partially typed value, and a seconds-bearing value are rejected', () => {
  const win = load();
  for (const value of ['2026-02-30T10:00', '2026-13-01T10:00', '2026-10-08T24:00', '2026-10-08T10:60',
    '2026-10-08', '', '2026-10-08T10:00:30', '1969-12-31T23:59', null]) {
    assert.equal(win.localMinuteToUtcIso(value), null, String(value));
  }
});

test('resolving a relative lifetime uses the submission time, not the arm time', () => {
  const win = load();
  const armedAt = Date.parse('2026-09-08T13:00:00.000Z');
  const submittedAt = armedAt + 90 * 60 * 1000;
  const resolved = win.resolveAutoDeleteLifetime({ mode: 'relative', delayMs: 60 * 60 * 1000 }, submittedAt);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.expiresAt, new Date(submittedAt + 60 * 60 * 1000).toISOString());
});

test('resolving a passed absolute instant reports expiry-in-past and never clamps', () => {
  const win = load();
  const submittedAt = Date.parse('2026-10-08T13:00:00.000Z');
  const resolved = win.resolveAutoDeleteLifetime({ mode: 'absolute', expiresAt: '2026-10-08T12:59:00.000Z' }, submittedAt);
  assert.deepEqual(Object.assign({}, resolved), { ok: false, reason: 'expiry-in-past' });
  const exact = win.resolveAutoDeleteLifetime({ mode: 'absolute', expiresAt: '2026-10-08T13:01:00.000Z' }, submittedAt);
  assert.equal(exact.ok, true, 'exactly one minute ahead is accepted');
});

test('resolving beyond 3650 days from submission reports expiry-out-of-range', () => {
  const win = load();
  const submittedAt = Date.parse(SUBMITTED);
  const far = new Date(submittedAt + MAX_MS + MINUTE_MS).toISOString();
  const resolved = win.resolveAutoDeleteLifetime({ mode: 'absolute', expiresAt: far }, submittedAt);
  assert.deepEqual(Object.assign({}, resolved), { ok: false, reason: 'expiry-out-of-range' });
  const edge = new Date(submittedAt + MAX_MS).toISOString();
  assert.equal(win.resolveAutoDeleteLifetime({ mode: 'absolute', expiresAt: edge }, submittedAt).ok, true);
});

test('the summary line and the readable footer line always agree to the minute', () => {
  const win = load();
  assert.equal(win.formatAutoDeleteSummary(EXPIRY),
    'Expires 2026-10-08 13:00 UTC');
  assert.equal(win.formatAutoDeleteDeadline(EXPIRY), 'Auto-delete after: 2026-10-08 13:00 UTC');
  assert.ok(win.formatAutoDeleteSummary(EXPIRY).includes('2026-10-08 13:00 UTC'));
  assert.equal(win.formatAutoDeleteSummary('nonsense'), null);
});

test('builder includes the supplied token and UTC readable deadline', () => {
  const win = load();
  const footer = win.buildAutoDeleteFooter({
    workspaceId: 'workspace-1',
    contactId: 'contact-1',
    expiresAt: EXPIRY,
    token: 'submission-token'
  });
  assert.equal(footer, '\n\nAuto-delete after: 2026-10-08 13:00 UTC\n[ISA-AUTO-DELETE:v1;workspace=workspace-1;contact=contact-1;expires=2026-10-08T13:00:00.000Z;token=submission-token]');
  assert.equal(win.buildAutoDeleteFooter({ workspaceId: 'w', contactId: 'c', expiresAt: EXPIRY }), null);
});

test('parser returns the note body and marker metadata', () => {
  const win = load();
  const body = temporaryBody(win);
  const parsed = win.parseAutoDeleteFooter(body);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.body, 'Private note');
  assert.equal(parsed.workspaceId, 'workspace-1');
  assert.equal(parsed.contactId, 'contact-1');
  assert.equal(parsed.expiresAtIso, EXPIRY);
  assert.equal(parsed.token, 'token-1');
});

test('ordinary notes have no expiry metadata', () => {
  const win = load();
  assert.equal(win.parseAutoDeleteFooter('ordinary note with no marker'), null);
});

test('quoted, duplicate, unknown, malformed, and conflicting footers fail closed', () => {
  const win = load();
  const valid = temporaryBody(win);
  const marker = valid.slice(valid.indexOf('[ISA-AUTO-DELETE:'));
  assert.equal(win.parseAutoDeleteFooter(`Quoted "${marker}"` ).valid, false);
  assert.equal(win.parseAutoDeleteFooter(`${valid}\n${marker}`).valid, false);
  assert.equal(win.parseAutoDeleteFooter(valid.replace(':v1;', ':v2;')).valid, false);
  const impossibleDate = valid.replace('expires=2026-10-08T13:00:00.000Z', 'expires=2026-02-30T13:00:00.000Z')
    .replace('2026-10-08 13:00 UTC', '2026-02-30 13:00 UTC');
  assert.ok(impossibleDate.includes('2026-02-30 13:00 UTC'), 'the readable line agrees, so only the calendar check can reject it');
  assert.equal(win.parseAutoDeleteFooter(impossibleDate).valid, false);
  assert.equal(win.parseAutoDeleteFooter(valid.replace('13:00 UTC', '14:00 UTC')).valid, false);
  assert.equal(win.parseAutoDeleteFooter(valid.replace('[ISA-AUTO-DELETE:', '[ISA-AUTO-DELETE:v1;workspace=workspace-1;contact=contact-1;expires=')).valid, false);
});

test('eligibility requires ownership, matching scope, valid creation order, and server time', () => {
  const win = load();
  const body = temporaryBody(win);
  const note = { ...BASE_NOTE, body };
  assert.equal(win.isAutoDeleteEligible(note, { workspaceId: 'workspace-1', contactId: 'contact-1' }), false);
  assert.equal(win.evaluateAutoDeleteEligibility(note, { workspaceId: 'workspace-1', contactId: 'contact-1' }).reason, 'missing-server-time');
  assert.equal(win.evaluateAutoDeleteEligibility(note, { contactId: 'contact-1', serverNow: EXPIRY }).reason, 'missing-workspace');
  assert.equal(win.isAutoDeleteEligible(note, { workspaceId: 'workspace-1', contactId: 'other', serverNow: '2026-10-08T13:00:00.000Z' }), false);
  const unowned = { id: 'note-1', body, createdAt: BASE_NOTE.createdAt, updatedAt: BASE_NOTE.updatedAt };
  const owner = { workspaceId: 'workspace-1', contactId: 'contact-1', serverNow: EXPIRY };
  assert.equal(win.evaluateAutoDeleteEligibility(unowned, owner).reason, 'missing-ownership');
  assert.equal(win.evaluateAutoDeleteEligibility(unowned, { ...owner, contactNoteIds: ['note-1'] }).eligible, true,
    'a note listed on the contact is owned even without its own contact id');
  assert.equal(win.evaluateAutoDeleteEligibility({ ...note, contactId: 'someone-else' }, owner).reason, 'ownership-mismatch');
  assert.equal(win.isAutoDeleteEligible({ ...note, createdAt: EXPIRY }, { workspaceId: 'workspace-1', contactId: 'contact-1', serverNow: EXPIRY }), false);
  assert.equal(win.isAutoDeleteEligible(note, { workspaceId: 'other', contactId: 'contact-1', serverNow: EXPIRY }), false);
});

test('eligibility uses exact expiry boundary and accepts a fresh version', () => {
  const win = load();
  const note = { ...BASE_NOTE, body: temporaryBody(win) };
  const context = { workspaceId: 'workspace-1', contactId: 'contact-1', expectedUpdatedAt: SUBMITTED };
  assert.equal(win.isAutoDeleteEligible(note, { ...context, serverNow: '2026-10-08T12:59:59.999Z' }), false);
  assert.equal(win.isAutoDeleteEligible(note, { ...context, serverNow: EXPIRY }), true);
  assert.equal(win.isAutoDeleteEligible(note, { ...context, serverNow: '2026-10-08T13:00:00.001Z' }), true);
  assert.equal(win.isAutoDeleteEligible({ ...note, updatedAt: EXPIRY }, { ...context, serverNow: EXPIRY }), false);
});

test('editing text preserves the footer, while removing it cancels cleanup', () => {
  const win = load();
  const body = temporaryBody(win);
  const edited = body.replace('Private note', 'Edited note text');
  assert.equal(win.parseAutoDeleteFooter(edited).valid, true);
  const note = { ...BASE_NOTE, body: edited };
  assert.equal(win.isAutoDeleteEligible(note, { workspaceId: 'workspace-1', contactId: 'contact-1', serverNow: EXPIRY }), true);
  assert.equal(win.evaluateAutoDeleteEligibility({ ...note, body: 'Edited note text' }, { workspaceId: 'workspace-1', contactId: 'contact-1', serverNow: EXPIRY }).reason, 'ordinary-note');
});

test('copied footers and invalid markers never qualify for another contact', () => {
  const win = load();
  const copied = { ...BASE_NOTE, body: temporaryBody(win, { contactId: 'contact-2' }) };
  const result = win.evaluateAutoDeleteEligibility(copied, { workspaceId: 'workspace-1', contactId: 'contact-1', serverNow: EXPIRY });
  assert.equal(result.reason, 'marker-contact-mismatch');
  const malformed = { ...BASE_NOTE, body: temporaryBody(win).replace('token=token-1', 'token=token-1;extra=x') };
  assert.equal(win.evaluateAutoDeleteEligibility(malformed, { workspaceId: 'workspace-1', contactId: 'contact-1', serverNow: EXPIRY }).eligible, false);
});
