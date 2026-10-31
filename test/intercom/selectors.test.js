'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

test('getVisibleTeamInboxName reads the Team Inbox sidebar row', () => {
  const win = loadExtension(fx.inboxHtml({
    sidebar: fx.sidebarSection({ teamInbox: 'Support Sample' })
  }));
  assert.equal(win.getVisibleTeamInboxName().trim(), 'Support Sample');
});

test('getCustomerEmail reads the Email user-details row', () => {
  const win = loadExtension(fx.inboxHtml({
    userDetails: fx.userDetailsSection([
      fx.userDetailRow('Email', fx.emailValue('customer@example.com'))
    ])
  }));
  assert.equal(win.getCustomerEmail(), 'customer@example.com');
});

function loadMultiRecipientInbox({ teamInbox = 'Support Brightwell', brand = 'Brightwell', metadata = [] } = {}) {
  return loadExtension(fx.inboxHtml({
    sidebar: fx.sidebarSection({
      teamInbox,
      conversationAttrs: brand ? [fx.conversationAttrRow('3001', 'Brand', brand)] : []
    }),
    conversation: metadata.join('\n')
  }));
}

test('highlights a multi-recipient email metadata container when context is resolved', () => {
  const win = loadMultiRecipientInbox({
    metadata: [fx.emailMetadataContainer('To: help@brightwell.example; Cc: bram@example.org')]
  });
  const container = win.document.querySelector('[data-testid="email-metadata-container"]');

  assert.equal(container.classList.contains('isa-multi-recipient-email-highlight'), true);
});

test('leaves a single-recipient email metadata container unhighlighted', () => {
  const win = loadMultiRecipientInbox({
    metadata: [fx.emailMetadataContainer('To: help@brightwell.example')]
  });
  const container = win.document.querySelector('[data-testid="email-metadata-container"]');

  assert.equal(container.classList.contains('isa-multi-recipient-email-highlight'), false);
});

test('fails closed without either Team Inbox or Brand context', () => {
  for (const context of [
    { teamInbox: null, brand: 'Brightwell' },
    { teamInbox: 'Support Brightwell', brand: null }
  ]) {
    const win = loadMultiRecipientInbox({
      ...context,
      metadata: [fx.emailMetadataContainer('To: help@brightwell.example; Cc: bram@example.org')]
    });
    const container = win.document.querySelector('[data-testid="email-metadata-container"]');

    assert.equal(container.classList.contains('isa-multi-recipient-email-highlight'), false);
  }
});

test('deduplicates email addresses case-insensitively', () => {
  const win = loadMultiRecipientInbox({
    metadata: [fx.emailMetadataContainer('To: HELP@brightwell.example; Cc: help@brightwell.example')]
  });
  const container = win.document.querySelector('[data-testid="email-metadata-container"]');

  assert.deepEqual([...win.getEmailMetadataRecipients(container)], ['help@brightwell.example']);
  assert.equal(container.classList.contains('isa-multi-recipient-email-highlight'), false);
});

test('highlights only metadata blocks with multiple unique recipients', () => {
  const win = loadMultiRecipientInbox({
    metadata: [
      fx.emailMetadataContainer('To: help@brightwell.example; Cc: bram@example.org'),
      fx.emailMetadataContainer('To: help@brightwell.example'),
      fx.emailMetadataContainer('To: first@example.org; Cc: second@example.org')
    ]
  });
  const containers = [...win.document.querySelectorAll('[data-testid="email-metadata-container"]')];

  assert.deepEqual(
    containers.map(container => container.classList.contains('isa-multi-recipient-email-highlight')),
    [true, false, true]
  );
});

test('refreshes the highlight when email metadata rerenders', async () => {
  const win = loadMultiRecipientInbox({
    metadata: [fx.emailMetadataContainer('To: help@brightwell.example; Cc: bram@example.org')]
  });
  const container = win.document.querySelector('[data-testid="email-metadata-container"]');
  const collapsed = container.querySelector('[data-testid="email-metadata-collapsed"]');

  collapsed.textContent = 'To: help@brightwell.example';
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(container.classList.contains('isa-multi-recipient-email-highlight'), false);

  collapsed.textContent = 'To: help@brightwell.example; Cc: bram@example.org';
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(container.classList.contains('isa-multi-recipient-email-highlight'), true);
});

