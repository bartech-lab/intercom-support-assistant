'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..', 'src');

const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

function isolatedScriptsFor(entryScript) {
  const block = MANIFEST.content_scripts.find(entry => entry.world !== 'MAIN' && entry.js.includes(entryScript));
  if (!block) throw new Error(`manifest.json has no isolated content-script block for ${entryScript}`);
  return block.js.slice();
}

const RUNTIME_SCRIPTS = isolatedScriptsFor('intercom-boot.js');

function unrefWindowTimers(win) {
  const handles = new Map();
  let nextId = 1;
  win.setTimeout = (callback, delayMs = 0, ...args) => {
    const id = nextId++;
    const handle = setTimeout(() => {
      handles.delete(id);
      callback(...args);
    }, delayMs);
    handle.unref();
    handles.set(id, handle);
    return id;
  };
  win.clearTimeout = (id) => {
    clearTimeout(handles.get(id));
    handles.delete(id);
  };
  const close = win.close.bind(win);
  win.close = () => {
    handles.forEach(handle => clearTimeout(handle));
    handles.clear();
    close();
  };
  return win;
}

const scriptSourceCache = new Map();

function loadScriptSource(file) {
  let source = scriptSourceCache.get(file);
  if (!source) {
    source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    scriptSourceCache.set(file, source);
  }
  return source;
}

const INTERCOM_LANGUAGE_SCRIPTS = [
  'shared-runtime.js',
  'intercom-config.js',
  'signature-normalizer.js',
  'intercom-util.js',
  'intercom-language.js',
  'intercom-dom.js',
  'intercom-sidebar.js',
  'intercom-context.js',
  'intercom-bridge.js'
];

function loadDom(html, url, scripts, beforeScripts = null) {
  const dom = new JSDOM(html, {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });

  unrefWindowTimers(dom.window);
  dom.window.alert = () => {};
  dom.window.open = () => null;
  dom.window.setInterval = () => 0;
  const ctx = dom.getInternalVMContext();
  if (beforeScripts) beforeScripts(dom.window);
  for (const file of scripts) {
    vm.runInContext(loadScriptSource(file), ctx, { filename: file });
  }

  return dom.window;
}

function loadExtension(html, { url = 'https://app.intercom.com/a/inbox/team/123/conversation/456', beforeScripts = null, chromeStub = null, scripts = RUNTIME_SCRIPTS } = {}) {
  if (!chromeStub) return loadDom(html, url, scripts, beforeScripts);

  return loadDom(html, url, scripts, (win) => {
    win.chrome = chromeStub;
    if (beforeScripts) beforeScripts(win);
  });
}

function loadPreview(html = '<!doctype html><html><body><div id="status"></div><div id="errorMessage"></div><div id="content"></div></body></html>', { clipboard, hasClipboardItem = false } = {}) {
  const dom = new JSDOM(html, {
    url: 'https://example.test/preview',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const win = unrefWindowTimers(dom.window);

  if (clipboard) {
    Object.defineProperty(win.navigator, 'clipboard', { value: clipboard, configurable: true });
  }
  if (hasClipboardItem) {
    win.ClipboardItem = function ClipboardItem(data) { this.data = data; };
  } else {
    delete win.ClipboardItem;
  }

  const ctx = dom.getInternalVMContext();
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'preview-page.js'), 'utf8'), ctx, { filename: 'preview-page.js' });
  return win;
}

function makeChromeStub() {
  const store = {};
  const sent = [];
  const changedListeners = [];
  const messageListeners = [];
  return {
    __store: store,
    __sent: sent,
    runtime: {
      id: 'test-extension',
      lastError: null,
      getURL: (resourcePath) => `chrome-extension://test-extension/${resourcePath}`,
      getManifest: () => ({ version: 'test' }),
      sendMessage(message, callback) {
        sent.push(message);
        if (typeof callback === 'function') callback({ ok: true });
      },
      onMessage: {
        addListener(listener) { messageListeners.push(listener); },
        __count() { return messageListeners.length; },
        __emit(message, sender = { id: 'test-extension' }) {
          const responses = [];
          const returned = messageListeners.map(fn =>
            fn(message, sender, (payload) => { responses.push(payload); }));
          return { responses, returned };
        }
      }
    },
    storage: {
      onChanged: {
        addListener(listener) { changedListeners.push(listener); },
        __emit(changes, areaName = 'local') { changedListeners.forEach(fn => fn(changes, areaName)); }
      },
      local: {
        get(keys, callback) {
          const result = {};
          if (keys && typeof keys === 'object' && !Array.isArray(keys)) {
            Object.entries(keys).forEach(([key, fallback]) => {
              result[key] = key in store ? structuredClone(store[key]) : structuredClone(fallback);
            });
          } else {
            (Array.isArray(keys) ? keys : [keys]).forEach(key => {
              if (key in store) result[key] = structuredClone(store[key]);
            });
          }
          callback(result);
        },
        set(items, callback) {
          const changes = {};
          Object.entries(items).forEach(([key, value]) => {
            changes[key] = { oldValue: structuredClone(store[key]), newValue: structuredClone(value) };
          });
          Object.assign(store, structuredClone(items));
          changedListeners.forEach(fn => fn(changes, 'local'));
          if (typeof callback === 'function') callback();
        }
      }
    }
  };
}

