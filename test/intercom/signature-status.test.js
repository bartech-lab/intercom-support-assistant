'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension, makeChromeStub } = require('../support/helpers');
const fx = require('../support/fixtures');

const ORIGIN = 'https://app.intercom.com';
const CONVERSATION_ID = '900401386132981';
const OTHER_CONVERSATION_ID = '900401386133186';
const UNKNOWN_TEAM = '900999';
const BAR = '<div data-testid="composer-actions-bar"><div class="bar-first"></div><div class="bar-second"></div></div>';
const SETTLE_MS = 2000;
const START = 1000000;
const UNCLEAR = { teamInbox: 'Support Brightwell', brand: 'Alderpoint' };

function conversationUrl(teamId, conversationId = CONVERSATION_ID) {
  return `${ORIGIN}/a/inbox/demo1234/inbox/team/${teamId}/conversation/${conversationId}`;
}

function html({
  mode = 'email',
  bar = BAR,
  teamInbox = UNCLEAR.teamInbox,
  brand = UNCLEAR.brand,
  customerText = 'Hello',
  react = null
} = {}) {
  const composer = fx.composer({ mode })
    .replace('<button>Send</button>', `${bar}<button>Send</button>`)
    .replace('role="textbox"', 'role="textbox" tabindex="0"');
  const sidebar = react
    ? fx.reactSidebarSection({
      teamInbox,
      conversationId: react.sidebarConversationId,
      conversationAttrs: brand ? [fx.reactConversationAttrRow('9006910', 'Brand', brand)] : []
    })
    : fx.sidebarSection({
      teamInbox,
      conversationAttrs: brand ? [fx.conversationAttrRow('9006910', 'Brand', brand)] : []
    });
  return fx.inboxHtml({
    sidebar,
    conversation: fx.conversationSpace({ customerText }),
    composer
  });
}

function load(options = {}, teamId = UNKNOWN_TEAM) {
  const chrome = makeChromeStub();
  const calls = { warn: [] };
  const win = loadExtension(html(options), {
    url: conversationUrl(teamId),
    chromeStub: chrome,
    beforeScripts(w) {
      w.console = {
        log: () => {},
        error: () => {},
        debug: () => {},
        warn: (...args) => calls.warn.push(args.join(' '))
      };
    }
  });
  const clock = { now: START };
  win.Date.now = () => clock.now;
  win.handleConversationChange();
  return { win, chrome, clock, calls };
}

function setBody(win, options) {
  win.document.body.innerHTML = html(options);
}

const NEUTRAL_REASONS = ['signed-as', 'no-signature-by-design'];

function allHolders(win) {
  return [...win.document.querySelectorAll('.isa-signature-status')];
}

function holders(win) {
  return allHolders(win).filter(holder => !NEUTRAL_REASONS.includes(holder.getAttribute('data-isa-signature-status')));
}

function refresh(win) {
  assert.equal(typeof win.refreshSignatureStatus, 'function');
  win.refreshSignatureStatus();
  return holders(win);
}

function chipOf(holder) {
  return holder.querySelector('button.isa-signature-status-chip');
}

function boxes(win) {
  return [...win.document.querySelectorAll('.isa-signature-status-box')];
}

function click(win, element) {
  const event = new win.MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
  element.dispatchEvent(event);
  return event;
}

function realClick(win, element) {
  ['mousedown', 'mouseup'].forEach(type => {
    element.dispatchEvent(new win.MouseEvent(type, { bubbles: true, cancelable: true, composed: true }));
  });
  return click(win, element);
}

function pressEscape(win) {
  win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
}

function previewRequests(chrome) {
  return chrome.__sent.filter(message => message && message.type === 'open-preview');
}

function settle(ctx) {
  refresh(ctx.win);
  ctx.clock.now += SETTLE_MS;
  return refresh(ctx.win);
}

function showUnclear(options = {}) {
  const ctx = load({ ...UNCLEAR, ...options });
  const found = settle(ctx);
  assert.equal(found.length, 1);
  return { ...ctx, holder: found[0] };
}

test('the unclear-brand setup really is an unsafe company inbox', () => {
  const { win } = load();
  const info = win.detectInboxType();
  assert.equal(info.type, 'company');
  assert.equal(info.signatureSafe, false);
  assert.equal(win.sidebarLagsConversation(), false);
});

test('brand-unclear shows nothing on the first refresh and nothing one millisecond before the settle time', () => {
  const ctx = load();
  assert.equal(refresh(ctx.win).length, 0);
  ctx.clock.now += SETTLE_MS - 1;
  assert.equal(refresh(ctx.win).length, 0);
});