test('injects the multi-recipient style into document and Intercom shadow root', () => {
  const win = loadExtension(fx.inboxHtml({}), {
    beforeScripts(currentWindow) {
      const host = currentWindow.document.createElement('div');
      host.id = 'teammate-app-react';
      const shadowRoot = host.attachShadow({ mode: 'open' });
      shadowRoot.innerHTML = [
        fx.sidebarSection({
          teamInbox: 'Support Brightwell',
          conversationAttrs: [fx.conversationAttrRow('3002', 'Brand', 'Brightwell')]
        }),
        fx.emailMetadataContainer('To: help@brightwell.example; Cc: bram@example.org')
      ].join('');
      currentWindow.document.body.appendChild(host);
    }
  });
  const shadowRoot = win.document.querySelector('#teammate-app-react').shadowRoot;
  const container = shadowRoot.querySelector('[data-testid="email-metadata-container"]');
  const documentStyle = win.document.querySelector('#isa-multi-recipient-email-highlight-style').textContent;
  const shadowStyle = shadowRoot.querySelector('#isa-multi-recipient-email-highlight-style').textContent;

  for (const style of [documentStyle, shadowStyle]) {
    assert.match(style, /\.isa-multi-recipient-email-highlight::before/);
    assert.match(style, /position:\s*relative/);
    assert.match(style, /position:\s*absolute/);
    assert.match(style, /border:\s*2px solid #eab308/);
    assert.match(style, /left:\s*-16px/);
    assert.match(style, /right:\s*-16px/);
    assert.match(style, /pointer-events:\s*none/);
  }
  assert.equal(container.classList.contains('isa-multi-recipient-email-highlight'), true);
});

test('getCompanyFromAttributes resolves a Brand attribute value to a company', () => {
  const win = loadExtension(fx.inboxHtml({
    sidebar: fx.sidebarSection({
      conversationAttrs: [fx.conversationAttrRow('1001', 'Brand', 'Alderpoint')]
    })
  }));
  assert.equal(win.getCompanyFromAttributes(), 'Alderpoint');
});

test('getCompanyFromAttributes resolves a configured alias to its brand', () => {
  const win = loadExtension(fx.inboxHtml({
    sidebar: fx.sidebarSection({
      conversationAttrs: [fx.conversationAttrRow('1002', 'Brand', 'kestrel')]
    })
  }));
  assert.equal(win.getCompanyFromAttributes(), 'Kestrel Kids');
});

test('getComposerMode returns email when the email pane icon is present', () => {
  const win = loadExtension(fx.inboxHtml({ composer: fx.composer({ mode: 'email' }) }));
  assert.equal(win.getComposerMode(), 'email');
});

test('getComposerMode returns note for the note composer', () => {
  const win = loadExtension(fx.inboxHtml({ composer: fx.composer({ mode: 'note' }) }));
  assert.equal(win.getComposerMode(), 'note');
});

test('getComposerMode reads the Messenger Reply pane as chat without a warning', () => {
  const composer = `<div data-testid="composer-orchestrator">
    <button class="group flex items-center gap-1 whitespace-nowrap px-1 py-1.5 text-support-bold" type="button" aria-haspopup="menu" data-state="closed" data-testid="dropdown-menu-trigger"><svg class="inline-block" aria-label="Reply"></svg><span>Reply</span></button>
    <div class="ProseMirror" contenteditable="true"></div>
    <button data-testid="send-button">Send</button>
  </div>`;
  const win = loadExtension(fx.inboxHtml({ composer }));
  const warnings = [];
  win.console.warn = (...args) => warnings.push(args.join(' '));
  assert.equal(win.getComposerMode(), 'chat');
  assert.deepEqual(warnings, []);
});

test('getComposerMode fails closed to unknown when no mode signal exists', () => {
  const win = loadExtension(fx.inboxHtml({ composer: fx.composer({}) }));
  win.console.warn = () => {};
  assert.equal(win.getComposerMode(), 'unknown');
});

test('switching to a conversation that is not in progress clears a stale highlight', () => {
  const win = loadExtension(fx.inboxHtml({ toolbar: fx.conversationToolbar({ close: true }) }));
  const button = win.document.querySelector('svg.o__standard__close-conversation').closest('button');
  button.classList.add('isa-in-progress-highlight');

  win.history.pushState({}, '', 'https://app.intercom.com/a/inbox/team/123/conversation/457');
  win.handleConversationChange();

  assert.equal(button.classList.contains('isa-in-progress-highlight'), false,
    'a conversation switch must clear a highlight left over from a previous conversation, even with no live mutation to trigger the observer pass');
});

test('isInProgressStatus handles status variants and ignores the assignee attribute', () => {
  const cases = [
    { attrs: [fx.conversationAttrRow('2001', 'Escalation Status', 'in progress')], expected: true },
    { attrs: [fx.conversationAttrRow('2002', 'Escalation Status', 'in progress', 'text-muted')], expected: true },
    { attrs: [fx.conversationAttrRow('2003', 'Escalation Status', 'done')], expected: false },
    {
      attrs: [
        fx.conversationAttrRow('2004', 'Handed to', 'in progress'),
        fx.conversationAttrRow('2005', 'Escalation Status', 'done')
      ],
      expected: false
    }
  ];
  for (const { attrs, expected } of cases) {
    const win = loadExtension(fx.inboxHtml({
      sidebar: fx.sidebarSection({ conversationAttrs: attrs })
    }));
    assert.equal(win.isInProgressStatus(), expected);
  }
});

function loadShadowInbox({ status, transferredTo } = {}) {
  return loadExtension(fx.inboxHtml({}), {
    beforeScripts(win) {
      const host = win.document.createElement('div');
      host.id = 'teammate-app-react';
      const shadowRoot = host.attachShadow({ mode: 'open' });
      shadowRoot.innerHTML = [
        fx.conversationHeader(),
        fx.sidebarSection({
          conversationAttrs: [
            transferredTo ? fx.conversationAttrRow('4001', 'Handed to', transferredTo) : '',
            status ? fx.conversationAttrRow('4002', 'Escalation Status', status) : ''
          ]
        })
      ].join('');
      win.document.body.appendChild(host);
    }
  });
}

test('modern shadow-root close button is recognized while status is in progress', () => {
  const win = loadShadowInbox({ status: 'in progress' });
  const button = win.document.querySelector('#teammate-app-react').shadowRoot.querySelector(
    'button[data-test-state-multiselect-close="true"]'
  );
  assert.equal(win.getCloseConversationButton(), button);
  assert.equal(win.isCloseConversationButton(button), true);
  assert.equal(button.classList.contains('isa-in-progress-highlight'), true);
  assert.ok(win.document.querySelector('#isa-in-progress-highlight-style'));
  assert.ok(button.getRootNode().querySelector('#isa-in-progress-highlight-style'));
});

test('modern shadow-root close click is blocked before the button handler runs', () => {
  const win = loadShadowInbox({ status: 'in progress' });
  const button = win.document.querySelector('#teammate-app-react').shadowRoot.querySelector(
    'button[data-test-state-multiselect-close="true"]'
  );
  const alerts = [];
  let closeHandlerRan = false;
  win.alert = message => alerts.push(message);
  button.addEventListener('click', () => { closeHandlerRan = true; });

  const event = new win.MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
  button.dispatchEvent(event);

  assert.equal(event.defaultPrevented, true);
  assert.equal(closeHandlerRan, false);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /Escalation Status/);
});

