'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');

const NEW_CONVERSATION_URL =
  'https://app.intercom.com/a/inbox/demo1234/inbox/new-conversation?view=List';

function draftMarkup({
  channel = 'Email',
  senderName = 'Support Kestrel Kids',
  senderEmail = 'help@kestrel-kids.example',
  teamInbox = 'Support Kestrel Kids',
  recipient = null
} = {}) {
  const recipientPill = recipient
    ? `<div data-test-recipient-pill="true"><span>${recipient}</span></div>`
    : '';
  return `<div class="h-full w-full dark"><div class="h-full">
    <div data-testid="new-conversation-view" class="relative h-full w-full">
      <div class="h-full w-full flex">
        <div class="bg-base-module shadow-lvl-0 rounded-module">
          <div class="shrink-0 flex flex-row">
            <div class="mb-4 flex-auto">
              <div class="border border-neutral-border shadow-lvl-0">
                <div data-testid="new-conversation-channel-picker">
                  <button type="button" aria-label="Select channel" data-testid="dropdown-menu-trigger"
                          class="group flex items-center gap-1"><svg viewBox="0 0 16 16"></svg><span><span>${channel}</span></span><svg viewBox="0 0 16 16"></svg></button>
                </div>
                <div data-testid="composer-sender-area">
                  <div class="flex items-center py-2 border-b border-neutral-border">
                    <span class="shrink-0 text-base text-muted"><span>From</span></span>
                    <button type="button" data-test-sender-pill="true" data-testid="popover-trigger"
                            class="group ml-3 inline-flex items-center gap-1 rounded-full"><span class="truncate">${senderName}</span><span class="truncate text-muted">${senderEmail}</span></button>
                  </div>
                </div>
                <div data-testid="recipient-manager" data-composer-interactive="true">
                  <div data-testid="recipient-to-row" class="flex gap-3 py-2 items-center">
                    <span class="shrink-0 flex items-center text-muted">To</span>
                    <div data-testid="recipient-to-input" class="flex flex-1 flex-wrap items-center gap-2">${recipientPill}<div data-testid="recipient-selector" data-test-recipients-selector="true"><input role="combobox" aria-label="To recipients" type="text" value=""></div></div>
                  </div>
                </div>
                <div data-testid="new-conversation-subject"><input type="text" placeholder="Subject"></div>
                <div><div>
                  <div data-testid="composer-orchestrator" class="relative flex flex-col">
                    <div data-testid="composer-editor-area" class="relative mx-1 min-h-[72px]">
                      <div data-testid="composer-scroll-boundary" class="relative grow">
                        <div class="grid min-w-0"><div class="min-w-0 relative z-[1]">
                          <div class="composer-react-wrapper border-neutral-border no-paragraph-margin">
                            <div><div class="tiptap ProseMirror" contenteditable="true" translate="no"><p></p></div></div>
                          </div>
                        </div></div>
                      </div>
                    </div>
                    <div data-testid="composer-actions-bar">
                      <div data-testid="send-button-container"><button data-testid="send-button">Send</button></div>
                    </div>
                  </div>
                </div></div>
              </div>
            </div>
            <div data-testid="new-conversation-sidebar-column">
              <div data-testid="draft-team-assignee" class="flex flex-row items-center">
                <div class="w-2/5 py-px text-muted shrink-0"><span class="block truncate"><span>Team Inbox</span></span></div>
                <div class="w-3/5 px-1 min-w-0">
                  <button type="button" aria-label="Change team" data-testid="team-assignee-selector"><span class="truncate flex items-center ml-1"><svg data-testid="team-icon-fallback" viewBox="0 0 16 16"></svg><span class="ml-2">${teamInbox}</span></span></button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div></div>`;
}

function loadDraft(options = {}) {
  return loadExtension(
    '<!doctype html><html><body><div id="teammate-app-react"></div></body></html>',
    {
      url: NEW_CONVERSATION_URL,
      beforeScripts(win) {
        const host = win.document.getElementById('teammate-app-react');
        host.attachShadow({ mode: 'open' }).innerHTML = draftMarkup(options);
      }
    }
  );
}

