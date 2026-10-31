'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { INTERCOM_LANGUAGE_SCRIPTS, loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

const BASE = 'https://app.intercom.com/a/inbox/abc/inbox/team/';

const bare = (url) => loadExtension(fx.inboxHtml({}), { scripts: INTERCOM_LANGUAGE_SCRIPTS, url });

const germanUndCount = (win, text) => {
  const entry = win.scoreLanguages(text).languages.find((item) => item.language === 'german');
  return entry.matched.filter((word) => word === 'und').length;
};

const customerBlock = (body) => `<div data-testid="user-email-content" class="email-html-content--inbound">
  <div class="intercom-interblocks-html">${body}</div></div>`;

const detect = ({ attribute, stream = '', customer = [] }) => {
  const attrs = attribute ? [fx.conversationAttrRow('language', 'Language', attribute)] : [];
  const space = `<div data-intercom-target="conversation-space">${stream}${customer.map(customerBlock).join('')}</div>`;
  const win = loadExtension(fx.inboxHtml({
    sidebar: fx.sidebarSection({ teamInbox: 'Support Brightwell', conversationAttrs: attrs }),
    conversation: space
  }), { scripts: INTERCOM_LANGUAGE_SCRIPTS });
  return win.detectCustomerLanguage();
};

const event = (language) => `Attribute: 'Language' set to ${language}`;

test('L1 a word glued to digits does not count while the spaced word does', () => {
  const win = bare(`${BASE}123`);
  assert.equal(germanUndCount(win, 'hallo und danke'), 1);
  assert.equal(germanUndCount(win, 'hallo und123 danke'), 0);
  assert.equal(germanUndCount(win, 'hallo 123und danke'), 0);
});

test('L2 inbox text normalization keeps text, drops zero-width characters, collapses whitespace', () => {
  const win = bare(`${BASE}123`);
  assert.equal(win.normalizeInboxText('Support Team'), 'Support Team');
  assert.equal(win.normalizeInboxText('Support​Team'), 'SupportTeam');
  assert.equal(win.normalizeInboxText('Support‌Team'), 'SupportTeam');
  assert.equal(win.normalizeInboxText('  Support \n\t  Team  '), 'Support Team');
});

test('L3 team id must be a whole path segment', () => {
  assert.equal(bare(`${BASE}123`).getActiveTeamId(), '123');
  assert.equal(bare(`${BASE}123/conversation/9`).getActiveTeamId(), '123');
  assert.equal(bare(`${BASE}123?x=1`).getActiveTeamId(), '123');
  assert.equal(bare(`${BASE}123abc`).getActiveTeamId(), null);
});

test('L4 the country is the last comma part of the location', () => {
  const win = bare(`${BASE}123`);
  assert.equal(win.extractCountryFromLocation('Berlin, Brandenburg, Germany'), 'Germany');
});

test('L5 well-formed locale codes map, code-like prefixes do not', () => {
  assert.equal(detect({ attribute: 'de-AT', customer: ['Hallo'] }), 'german');
  assert.equal(detect({ attribute: 'pt_BR', customer: ['Ola'] }), 'portuguese');
  assert.notEqual(detect({ attribute: 'Estonian', customer: ['Ok'] }), 'spanish');
  assert.notEqual(detect({ attribute: 'Esperanto', customer: ['Ok'] }), 'spanish');
});

test('L6 native language names map to their language', () => {
  assert.equal(detect({ attribute: 'Français', customer: ['Ok'] }), 'french');
  assert.equal(detect({ attribute: 'Español', customer: ['Ok'] }), 'spanish');
});

test('L7 the last Language change in one message part wins', () => {
  const stream = `<div><p>${event('German')}</p><p>${event('French')}</p></div>`;
  assert.equal(detect({ stream }), 'french');
});

test('L8 a low-confidence note makes the stream defer to the customer message', () => {
  const note = '<div class="conversation__note-part"><div class="intercom-interblocks-html">Intercom could not detect with enough confidence</div></div>';
  const stream = `<div>${event('French')}</div>${note}`;
  const customer = ['Hallo, die Jacke ist mir zu klein, bitte schicken Sie mir eine größere und danke für die schnelle Hilfe.'];
  assert.equal(detect({ stream, customer }), 'german');
});

const detectAt = (location, customer = []) => {
  const space = `<div data-intercom-target="conversation-space">${customer.map(customerBlock).join('')}</div>`;
  const win = loadExtension(fx.inboxHtml({
    sidebar: fx.sidebarSection({ teamInbox: 'Support Brightwell', conversationAttrs: [] }),
    userDetails: fx.userDetailsSection([fx.userDetailRow('Location', `<span class="truncate">${location}</span>`)]),
    conversation: space
  }), { scripts: INTERCOM_LANGUAGE_SCRIPTS });
  return win.detectCustomerLanguage();
};

test('L9 Austria and Switzerland locations point to German when nothing else does', () => {
  assert.equal(detectAt('Vienna, Austria'), 'german');
  assert.equal(detectAt('Zurich, Switzerland'), 'german');
  assert.equal(detectAt('Lyon, France'), 'french');
});

test('L10 two Language changes in one sentence-separated text element: the later one wins', () => {
  assert.equal(detect({ stream: `<div>${event('German')}. ${event('French')}.</div>` }), 'french');
});

test('L11 when two languages both qualify, the higher score wins', () => {
  const customer = ['hola, quiero mi paquete ahora, tengo prisa. grazie molto, vorrei'];
  assert.equal(detect({ customer }), 'spanish');
});