test('modern shadow-root close is allowed and unhighlighted after status changes', async () => {
  const win = loadShadowInbox({ status: 'in progress' });
  const shadowRoot = win.document.querySelector('#teammate-app-react').shadowRoot;
  const button = shadowRoot.querySelector('button[data-test-state-multiselect-close="true"]');
  const value = shadowRoot.querySelector('#conversation-attr-4002 .u__one-truncated-line');
  value.textContent = 'done';
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(win.isInProgressStatus(), false);
  assert.equal(button.classList.contains('isa-in-progress-highlight'), false);

  let closeHandlerRan = false;
  button.addEventListener('click', () => { closeHandlerRan = true; });
  const event = new win.MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
  button.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
  assert.equal(closeHandlerRan, true);
});

test('Handed to alone never activates the modern close guard', async () => {
  const win = loadShadowInbox({ transferredTo: 'in progress' });
  const shadowRoot = win.document.querySelector('#teammate-app-react').shadowRoot;
  const button = shadowRoot.querySelector('button[data-test-state-multiselect-close="true"]');
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(win.isInProgressStatus(), false);
  assert.equal(button.classList.contains('isa-in-progress-highlight'), false);
  const event = new win.MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
  button.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
});

test('shadow-root re-render refreshes the modern close highlight', async () => {
  const win = loadShadowInbox({ status: 'in progress' });
  const shadowRoot = win.document.querySelector('#teammate-app-react').shadowRoot;
  const header = shadowRoot.querySelector('[data-testid="conversation-header"]');
  const oldButton = header.querySelector('button');
  oldButton.remove();
  const newButton = win.document.createElement('button');
  newButton.dataset.testStateMultiselectClose = 'true';
  newButton.setAttribute('aria-label', 'Close');
  newButton.textContent = 'Close';
  header.appendChild(newButton);
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(newButton.classList.contains('isa-in-progress-highlight'), true);
  assert.equal(header.querySelectorAll('button').length, 1);
});