function loadDraftCapturingConsole(options = {}) {
  const calls = { warn: [], debug: [], error: [], log: [], info: [] };
  const win = loadExtension(
    '<!doctype html><html><body><div id="teammate-app-react"></div></body></html>',
    {
      url: NEW_CONVERSATION_URL,
      beforeScripts(w) {
        w.document.getElementById('teammate-app-react')
          .attachShadow({ mode: 'open' }).innerHTML = draftMarkup(options);
        for (const level of Object.keys(calls)) {
          w.console[level] = (...args) => calls[level].push(args.join(' '));
        }
      }
    }
  );
  return { win, calls };
}

function editorOf(win) {
  return win.document.getElementById('teammate-app-react').shadowRoot
    .querySelector('.tiptap.ProseMirror[contenteditable="true"]');
}

function clickEditor(win) {
  const editor = editorOf(win);
  editor.dispatchEvent(new win.MouseEvent('click', { bubbles: true, composed: true, cancelable: true, button: 0 }));
  return editor;
}

test('the editor lives in the #teammate-app-react shadow root on this view', () => {
  const win = loadDraft();
  assert.equal(win.document.querySelector('.tiptap.ProseMirror'), null);
  assert.ok(editorOf(win), 'editor must be reachable only through the shadow root');
});

test('getComposerMode reads the channel picker, not the dead ember icon', () => {
  const win = loadDraft();
  assert.equal(win.getComposerMode(), 'email');
});

test('a Note channel resolves to note', () => {
  const win = loadDraft({ channel: 'Note' });
  assert.equal(win.getComposerMode(), 'note');
});

test('getSelectedSenderEmail reads the React sender pill', () => {
  const win = loadDraft();
  assert.equal(win.getSelectedSenderEmail(), 'help@kestrel-kids.example');
});

test('getVisibleTeamInboxName reads the draft team assignee', () => {
  const win = loadDraft();
  assert.equal(win.getVisibleTeamInboxName(), 'Support Kestrel Kids');
});

test('the signature follows the sender, not a stale Team Inbox', () => {
  const win = loadDraft({ teamInbox: 'Support Fernhill' });
  const editor = clickEditor(win);
  const html = editor.innerHTML.toLowerCase();

  assert.ok(html.length > '<p></p>'.length, 'insertion must not wait for the Team Inbox to catch up');
  assert.ok(html.includes('kestrel'), 'must sign as the sender brand');
  assert.ok(!html.includes('fernhill'), 'must never sign as the stale Team Inbox brand');
});

test('a Note channel inserts nothing even when inbox and sender agree', () => {
  const win = loadDraft({ channel: 'Note' });
  const editor = clickEditor(win);
  assert.equal(editor.innerHTML, '<p></p>');
});

const RECIPIENT_ID = '900fcbb36062854afdf312d1';

function contactEnvelope(over = {}) {
  return {
    __isaic: true,
    version: 1,
    kind: 'contact-language',
    userId: RECIPIENT_ID,
    languageOverride: null,
    browserLocale: null,
    countryCode: null,
    ...over
  };
}

function deliverContact(win, over = {}, { source = win, origin = 'https://app.intercom.com' } = {}) {
  win.dispatchEvent(new win.MessageEvent('message', { data: contactEnvelope(over), source, origin }));
}

function pickerCodes(win) {
  const picker = win.document.getElementById('teammate-app-react').shadowRoot
    .querySelector('.isa-draft-language-picker');
  if (!picker) return null;
  return [...picker.children].map(chip => ({
    code: chip.textContent,
    active: chip.classList.contains('isa-draft-language-chip-active')
  }));
}

function activeCode(win) {
  const codes = pickerCodes(win);
  return codes ? (codes.find(entry => entry.active) || {}).code : null;
}

test('a recipient language override decides the draft signature language', () => {
  const win = loadDraft({ recipient: 'Klaus Wexley' });
  deliverContact(win, { languageOverride: 'de' });

  const editor = clickEditor(win);
  assert.equal(win.draftSignatureLanguage(), 'german');
  assert.ok(/Kundenservice bei/.test(editor.innerHTML), editor.innerHTML);
});

