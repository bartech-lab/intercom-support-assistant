let reloadNoticeUntil = 0;
const pendingReloadNoticeTabIds = new Set();

const alertNotificationTargets = new Map();
const NOTIFICATION_ICON_URL = chrome.runtime.getURL('icons/icon128.png');

const NOTIFICATION_ID_SUFFIX = /^\d+(?:-t(\d+)-w(\d+)?)?$/;

function supersedesNotification(candidateId, idPrefix) {
  if (!candidateId.startsWith(`${idPrefix}-`)) return false;
  return NOTIFICATION_ID_SUFFIX.test(candidateId.slice(idPrefix.length + 1));
}

function notificationTargetFromId(notificationId) {
  const match = /-t(\d+)-w(\d+)?$/.exec(notificationId);
  if (!match) return null;
  return { tabId: Number(match[1]), windowId: match[2] === undefined ? null : Number(match[2]) };
}

function clearSupersededNotifications(idPrefix, keepId, done) {
  if (typeof chrome.notifications.getAll !== 'function') {
    done();
    return;
  }

  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    done();
  };

  try {
    chrome.notifications.getAll((shown) => {
      Object.keys(shown || {}).forEach((id) => {
        if (id === keepId) return;
        if (!supersedesNotification(id, idPrefix)) return;
        try { chrome.notifications.clear(id); } catch (error) {}
        alertNotificationTargets.delete(id);
      });
      finish();
    });
  } catch (error) {
    finish();
  }
}

function showAlertNotification({ idPrefix, title, body }, sender) {
  if (!chrome.notifications || typeof chrome.notifications.create !== 'function') return;

  const tab = sender && sender.tab && Number.isInteger(sender.tab.id) ? sender.tab : null;
  const windowPart = tab && Number.isInteger(tab.windowId) ? tab.windowId : '';
  const notificationId = tab
    ? `${idPrefix}-${Date.now()}-t${tab.id}-w${windowPart}`
    : `${idPrefix}-${Date.now()}`;

  if (tab) {
    alertNotificationTargets.set(notificationId, {
      tabId: tab.id,
      windowId: tab.windowId
    });
  }

  clearSupersededNotifications(idPrefix, notificationId, () => {
    createNotificationWithIconFallback(notificationId, {
      type: 'basic',
      iconUrl: NOTIFICATION_ICON_URL,
      title,
      message: body,
      priority: 2
    });
  });
}

function createNotificationWithIconFallback(notificationId, options, retryWithoutIcon = true) {
  const create = (currentOptions, retry) => {
    try {
      chrome.notifications.create(notificationId, currentOptions, () => {
        const failure = chrome.runtime && chrome.runtime.lastError;
        if (failure && retry) {
          const withoutIcon = Object.assign({}, currentOptions);
          delete withoutIcon.iconUrl;
          create(withoutIcon, false);
          return;
        }
      });
    } catch (error) {}
  };
  create(options, retryWithoutIcon);
}

function showInboxAlertNotification(message, sender) {
  const teamId = message && message.teamId ? String(message.teamId) : 'unknown';
  const label = (message && message.label) || 'Urgent inbox';
  const count = message && Number.isFinite(message.count) ? message.count : 0;
  showAlertNotification({
    idPrefix: `isa-inbox-${teamId}`,
    title: `New in ${label}`,
    body: `${count} conversation${count === 1 ? '' : 's'} waiting`
  }, sender);
}

function runAlertSelfTest(sendResponse) {
  const respond = (payload) => { try { sendResponse(payload); } catch (error) {} };
  if (!chrome.notifications || typeof chrome.notifications.create !== 'function') {
    respond({ ok: false, level: 'unavailable' });
    return;
  }
  const createTest = (level) => {
    chrome.notifications.create(`isa-test-${Date.now()}`, {
      type: 'basic',
      iconUrl: NOTIFICATION_ICON_URL,
      title: 'Test alert',
      message: 'If you can see this, desktop notifications are working.',
      priority: 2
    }, () => {
      const err = chrome.runtime && chrome.runtime.lastError;
      respond({ ok: !err, level, error: err ? err.message : null });
    });
  };
  if (typeof chrome.notifications.getPermissionLevel === 'function') {
    chrome.notifications.getPermissionLevel((level) => createTest(level));
  } else {
    createTest('unknown');
  }
}

const SUPPORTED_URL_PATTERNS = [
  'https://app.intercom.com/*'
];
const RELOAD_NOTICE_WINDOW_MS = 30000;

