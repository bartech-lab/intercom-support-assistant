'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');
const { BANNERS, injectBanners } = require('../support/fixtures-banners');

const PAGE = '<!doctype html><html><body></body></html>';

function atTime(fixedNow) {
  return (window) => {
    injectBanners(window);
    const NativeDate = window.Date;
    class FixedDate extends NativeDate {
      static now() { return fixedNow; }
    }
    window.Date = FixedDate;
  };
}

test('the normalizer drops a bare brand site link but keeps a brand page link after the role line', () => {
  const window = loadExtension(PAGE);
  const signature = "<br>--<br>Best regards<br>Priya Raman<br>Customer Support Specialist<br><a href='https://www.orchard-kitchen.example/plans' target='_blank'>Compare our plans</a><br><a href='https://orchard-kitchen.example' target='_blank'>https://orchard-kitchen.example</a>";
  const normalized = window.ISA_SIGNATURE_NORMALIZER.normalizeCompanySignature(
    signature, 'english', 'Orchard Kitchen', { 'Orchard Kitchen': 'https://www.orchard-kitchen.example/' }
  );
  assert.equal(
    normalized,
    "<br>--<br>Best regards<br>Priya Raman<br>Customer Support at <a href='https://www.orchard-kitchen.example/' target='_blank'>Orchard Kitchen</a><br><a href='https://www.orchard-kitchen.example/plans' target='_blank'>Compare our plans</a>"
  );
});

test('team 900207 in a brand inbox selects the Orchard Kitchen signature', () => {
  const window = loadExtension(fx.inboxHtml({
    sidebar: fx.sidebarSection({ teamInbox: 'Support Orchard Kitchen' }),
    composer: fx.composer({ mode: 'email' })
  }), {
    url: 'https://app.intercom.com/a/inbox/demo1234/inbox/team/900207/conversation/456'
  });

  assert.equal(window.detectInboxType().name, 'Orchard Kitchen');
  const editor = window.document.querySelector('[contenteditable="true"]');
  window.insertSignature(editor);
  assert.match(editor.innerHTML, /Priya Raman/);
  assert.match(editor.innerHTML, /Orchard Kitchen/);
});

test('applyGreetingVariation preserves language pools and unknown signature shapes', () => {
  const window = loadExtension(PAGE);
  const signature = "<br>--<br>Viele Grüße<br>Maya Lindqvist<br>Kundenservice bei <a href='https://alderpoint.example' target='_blank'>Alderpoint</a>";
  window.Math.random = () => 0.99;
  const varied = window.applyGreetingVariation(signature);
  assert.strictEqual(varied.split('<br>')[2], 'Schöne Grüße');
  assert.ok(varied.includes('Kundenservice bei'), 'rest of the signature is untouched');

  window.Math.random = () => 0;
  const legacy = window.applyGreetingVariation('<br>--<br>Liebe Grüße<br>Elena Duarte');
  assert.strictEqual(legacy.split('<br>')[2], 'Viele Grüße');

  for (const unchanged of [
    '<br>--<br>Many thanks,<br>Support Desk',
    'Hello<br>world'
  ]) {
    assert.strictEqual(window.applyGreetingVariation(unchanged), unchanged);
  }
});

test('applyGreetingVariation rotates the new language pools', () => {
  const window = loadExtension(PAGE);

  const cases = [
    ['Com os melhores cumprimentos', 'Saudações', 'Com os melhores cumprimentos'],
    ['Muchas gracias', 'Que tenga un buen día', 'Atentamente'],
    ['Met vriendelijke groet', 'Fijne dag', 'Met vriendelijke groet']
  ];

  for (const [authored, last, first] of cases) {
    const signature = `<br>--<br>${authored}<br>Oskar Nilsen<br>Customer Support`;

    window.Math.random = () => 0.99;
    assert.strictEqual(window.applyGreetingVariation(signature).split('<br>')[2], last, authored);

    window.Math.random = () => 0;
    assert.strictEqual(window.applyGreetingVariation(signature).split('<br>')[2], first, authored);
  }
});

const CONVERSATION_URL =
  'https://app.intercom.com/a/inbox/demo1234/inbox/team/900207/conversation/456';

function loadConversation({ mode = 'email', customerText = 'Hello', url = CONVERSATION_URL } = {}) {
  return loadExtension(fx.inboxHtml({
    sidebar: fx.sidebarSection({ teamInbox: 'Support Orchard Kitchen' }),
    conversation: fx.conversationSpace({ customerText }),
    composer: fx.composer({ mode })
  }), { url });
}

function replyPicker(win) {
  return win.document.querySelector('.isa-draft-language-picker');
}

