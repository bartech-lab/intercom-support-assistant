safeExecute(injectInProgressHighlightStyle, 'Initial injectInProgressHighlightStyle');
runWithPassCache(() => {
  safeExecute(refreshInProgressActionHighlights, 'Initial refreshInProgressActionHighlights');
  safeExecute(refreshMultiRecipientEmailHighlights, 'Initial refreshMultiRecipientEmailHighlights');
  safeExecute(refreshDuplicateCustomerHighlights, 'Initial refreshDuplicateCustomerHighlights');
  safeExecute(refreshSupportOriginHighlights, 'Initial refreshSupportOriginHighlights');
  safeExecute(refreshComposerLanguageState, 'Initial refreshComposerLanguageState');
  safeExecute(refreshIntercomAttachments, 'Initial refreshIntercomAttachments');
});

function handleConversationChange() {
  safeExecute(() => {
    const newConversationId = getConversationId();

    if (newConversationId !== currentConversationId) {
      debugLog(`[Conversation Change] Changed from ${currentConversationId} to ${newConversationId}`);
      issuedSupportWarnings.clear();
      currentConversationId = newConversationId;
      conversationManualLanguage = null;
      lastInsertedSignature = null;
      refreshIntercomAttachments();

      runWithPassCache(() => {
        refreshInProgressActionHighlights();
        refreshMultiRecipientEmailHighlights();
        refreshDuplicateCustomerHighlights();
        refreshSupportOriginHighlights();
      });
    }
  }, 'handleConversationChange');
}

let lastMutationTime = 0;
let alertTrailingTimer = null;
let multiRecipientTrailingTimer = null;
var passClock = () => Date.now();

let lastFullPassTime = passClock();

function isOwnInjectedNode(node) {
  if (!node) return false;
  if (node.nodeType === 3) return isOwnInjectedNode(node.parentElement);
  if (node.nodeType !== 1) return false;
  return typeof node.hasAttribute === 'function' && node.hasAttribute(OWN_NODE_ATTRIBUTE);
}

function everyNodeIsOwn(nodeList) {
  for (const node of nodeList) {
    if (!isOwnInjectedNode(node)) return false;
  }
  return true;
}

function isSelfInflictedRecord(record) {
  if (record.type === 'characterData') return isOwnInjectedNode(record.target);
  if (record.type !== 'childList') return false;
  if (record.removedNodes.length) return false;
  if (!record.addedNodes.length) return false;
  return everyNodeIsOwn(record.addedNodes);
}

function isDecorationStripRecord(record) {
  if (record.type !== 'attributes' || record.attributeName !== 'class') return false;
  const element = record.target;
  if (!element || element.nodeType !== 1 || !element.classList) return false;

  if (element.hasAttribute(DUPLICATE_GROUP_ATTRIBUTE)
    && !element.classList.contains(DUPLICATE_ROW_CLASS)) return true;
  return element.hasAttribute(SUPPORT_ORIGIN_ATTRIBUTE)
    && !element.classList.contains(SUPPORT_ORIGIN_ROW_CLASS);
}

function isComposerTextRecord(record) {
  if (record.type !== 'characterData') return false;
  const element = record.target.nodeType === 3 ? record.target.parentElement : record.target;
  if (!element || typeof element.closest !== 'function') return false;
  return Boolean(element.closest(SELECTORS.composerContainer)
    || element.closest(SELECTORS.composerContainerFallback));
}

function mutationsNeedRowPasses(mutations) {
  if (!mutations || !mutations.length) return true;
  for (const record of mutations) {
    if (record.type === 'attributes') {
      if (isDecorationStripRecord(record)) return true;
      continue;
    }
    if (isSelfInflictedRecord(record)) continue;
    if (isComposerTextRecord(record)) continue;
    return true;
  }
  return false;
}

function passesAreRelevant(mutations) {
  return safeExecute(() => {
    if (passClock() - lastFullPassTime >= TIMING.passHeartbeatMs) return true;
    return mutationsNeedRowPasses(mutations);
  }, 'passesAreRelevant', true);
}