function getReloadNoticePlatform(url) {
  if (typeof url !== 'string') return null;
  if (url.startsWith('https://app.intercom.com/')) return 'Intercom';
  return null;
}

function findOpenPreviewTab(tabs, previewUrl) {
  if (!Array.isArray(tabs)) return null;
  return tabs.find(tab => tab
    && tab.id !== undefined
    && typeof tab.url === 'string'
    && tab.url.split('#')[0] === previewUrl) || null;
}

const PREVIEW_SECTIONS = new Set(['signatures', 'settings', 'tools']);

function normalizePreviewSection(section) {
  return PREVIEW_SECTIONS.has(section) ? section : 'signatures';
}

function previewSectionFromUrl(url) {
  if (typeof url !== 'string') return 'signatures';
  return normalizePreviewSection(url.split('#')[1] || 'signatures');
}

function previewUrlForSection(previewUrl, section) {
  return section === 'signatures' ? previewUrl : `${previewUrl}#${section}`;
}

function createPreviewTab(url) {
  try { chrome.tabs.create({ url }); } catch (error) {}
}

function focusPreviewWindow(windowId) {
  if (windowId === undefined) return;
  try { chrome.windows.update(windowId, { focused: true }); } catch (error) {}
}

function openPreviewTab(section) {
  const previewUrl = chrome.runtime.getURL('preview-page.html');
  const requestedSection = normalizePreviewSection(section);
  const requestedUrl = previewUrlForSection(previewUrl, requestedSection);
  const requestedRouteUrl = `${previewUrl}#${requestedSection}`;

  const handleQuery = (tabs) => {
    const existing = chrome.runtime.lastError ? null : findOpenPreviewTab(tabs, previewUrl);
    if (!existing) {
      createPreviewTab(requestedUrl);
      return;
    }

    const update = { active: true };
    if (previewSectionFromUrl(existing.url) !== requestedSection) {
      update.url = requestedRouteUrl;
    }

    let callbackCalled = false;
    try {
      chrome.tabs.update(existing.id, update, () => {
        callbackCalled = true;
        if (chrome.runtime.lastError) {
          createPreviewTab(requestedUrl);
          return;
        }
        focusPreviewWindow(existing.windowId);
        try {
          chrome.runtime.sendMessage({ type: 'workspace-open', tabId: existing.id, section: requestedSection }, () => {
            void chrome.runtime.lastError;
          });
        } catch (error) {}
      });
    } catch (error) {
      if (!callbackCalled) {
        createPreviewTab(requestedUrl);
      }
    }
  };

  let callbackCalled = false;
  try {
    chrome.tabs.query({}, (tabs) => {
      callbackCalled = true;
      handleQuery(tabs);
    });
  } catch (error) {
    if (!callbackCalled) createPreviewTab(requestedUrl);
  }
}

function showReloadNotice(platform = 'Intercom') {
  const noticeId = 'isa-signature-reload-notice';
  const blockerAttribute = 'data-isa-signature-reload-blocked';

  if (document.getElementById(noticeId)) return;

  const notice = document.createElement('div');
  notice.id = noticeId;
  notice.setAttribute('data-isa-own', '');
  notice.setAttribute('role', 'alert');
  notice.style.position = 'fixed';
  notice.style.top = '16px';
  notice.style.left = '50%';
  notice.style.transform = 'translateX(-50%)';
  notice.style.zIndex = '2147483647';
  notice.style.width = 'min(640px, calc(100vw - 32px))';
  notice.style.boxSizing = 'border-box';
  notice.style.padding = '14px 18px';
  notice.style.border = '2px solid #2563eb';
  notice.style.borderRadius = '8px';
  notice.style.background = '#ffffff';
  notice.style.color = '#111827';
  notice.style.boxShadow = '0 16px 40px rgba(15, 23, 42, 0.22)';
  notice.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  notice.style.fontSize = '14px';
  notice.style.lineHeight = '1.45';
  notice.style.textAlign = 'left';
  notice.style.pointerEvents = 'auto';

  const title = document.createElement('strong');
  title.textContent = `Reload ${platform} to finish the Intercom Support Assistant update.`;
  title.style.display = 'block';
  title.style.fontSize = '15px';

  const shortcuts = document.createElement('div');
  shortcuts.textContent = 'Windows: Ctrl + Shift + R | Mac: Command + Shift + R';
  shortcuts.style.marginTop = '6px';
  shortcuts.style.fontWeight = '600';

  notice.append(title, shortcuts);
  document.documentElement.appendChild(notice);

  const isBlockedTarget = (target) => {
    if (!target || target.nodeType !== Node.ELEMENT_NODE) return false;
    if (target.closest(`#${noticeId}`)) return false;

    return Boolean(target.closest([
      '[contenteditable="true"]',
      'textarea',
      '[data-testid="composer"]',
      '[data-testid="composer-header"]',
      '[data-testid="send-button"]',
      '[data-intercom-target="send-button"]',
      '[data-intercom-target="note-send-button"]',
      '.ProseMirror',
      '.embercom-prosemirror-composer-editor'
    ].join(',')));
  };

  const blockComposerUse = (event) => {
    const path = event.composedPath ? event.composedPath() : [event.target];
    if (!path.some(isBlockedTarget)) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
  };

  [
    'click',
    'pointerdown',
    'mousedown',
    'mouseup',
    'auxclick',
    'beforeinput',
    'input',
    'paste',
    'keydown'
  ].forEach((eventName) => {
    document.addEventListener(eventName, blockComposerUse, true);
  });

  document.documentElement.setAttribute(blockerAttribute, 'true');
}

