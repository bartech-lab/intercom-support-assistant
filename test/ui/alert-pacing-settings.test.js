'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const { unrefWindowTimers } = require('../support/helpers');

const ROOT = path.join(__dirname, '..', '..', 'src');
const NOW = new Date(2026, 0, 15, 10, 0).getTime();
const MIN = 60000;
const settled = () => new Promise(resolve => setTimeout(resolve, 0));

function load({ store = {}, compact = false, failSet = false, throwSet = false, noStorage = false, markup = null } = {}) {
  const attr = compact ? ' data-isa-compact="true"' : '';
  const dom = new JSDOM(`<!doctype html><html><body>${markup === null ? `<div id="isa-alert-pacing"${attr}></div>` : markup}</body></html>`, {
    url: 'https://example.test/popup',
    runScripts: 'outside-only'
  });
  const win = dom.window;
  unrefWindowTimers(win);
  const writes = [];
  const listeners = [];
  win.Date.now = () => NOW;
  win.chrome = {
    runtime: { lastError: null },
    storage: noStorage ? undefined : {
      onChanged: { addListener: fn => listeners.push(fn) },
      local: {
        get(defaults, callback) {
          const result = {};
          Object.entries(defaults).forEach(([key, fallback]) => { result[key] = key in store ? store[key] : fallback; });
          callback(result);
        },
        set(items, callback) {
          writes.push(JSON.parse(JSON.stringify(items)));
          if (throwSet) throw new Error('write threw');
          if (failSet) {
            win.chrome.runtime.lastError = { message: 'write denied' };
            if (callback) callback();
            win.chrome.runtime.lastError = null;
            return;
          }
          Object.assign(store, items);
          if (callback) callback();
        }
      }
    }
  };
  const ctx = dom.getInternalVMContext();
  for (const file of ['field-input.js', 'alert-sounds.js', 'alert-settings-ui.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
  }
  return { win, writes, store, listeners, doc: win.document };
}

const q = (env, selector) => env.doc.querySelector(selector);
const label = env => q(env, '[data-isa="muteLabel"]').textContent.trim();
const hidden = element => element.hidden || element.style.display === 'none' || element.getAttribute('aria-hidden') === 'true';
const buttonsHidden = env => hidden(q(env, '[data-isa="muteButtons"]'));
const unmuteHidden = env => hidden(q(env, '[data-isa="unmute"]'));
const status = env => q(env, '[data-isa="pacingStatus"]').textContent;
const change = (env, selector, value) => {
  const input = q(env, selector);
  input.value = value;
  input.dispatchEvent(new env.win.Event('change', { bubbles: true }));
};

const MODES = [['expanded', false], ['compact', true]];

for (const [name, compact] of MODES) {
  test(`${name}: three mute buttons for 15, 30 and 60 minutes exist`, async () => {
    const env = load({ compact });
    await settled();
    const values = [...env.doc.querySelectorAll('[data-isa-mute]')].map(b => b.getAttribute('data-isa-mute'));
    assert.deepEqual(values, ['15', '30', '60']);
  });

  for (const minutes of [15, 30, 60]) {
    test(`${name}: the ${minutes} minute button stores a mute that ends ${minutes} minutes from now`, async () => {
      const env = load({ compact });
      await settled();
      q(env, `[data-isa-mute="${minutes}"]`).click();
      await settled();
      assert.equal(env.store.isaAlertMuteUntil, NOW + minutes * MIN);
    });
  }

  test(`${name}: a stored future mute shows Muted until HH:MM, hides the buttons and shows Unmute`, async () => {
    const until = new Date(2026, 0, 15, 10, 45).getTime();
    const env = load({ compact, store: { isaAlertMuteUntil: until } });
    await settled();
    assert.equal(label(env), 'Muted until 10:45');
    assert.equal(buttonsHidden(env), true);
    assert.equal(unmuteHidden(env), false);
  });

  test(`${name}: the muted time is 24-hour and zero padded`, async () => {
    const until = new Date(2026, 0, 15, 14, 5).getTime();
    const env = load({ compact, store: { isaAlertMuteUntil: until } });
    await settled();
    assert.equal(label(env), 'Muted until 14:05');
    const early = load({ compact, store: { isaAlertMuteUntil: new Date(2026, 0, 16, 0, 7).getTime() } });
    await settled();
    assert.equal(label(early), 'Muted until 00:07');
  });

  test(`${name}: Unmute stores 0 and brings back the label and the buttons`, async () => {
    const env = load({ compact, store: { isaAlertMuteUntil: NOW + 30 * MIN } });
    await settled();
    q(env, '[data-isa="unmute"]').click();
    await settled();
    assert.equal(env.store.isaAlertMuteUntil, 0);
    assert.equal(label(env), 'Mute alerts for');
    assert.equal(buttonsHidden(env), false);
    assert.equal(unmuteHidden(env), true);
  });

  test(`${name}: a stored mute in the past shows the unmuted state`, async () => {
    const env = load({ compact, store: { isaAlertMuteUntil: NOW - 1 } });
    await settled();
    assert.equal(label(env), 'Mute alerts for');
    assert.equal(buttonsHidden(env), false);
    assert.equal(unmuteHidden(env), true);
  });

  test(`${name}: a mute that ends exactly now shows the unmuted state`, async () => {
    const env = load({ compact, store: { isaAlertMuteUntil: NOW } });
    await settled();
    assert.equal(label(env), 'Mute alerts for');
  });

  test(`${name}: with nothing stored the unmuted state shows`, async () => {
    const env = load({ compact });
    await settled();
    assert.equal(label(env), 'Mute alerts for');
    assert.equal(buttonsHidden(env), false);
  });

  test(`${name}: clicking a mute button shows the muted state`, async () => {
    const env = load({ compact });
    await settled();
    q(env, '[data-isa-mute="15"]').click();
    await settled();
    assert.equal(label(env), 'Muted until 10:15');
    assert.equal(buttonsHidden(env), true);
  });

  test(`${name}: a mute set elsewhere updates the label`, async () => {
    const env = load({ compact });
    await settled();
    const until = new Date(2026, 0, 15, 11, 30).getTime();
    env.listeners.forEach(fn => fn({ isaAlertMuteUntil: { newValue: until } }, 'local'));
    assert.equal(label(env), 'Muted until 11:30');
  });

  test(`${name}: a failed save of a mute goes back to unmuted and shows the error`, async () => {
    const env = load({ compact, failSet: true });
    await settled();
    q(env, '[data-isa-mute="30"]').click();
    await settled();
    assert.equal(label(env), 'Mute alerts for');
    assert.equal(buttonsHidden(env), false);
    assert.equal(status(env), 'Could not save this setting. Try again.');
  });

  test(`${name}: a thrown save of a mute goes back to unmuted and shows the error`, async () => {
    const env = load({ compact, throwSet: true });
    await settled();
    q(env, '[data-isa-mute="30"]').click();
    await settled();
    assert.equal(label(env), 'Mute alerts for');
    assert.equal(status(env), 'Could not save this setting. Try again.');
  });

  test(`${name}: a failed Unmute keeps showing the mute and shows the error`, async () => {
    const env = load({ compact, failSet: true, store: { isaAlertMuteUntil: NOW + 30 * MIN } });
    await settled();
    q(env, '[data-isa="unmute"]').click();
    await settled();
    assert.equal(label(env), 'Muted until 10:30');
    assert.equal(status(env), 'Could not save this setting. Try again.');
  });

  test(`${name}: without chrome.storage mounting throws nothing and shows the unmuted state`, async () => {
    let env;
    assert.doesNotThrow(() => { env = load({ compact, noStorage: true }); });
    await settled();
    assert.equal(label(env), 'Mute alerts for');
    assert.equal(buttonsHidden(env), false);
  });

  test(`${name}: mounting twice on the same container does not duplicate the controls`, async () => {
    const env = load({ compact });
    await settled();
    const before = env.doc.querySelectorAll('#isa-alert-pacing *').length;
    env.win.ISA_ALERT_SETTINGS.mountPacing(q(env, '#isa-alert-pacing'));
    await settled();
    assert.equal(env.doc.querySelectorAll('#isa-alert-pacing *').length, before);
    assert.equal(env.doc.querySelectorAll('[data-isa-mute="15"]').length, 1);
    assert.equal(env.doc.querySelectorAll('[data-isa="muteLabel"]').length, 1);
  });
}

test('compact mode has no repeat switch and no quiet-hours controls', async () => {
  const env = load({ compact: true });
  await settled();
  assert.equal(q(env, '[data-isa="repeat"]'), null);
  assert.equal(q(env, '[data-isa="quietEnabled"]'), null);
  assert.equal(q(env, '[data-isa="quietStart"]'), null);
  assert.equal(q(env, '[data-isa="quietEnd"]'), null);
});

test('expanded mode has the repeat switch, the quiet-hours switch and both time inputs', async () => {
  const env = load();
  await settled();
  assert.ok(q(env, '[data-isa="repeat"]'));
  assert.ok(q(env, '[data-isa="quietEnabled"]'));
  assert.ok(q(env, '[data-isa="quietStart"]'));
  assert.ok(q(env, '[data-isa="quietEnd"]'));
});

const isOn = element => element.checked === true || element.getAttribute('aria-checked') === 'true';

test('the repeat switch is off by default', async () => {
  const env = load();
  await settled();
  assert.equal(isOn(q(env, '[data-isa="repeat"]')), false);
});

test('the repeat switch reflects a stored true', async () => {
  const env = load({ store: { isaAlertRepeat: true } });
  await settled();
  assert.equal(isOn(q(env, '[data-isa="repeat"]')), true);
});

test('clicking the repeat switch stores isaAlertRepeat true, and clicking again stores false', async () => {
  const env = load();
  await settled();
  q(env, '[data-isa="repeat"]').click();
  await settled();
  assert.equal(env.store.isaAlertRepeat, true);
  q(env, '[data-isa="repeat"]').click();
  await settled();
  assert.equal(env.store.isaAlertRepeat, false);
});

test('clicking the repeat switch writes only the repeat key', async () => {
  const env = load();
  await settled();
  q(env, '[data-isa="repeat"]').click();
  await settled();
  assert.deepEqual(env.writes.map(w => Object.keys(w)), [['isaAlertRepeat']]);
});

test('the quiet-hours switch is off by default and stores isaAlertQuietEnabled when clicked', async () => {
  const env = load();
  await settled();
  assert.equal(isOn(q(env, '[data-isa="quietEnabled"]')), false);
  q(env, '[data-isa="quietEnabled"]').click();
  await settled();
  assert.equal(env.store.isaAlertQuietEnabled, true);
  assert.equal(isOn(q(env, '[data-isa="quietEnabled"]')), true);
});

test('the quiet-hours switch reflects a stored true', async () => {
  const env = load({ store: { isaAlertQuietEnabled: true } });
  await settled();
  assert.equal(isOn(q(env, '[data-isa="quietEnabled"]')), true);
});

test('the quiet-hours inputs default to 22:00 and 07:00', async () => {
  const env = load();
  await settled();
  assert.equal(q(env, '[data-isa="quietStart"]').value, '22:00');
  assert.equal(q(env, '[data-isa="quietEnd"]').value, '07:00');
});

test('the quiet-hours inputs show the stored times', async () => {
  const env = load({ store: { isaAlertQuietStart: '23:15', isaAlertQuietEnd: '06:30' } });
  await settled();
  assert.equal(q(env, '[data-isa="quietStart"]').value, '23:15');
  assert.equal(q(env, '[data-isa="quietEnd"]').value, '06:30');
});

test('a valid start time is stored and not flagged invalid', async () => {
  const env = load();
  await settled();
  change(env, '[data-isa="quietStart"]', '21:45');
  await settled();
  assert.equal(env.store.isaAlertQuietStart, '21:45');
  assert.notEqual(q(env, '[data-isa="quietStart"]').getAttribute('aria-invalid'), 'true');
});

test('a valid end time is stored', async () => {
  const env = load();
  await settled();
  change(env, '[data-isa="quietEnd"]', '08:05');
  await settled();
  assert.equal(env.store.isaAlertQuietEnd, '08:05');
});

for (const bad of ['9pm', '25:00', '7:5', '12:60', '']) {
  for (const key of ['quietStart', 'quietEnd']) {
    test(`${key} value ${JSON.stringify(bad)} stores nothing, flags the input and asks for 24-hour time`, async () => {
      const env = load();
      await settled();
      change(env, `[data-isa="${key}"]`, bad);
      await settled();
      assert.deepEqual(env.writes, []);
      assert.equal(q(env, `[data-isa="${key}"]`).getAttribute('aria-invalid'), 'true');
      assert.match(status(env), /24-hour/);
    });
  }
}

test('fixing an invalid time clears the flag and the message', async () => {
  const env = load();
  await settled();
  change(env, '[data-isa="quietStart"]', '9pm');
  change(env, '[data-isa="quietStart"]', '21:00');
  await settled();
  assert.notEqual(q(env, '[data-isa="quietStart"]').getAttribute('aria-invalid'), 'true');
  assert.doesNotMatch(status(env), /24-hour/);
  assert.equal(env.store.isaAlertQuietStart, '21:00');
});

test('a repeat change made elsewhere updates the switch', async () => {
  const env = load();
  await settled();
  env.listeners.forEach(fn => fn({ isaAlertRepeat: { newValue: true } }, 'local'));
  assert.equal(isOn(q(env, '[data-isa="repeat"]')), true);
  env.listeners.forEach(fn => fn({ isaAlertRepeat: { newValue: false } }, 'local'));
  assert.equal(isOn(q(env, '[data-isa="repeat"]')), false);
});

test('a change from another storage area is ignored', async () => {
  const env = load();
  await settled();
  env.listeners.forEach(fn => fn({ isaAlertRepeat: { newValue: true } }, 'sync'));
  assert.equal(isOn(q(env, '[data-isa="repeat"]')), false);
});

test('a quiet-hours change made elsewhere updates the switch and the inputs', async () => {
  const env = load();
  await settled();
  env.listeners.forEach(fn => fn({
    isaAlertQuietEnabled: { newValue: true },
    isaAlertQuietStart: { newValue: '20:00' },
    isaAlertQuietEnd: { newValue: '05:30' }
  }, 'local'));
  assert.equal(isOn(q(env, '[data-isa="quietEnabled"]')), true);
  assert.equal(q(env, '[data-isa="quietStart"]').value, '20:00');
  assert.equal(q(env, '[data-isa="quietEnd"]').value, '05:30');
});

test('a failed save of the repeat switch puts it back and shows the error', async () => {
  const env = load({ failSet: true });
  await settled();
  q(env, '[data-isa="repeat"]').click();
  await settled();
  assert.equal(isOn(q(env, '[data-isa="repeat"]')), false);
  assert.equal(status(env), 'Could not save this setting. Try again.');
});

test('a thrown save of the repeat switch puts it back and shows the error', async () => {
  const env = load({ throwSet: true });
  await settled();
  q(env, '[data-isa="repeat"]').click();
  await settled();
  assert.equal(isOn(q(env, '[data-isa="repeat"]')), false);
  assert.equal(status(env), 'Could not save this setting. Try again.');
});

test('a failed save of the repeat switch turned on earlier puts it back on', async () => {
  const env = load({ failSet: true, store: { isaAlertRepeat: true } });
  await settled();
  q(env, '[data-isa="repeat"]').click();
  await settled();
  assert.equal(isOn(q(env, '[data-isa="repeat"]')), true);
});

test('a failed save of the quiet-hours switch puts it back and shows the error', async () => {
  const env = load({ failSet: true });
  await settled();
  q(env, '[data-isa="quietEnabled"]').click();
  await settled();
  assert.equal(isOn(q(env, '[data-isa="quietEnabled"]')), false);
  assert.equal(status(env), 'Could not save this setting. Try again.');
});

test('a failed save of a valid time puts the previous time back and shows the error', async () => {
  const env = load({ failSet: true });
  await settled();
  change(env, '[data-isa="quietStart"]', '21:00');
  await settled();
  assert.equal(q(env, '[data-isa="quietStart"]').value, '22:00');
  assert.equal(status(env), 'Could not save this setting. Try again.');
});

test('without chrome.storage the expanded panel mounts and shows the switches off', async () => {
  let env;
  assert.doesNotThrow(() => { env = load({ noStorage: true }); });
  await settled();
  assert.equal(isOn(q(env, '[data-isa="repeat"]')), false);
});

test('mounting the expanded panel twice does not duplicate the switches or inputs', async () => {
  const env = load();
  await settled();
  env.win.ISA_ALERT_SETTINGS.mountPacing(q(env, '#isa-alert-pacing'));
  await settled();
  ['repeat', 'quietEnabled', 'quietStart', 'quietEnd', 'pacingStatus'].forEach(key => {
    assert.equal(env.doc.querySelectorAll(`[data-isa="${key}"]`).length, 1, key);
  });
});

test('mountPacing mounts a container that was added after load', async () => {
  const env = load({ markup: '' });
  await settled();
  const host = env.doc.createElement('div');
  env.doc.body.appendChild(host);
  env.win.ISA_ALERT_SETTINGS.mountPacing(host);
  await settled();
  assert.ok(host.querySelector('[data-isa-mute="15"]'));
});

test('typing into a quiet-hours box refuses an impossible hour digit and pads a late first digit', async () => {
  const env = load();
  await settled();
  const input = q(env, '[data-isa="quietStart"]');
  const typeInto = value => { input.value = value; input.dispatchEvent(new env.win.Event('input', { bubbles: true })); };
  typeInto('');
  typeInto('2');
  typeInto('25');
  assert.equal(input.value, '2');
  typeInto('');
  typeInto('7');
  assert.equal(input.value, '07:');
  typeInto('07:x');
  assert.equal(input.value, '07:');
});

test('a quiet-hours time with a one-digit hour is stored zero-padded', async () => {
  const env = load();
  await settled();
  change(env, '[data-isa="quietEnd"]', '7:05');
  await settled();
  assert.equal(env.store.isaAlertQuietEnd, '07:05');
  assert.notEqual(q(env, '[data-isa="quietEnd"]').getAttribute('aria-invalid'), 'true');
});
