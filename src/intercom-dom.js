const OWN_NODE_ATTRIBUTE = 'data-isa-own';

function createOwnElement(tagName) {
  const element = document.createElement(tagName);
  element.setAttribute(OWN_NODE_ATTRIBUTE, '');
  return element;
}

let cachedIntercomShadowRoot = null;

function intercomShadowRoot() {
  const host = cachedIntercomShadowRoot && cachedIntercomShadowRoot.host;
  if (host && host.isConnected) return cachedIntercomShadowRoot;
  cachedIntercomShadowRoot = document.querySelector('#teammate-app-react')?.shadowRoot || null;
  return cachedIntercomShadowRoot;
}

function getIntercomRoots() {
  const shadowRoot = intercomShadowRoot();
  return shadowRoot ? [shadowRoot, document] : [document];
}

function injectStyleOnce(styleId, css, shadowCss = css) {
  if (document.head && !document.getElementById(styleId)) {
    const style = createOwnElement('style');
    style.id = styleId;
    style.textContent = css;
    document.head.appendChild(style);
  }

  const shadowRoot = intercomShadowRoot();
  if (shadowRoot && !shadowRoot.querySelector(`#${styleId}`)) {
    const style = createOwnElement('style');
    style.id = styleId;
    style.textContent = shadowCss;
    shadowRoot.appendChild(style);
  }
}

function getIntercomRoot() {
  return getIntercomRoots()[0];
}

function queryIntercom(selector) {
  for (const root of getIntercomRoots()) {
    const match = root.querySelector(selector);
    if (match) return match;
  }
  return null;
}

function queryAllIntercom(selector) {
  return [...new Set(getIntercomRoots().flatMap(root => [...root.querySelectorAll(selector)]))];
}