function injectReloadNotice(tabId, platform, retry = true) {
  chrome.scripting.executeScript(
    {
      target: { tabId },
      func: showReloadNotice,
      args: [platform]
    },
    () => {
      if (!chrome.runtime.lastError) {
        pendingReloadNoticeTabIds.delete(tabId);
        return;
      }

      if (retry) {
        setTimeout(() => injectReloadNotice(tabId, platform, false), 1000);
      }
    }
  );
}

function injectReloadNoticeIntoOpenSupportedTabs() {
  chrome.tabs.query({ url: SUPPORTED_URL_PATTERNS }, (tabs) => {
    if (chrome.runtime.lastError) return;

    tabs.forEach((tab) => {
      if (typeof tab.id === 'number') {
        const platform = getReloadNoticePlatform(tab.url);
        if (!platform) return;
        if (tab.status === 'complete') {
          injectReloadNotice(tab.id, platform);
        } else {
          pendingReloadNoticeTabIds.add(tab.id);
        }
      }
    });
  });
}

const ANCHOR_HEALTH_URL_PATTERNS = ['https://app.intercom.com/*'];
const ANCHOR_HEALTH_NOT_INJECTED = /could not establish connection|receiving end does not exist/i;
const DOM_CAPTURE_URL_PATTERNS = ['https://app.intercom.com/*'];
const DOM_CAPTURE_TIMEOUT_MS = 15000;

function collectCaptureTabs(sendResponse) {
  chrome.tabs.query({ url: DOM_CAPTURE_URL_PATTERNS }, (tabs) => {
    const queryError = chrome.runtime.lastError;
    if (queryError) {
      sendResponse({ ok: false, reason: 'query-failed', error: queryError.message });
      return;
    }

    const found = Array.isArray(tabs) ? tabs : [];
    sendResponse({
      ok: true,
      tabs: found.map(tab => ({
        tabId: tab.id,
        title: tab.title,
        url: tab.url,
        active: Boolean(tab.active)
      }))
    });
  });
}

function captureDomFromTab(tabId, sendResponse) {
  let responded = false;
  const respond = (payload) => {
    if (responded) return;
    responded = true;
    sendResponse(payload);
  };

  if (typeof tabId !== 'number') {
    respond({ ok: false, reason: 'no-tab-id' });
    return;
  }

  setTimeout(() => respond({ ok: false, reason: 'timeout' }), DOM_CAPTURE_TIMEOUT_MS);

  chrome.tabs.sendMessage(tabId, { type: 'isa-dom-capture' }, (capture) => {
    const sendError = chrome.runtime.lastError;
    if (sendError) {
      respond({
        ok: false,
        reason: 'unreachable',
        error: sendError.message,
        notInjected: ANCHOR_HEALTH_NOT_INJECTED.test(sendError.message || '')
      });
      return;
    }
    respond(capture && capture.ok ? capture : { ok: false, reason: 'capture-failed', capture });
  });
}

const SUPPORT_PING_MESSAGE = 'isa-support-ping';
const SUPPORT_HEALTH_TIMEOUT_MS = 4000;

