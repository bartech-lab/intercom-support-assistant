'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'intercom-temporary-notes.js'), 'utf8');

function load() {
  const context = vm.createContext({ console });
  context.window = context;
  vm.runInContext(SOURCE, context, { filename: 'intercom-temporary-notes.js' });
  return context.ISA_TEMPORARY_NOTES;
}

const T = load();
const CREATED = '2026-10-01T10:00:00.000Z';
const EXPIRES = '2026-10-08T13:00:00.000Z';
const AFTER = '2026-10-09T00:00:00.000Z';
const CONTEXT = { workspaceId: 'w1', contactId: 'c1', serverNow: AFTER };

function noted(body, extra = {}) {
  return { id: 'note-1', contactId: 'c1', createdAt: CREATED, body, ...extra };
}

function withFooter(text) {
  return T.appendFooter(text, { workspaceId: 'w1', contactId: 'c1', expiresAt: EXPIRES, token: 't1' });
}

test('an expired note with a valid footer is eligible (baseline for the guards below)', () => {
  assert.equal(T.evaluateEligibility(noted(withFooter('hello')), CONTEXT).eligible, true);
});

test('text added after the marker blocks deletion', () => {
  const result = T.evaluateEligibility(noted(`${withFooter('hello')}\nedited later by a colleague`), CONTEXT);
  assert.deepEqual([result.eligible, result.reason], [false, 'marker-not-at-end']);
});

test('a note carrying two footers is reported as multiple markers', () => {
  const result = T.evaluateEligibility(noted(withFooter(withFooter('hello'))), CONTEXT);
  assert.deepEqual([result.eligible, result.reason], [false, 'multiple-markers']);
});

test('a negative server time counts as missing', () => {
  const result = T.evaluateEligibility(noted(withFooter('hello')), { ...CONTEXT, serverNow: -1 });
  assert.equal(result.reason, 'missing-server-time');
});

test('an empty camelCase body is used as is, not replaced by the snake_case text', () => {
  const note = { id: 'note-1', contactId: 'c1', createdAt: CREATED, body: '', text: withFooter('hello') };
  assert.equal(T.evaluateEligibility(note, CONTEXT).reason, 'ordinary-note');
});