function replyChip(win, code) {
  return [...replyPicker(win).children].find(chip => chip.textContent === code);
}

function replyActiveCode(win) {
  const active = [...replyPicker(win).children]
    .find(chip => chip.classList.contains('isa-draft-language-chip-active'));
  return active ? active.textContent : null;
}

test('the language picker renders in the reply composer of a team inbox', () => {
  const win = loadConversation();
  win.refreshComposerLanguagePicker();

  const picker = replyPicker(win);
  assert.ok(picker, 'expected a picker in the conversation view');
  assert.deepEqual(
    [...picker.children].map(chip => chip.textContent),
    ['EN', 'DE', 'FR', 'IT', 'PT', 'ES', 'NL']
  );
  assert.strictEqual(replyActiveCode(win), 'EN');
});

test('a repeated pass never stacks reply pickers', () => {
  const win = loadConversation();
  win.refreshComposerLanguagePicker();
  win.refreshComposerLanguagePicker();
  win.refreshComposerLanguagePicker();

  assert.strictEqual(win.document.querySelectorAll('.isa-draft-language-picker').length, 1);
});

test('a note composer renders no language picker', () => {
  const win = loadConversation({ mode: 'note' });
  win.refreshComposerLanguagePicker();

  assert.strictEqual(replyPicker(win), null);
});

test('an excluded inbox, which never signs, renders no language picker', () => {
  const win = loadExtension(fx.inboxHtml({
    sidebar: fx.sidebarSection({ teamInbox: 'Tier 2', conversationAttrs: [fx.conversationAttrRow('9307', 'Brand', 'Brightwell')] }),
    conversation: fx.conversationSpace({ customerText: 'Hello' }),
    composer: fx.composer({ mode: 'email' })
  }), { url: 'https://app.intercom.com/a/inbox/demo1234/inbox/team/9009870/conversation/456' });

  assert.strictEqual(win.detectInboxType().type, 'excluded');
  win.refreshComposerLanguagePicker();
  assert.strictEqual(replyPicker(win), null);
});

test('picking a language in a conversation rewrites an untouched reply signature', () => {
  const win = loadConversation();
  const editor = win.document.querySelector('[contenteditable="true"]');
  win.insertSignature(editor);
  assert.match(editor.innerHTML, /Customer Support at/);

  replyChip(win, 'DE').dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));

  assert.match(editor.innerHTML, /Kundenservice bei/);
  assert.strictEqual(replyActiveCode(win), 'DE');
  assert.strictEqual(win.activeSignatureLanguage(), 'german');
});

test('a pick keeps the empty line above the signature, on the first and the second switch', () => {
  const win = loadConversation();
  const editor = win.document.querySelector('[contenteditable="true"]');
  const typingLine = editor.innerHTML;
  win.insertSignature(editor);
  assert.ok(editor.innerHTML.startsWith(`${typingLine}--`), editor.innerHTML);

  replyChip(win, 'DE').dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.match(editor.innerHTML, /Kundenservice bei/);
  assert.ok(editor.innerHTML.startsWith(`${typingLine}--`), editor.innerHTML);

  replyChip(win, 'FR').dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.match(editor.innerHTML, /Service client chez/);
  assert.ok(editor.innerHTML.startsWith(`${typingLine}--`), editor.innerHTML);
});

test('a reply the agent has typed over is never rewritten by a pick', () => {
  const win = loadConversation();
  const editor = win.document.querySelector('[contenteditable="true"]');
  win.insertSignature(editor);
  const edited = `<p>Guten Tag</p>${editor.innerHTML}`;
  editor.innerHTML = edited;

  replyChip(win, 'DE').dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));

  assert.strictEqual(editor.innerHTML, edited);
  assert.strictEqual(win.activeSignatureLanguage(), 'german', 'the pick still decides the next insertion');
});

test('a pick decides the language of a signature inserted after it', () => {
  const win = loadConversation();
  win.refreshComposerLanguagePicker();
  replyChip(win, 'IT').dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));

  const editor = win.document.querySelector('[contenteditable="true"]');
  win.insertSignature(editor);
  assert.match(editor.innerHTML, /Assistenza clienti presso/);
});

test('a pick has no memory across a conversation change', () => {
  const win = loadConversation();
  win.refreshComposerLanguagePicker();
  replyChip(win, 'IT').dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.strictEqual(win.activeSignatureLanguage(), 'italian');

  win.history.replaceState({}, '', CONVERSATION_URL.replace('/456', '/457'));
  win.handleConversationChange();

  assert.strictEqual(win.activeSignatureLanguage(), 'english', 'the next conversation auto-detects again');
  win.refreshComposerLanguagePicker();
  assert.strictEqual(replyActiveCode(win), 'EN');

  win.history.replaceState({}, '', CONVERSATION_URL);
  win.handleConversationChange();
  assert.strictEqual(win.activeSignatureLanguage(), 'english', 'returning to the first conversation does not bring the pick back');
});