test('a recipient country decides the language when the browser locale is English', () => {
  const win = loadDraft({ recipient: 'Klaus Wexley' });
  deliverContact(win, { browserLocale: 'en', countryCode: 'DE' });

  assert.equal(win.draftSignatureLanguage(), 'german');
});

test('a country with no supported language falls back to English', () => {
  const win = loadDraft({ recipient: 'Rafe Varden' });
  deliverContact(win, { browserLocale: 'en', countryCode: 'CA' });

  assert.equal(win.draftSignatureLanguage(), 'english');
});

test('a non-English browser locale outranks the country', () => {
  const win = loadDraft({ recipient: 'Teo Rowan' });
  deliverContact(win, { browserLocale: 'it-IT', countryCode: 'DE' });

  assert.equal(win.draftSignatureLanguage(), 'italian');
});

test('no recipient means English', () => {
  const win = loadDraft();
  assert.equal(win.draftSignatureLanguage(), 'english');
  clickEditor(win);
  assert.equal(activeCode(win), 'EN');
});

test('a contact envelope from a foreign origin is ignored', () => {
  const win = loadDraft({ recipient: 'Klaus Wexley' });
  deliverContact(win, { languageOverride: 'de' }, { origin: 'https://evil.example.com' });
  assert.equal(win.draftSignatureLanguage(), 'english');
});

test('the recipient language replaces a signature the agent has not touched', () => {
  const win = loadDraft({ recipient: 'Klaus Wexley' });
  const editor = clickEditor(win);
  assert.ok(editor.innerHTML.includes('Customer Support at'), 'starts in English');

  deliverContact(win, { languageOverride: 'de' });
  assert.ok(/Kundenservice bei/.test(editor.innerHTML), 'switches to German in place');
  assert.equal(activeCode(win), 'DE');
});

test('a signature the agent has typed over is never replaced', () => {
  const win = loadDraft({ recipient: 'Klaus Wexley' });
  const editor = clickEditor(win);
  const edited = `<p>Hallo</p>${editor.innerHTML}`;
  editor.innerHTML = edited;

  deliverContact(win, { languageOverride: 'de' });
  assert.equal(editor.innerHTML, edited, 'an edited draft is left alone');
});

test('a manual pick outranks a later recipient detection', () => {
  const win = loadDraft({ recipient: 'Klaus Wexley' });
  const editor = clickEditor(win);

  const picker = win.document.getElementById('teammate-app-react').shadowRoot
    .querySelector('.isa-draft-language-picker');
  const italian = [...picker.children].find(chip => chip.textContent === 'IT');
  italian.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));

  assert.equal(win.draftSignatureLanguage(), 'italian');
  assert.equal(activeCode(win), 'IT');

  deliverContact(win, { languageOverride: 'de' });
  assert.equal(win.draftSignatureLanguage(), 'italian', 'the agent wins');
  assert.equal(activeCode(win), 'IT');
  assert.ok(editor.innerHTML.includes('Assistenza clienti presso'), editor.innerHTML);
});

function pickLanguage(win, code) {
  const picker = win.document.getElementById('teammate-app-react').shadowRoot
    .querySelector('.isa-draft-language-picker');
  const chip = [...picker.children].find(entry => entry.textContent === code);
  chip.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
}

function recipientInput(win) {
  return win.document.getElementById('teammate-app-react').shadowRoot
    .querySelector('[data-testid="recipient-to-input"]');
}

function swapRecipient(win, name) {
  recipientInput(win).querySelector('[data-test-recipient-pill="true"] span').textContent = name;
}

test('swapping the recipient discards the pick and lets detection decide again', () => {
  const win = loadDraft({ recipient: 'Klaus Wexley' });
  clickEditor(win);
  pickLanguage(win, 'IT');
  assert.equal(win.draftSignatureLanguage(), 'italian');

  swapRecipient(win, 'Teo Rowan');
  win.refreshComposerLanguageState();
  assert.equal(win.draftSignatureLanguage(), 'english', 'the pick belonged to the previous recipient');

  deliverContact(win, { browserLocale: 'de-DE' });
  assert.equal(win.draftSignatureLanguage(), 'german', 'the new recipient decides');
  assert.equal(activeCode(win), 'DE');
});

