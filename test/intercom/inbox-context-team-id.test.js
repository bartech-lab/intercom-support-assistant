const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

function companyContext(url) {
  const attrs = [fx.conversationAttrRow('9100', 'Brand', 'Alderpoint')];
  const win = loadExtension(
    fx.inboxHtml({ sidebar: fx.sidebarSection({ teamInbox: 'Support Alderpoint', conversationAttrs: attrs }) }),
    { url }
  );
  const info = win.detectInboxType();
  assert.equal(info.type, 'company');
  assert.equal(info.name, 'Alderpoint');
  return info;
}

test('a company context carries the team id from the conversation URL', () => {
  const info = companyContext('https://app.intercom.com/a/inbox/demo1234/inbox/team/900202/conversation/456?view=List');
  assert.equal(info.teamId, '900202');
});

test('a company context without a team in the URL has a null team id', () => {
  const info = companyContext('https://app.intercom.com/a/inbox/demo1234/inbox/conversation/456');
  assert.equal(info.teamId, null);
});
