(function () {
  'use strict';

  if (window.ISA_SUPPORT_TOOLS) return;

  const STYLE_ID = 'isa-support-tools-style';
  const CONTEXT_SCHEMA = 1;
  const BACKUP_SCHEMA = 1;
  const CAPTURE_META_ID = 'isa-capture-meta';
  const CONTEXT_META_ID = 'isa-capture-context';

  const BACKUP_KEYS = [
    { key: 'isaAlertEnabled', type: 'boolean' },
    { key: 'isaAlertEnabledInboxes', type: 'strings' },
    { key: 'isaAlertSound', type: 'string' },
    { key: 'isaAlertYourInbox', type: 'boolean' },
    { key: 'isaAlertDebug', type: 'boolean' },
    { key: 'isaDebug', type: 'boolean' },
    { key: 'isaPauseAutomaticNoteCleanup', type: 'boolean' }
  ];

  const DERIVED_KEYS = [
    'isaAlertRoster',
    'isaAlertLastSeen'
  ];

  const DEBUG_FLAGS = [
    {
      key: 'isaDebug',
      label: 'Verbose logging',
      hint: 'Logs selector, language, and routing decisions to the page console.'
    },
    {
      key: 'isaAlertDebug',
      label: 'Alert logging',
      hint: 'Logs every alert decision. Turn this on before reproducing an unexpected ding.'
    },
    {
      key: 'isaPauseAutomaticNoteCleanup',
      label: 'Pause note cleanup',
      hint: 'Stops expired self-destructing notes from being deleted in this browser.'
    }
  ];

  const CSS = `
    .isa-st-card {
      --isa-st-ok: #1a7f4b;
      --isa-st-bad: #b3261e;
      border: 1px solid var(--hairline, #e3e6ea);
      border-radius: 12px;
      background: var(--surface, #fff);
      margin: 0 0 16px;
      overflow: hidden;
    }
    :root[data-theme="dark"] .isa-st-card {
      --isa-st-ok: #6ee7a8;
      --isa-st-bad: #ff8a80;
    }
    .isa-st-head {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 14px;
      background: none;
      border: 0;
      cursor: pointer;
      font: inherit;
      color: var(--ink, #1a1d21);
      text-align: left;
    }
    .isa-st-title { font-weight: 600; font-size: 14px; }
    .isa-st-chevron { color: var(--ink-muted, #6b7280); font-size: 12px; }
    .isa-st-body { padding: 0 14px 14px; border-top: 1px solid var(--hairline, #e3e6ea); }
    .isa-st-actions { display: flex; gap: 8px; margin: 12px 0; flex-wrap: wrap; }
    .isa-st-btn {
      border: 1px solid var(--hairline, #e3e6ea);
      background: var(--surface-2, #f7f8fa);
      color: var(--ink, #1a1d21);
      border-radius: 8px;
      padding: 7px 12px;
      font: inherit;
      font-size: 13px;
      cursor: pointer;
    }
    .isa-st-btn:disabled { opacity: 0.55; cursor: default; }
    .isa-st-btn--primary { background: var(--accent, #2f6feb); border-color: transparent; color: var(--accent-ink, #fff); }
    .isa-st-summary { margin: 0 0 12px; font-size: 13px; color: var(--ink-muted, #6b7280); }
    .isa-st-hint { margin: 2px 0 0; font-size: 12px; color: var(--ink-muted, #6b7280); }
    .isa-st-note { font-size: 13px; color: var(--ink-muted, #6b7280); margin: 8px 0; }
    .isa-st-note--bad { color: var(--isa-st-bad); }
    .isa-st-ok { color: var(--isa-st-ok); }
    .isa-st-bad { color: var(--isa-st-bad); font-weight: 600; }
    .isa-st-lines { margin: 0 0 12px; padding: 0; list-style: none; font-size: 13px; }
    .isa-st-lines li { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; border-bottom: 1px solid var(--hairline, #e3e6ea); }
    .isa-st-lines li:last-child { border-bottom: 0; }
    .isa-st-lines span:first-child { color: var(--ink-muted, #6b7280); }
    .isa-st-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 0;
      border-top: 1px solid var(--hairline, #e3e6ea);
    }
    .isa-st-rowinfo { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .isa-st-rowlabel { font-size: 13px; overflow-wrap: anywhere; }
    .isa-st-rowstatus { font-size: 12px; color: var(--ink-muted, #6b7280); }
    .isa-st-rowstatus--ok { color: var(--isa-st-ok); }
    .isa-st-rowstatus--bad { color: var(--isa-st-bad); }
    .isa-st-check { display: flex; gap: 8px; align-items: flex-start; padding: 8px 0; }
    .isa-st-check input { margin: 2px 0 0; }
    .isa-st-check span { font-size: 13px; }
    .isa-st-checktext { display: flex; flex-direction: column; gap: 2px; }
    .isa-st-checktext .isa-st-hint { margin: 0; }
    .isa-st-file { display: none; }
  `;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function storageArea(name) {
    try {
      if (chrome.storage && chrome.storage[name]) return chrome.storage[name];
    } catch (error) {}
    return null;
  }

  function areaGet(name, query) {
    return new Promise((resolve) => {
      const area = storageArea(name);
      if (!area) {
        resolve({ ok: false, error: `${name} storage unavailable`, items: {} });
        return;
      }
      try {
        area.get(query, (items) => {
          const failure = chrome.runtime.lastError;
          if (failure) {
            resolve({ ok: false, error: failure.message, items: {} });
            return;
          }
          resolve({ ok: true, error: null, items: items || {} });
        });
      } catch (error) {
        resolve({ ok: false, error: String(error && error.message), items: {} });
      }
    });
  }

  function areaSet(name, values) {
    return new Promise((resolve) => {
      const area = storageArea(name);
      if (!area) {
        resolve({ ok: false, error: `${name} storage unavailable` });
        return;
      }
      try {
        area.set(values, () => {
          const failure = chrome.runtime.lastError;
          resolve(failure ? { ok: false, error: failure.message } : { ok: true, error: null });
        });
      } catch (error) {
        resolve({ ok: false, error: String(error && error.message) });
      }
    });
  }

  function sendBackgroundMessage(payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (response) => {
          const failure = chrome.runtime.lastError;
          if (failure) {
            resolve({ ok: false, reason: 'no-response', error: failure.message });
            return;
          }
          resolve(response);
        });
      } catch (error) {
        resolve({ ok: false, reason: 'no-response', error: String(error && error.message) });
      }
    });
  }

  function failureText(response) {
    if (!response) return 'no response';
    if (response.notInjected) return 'extension not loaded in that tab, reload it';
    if (response.reason === 'timeout') return 'timed out';
    if (response.reason === 'unreachable') return `unreachable: ${response.error || 'unknown'}`;
    return response.error || response.reason || 'unknown error';
  }

  function extensionVersion() {
    try {
      return chrome.runtime.getManifest().version;
    } catch (error) {
      return null;
    }
  }

  function fileStamp(iso) {
    return iso.slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  }

  function saveFile(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function escapeForScript(text) {
    return text.replace(/</g, '\\u003c');
  }

  function jsonScript(id, value) {
    return `<script type="application/json" id="${id}">\n${escapeForScript(JSON.stringify(value, null, 2))}\n</script>`;
  }

  function buildCoverage() {
    const data = window.SIGNATURE_DATA;
    if (!data) return { available: false };

    const companies = Object.keys(data.companies || {}).sort();

    return {
      available: true,
      companyCount: companies.length,
      companies,
      teamSignatureInboxes: Array.isArray(data.teamSignatureInboxes) ? data.teamSignatureInboxes.slice() : [],
      alertRoster: (data.alertRoster || []).map(entry => ({ teamId: entry.teamId, label: entry.label })),
      promotionalBanners: Object.keys(data.promotionalBanners || {})
    };
  }

  function pickBackupSettings(items) {
    const settings = {};
    BACKUP_KEYS.forEach(({ key }) => {
      if (Object.prototype.hasOwnProperty.call(items, key)) settings[key] = items[key];
    });
    return settings;
  }

  function validBackupValue(type, value) {
    if (type === 'boolean') return typeof value === 'boolean';
    if (type === 'string') return typeof value === 'string' || value === null;
    if (type === 'strings') return Array.isArray(value) && value.every(entry => typeof entry === 'string');
    return false;
  }

  async function collectContext() {
    const generatedAt = new Date().toISOString();
    const [health, local, session] = await Promise.all([
      sendBackgroundMessage({ type: 'support-health' }),
      areaGet('local', null),
      areaGet('session', null)
    ]);

    return {
      schema: CONTEXT_SCHEMA,
      generatedAt,
      workspaceUrl: window.location.href,
      extensionVersion: extensionVersion(),
      health: health && health.ok ? health.health : null,
      healthError: health && health.ok ? null : failureText(health),
      storage: {
        local: local.items,
        localError: local.error,
        session: session.items,
        sessionError: session.error
      },
      settings: pickBackupSettings(local.items),
      coverage: buildCoverage(),
      capture: null
    };
  }

  function injectCaptureContext(html, context) {
    const script = jsonScript(CONTEXT_META_ID, context);
    const head = /<head[^>]*>/i.exec(html);
    if (!head) return `${script}\n${html}`;
    const at = head.index + head[0].length;
    return `${html.slice(0, at)}\n${script}${html.slice(at)}`;
  }

  function buildCard(container, title) {
    injectStyle();
    container.dataset.isaStMounted = 'true';
    container.classList.add('isa-st-card');
    const expanded = container.getAttribute('data-isa-expanded') === 'true';

    container.innerHTML = `
      <button class="isa-st-head" data-isa="toggle" type="button" aria-expanded="${expanded ? 'true' : 'false'}">
        <span class="isa-st-title">${title}</span>
        <span class="isa-st-chevron" data-isa="chevron">${expanded ? 'Hide' : 'Show'}</span>
      </button>
      <div class="isa-st-body" data-isa="body"${expanded ? '' : ' hidden'}></div>
    `;

    const toggle = container.querySelector('[data-isa="toggle"]');
    const chevron = container.querySelector('[data-isa="chevron"]');
    const body = container.querySelector('[data-isa="body"]');

    toggle.addEventListener('click', () => {
      const open = body.hasAttribute('hidden');
      if (open) body.removeAttribute('hidden');
      else body.setAttribute('hidden', '');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      chevron.textContent = open ? 'Hide' : 'Show';
    });

    return { body };
  }

  function appendNote(target, text, bad) {
    const note = document.createElement('p');
    note.className = bad ? 'isa-st-note isa-st-note--bad' : 'isa-st-note';
    note.textContent = text;
    target.appendChild(note);
    return note;
  }

  function appendLines(target, entries) {
    const list = document.createElement('ul');
    list.className = 'isa-st-lines';
    entries.forEach(([label, value, tone]) => {
      const row = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = label;
      const detail = document.createElement('span');
      if (tone === 'ok') detail.className = 'isa-st-ok';
      if (tone === 'bad') detail.className = 'isa-st-bad';
      detail.textContent = value;
      row.appendChild(name);
      row.appendChild(detail);
      list.appendChild(row);
    });
    target.appendChild(list);
    return list;
  }

  function mountCaptures(container) {
    if (!container || container.dataset.isaStMounted === 'true') return;
    const { body } = buildCard(container, 'Captures');

    body.innerHTML = `
      <div class="isa-st-actions">
        <button class="isa-st-btn isa-st-btn--primary" data-isa="check" type="button">Check and list tabs</button>
      </div>
      <p class="isa-st-summary" data-isa="summary" role="status" aria-live="polite">A capture holds the page DOM, this build, the health check, your settings, and what this install carries. Nothing is uploaded.</p>
      <div data-isa="result"></div>
    `;

    const check = body.querySelector('[data-isa="check"]');
    const result = body.querySelector('[data-isa="result"]');

    const saveFromTab = async (tab, button, status) => {
      button.disabled = true;
      button.textContent = 'Saving...';
      status.className = 'isa-st-rowstatus';
      status.textContent = '';

      const [context, capture] = await Promise.all([
        collectContext(),
        sendBackgroundMessage({ type: 'dom-capture', tabId: tab.tabId })
      ]);
      button.disabled = false;
      button.textContent = 'Download';

      if (!capture || !capture.ok || !capture.html) {
        status.className = 'isa-st-rowstatus isa-st-rowstatus--bad';
        status.textContent = `failed: ${failureText(capture)}`;
        return;
      }

      context.capture = { filename: capture.filename, meta: capture.meta };
      const captureHtml = injectCaptureContext(capture.html, context);
      saveFile(capture.filename, captureHtml, 'text/html');
      status.className = 'isa-st-rowstatus isa-st-rowstatus--ok';
      status.textContent = `saved ${capture.filename}`;
    };

    const renderTabRow = (tab) => {
      const row = document.createElement('div');
      row.className = 'isa-st-row';

      const info = document.createElement('span');
      info.className = 'isa-st-rowinfo';

      const label = document.createElement('span');
      label.className = 'isa-st-rowlabel';
      label.textContent = `${tab.title || 'tab'} · ${tab.url || '(no url)'}`;
      info.appendChild(label);

      const status = document.createElement('span');
      status.className = tab.injected ? 'isa-st-rowstatus isa-st-rowstatus--ok' : 'isa-st-rowstatus isa-st-rowstatus--bad';
      status.textContent = tab.injected
        ? 'extension loaded'
        : `not loaded: ${tab.notInjected ? 'reload this tab' : tab.error || 'no reply'}`;
      info.appendChild(status);
      row.appendChild(info);

      const download = document.createElement('button');
      download.type = 'button';
      download.className = 'isa-st-btn';
      download.dataset.isaRow = 'download';
      download.textContent = 'Download';
      row.appendChild(download);
      result.appendChild(row);

      download.addEventListener('click', () => {
        saveFromTab(tab, download, status);
      });
    };

    const renderHealth = (health) => {
      const extension = health.extension || {};
      const browser = health.browser || {};
      appendLines(result, [
        ['Build', extension.version || 'unknown'],
        ['Chrome', browser.chromeVersion || 'unknown'],
        [
          'Notifications',
          health.notificationLevel || 'unknown',
          health.notificationLevel === 'granted' ? 'ok' : 'bad'
        ],
        ['Supported tabs open', String((health.tabs || []).length)]
      ]);

      if (health.tabsError) appendNote(result, `Could not list tabs: ${health.tabsError}`, true);
      const tabs = Array.isArray(health.tabs) ? health.tabs : [];
      if (!tabs.length) appendNote(result, 'No Intercom tab is open.', false);
      else tabs.forEach(renderTabRow);
    };

    check.addEventListener('click', async () => {
      check.disabled = true;
      check.textContent = 'Checking...';
      result.textContent = '';

      const response = await sendBackgroundMessage({ type: 'support-health' });
      check.disabled = false;
      check.textContent = 'Check and list tabs';

      if (!response || !response.ok || !response.health) {
        appendNote(result, `Health check failed: ${failureText(response)}`, true);
        return;
      }
      renderHealth(response.health);
    });
  }

  function mountSettingsBackup(container) {
    if (!container || container.dataset.isaStMounted === 'true') return;
    const { body } = buildCard(container, 'Settings backup');

    body.innerHTML = `
      <div class="isa-st-actions">
        <button class="isa-st-btn isa-st-btn--primary" data-isa="export" type="button">Export settings</button>
        <button class="isa-st-btn" data-isa="import" type="button">Import settings</button>
        <input class="isa-st-file" data-isa="file" type="file" accept="application/json,.json" aria-hidden="true" tabindex="-1">
      </div>
      <p class="isa-st-summary" data-isa="summary" role="status" aria-live="polite">Saves your alert choices, sounds, and debug flags to a JSON file. Import merges that file over your current settings.</p>
      <p class="isa-st-hint">Unread baselines, the discovered inbox roster, and the channel directory are left out on purpose, because restoring a stale baseline changes which alerts fire.</p>
      <div data-isa="result"></div>
    `;

    const exportButton = body.querySelector('[data-isa="export"]');
    const importButton = body.querySelector('[data-isa="import"]');
    const file = body.querySelector('[data-isa="file"]');
    const summary = body.querySelector('[data-isa="summary"]');
    const result = body.querySelector('[data-isa="result"]');

    exportButton.addEventListener('click', async () => {
      exportButton.disabled = true;
      exportButton.textContent = 'Exporting...';
      result.textContent = '';

      const stored = await areaGet('local', null);
      exportButton.disabled = false;
      exportButton.textContent = 'Export settings';

      if (!stored.ok) {
        appendNote(result, `Could not read settings: ${stored.error}`, true);
        return;
      }

      const exportedAt = new Date().toISOString();
      const settings = pickBackupSettings(stored.items);
      const payload = {
        schema: BACKUP_SCHEMA,
        extensionVersion: extensionVersion(),
        exportedAt,
        skippedKeys: DERIVED_KEYS.slice(),
        settings
      };
      const filename = `isa-settings-${extensionVersion() || 'unknown'}-${fileStamp(exportedAt)}.json`;
      saveFile(filename, `${JSON.stringify(payload, null, 2)}\n`, 'application/json');
      summary.textContent = `Saved ${filename} with ${Object.keys(settings).length} settings.`;
    });

    importButton.addEventListener('click', () => {
      file.value = '';
      file.click();
    });

    const applyImport = async (text) => {
      result.textContent = '';

      let payload = null;
      try {
        payload = JSON.parse(text);
      } catch (error) {
        appendNote(result, 'That file is not valid JSON.', true);
        return;
      }

      if (!payload || typeof payload !== 'object' || typeof payload.schema !== 'number') {
        appendNote(result, 'That file is not an Intercom Support Assistant settings export.', true);
        return;
      }
      if (payload.schema > BACKUP_SCHEMA) {
        appendNote(result, `That file uses settings schema ${payload.schema}, and this build reads ${BACKUP_SCHEMA}. Update the extension first.`, true);
        return;
      }
      if (!payload.settings || typeof payload.settings !== 'object') {
        appendNote(result, 'That file carries no settings.', true);
        return;
      }

      const applied = {};
      const rejected = [];
      const unknown = [];

      Object.keys(payload.settings).forEach((key) => {
        const known = BACKUP_KEYS.find(entry => entry.key === key);
        if (!known) {
          unknown.push(key);
          return;
        }
        const value = payload.settings[key];
        if (!validBackupValue(known.type, value)) {
          rejected.push(key);
          return;
        }
        applied[key] = value;
      });

      const names = Object.keys(applied);
      if (!names.length) {
        appendNote(result, 'Nothing in that file could be applied.', true);
        if (rejected.length) appendNote(result, `Wrong value type: ${rejected.join(', ')}.`, true);
        if (unknown.length) appendNote(result, `Not a setting this build knows: ${unknown.join(', ')}.`, false);
        return;
      }

      const written = await areaSet('local', applied);
      if (!written.ok) {
        appendNote(result, `Could not write settings: ${written.error}`, true);
        return;
      }

      summary.textContent = `Restored ${names.length} settings from ${payload.exportedAt || 'an export'}. Reload open Intercom tabs.`;
      appendNote(result, `Applied: ${names.join(', ')}.`, false);
      if (rejected.length) appendNote(result, `Skipped, wrong value type: ${rejected.join(', ')}.`, true);
      if (unknown.length) appendNote(result, `Skipped, not a setting this build knows: ${unknown.join(', ')}.`, false);
    };

    file.addEventListener('change', () => {
      const chosen = file.files && file.files[0];
      if (!chosen) return;

      const reader = new FileReader();
      reader.onload = () => {
        applyImport(String(reader.result || ''));
      };
      reader.onerror = () => {
        result.textContent = '';
        appendNote(result, 'Could not read that file.', true);
      };
      reader.readAsText(chosen);
    });
  }

  function mountDebugFlags(container) {
    if (!container || container.dataset.isaStMounted === 'true') return;
    const { body } = buildCard(container, 'Debug flags');

    body.innerHTML = `
      <p class="isa-st-summary" data-isa="summary" role="status" aria-live="polite">These flags only change what the extension writes to the page console. Reload the tab after a change.</p>
      <div data-isa="flags"></div>
    `;

    const summary = body.querySelector('[data-isa="summary"]');
    const flags = body.querySelector('[data-isa="flags"]');
    const inputs = new Map();

    DEBUG_FLAGS.forEach((flag) => {
      const row = document.createElement('label');
      row.className = 'isa-st-check';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.isaFlag = flag.key;
      input.disabled = true;
      row.appendChild(input);

      const text = document.createElement('span');
      text.textContent = flag.label;
      const hint = document.createElement('span');
      hint.className = 'isa-st-hint';
      hint.textContent = flag.hint;
      const stack = document.createElement('span');
      stack.className = 'isa-st-checktext';
      stack.appendChild(text);
      stack.appendChild(hint);
      row.appendChild(stack);

      flags.appendChild(row);
      inputs.set(flag.key, input);

      input.addEventListener('change', async () => {
        const next = input.checked;
        input.disabled = true;
        const written = await areaSet('local', { [flag.key]: next });
        input.disabled = false;
        if (written.ok) {
          summary.textContent = `${flag.label} is ${next ? 'on' : 'off'}.`;
          return;
        }
        input.checked = !next;
        summary.textContent = `Could not save ${flag.label}: ${written.error}`;
      });
    });

    areaGet('local', DEBUG_FLAGS.map(flag => flag.key)).then((stored) => {
      if (!stored.ok) {
        summary.textContent = `Could not read the flags: ${stored.error}`;
        return;
      }
      inputs.forEach((input, key) => {
        input.checked = stored.items[key] === true;
        input.disabled = false;
      });
    });

    try {
      if (chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area !== 'local') return;
          inputs.forEach((input, key) => {
            if (!Object.prototype.hasOwnProperty.call(changes, key)) return;
            input.checked = changes[key].newValue === true;
          });
        });
      }
    } catch (error) {}
  }

  function autoMount() {
    document.querySelectorAll('#isa-support-tools').forEach(mountCaptures);
    document.querySelectorAll('#isa-settings-backup').forEach(mountSettingsBackup);
    document.querySelectorAll('#isa-debug-flags').forEach(mountDebugFlags);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoMount);
  } else {
    autoMount();
  }

  window.ISA_SUPPORT_TOOLS = {
    mountCaptures,
    mountSettingsBackup,
    mountDebugFlags,
    collectContext,
    injectCaptureContext,
    buildCoverage,
    pickBackupSettings,
    validBackupValue,
    backupKeys: BACKUP_KEYS,
    derivedKeys: DERIVED_KEYS,
    contextSchema: CONTEXT_SCHEMA,
    backupSchema: BACKUP_SCHEMA,
    contextMetaId: CONTEXT_META_ID
  };
})();