test('a language arriving for a new recipient discards the pick without a state pass', () => {
  const win = loadDraft({ recipient: 'Klaus Wexley' });
  clickEditor(win);
  pickLanguage(win, 'IT');

  swapRecipient(win, 'Teo Rowan');
  deliverContact(win, { browserLocale: 'de-DE' });
  assert.equal(win.draftSignatureLanguage(), 'german');
});

test('a delayed response for a previous recipient cannot restore its language', () => {
  const win = loadDraft({ recipient: 'Klaus Wexley' });
  deliverContact(win, { browserLocale: 'de-DE' });

  swapRecipient(win, 'Teo Rowan');
  deliverContact(win, { browserLocale: 'de-DE' });
  assert.equal(win.draftSignatureLanguage(), 'english');

  deliverContact(win, { userId: 'aaaaaaaaaaaaaaaaaaaaaaaa', browserLocale: 'it-IT' });
  assert.equal(win.draftSignatureLanguage(), 'italian');
});

test('a late response stays rejected across another recipient swap, while a return recipient can decide again', () => {
  const win = loadDraft({ recipient: 'Klaus Wexley' });
  deliverContact(win, { browserLocale: 'de-DE' });

  swapRecipient(win, 'Teo Rowan');
  deliverContact(win, { userId: 'bbbbbbbbbbbbbbbbbbbbbbbb', browserLocale: 'it-IT' });
  assert.equal(win.draftSignatureLanguage(), 'italian');

  swapRecipient(win, 'Rafe Varden');
  deliverContact(win, { userId: 'cccccccccccccccccccccccc', browserLocale: 'fr-FR' });
  assert.equal(win.draftSignatureLanguage(), 'french');

  deliverContact(win, { browserLocale: 'de-DE' });
  assert.equal(win.draftSignatureLanguage(), 'french', 'late A must stay rejected for C');

  swapRecipient(win, 'Klaus Wexley');
  deliverContact(win, { browserLocale: 'de-DE' });
  assert.equal(win.draftSignatureLanguage(), 'german', 'A can decide after the recipient returns');
});

test('known delayed responses stay rejected after more than twenty recipient changes', () => {
  const win = loadDraft({ recipient: 'First Recipient' });
  deliverContact(win, { browserLocale: 'de-DE' });
  for (let index = 1; index <= 21; index += 1) {
    swapRecipient(win, `Recipient ${index}`);
    deliverContact(win, { userId: String(index).padStart(24, '0'), browserLocale: 'it-IT' });
  }
  deliverContact(win, { browserLocale: 'de-DE' });
  assert.equal(win.draftSignatureLanguage(), 'italian');
  win.close();
});

test('a contact envelope with no usable data restores the normal English fallback', () => {
  const win = loadDraft({ recipient: 'Klaus Wexley' });
  deliverContact(win, { browserLocale: 'de-DE' });
  assert.equal(win.draftSignatureLanguage(), 'german');

  deliverContact(win);
  assert.equal(win.draftSignatureLanguage(), 'english', 'missing data clears the detected language');

  swapRecipient(win, 'Teo Rowan');
  deliverContact(win, { userId: 'bbbbbbbbbbbbbbbbbbbbbbbb' });
  assert.equal(win.draftSignatureLanguage(), 'english');
});

test('missing language data after a recipient swap replaces an untouched signature with English', () => {
  const win = loadDraft({ recipient: 'Klaus Wexley' });
  const editor = clickEditor(win);
  deliverContact(win, { browserLocale: 'de-DE' });
  assert.match(editor.innerHTML, /Kundenservice bei/);

  swapRecipient(win, 'Teo Rowan');
  deliverContact(win, { userId: 'bbbbbbbbbbbbbbbbbbbbbbbb' });

  assert.match(editor.innerHTML, /Customer Support at/);
  assert.doesNotMatch(editor.innerHTML, /Kundenservice bei/);
});

