'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');

function loadWithShadowHost() {
  return loadExtension(
    `<!doctype html><html><body>
      <div id='teammate-app-react'></div>
      <div id='light-only' data-probe='light'></div>
    </body></html>`,
    {
      beforeScripts: (win) => {
        const shadow = win.document.getElementById('teammate-app-react').attachShadow({ mode: 'open' });
        shadow.innerHTML = '<div id=\'shadow-only\' data-probe=\'shadow\'></div>';
      }
    }
  );
}

test('an element that lives only in the light document is still found when the shadow host exists', () => {
  const win = loadWithShadowHost();
  const host = win.document.getElementById('teammate-app-react');

  assert.ok(host.shadowRoot, 'the shadow host is open');
  assert.equal(host.shadowRoot.querySelector('#light-only'), null, 'the element is not in the shadow root');

  const found = win.queryIntercom('#light-only');

  assert.ok(found, 'the light-document element is found');
  assert.equal(found.getAttribute('data-probe'), 'light');
});

test('an element that lives only in the shadow root is found beside a light-only one', () => {
  const win = loadWithShadowHost();

  assert.equal(win.queryIntercom('#shadow-only').getAttribute('data-probe'), 'shadow');
  assert.equal(win.queryIntercom('#light-only').getAttribute('data-probe'), 'light');
});

test('a message of another type gets no response and the handler returns false', () => {
  const win = loadWithShadowHost();
  const responses = [];

  const returned = win.handleDomCaptureMessage({ type: 'some-other-message-type' }, { id: 'x' }, (payload) => responses.push(payload));

  assert.equal(returned, false);
  assert.deepEqual(responses, []);
});

test('a null or undefined message gets no response and the handler returns false', () => {
  const win = loadWithShadowHost();
  const responses = [];
  const sendResponse = (payload) => responses.push(payload);

  assert.equal(win.handleDomCaptureMessage(null, { id: 'x' }, sendResponse), false);
  assert.equal(win.handleDomCaptureMessage(undefined, { id: 'x' }, sendResponse), false);
  assert.deepEqual(responses, []);
});
