'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');
const {
  TEAM,
  TAMSIN,
  MERROW,
  build,
  row,
  chipText,
  CONTACT_A
} = require('../support/duplicate-conversations-harness');

const ORIGIN = 'https://app.intercom.com';
const CONVERSATION_ID = '900202944780104';
const CONVERSATION_URL = `${ORIGIN}/a/inbox/demo1234/inbox/team/90009637/conversation/${CONVERSATION_ID}`;
const ISOLATED_URL = `${ORIGIN}/a/inbox/team/123/conversation/456`;
const MAILBOX_TEAM = '90009672';
const MAILBOX_CONVERSATION_ID = '900202944780103';

const noop = () => {};
const digits = (length) => '1'.repeat(length);
const emailOfLength = (length) => `${'a'.repeat(length - '@example.com'.length)}@example.com`;
const plain = (value) => JSON.parse(JSON.stringify(value));

function deliver(win, data) {
  win.dispatchEvent(new win.MessageEvent('message', { data, source: win, origin: ORIGIN }));
}

function runTable({ fresh, observe, envelope, valid, invalid }) {
  const baseline = observe(fresh());
  for (const [label, over] of valid) {
    const win = fresh();
    deliver(win, { ...envelope, ...over });
    assert.notDeepEqual(observe(win), baseline, `valid: ${label}`);
  }
  for (const [label, over] of invalid) {
    const win = fresh();
    deliver(win, over === null || typeof over !== 'object' || Array.isArray(over) ? over : { ...envelope, ...over });
    assert.deepEqual(observe(win), baseline, `invalid: ${label}`);
  }
}

const shellInvalid = [
  ['null', null],
  ['string', 'conversation-team'],
  ['number', 42],
  ['array', []],
  ['marker missing', { __isaic: undefined }],
  ['marker string true', { __isaic: 'true' }],
  ['marker 1', { __isaic: 1 }],
  ['marker false', { __isaic: false }],
  ['version 2', { version: 2 }],
  ['version string 1', { version: '1' }],
  ['version missing', { version: undefined }],
  ['version 0', { version: 0 }],
  ['unknown kind', { kind: 'unknown-kind' }]
];

const conversationIdInvalid = [
  ['conversationId trailing letter', { conversationId: '12a' }],
  ['conversationId leading letter', { conversationId: 'a12' }],
  ['conversationId number', { conversationId: 456 }],
  ['conversationId empty', { conversationId: '' }],
  ['conversationId missing', { conversationId: undefined }],
  ['source other', { source: 'other' }],
  ['source wrong case', { source: 'Summary' }],
  ['source missing', { source: undefined }]
];

const isolated = () => loadExtension(fx.inboxHtml({}), { url: ISOLATED_URL });

const teamEnvelope = {
  __isaic: true,
  version: 1,
  kind: 'conversation-team',
  conversationId: '456',
  teamId: '900201',
  source: 'summary'
};

test('shell and conversation fields: conversation-team stores only well-formed envelopes', () => {
  runTable({
    fresh: isolated,
    observe: (win) => win.eval('networkTeamByConversation.size'),
    envelope: teamEnvelope,
    valid: [['baseline', {}], ['source stream', { source: 'stream' }]],
    invalid: [...shellInvalid, ...conversationIdInvalid]
  });
});

test('conversation-team teamId allows 20 digits and rejects every other shape', () => {
  runTable({
    fresh: isolated,
    observe: (win) => win.eval('networkTeamByConversation.size'),
    envelope: teamEnvelope,
    valid: [['1 digit', { teamId: '1' }], ['20 digits', { teamId: digits(20) }]],
    invalid: [
      ['trailing letter', { teamId: '12a' }],
      ['leading letter', { teamId: 'a12' }],
      ['21 digits', { teamId: digits(21) }],
      ['empty', { teamId: '' }],
      ['number', { teamId: 900201 }],
      ['missing', { teamId: undefined }],
      ['trailing newline', { teamId: '12\n' }]
    ]
  });
});