function supportHealthNotificationLevel() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (level) => {
      if (settled) return;
      settled = true;
      resolve(level);
    };

    try {
      if (!chrome.notifications || typeof chrome.notifications.getPermissionLevel !== 'function') {
        finish('unavailable');
        return;
      }
      setTimeout(() => finish('unknown'), SUPPORT_HEALTH_TIMEOUT_MS);
      chrome.notifications.getPermissionLevel((level) => finish(level || 'unknown'));
    } catch (error) {
      finish('unavailable');
    }
  });
}

function supportHealthQueryTabs() {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query({ url: DOM_CAPTURE_URL_PATTERNS }, (tabs) => {
        const queryError = chrome.runtime.lastError;
        if (queryError) {
          resolve({ error: queryError.message, tabs: [] });
          return;
        }
        resolve({ error: null, tabs: Array.isArray(tabs) ? tabs : [] });
      });
    } catch (error) {
      resolve({ error: String(error && error.message), tabs: [] });
    }
  });
}

function supportHealthPingTab(tab) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (extra) => {
      if (settled) return;
      settled = true;
      resolve(Object.assign({
        tabId: tab.id,
        title: tab.title || null,
        url: tab.url || null,
        active: Boolean(tab.active)
      }, extra));
    };

    setTimeout(() => finish({ injected: false, error: 'timeout' }), SUPPORT_HEALTH_TIMEOUT_MS);

    try {
      chrome.tabs.sendMessage(tab.id, { type: SUPPORT_PING_MESSAGE }, (reply) => {
        const sendError = chrome.runtime.lastError;
        if (sendError) {
          finish({
            injected: false,
            error: sendError.message,
            notInjected: ANCHOR_HEALTH_NOT_INJECTED.test(sendError.message || '')
          });
          return;
        }
        if (reply && reply.ok) {
          finish({
            injected: true,
            captureVersion: reply.captureVersion == null ? null : reply.captureVersion,
            extensionVersion: reply.extensionVersion == null ? null : reply.extensionVersion
          });
          return;
        }
        finish({ injected: false, error: 'no-reply' });
      });
    } catch (error) {
      finish({ injected: false, error: String(error && error.message) });
    }
  });
}

async function collectSupportHealth(sendResponse) {
  try {
    const manifest = extensionManifest();
    const [notifications, queried, chromeVersion] = await Promise.all([
      supportHealthNotificationLevel(),
      supportHealthQueryTabs(),
      highEntropyChromeVersion()
    ]);
    const tabs = await Promise.all(queried.tabs.map(supportHealthPingTab));

    sendResponse({
      ok: true,
      health: {
        checkedAt: new Date().toISOString(),
        extension: {
          name: manifest.name || null,
          version: manifest.version || null
        },
        browser: {
          chromeVersion: chromeVersion || userAgentChromeVersion() || null,
          userAgent: typeof navigator === 'undefined' ? null : String(navigator.userAgent)
        },
        notificationLevel: notifications,
        tabsError: queried.error,
        tabs
      }
    });
  } catch (error) {
    sendResponse({ ok: false, reason: 'health-failed', error: String(error && error.message) });
  }
}

function extensionManifest() {
  try {
    if (typeof chrome.runtime.getManifest === 'function') return chrome.runtime.getManifest() || {};
  } catch (error) {}
  return {};
}

function userAgentChromeVersion() {
  try {
    const match = String(navigator.userAgent).match(/Chrome\/([\d.]+)/);
    return match ? match[1] : '';
  } catch (error) {
    return '';
  }
}

const BROWSER_PRODUCTS = [
  ['Google Chrome', 'Chrome'],
  ['Brave', 'Brave'],
  ['Chromium', 'Chromium']
];

function highEntropyChromeVersion() {
  return new Promise((resolve) => {
    try {
      const agent = navigator.userAgentData;
      if (!agent || typeof agent.getHighEntropyValues !== 'function') {
        resolve('');
        return;
      }
      agent.getHighEntropyValues(['fullVersionList']).then((info) => {
        const brands = (info && info.fullVersionList) || [];
        for (const [name, label] of BROWSER_PRODUCTS) {
          const match = brands.find(brand => brand
            && brand.brand === name
            && brand.version);
          if (match) {
            resolve(`${label} ${match.version}`);
            return;
          }
        }
        resolve('');
      }).catch(() => resolve(''));
    } catch (error) {
      resolve('');
    }
  });
}

