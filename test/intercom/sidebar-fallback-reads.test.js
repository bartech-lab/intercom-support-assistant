'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

const ORIGIN = 'https://app.intercom.com';
const URL_WITH_ID = `${ORIGIN}/a/inbox/demo1234/inbox/team/123/conversation/456`;
const URL_WITHOUT_ID = `${ORIGIN}/a/inbox/demo1234/inbox/team/123`;

function load(body, url = URL_WITH_ID) {
  return loadExtension(`<!doctype html><html><body>${body}</body></html>`, { url });
}

const FALLBACK_SECTION = (rows) =>
  `<div class="inbox2__conversation-details-sidebar">${rows.join('\n')}</div>`;
const REACT_SECTION = (inner) =>
  `<div data-test-conversation-details-scroll-container="true">${inner}</div>`;

const labelled = (label, valueHtml) => fx.userDetailRow(label, valueHtml);

test('email is read from the fallback row labelled Email, not from another row', () => {
  const win = load(FALLBACK_SECTION([
    labelled('Name', '<span class="truncate">Liv Lindqvist</span>'),
    labelled('Email', fx.emailValue('fallback.customer@example.com')),
    labelled('Location', '<span class="truncate">Celje</span>')
  ]));
  assert.equal(win.getCustomerEmail(), 'fallback.customer@example.com');
});

test('email is null when neither anchored rows nor a sidebar section exist', () => {
  const win = load('<div class="flex flex-row items-center h-8"><p class="inbox2__attribute__label">Email</p><p><span class="truncate">lost@example.com</span></p></div>');
  assert.equal(win.getCustomerEmail(), null);
});

test('legacy row whose value element is a direct email-value match yields the email', () => {
  const win = load(fx.userDetailsSection([
    labelled('Name', '<span class="truncate">Liv</span>'),
    labelled('Email', fx.emailValue('legacy@example.com'))
  ]));
  assert.equal(win.getCustomerEmail(), 'legacy@example.com');
});

test('legacy row whose value element is a direct attribute-value match yields the email', () => {
  const win = load(fx.userDetailsSection([
    `<div class="flex flex-row items-center h-8">
      <p class="inbox2__attribute__label"><span class="truncate">Email</span></p>
      <p><span class="u__one-truncated-line">direct@example.com</span></p>
    </div>`
  ]));
  assert.equal(win.getCustomerEmail(), 'direct@example.com');
});

test('React row with plain text inside a w-3/5 value column yields the email', () => {
  const win = load(fx.reactUserDetailsSection([
    fx.reactUserAttributeRow('name', 'Name', fx.reactAttributeValue('name', 'Liv')),
    fx.reactUserAttributeRow('email', 'Email', '<div class="w-3/5 min-w-0">column@example.com</div>')
  ]));
  assert.equal(win.getCustomerEmail(), 'column@example.com');
});

test('React row with plain text inside a value wrapper yields the email', () => {
  const win = load(fx.reactUserDetailsSection([
    fx.reactUserAttributeRow('name', 'Name', fx.reactAttributeValue('name', 'Liv')),
    fx.reactUserAttributeRow('email', 'Email', '<div data-test-attribute-value="email">wrapper@example.com</div>')
  ]));
  assert.equal(win.getCustomerEmail(), 'wrapper@example.com');
});

test('a single unlabelled row holding a padded email is returned lower-cased', () => {
  const win = load(fx.reactUserDetailsSection([
    fx.reactUserAttributeRow('name', 'Name', fx.reactAttributeValue('name', 'Liv')),
    fx.reactUserAttributeRow('contact', 'Contact', '<span data-test-attribute-value="contact">\n   Mixed.Case@Example.COM  \n</span>')
  ]));
  assert.equal(win.getCustomerEmail(), 'mixed.case@example.com');
});

test('two different unlabelled emails in two rows give null', () => {
  const win = load(fx.reactUserDetailsSection([
    fx.reactUserAttributeRow('contact', 'Contact', '<span data-test-attribute-value="contact"> first@example.com </span>'),
    fx.reactUserAttributeRow('backup', 'Backup', '<span data-test-attribute-value="backup"> second@example.com </span>')
  ]));
  assert.equal(win.getCustomerEmail(), null);
});

