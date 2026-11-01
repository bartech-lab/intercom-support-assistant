const IN_PROGRESS_HIGHLIGHT_CSS = `
    .${IN_PROGRESS_HIGHLIGHT_CLASS} {
      background-color: #fee2e2 !important;
      border: 2px solid #ef4444 !important;
      box-shadow: 0 0 10px rgba(239, 68, 68, 0.6) !important;
      transition: all 0.2s ease-in-out;
    }
  `;

const IN_PROGRESS_DOCUMENT_CSS = `${IN_PROGRESS_HIGHLIGHT_CSS}
    html.${ASSIGN_SUPPRESS_CLASS} [data-intercom-target-action-menu="assign-to"],
    html.${ASSIGN_SUPPRESS_CLASS} [data-command-palette] {
      opacity: 0 !important;
      transition: none !important;
    }
  `;

function injectInProgressHighlightStyle() {
  injectStyleOnce(IN_PROGRESS_STYLE_ID, IN_PROGRESS_DOCUMENT_CSS, IN_PROGRESS_HIGHLIGHT_CSS);
}

function isInProgressStatus() {
  const statusRow = findAttributeRowByLabel(FIELD_LABELS.escalationStatus);
  if (statusRow) {
    const valueCell = statusRow.querySelector('.w-3\\/5') || statusRow.querySelector(SELECTORS.attributeValue);
    const valueText = (valueCell || statusRow).textContent;
    return valueText.toLowerCase().includes('in progress');
  }

  const conversationId = typeof getConversationId === 'function' ? getConversationId() : null;
  const networkInProgress = typeof resolveNetworkEscalationInProgress === 'function'
    ? resolveNetworkEscalationInProgress(conversationId)
    : null;
  if (networkInProgress !== null) return networkInProgress;

  const section = getSidebarSection();
  if (!section) return false;

  return [...section.querySelectorAll(SELECTORS.inProgressStatusText)]
    .some(element => {
      const row = getAttributeRows().find(candidate => candidate.contains(element));
      if (row && rowLabelMatches(row, 'Handed to')) return false;
      return element.textContent.trim().toLowerCase() === 'in progress';
    });
}

function getActionButtonByIcon(iconSelector) {
  const icon = queryIntercom(iconSelector);
  return icon ? icon.closest('button') : null;
}

function getCloseConversationButton() {
  const modernButton = queryAllIntercom(SELECTORS.conversationHeader)
    .map(header => header.querySelector(SELECTORS.modernCloseButton))
    .find(Boolean);
  if (modernButton) return modernButton;

  const iconButton = getActionButtonByIcon(SELECTORS.closeConversationIcon);
  if (iconButton) return iconButton;

  const toolbar = queryIntercom(SELECTORS.conversationToolbar);
  if (!toolbar) return null;

  return [...toolbar.querySelectorAll('button')]
    .find(button => button.textContent.trim() === 'Close') || null;
}

function getInProgressActionButtons() {
  return [
    getCloseConversationButton(),
    getActionButtonByIcon(SELECTORS.snoozeIcon),
    getActionButtonByIcon(SELECTORS.reopenConversationIcon),
    queryIntercom(SELECTORS.modernReopenButton)
  ].filter(Boolean);
}

function refreshInProgressActionHighlights() {
  safeExecute(() => {
    injectInProgressHighlightStyle();
    queryAllIntercom(`.${IN_PROGRESS_HIGHLIGHT_CLASS}`).forEach(element => {
      element.classList.remove(IN_PROGRESS_HIGHLIGHT_CLASS);
    });

    if (!isInProgressStatus()) return;

    getInProgressActionButtons().forEach(button => {
      button.classList.add(IN_PROGRESS_HIGHLIGHT_CLASS);
    });
  }, 'refreshInProgressActionHighlights');
}

function getEventButton(event) {
  const path = event.composedPath ? event.composedPath() : [];
  const candidates = path.length ? path : [event.target];

  for (const candidate of candidates) {
    if (!candidate || candidate.nodeType !== Node.ELEMENT_NODE) continue;
    if (candidate.matches?.('button')) return candidate;

    const closestButton = candidate.closest?.('button');
    if (closestButton) return closestButton;
  }

  return null;
}

function isCloseConversationButton(button) {
  if (!button) return false;
  if (button.matches?.(SELECTORS.modernCloseButton) &&
      button.closest?.(SELECTORS.conversationHeader)) return true;
  if (button.querySelector(SELECTORS.closeConversationIcon)) return true;

  return button.textContent.trim() === 'Close' &&
    Boolean(button.closest(SELECTORS.conversationToolbar));
}

function collectPartLinkUrls(partElement) {
  const urls = [...partElement.querySelectorAll('a[href]')].map(anchor => anchor.getAttribute('href'));
  const textUrls = partElement.textContent.match(/https?:\/\/\S+/gi);
  if (textUrls) urls.push(...textUrls);
  return urls;
}

function getLastConversationPart() {
  const space = getConversationStream();
  if (!space) return null;

  const anchors = [
    ...[...space.querySelectorAll(SELECTORS.customerMessageBlocks)].map(el => ({ type: 'customer', el })),
    ...[...space.querySelectorAll(SELECTORS.agentReplyPart)].map(el => ({ type: 'agent', el })),
    ...[...space.querySelectorAll(SELECTORS.noteEditAction)].map(el => ({ type: 'note', el }))
  ];
  if (!anchors.length) return null;

  return anchors.reduce((last, anchor) =>
    (last.el.compareDocumentPosition(anchor.el) & Node.DOCUMENT_POSITION_FOLLOWING) ? anchor : last);
}

function getNoteBodyForAction(actionElement) {
  let node = actionElement.parentElement;
  for (let depth = 0; node && depth < 10; depth++, node = node.parentElement) {
    const body = node.querySelector(SELECTORS.partContentHtml);
    if (body) return body;
  }
  return null;
}

function isLastPartUnresolvedNote() {
  const lastPart = getLastConversationPart();
  if (!lastPart || lastPart.type !== 'note') return false;

  const body = getNoteBodyForAction(lastPart.el);
  if (!body) return false;

  return collectPartLinkUrls(body).some(url => TRACKER_LINK_PATTERN.test(url));
}

function getCloseBlockMessage() {
  if (isInProgressStatus()) return IN_PROGRESS_BLOCK_MESSAGE;
  if (isLastPartUnresolvedNote()) return NOTE_LINK_BLOCK_MESSAGE;
  return null;
}

function handleCloseGuardClick(event) {
  safeExecute(() => {
    const button = getEventButton(event);
    if (!isCloseConversationButton(button)) return;

    const message = getCloseBlockMessage();
    if (!message) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    window.alert(message);
  }, 'handleCloseGuardClick');
}