test('attribute-row cache session returns fresh rows and clears afterward', () => {
  const win = loadExtension(fx.inboxHtml({
    userDetails: fx.userDetailsSection([
      fx.userDetailRow('User id', fx.userIdValue('900111_sample')),
      fx.userDetailRow('Email', fx.emailValue('a@example.com'))
    ])
  }));

  const [first, second] = win.runWithPassCache(() => [
    win.getCustomerEmail(),
    win.getAttributeRows().length
  ]);
  assert.equal(first, 'a@example.com');
  assert.ok(second > 0);

  win.document.querySelector('.popover__opener.truncate').textContent = 'b@example.com';
  const fresh = win.runWithPassCache(() => win.getCustomerEmail());
  assert.equal(fresh, 'b@example.com');
});

test('isLastPartUnresolvedNote recognizes linked tracker notes when they are last', () => {
  const positiveNotes = [
    '<p><a href="https://linear.app/example/issue/SUP-123">https://linear.app/example/issue/SUP-123</a></p>',
    '<p><a href="https://example.slack.com/archives/C0EXAMPLE01/p178">https://example.slack.com/archives/C0EXAMPLE01/p178</a></p>',
    '<p><a href="https://example.atlassian.net/browse/SUP-101">SUP-101</a></p>',
    '<p>escalated: https://jira.example.com/browse/SUP-1</p>'
  ];
  for (const noteHtml of positiveNotes) {
    const win = loadExtension(fx.inboxHtml({
      conversation: fx.conversationSpace({ noteHtml })
    }));
    assert.equal(win.isLastPartUnresolvedNote(), true, noteHtml);
  }
});

test('isLastPartUnresolvedNote rejects missing or non-final linked notes', () => {
  const negativeCases = [
    { conversation: fx.conversationSpace({ customerText: 'Hello', noteHtml: '<p>refund queued/ label printed/ courier booked</p>' }) },
    {
      conversation: fx.conversationSpace({
        customerText: 'Any update on my case?',
        noteHtml: '<p><a href="https://example.slack.com/archives/C1/p1">slack</a></p>',
        notePosition: 'first'
      })
    },
    {}
  ];
  for (const sections of negativeCases) {
    const win = loadExtension(fx.inboxHtml(sections));
    assert.equal(win.isLastPartUnresolvedNote(), false);
  }
});