test('missing language data after a recipient swap preserves an edited signature', () => {
  const win = loadDraft({ recipient: 'Klaus Wexley' });
  const editor = clickEditor(win);
  deliverContact(win, { browserLocale: 'de-DE' });
  const edited = `<p>Hallo</p>${editor.innerHTML}`;
  editor.innerHTML = edited;

  swapRecipient(win, 'Teo Rowan');
  deliverContact(win, { userId: 'bbbbbbbbbbbbbbbbbbbbbbbb' });

  assert.equal(editor.innerHTML, edited);
});

test('a throttled recipient mutation refreshes the untouched signature in the trailing pass', async () => {
  const win = loadDraft({ recipient: 'Klaus Wexley' });
  const editor = clickEditor(win);
  deliverContact(win, { browserLocale: 'de-DE' });
  assert.match(editor.innerHTML, /Kundenservice bei/);

  win.document.body.appendChild(win.document.createElement('div'));
  await new Promise(resolve => setTimeout(resolve, 0));
  swapRecipient(win, 'Teo Rowan');
  await new Promise(resolve => setTimeout(resolve, 180));

  assert.match(editor.innerHTML, /Customer Support at/);
  assert.doesNotMatch(editor.innerHTML, /Kundenservice bei/);
});

test('clearing the recipient discards the pick as well as the detection', () => {
  const win = loadDraft({ recipient: 'Klaus Wexley' });
  clickEditor(win);
  deliverContact(win, { languageOverride: 'de' });
  pickLanguage(win, 'IT');
  assert.equal(win.draftSignatureLanguage(), 'italian');

  recipientInput(win).querySelector('[data-test-recipient-pill="true"]').remove();
  win.refreshComposerLanguageState();
  assert.equal(win.draftSignatureLanguage(), 'english');
});

test('a pick made before any recipient loses to the recipient chosen after it', () => {
  const win = loadDraft();
  clickEditor(win);
  pickLanguage(win, 'IT');
  assert.equal(win.draftSignatureLanguage(), 'italian');

  const input = recipientInput(win);
  const pill = win.document.createElement('div');
  pill.setAttribute('data-test-recipient-pill', 'true');
  pill.innerHTML = '<span>Klaus Wexley</span>';
  input.insertBefore(pill, input.firstChild);

  deliverContact(win, { languageOverride: 'de' });
  assert.equal(win.draftSignatureLanguage(), 'german');
});

test('a pick survives a repeated state pass while the recipient is unchanged', () => {
  const win = loadDraft({ recipient: 'Klaus Wexley' });
  clickEditor(win);
  pickLanguage(win, 'IT');

  win.refreshComposerLanguageState();
  win.refreshComposerLanguageState();
  assert.equal(win.draftSignatureLanguage(), 'italian');
  assert.equal(activeCode(win), 'IT');
});

test('the picker offers all seven languages and marks exactly one active', () => {
  const win = loadDraft();
  win.refreshComposerLanguagePicker();

  const codes = pickerCodes(win);
  assert.deepEqual(codes.map(entry => entry.code), ['EN', 'DE', 'FR', 'IT', 'PT', 'ES', 'NL']);
  assert.equal(codes.filter(entry => entry.active).length, 1);
});

test('a repeated pass never stacks pickers', () => {
  const win = loadDraft();
  win.refreshComposerLanguagePicker();
  win.refreshComposerLanguagePicker();
  win.refreshComposerLanguagePicker();

  const shadow = win.document.getElementById('teammate-app-react').shadowRoot;
  assert.equal(shadow.querySelectorAll('.isa-draft-language-picker').length, 1);
});

test('clearing the recipient drops the detected language', () => {
  const win = loadDraft({ recipient: 'Klaus Wexley' });
  deliverContact(win, { languageOverride: 'de' });
  assert.equal(win.draftSignatureLanguage(), 'german');

  const input = win.document.getElementById('teammate-app-react').shadowRoot
    .querySelector('[data-testid="recipient-to-input"]');
  input.querySelector('[data-test-recipient-pill="true"]').remove();

  win.refreshComposerLanguageState();
  assert.equal(win.draftSignatureLanguage(), 'english');
});