test('conversation-language allows 64 characters of [A-Za-z0-9 _-] and nothing else', () => {
  runTable({
    fresh: isolated,
    observe: (win) => win.eval('networkLanguageByConversation.size'),
    envelope: {
      __isaic: true,
      version: 1,
      kind: 'conversation-language',
      conversationId: '456',
      language: 'German',
      source: 'stream'
    },
    valid: [
      ['baseline', {}],
      ['64 characters', { language: 'German'.padEnd(64, ' ') }]
    ],
    invalid: [
      ['65 characters', { language: 'German'.padEnd(65, ' ') }],
      ['trailing bang', { language: 'German!' }],
      ['leading bang', { language: '!German' }],
      ['number', { language: 12 }],
      ['missing', { language: undefined }]
    ]
  });
});

function loadHiddenBrandSidebar() {
  const win = loadExtension(fx.inboxHtml({
    sidebar: fx.sidebarSection({ teamInbox: 'Shared Desk East', conversationAttrs: [] }),
    userDetails: fx.userDetailsSection([
      fx.userDetailRow('Email', fx.emailValue('elske.arden@example.com')),
      fx.userDetailRow('User id', fx.userIdValue('900801_quayside'))
    ])
  }), { url: CONVERSATION_URL });
  win.console.warn = noop;
  win.console.debug = noop;
  return win;
}

function loadTruncatedSidebar() {
  return loadExtension(fx.inboxHtml({
    sidebar: fx.sidebarSection({ teamInbox: 'Shared Desk East', conversationAttrs: [] }),
    userDetails: fx.userDetailsSection([fx.userDetailRow('Location', '<span>Lindau, Germany</span>')])
  }), { url: CONVERSATION_URL });
}

test('conversation-identity email must be a 254-character-or-shorter local@example.com without whitespace', () => {
  runTable({
    fresh: loadTruncatedSidebar,
    observe: (win) => win.getCustomerEmail(),
    envelope: {
      __isaic: true,
      version: 1,
      kind: 'conversation-identity',
      conversationId: CONVERSATION_ID,
      email: 'elske.arden@example.com',
      source: 'summary'
    },
    valid: [['baseline', {}], ['254 characters', { email: emailOfLength(254) }], ['minimal', { email: 'a@b.c' }]],
    invalid: [
      ...shellInvalid,
      ...conversationIdInvalid,
      ['255 characters', { email: emailOfLength(255) }],
      ['no dot', { email: 'a@b' }],
      ['leading space', { email: ' a@b.c' }],
      ['trailing space', { email: 'a@b.c ' }],
      ['trailing newline', { email: 'a@b.c\n' }],
      ['two at signs', { email: 'a@b@c.d' }],
      ['dot opens the domain', { email: 'a@.b.c' }],
      ['null', { email: null }],
      ['missing', { email: undefined }],
      ['number', { email: 12 }]
    ]
  });
});

function loadMailboxWindow() {
  const win = loadExtension(fx.inboxHtml({
    sidebar: fx.sidebarSection({ teamInbox: 'Shared Desk North', conversationAttrs: [] }),
    userDetails: fx.userDetailsSection([
      fx.userDetailRow('Email', fx.emailValue('anselm.sample@example.com')),
      fx.userDetailRow('User id', fx.userIdValue('C23250'))
    ]),
    conversation: fx.conversationSpace({ customerText: 'Hallo' }),
    composer: fx.composer({ mode: 'email' })
  }), { url: `${ORIGIN}/a/inbox/demo1234/inbox/team/${MAILBOX_TEAM}/conversation/${MAILBOX_CONVERSATION_ID}` });
  win.console.warn = noop;
  win.console.debug = noop;
  return win;
}

const listState = (win) => win.networkListStateForCurrentInbox();

test('inbox-list-state accepts a state of up to 16 characters of [a-z_] as a whole string', () => {
  runTable({
    fresh: () => build([row('1', TAMSIN)]),
    observe: listState,
    envelope: {
      __isaic: true,
      version: 1,
      kind: 'inbox-list-state',
      inboxType: 'team',
      inboxId: TEAM,
      inboxKey: `team:${TEAM}`,
      state: 'open'
    },
    valid: [['baseline', {}], ['16 characters', { state: 'a'.repeat(16) }]],
    invalid: [
      ...shellInvalid,
      ['17 characters', { state: 'a'.repeat(17) }],
      ['trailing bang', { state: 'open!' }],
      ['leading bang', { state: '!open' }],
      ['uppercase', { state: 'Open' }],
      ['empty', { state: '' }],
      ['number', { state: 1 }],
      ['missing', { state: undefined }]
    ]
  });
});