test('close click is blocked when the last part is a linked note; snooze is not', () => {
  const win = loadExtension(fx.inboxHtml({
    toolbar: fx.conversationToolbar({ close: true, snooze: true }),
    conversation: fx.conversationSpace({
      noteHtml: '<p><a href="https://example.slack.com/archives/C1/p1">slack</a></p>'
    })
  }));
  const alerts = [];
  win.alert = message => alerts.push(message);

  const doc = win.document;
  const clickOn = button => {
    const event = new win.MouseEvent('click', { bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    return event;
  };

  const closeButton = doc.querySelector('svg.o__standard__close-conversation').closest('button');
  const closeEvent = clickOn(closeButton);
  assert.equal(closeEvent.defaultPrevented, true);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /internal note with a Slack, Jira, or Linear link/);

  const snoozeButton = doc.querySelector('svg.o__standard__snooze').closest('button');
  const snoozeEvent = clickOn(snoozeButton);
  assert.equal(snoozeEvent.defaultPrevented, false);
  assert.equal(alerts.length, 1);
});

test('close click stays blocked by the in-progress guard (message urgent)', () => {
  const win = loadExtension(fx.inboxHtml({
    toolbar: fx.conversationToolbar({ close: true }),
    sidebar: fx.sidebarSection({
      conversationAttrs: [fx.conversationAttrRow('3001', 'Escalation Status', 'in progress')]
    }),
    conversation: fx.conversationSpace({
      noteHtml: '<p><a href="https://example.slack.com/archives/C1/p1">slack</a></p>'
    })
  }));
  const alerts = [];
  win.alert = message => alerts.push(message);

  const closeButton = win.document.querySelector('svg.o__standard__close-conversation').closest('button');
  const event = new win.MouseEvent('click', { bubbles: true, cancelable: true });
  closeButton.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.match(alerts[0], /Escalation Status/);
});

test('the Language attribute is read by label, not by a slug id', () => {
  const win = loadExtension(fx.inboxHtml({
    sidebar: fx.sidebarSection({
      teamInbox: 'Support Brightwell',
      conversationAttrs: [
        fx.conversationAttrRow('9006335', 'Topics', 'Refund request'),
        fx.conversationAttrRow('9002817', 'Language', 'French')
      ]
    })
  }));

  assert.equal(win.getAttributeValueByLabel('Language', ['.u__one-truncated-line']), 'French');
});

test('the "Language override" contact attribute is not mistaken for Language', () => {
  const win = loadExtension(fx.inboxHtml({
    sidebar: fx.sidebarSection({
      teamInbox: 'Support Brightwell',
      conversationAttrs: [
        fx.conversationAttrRow('900057', 'Language override', '\u2014'),
        fx.conversationAttrRow('9002817', 'Language', 'French')
      ]
    })
  }));

  assert.equal(win.getAttributeValueByLabel('Language', ['.u__one-truncated-line']), 'French');
});

test('a collapsed attributes panel yields no language rather than a wrong one', () => {
  const win = loadExtension(fx.inboxHtml({
    sidebar: fx.sidebarSection({ teamInbox: 'Support Brightwell', conversationAttrs: [] })
  }));

  assert.equal(win.getAttributeValueByLabel('Language', ['.u__one-truncated-line']), null);
});

test('detectLanguageFromConversation scopes to inbound customer text, not agent replies', () => {
  const win = loadExtension(fx.inboxHtml({
    conversation: fx.conversationSpace({
      customerText: 'Guten Tag, ich habe eine Frage zu meinem Konto und bitte um Hilfe, danke.',
      agentText: 'Hello, thank you for reaching out, best regards from the support team.'
    })
  }));
  assert.equal(win.detectLanguageFromConversation(), 'german');
});

test('a customer part carrying only the inbound class, no testid, is still read', () => {
  const markup = fx.conversationSpace({
    customerText: 'Guten Tag, ich habe eine Frage zu meinem Konto und bitte um Hilfe, danke.'
  }).replace(/data-testid="user-email-content" /, '');
  const win = loadExtension(fx.inboxHtml({ conversation: markup }));

  assert.equal(win.detectLanguageFromConversation(), 'german');
});

test('an admin-initiated conversation with no customer reply yields no language', () => {
  const win = loadExtension(fx.inboxHtml({
    conversation: fx.conversationSpace({
      customerText: '',
      agentText: 'Bonjour Margaux, merci pour votre e-mail. Nous vous confirmons que votre retour a ete accepte.',
      noteHtml: "asked to wait for the refund, it's processed on 10th"
    })
  }));
  assert.equal(win.detectLanguageFromConversation(), null);
});

test('a label wrapped in a div inside a p is still read', () => {
  const win = loadExtension(fx.inboxHtml({
    sidebar: `<div data-intercom-target="inbox-right-nav-details">
      <div class="flex flex-row items-center h-8">
        <p class="inbox2__attribute__label u__one-truncated-line">
          <div class="flex items-center">
            <div class="popover__opener" data-popover-opener="ember1"><span class="truncate">Location</span></div>
          </div>
        </p>
        <p class="flex px-1 w-3/5"><span class="flex"><span class="truncate">6:23 PM &middot; France</span></span></p>
      </div>
    </div>`
  }));

  assert.equal(
    win.getAttributeValueByLabel('Location', ['.w-3\\/5 .truncate']),
    '6:23 PM · France'
  );
});

test('the renamed interblocks class still resolves a note body', () => {
  const win = loadExtension(fx.inboxHtml({
    conversation: `<div data-intercom-target="conversation-space">
      <div class="conversation__note-part">
        <div class="interblocks-html">see https://example.atlassian.net/browse/AB-1</div>
        <div class="part-actions"><button data-testid="content-part-actions-edit-note">Edit</button></div>
      </div>
    </div>`
  }));

  assert.equal(win.isLastPartUnresolvedNote(), true);
});

test('a cold load that detects before the stream renders is not stuck on English', () => {
  const win = loadExtension(fx.inboxHtml({
    conversation: '<div data-intercom-target="conversation-space"></div>'
  }), { url: 'https://app.intercom.com/a/inbox/demo1234/inbox/conversation/900706735484323?view=List' });

  assert.equal(win.activeSignatureLanguage(), 'english');

  win.document.querySelector('[data-intercom-target="conversation-space"]').innerHTML = `
    <div data-testid="teammate-email-reply-part">
      <div class="interblocks-html">
        Bonjour Margaux, merci pour votre e-mail. Nous vous confirmons que votre colis
        a ete expedie aujourd'hui et le numero de suivi vous a ete envoye par e-mail.
      </div>
    </div>`;

  assert.equal(win.activeSignatureLanguage(), 'french');
});

test('an agent-only French thread signs in French, not English', () => {
  const win = loadExtension(fx.inboxHtml({
    conversation: `<div data-intercom-target="conversation-space" data-intercom-target-conversation-stream="">
      <div data-testid="teammate-email-reply-part">
        <div data-testid="email-content"><div class="interblocks-html">
          Bonjour Margaux, merci pour votre e-mail. Nous vous confirmons que votre colis
          a ete expedie aujourd'hui et le numero de suivi vous a ete envoye par e-mail.
        </div></div>
      </div>
      <div class="conversation__note-part">
        <div class="interblocks-html">asked to wait for the refund, it's processed on 10th</div>
      </div>
      <div data-testid="smart-reply-ghost-text">
        <div class="interblocks-html">Dear Margaux! Thank you for reaching out to us today.</div>
      </div>
    </div>`
  }));

  assert.equal(win.detectLanguageFromConversation(), null);
  assert.equal(win.detectLanguageFromAgentEmails(), 'french');
  assert.equal(win.detectCustomerLanguage(), 'french');
});

test('an English agent thread is not forced off the normal cascade', () => {
  const win = loadExtension(fx.inboxHtml({
    conversation: `<div data-intercom-target="conversation-space">
      <div data-testid="teammate-email-reply-part">
        <div class="interblocks-html">Hello, thank you for reaching out, best regards from the support team.</div>
      </div>
    </div>`
  }));

  assert.equal(win.detectLanguageFromAgentEmails(), null);
});

test('detectLanguageFromConversation picks Italian over French when Italian scores higher', () => {
  const win = loadExtension(fx.inboxHtml({
    conversation: fx.conversationSpace({
      customerText: 'Buongiorno, ho ricevuto un paio di scarpe del numero sbagliato, come posso fare il cambio? Vorrei una risposta per favore perché parto sabato',
      agentText: 'Hello, thank you for reaching out, best regards from the support team.'
    })
  }));
  assert.equal(win.detectLanguageFromConversation(), 'italian');
});

test('detectLanguageFromConversation still detects clearly-French text as French', () => {
  const win = loadExtension(fx.inboxHtml({
    conversation: fx.conversationSpace({
      customerText: "Bonjour, merci de votre aide, est-ce que je peux encore modifier l'adresse de livraison, s'il vous plaît.",
      agentText: 'Ciao, grazie mille, resto a tua disposizione per qualsiasi cosa.'
    })
  }));
  assert.equal(win.detectLanguageFromConversation(), 'french');
});

test('detectLanguageFromConversation separates Spanish, Portuguese and Dutch', () => {
  const cases = [
    ['spanish', 'Buenos días, compré unas zapatillas la semana pasada y todavía no tengo el número de seguimiento. ¿Pueden ayudarme, por favor? Es para un regalo. Gracias.'],
    ['spanish', 'Hola, buenos días. El paquete llegó abierto y falta un artículo. Por favor, ¿pueden revisarlo? Muchas gracias.'],
    ['spanish', 'Buenas tardes quiero cambiar la talla de mi pedido por favor me pueden decir como hacerlo y cuanto tarda el envio gracias'],
    ['portuguese', 'Olá, gostaria de trocar o tamanho da minha encomenda. Ainda não foi enviada, certo? Fico à espera da vossa resposta. Obrigada.'],
    ['dutch', 'Goedemorgen, ik heb twee shirts besteld maar er is er maar één aangekomen. Kunt u nagaan wat er is gebeurd? Bedankt en vriendelijke groet.'],
    ['dutch', 'Hallo, kan ik het adres voor de levering nog wijzigen? Ik verhuis aan het eind van de week. Groeten.'],
    [null, 'Poštovani, narudžba mi je stigla oštećena. Možete li mi poslati novu? Hvala unaprijed i lijep pozdrav.']
  ];

  for (const [expected, customerText] of cases) {
    const win = loadExtension(fx.inboxHtml({
      conversation: fx.conversationSpace({
        customerText,
        agentText: 'Hello, thank you for reaching out, best regards from the support team.'
      })
    }));
    assert.equal(win.detectLanguageFromConversation(), expected, customerText.slice(0, 40));
  }
});

const WORD_LIST_LANGUAGES = ['french', 'german', 'italian', 'portuguese', 'spanish', 'dutch'];

function loadedWordLists() {
  const win = loadExtension(fx.inboxHtml({ conversation: fx.conversationSpace({ customerText: 'x' }) }));
  return Object.fromEntries(WORD_LIST_LANGUAGES.map((name) => {
    const words = Array.from(win.eval(`LANG_${name.toUpperCase()}_WORDS`));
    assert.ok(words.length > 10, `${name} word list is loaded`);
    return [name, words];
  }));
}

test('near-neighbour word lists stay disjoint', () => {
  const names = WORD_LIST_LANGUAGES;
  const lists = loadedWordLists();

  const overlaps = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const shared = lists[names[i]].filter((word) => lists[names[j]].includes(word));
      if (shared.length) overlaps.push(`${names[i]} x ${names[j]}: ${shared.join(', ')}`);
    }
  }

  assert.deepEqual(Array.from(overlaps), ['french x italian: non, il, le, la, un, qui']);
});