function setTeamInbox(win, name) {
  const shadow = win.document.getElementById('teammate-app-react').shadowRoot;
  shadow.querySelector('[data-testid="team-assignee-selector"] .ml-2').textContent = name;
}

function settleTeamInbox(win) {
  win.observeDraftTeamInbox();
}

test('a Team Inbox changed by hand decides the signature, not the From address', () => {
  const win = loadDraft({ senderName: 'Support Alderpoint', senderEmail: 'help@alderpoint.example', teamInbox: 'Support Alderpoint' });
  settleTeamInbox(win);
  setTeamInbox(win, 'Support Brightwell');

  assert.equal(win.manualDraftTeamInboxName(), 'Support Brightwell');

  const editor = clickEditor(win);
  assert.ok(editor.innerHTML.includes('Tomás Rivera'), editor.innerHTML);
  assert.ok(!editor.innerHTML.includes('Maya Lindqvist'), 'the sender brand signer must not sign');
  assert.ok(editor.innerHTML.includes('brightwell.example'), 'and it is a Brightwell signature');
});

test('a Team Inbox that has not settled is still ignored in favour of the sender', () => {
  const win = loadDraft({ teamInbox: 'Support Fernhill' });
  assert.equal(win.manualDraftTeamInboxName(), null, 'a lagging inbox is not a manual choice');

  const editor = clickEditor(win);
  const html = editor.innerHTML.toLowerCase();
  assert.ok(html.includes('kestrel'));
  assert.ok(!html.includes('fernhill'));
});

test('a hand-picked plain brand Team Inbox signs as that brand', () => {
  const win = loadDraft({ teamInbox: 'Support Kestrel Kids' });
  settleTeamInbox(win);
  setTeamInbox(win, 'Support Fernhill');

  const editor = clickEditor(win);
  const html = editor.innerHTML.toLowerCase();
  assert.ok(html.includes('fernhill'), html);
  assert.ok(!html.includes('kestrel-kids.example'), 'the sender brand must not win any more');
});

test('a hand-picked excluded inbox inserts nothing', () => {
  const win = loadDraft({ teamInbox: 'Support Kestrel Kids' });
  settleTeamInbox(win);
  setTeamInbox(win, 'Tier 2');

  const editor = clickEditor(win);
  assert.equal(editor.innerHTML, '<p></p>');
});

test('the hand-picked Team Inbox also drives the language picker replacement', () => {
  const win = loadDraft({ senderName: 'Support Alderpoint', senderEmail: 'help@alderpoint.example', teamInbox: 'Support Alderpoint', recipient: 'Klaus Wexley' });
  settleTeamInbox(win);
  setTeamInbox(win, 'Support Brightwell');

  clickEditor(win);
  deliverContact(win, { languageOverride: 'de' });

  const editor = editorOf(win);
  assert.ok(/Kundenservice bei/.test(editor.innerHTML), editor.innerHTML);
  assert.ok(editor.innerHTML.includes('Tomás Rivera'), 'still the hand-picked brand signer');
});

test('a stale Team Inbox produces no console noise at all', () => {
  const { win, calls } = loadDraftCapturingConsole({ teamInbox: 'Support Fernhill' });
  clickEditor(win);

  assert.deepEqual(calls.warn, [], 'a lagging Team Inbox is not a fault');
  assert.deepEqual(calls.debug, [], 'and it is no longer even worth a note');
  assert.deepEqual(calls.error, []);
  assert.deepEqual(calls.log, []);
  assert.deepEqual(calls.info, []);
});

test('an unmapped sender is a debug note, never a warning in the Errors panel', () => {
  const { win, calls } = loadDraftCapturingConsole({
    senderName: 'Support', senderEmail: 'support@marlowe-books.example'
  });
  const editor = clickEditor(win);

  assert.equal(editor.innerHTML, '<p></p>', 'insertion must be blocked');
  assert.deepEqual(calls.warn, [], 'must not reach console.warn');
  assert.ok(
    calls.debug.some(line => line.includes('maps to no brand')),
    'must stay traceable at debug level'
  );
});