test('brand-unclear shows with its full DOM contract at the settle time and names both brands', () => {
  const { win, holder } = showUnclear();
  assert.equal(holder.tagName, 'SPAN');
  assert.equal(holder.getAttribute('data-isa-signature-status'), 'brand-unclear');
  assert.equal(holder.getAttribute('role'), 'status');
  assert.equal(holder.hasAttribute('data-isa-own'), true);
  assert.equal(holder.getAttribute('data-isa-signature-status-owner'), win.extensionInstallId());
  assert.equal(holder.parentElement, win.document.querySelector('.bar-first'));
  const chip = chipOf(holder);
  assert.equal(chip.tagName, 'BUTTON');
  assert.equal(chip.getAttribute('type'), 'button');
  assert.equal(chip.getAttribute('aria-expanded'), 'false');
  assert.equal(chip.textContent, 'No signature: brand unclear');
  const detail = chip.getAttribute('title');
  assert.match(detail, /^Brand signals point to /);
  assert.match(detail, /Alderpoint/);
  assert.match(detail, /Brightwell/);
  assert.match(detail, /Change the Brand field or move the conversation\.$/);
  assert.equal(boxes(win).length, 0);
});

test('the settle time counts from the first refresh that sees the reason, not from page load', () => {
  const ctx = load();
  ctx.clock.now += 60000;
  assert.equal(refresh(ctx.win).length, 0);
  ctx.clock.now += SETTLE_MS - 1;
  assert.equal(refresh(ctx.win).length, 0);
  ctx.clock.now += 1;
  assert.equal(refresh(ctx.win).length, 1);
});

test('the settle timer restarts when the reason disappears in between', () => {
  const ctx = load();
  refresh(ctx.win);
  ctx.clock.now += 1500;
  assert.equal(refresh(ctx.win).length, 0);
  setBody(ctx.win, { teamInbox: 'Support Alderpoint', brand: 'Alderpoint' });
  assert.equal(refresh(ctx.win).length, 0);
  setBody(ctx.win, UNCLEAR);
  ctx.clock.now += 100;
  assert.equal(refresh(ctx.win).length, 0);
  ctx.clock.now += SETTLE_MS - 1;
  assert.equal(refresh(ctx.win).length, 0);
  ctx.clock.now += 1;
  assert.equal(refresh(ctx.win).length, 1);
});

test('brand-unclear never shows while the sidebar belongs to a different conversation than the URL', () => {
  const ctx = load({ ...UNCLEAR, react: { sidebarConversationId: OTHER_CONVERSATION_ID } });
  assert.equal(ctx.win.sidebarLagsConversation(), true);
  assert.equal(ctx.win.detectInboxType().signatureSafe, false);
  refresh(ctx.win);
  ctx.clock.now += SETTLE_MS * 5;
  assert.equal(refresh(ctx.win).length, 0);
});

test('brand-unclear shows once the sidebar catches up with the conversation', () => {
  const ctx = load({ ...UNCLEAR, react: { sidebarConversationId: OTHER_CONVERSATION_ID } });
  refresh(ctx.win);
  ctx.clock.now += SETTLE_MS;
  assert.equal(refresh(ctx.win).length, 0);
  setBody(ctx.win, { ...UNCLEAR, react: { sidebarConversationId: CONVERSATION_ID } });
  assert.equal(ctx.win.sidebarLagsConversation(), false);
  refresh(ctx.win);
  ctx.clock.now += SETTLE_MS;
  const found = refresh(ctx.win);
  assert.equal(found.length, 1);
  assert.equal(found[0].getAttribute('data-isa-signature-status'), 'brand-unclear');
});

test('a company inbox with consistent signals shows nothing, while a conflicting one does', () => {
  const consistent = load({ teamInbox: 'Support Alderpoint', brand: 'Alderpoint' });
  assert.equal(consistent.win.detectInboxType().signatureSafe, true);
  assert.equal(settle(consistent).length, 0);
  assert.equal(settle(load()).length, 1);
});

test('note mode shows nothing, while email mode shows the chip', () => {
  assert.equal(settle(load()).length, 1);
  assert.equal(settle(load({ mode: 'note' })).length, 0);
});

test('a composer in chat mode shows nothing', () => {
  const { win } = showUnclear();
  setBody(win, { ...UNCLEAR, mode: 'chat' });
  assert.equal(refresh(win).length, 0);
});

test('the New Conversation view shows no reply reason', () => {
  const win = loadExtension(html(UNCLEAR), {
    url: `${ORIGIN}/a/inbox/demo1234/inbox/new-conversation?view=List`,
    chromeStub: makeChromeStub()
  });
  win.handleConversationChange();
  assert.equal(refresh(win).length, 0);
});