function makeJsonResponse(bodyText) {
  return {
    ok: true,
    headers: { get: name => (name.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null) },
    clone() { return this; },
    text: async () => bodyText
  };
}

function loadIntercomPageHook({
  url = 'https://app.intercom.com/a/inbox/demo1234/inbox/team/1/conversation/900401386132981',
  fetchImpl,
  beforeScripts = null
} = {}) {
  const dom = new JSDOM('<body></body>', { url, runScripts: 'outside-only' });
  const win = unrefWindowTimers(dom.window);
  const posted = [];
  const nativePostMessage = win.postMessage.bind(win);
  win.postMessage = (message, targetOrigin) => {
    posted.push(message);
    nativePostMessage(message, targetOrigin);
  };
  if (fetchImpl) win.fetch = fetchImpl;
  if (beforeScripts) beforeScripts(win);

  const ctx = dom.getInternalVMContext();
  const source = fs.readFileSync(path.join(ROOT, 'intercom-page-hook.js'), 'utf8');
  const evaluateHook = () => vm.runInContext(source, ctx, { filename: 'intercom-page-hook.js' });
  evaluateHook();

  const sendReady = () => win.dispatchEvent(new win.MessageEvent('message', {
    data: { __isaic_ready: true },
    source: win,
    origin: new URL(url).origin
  }));

  return { window: win, posted, sendReady, evaluateHook };
}

function makeIntercomResponse(bodyText, {
  status = 200,
  url = '',
  contentType = 'application/json; charset=utf-8',
  contentLength = null,
  cloneThrows = false,
  cloneBodyRejects = false
} = {}) {
  const headers = {
    get(name) {
      const key = String(name).toLowerCase();
      if (key === 'content-type') return contentType;
      if (key === 'content-length') return contentLength;
      return null;
    }
  };
  return {
    status,
    ok: status >= 200 && status < 300,
    url,
    headers,
    clone() {
      if (cloneThrows) throw new Error('clone unavailable');
      return {
        status,
        url,
        headers,
        text: async () => {
          if (cloneBodyRejects) throw new Error('body unreadable');
          return bodyText;
        }
      };
    },
    text: async () => bodyText
  };
}

function hydrateShadowRoots(root) {
  const templates = [...root.querySelectorAll('template[shadowrootmode]')];
  templates.forEach((template) => {
    const host = template.parentElement;
    if (!host || host.shadowRoot) return;
    const shadow = host.attachShadow({ mode: template.getAttribute('shadowrootmode') });
    shadow.appendChild(template.content);
    template.remove();
    hydrateShadowRoots(shadow);
  });
  return root;
}

const CAPTURE_META_ID = 'isa-capture-meta';

function readCapture(filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  const dom = new JSDOM(html);
  const metaElement = dom.window.document.getElementById(CAPTURE_META_ID);
  const meta = metaElement ? JSON.parse(metaElement.textContent) : null;
  dom.window.close();
  return { html, meta };
}

function loadCapture(filePath, options = {}) {
  const { html, meta } = readCapture(filePath);
  const url = options.url || (meta && meta.url) || 'https://app.intercom.com/a/inbox/team/123/conversation/456';
  const window = loadExtension(html, {
    ...options,
    url,
    beforeScripts: (win) => {
      const metaNode = win.document.getElementById(CAPTURE_META_ID);
      if (metaNode) metaNode.remove();
      hydrateShadowRoots(win.document);
      if (options.beforeScripts) options.beforeScripts(win);
    }
  });
  return { window, meta };
}

module.exports = {
  INTERCOM_LANGUAGE_SCRIPTS,
  unrefWindowTimers,
  loadExtension,
  loadPreview,
  hydrateShadowRoots,
  readCapture,
  loadCapture,
  loadIntercomPageHook,
  makeChromeStub,
  makeJsonResponse,
  makeIntercomResponse
};
