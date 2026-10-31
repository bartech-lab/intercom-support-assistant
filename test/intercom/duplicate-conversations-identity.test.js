'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  TEAM,
  TAMSIN,
  MERROW,
  WREN,
  build,
  row,
  isMarked,
  chipText,
  CONTACT_A,
  CONTACT_B,
  deliverIdentities,
} = require('../support/duplicate-conversations-harness');

const CONTACT_C = 'cccccccccccccccccccccccc';

const TAMSIN_MARLOWE = 'Tamsin Holloway marlowe';
const TAMSIN_BRIGHTWELL = 'Tamsin Holloway brightwell';

test('the contact id groups two rows whose display names differ', () => {
  const win = build([row('1', TAMSIN), row('2', MERROW), row('3', WREN)]);
  deliverIdentities(win, [['1', CONTACT_A], ['2', CONTACT_A], ['3', CONTACT_B]]);

  assert.equal(chipText(win, '1'), '\u29c92');
  assert.equal(chipText(win, '2'), '\u29c92');
  assert.equal(isMarked(win, '3'), false);
});

test('the contact id splits two rows that share a display name', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN), row('3', TAMSIN)]);
  deliverIdentities(win, [['1', CONTACT_A], ['2', CONTACT_B], ['3', CONTACT_C]]);

  ['1', '2', '3'].forEach(id => assert.equal(isMarked(win, id), false, id));
});

test('identical external senders still group when they really are one contact', () => {
  const win = build([row('1', 'alderpoint'), row('2', 'alderpoint'), row('3', 'alderpoint')]);
  deliverIdentities(win, [['1', CONTACT_A], ['2', CONTACT_A], ['3', CONTACT_B]]);

  assert.equal(chipText(win, '1'), '\u29c92');
  assert.equal(chipText(win, '2'), '\u29c92');
  assert.equal(isMarked(win, '3'), false);
});

test('a row missing from the payload is skipped, not answered with the name key', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN), row('3', WREN)]);
  deliverIdentities(win, [['1', CONTACT_A], ['3', CONTACT_B]]);

  assert.equal(chipText(win, '1'), null,
    'one unknown row must not send the whole inbox back to display names');
  assert.equal(chipText(win, '2'), null, 'it stays unmarked until its identity arrives');

  deliverIdentities(win, [['2', CONTACT_A]]);

  assert.equal(chipText(win, '1'), '\u29c92', 'and the pair appears once the payload catches up');
  assert.equal(chipText(win, '2'), '\u29c92');
});

test('identities from another inbox are never applied to this one', () => {
  const win = build([row('1', TAMSIN), row('2', MERROW)]);
  deliverIdentities(win, [['1', CONTACT_A], ['2', CONTACT_A]], { inboxId: '900201' });

  assert.equal(isMarked(win, '1'), false, 'the name key still says these are two customers');
  assert.equal(isMarked(win, '2'), false);
});

test('a forged identity envelope from another origin is rejected', () => {
  const win = build([row('1', TAMSIN), row('2', MERROW)]);
  deliverIdentities(win, [['1', CONTACT_A], ['2', CONTACT_A]], { origin: 'https://evil.example.com' });

  assert.equal(isMarked(win, '1'), false);
  assert.equal(isMarked(win, '2'), false);
});

test('a malformed contact id is rejected and changes nothing', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  win.dispatchEvent(new win.MessageEvent('message', {
    source: win,
    origin: 'https://app.intercom.com',
    data: {
      __isaic: true,
      version: 1,
      kind: 'inbox-list-identity',
      inboxType: 'team',
      inboxId: TEAM,
      state: 'open',
      inboxKey: `team:${TEAM}:open`,
      identities: [{ conversationId: '1', contactId: 'not-a-contact-id' }]
    }
  }));

  assert.equal(chipText(win, '1'), '\u29c92', 'the name key is untouched');
});

test('one email groups a customer who holds a brand account per brand', () => {
  const win = build([row('1', TAMSIN_MARLOWE), row('2', TAMSIN_BRIGHTWELL), row('3', WREN)]);
  deliverIdentities(win, [
    ['1', CONTACT_A, 'tamsin.holloway@example.com'],
    ['2', CONTACT_B, 'tamsin.holloway@example.com'],
    ['3', CONTACT_C, 'wren@example.com']
  ]);

  assert.equal(chipText(win, '1'), '⧉2');
  assert.equal(chipText(win, '2'), '⧉2');
  assert.equal(isMarked(win, '3'), false);
});

test('two emails split two rows that share one display name', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  deliverIdentities(win, [
    ['1', CONTACT_A, 'one@example.com'],
    ['2', CONTACT_B, 'two@example.com']
  ]);

  ['1', '2'].forEach(id => assert.equal(isMarked(win, id), false, id));
});

test('a row with no email falls back to its own contact id', () => {
  const win = build([row('1', TAMSIN_MARLOWE), row('2', TAMSIN_BRIGHTWELL), row('3', WREN), row('4', MERROW)]);
  deliverIdentities(win, [
    ['1', CONTACT_A, 'tamsin.holloway@example.com'],
    ['2', CONTACT_B, 'tamsin.holloway@example.com'],
    ['3', CONTACT_C],
    ['4', CONTACT_C]
  ]);

  assert.equal(chipText(win, '1'), '⧉2', 'the email still groups the pair that has one');
  assert.equal(chipText(win, '2'), '⧉2');
  assert.equal(chipText(win, '3'), '⧉2', 'and the contact id still groups the pair that has none');
  assert.equal(chipText(win, '4'), '⧉2');
});

test('a same-email sibling whose own row has no email is not merged', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  deliverIdentities(win, [
    ['1', CONTACT_A, 'tamsin.holloway@example.com'],
    ['2', CONTACT_B]
  ]);

  ['1', '2'].forEach(id => assert.equal(isMarked(win, id), false, id));
});

test('an email key is groupable even when it looks like a brand address', () => {
  assert.equal(build([]).customerKeyIsGroupable('email:help@alderpoint.example'), true);
});

test('a malformed email rejects the envelope and changes nothing', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  deliverIdentities(win, [['1', CONTACT_A, 'not-an-address'], ['2', CONTACT_B, 'not-an-address']]);

  assert.equal(chipText(win, '1'), '⧉2', 'the name key is untouched');
});

test('a malformed email shared by two different customers never groups them', () => {
  const win = build([row('1', TAMSIN), row('2', MERROW)]);
  deliverIdentities(win, [['1', CONTACT_A, 'not-an-address'], ['2', CONTACT_B, 'not-an-address']]);

  assert.equal(isMarked(win, '1'), false, 'the rejected envelope must not group by the bogus email');
  assert.equal(isMarked(win, '2'), false);
});