test('no word list contains a duplicate entry', () => {
  for (const [name, words] of Object.entries(loadedWordLists())) {
    const duplicates = words.filter((word, index) => words.indexOf(word) !== index);
    assert.deepEqual(Array.from(duplicates), [], `${name} has duplicates`);
  }
});

test('language word lists use a Unicode letter boundary, not \\b', () => {
  const win = loadExtension(fx.inboxHtml({ conversation: fx.conversationSpace({ customerText: 'x' }) }));

  for (const word of ['olá', 'você', 'já', 'porquê', 'può', 'sì']) {
    assert.ok(win.langWordRegex(word).test(`teste ${word} teste`), word);
    assert.ok(!win.langWordRegex(word).test(`teste x${word}x teste`), word);
  }
});

test('detectLanguageFromConversation keeps Italian ahead of Portuguese on shared accents', () => {
  const win = loadExtension(fx.inboxHtml({
    conversation: fx.conversationSpace({
      customerText: 'Buongiorno, il pacco è arrivato ma la scatola era rotta, per favore potete mandarmi un sostituto, grazie mille.',
      agentText: 'Hello, thank you for reaching out, best regards from the support team.'
    })
  }));
  assert.equal(win.detectLanguageFromConversation(), 'italian');
});

test('a support warning is issued once per conversation and again in the next one', () => {
  const win = loadExtension(fx.inboxHtml({}));
  const warned = [];
  win.console.warn = (...args) => warned.push(args.join(' '));
  win.eval('currentConversationId = "111"');
  win.supportWarnOnce('probe', 'first conversation');
  win.supportWarnOnce('probe', 'first conversation again');
  win.eval('currentConversationId = "222"');
  win.supportWarnOnce('probe', 'second conversation');
  assert.deepEqual(warned, ['first conversation', 'second conversation']);
});

