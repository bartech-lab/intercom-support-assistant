'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { INTERCOM_LANGUAGE_SCRIPTS, loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

const bare = () => loadExtension(fx.inboxHtml({}), {
  scripts: INTERCOM_LANGUAGE_SCRIPTS,
  url: 'https://app.intercom.com/a/inbox/abc/inbox/team/123'
});

const customerBlock = (body) => `<div data-testid="user-email-content" class="email-html-content--inbound">
  <div class="intercom-interblocks-html">${body}</div></div>`;

function load({ attribute, stream = '', customer = [], location, agents = [] } = {}) {
  const attrs = attribute ? [fx.conversationAttrRow('language', 'Language', attribute)] : [];
  const space = `<div data-intercom-target="conversation-space">${stream}${customer.map(customerBlock).join('')}${agents.join('')}</div>`;
  const win = loadExtension(fx.inboxHtml({
    sidebar: fx.sidebarSection({ teamInbox: 'Support Brightwell', conversationAttrs: attrs }),
    userDetails: location
      ? fx.userDetailsSection([fx.userDetailRow('Location', `<span class="truncate">${location}</span>`)])
      : undefined,
    conversation: space
  }), { scripts: INTERCOM_LANGUAGE_SCRIPTS });
  return { win };
}

function detect(options) {
  const { win } = load(options);
  const language = win.detectCustomerLanguage();
  return { language, win };
}

const german = (win, text) => win.scoreLanguages(text).languages.find(entry => entry.language === 'german');

test('S1 word matching ignores case', () => {
  const win = bare();
  assert.equal(german(win, 'HALLO UND DANKE').words, 2);
  assert.equal(win.scoreLanguages('THE AND YOU').englishWordCount, 3);
});

test('S2 each accented letter adds half a point to its language', () => {
  const win = bare();
  const chars = (text, language) => win.scoreLanguages(text).languages.find(entry => entry.language === language).chars;
  assert.equal(chars('ß', 'german'), 0.5);
  assert.equal(chars('äö', 'german'), 1);
  assert.equal(chars('û', 'french'), 0.5);
  assert.equal(chars('ò', 'italian'), 0.5);
  assert.equal(chars('õ', 'portuguese'), 0.5);
  assert.equal(chars('¡', 'spanish'), 0.5);
  assert.equal(chars('ëéž', 'dutch'), 0);
});

test('S3 a candidate qualifies at a score of 3 with exactly 2 words', () => {
  const win = bare();
  const pick = (score, words) => win.bestLanguageCandidate([{ language: 'german', score, words }]);
  assert.equal(pick(3, 2).language, 'german');
  assert.equal(pick(2.5, 4), null);
  assert.equal(pick(5, 1), null);
});

test('S4 one message where foreign words tie the English words is not English', () => {
  assert.equal(detect({ customer: ['the you with nicht bitte danke'] }).language, 'german');
});

test('S5 three English words outweigh foreign words spread thinly over messages', () => {
  assert.equal(detect({ customer: ['danke bitte', 'the you with nicht'] }).language, 'english');
});

test('S6 foreign words at 1.5 times the English words are not English, below that they are', () => {
  assert.equal(detect({ customer: ['und nicht', 'bitte danke', 'kann haben', 'the you with that'] }).language, 'german');
  assert.equal(detect({ customer: ['und nicht', 'bitte danke', 'kann', 'the you with that'] }).language, 'english');
});

test('S7 messages are read from the legacy client message layout when no message block exists', () => {
  const legacy = '<div class="inbox2__user-email-content"><div class="intercom-interblocks-html">Hallo, ich kann mich nicht einloggen, bitte helfen Sie mir. Danke</div></div>';
  assert.equal(detect({ stream: legacy }).language, 'german');
});

test('S8 an agent reply is read from its content, not its header', () => {
  const reply = '<div data-testid="teammate-email-reply-part"><span>und nicht bitte danke kann</span><div class="intercom-interblocks-html">Thanks for waiting</div></div>';
  assert.equal(detect({ agents: [reply] }).language, 'english');
});

test('S9 a three-word stream language names the language in its last word', () => {
  const stream = "<div>Attribute: 'Language' set to Swiss Standard German</div>";
  assert.equal(detect({ stream }).language, 'german');
});

test('S10 a Belgian location with no other evidence is English and counts as evidence', () => {
  const result = detect({ location: 'Ghent, Belgium' });
  assert.equal(result.language, 'english');
  assert.equal(result.win.eval('lastDetectionHadNoEvidence'), false);
});

test('S11 with no evidence the decision is the provisional English default', () => {
  const result = detect({});
  assert.equal(result.language, 'english');
  assert.equal(result.win.eval('lastDetectionHadNoEvidence'), true);
});

test('S12 a later detection with evidence clears the no-evidence flag', () => {
  const { win } = load({});
  win.detectCustomerLanguage();
  assert.equal(win.eval('lastDetectionHadNoEvidence'), true);
  win.document.querySelector('[data-intercom-target="conversation-space"]')
    .insertAdjacentHTML('beforeend', customerBlock('Hallo, ich kann mich nicht einloggen, bitte helfen Sie mir. Danke'));
  assert.equal(win.detectCustomerLanguage(), 'german');
  assert.equal(win.eval('lastDetectionHadNoEvidence'), false);
});

test('S13 an attribute language that matches the location survives a conversation in another language', () => {
  const customer = ['Hallo, ich kann mich nicht einloggen, bitte helfen Sie mir. Danke'];
  assert.equal(detect({ attribute: 'Italian', location: 'Rome, Italy', customer }).language, 'italian');
});

test('S14 a stream or sidebar language is overruled by the conversation text', () => {
  const customer = ['Bonjour, je ne peux pas me connecter, merci de votre aide'];
  const fromStream = detect({ stream: "<div>Attribute: 'Language' set to German</div>", customer });
  assert.equal(fromStream.language, 'english');
  const fromSidebar = detect({ attribute: 'German', customer });
  assert.equal(fromSidebar.language, 'english');
});