test('an excluded inbox shows nothing even with conflicting brand signals', () => {
  const ctx = load({ teamInbox: 'Tier 2', brand: 'Alderpoint' });
  assert.equal(ctx.win.detectInboxType().type, 'excluded');
  assert.equal(settle(ctx).length, 0);
});

test('a team-signature inbox shows nothing', () => {
  const ctx = load({ teamInbox: 'Billing', brand: 'Alderpoint' });
  assert.equal(ctx.win.detectInboxType().type, 'team');
  assert.equal(settle(ctx).length, 0);
});

test('a notification-style inbox shows nothing', () => {
  const ctx = load({ teamInbox: 'Notifications', brand: 'Alderpoint' });
  assert.equal(ctx.win.detectInboxType(), null);
  assert.equal(settle(ctx).length, 0);
});

test('an ordinary inbox where no brand resolves shows nothing', () => {
  const ctx = load({ teamInbox: 'General chats', brand: null });
  assert.equal(ctx.win.detectInboxType(), null);
  assert.equal(settle(ctx).length, 0);
});

test('without a composer actions bar the holder goes into the composer container', () => {
  const [holder] = settle(load({ bar: '' }));
  assert.ok(holder);
  assert.ok(holder.closest('[data-testid="composer-orchestrator"]'));
});

test('the holder is removed on the next refresh when the Brand field is corrected', () => {
  const { win } = showUnclear();
  setBody(win, { teamInbox: UNCLEAR.teamInbox, brand: 'Brightwell' });
  assert.equal(refresh(win).length, 0);
});

test('the holder is removed on the next refresh when the composer switches to note mode', () => {
  const { win } = showUnclear();
  setBody(win, { ...UNCLEAR, mode: 'note' });
  assert.equal(refresh(win).length, 0);
});

test('the holder is removed when the conversation changes to one with a clear brand', () => {
  const { win } = showUnclear();
  win.history.replaceState({}, '', conversationUrl(UNKNOWN_TEAM, OTHER_CONVERSATION_ID));
  setBody(win, { teamInbox: 'Support Alderpoint', brand: 'Alderpoint' });
  win.handleConversationChange();
  assert.equal(refresh(win).length, 0);
});

test('clicking the chip opens the box and clicking again closes it, with aria-expanded following', () => {
  const { win, holder } = showUnclear();
  const chip = chipOf(holder);
  click(win, chip);
  assert.equal(chip.getAttribute('aria-expanded'), 'true');
  assert.equal(boxes(win).length, 1);
  assert.equal(holder.contains(boxes(win)[0]), true);
  click(win, chip);
  assert.equal(chip.getAttribute('aria-expanded'), 'false');
  assert.equal(boxes(win).length, 0);
});

test('the open box carries the heading, the detail text and an Open signatures button', () => {
  const { win, holder } = showUnclear();
  click(win, chipOf(holder));
  const [box] = boxes(win);
  assert.equal(box.tagName, 'DIV');
  assert.equal(box.querySelector('strong').textContent, 'No signature here');
  assert.ok(box.textContent.includes(chipOf(holder).getAttribute('title')), box.textContent);
  const link = box.querySelector('button.isa-signature-status-link');
  assert.equal(link.textContent, 'Open signatures');
  assert.equal(link.getAttribute('type'), 'button');
});

test('Open signatures asks the extension to open the signatures preview section', () => {
  const { win, chrome, holder } = showUnclear();
  click(win, chipOf(holder));
  assert.equal(previewRequests(chrome).length, 0);
  click(win, win.document.querySelector('.isa-signature-status-link'));
  assert.equal(previewRequests(chrome).length, 1);
  assert.deepStrictEqual({ ...previewRequests(chrome)[0] }, { type: 'open-preview', section: 'signatures' });
});

test('opening and closing the chip alone sends no message to the extension', () => {
  const { win, chrome, holder } = showUnclear();
  click(win, chipOf(holder));
  click(win, chipOf(holder));
  assert.equal(previewRequests(chrome).length, 0);
});

test('Escape closes an open box', () => {
  const { win, holder } = showUnclear();
  click(win, chipOf(holder));
  assert.equal(boxes(win).length, 1);
  pressEscape(win);
  assert.equal(boxes(win).length, 0);
  assert.equal(chipOf(holder).getAttribute('aria-expanded'), 'false');
});

test('other keys leave an open box open', () => {
  const { win, holder } = showUnclear();
  click(win, chipOf(holder));
  win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
  win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(boxes(win).length, 1);
});

