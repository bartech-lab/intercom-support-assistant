'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const { unrefWindowTimers } = require('../support/helpers');

const ROOT = path.join(__dirname, '..', '..', 'src');
const settled = () => new Promise(resolve => setTimeout(resolve, 0));
const FAILURE = 'Could not open Settings. Try again.';

const PLATFORMS = [
  {
    name: 'Intercom',
    id: 'isa-alert-settings',
    attrs: '',
    on: { isaAlertEnabled: true, isaAlertEnabledInboxes: ['1'] },
    none: { isaAlertEnabled: true, isaAlertYourInbox: false, isaAlertEnabledInboxes: [] },
    off: { isaAlertEnabled: false, isaAlertEnabledInboxes: ['1'] },
    selectionChange: { isaAlertEnabledInboxes: { newValue: [] } }
  }
];

function load({ store = {}, mode = 'compact', failGet = false, deferGet = false, sendMessage = null } = {}) {
  const modeAttr = mode === 'compact' ? ' data-isa-compact="true"' : mode === 'expanded' ? ' data-isa-expanded="true"' : '';
  const listeners = [];
  const errors = [];
  const pending = [];
  const sent = [];
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="isa-alert-settings"${modeAttr}></div>
  </body></html>`, { url: 'https://example.test/popup', runScripts: 'outside-only' });
  const win = dom.window;
  unrefWindowTimers(win);
  win.addEventListener('error', event => errors.push(event.message));
  win.chrome = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        sent.push(JSON.parse(JSON.stringify(message)));
        if (sendMessage) sendMessage(win, message, callback);
        else if (callback) callback({ ok: true });
      }
    },
    storage: {
      onChanged: { addListener: fn => listeners.push(fn) },
      local: {
        get(defaults, callback) {
          if (failGet) {
            win.chrome.runtime.lastError = new Error('read failed');
            callback(null);
            delete win.chrome.runtime.lastError;
            return;
          }
          const result = {};
          Object.entries(defaults).forEach(([key, fallback]) => { result[key] = key in store ? store[key] : fallback; });
          if (deferGet) pending.push(() => callback(result));
          else callback(result);
        },
        set(items, callback) {
          Object.assign(store, items);
          if (callback) callback();
        }
      }
    }
  };
  win.SIGNATURE_DATA = {
    alertRoster: [{ teamId: '1', label: 'Urgent Northside' }, { teamId: '2', label: 'Urgent Southside' }]
  };
  const ctx = dom.getInternalVMContext();
  for (const file of ['alert-sounds.js', 'alert-settings-ui.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
  }
  return { win, store, listeners, errors, pending, sent, doc: win.document };
}

const block = (env, platform) => env.doc.getElementById(platform.id);
const summary = (env, platform) => block(env, platform).querySelector('[data-isa="summary"]');
const changeButtons = (env, platform) => summary(env, platform).querySelectorAll('button.isa-alert-change');

for (const platform of PLATFORMS) {
  test(`${platform.name}: a loaded compact summary has exactly one Change button of type button`, async () => {
    const env = load({ store: platform.on });
    await settled();
    const buttons = changeButtons(env, platform);
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].textContent.trim(), 'Change');
    assert.equal(buttons[0].getAttribute('type'), 'button');
    assert.deepEqual(env.errors, []);
  });

  test(`${platform.name}: clicking Change asks the extension to open the Settings section`, async () => {
    const env = load({ store: platform.on });
    await settled();
    changeButtons(env, platform)[0].click();
    await settled();
    assert.deepEqual(env.sent, [{ type: 'open-preview', section: 'settings' }]);
  });

  test(`${platform.name}: a successful click shows no failure text`, async () => {
    const env = load({ store: platform.on });
    await settled();
    changeButtons(env, platform)[0].click();
    await settled();
    assert.equal(block(env, platform).textContent.includes(FAILURE), false);
  });

  test(`${platform.name}: Change is present when nothing is selected`, async () => {
    const env = load({ store: platform.none });
    await settled();
    assert.match(summary(env, platform).querySelector('p').textContent, /^Selected: None/);
    assert.equal(changeButtons(env, platform).length, 1);
  });

  test(`${platform.name}: Change is present when alerts are switched off`, async () => {
    const env = load({ store: platform.off });
    await settled();
    assert.equal(changeButtons(env, platform).length, 1);
  });

  test(`${platform.name}: Change stays a single button after a selection change re-renders the summary`, async () => {
    const env = load({ store: platform.on });
    await settled();
    env.listeners.forEach(fn => fn(platform.selectionChange, 'local'));
    env.listeners.forEach(fn => fn(platform.selectionChange, 'local'));
    assert.equal(changeButtons(env, platform).length, 1);
  });

  test(`${platform.name}: Change stays a single button after the enabled switch is toggled`, async () => {
    const env = load({ store: platform.on });
    await settled();
    const toggle = block(env, platform).querySelector('[data-isa="enabled"]');
    toggle.click();
    await settled();
    toggle.click();
    await settled();
    assert.equal(changeButtons(env, platform).length, 1);
    changeButtons(env, platform)[0].click();
    assert.equal(env.sent.length, 1);
  });

  test(`${platform.name}: the Selected paragraph does not contain the button text`, async () => {
    const env = load({ store: platform.on });
    await settled();
    const paragraph = summary(env, platform).querySelector('p');
    assert.match(paragraph.textContent, /^Selected: /);
    assert.equal(paragraph.textContent.includes('Change'), false);
    assert.equal(paragraph.querySelector('button'), null);
  });

  test(`${platform.name}: expanded mode has no Change button`, async () => {
    const env = load({ store: platform.on, mode: 'expanded' });
    await settled();
    assert.equal(block(env, platform).querySelectorAll('button.isa-alert-change').length, 0);
  });

  test(`${platform.name}: no Change button while the selection is loading`, async () => {
    const env = load({ store: platform.on, deferGet: true });
    await settled();
    assert.equal(summary(env, platform).textContent, 'Loading selection…');
    assert.equal(block(env, platform).querySelectorAll('button.isa-alert-change').length, 0);
    env.pending.forEach(finish => finish());
    assert.equal(changeButtons(env, platform).length, 1);
  });

  test(`${platform.name}: no Change button when loading failed`, async () => {
    const env = load({ store: platform.on, failGet: true });
    await settled();
    assert.equal(summary(env, platform).textContent, 'Selection unavailable.');
    assert.equal(block(env, platform).querySelectorAll('button.isa-alert-change').length, 0);
  });

  test(`${platform.name}: a sendMessage that throws shows the failure text and throws nothing`, async () => {
    const env = load({ store: platform.on, sendMessage: () => { throw new Error('no runtime'); } });
    await settled();
    assert.doesNotThrow(() => changeButtons(env, platform)[0].click());
    await settled();
    assert.ok(block(env, platform).textContent.includes(FAILURE));
    assert.deepEqual(env.errors, []);
  });

  test(`${platform.name}: a callback with runtime.lastError shows the failure text`, async () => {
    const env = load({
      store: platform.on,
      sendMessage: (win, message, callback) => {
        win.chrome.runtime.lastError = { message: 'Receiving end does not exist.' };
        callback();
        win.chrome.runtime.lastError = null;
      }
    });
    await settled();
    assert.doesNotThrow(() => changeButtons(env, platform)[0].click());
    await settled();
    assert.ok(block(env, platform).textContent.includes(FAILURE));
    assert.deepEqual(env.errors, []);
  });

  test(`${platform.name}: the failure text appears only after a failed click`, async () => {
    const env = load({
      store: platform.on,
      sendMessage: (win, message, callback) => {
        win.chrome.runtime.lastError = { message: 'gone' };
        callback();
        win.chrome.runtime.lastError = null;
      }
    });
    await settled();
    assert.equal(block(env, platform).textContent.includes(FAILURE), false);
  });
}
