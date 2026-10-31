(function () {
  'use strict';

  if (window.ISA_DOM_CAPTURE) return;

  const CAPTURE_MESSAGE = 'isa-dom-capture';
  const CAPTURE_VERSION = 1;
  const META_ELEMENT_ID = 'isa-capture-meta';
  const OWN_ATTRIBUTE = 'data-isa-own';
  const OWN_ATTRIBUTE_PREFIX = 'data-isa-';
  const OWN_CLASS_PREFIX = 'isa-';
  const SHADOW_MODE_ATTRIBUTE = 'shadowrootmode';
  const SUPPORT_PING_MESSAGE = 'isa-support-ping';
  const OWN_INVENTORY_LIMIT = 200;
  const OWN_TEXT_LIMIT = 160;

  function isOwnElement(element) {
    return typeof element.hasAttribute === 'function' && element.hasAttribute(OWN_ATTRIBUTE);
  }

  function stripOwnMarkers(clone) {
    if (clone.attributes) {
      [...clone.attributes].forEach((attribute) => {
        if (attribute.name.startsWith(OWN_ATTRIBUTE_PREFIX)) clone.removeAttribute(attribute.name);
      });
    }

    if (!clone.classList || !clone.classList.length) return;
    [...clone.classList].forEach((name) => {
      if (name.startsWith(OWN_CLASS_PREFIX)) clone.classList.remove(name);
    });
    if (!clone.classList.length) clone.removeAttribute('class');
  }

  function ownElementRect(element) {
    if (typeof element.getBoundingClientRect !== 'function') return null;
    const rect = element.getBoundingClientRect();
    return {
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  }

  function ownElementEntry(element) {
    const style = typeof window.getComputedStyle === 'function' ? window.getComputedStyle(element) : null;
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      className: typeof element.className === 'string' ? element.className || null : null,
      parent: element.parentElement ? element.parentElement.tagName.toLowerCase() : null,
      rect: ownElementRect(element),
      position: style ? style.position : null,
      display: style ? style.display : null,
      visibility: style ? style.visibility : null,
      zIndex: style ? style.zIndex : null,
      text: (element.textContent || '').trim().slice(0, OWN_TEXT_LIMIT) || null
    };
  }

  function collectOwnElements(root, found) {
    [...root.querySelectorAll('*')].forEach((element) => {
      if (found.length >= OWN_INVENTORY_LIMIT) return;
      if (isOwnElement(element)) found.push(ownElementEntry(element));
      const shadow = openShadowRoot(element);
      if (shadow) collectOwnElements(shadow, found);
    });
    return found;
  }

  function ownElementInventory() {
    try {
      return collectOwnElements(document.documentElement, []);
    } catch (error) {
      return [];
    }
  }

  function openShadowRoot(element) {
    try {
      return element.shadowRoot || null;
    } catch (error) {
      return null;
    }
  }

  function cloneChildren(source, target, doc) {
    [...source.childNodes].forEach((child) => {
      if (child.nodeType === 1) {
        if (isOwnElement(child)) return;
        target.appendChild(cloneElement(child, doc));
        return;
      }
      if (child.nodeType === 3 || child.nodeType === 8) {
        target.appendChild(child.cloneNode(false));
      }
    });
  }

  function cloneElement(element, doc) {
    if (element.tagName === 'TEMPLATE') return element.cloneNode(true);

    const clone = element.cloneNode(false);
    stripOwnMarkers(clone);

    const shadow = openShadowRoot(element);
    if (shadow) {
      const template = doc.createElement('template');
      template.setAttribute(SHADOW_MODE_ATTRIBUTE, 'open');
      cloneChildren(shadow, template.content, doc);
      clone.appendChild(template);
    }

    cloneChildren(element, clone, doc);
    return clone;
  }

  function escapeForScript(text) {
    return text.replace(/</g, '\\u003c');
  }

  function serializeDocument(meta) {
    const root = cloneElement(document.documentElement, document);
    const head = root.querySelector('head') || root;
    const script = document.createElement('script');
    script.type = 'application/json';
    script.id = META_ELEMENT_ID;
    script.textContent = escapeForScript(JSON.stringify(meta, null, 2));
    head.insertBefore(script, head.firstChild);
    return `<!doctype html>\n${root.outerHTML}\n`;
  }

  function extensionVersion() {
    try {
      return chrome.runtime.getManifest().version;
    } catch (error) {
      return null;
    }
  }

  function captureFilename(meta) {
    const stamp = meta.capturedAt.slice(0, 19).replace(/[-:]/g, '');
    const label = meta.conversationId || meta.view || 'page';
    return `${meta.surface}-${stamp}-${label}.html`;
  }

  function buildCapture(details) {
    const info = details || {};
    const meta = {
      captureVersion: CAPTURE_VERSION,
      surface: info.surface || 'unknown',
      url: window.location.href,
      conversationId: info.conversationId || null,
      view: info.view || null,
      extensionVersion: extensionVersion(),
      capturedAt: new Date().toISOString(),
      shadowRootPresent: Boolean(info.shadowRootPresent),
      anchorHealth: info.anchorHealth || null,
      teamDirectory: info.teamDirectory || null,
      ownElements: ownElementInventory()
    };

    return {
      ok: true,
      meta,
      filename: captureFilename(meta),
      html: serializeDocument(meta)
    };
  }

  function answerSupportPing(sendResponse) {
    sendResponse({
      ok: true,
      url: window.location.href,
      captureVersion: CAPTURE_VERSION,
      extensionVersion: extensionVersion()
    });
  }

  try {
    if (chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message || message.type !== SUPPORT_PING_MESSAGE) return undefined;
        answerSupportPing(sendResponse);
        return true;
      });
    }
  } catch (error) {}

  window.ISA_DOM_CAPTURE = {
    MESSAGE: CAPTURE_MESSAGE,
    pingMessage: SUPPORT_PING_MESSAGE,
    version: CAPTURE_VERSION,
    metaElementId: META_ELEMENT_ID,
    buildCapture,
    serializeDocument,
    captureFilename
  };
})();