test('a click outside the holder closes an open box', () => {
  const { win, holder } = showUnclear();
  click(win, chipOf(holder));
  assert.equal(boxes(win).length, 1);
  realClick(win, win.document.body);
  assert.equal(boxes(win).length, 0);
  assert.equal(chipOf(holder).getAttribute('aria-expanded'), 'false');
});

test('a click inside the box does not close it', () => {
  const { win, holder } = showUnclear();
  click(win, chipOf(holder));
  const [box] = boxes(win);
  realClick(win, box);
  realClick(win, box.firstElementChild);
  assert.equal(boxes(win).length, 1);
  assert.equal(chipOf(holder).getAttribute('aria-expanded'), 'true');
});

test('a scroll closes an open box', () => {
  const { win, holder } = showUnclear();
  click(win, chipOf(holder));
  win.document.body.dispatchEvent(new win.Event('scroll'));
  assert.equal(boxes(win).length, 0);
  assert.equal(chipOf(holder).getAttribute('aria-expanded'), 'false');
});

test('a window resize closes an open box', () => {
  const { win, holder } = showUnclear();
  click(win, chipOf(holder));
  win.dispatchEvent(new win.Event('resize'));
  assert.equal(boxes(win).length, 0);
});

test('the chip mousedown is default-prevented so the editor keeps focus', () => {
  const { win, holder } = showUnclear();
  const event = new win.MouseEvent('mousedown', { bubbles: true, cancelable: true });
  chipOf(holder).dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
});

test('repeated refreshes with the same state keep the same holder element and exactly one holder', () => {
  const { win, holder } = showUnclear();
  refresh(win);
  refresh(win);
  const found = refresh(win);
  assert.equal(found.length, 1);
  assert.equal(found[0], holder);
});

test('repeated refreshes keep an open box open', () => {
  const { win, holder } = showUnclear();
  click(win, chipOf(holder));
  refresh(win);
  refresh(win);
  assert.equal(boxes(win).length, 1);
  assert.equal(chipOf(holders(win)[0]).getAttribute('aria-expanded'), 'true');
  assert.equal(holders(win)[0], holder);
});

test('a settled refresh makes no DOM mutation', () => {
  const { win } = showUnclear();
  const observer = new win.MutationObserver(() => {});
  observer.observe(win.document.body, { childList: true, subtree: true, attributes: true, characterData: true });
  refresh(win);
  refresh(win);
  const records = observer.takeRecords();
  observer.disconnect();
  assert.deepStrictEqual(Array.from(records, record => record.type), []);
});

function foreignHolder(win) {
  const host = win.document.querySelector('.bar-first');
  const foreign = win.document.createElement('span');
  foreign.className = 'isa-signature-status';
  foreign.setAttribute('data-isa-signature-status', 'brand-unclear');
  foreign.setAttribute('data-isa-signature-status-owner', 'another-install');
  foreign.setAttribute('data-isa-own', '');
  foreign.innerHTML = '<button type="button" class="isa-signature-status-chip" aria-expanded="false" title="foreign">foreign label</button>';
  host.prepend(foreign);
  return { foreign, markup: foreign.outerHTML };
}

test('a holder owned by another install is neither duplicated nor changed while this install has a reason', () => {
  const ctx = load();
  const { foreign, markup } = foreignHolder(ctx.win);
  refresh(ctx.win);
  ctx.clock.now += SETTLE_MS;
  const found = refresh(ctx.win);
  assert.equal(found.length, 1);
  assert.equal(found[0], foreign);
  assert.equal(foreign.outerHTML, markup);
});

test('a holder owned by another install survives when this install has no reason any more', () => {
  const ctx = load();
  const { foreign, markup } = foreignHolder(ctx.win);
  refresh(ctx.win);
  ctx.clock.now += SETTLE_MS;
  refresh(ctx.win);
  setBody(ctx.win, { teamInbox: 'Support Alderpoint', brand: 'Alderpoint' });
  ctx.win.document.querySelector('.bar-first').prepend(foreign);
  assert.equal(refresh(ctx.win).length, 1);
  assert.equal(holders(ctx.win)[0], foreign);
  assert.equal(foreign.outerHTML, markup);
  setBody(ctx.win, { ...UNCLEAR, mode: 'note' });
  ctx.win.document.querySelector('.bar-first').prepend(foreign);
  assert.equal(refresh(ctx.win).length, 1);
  assert.equal(holders(ctx.win)[0], foreign);
  assert.equal(foreign.outerHTML, markup);
});

test('brand-unclear never calls console.warn', () => {
  const ctx = load();
  assert.equal(settle(ctx).length, 1);
  refresh(ctx.win);
  assert.deepStrictEqual(
    Array.from(ctx.calls.warn).filter(line => !line.includes('Conflicting brand signals')),
    []
  );
});