test('React sidebar id that differs from the URL id is a lag', () => {
  const win = load(fx.reactSidebarSection({ conversationId: '789' }));
  assert.equal(win.sidebarLagsConversation(), true);
});

test('React sidebar id equal to the URL id is no lag', () => {
  const win = load(fx.reactSidebarSection({ conversationId: '456' }));
  assert.equal(win.sidebarLagsConversation(), false);
});

test('a URL without a conversation id is never a lag', () => {
  const win = load(fx.reactSidebarSection({ conversationId: '789' }), URL_WITHOUT_ID);
  assert.equal(win.sidebarLagsConversation(), false);
});

test('a non-numeric sidebar id is never a lag', () => {
  const win = load(fx.reactSidebarSection({ conversationId: 'abc-def' }));
  assert.equal(win.sidebarLagsConversation(), false);
});

test('React conversation-id row with plain text and no value element is still read', () => {
  const win = load(REACT_SECTION(`<div data-testid="sidebar-conversation-id">
      <div class="w-2/5"><span>ID</span></div>
      <div class="w-3/5">789</div>
    </div>`));
  assert.equal(win.getSidebarConversationId(), '789');
  assert.equal(win.sidebarLagsConversation(), true);
});

test('legacy layout: a numeric User id row before the ID row is not the conversation id', () => {
  const win = load(`<div data-intercom-target="inbox-right-nav-details">
    <div class="flex flex-row items-center h-8">
      <div><label class="inbox2__attribute__label">User id</label>456</div>
    </div>
    <div class="flex flex-row items-center h-8">
      <div><label class="inbox2__attribute__label">ID</label>789</div>
    </div>
  </div>`);
  assert.equal(win.getSidebarConversationId(), '789');
  assert.equal(win.sidebarLagsConversation(), true);
});

const ASSIGNEE = (name) =>
  `<button data-testid="team-assignee-selector"><span>${name}</span></button>`;
const DRAFT_ROW = (name) =>
  `<div data-testid="draft-team-assignee"><button data-testid="team-assignee-selector"><span>${name}</span></button></div>`;

test('draft name is trimmed', () => {
  const win = load(DRAFT_ROW('  \n Draft Team \n ') + REACT_SECTION(fx.teamInboxRow('Row Team')));
  assert.equal(win.getVisibleTeamInboxName(), 'Draft Team');
});

test('an empty team-assignee value falls through to the sidebar row', () => {
  const win = load(REACT_SECTION(ASSIGNEE('   ') + fx.teamInboxRow('Row Team')));
  assert.equal(win.getVisibleTeamInboxName(), 'Row Team');
});

test('the team-assignee value wins over the sidebar row', () => {
  const win = load(REACT_SECTION(ASSIGNEE('React Team') + fx.teamInboxRow('Row Team')));
  assert.equal(win.getVisibleTeamInboxName(), 'React Team');
});

test('team inbox is found when only the React sidebar section exists', () => {
  const win = load(REACT_SECTION(fx.teamInboxRow('Only React Section')));
  assert.equal(win.getVisibleTeamInboxName(), 'Only React Section');
});

test('team inbox is found when only the fallback sidebar section exists', () => {
  const win = load(FALLBACK_SECTION([fx.teamInboxRow('Only Fallback Section')]));
  assert.equal(win.getVisibleTeamInboxName(), 'Only Fallback Section');
});

const NAME_BLOCK = (name) => `<div class="truncate flex items-center"><span>${name}</span></div>`;

test('an inbox row whose label element reads the team-inbox label wins over an earlier row', () => {
  const win = load(FALLBACK_SECTION([
    `<div class="flex flex-row items-center"><p data-popover-opener="x">Urgent</p>${NAME_BLOCK('Wrong Row')}</div>`,
    `<div class="flex flex-row items-center"><p data-popover-opener="y">team inbox *</p>${NAME_BLOCK('Right Row')}</div>`
  ]));
  assert.equal(win.getVisibleTeamInboxName(), 'Right Row');
});

test('without a label element, an inbox row whose text contains the label is used', () => {
  const win = load(FALLBACK_SECTION([
    `<div class="flex flex-row items-center"><div>Urgent</div>${NAME_BLOCK('Wrong Row')}</div>`,
    `<div class="flex flex-row items-center"><div>Set Team Inbox here</div>${NAME_BLOCK('Right Row')}</div>`
  ]));
  assert.equal(win.getVisibleTeamInboxName(), 'Right Row');
});