function detectAnchorView() {
  if (isNewConversationView()) return 'new-conversation';
  if (getConversationId()) return 'conversation';
  if (/\/inbox\//.test(window.location.pathname)) return 'inbox-list';
  return 'other';
}

function countIn(root, selector) {
  if (!root) return 0;
  return root.querySelectorAll(selector).length;
}

function anchorSelectorReport(key) {
  const selector = SELECTORS[key];
  const report = { key, selector: selector || null, inShadow: 0, inDocument: 0, count: 0, valid: true };
  if (!selector) {
    report.valid = false;
    return report;
  }

  try {
    report.inShadow = countIn(intercomShadowRoot(), selector);
    report.inDocument = countIn(document, selector);
    report.count = report.inShadow + report.inDocument;
  } catch (error) {
    report.valid = false;
  }

  return report;
}

function getConversationStream() {
  return queryIntercom(SELECTORS.conversationSpace) ||
    queryIntercom(SELECTORS.conversationStreamFallback) ||
    queryIntercom(SELECTORS.reactConversationStream);
}

function candidateScopes() {
  const surface = getConversationStream();
  return surface ? [surface] : getIntercomRoots();
}

function collectAnchorCandidates() {
  const scopes = candidateScopes();
  const collected = {};

  CANDIDATE_ATTRIBUTES.forEach(({ key, attribute, selector }) => {
    const values = new Set();
    scopes.forEach((scope) => {
      [...scope.querySelectorAll(selector)].forEach((element) => {
        const value = (element.getAttribute(attribute) || '').trim();
        if (value) values.add(value);
      });
    });
    collected[key] = [...values].sort().slice(0, CANDIDATE_LIMIT);
  });

  return collected;
}

const ANCHOR_BACKUPS = {
  rowLabel: () => getAttributeRows().some(row => getRowLabel(row))
};

const ANCHOR_PROBES = {
  escalationStatus: () => {
    if (findAttributeRowByLabel(FIELD_LABELS.escalationStatus)) return 'ok';
    const network = typeof resolveNetworkEscalationInProgress === 'function'
      ? resolveNetworkEscalationInProgress(getConversationId())
      : null;
    return network === null ? 'absent' : 'degraded';
  }
};

function anchorAppliesToView(anchor, view) {
  if (view === 'other') return false;
  if (anchor.views === 'any') return true;
  if (Array.isArray(anchor.views)) return anchor.views.includes(view);
  return anchor.views === view;
}

function buildTruncatedPanelReport() {
  return TRUNCATABLE_PANELS.map((panel) => {
    const seeAllPresent = Boolean(queryIntercom(panel.seeAll));
    const fields = panel.fields.map((field) => {
      const label = FIELD_LABELS[field];
      const rendered = Boolean(findAttributeRowByLabel(label));
      return { field, label, rendered, hiddenBehindSeeAll: seeAllPresent && !rendered };
    });
    return { id: panel.id, label: panel.label, seeAllPresent, fields };
  });
}

function buildAnchorHealthReport() {
  const view = detectAnchorView();
  const anchors = CRITICAL_ANCHORS.map((anchor) => {
    const selectors = anchor.selectors.map(anchorSelectorReport);
    const expected = anchorAppliesToView(anchor, view) && !anchor.transient;
    const resolved = selectors.some(entry => entry.valid && entry.count > 0);
    let status = 'skipped';
    if (anchor.probe) status = expected ? ANCHOR_PROBES[anchor.probe]() : 'skipped';
    else if (expected) status = resolved ? 'ok' : 'missing';
    else if (resolved) status = 'ok';

    if (status === 'missing' && anchor.backup && ANCHOR_BACKUPS[anchor.backup]()) status = 'degraded';

    let absentEvidence = null;
    if (status === 'missing' && anchor.absentWhen) {
      const evidence = anchorSelectorReport(anchor.absentWhen);
      if (evidence.valid && evidence.count > 0) {
        status = 'absent';
        absentEvidence = evidence;
      }
    }

    return {
      id: anchor.id,
      label: anchor.label,
      feature: anchor.feature,
      transient: Boolean(anchor.transient),
      expected,
      status,
      absentEvidence,
      selectors
    };
  });

  const expectedAnchors = anchors.filter(entry => entry.expected);
  const anyMissing = anchors.some(entry => entry.status === 'missing');

  return {
    ok: true,
    candidates: anyMissing ? collectAnchorCandidates() : null,
    version: ANCHOR_HEALTH_VERSION,
    url: window.location.href,
    view,
    shadowRootPresent: Boolean(intercomShadowRoot()),
    conversationId: getConversationId(),
    checkedAt: new Date().toISOString(),
    anchors,
    truncatedPanels: buildTruncatedPanelReport(),
    summary: {
      expected: expectedAnchors.length,
      ok: anchors.filter(entry => entry.status === 'ok').length,
      missing: anchors.filter(entry => entry.status === 'missing').length,
      absent: anchors.filter(entry => entry.status === 'absent').length,
      degraded: anchors.filter(entry => entry.status === 'degraded').length,
      skipped: anchors.filter(entry => entry.status === 'skipped').length
    }
  };
}

function parseTeamDirectory(payload) {
  const teams = [];
  for (const team of Array.isArray(payload?.teams) ? payload.teams : []) {
    if (teams.length >= TEAM_DIRECTORY_MAX_ENTRIES) break;
    if (!team || typeof team !== 'object' || team.is_redacted === true) continue;
    const id = String(team.id ?? '');
    const name = typeof team.name === 'string' ? team.name.trim() : '';
    if (!/^\d{1,20}$/.test(id) || !name || name.length > TEAM_DIRECTORY_MAX_NAME_CHARS || /[\u0000-\u001f]/.test(name)) continue;
    teams.push({ id, name });
  }
  return teams;
}

async function fetchTeamDirectory() {
  const match = String(window.location.pathname).match(/^\/a\/(?:inbox\/([A-Za-z0-9_-]{1,64})\/inbox|apps\/([A-Za-z0-9_-]{1,64}))(?:\/|$)/);
  const workspace = match && (match[1] || match[2]);
  if (!workspace) return { error: 'no-workspace' };
  const url = new URL(TEAM_DIRECTORY_PATH, window.location.origin);
  url.searchParams.set('app_id', workspace);
  const headers = { Accept: 'application/json' };
  const csrf = document.querySelector('meta[name="csrf-token"]');
  if (csrf && csrf.content) headers['X-CSRF-Token'] = csrf.content;
  try {
    const response = await fetch(url.toString(), {
      credentials: 'same-origin',
      cache: 'no-store',
      headers,
      signal: AbortSignal.timeout(TEAM_DIRECTORY_TIMEOUT_MS)
    });
    if (!response.ok) return { error: `http-${response.status}` };
    const text = await response.text();
    if (text.length > TEAM_DIRECTORY_MAX_CHARS) return { error: 'too-large' };
    const teams = parseTeamDirectory(JSON.parse(text));
    return teams.length ? { observedAt: new Date().toISOString(), teams } : { error: 'no-teams' };
  } catch (error) {
    return { error: error && error.name === 'TimeoutError' ? 'timeout' : 'request-failed' };
  }
}

function buildDomCapture(teamDirectory) {
  if (!window.ISA_DOM_CAPTURE) return { ok: false, error: 'capture-unavailable', url: window.location.href };
  return window.ISA_DOM_CAPTURE.buildCapture({
    surface: 'intercom',
    conversationId: getConversationId(),
    view: detectAnchorView(),
    shadowRootPresent: Boolean(intercomShadowRoot()),
    anchorHealth: buildAnchorHealthReport(),
    teamDirectory
  });
}

function handleDomCaptureMessage(message, sender, sendResponse) {
  if (!message || message.type !== DOM_CAPTURE_MESSAGE) return false;

  const fallback = { ok: false, error: 'capture-failed', url: window.location.href };
  fetchTeamDirectory().then((teamDirectory) => {
    sendResponse(safeExecute(() => buildDomCapture(teamDirectory), 'buildDomCapture', fallback));
  });
  return true;
}
