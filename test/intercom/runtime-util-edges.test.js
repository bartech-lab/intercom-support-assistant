'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');

const PAGE = '<!doctype html><html><body></body></html>';

test('safeExecute returns the given fallback when the function throws', () => {
  const win = loadExtension(PAGE);
  win.console.error = () => {};
  assert.equal(win.safeExecute(() => { throw new Error('boom'); }, 'ctx', 'fallback'), 'fallback');
  assert.equal(win.safeExecute(() => { throw new Error('boom'); }, 'ctx'), null);
});

test('a support note is printed once per conversation', () => {
  const win = loadExtension(PAGE);
  const notes = [];
  win.console.debug = (...args) => notes.push(args.join(' '));
  win.eval('currentConversationId = "1"');
  win.supportNoteOnce('key', 'note');
  win.supportNoteOnce('key', 'note');
  assert.equal(notes.length, 1);
  win.eval('currentConversationId = "2"');
  win.supportNoteOnce('key', 'note');
  assert.equal(notes.length, 2);
});

test('the runtime config check rejects a missing config and a normalizer without its function', () => {
  const win = loadExtension(PAGE);
  const config = win.ISA_INTERCOM_CONFIG;
  const normalizer = win.ISA_SIGNATURE_NORMALIZER;
  assert.throws(() => win.assertRuntimeConfig(null, normalizer), /Missing Intercom runtime config/);
  assert.throws(() => win.assertRuntimeConfig(config, {}), /Missing signature normalizer/);
  assert.doesNotThrow(() => win.assertRuntimeConfig(config, normalizer));
});

test('a banner is not added to a language the brand signature lacks', () => {
  const win = loadExtension(PAGE, {
    beforeScripts: (window) => {
      let config;
      Object.defineProperty(window, 'ISA_INTERCOM_CONFIG', {
        configurable: true,
        get() { return config; },
        set(value) {
          const companies = JSON.parse(JSON.stringify(value.companies));
          delete companies.Brightwell.dutch;
          config = { ...value, companies, promotionalBanners: { Brightwell: { english: 'EN BANNER', dutch: 'NL BANNER' } } };
        }
      });
    }
  });
  const brightwell = win.eval('normalizedCompanies').Brightwell;
  assert.ok(brightwell.english.startsWith('<br>EN BANNER'));
  assert.ok(!String(brightwell.dutch).includes('NL BANNER'));
});

test('a single email value is one whole address with a named domain', () => {
  const win = loadExtension(PAGE);
  const pattern = win.eval('SINGLE_EMAIL_VALUE_PATTERN');
  assert.equal(pattern.test('customer@example.com'), true);
  assert.equal(pattern.test('Contact customer@example.com'), false);
  assert.equal(pattern.test('customer@example.com extra'), false);
  assert.equal(pattern.test('customer@..com'), false);
});