function loadWithConfig(edit) {
  return loadExtension(fx.inboxHtml({}), {
    beforeScripts(win) {
      let stored;
      Object.defineProperty(win, 'ISA_INTERCOM_CONFIG', {
        configurable: true,
        get: () => stored,
        set: (value) => { stored = edit({ ...value }); }
      });
      win.console.error = () => {};
    }
  });
}

test('the runtime config bootstrap refuses a list field that is not an array and a map field that is an array', () => {
  assert.throws(() => loadWithConfig(config => ({ ...config, excludedInboxes: { 0: 'x' } })),
    /excludedInboxes must be an array/);
  assert.throws(() => loadWithConfig(config => ({ ...config, companies: [] })),
    /companies must be an object/);
  assert.doesNotThrow(() => loadWithConfig(config => config));
});

function inProgressAttrs(conversationAttrs = [fx.conversationAttrRow('3001', 'Escalation Status', 'in progress')]) {
  return fx.sidebarSection({ conversationAttrs });
}

test('an in-progress conversation highlights snooze and both re-open buttons as well as close', () => {
  const reopenIcon = '<button><svg class="interface-icon o__standard o__standard__reopen-conversation"></svg>Reopen</button>';
  const win = loadExtension(fx.inboxHtml({
    toolbar: fx.conversationToolbar({ close: true, snooze: true }) +
      fx.conversationHeader({ close: false, reopen: true }) +
      `<div>${reopenIcon}<button>Assign</button></div>`,
    sidebar: inProgressAttrs()
  }));
  win.refreshInProgressActionHighlights();

  const highlighted = [...win.document.querySelectorAll('.isa-in-progress-highlight')]
    .map(button => button.textContent.trim())
    .sort();
  assert.deepEqual(highlighted, ['Close', 'Re-open', 'Reopen', 'Snooze']);
});