test('a failed team-inbox apply is never retried in a loop by the observer pass', () => {
  const win = loadDraft({ teamInbox: 'General chats' });
  const opener = win.document.getElementById('teammate-app-react').shadowRoot
    .querySelector('[data-testid="team-assignee-selector"]');
  const timers = [];
  win.setTimeout = (callback) => { timers.push(callback); return timers.length; };
  win.clearTimeout = () => {};

  let openerClicks = 0;
  opener.addEventListener('click', () => { openerClicks += 1; });

  win.syncTeamInboxFromSender();
  assert.equal(openerClicks, 1, 'the first sync opens the picker');

  for (let step = 0; step < 500 && timers.length; step += 1) timers.shift()();
  assert.equal(timers.length, 0, 'the retry chain ran to its end');
  assert.equal(win.eval('applyingTeamInbox'), false, 'the apply has failed and is no longer in flight');

  for (let pass = 0; pass < 25; pass += 1) win.syncTeamInboxFromSender();

  assert.equal(openerClicks, 1, 'a failed apply must not re-open the picker on later passes');

  const pillSpans = win.document.getElementById('teammate-app-react').shadowRoot
    .querySelectorAll('[data-test-sender-pill="true"] span');
  pillSpans[pillSpans.length - 1].textContent = 'help@fernhill.example';

  win.syncTeamInboxFromSender(true);
  assert.equal(openerClicks, 2, 'a deliberate sender change is never throttled by the cooldown');
});

test('switching sender applies the new Team Inbox with no cooldown between senders', () => {
  const win = loadDraft({ teamInbox: 'General chats' });
  const shadow = win.document.getElementById('teammate-app-react').shadowRoot;
  const opener = shadow.querySelector('[data-testid="team-assignee-selector"]');
  const pillSpans = shadow.querySelectorAll('[data-test-sender-pill="true"] span');
  const senderSpan = pillSpans[pillSpans.length - 1];

  let openerClicks = 0;
  opener.addEventListener('click', () => { openerClicks += 1; });

  win.syncTeamInboxFromSender();
  assert.equal(openerClicks, 1, 'the first sender is applied at once');

  senderSpan.textContent = 'help@fernhill.example';
  win.syncTeamInboxFromSender();
  assert.equal(openerClicks, 2, 'a changed sender is applied on the very next pass');

  senderSpan.textContent = 'help@brightwell.example';
  win.syncTeamInboxFromSender();
  assert.equal(openerClicks, 3, 'and so is the one after it');
});

test('a sender picked while the opening apply is in flight is not made to wait for it', () => {
  const win = loadDraft({ teamInbox: 'General chats' });
  const shadow = win.document.getElementById('teammate-app-react').shadowRoot;
  const opener = shadow.querySelector('[data-testid="team-assignee-selector"]');
  const pillSpans = shadow.querySelectorAll('[data-test-sender-pill="true"] span');
  const senderSpan = pillSpans[pillSpans.length - 1];

  let openerClicks = 0;
  opener.addEventListener('click', () => { openerClicks += 1; });

  win.syncTeamInboxFromSender();
  assert.equal(openerClicks, 1, 'the pre-filled sender starts an apply');

  senderSpan.textContent = 'help@fernhill.example';
  win.syncTeamInboxFromSender();

  assert.equal(openerClicks, 2, 'the new sender supersedes the in-flight apply at once');
});

test('syncTeamInboxFromSender now fires on this view instead of bailing on the dead anchor', () => {
  const win = loadDraft({ teamInbox: 'Support Fernhill' });
  const opener = win.document.getElementById('teammate-app-react').shadowRoot
    .querySelector('[data-testid="team-assignee-selector"]');
  let openerClicks = 0;
  opener.addEventListener('click', () => { openerClicks += 1; });
  win.syncTeamInboxFromSender();
  assert.equal(openerClicks, 1, 'the draft opener is the anchor the sync clicks');
});