const NOTE_LEASE_ACQUIRE_MESSAGE = 'isa-note-lease-acquire';
const NOTE_LEASE_RELEASE_MESSAGE = 'isa-note-lease-release';
const NOTE_LEASE_STORAGE_KEY = 'isaNoteLeases';
const NOTE_LEASE_TTL_MS = 60000;
const NOTE_LEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const NOTE_LEASE_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NOTE_LEASE_PATH_PREFIXES = new Set(['inbox', 'apps']);
let noteLeaseQueue = Promise.resolve();

function noteLeaseStorage() {
  try {
    if (chrome.storage && chrome.storage.session
      && typeof chrome.storage.session.get === 'function'
      && typeof chrome.storage.session.set === 'function') {
      return chrome.storage.session;
    }
  } catch (error) {}
  return null;
}

function noteLeaseStorageGet(storage) {
  return new Promise((resolve, reject) => {
    try {
      storage.get(NOTE_LEASE_STORAGE_KEY, (result) => {
        const error = chrome.runtime && chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message || 'storage-get-failed'));
          return;
        }
        const leases = result && result[NOTE_LEASE_STORAGE_KEY];
        if (leases === undefined) {
          resolve({});
          return;
        }
        if (!leases || typeof leases !== 'object' || Array.isArray(leases)) {
          reject(new Error('storage-invalid'));
          return;
        }
        resolve(leases);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function noteLeaseStorageSet(storage, leases) {
  return new Promise((resolve, reject) => {
    try {
      storage.set({ [NOTE_LEASE_STORAGE_KEY]: leases }, () => {
        const error = chrome.runtime && chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message || 'storage-set-failed'));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

function noteLeaseId(value) {
  return typeof value === 'string' && NOTE_LEASE_ID_PATTERN.test(value);
}

function noteLeaseKey(workspaceId, contactId, noteId) {
  return `${workspaceId}/${contactId}/${noteId}`;
}

function noteLeaseSenderIsAuthenticated(sender, workspaceId) {
  if (!sender || !sender.tab || !Number.isInteger(sender.tab.id) || sender.tab.id < 0) return false;
  if (typeof sender.tab.url !== 'string') return false;

  let url;
  try {
    url = new URL(sender.tab.url);
  } catch (error) {
    return false;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'app.intercom.com') return false;
  if (sender.origin !== 'https://app.intercom.com') return false;

  const path = url.pathname.split('/').filter(Boolean);
  return path.length >= 3
    && path[0] === 'a'
    && NOTE_LEASE_PATH_PREFIXES.has(path[1])
    && path[2] === workspaceId;
}

function noteLeaseRandomUUID() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      const token = crypto.randomUUID();
      return NOTE_LEASE_TOKEN_PATTERN.test(token) ? token : null;
    }
  } catch (error) {}
  return null;
}

function noteLeaseRequest(message, sender) {
  if (!message || !noteLeaseId(message.workspaceId)
    || !noteLeaseId(message.contactId) || !noteLeaseId(message.noteId)) {
    return { ok: false, reason: 'invalid-request' };
  }
  if (!noteLeaseSenderIsAuthenticated(sender, message.workspaceId)) {
    return { ok: false, reason: 'invalid-sender' };
  }
  return null;
}

function queueNoteLeaseOperation(operation) {
  const queued = noteLeaseQueue.then(operation, operation);
  noteLeaseQueue = queued.catch(() => {});
  return queued;
}

function noteLeaseExpiredEntries(leases, now) {
  let changed = false;
  const current = {};
  Object.keys(leases).forEach((key) => {
    const lease = leases[key];
    if (!lease || !Number.isFinite(lease.expiresAt) || lease.expiresAt <= now) {
      changed = true;
      return;
    }
    current[key] = lease;
  });
  return { leases: current, changed };
}

function acquireNoteLease(message, sender) {
  const invalid = noteLeaseRequest(message, sender);
  if (invalid) return Promise.resolve(invalid);
  const storage = noteLeaseStorage();
  if (!storage) return Promise.resolve({ ok: false, reason: 'storage-unavailable' });
  const ownerToken = noteLeaseRandomUUID();
  if (!ownerToken) return Promise.resolve({ ok: false, reason: 'token-unavailable' });

  return queueNoteLeaseOperation(async () => {
    let leases;
    try {
      leases = await noteLeaseStorageGet(storage);
    } catch (error) {
      return { ok: false, reason: 'storage-failed' };
    }

    const now = Date.now();
    const cleaned = noteLeaseExpiredEntries(leases, now);
    leases = cleaned.leases;
    const key = noteLeaseKey(message.workspaceId, message.contactId, message.noteId);
    const held = leases[key];
    if (held) {
      if (cleaned.changed) {
        try { await noteLeaseStorageSet(storage, leases); } catch (error) { return { ok: false, reason: 'storage-failed' }; }
      }
      return { ok: false, reason: 'lease-held', expiresAt: held.expiresAt };
    }

    const lease = {
      workspaceId: message.workspaceId,
      contactId: message.contactId,
      noteId: message.noteId,
      ownerTabId: sender.tab.id,
      ownerToken,
      expiresAt: now + NOTE_LEASE_TTL_MS
    };
    leases[key] = lease;
    try {
      await noteLeaseStorageSet(storage, leases);
    } catch (error) {
      return { ok: false, reason: 'storage-failed' };
    }
    return { ok: true, lease };
  });
}

function releaseNoteLease(message, sender) {
  const invalid = noteLeaseRequest(message, sender);
  if (invalid || typeof message.ownerToken !== 'string'
    || !NOTE_LEASE_TOKEN_PATTERN.test(message.ownerToken)) {
    return Promise.resolve(invalid || { ok: false, reason: 'invalid-request' });
  }
  const storage = noteLeaseStorage();
  if (!storage) return Promise.resolve({ ok: false, reason: 'storage-unavailable' });

  return queueNoteLeaseOperation(async () => {
    let leases;
    try {
      leases = await noteLeaseStorageGet(storage);
    } catch (error) {
      return { ok: false, reason: 'storage-failed' };
    }

    const now = Date.now();
    const cleaned = noteLeaseExpiredEntries(leases, now);
    leases = cleaned.leases;
    const key = noteLeaseKey(message.workspaceId, message.contactId, message.noteId);
    const held = leases[key];
    if (!held || held.ownerTabId !== sender.tab.id || held.ownerToken !== message.ownerToken) {
      if (cleaned.changed) {
        try { await noteLeaseStorageSet(storage, leases); } catch (error) { return { ok: false, reason: 'storage-failed' }; }
      }
      return { ok: false, reason: 'not-owner' };
    }

    delete leases[key];
    try {
      await noteLeaseStorageSet(storage, leases);
    } catch (error) {
      return { ok: false, reason: 'storage-failed' };
    }
    return { ok: true, released: true };
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  if (!['install', 'update'].includes(details.reason)) return;

  reloadNoticeUntil = Date.now() + RELOAD_NOTICE_WINDOW_MS;
  injectReloadNoticeIntoOpenSupportedTabs();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'open-preview') {
    openPreviewTab(message.section);
    sendResponse({ ok: true });
  } else if (message && message.type === 'inbox-alert') {
    showInboxAlertNotification(message, sender);
    sendResponse({ ok: true });
  } else if (message && message.type === 'alert-test') {
    runAlertSelfTest(sendResponse);
    return true;
  } else if (message && message.type === 'capture-tabs') {
    collectCaptureTabs(sendResponse);
    return true;
  } else if (message && message.type === 'support-health') {
    collectSupportHealth(sendResponse);
    return true;
  } else if (message && message.type === 'dom-capture') {
    captureDomFromTab(message.tabId, sendResponse);
    return true;
  } else if (message && message.type === NOTE_LEASE_ACQUIRE_MESSAGE) {
    acquireNoteLease(message, sender).then(sendResponse);
    return true;
  } else if (message && message.type === NOTE_LEASE_RELEASE_MESSAGE) {
    releaseNoteLease(message, sender).then(sendResponse);
    return true;
  }
});

if (chrome.notifications && chrome.notifications.onClicked) {
  chrome.notifications.onClicked.addListener((notificationId) => {
    const target = alertNotificationTargets.get(notificationId) || notificationTargetFromId(notificationId);
    if (target && target.tabId != null) {
      chrome.tabs.update(target.tabId, { active: true }, () => {
        if (chrome.runtime.lastError) return;
        if (target.windowId != null) {
          chrome.windows.update(target.windowId, { focused: true }, () => void chrome.runtime.lastError);
        }
      });
    }
    alertNotificationTargets.delete(notificationId);
    chrome.notifications.clear(notificationId);
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  pendingReloadNoticeTabIds.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (Date.now() > reloadNoticeUntil) return;
  if (!pendingReloadNoticeTabIds.has(tabId)) return;
  if (changeInfo.status !== 'complete') return;
  const platform = getReloadNoticePlatform(tab.url);
  if (!platform) return;

  injectReloadNotice(tabId, platform);
});