test('the toolbar fallback picks the button labelled Close, not the first one', () => {
  const win = loadExtension(fx.inboxHtml({
    toolbar: '<div data-intercom-target="conversation-toolbar"><button>Snooze</button><button>Close</button></div>'
  }));
  assert.equal(win.getCloseConversationButton()?.textContent, 'Close');
});

test('Close buttons outside the conversation toolbar and header are never blocked', () => {
  const win = loadExtension(fx.inboxHtml({
    toolbar: fx.conversationToolbar({ close: true }) +
      '<div role="dialog"><button id="dialog-close">Close</button></div>' +
      '<div class="bulk-actions"><button id="bulk-close" data-test-state-multiselect-close="true" aria-label="Close">Close</button></div>',
    sidebar: inProgressAttrs()
  }));
  const alerts = [];
  win.alert = message => alerts.push(message);

  const toolbarClick = new win.MouseEvent('click', { bubbles: true, cancelable: true });
  win.document.querySelector('svg.o__standard__close-conversation').closest('button').dispatchEvent(toolbarClick);
  assert.equal(toolbarClick.defaultPrevented, true, 'the toolbar close in the same page is blocked');
  assert.equal(alerts.length, 1);

  for (const id of ['dialog-close', 'bulk-close']) {
    const event = new win.MouseEvent('click', { bubbles: true, cancelable: true });
    win.document.getElementById(id).dispatchEvent(event);
    assert.equal(event.defaultPrevented, false, id);
  }
  assert.equal(alerts.length, 1);
});

test('an agent reply after a linked note lifts the note guard', () => {
  const noteHtml = '<p><a href="https://example.slack.com/archives/C1/p1">slack</a></p>';
  const page = agentText => loadExtension(fx.inboxHtml({
    toolbar: fx.conversationToolbar({ close: true }),
    conversation: fx.conversationSpace({ noteHtml, agentText, notePosition: 'first' })
  }));
  assert.equal(page(undefined).isLastPartUnresolvedNote(), true, 'the linked note alone holds the guard');
  assert.equal(page('Your refund has been approved.').isLastPartUnresolvedNote(), false);
});

test('a blocked close also stops click listeners added later on the document', () => {
  const win = loadExtension(fx.inboxHtml({
    toolbar: fx.conversationToolbar({ close: true }),
    sidebar: inProgressAttrs()
  }));
  win.alert = () => {};
  let laterListenerRan = false;
  win.document.addEventListener('click', () => { laterListenerRan = true; }, true);

  const closeButton = win.document.querySelector('svg.o__standard__close-conversation').closest('button');
  closeButton.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(laterListenerRan, false);
});

test('an in-progress status text with surrounding whitespace is still recognized', () => {
  const win = loadExtension(fx.inboxHtml({
    sidebar: inProgressAttrs([fx.conversationAttrRow('3002', 'Ticket state', '\n  In progress  \n')])
  }));
  assert.equal(win.isInProgressStatus(), true);
});
