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
    if (expected) status = resolved ? 'ok' : 'missing';
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

function buildDomCapture() {
  if (!window.ISA_DOM_CAPTURE) return { ok: false, error: 'capture-unavailable', url: window.location.href };
  return window.ISA_DOM_CAPTURE.buildCapture({
    surface: 'intercom',
    conversationId: getConversationId(),
    view: detectAnchorView(),
    shadowRootPresent: Boolean(intercomShadowRoot()),
    anchorHealth: buildAnchorHealthReport(),
    teamDirectory: typeof teamDirectorySnapshot === 'function' ? teamDirectorySnapshot() : null
  });
}

function handleDomCaptureMessage(message, sender, sendResponse) {
  if (!message || message.type !== DOM_CAPTURE_MESSAGE) return false;

  const fallback = { ok: false, error: 'capture-failed', url: window.location.href };
  sendResponse(safeExecute(buildDomCapture, 'buildDomCapture', fallback));
  return false;
}
