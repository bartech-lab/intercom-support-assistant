'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { loadExtension, loadCapture, hydrateShadowRoots, makeChromeStub } = require('../support/helpers');

function shadowPageHtml() {
  return `<!doctype html><html><head><title>Intercom</title></head><body>
    <div id="teammate-app-react"></div>
  </body></html>`;
}

function withShadowApp(win, inner) {
  const host = win.document.getElementById('teammate-app-react');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = inner;
  return shadow;
}

function captureFrom(win) {
  return win.ISA_DOM_CAPTURE.buildCapture({ surface: 'intercom', view: 'conversation' });
}

test('capture serializes shadow content that outerHTML alone would drop', () => {
  const win = loadExtension(shadowPageHtml());
  withShadowApp(win, '<div data-intercom-target="conversation-space">hello</div>');

  assert.equal(
    win.document.documentElement.outerHTML.includes('conversation-space'),
    false,
    'plain outerHTML must not contain shadow content, otherwise this test proves nothing'
  );

  const capture = captureFrom(win);
  assert.equal(capture.ok, true);
  assert.match(capture.html, /template shadowrootmode="open"/);
  assert.match(capture.html, /data-intercom-target="conversation-space"/);
});

test('hydrateShadowRoots restores a nested shadow tree', () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="outer"><template shadowrootmode="open">
      <div id="inner"><template shadowrootmode="open"><span id="leaf">deep</span></template></div>
    </template></div>
  </body></html>`);

  hydrateShadowRoots(dom.window.document);

  const outer = dom.window.document.getElementById('outer');
  assert.ok(outer.shadowRoot, 'outer shadow root attached');
  const inner = outer.shadowRoot.getElementById('inner');
  assert.ok(inner.shadowRoot, 'nested shadow root attached');
  assert.equal(inner.shadowRoot.getElementById('leaf').textContent, 'deep');
});

test('capture round-trips through hydration back into a working extension', () => {
  const win = loadExtension(shadowPageHtml());
  withShadowApp(win, '<div data-intercom-target="conversation-space">hello</div>');
  const capture = captureFrom(win);

  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'isa-capture-')), capture.filename);
  fs.writeFileSync(file, capture.html);

  const { window: replayed, meta } = loadCapture(file);
  assert.equal(meta.surface, 'intercom');
  assert.ok(replayed.document.getElementById('teammate-app-react').shadowRoot, 'shadow root rebuilt');
  assert.ok(
    replayed.queryIntercom('[data-intercom-target="conversation-space"]'),
    'the extension resolves a shadow-only selector on the replayed capture'
  );

  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

test('capture strips extension-injected nodes and attributes but keeps live classes', () => {
  const win = loadExtension(shadowPageHtml());
  withShadowApp(win, `
    <div class="flex flex-row items-center w-3/5 isa-brand-chip" data-isa-language="french" data-testid="keep-me">live</div>
    <span data-isa-own="">injected</span>
  `);

  const capture = captureFrom(win);
  const tree = capture.html.slice(capture.html.indexOf('</script>'));
  assert.equal(tree.includes('injected'), false, 'own nodes removed');
  assert.equal(tree.includes('data-isa-own'), false, 'own nodes removed');
  assert.equal(capture.html.includes('data-isa-language'), false, 'own attributes removed');
  assert.equal(tree.includes('isa-brand-chip'), false, 'own classes removed');
  assert.match(capture.html, /class="flex flex-row items-center w-3\/5"/);
  assert.match(capture.html, /data-testid="keep-me"/);
});

test('the capture inventories our own elements the host tree no longer shows', () => {
  const win = loadExtension(shadowPageHtml());
  withShadowApp(win, '<span data-isa-own="" class="isa-brand-chip">injected</span>');
  const orphan = win.document.createElement('div');
  orphan.setAttribute('data-isa-own', '');
  orphan.className = 'isa-temporary-note-menu';
  orphan.textContent = 'Auto-delete after';
  win.document.body.append(orphan);

  const capture = captureFrom(win);
  const inventory = capture.meta.ownElements;

  assert.ok(Array.isArray(inventory));
  const chip = inventory.find(entry => entry.text === 'injected');
  assert.ok(chip, 'an element inside the shadow root is inventoried');
  assert.equal(chip.className, 'isa-brand-chip');

  const layer = inventory.find(entry => entry.className === 'isa-temporary-note-menu');
  assert.ok(layer, 'a body-level overlay is inventoried');
  assert.equal(layer.parent, 'body');
  assert.ok(layer.rect, 'the overlay carries its position');
});

test('capture metadata header carries the conversation and parses as JSON', () => {
  const win = loadExtension(shadowPageHtml(), {
    url: 'https://app.intercom.com/a/inbox/team/123/conversation/900706735484323'
  });
  const capture = win.ISA_DOM_CAPTURE.buildCapture({
    surface: 'intercom',
    conversationId: '900706735484323',
    view: 'conversation',
    shadowRootPresent: true
  });

  const dom = new JSDOM(capture.html);
  const meta = JSON.parse(dom.window.document.getElementById('isa-capture-meta').textContent);
  assert.equal(meta.conversationId, '900706735484323');
  assert.equal(meta.surface, 'intercom');
  assert.equal(meta.shadowRootPresent, true);
  assert.match(capture.filename, /^intercom-\d{8}T\d{6}-900706735484323\.html$/);
});

test('the content script answers a capture message', () => {
  const chrome = makeChromeStub();
  const win = loadExtension(shadowPageHtml(), { chromeStub: chrome });
  withShadowApp(win, '<div data-intercom-target="conversation-space">hello</div>');

  const { responses } = chrome.runtime.onMessage.__emit({ type: 'isa-dom-capture' });
  const capture = responses.find(entry => entry && entry.html);
  assert.ok(capture, 'a capture payload was returned');
  assert.equal(capture.ok, true);
  assert.match(capture.html, /data-intercom-target="conversation-space"/);
});

test('the content script answers a support ping without serializing the page', () => {
  const chrome = makeChromeStub();
  const win = loadExtension(shadowPageHtml(), { chromeStub: chrome });

  const { responses } = chrome.runtime.onMessage.__emit({ type: 'isa-support-ping' });
  const ping = responses.find(entry => entry && entry.captureVersion);
  assert.ok(ping, 'a ping payload was returned');
  assert.equal(ping.ok, true);
  assert.equal(ping.captureVersion, win.ISA_DOM_CAPTURE.version);
  assert.equal(ping.extensionVersion, 'test');
  assert.equal(Object.prototype.hasOwnProperty.call(ping, 'html'), false, 'a ping must not carry page html');
});

test('an unrelated message leaves the ping responder silent', () => {
  const chrome = makeChromeStub();
  loadExtension(shadowPageHtml(), { chromeStub: chrome });

  const { responses } = chrome.runtime.onMessage.__emit({ type: 'isa-not-a-real-message' });
  assert.equal(responses.filter(entry => entry && entry.captureVersion).length, 0);
});

test('a script tag in the page cannot break out of the metadata header', () => {
  const win = loadExtension(shadowPageHtml(), {
    url: 'https://app.intercom.com/a/inbox/team/1/conversation/2'
  });
  const capture = win.ISA_DOM_CAPTURE.buildCapture({
    surface: 'intercom',
    view: '</script><img src=x>'
  });

  const dom = new JSDOM(capture.html);
  const meta = JSON.parse(dom.window.document.getElementById('isa-capture-meta').textContent);
  assert.equal(meta.view, '</script><img src=x>');
  assert.equal(dom.window.document.querySelector('img'), null, 'no element escaped the header');
});

test('isaDebug turns debugLog on at runtime without an extension reload', () => {
  const chrome = makeChromeStub();
  const logged = [];
  const win = loadExtension(shadowPageHtml(), {
    chromeStub: chrome,
    beforeScripts: (w) => { w.console = { ...console, log: (...args) => logged.push(args) }; }
  });

  win.debugLog('quiet');
  assert.equal(logged.length, 0, 'debug logging is off by default');

  chrome.storage.onChanged.__emit({ isaDebug: { newValue: true } });
  win.debugLog('loud');
  assert.deepEqual(logged, [['loud']]);

  chrome.storage.onChanged.__emit({ isaDebug: { newValue: false } });
  win.debugLog('quiet again');
  assert.equal(logged.length, 1, 'turning it back off stops the logging');
});

test('isaDebug stored before load is picked up at boot', () => {
  const chrome = makeChromeStub();
  chrome.storage.local.set({ isaDebug: true }, () => {});
  const logged = [];
  const win = loadExtension(shadowPageHtml(), {
    chromeStub: chrome,
    beforeScripts: (w) => { w.console = { ...console, log: (...args) => logged.push(args) }; }
  });

  win.debugLog('from boot');
  assert.deepEqual(logged, [['from boot']]);
});

test('a capture keeps the doctype, comments and template content, and drops an emptied class attribute', () => {
  const win = loadExtension(shadowPageHtml());
  const body = win.document.body;
  body.insertAdjacentHTML('beforeend',
    '<!-- host marker --><template id="tpl"><p>inside template</p></template><div id="only-ours" class="isa-chip"></div>');

  const html = captureFrom(win).html;
  assert.ok(html.startsWith('<!doctype html>\n'));
  assert.match(html, /<!-- host marker -->/);
  assert.match(html, /<template id="tpl"><p>inside template<\/p><\/template>/);
  assert.match(html, /<div id="only-ours"><\/div>/);
});

test('the own-element inventory is capped in count and text length', () => {
  const win = loadExtension(shadowPageHtml());
  const long = 'x'.repeat(500);
  for (let i = 0; i < 205; i++) {
    const element = win.document.createElement('span');
    element.setAttribute('data-isa-own', '');
    element.textContent = long;
    win.document.body.appendChild(element);
  }

  const inventory = captureFrom(win).meta.ownElements;
  assert.equal(inventory.length, 200);
  assert.equal(inventory[0].text.length, 160);
});

test('capture metadata defaults the surface and stores the shadow flag as a boolean', () => {
  const win = loadExtension(shadowPageHtml());
  const meta = win.ISA_DOM_CAPTURE.buildCapture({ shadowRootPresent: 1 }).meta;
  assert.equal(meta.surface, 'unknown');
  assert.equal(meta.shadowRootPresent, true);
});
