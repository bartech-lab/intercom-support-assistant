const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

function loadWithWarnCapture({ teamInbox, brand, url, userDetails = false }) {
  const warnings = [];
  const attrs = brand ? [fx.conversationAttrRow('9100', 'Brand', brand)] : [];
  const sections = { sidebar: fx.sidebarSection({ teamInbox, conversationAttrs: attrs }) };
  if (userDetails) {
    sections.userDetails = fx.userDetailsSection([
      fx.userDetailRow('Email', fx.emailValue('customer@example.com')),
      fx.userDetailRow('User id', fx.userIdValue('900999'))
    ]);
  }
  const win = loadExtension(
    fx.inboxHtml(sections),
    {
      url,
      beforeScripts: w => {
        w.console = {
          log: () => {},
          debug: (...args) => warnings.push(args.join(' ')),
          warn: (...args) => warnings.push(args.join(' ')),
          error: () => {}
        };
      }
    }
  );
  return { win, warnings };
}

test('the conflict warning names each source, the winner, and dashes an absent signal', () => {
  const { win, warnings } = loadWithWarnCapture({
    teamInbox: 'Support Brightwell',
    brand: 'Alderpoint',
    url: 'https://app.intercom.com/a/inbox/app/inbox/team/900999/conversation/456'
  });

  const info = win.detectInboxType();
  assert.equal(info.type, 'company');
  assert.equal(info.name, 'Alderpoint');

  const warning = warnings.find(w => w.includes('Conflicting brand signals'));
  assert.ok(warning);
  assert.match(warning, /Brand=Alderpoint/);
  assert.match(warning, /Inbox=Brightwell/);
  assert.match(warning, /Mailbox=-,/);
  assert.match(warning, /UrlTeam=-,/);
  assert.match(warning, /NetTeam=- /);
  assert.match(warning, /-> using Alderpoint/);
});

test('a URL team disagreeing with both sidebar signals fails closed on the signature', () => {
  const { win, warnings } = loadWithWarnCapture({
    teamInbox: 'Support Alderpoint',
    brand: 'Alderpoint',
    url: 'https://app.intercom.com/a/inbox/demo1234/inbox/team/900202/conversation/456?view=List'
  });

  const info = win.detectInboxType();
  assert.equal(info.sources.urlTeam, 'Brightwell');
  assert.equal(info.signatureSafe, false);
  assert.match(
    warnings.find(w => w.includes('Conflicting brand signals')),
    /Brand=Alderpoint, Inbox=Alderpoint, UrlTeam=Brightwell/
  );
});

test('the URL team backing the winner keeps the signature safe', () => {
  const { win } = loadWithWarnCapture({
    teamInbox: 'Support Brightwell',
    brand: 'Alderpoint',
    url: 'https://app.intercom.com/a/inbox/app/inbox/team/900201/conversation/456'
  });

  assert.equal(win.detectInboxType().signatureSafe, true);
});

test('clicking an inbox with no conversation open resolves nothing and stays silent', () => {
  const { win, warnings } = loadWithWarnCapture({
    teamInbox: 'Support Alderpoint',
    brand: 'Alderpoint',
    url: 'https://app.intercom.com/a/inbox/demo1234/inbox/team/900207?custom_folder_id=900650&view=List'
  });

  assert.equal(win.detectInboxType(), null);
  assert.deepEqual(warnings, []);
});

test('the new-conversation composer still resolves a company without a conversation id', () => {
  const { win } = loadWithWarnCapture({
    teamInbox: 'Support Alderpoint',
    brand: 'Alderpoint',
    url: 'https://app.intercom.com/a/inbox/demo1234/inbox/new-conversation'
  });

  const info = win.detectInboxType();
  assert.equal(info.type, 'company');
  assert.equal(info.name, 'Alderpoint');
  assert.equal(info.signatureSafe, true);
});

function loadWithSidebarConversationId({ teamInbox, brand, sidebarConversationId, url }) {
  const warnings = [];
  const attrs = [fx.conversationAttrRow('9100', 'Brand', brand)];
  const idRow = sidebarConversationId
    ? fx.userDetailRow('ID', `<span class="truncate">${sidebarConversationId}</span>`)
    : '';
  const sidebar = fx.sidebarSection({ teamInbox, conversationAttrs: attrs }).replace(
    '</div>',
    `${idRow}</div>`
  );
  const win = loadExtension(fx.inboxHtml({ sidebar }), {
    url,
    beforeScripts: w => {
      w.console = {
        log: () => {},
        debug: (...args) => warnings.push(args.join(' ')),
        warn: (...args) => warnings.push(args.join(' ')),
        error: () => {}
      };
    }
  });
  return { win, warnings };
}

const conflictUrl = id =>
  `https://app.intercom.com/a/inbox/demo1234/inbox/team/900202/conversation/${id}?view=List`;

test('a conflict is not warned about while the sidebar still shows the previous conversation', () => {
  const { win, warnings } = loadWithSidebarConversationId({
    teamInbox: 'Support Alderpoint',
    brand: 'Alderpoint',
    sidebarConversationId: '111',
    url: conflictUrl('222')
  });

  assert.equal(win.sidebarLagsConversation(), true);
  win.detectInboxType();
  assert.equal(
    warnings.find(w => w.includes('Conflicting brand signals')),
    undefined,
    'the signals disagree only because the sidebar has not re-rendered yet'
  );
});

test('a conflict is still warned about once the sidebar matches the open conversation', () => {
  const { win, warnings } = loadWithSidebarConversationId({
    teamInbox: 'Support Alderpoint',
    brand: 'Alderpoint',
    sidebarConversationId: '222',
    url: conflictUrl('222')
  });

  assert.equal(win.sidebarLagsConversation(), false);
  win.detectInboxType();
  assert.match(
    warnings.find(w => w.includes('Conflicting brand signals')),
    /UrlTeam=Brightwell/
  );
});

test('a sidebar with no ID row keeps the existing warning behaviour', () => {
  const { win, warnings } = loadWithSidebarConversationId({
    teamInbox: 'Support Alderpoint',
    brand: 'Alderpoint',
    sidebarConversationId: null,
    url: conflictUrl('222')
  });

  assert.equal(win.sidebarLagsConversation(), false, 'an absent signal never claims staleness');
  win.detectInboxType();
  assert.ok(warnings.find(w => w.includes('Conflicting brand signals')));
});

test('suppressing the warning does not change what detectInboxType resolves', () => {
  const stale = loadWithSidebarConversationId({
    teamInbox: 'Support Alderpoint', brand: 'Alderpoint', sidebarConversationId: '111', url: conflictUrl('222')
  });
  const settled = loadWithSidebarConversationId({
    teamInbox: 'Support Alderpoint', brand: 'Alderpoint', sidebarConversationId: '222', url: conflictUrl('222')
  });

  const a = stale.win.detectInboxType();
  const b = settled.win.detectInboxType();
  assert.equal(a.name, b.name);
  assert.equal(a.signatureSafe, b.signatureSafe);
  assert.equal(a.signatureSafe, false, 'the fail-closed signature guard is untouched');
});
