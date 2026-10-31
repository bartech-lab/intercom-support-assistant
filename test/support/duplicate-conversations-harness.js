'use strict';

const test = require('node:test');

const fs = require('node:fs');

const path = require('node:path');

const { loadExtension, hydrateShadowRoots } = require('./helpers');

const fx = require('./fixtures');

const TEAM = '900202';

const inboxUrl = `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/900?view=List`;

const TAMSIN = 'tamsin sorrel';

const MERROW = 'david merrow';

const WREN = 'Wren Gosling';

const MODERN_FIXTURE = path.join(__dirname, 'fixtures', 'modern-duplicate-list.html');

function build(rows, { url = inboxUrl, state = 'Open', count = '27' } = {}) {
  return loadExtension(
    fx.inboxHtml({
      list: fx.conversationList(rows, { state, count }),
      composer: fx.composer({ mode: 'email' })
    }),
    { url }
  );
}

const row = (conversationId, name, extra = {}) =>
  fx.conversationListRow({ conversationId, name, teamId: TEAM, ...extra });

const rowFor = (win, conversationId) =>
  win.document.querySelector(`a[data-conversation-id="${conversationId}"]`);

const isMarked = (win, conversationId) =>
  rowFor(win, conversationId).classList.contains('isa-duplicate-customer-row');

const chipText = (win, conversationId) => {
  const chip = rowFor(win, conversationId).querySelector('.isa-duplicate-customer-chip');
  return chip ? chip.textContent : null;
};

function buildModern({ state = 'Open' } = {}) {
  const html = fs.readFileSync(MODERN_FIXTURE, 'utf8');
  return loadExtension(html, {
    url: inboxUrl,
    beforeScripts(win) {
      hydrateShadowRoots(win.document);
      const trigger = win.document.getElementById('teammate-app-react').shadowRoot
        .querySelector('[data-testid="state-filter-trigger"]');
      trigger.textContent = `4 ${state}`;
    }
  });
}

function modernRows(win) {
  return [...win.document.getElementById('teammate-app-react').shadowRoot
    .querySelectorAll('a[data-conversation-id]')];
}

const CONTACT_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';

const CONTACT_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';

function deliverIdentities(win, pairs, { inboxId = TEAM, origin = 'https://app.intercom.com', state = 'open' } = {}) {
  win.dispatchEvent(new win.MessageEvent('message', {
    source: win,
    origin,
    data: {
      __isaic: true,
      version: 1,
      kind: 'inbox-list-identity',
      inboxType: 'team',
      inboxId,
      state,
      inboxKey: `team:${inboxId}:${state}`,
      identities: pairs.map(([conversationId, contactId, email]) => (email === undefined
        ? { conversationId, contactId }
        : { conversationId, contactId, email }))
    }
  }));
}

module.exports = {
  TEAM,
  inboxUrl,
  TAMSIN,
  MERROW,
  WREN,
  build,
  row,
  rowFor,
  isMarked,
  chipText,
  buildModern,
  modernRows,
  CONTACT_A,
  CONTACT_B,
  deliverIdentities,
};