test('a legacy formal German greeting is still rotated as German', () => {
  const window = loadExtension(PAGE);
  window.Math.random = () => 0;
  const varied = window.applyGreetingVariation('<br>--<br>Mit freundlichen Grüßen<br>Elena Duarte');
  assert.strictEqual(varied.split('<br>')[2], 'Viele Grüße');
});

test('a padded separator and greeting line are still recognised', () => {
  const window = loadExtension(PAGE);
  window.Math.random = () => 0.99;
  const signature = '<br> -- <br> Cordiali saluti <br>Oskar Nilsen<br>Assistenza clienti';
  assert.strictEqual(window.applyGreetingVariation(signature).split('<br>')[2], 'Saluti dal team');
});

test('a greeting line without a separator above it is never rewritten', () => {
  const window = loadExtension(PAGE);
  window.Math.random = () => 0.99;
  const signature = 'Best regards<br>Oskar Nilsen';
  assert.strictEqual(window.applyGreetingVariation(signature, 'english'), signature);
});

test('a language with no signature of its own falls back to English', () => {
  const window = loadExtension(PAGE);
  assert.strictEqual(window.pickSignature({ english: 'EN', german: 'DE' }, 'polish'), 'EN');
  assert.strictEqual(window.pickSignature({ english: 'EN', german: 'DE' }, 'german'), 'DE');
});

const normalizer = require('../../src/signature-normalizer');

const LINKS = { Brightwell: 'https://www.brightwell.example/' };
const normalize = (signature, language = 'english') =>
  normalizer.normalizeCompanySignature(signature, language, 'Brightwell', LINKS);
const BRAND = "<a href='https://www.brightwell.example/' target='_blank'>Brightwell</a>";

test('a role line in any supported language is replaced by that language template', () => {
  assert.strictEqual(normalize('--<br>Liv<br>Apoio ao Cliente', 'portuguese'), `--<br>Liv<br>Apoio ao Cliente em ${BRAND}`);
  assert.strictEqual(normalize('--<br>Liv<br>Atención al Cliente', 'spanish'), `--<br>Liv<br>Atención al Cliente en ${BRAND}`);
  assert.strictEqual(normalize('--<br>Liv<br>Klantenservice', 'dutch'), `--<br>Liv<br>Klantenservice van ${BRAND}`);
  assert.strictEqual(normalize('--<br>Signe<br>Kundenservice', 'german'), `--<br>Signe<br>Kundenservice bei ${BRAND}`);
});

test('signatures the normalizer cannot place are returned unchanged', () => {
  assert.strictEqual(normalize('--<br>Signe<br>Support team'), '--<br>Signe<br>Support team');
  const noRole = "--<br>Signe<br><a href='https://brightwell.example/'>brightwell.example</a>";
  assert.strictEqual(normalize(noRole), noRole);
  assert.strictEqual(normalize(undefined), undefined);
  assert.strictEqual(normalize('--<br>Signe<br>Customer Support', 'polish'), '--<br>Signe<br>Customer Support');
  assert.strictEqual(
    normalizer.normalizeCompanySignature('--<br>Signe<br>Customer Support', 'english', 'Unlinked', LINKS),
    '--<br>Signe<br>Customer Support'
  );
});

test('a plain brand line after the role line is dropped, @ prefix included, but a mailto link stays', () => {
  const mail = "<a href='mailto:help@brightwell.example'>help@brightwell.example</a>";
  assert.strictEqual(normalize(`--<br>Signe<br>Customer Support<br>@Brightwell<br>${mail}`), `--<br>Signe<br>Customer Support at ${BRAND}<br>${mail}`);
  assert.strictEqual(normalize('--<br>Signe<br>Customer Support<br>Bright Well'), `--<br>Signe<br>Customer Support at ${BRAND}`);
});

test('keys the normalizer does not own survive normalization', () => {
  const out = normalizer.normalizeCompanySignatures({ Brightwell: { english: '--<br>Customer Support', polish: 'PL', note: 'n' } }, LINKS);
  assert.strictEqual(out.Brightwell.english, `--<br>Customer Support at ${BRAND}`);
  assert.strictEqual(out.Brightwell.polish, 'PL');
  assert.strictEqual(out.Brightwell.note, 'n');
});
