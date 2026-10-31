'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

const ORIGIN = 'https://app.intercom.com';
const NEW_CONVERSATION_URL = `${ORIGIN}/a/inbox/demo1234/inbox/new-conversation?view=List`;
const RECIPIENT_ID = '900fcbb36062854afdf312d1';
const GERMAN_TEXT = 'Guten Tag, ich habe eine Frage zu meinem Konto und bitte um Hilfe, danke.';
const ITALIAN_TEXT = 'Buongiorno, il pacco è arrivato ma la scatola era rotta, per favore potete mandarmi un sostituto, grazie mille.';
const EMPTY = '<p></p>';

function replyUrl(teamId, conversationId) {
  return `${ORIGIN}/a/inbox/demo1234/inbox/team/${teamId}/conversation/${conversationId}`;
}

function loadReply({ teamInbox, brand, url, customerText = 'Hello' }) {
  const attrs = brand ? [fx.conversationAttrRow('9307', 'Brand', brand)] : [];
  return loadExtension(fx.inboxHtml({
    sidebar: fx.sidebarSection({ teamInbox, conversationAttrs: attrs }),
    conversation: fx.conversationSpace({ customerText }),
    composer: fx.composer({ mode: 'email' })
  }), { url });
}

function replyEditor(win) {
  return win.document.querySelector('[contenteditable="true"]');
}

test('reply: conflicting brand signals insert no signature', () => {
  const win = loadReply({
    teamInbox: 'Support Alderpoint',
    brand: 'Alderpoint',
    url: replyUrl('900202', '456')
  });
  const info = win.detectInboxType();
  assert.equal(info.type, 'company');
  assert.equal(info.name, 'Alderpoint');
  assert.equal(info.signatureSafe, false);

  const editor = replyEditor(win);
  win.insertSignature(editor);
  assert.equal(editor.innerHTML, EMPTY);
});

test('reply control: the same company without a conflict inserts its signature', () => {
  const win = loadReply({
    teamInbox: 'Support Alderpoint',
    brand: 'Alderpoint',
    url: replyUrl('900201', '456')
  });
  const info = win.detectInboxType();
  assert.equal(info.name, 'Alderpoint');
  assert.equal(info.signatureSafe, true);

  const editor = replyEditor(win);
  win.insertSignature(editor);
  assert.ok(editor.innerHTML.toLowerCase().includes('alderpoint'), editor.innerHTML);
});

test('reply: a team-signature inbox inserts the Customer Care signature', () => {
  const win = loadReply({
    teamInbox: 'Returns',
    url: replyUrl('9001983', '456')
  });
  const info = win.detectInboxType();
  assert.equal(info.type, 'team');

  const editor = replyEditor(win);
  win.insertSignature(editor);
  assert.ok(editor.innerHTML.includes('Support Desk'), editor.innerHTML);
});

function openConversation(win, conversationId, customerText) {
  const stream = win.document.querySelector('[data-intercom-target="conversation-space"]');
  const holder = win.document.createElement('div');
  holder.innerHTML = fx.conversationSpace({ customerText });
  stream.replaceWith(holder.firstElementChild);
  win.history.replaceState({}, '', replyUrl('900207', conversationId));
  win.handleConversationChange();
}

test('reply: a customer language detected in conversation A is not reused for conversation B', () => {
  const win = loadReply({
    teamInbox: 'Support Orchard Kitchen',
    url: replyUrl('900207', '456'),
    customerText: GERMAN_TEXT
  });
  const editor = replyEditor(win);
  win.insertSignature(editor);
  assert.match(editor.innerHTML, /Kundenservice bei/, 'A is German');

  editor.innerHTML = EMPTY;
  openConversation(win, '457', ITALIAN_TEXT);
  win.insertSignature(replyEditor(win));

  assert.match(replyEditor(win).innerHTML, /Assistenza clienti presso/, replyEditor(win).innerHTML);
  assert.doesNotMatch(replyEditor(win).innerHTML, /Kundenservice bei/);
});