const observer = new MutationObserver((mutations) => {
  const relevant = passesAreRelevant(mutations);

  syncIntercomShadowObserver();
  safeExecute(injectInProgressHighlightStyle, 'MutationObserver injectInProgressHighlightStyle');
  safeExecute(handleConversationChange, 'MutationObserver handleConversationChange');

  if (!relevant) return;

  if (Date.now() - lastMutationTime >= TIMING.mutationThrottleMs) {
    lastFullPassTime = passClock();
    runWithPassCache(() => {
      safeExecute(refreshInProgressActionHighlights, 'MutationObserver refreshInProgressActionHighlights');
      safeExecute(refreshMultiRecipientEmailHighlights, 'MutationObserver refreshMultiRecipientEmailHighlights');
      safeExecute(refreshDuplicateCustomerHighlights, 'MutationObserver refreshDuplicateCustomerHighlights');
      safeExecute(refreshSupportOriginHighlights, 'MutationObserver refreshSupportOriginHighlights');
      safeExecute(syncTeamInboxFromSender, 'MutationObserver syncTeamInboxFromSender');
      safeExecute(refreshComposerLanguageState, 'MutationObserver refreshComposerLanguageState');
      safeExecute(refreshIntercomAttachments, 'MutationObserver refreshIntercomAttachments');
      safeExecute(refreshTemporaryNoteControls, 'MutationObserver refreshTemporaryNoteControls');
      safeExecute(refreshTemporaryNoteFooters, 'MutationObserver refreshTemporaryNoteFooters');
      safeExecute(refreshTemporaryNoteCleanupContext, 'MutationObserver refreshTemporaryNoteCleanupContext');
    });
    safeExecute(evaluateInboxAlerts, 'MutationObserver evaluateInboxAlerts');
    lastMutationTime = Date.now();
  } else if (typeof setTimeout === 'function') {
    if (!alertTrailingTimer) {
      alertTrailingTimer = setTimeout(() => {
        alertTrailingTimer = null;
        safeExecute(evaluateInboxAlerts, 'trailing evaluateInboxAlerts');
      }, TIMING.mutationThrottleMs);
    }

    if (multiRecipientTrailingTimer) clearTimeout(multiRecipientTrailingTimer);
    multiRecipientTrailingTimer = setTimeout(() => {
      multiRecipientTrailingTimer = null;
      lastFullPassTime = passClock();
      runWithPassCache(() => {
        safeExecute(refreshInProgressActionHighlights, 'trailing refreshInProgressActionHighlights');
        safeExecute(refreshMultiRecipientEmailHighlights, 'trailing refreshMultiRecipientEmailHighlights');
        safeExecute(refreshDuplicateCustomerHighlights, 'trailing refreshDuplicateCustomerHighlights');
        safeExecute(refreshSupportOriginHighlights, 'trailing refreshSupportOriginHighlights');
        safeExecute(refreshComposerLanguageState, 'trailing refreshComposerLanguageState');
        safeExecute(refreshIntercomAttachments, 'trailing refreshIntercomAttachments');
        safeExecute(refreshTemporaryNoteControls, 'trailing refreshTemporaryNoteControls');
        safeExecute(refreshTemporaryNoteFooters, 'trailing refreshTemporaryNoteFooters');
        safeExecute(refreshTemporaryNoteCleanupContext, 'trailing refreshTemporaryNoteCleanupContext');
      });
    }, TIMING.mutationThrottleMs);
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true,
  attributes: true,
  attributeFilter: ['class']
});

let observedIntercomShadowRoot = null;
function syncIntercomShadowObserver() {
  const shadowRoot = intercomShadowRoot();
  if (shadowRoot === observedIntercomShadowRoot) return;

  observer.disconnect();
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class']
  });
  if (shadowRoot) {
    observer.observe(shadowRoot, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class']
    });
  }
  observedIntercomShadowRoot = shadowRoot;
}

syncIntercomShadowObserver();

window.addEventListener('popstate', handleConversationChange);

handleConversationChange();

function initCaptureListener() {
  if (!alertRuntimeAlive()) return;
  if (!chrome.runtime.onMessage || typeof chrome.runtime.onMessage.addListener !== 'function') return;
  chrome.runtime.onMessage.addListener(handleDomCaptureMessage);
}

safeExecute(initTemporaryNoteControls, 'initTemporaryNoteControls');
safeExecute(initTemporaryNoteCleanup, 'initTemporaryNoteCleanup');
safeExecute(initIntercomBridge, 'initIntercomBridge');
safeExecute(initCaptureListener, 'initCaptureListener');
safeExecute(initAlertSettingsSync, 'initAlertSettingsSync');
document.addEventListener('visibilitychange', () =>
  safeExecute(evaluateInboxAlerts, 'visibilitychange evaluateInboxAlerts'));
safeExecute(evaluateInboxAlerts, 'initial evaluateInboxAlerts');

document.addEventListener('click', handleCloseGuardClick, true);
document.addEventListener('click', handleSenderOptionClick, true);
document.addEventListener('click', handleSignatureInsertion);
document.addEventListener('pointerdown', preventComposerMiddleClickPaste, true);
document.addEventListener('mousedown', preventComposerMiddleClickPaste, true);
document.addEventListener('mouseup', preventComposerMiddleClickPaste, true);
document.addEventListener('auxclick', preventComposerMiddleClickPaste, true);
document.addEventListener('beforeinput', preventComposerMiddleClickInput, true);
document.addEventListener('paste', preventComposerMiddleClickPasteEvent, true);

document.addEventListener('auxclick', (event) => {
  if (event.button === 1) {
    const link = event.composedPath().find(node => node instanceof Element && node.matches('a'));
    if (link && link.href && link.closest('[data-original-user-id]')) {
      event.preventDefault();
      window.open(link.href, '_blank');
    }
  }
});