const hex24 = (n) => n.toString(16).padStart(24, '0');

function identityEnvelope(entries, over = {}) {
  return {
    __isaic: true,
    version: 1,
    kind: 'inbox-list-identity',
    inboxType: 'team',
    inboxId: TEAM,
    inboxKey: `team:${TEAM}:open`,
    state: 'open',
    identities: entries,
    ...over
  };
}

test('inbox-list-identity rejects the whole envelope on any bad entry or field', () => {
  const pair = [
    { conversationId: '1', contactId: CONTACT_A },
    { conversationId: '2', contactId: CONTACT_A }
  ];
  const withEntry = (entry) => ({ identities: [...pair, entry] });
  const crowd = (count) => [
    ...pair,
    ...Array.from({ length: count - 2 }, (_, i) => ({ conversationId: String(1000 + i), contactId: hex24(i + 1) }))
  ];
  runTable({
    fresh: () => build([row('1', TAMSIN), row('2', MERROW)]),
    observe: (win) => chipText(win, '1'),
    envelope: identityEnvelope(pair),
    valid: [
      ['baseline', {}],
      ['200 entries', { identities: crowd(200) }],
      ['email present and valid', { identities: pair.map((entry) => ({ ...entry, email: 'a@b.c' })) }],
      ['20-digit conversationId', withEntry({ conversationId: digits(20), contactId: hex24(9) })]
    ],
    invalid: [
      ...shellInvalid,
      ['201 entries', { identities: crowd(201) }],
      ['empty array', { identities: [] }],
      ['25-hex contactId', withEntry({ conversationId: '3', contactId: `${hex24(9)}a` })],
      ['23-hex contactId', withEntry({ conversationId: '3', contactId: hex24(9).slice(1) })],
      ['uppercase hex contactId', withEntry({ conversationId: '3', contactId: hex24(10).replace('a', 'A') })],
      ['non-hex contactId', withEntry({ conversationId: '3', contactId: `${hex24(9).slice(1)}g` })],
      ['conversationId trailing letter', withEntry({ conversationId: '12a', contactId: hex24(9) })],
      ['21-digit conversationId', withEntry({ conversationId: digits(21), contactId: hex24(9) })],
      ['bad email entry', withEntry({ conversationId: '3', contactId: hex24(9), email: 'a@b' })],
      ['255-character email entry', withEntry({ conversationId: '3', contactId: hex24(9), email: emailOfLength(255) })],
      ['non-array identities', { identities: 'x' }]
    ]
  });
});

const RECIPIENT = 'Klaus Wexley';
const RECIPIENT_ID = '900fcbb36062854afdf312d1';

function loadDraft() {
  const markup = `<div data-testid="new-conversation-view">
    <div data-testid="new-conversation-channel-picker">
      <button type="button" aria-label="Select channel" data-testid="dropdown-menu-trigger"><span><span>Email</span></span></button>
    </div>
    <div data-testid="composer-sender-area">
      <button type="button" data-test-sender-pill="true"><span>Support Kestrel Kids</span><span>help@kestrel-kids.example</span></button>
    </div>
    <div data-testid="recipient-to-input"><div data-test-recipient-pill="true"><span>${RECIPIENT}</span></div></div>
    <div data-testid="draft-team-assignee"><button type="button" data-testid="team-assignee-selector"><span><span class="ml-2">Support Kestrel Kids</span></span></button></div>
    <div data-testid="composer-orchestrator">
      <div data-testid="composer-editor-area"><div class="tiptap ProseMirror" contenteditable="true"><p></p></div></div>
      <div data-testid="composer-actions-bar"><div class="bar-first"></div><div class="bar-second"></div></div>
    </div>
  </div>`;
  const win = loadExtension(
    '<!doctype html><html><body><div id="teammate-app-react"></div></body></html>',
    {
      url: `${ORIGIN}/a/inbox/demo1234/inbox/new-conversation?view=List`,
      beforeScripts(w) {
        w.document.getElementById('teammate-app-react').attachShadow({ mode: 'open' }).innerHTML = markup;
      }
    }
  );
  win.refreshComposerLanguagePicker();
  return win;
}

