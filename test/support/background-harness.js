'use strict';

const assert = require('node:assert/strict');

const fs = require('fs');

const path = require('path');

const vm = require('vm');

const { JSDOM } = require('jsdom');

const { unrefWindowTimers } = require('./helpers');

const ROOT = path.join(__dirname, '..', '..', 'src');

function loadBackground(opts = {}) {
  const {
    permissionLevel = 'granted',
    createError = null,
    openTabs = [],
    queryError = null,
    queryThrow = null,
    updateError = null,
    updateThrow = null,
    windowUpdateThrow = null,
    supportsGetAll = true,
    tabMessages = {},
    endpoint = '',
    token = '',
    manifest = { version: '2.0.12.1', name: 'Intercom Support Assistant' },
    storageSeed = null,
    profileEmail = null,
    omitIdentity = false,
    omitFetch = false,
    fullVersionList = null,
    pageUrl = 'https://app.intercom.com/a/inbox/demo1234',
    executeResult = null,
    executeError = null,
    fetchResult = { ok: true, body: '{"ok":true}' },
    storageSessionSeed,
    sessionGetError = null,
    sessionSetError = null,
    shownSeed = []
  } = opts;
  const tabMessageCalls = [];
  const fetchCalls = [];
  const storageState = storageSeed ? JSON.parse(JSON.stringify(storageSeed)) : {};
  const sessionStorageState = storageSessionSeed === undefined
    ? {}
    : JSON.parse(JSON.stringify(storageSessionSeed));
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: pageUrl,
    runScripts: 'outside-only'
  });
  unrefWindowTimers(dom.window);
  Object.defineProperty(dom.window.navigator, 'userAgent', {
    value: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.54 Safari/537.36',
    configurable: true
  });
  if (fullVersionList) {
    Object.defineProperty(dom.window.navigator, 'userAgentData', {
      value: {
        getHighEntropyValues: () => (fullVersionList instanceof Error
          ? Promise.reject(fullVersionList)
          : Promise.resolve({ fullVersionList }))
      },
      configurable: true
    });
  }
  const listeners = { installed: null, removed: null, updated: null, message: null, notificationClicked: null };
  const executeCalls = [];
  const notificationsCreated = [];
  const notificationsCleared = [];
  const tabUpdates = [];
  const tabsCreated = [];
  const shownNotifications = new Set(shownSeed);
  const windowUpdates = [];
  const workspaceMessages = [];
  let uuidCounter = 0;
  const chrome = {
    runtime: {
      sendMessage(message, callback) { workspaceMessages.push(message); if (callback) callback(); },
      getURL: resource => `chrome-extension://test/${resource}`,
      onInstalled: { addListener: listener => { listeners.installed = listener; } },
      onMessage: { addListener: listener => { listeners.message = listener; } },
      getManifest: () => manifest,
      lastError: null
    },
    storage: (storageSeed === null && storageSessionSeed === undefined) ? undefined : {
      ...(storageSeed === null ? {} : { local: {
        get(keys, callback) {
          const out = {};
          (Array.isArray(keys) ? keys : [keys]).forEach((key) => {
            if (key in storageState) out[key] = JSON.parse(JSON.stringify(storageState[key]));
          });
          callback(out);
        },
        set(values, callback) {
          Object.keys(values).forEach((key) => {
            storageState[key] = JSON.parse(JSON.stringify(values[key]));
          });
          if (typeof callback === 'function') callback();
        }
      } }),
      ...(storageSessionSeed === undefined ? {} : { session: {
        get(keys, callback) {
          chrome.runtime.lastError = sessionGetError;
          const out = {};
          (Array.isArray(keys) ? keys : [keys]).forEach((key) => {
            if (key in sessionStorageState) out[key] = JSON.parse(JSON.stringify(sessionStorageState[key]));
          });
          callback(out);
          chrome.runtime.lastError = null;
        },
        set(values, callback) {
          chrome.runtime.lastError = sessionSetError;
          if (!sessionSetError) {
            Object.keys(values).forEach((key) => {
              sessionStorageState[key] = JSON.parse(JSON.stringify(values[key]));
            });
          }
          if (typeof callback === 'function') callback();
          chrome.runtime.lastError = null;
        }
      } })
    },
    identity: omitIdentity ? undefined : {
      getProfileUserInfo(_details, callback) {
        callback({ email: profileEmail || '', id: profileEmail ? 'gaia-1' : '' });
      }
    },
    scripting: {
      executeScript(details, callback) {
        executeCalls.push(details);
        const result = typeof executeResult === 'function'
          ? executeResult(details, executeCalls.length)
          : executeResult || (details.func && details.func.name === 'showStaleBuildNotice'
            ? [{ result: { status: 'rendered', latest: details.args[0], cycle: details.args[1] } }]
            : undefined);
        chrome.runtime.lastError = executeError;
        callback(result);
        chrome.runtime.lastError = null;
      }
    },
    tabs: {
      query(_query, callback) {
        if (queryThrow) throw queryThrow;
        chrome.runtime.lastError = queryError;
        callback(queryError ? undefined : openTabs);
        chrome.runtime.lastError = null;
      },
      get: () => {},
      create(props, callback) {
        tabsCreated.push(props);
        if (typeof callback === 'function') callback({ id: 999 });
      },
      update(tabId, props, callback) {
        tabUpdates.push({ tabId, props });
        if (updateThrow) throw updateThrow;
        if (typeof callback === 'function') {
          chrome.runtime.lastError = updateError;
          callback();
          chrome.runtime.lastError = null;
        }
      },
      onRemoved: { addListener: listener => { listeners.removed = listener; } },
      onUpdated: { addListener: listener => { listeners.updated = listener; } },
      sendMessage(tabId, message, callback) {
        tabMessageCalls.push({ tabId, message });
        const scripted = tabMessages[tabId] || {};
        chrome.runtime.lastError = scripted.error ? { message: scripted.error } : null;
        callback(scripted.report);
        chrome.runtime.lastError = null;
      }
    },
    windows: {
      update(windowId, props) {
        windowUpdates.push({ windowId, props });
        if (windowUpdateThrow) throw windowUpdateThrow;
      }
    },
    notifications: {
      ...(supportsGetAll ? {
        getAll(callback) {
          const snapshot = {};
          shownNotifications.forEach((id) => { snapshot[id] = {}; });
          callback(snapshot);
        }
      } : {}),
      create(id, options, callback) {
        notificationsCreated.push({ id, options, hadCallback: typeof callback === 'function' });
        shownNotifications.add(id);
        if (typeof callback === 'function') {
          const failure = typeof createError === 'function' ? createError(options) : createError;
          chrome.runtime.lastError = failure;
          callback(id);
          chrome.runtime.lastError = null;
        }
      },
      clear(id) { notificationsCleared.push(id); shownNotifications.delete(id); },
      getPermissionLevel(callback) { callback(permissionLevel); },
      onClicked: { addListener: listener => { listeners.notificationClicked = listener; } }
    }
  };
  Object.defineProperty(dom.window.crypto, 'randomUUID', {
    configurable: true,
    value: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`
  });
  dom.window.chrome = chrome;
  if (!omitFetch) {
    dom.window.fetch = (url, init) => {
      fetchCalls.push({ url, init });
      const result = typeof fetchResult === 'function'
        ? fetchResult(fetchCalls.length)
        : fetchResult;
      if (result instanceof Error) return Promise.reject(result);
      return Promise.resolve({
        ok: result.ok,
        text: () => result.textError
          ? Promise.reject(result.textError)
          : Promise.resolve(result.body === undefined ? '' : result.body)
      });
    };
  }
  const ctx = dom.getInternalVMContext();
  const source = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  vm.runInContext(source, ctx, { filename: 'background.js' });
  return {
    win: dom.window,
    chrome,
    listeners,
    executeCalls,
    notificationsCreated,
    notificationsCleared,
    tabUpdates,
    workspaceMessages,
    tabsCreated,
    windowUpdates,
    shownNotifications,
    tabMessageCalls,
    fetchCalls,
    storageState,
    sessionStorageState
  };
}

const INTERCOM_TAB = { id: 4, url: 'https://app.intercom.com/a/inbox', status: 'complete' };

async function settle() {
  for (let i = 0; i < 12; i += 1) await new Promise(resolve => setImmediate(resolve));
}

module.exports = {
  loadBackground,
  INTERCOM_TAB,
  settle,
};
