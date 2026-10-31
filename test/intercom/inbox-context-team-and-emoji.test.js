'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

const ORIGIN = 'https://app.intercom.com';
const LANGUAGES = ['english', 'german', 'french', 'italian', 'portuguese', 'spanish', 'dutch'];

function excludedWindow(url) {
  const attrs = [fx.conversationAttrRow('9307', 'Brand', 'Quayside Fashion')];
  return loadExtension(
    fx.inboxHtml({ sidebar: fx.sidebarSection({ teamInbox: 'Tier 2', conversationAttrs: attrs }) }),
    url ? { url } : undefined
  );
}

function signatureState() {
  const win = loadExtension(fx.inboxHtml({ sidebar: fx.sidebarSection({}) }));
  return {
    config: win.ISA_INTERCOM_CONFIG,
    companies: win.eval('normalizedCompanies')
  };
}

test('an excluded inbox reports the team id from the URL', () => {
  for (const teamId of ['900301', '900302']) {
    const win = excludedWindow(`${ORIGIN}/a/inbox/demo1234/inbox/team/${teamId}/conversation/456`);
    const info = win.detectInboxType();
    assert.equal(info.type, 'excluded');
    assert.equal(info.teamId, teamId);
  }
});

test('an excluded inbox reports null teamId when the URL has no team segment', () => {
  const win = excludedWindow(`${ORIGIN}/a/inbox/demo1234/inbox/all/conversation/456`);
  const info = win.detectInboxType();
  assert.equal(info.type, 'excluded');
  assert.strictEqual(info.teamId, null);
});

test('every normalized brand keeps its configured emoji', () => {
  const { config, companies } = signatureState();
  const names = Object.keys(config.companies);
  assert.ok(names.length > 0);
  for (const name of names) {
    const emoji = companies[name].emoji;
    assert.equal(typeof emoji, 'string', `${name} emoji`);
    assert.notEqual(emoji, '', `${name} emoji non-empty`);
    assert.equal(emoji, config.companies[name].emoji, name);
  }
});

test('every normalized brand signs with its own signer in every language', () => {
  const { config, companies } = signatureState();
  for (const [name, source] of Object.entries(config.companies)) {
    assert.notEqual(companies[name], source, `${name} is normalized into a new object`);
    for (const lang of LANGUAGES) {
      assert.equal(typeof companies[name][lang], 'string', `${name} ${lang}`);
      const signer = source[lang].split('<br>')[3];
      assert.ok(signer, `${name} ${lang} has a signer line`);
      assert.ok(companies[name][lang].includes(signer), `${name} ${lang} names ${signer}`);
    }
  }
});