test('without an inbox-name element the first childless non-blank span is the name', () => {
  const win = load(FALLBACK_SECTION([
    `<div class="flex flex-row items-center"><p data-popover-opener="y">Team Inbox</p>
      <div><span>   </span><span><b>icon</b> Wrapper Text</span><span>Real Name</span><span>Later Name</span></div>
    </div>`
  ]));
  assert.equal(win.getVisibleTeamInboxName(), 'Real Name');
});

test('recipients: null container gives an empty array', () => {
  const win = load('');
  assert.deepEqual(Array.from(win.getEmailMetadataRecipients(null)), []);
});

test('recipients: collapsed metadata without an address gives an empty array', () => {
  const win = load(fx.emailMetadataContainer('To: everyone, Cc: nobody'));
  const container = win.document.querySelector('[data-testid="email-metadata-container"]');
  assert.deepEqual(Array.from(win.getEmailMetadataRecipients(container)), []);
});

test('recipients: repeated address with different case is returned once, lower-cased', () => {
  const win = load(fx.emailMetadataContainer('To: Anna@Example.com, bob@example.com; cc ANNA@example.com'));
  const container = win.document.querySelector('[data-testid="email-metadata-container"]');
  assert.deepEqual(Array.from(win.getEmailMetadataRecipients(container)).sort(),
    ['anna@example.com', 'bob@example.com']);
});

const AVATAR = '<div class="flex flex-row gap-1"><div class="flex flex-col items-end"><div class="inbox2__avatar">A</div></div></div>';
const ROW = (inner) => `<div data-intercom-target-conversation-list=""><a href="/x/conversation/1001" data-conversation-id="1001">${AVATAR}${inner}</a></div>`;
const NAME = '<div class="text-sm leading-4 line-clamp-1 break-all font-semibold min-w-0">Liv</div>';

function trayFor(inner) {
  const win = load(ROW(inner));
  const row = win.document.querySelector('a[data-conversation-id]');
  return { win, row, avatar: row.querySelector('.inbox2__avatar'), tray: win.rowChipTray(row) };
}

test('chip tray without a name element goes into the avatar parent, not the row', () => {
  const { row, avatar, tray } = trayFor('');
  assert.ok(tray);
  assert.equal(tray.parentElement, avatar.parentElement);
  assert.notEqual(tray.parentElement, row);
});

test('chip tray with a name element directly under the row goes into the avatar parent', () => {
  const { row, avatar, tray } = trayFor(NAME);
  assert.ok(tray);
  assert.equal(tray.parentElement, avatar.parentElement);
  assert.notEqual(tray.parentElement, row);
});

test('calling rowChipTray twice leaves exactly one tray', () => {
  const { win, row, tray } = trayFor('');
  const second = win.rowChipTray(row);
  assert.equal(tray, second);
  assert.equal(row.querySelectorAll(`.${tray.classList[0]}`).length, 1);
});

test('a legacy row without a value column still yields its value', () => {
  const win = load(fx.userDetailsSection([
    `<div class="flex flex-row items-center h-8">
      <p class="inbox2__attribute__label"><span class="truncate">Location</span></p>
      <p><span class="u__one-truncated-line">Celje</span></p>
    </div>`
  ]));
  assert.equal(win.getAttributeValueByLabel('Location', ['.u__one-truncated-line']), 'Celje');
});

test('a React sidebar id with a prefix before the digits is not read as an id', () => {
  const win = load(fx.reactSidebarSection({ conversationId: '#789' }));
  assert.equal(win.sidebarLagsConversation(), false);
});

test('a React attribute row nested inside another counts once, as the inner row', () => {
  const win = load(REACT_SECTION(`<div data-test-attribute-row="outer">
      <div data-test-attribute-row="inner"><span data-test-attribute-label="inner">Brand</span></div>
    </div>`));
  const rows = win.getAttributeRows().filter(row => row.hasAttribute('data-test-attribute-row'));
  assert.deepEqual([...rows].map(row => row.getAttribute('data-test-attribute-row')), ['inner']);
});