test('the open status box follows the page theme through the shared tokens, with no dark class of its own', async () => {
  for (const dark of [false, true]) {
    const { win, holder } = showUnclear();
    if (dark) win.document.documentElement.classList.add('dark');
    await new Promise(resolve => setTimeout(resolve, 0));
    click(win, chipOf(holder));
    const [box] = boxes(win);
    assert.ok(box, 'the box opens');
    assert.equal(box.className, 'isa-signature-status-box');
    const css = win.document.getElementById('isa-signature-status-style').textContent;
    assert.equal(css.includes('-box-dark'), false);
    assert.equal(/#[0-9a-fA-F]{3,6}\b|rgba?\(/.test(css.replace(/rgba\(\s*0,\s*0,\s*0/g, '')), false);
    assert.match(css, /background: var\(--isa-surface\)/);
    assert.match(css, /background: var\(--isa-warn\);\s*color: var\(--isa-warn-ink\)/);
    assert.ok(win.document.getElementById('isa-tokens-style'));
    assert.equal(win.document.documentElement.getAttribute('data-isa-theme'), dark ? 'dark' : 'light');
  }
});

function neutralHolder(win) {
  win.refreshSignatureStatus();
  const found = allHolders(win);
  assert.equal(found.length, 1);
  return found[0];
}

test('a reply that will be signed shows one quiet chip naming the brand and the signature language', () => {
  const { win } = load({ teamInbox: 'Support Brightwell', brand: 'Brightwell' });
  const holder = neutralHolder(win);
  assert.equal(holder.getAttribute('data-isa-signature-status'), 'signed-as');
  assert.equal(chipOf(holder).textContent, 'Brightwell, EN');
});

test('the signed-as chip follows the language picked for the reply', () => {
  const { win } = load({ teamInbox: 'Support Brightwell', brand: 'Brightwell' });
  neutralHolder(win);
  win.refreshComposerLanguagePicker();
  const german = [...win.document.querySelectorAll('.isa-draft-language-chip')].find(chip => chip.textContent === 'DE');
  assert.ok(german, 'the language picker offers DE');
  german.click();
  assert.equal(chipOf(neutralHolder(win)).textContent, 'Brightwell, DE');
});

test('an inbox that never signs says so in a quiet chip, not as a warning', () => {
  const ctx = load({ teamInbox: 'Tier 2', brand: 'Alderpoint' });
  const holder = neutralHolder(ctx.win);
  assert.equal(holder.getAttribute('data-isa-signature-status'), 'no-signature-by-design');
  assert.equal(chipOf(holder).textContent, 'No signature in this inbox');
  assert.equal(refresh(ctx.win).length, 0);
});

test('a warning takes the place of the signed-as chip instead of sitting beside it', () => {
  const ctx = load({ teamInbox: 'Support Brightwell', brand: 'Brightwell' });
  neutralHolder(ctx.win);
  setBody(ctx.win, UNCLEAR);
  settle(ctx);
  const holder = neutralHolder(ctx.win);
  assert.equal(holder.getAttribute('data-isa-signature-status'), 'brand-unclear');
});

test('when the brand signals agree again the warning turns into the signed-as chip in the same place', () => {
  const ctx = showUnclear();
  setBody(ctx.win, { teamInbox: UNCLEAR.teamInbox, brand: 'Brightwell' });
  ctx.win.refreshSignatureStatus();
  const holder = neutralHolder(ctx.win);
  assert.equal(holder.getAttribute('data-isa-signature-status'), 'signed-as');
  assert.equal(chipOf(holder).textContent, 'Brightwell, EN');
});

test('note mode and an inbox with no brand show no signed-as chip', () => {
  const note = load({ teamInbox: 'Support Brightwell', brand: 'Brightwell', mode: 'note' });
  note.win.refreshSignatureStatus();
  assert.equal(allHolders(note.win).length, 0);
  const ordinary = load({ teamInbox: 'Billing', brand: '' });
  ordinary.win.refreshSignatureStatus();
  assert.equal(allHolders(ordinary.win).length, 0);
});

test('the signed-as chip opens a box that says what the reply is signed as', () => {
  const { win } = load({ teamInbox: 'Support Brightwell', brand: 'Brightwell' });
  const holder = neutralHolder(win);
  chipOf(holder).click();
  const box = holder.querySelector('.isa-signature-status-box');
  assert.ok(box);
  assert.match(box.textContent, /This reply is signed as/);
  assert.match(box.textContent, /Brightwell/);
});
