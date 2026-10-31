'use strict';

const { test } = require('node:test');
const loadExtensionSubset = (html) => loadExtension(html, { scripts: INTERCOM_LANGUAGE_SCRIPTS });
const assert = require('node:assert/strict');
const { INTERCOM_LANGUAGE_SCRIPTS, loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

function build(conversationAttrs, userDetails = []) {
  return loadExtensionSubset(fx.inboxHtml({
    sidebar: fx.sidebarSection({ teamInbox: 'Support Brightwell', conversationAttrs }),
    userDetails: userDetails.length ? fx.userDetailsSection(userDetails) : ''
  }));
}

test('the Language row is found by its stable attribute id, whatever the label says', () => {
  const win = build([fx.conversationAttrRow('language', 'Sprache', 'German')]);

  assert.equal(win.findAttributeRowByLabel('Language').id, 'conversation-attr-language');
});

test('a translated Language label still yields its value', () => {
  const win = build([fx.conversationAttrRow('language', 'Idioma', 'Spanish')]);

  assert.equal(win.eval('getAttributeValueByLabel(FIELD_LABELS.language, [SELECTORS.attributeValue])'), 'Spanish');
});

test('the English Language label still works when no stable id is present', () => {
  const win = build([fx.conversationAttrRow('9002817', 'Language', 'Polish')]);

  assert.equal(win.findAttributeRowByLabel('Language').id, 'conversation-attr-9002817');
});

test('the stable id wins over a same-named row, so a duplicate label cannot shadow it', () => {
  const win = build([
    fx.conversationAttrRow('7777', 'Language', 'English'),
    fx.conversationAttrRow('language', 'Language', 'Italian')
  ]);

  assert.equal(win.findAttributeRowByLabel('Language').id, 'conversation-attr-language');
});

test('a custom attribute label is matched as before, since Intercom never translates it', () => {
  const win = build([fx.conversationAttrRow('1001', 'Brand', 'Brightwell')]);

  assert.equal(win.getCompanyFromAttributes(), 'Brightwell');
});

test('the customer email is read from a translated Email label when it is the only address', () => {
  const win = build([], [fx.userDetailRow('E-Mail', fx.emailValue('customer@brightwell.example'))]);

  assert.equal(win.getCustomerEmail(), 'customer@brightwell.example');
});

test('an English Email label still takes precedence over the fallback', () => {
  const win = build([], [
    fx.userDetailRow('Kontakt', fx.emailValue('other@brightwell.example')),
    fx.userDetailRow('Email', fx.emailValue('labelled@brightwell.example'))
  ]);

  assert.equal(win.eval('unambiguousEmailFromAttributeRows()'), null, 'the fallback alone would refuse two addresses');
  assert.equal(win.getCustomerEmail(), 'labelled@brightwell.example');
});

test('two different addresses make the email fallback refuse rather than guess', () => {
  const win = build([], [
    fx.userDetailRow('E-Mail', fx.emailValue('customer@brightwell.example')),
    fx.userDetailRow('Kontakt', fx.emailValue('agent@brightwell.example'))
  ]);

  assert.equal(win.getCustomerEmail(), null,
    'a wrong address would build a backend link to the wrong customer');
});

test('the same address repeated in two rows is not treated as ambiguous', () => {
  const win = build([], [
    fx.userDetailRow('E-Mail', fx.emailValue('customer@brightwell.example')),
    fx.userDetailRow('Correo', fx.emailValue('CUSTOMER@brightwell.example'))
  ]);

  assert.equal(win.getCustomerEmail(), 'customer@brightwell.example');
});

test('a row holding something that is not an address yields no email', () => {
  const win = build([], [fx.userDetailRow('Ort', fx.emailValue('Warsaw, Poland'))]);

  assert.equal(win.getCustomerEmail(), null);
});

test('the stream fallback reads the newest Language change, not the first "set to" in the stream', () => {
  const stream = [
    '<div data-intercom-target="conversation-space">',
    "<div>Attribute: 'Brand' set to Brightwell</div>",
    '<div>Please set to default my address</div>',
    "<div>Attribute: 'Language' set to French</div>",
    "<div>Attribute: 'Language' set to Brazilian Portuguese</div>",
    '<div>Olá</div>',
    '</div>'
  ].join('');
  const win = loadExtension(fx.inboxHtml({ conversation: stream }));
  assert.equal(win.detectLanguageFromConversationStream(), 'portuguese');
});

test('the stream fallback resolves a one-word Language change without reading the next message', () => {
  const stream = '<div data-intercom-target="conversation-space">'
    + "<div>Attribute: 'Language' set to Italian</div><div>French fries are cold</div></div>";
  const win = loadExtension(fx.inboxHtml({ conversation: stream }));
  assert.equal(win.detectLanguageFromConversationStream(), 'italian');
});

test('the stream fallback takes the first word that names a language, not a later word in the phrase', () => {
  const stream = '<div data-intercom-target="conversation-space">'
    + "<div>Attribute: 'Language' set to English by Ottilie</div></div>";
  const win = loadExtension(fx.inboxHtml({ conversation: stream }));
  assert.equal(win.detectLanguageFromConversationStream(), 'english');
});