test('contact-language bounds userId, the two language strings and the country code', () => {
  runTable({
    fresh: loadDraft,
    observe: (win) => win.draftSignatureLanguage(),
    envelope: {
      __isaic: true,
      version: 1,
      kind: 'contact-language',
      userId: RECIPIENT_ID,
      languageOverride: 'de',
      browserLocale: null,
      countryCode: null
    },
    valid: [
      ['baseline', {}],
      ['40-character userId', { userId: 'a'.repeat(40) }],
      ['64-character browserLocale', { browserLocale: 'b'.repeat(64) }],
      ['valid country', { countryCode: 'DE' }],
      ['undefined optionals', { browserLocale: undefined, countryCode: undefined }]
    ],
    invalid: [
      ...shellInvalid,
      ['41-character userId', { userId: 'a'.repeat(41) }],
      ['userId with trailing bang', { userId: `${RECIPIENT_ID}!` }],
      ['userId with leading bang', { userId: `!${RECIPIENT_ID}` }],
      ['userId number', { userId: 12 }],
      ['countryCode PLX', { countryCode: 'PLX' }],
      ['countryCode pl', { countryCode: 'pl' }],
      ['countryCode XPL', { countryCode: 'XPL' }],
      ['countryCode one letter', { countryCode: 'P' }],
      ['65-character browserLocale', { browserLocale: 'b'.repeat(65) }],
      ['65-character languageOverride', { languageOverride: 'd'.repeat(65) }],
      ['browserLocale trailing bang', { browserLocale: 'de!' }],
      ['browserLocale number', { browserLocale: 5 }]
    ]
  });
});

function bridgeWindow() {
  return loadExtension(fx.inboxHtml());
}

const directoryObserve = (win) => JSON.stringify(plain(win.teamDirectorySnapshot()));

const directoryEnvelope = {
  __isaic: true,
  version: 1,
  kind: 'team-directory',
  teams: [{ id: '42', name: 'Support Kept' }]
};

test('team-directory bounds the list, the ids, the names and observedAt', () => {
  const teams = (count) => Array.from({ length: count }, (_, i) => ({ id: String(1000 + i), name: `Team ${i}` }));
  const earlier = () => ({ observedAt: Date.now() - 60000 });
  runTable({
    fresh: bridgeWindow,
    observe: directoryObserve,
    envelope: directoryEnvelope,
    valid: [
      ['baseline', {}],
      ['2000 teams', { teams: teams(2000) }],
      ['120-character name', { teams: [{ id: '1', name: 'N'.repeat(120) }] }],
      ['20-digit id', { teams: [{ id: digits(20), name: 'Long id' }] }],
      ['observedAt 0', { observedAt: 0 }],
      ['observedAt in the past', earlier()]
    ],
    invalid: [
      ...shellInvalid,
      ['2001 teams', { teams: teams(2001) }],
      ['empty teams', { teams: [] }],
      ['121-character name', { teams: [{ id: '1', name: 'N'.repeat(121) }] }],
      ['empty name', { teams: [{ id: '1', name: '' }] }],
      ['name with newline', { teams: [{ id: '1', name: 'Line\nBreak' }] }],
      ['name with bell', { teams: [{ id: '1', name: 'Bad\u0007Bell' }] }],
      ['21-digit id', { teams: [{ id: digits(21), name: 'Long id' }] }],
      ['id trailing letter', { teams: [{ id: '12a', name: 'Letters' }] }],
      ['numeric id', { teams: [{ id: 12, name: 'Number' }] }],
      ['one bad team among good ones', { teams: [{ id: '1', name: 'Good' }, { id: '2', name: '' }] }],
      ['negative observedAt', { observedAt: -1 }],
      ['future observedAt', { observedAt: Date.now() + 60000 }],
      ['NaN observedAt', { observedAt: NaN }],
      ['Infinity observedAt', { observedAt: Infinity }],
      ['string observedAt', { observedAt: String(Date.now() - 1000) }]
    ]
  });
});