test('reply control: conversation A alone signs in Italian when its customer writes Italian', () => {
  const win = loadReply({
    teamInbox: 'Support Orchard Kitchen',
    url: replyUrl('900207', '456'),
    customerText: ITALIAN_TEXT
  });
  const editor = replyEditor(win);
  win.insertSignature(editor);
  assert.match(editor.innerHTML, /Assistenza clienti presso/);
});

function loadDraft({ senderName = 'Support Kestrel Kids', senderEmail = 'help@kestrel-kids.example', teamInbox = 'Support Kestrel Kids', recipient = 'Klaus Wexley' } = {}) {
  const markup = `<div data-testid="new-conversation-view">
    <div data-testid="new-conversation-channel-picker">
      <button type="button" aria-label="Select channel" data-testid="dropdown-menu-trigger"><span><span>Email</span></span></button>
    </div>
    <div data-testid="composer-sender-area">
      <button type="button" data-test-sender-pill="true"><span>${senderName}</span><span>${senderEmail}</span></button>
    </div>
    <div data-testid="recipient-to-input"><div data-test-recipient-pill="true"><span>${recipient}</span></div></div>
    <div data-testid="draft-team-assignee"><button type="button" data-testid="team-assignee-selector"><span><span class="ml-2">${teamInbox}</span></span></button></div>
    <div data-testid="composer-orchestrator">
      <div data-testid="composer-editor-area"><div class="tiptap ProseMirror" contenteditable="true"><p></p></div></div>
      <div data-testid="composer-actions-bar"><div class="bar-first"></div><div class="bar-second"></div></div>
    </div>
  </div>`;
  return loadExtension(
    '<!doctype html><html><body><div id="teammate-app-react"></div></body></html>',
    {
      url: NEW_CONVERSATION_URL,
      beforeScripts(win) {
        win.document.getElementById('teammate-app-react').attachShadow({ mode: 'open' }).innerHTML = markup;
      }
    }
  );
}

function shadowOf(win) {
  return win.document.getElementById('teammate-app-react').shadowRoot;
}

function deliverContact(win, over = {}) {
  win.dispatchEvent(new win.MessageEvent('message', {
    data: {
      __isaic: true,
      version: 1,
      kind: 'contact-language',
      userId: RECIPIENT_ID,
      languageOverride: null,
      browserLocale: null,
      countryCode: null,
      ...over
    },
    source: win,
    origin: ORIGIN
  }));
}

function draftLanguage(tokens) {
  const win = loadDraft();
  deliverContact(win, tokens);
  return win.draftSignatureLanguage();
}

test('draft language: an override wins over the browser locale and the country', () => {
  assert.equal(draftLanguage({ languageOverride: 'fr', browserLocale: 'it-IT', countryCode: 'DE' }), 'french');
});

test('draft language: an English browser locale falls through to the country', () => {
  assert.equal(draftLanguage({ browserLocale: 'en-GB', countryCode: 'FR' }), 'french');
});

function pickInbox(options, name) {
  const win = loadDraft(options);
  win.observeDraftTeamInbox();
  shadowOf(win).querySelector('[data-testid="team-assignee-selector"] .ml-2').textContent = name;
  return win;
}

function signDraft(win) {
  const editor = shadowOf(win).querySelector('.tiptap.ProseMirror[contenteditable="true"]');
  editor.dispatchEvent(new win.MouseEvent('click', { bubbles: true, composed: true, cancelable: true, button: 0 }));
  return editor.innerHTML;
}

const ALDERPOINT = { senderName: 'Support Alderpoint', senderEmail: 'help@alderpoint.example', teamInbox: 'Support Alderpoint' };

test('draft: a hand-picked team-signature inbox signs as the team, not the sender brand', () => {
  const html = signDraft(pickInbox(ALDERPOINT, 'Billing'));
  assert.ok(html.includes('Support Desk'), html);
  assert.ok(!html.toLowerCase().includes('alderpoint'), html);
});

test('draft: a hand-picked Team Inbox naming a company without signature config falls back to the sender signature', () => {
  const html = signDraft(pickInbox(ALDERPOINT, 'Support Zzzunknown Brand')).toLowerCase();
  assert.ok(html.includes('alderpoint'), html);
});
