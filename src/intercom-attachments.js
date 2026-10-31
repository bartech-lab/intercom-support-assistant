(function (global) {
  'use strict';

  const STYLE_ID = 'isa-attachment-panel-style';
  const HIGHLIGHT_CLASS = 'isa-attachment-message-highlight';
  const PANEL_CLASS = 'isa-attachment-panel';
  const BUTTON_CLASS = 'isa-attachments-button';
  const PANEL_WIDTH = 320;
  const SENDER_LABELS = { customer: 'Customer', teammate: 'Team' };

  const STYLE_TEXT = `
    .${BUTTON_CLASS}[hidden], .${PANEL_CLASS}[hidden] { display: none !important; }
    .${BUTTON_CLASS} {
      align-items: center;
      background: transparent;
      border: 0;
      border-radius: 6px;
      color: currentColor;
      cursor: pointer;
      display: inline-flex;
      font: inherit;
      gap: 3px;
      opacity: .75;
      padding: 6px;
    }
    .${BUTTON_CLASS}:hover, .${BUTTON_CLASS}:focus-visible { opacity: 1; }
    .${BUTTON_CLASS} svg { display: block; height: 16px; width: 16px; }
    .isa-attachments-count { font-size: 12px; font-weight: 650; line-height: 1; }
    .${PANEL_CLASS} {
      background: var(--isa-attachment-bg, #ffffff);
      border: 1px solid var(--isa-attachment-border, #c9ccd2);
      border-radius: 8px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, .22);
      box-sizing: border-box;
      color: var(--isa-attachment-text, #242933);
      display: flex;
      flex-direction: column;
      font: 13px/1.4 system-ui, sans-serif;
      max-width: calc(100vw - 16px);
      min-height: 0;
      overflow: hidden;
      position: fixed;
      z-index: 2147483000;
    }
    @media (prefers-color-scheme: dark) {
      .${PANEL_CLASS} {
        --isa-attachment-bg: #20242b;
        --isa-attachment-border: #4b5360;
        --isa-attachment-text: #f3f4f6;
        --isa-attachment-muted: #99a1ad;
        --isa-attachment-hover: #2b313a;
      }
    }
    .${PANEL_CLASS} * { box-sizing: border-box; }
    .isa-attachment-panel-header {
      align-items: center;
      border-bottom: 1px solid var(--isa-attachment-border, #c9ccd2);
      display: flex;
      gap: 10px;
      justify-content: space-between;
      padding: 9px 8px 9px 12px;
    }
    .isa-attachment-panel-title { font-size: 13px; font-weight: 650; margin: 0; }
    .isa-attachment-panel-close {
      background: transparent;
      border: 0;
      border-radius: 4px;
      color: inherit;
      cursor: pointer;
      font-size: 17px;
      line-height: 1;
      opacity: .6;
      padding: 2px 6px;
    }
    .isa-attachment-panel-close:hover, .isa-attachment-panel-close:focus-visible { opacity: 1; }
    .isa-attachment-list { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 4px; }
    .isa-attachment-empty { color: var(--isa-attachment-muted, #66707d); display: block; padding: 12px 8px; }
    .isa-attachment-item {
      align-items: center;
      border-radius: 5px;
      display: flex;
      gap: 2px;
    }
    .isa-attachment-item:hover { background: var(--isa-attachment-hover, #f0f1f4); }
    .isa-attachment-row {
      background: transparent;
      border: 0;
      border-radius: 5px;
      color: inherit;
      cursor: pointer;
      display: block;
      flex: 1 1 auto;
      font: inherit;
      min-width: 0;
      padding: 7px 8px;
      text-align: left;
    }
    .isa-attachment-row:focus-visible { background: var(--isa-attachment-hover, #f0f1f4); }
    .isa-attachment-row[disabled] { cursor: default; }
    .isa-attachment-row[disabled] .isa-attachment-name { opacity: .65; }
    .isa-attachment-download {
      align-items: center;
      border-radius: 5px;
      color: inherit;
      display: inline-flex;
      flex: 0 0 auto;
      margin-right: 4px;
      opacity: .6;
      padding: 6px;
    }
    .isa-attachment-download:hover, .isa-attachment-download:focus-visible { opacity: 1; }
    .isa-attachment-download svg { display: block; height: 15px; width: 15px; }
    .isa-attachment-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .isa-attachment-meta { color: var(--isa-attachment-muted, #66707d); display: block; font-size: 11px; margin-top: 2px; }
    .${HIGHLIGHT_CLASS} { animation: isa-attachment-highlight 2.4s ease-out; }
    @keyframes isa-attachment-highlight { 0%, 55% { background-color: rgba(255, 220, 90, .7); } 100% { background-color: transparent; } }
  `;

  const PAPERCLIP_PATH = 'M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48';
  const DOWNLOAD_PATHS = ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'];

  function ensureStyle(document, root) {
    if (!document || !document.createElement) return;
    if (document.head && !document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.setAttribute('data-isa-own', 'attachments');
      style.textContent = STYLE_TEXT;
      document.head.appendChild(style);
    }
    if (root && root.nodeType === 11 && !root.querySelector(`#${STYLE_ID}`)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.setAttribute('data-isa-own', 'attachments');
      style.textContent = STYLE_TEXT;
      root.appendChild(style);
    }
  }

  function strokeIcon(document, paths) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    paths.forEach(definition => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', definition);
      svg.appendChild(path);
    });
    return svg;
  }

  function paperclipIcon(document) {
    return strokeIcon(document, [PAPERCLIP_PATH]);
  }

  function downloadIcon(document) {
    return strokeIcon(document, DOWNLOAD_PATHS);
  }

  function stringValue(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback;
    return String(value).trim();
  }

  function normalizeRole(value) {
    const role = String(value || '').trim().toLowerCase();
    if (role === 'customer' || role === 'teammate') return role;
    return '';
  }

  function safeHref(value) {
    const href = stringValue(value, '');
    return /^https?:\/{2}/i.test(href) ? href : '';
  }

  function normalizeRecord(record, index) {
    const source = record && typeof record === 'object' ? record : {};
    const senderRole = normalizeRole(source.senderRole);
    return {
      href: safeHref(source.href),
      source,
      index,
      id: stringValue(source.id, String(index)),
      messageElement: source.messageElement || null,
      filename: stringValue(source.filename, 'Unnamed attachment'),
      senderRole,
      senderLabel: SENDER_LABELS[senderRole] || '',
      date: stringValue(source.date, ''),
      streamIndex: Number.isFinite(Number(source.streamIndex)) ? Number(source.streamIndex) : null,
      size: stringValue(source.size, '')
    };
  }

  function normalizeRecords(records) {
    return (Array.isArray(records) ? records : []).map(normalizeRecord);
  }

  function metaLine(record) {
    return [record.senderLabel, record.size, record.date].filter(Boolean).join(' · ');
  }

  function rectOf(value) {
    if (!value) return null;
    if (typeof value.getBoundingClientRect === 'function') return value.getBoundingClientRect();
    return value;
  }

  function isConnected(element) {
    return !!element && (element.isConnected === true || (element.ownerDocument && element.ownerDocument.documentElement && element.ownerDocument.documentElement.contains(element)));
  }

  function markOwned(element) {
    if (element && element.setAttribute) element.setAttribute('data-isa-own', 'attachments');
    return element;
  }

  function activeElementWithin(document) {
    let element = document.activeElement;
    while (element && element.shadowRoot && element.shadowRoot.activeElement) {
      element = element.shadowRoot.activeElement;
    }
    return element;
  }

  function createAttachmentPanel(options) {
    const settings = options || {};
    const document = settings.document || global.document;
    const view = settings.window || (document && document.defaultView) || global;
    if (!document || !document.createElement) throw new TypeError('An attachment panel document is required');
    ensureStyle(document, settings.headerHost && settings.headerHost.getRootNode ? settings.headerHost.getRootNode() : null);

    const state = {
      conversationId: settings.conversationId == null ? '' : String(settings.conversationId),
      records: normalizeRecords(settings.records),
      previousFocus: null,
      highlightTimer: null,
      highlightedMessage: null,
      destroyed: false
    };

    const button = document.createElement('button');
    button.type = 'button';
    button.className = BUTTON_CLASS;
    markOwned(button);
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    button.appendChild(paperclipIcon(document));
    const count = document.createElement('span');
    count.className = 'isa-attachments-count';
    button.appendChild(count);

    const panel = document.createElement('section');
    panel.className = PANEL_CLASS;
    markOwned(panel);
    panel.hidden = true;
    panel.tabIndex = -1;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-label', 'Attachments');

    const header = document.createElement('div');
    header.className = 'isa-attachment-panel-header';
    const title = document.createElement('h2');
    title.className = 'isa-attachment-panel-title';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'isa-attachment-panel-close';
    close.setAttribute('aria-label', 'Close attachments');
    close.textContent = '×';
    header.append(title, close);

    const list = document.createElement('div');
    list.className = 'isa-attachment-list';
    markOwned(list);
    list.setAttribute('role', 'list');
    panel.append(header, list);
    const root = document.body || document.documentElement;
    if (settings.headerHost && settings.headerHost.insertBefore) {
      settings.headerHost.insertBefore(button, settings.headerHost.firstElementChild || null);
    }
    root.appendChild(panel);

    function place() {
      const anchor = rectOf(button);
      const viewWidth = Number(view.innerWidth) || 1024;
      const viewHeight = Number(view.innerHeight) || 768;
      const width = Math.max(0, Math.min(PANEL_WIDTH, viewWidth - 16));
      const anchorBottom = Number.isFinite(anchor && anchor.bottom) ? anchor.bottom : 8;
      const anchorRight = Number.isFinite(anchor && anchor.right) ? anchor.right : viewWidth - 8;
      const top = Math.max(8, anchorBottom + 6);
      const left = Math.max(8, Math.min(anchorRight - width, viewWidth - width - 8));
      const composerBounds = rectOf(settings.composerBoundary || settings.composer);
      const floor = Number.isFinite(composerBounds && composerBounds.top) ? composerBounds.top : viewHeight;
      panel.style.width = `${width}px`;
      panel.style.maxHeight = `${Math.max(0, floor - top - 8)}px`;
      panel.style.top = `${top}px`;
      panel.style.left = `${left}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    }

    function updateButton() {
      const total = state.records.length;
      count.textContent = String(total);
      button.hidden = total === 0;
      button.setAttribute('aria-label', `Attachments, ${total} ${total === 1 ? 'file' : 'files'}`);
      button.setAttribute('aria-expanded', String(!panel.hidden));
    }

    function render() {
      title.textContent = `Attachments · ${state.records.length}`;
      while (list.firstChild) list.removeChild(list.firstChild);
      if (!state.records.length) {
        const empty = document.createElement('span');
        empty.className = 'isa-attachment-empty';
        empty.textContent = 'No attachments in loaded messages.';
        list.appendChild(empty);
        return;
      }
      state.records.forEach(record => {
        const item = document.createElement('div');
        item.className = 'isa-attachment-item';
        item.setAttribute('role', 'listitem');
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'isa-attachment-row';
        row.dataset.index = String(record.index);
        row.dataset.attachmentId = record.id;
        const jumpable = isConnected(record.messageElement);
        row.disabled = !jumpable;
        row.title = jumpable ? record.filename : `${record.filename}\nMessage not loaded`;
        const name = document.createElement('span');
        name.className = 'isa-attachment-name';
        name.textContent = record.filename;
        row.appendChild(name);
        const meta = metaLine(record);
        if (meta) {
          const line = document.createElement('span');
          line.className = 'isa-attachment-meta';
          line.textContent = meta;
          row.appendChild(line);
        }
        item.appendChild(row);
        if (record.href) {
          const link = document.createElement('a');
          link.className = 'isa-attachment-download';
          markOwned(link);
          link.href = record.href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.download = record.filename;
          link.title = `Download ${record.filename}`;
          link.setAttribute('aria-label', `Download ${record.filename}`);
          link.appendChild(downloadIcon(document));
          item.appendChild(link);
        }
        list.appendChild(item);
      });
    }

    const FOCUSABLE_ROW_SELECTOR = '.isa-attachment-row:not([disabled]), .isa-attachment-download';

    function focusFirstItem() {
      const first = list.querySelector(FOCUSABLE_ROW_SELECTOR);
      if (first) first.focus();
    }

    function openPanel() {
      if (state.destroyed || state.records.length === 0) return;
      state.previousFocus = activeElementWithin(document);
      render();
      panel.hidden = false;
      place();
      updateButton();
      focusFirstItem();
    }

    function closePanel(restoreFocus = true) {
      if (panel.hidden) return;
      panel.hidden = true;
      updateButton();
      if (restoreFocus && isConnected(state.previousFocus) && typeof state.previousFocus.focus === 'function') state.previousFocus.focus();
      state.previousFocus = null;
    }

    function showMessage(record) {
      const message = record && record.messageElement;
      if (!isConnected(message)) return;
      ensureStyle(document, message.getRootNode ? message.getRootNode() : null);
      closePanel();
      try {
        if (typeof message.scrollIntoView === 'function') message.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch (error) {
        try { message.scrollIntoView(); } catch (ignored) {}
      }
      if (state.highlightTimer) view.clearTimeout(state.highlightTimer);
      if (state.highlightedMessage) state.highlightedMessage.classList.remove(HIGHLIGHT_CLASS);
      message.classList.add(HIGHLIGHT_CLASS);
      state.highlightedMessage = message;
      state.highlightTimer = view.setTimeout(() => {
        message.classList.remove(HIGHLIGHT_CLASS);
        state.highlightedMessage = null;
        state.highlightTimer = null;
      }, 2400);
    }

    function clearHighlight() {
      if (state.highlightTimer) view.clearTimeout(state.highlightTimer);
      if (state.highlightedMessage) state.highlightedMessage.classList.remove(HIGHLIGHT_CLASS);
      state.highlightTimer = null;
      state.highlightedMessage = null;
    }

    function activateRow(event) {
      const target = event.target && event.target.closest ? event.target.closest('.isa-attachment-row') : null;
      if (!target || !list.contains(target)) return;
      const record = state.records[Number(target.dataset.index)];
      if (!record) return;
      if (isConnected(record.messageElement)) showMessage(record);
      else closePanel();
    }

    function moveFocus(event) {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const focusable = [close, ...list.querySelectorAll(FOCUSABLE_ROW_SELECTOR)];
      const current = focusable.indexOf(activeElementWithin(document));
      if (current === -1) return;
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      focusable[(current + delta + focusable.length) % focusable.length].focus();
    }

    function eventHitsOurs(event) {
      const path = event && typeof event.composedPath === 'function' ? event.composedPath() : null;
      if (path && path.length) return path.includes(panel) || path.includes(button);
      const target = event && event.target;
      if (!target || typeof target.contains !== 'function') return false;
      return panel.contains(target) || button.contains(target);
    }

    function handleOutside(event) {
      if (panel.hidden) return;
      if (eventHitsOurs(event)) return;
      closePanel(false);
    }

    function handleScroll(event) {
      if (panel.hidden) return;
      if (eventHitsOurs(event)) return;
      const target = event && event.target;
      if (target && typeof target.contains === 'function' && target.contains(panel)) return;
      closePanel(false);
    }

    function reposition() {
      if (!panel.hidden) place();
    }

    button.addEventListener('click', () => (panel.hidden ? openPanel() : closePanel()));
    close.addEventListener('click', () => closePanel());
    panel.addEventListener('click', activateRow);
    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePanel();
        return;
      }
      moveFocus(event);
    });

    function setRecords(records, conversationId) {
      if (conversationId !== undefined && String(conversationId) !== state.conversationId) {
        clearHighlight();
        state.conversationId = String(conversationId);
        closePanel(false);
      }
      state.records = normalizeRecords(records);
      updateButton();
      render();
      if (!panel.hidden) place();
    }

    function setConversation(conversationId, records) {
      setRecords(records || [], conversationId);
    }

    function destroy() {
      if (state.destroyed) return;
      state.destroyed = true;
      clearHighlight();
      if (typeof view.removeEventListener === 'function') {
        view.removeEventListener('resize', reposition);
        view.removeEventListener('scroll', handleScroll, true);
      }
      if (document.removeEventListener) document.removeEventListener('pointerdown', handleOutside, true);
      if (button.parentNode) button.parentNode.removeChild(button);
      if (panel.parentNode) panel.parentNode.removeChild(panel);
    }

    if (typeof view.addEventListener === 'function') {
      view.addEventListener('resize', reposition);
      view.addEventListener('scroll', handleScroll, true);
    }
    if (document.addEventListener) document.addEventListener('pointerdown', handleOutside, true);

    updateButton();
    render();

    return {
      button,
      panel,
      list,
      open: openPanel,
      close: closePanel,
      setRecords,
      setConversation,
      getRecords: () => state.records.slice(),
      getConversationId: () => state.conversationId,
      destroy,
      focusFirstItem
    };
  }

  global.ISA_ATTACHMENTS = {
    createAttachmentPanel,
    normalizeRecord,
    normalizeRecords,
    metaLine
  };
})(window);

const ISA_ATTACHMENT_CACHE_LIMIT = 6;
const isaAttachmentCache = new Map();
let isaAttachmentController = null;
let isaAttachmentHost = null;
let isaAttachmentConversationId = '';

function isaAttachmentRoot() {
  if (typeof getIntercomRoot === 'function') return getIntercomRoot();
  return document;
}

function isaAttachmentRouteConversationId() {
  if (typeof getConversationId === 'function') return getConversationId();
  const match = window.location.pathname.match(/\/conversations?\/(\d+)/);
  return match ? match[1] : null;
}

function isaAttachmentText(element, fallback = '') {
  const text = element && typeof element.textContent === 'string' ? element.textContent.trim() : '';
  return text || fallback;
}

function isaAttachmentSenderRole(message) {
  if (!message) return '';
  if (message.querySelector('[data-testid="user-email-content"]')) return 'customer';
  if (message.querySelector('[data-testid="teammate-email-reply-part"]')) return 'teammate';
  return '';
}

function isaAttachmentHeaderHost(header) {
  const more = header.querySelector('[data-test-conversation-header-more="true"]');
  if (more && more.parentElement && header.contains(more.parentElement)) return more.parentElement;
  const snooze = header.querySelector('[data-test-conversation-header-snooze="true"]');
  if (snooze && snooze.parentElement && header.contains(snooze.parentElement)) return snooze.parentElement;
  const title = header.querySelector('[data-inbox-conversation-header-title="true"]');
  if (title && title.parentElement && title.parentElement.parentElement === header) return title.parentElement;
  return null;
}

function isaAttachmentSafeHref(link) {
  const href = link && typeof link.getAttribute === 'function' ? String(link.getAttribute('href') || '').trim() : '';
  return /^https?:\/{2}/i.test(href) ? href : '';
}

function isaAttachmentRecords(root, conversationId) {
  const stream = root && root.querySelector('[data-testid="conversation-stream-scroll-container"]');
  if (!stream) return { stream: null, records: [] };
  const records = [];
  const seen = new Set();
  [...stream.querySelectorAll('a[data-testid="upload-link"]')].forEach(link => {
    const upload = link.closest('[data-testid="upload"]');
    const message = link.closest('[data-testid^="conversation-part-id-"]');
    const partContainer = message && message.closest('[data-part-entity-id][data-index]');
    if (!upload || !message || !partContainer || !stream.contains(partContainer)) return;
    const filename = isaAttachmentText(link, 'Unnamed attachment');
    const entityId = partContainer.getAttribute('data-part-entity-id') || '';
    const streamIndex = Number(partContainer.getAttribute('data-index'));
    const uploadIndex = [...partContainer.querySelectorAll('a[data-testid="upload-link"]')].indexOf(link);
    const id = `${conversationId}:${entityId}:${uploadIndex}:${filename}`;
    if (seen.has(id)) return;
    seen.add(id);
    const order = Number(entityId);
    records.push({
      id,
      messageElement: message,
      filename,
      senderRole: isaAttachmentSenderRole(message),
      date: isaAttachmentText(message.querySelector('[data-testid="metadata"] [data-testid="tooltip-trigger"]'), ''),
      size: isaAttachmentText(upload.querySelector('[data-testid="upload-size"]'), ''),
      href: isaAttachmentSafeHref(link),
      order: Number.isFinite(order) ? order : null,
      uploadIndex,
      streamIndex: Number.isFinite(streamIndex) ? streamIndex : null
    });
  });
  return { stream, records };
}

function isaAttachmentDetached(record) {
  return {
    id: record.id,
    messageElement: null,
    filename: record.filename,
    senderRole: record.senderRole,
    date: record.date,
    size: record.size,
    href: record.href,
    order: record.order,
    uploadIndex: record.uploadIndex,
    streamIndex: record.streamIndex
  };
}

function isaAttachmentSortValue(record) {
  return Number.isFinite(record.order) ? record.order : Number.MAX_SAFE_INTEGER;
}

function isaAttachmentMergeCache(conversationId, records) {
  const merged = new Map();
  (isaAttachmentCache.get(conversationId) || []).forEach(record => merged.set(record.id, record));
  records.forEach(record => merged.set(record.id, record));
  const list = [...merged.values()].sort((left, right) => {
    const difference = isaAttachmentSortValue(left) - isaAttachmentSortValue(right);
    if (difference !== 0) return difference;
    if (left.uploadIndex !== right.uploadIndex) return left.uploadIndex - right.uploadIndex;
    return String(left.id) < String(right.id) ? -1 : 1;
  });
  isaAttachmentCache.delete(conversationId);
  isaAttachmentCache.set(conversationId, list.map(isaAttachmentDetached));
  while (isaAttachmentCache.size > ISA_ATTACHMENT_CACHE_LIMIT) {
    isaAttachmentCache.delete(isaAttachmentCache.keys().next().value);
  }
  return list;
}

const isaAttachmentElementKeys = new WeakMap();
let isaAttachmentNextElementKey = 1;

function isaAttachmentElementKey(element) {
  if (!element) return '0';
  if (!isaAttachmentElementKeys.has(element)) isaAttachmentElementKeys.set(element, isaAttachmentNextElementKey++);
  return String(isaAttachmentElementKeys.get(element));
}

function isaAttachmentRecordSignature(records) {
  return records
    .map(record => [
      record.id,
      record.filename,
      record.senderRole,
      record.date,
      record.size,
      record.streamIndex,
      record.href,
      isaAttachmentElementKey(record.messageElement)
    ].join('|'))
    .join('~');
}

function isaAttachmentRemoveInjected() {
  if (isaAttachmentController) isaAttachmentController.destroy();
  isaAttachmentController = null;
  isaAttachmentHost = null;
  isaAttachmentConversationId = '';
}

function refreshIntercomAttachments() {
  if (!window.ISA_ATTACHMENTS || !document) return;
  const root = isaAttachmentRoot();
  const header = root && root.querySelector('[data-testid="conversation-header"][data-conversation-id]');
  const routeId = isaAttachmentRouteConversationId();
  const headerId = header && header.getAttribute('data-conversation-id');
  if (!header || !routeId || !headerId || String(routeId) !== String(headerId)) {
    isaAttachmentRemoveInjected();
    return;
  }

  const headerHost = isaAttachmentHeaderHost(header);
  if (!headerHost) {
    isaAttachmentRemoveInjected();
    return;
  }

  const mounted = Boolean(headerHost.querySelector('.isa-attachments-button'));
  if (typeof decoratedByAnotherInstall === 'function'
    && decoratedByAnotherInstall(headerHost, ATTACHMENT_OWNER_ATTRIBUTE, mounted)) return;

  if (isaAttachmentConversationId !== String(headerId) || isaAttachmentHost !== headerHost
    || (isaAttachmentController && !mounted)) {
    isaAttachmentRemoveInjected();
    isaAttachmentConversationId = String(headerId);
  }

  const { stream, records: live } = isaAttachmentRecords(root, String(headerId));
  if (!stream) {
    isaAttachmentRemoveInjected();
    return;
  }
  const records = isaAttachmentMergeCache(String(headerId), live);
  const composer = root.querySelector('[data-testid="composer-orchestrator"]')
    || root.querySelector('.inbox2__composer__container, [data-conversation-reply-composer-root], [data-conversation-reply-composer]');
  if (!isaAttachmentController) {
    if (typeof claimDecoration === 'function') claimDecoration(headerHost, ATTACHMENT_OWNER_ATTRIBUTE);
    isaAttachmentController = window.ISA_ATTACHMENTS.createAttachmentPanel({
      headerHost,
      conversationId: String(headerId),
      records,
      composerBoundary: composer,
      window
    });
    isaAttachmentHost = headerHost;
    return;
  }
  const previousSignature = isaAttachmentRecordSignature(isaAttachmentController.getRecords());
  const nextSignature = isaAttachmentRecordSignature(records);
  if (previousSignature !== nextSignature) isaAttachmentController.setRecords(records, String(headerId));
}

window.refreshIntercomAttachments = refreshIntercomAttachments;
window.ISA_ATTACHMENTS_ADAPTER = {
  refresh: refreshIntercomAttachments,
  getController: () => isaAttachmentController
};
