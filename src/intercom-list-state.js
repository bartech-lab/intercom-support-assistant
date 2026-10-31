function computeConversationListRows() {
  const containers = queryAllIntercom(SELECTORS.conversationListContainer);
  if (!containers.length) return [];
  const rows = [];
  const seen = new Set();
  containers.forEach((container) => {
    container.querySelectorAll(SELECTORS.conversationListRow).forEach((row) => {
      if (seen.has(row)) return;
      seen.add(row);
      rows.push(row);
    });
  });
  return rows;
}

function conversationListRows() {
  return passCached('conversationListRows', computeConversationListRows);
}

const DUPLICATE_OPEN_STATE_TOKEN = 'open';
const CONVERSATION_LIST_CLOSED_STATE_TOKENS = ['closed', 'snoozed', 'all'];

var listStateClock = () => Date.now();
let listStateSettleTimer = null;

function scheduleListStateSettleRefresh() {
  if (listStateSettleTimer || typeof setTimeout !== 'function') return;
  listStateSettleTimer = setTimeout(() => {
    listStateSettleTimer = null;
    safeExecute(refreshDuplicateCustomerHighlights, 'listStateSettleRefresh duplicates');
    safeExecute(refreshSupportOriginHighlights, 'listStateSettleRefresh supportOrigin');
  }, TIMING.listStateGraceMs);
}

function conversationListStateTokens() {
  const control = queryIntercom(SELECTORS.conversationListStateFilter);
  if (!control) return null;
  const words = (control.textContent || '')
    .replace(/[\d., ]+/g, ' ')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return words.length ? words : null;
}

function conversationListStateFromDisplayText() {
  const tokens = conversationListStateTokens();
  if (!tokens) return null;
  if (tokens.includes(DUPLICATE_OPEN_STATE_TOKEN)) return true;
  if (tokens.some(token => CONVERSATION_LIST_CLOSED_STATE_TOKENS.includes(token))) return false;
  return null;
}

function unknownListStateHasSettled() {
  const key = currentInboxStateKey() || 'unknown';
  const firstSeen = listStateUnknownSince.get(key);
  if (firstSeen === undefined) {
    listStateUnknownSince.set(key, listStateClock());
    scheduleListStateSettleRefresh();
    return false;
  }
  return listStateClock() - firstSeen >= TIMING.listStateGraceMs;
}

const LIST_VERDICT_OPEN = 'open';
const LIST_VERDICT_OTHER = 'other';
const LIST_VERDICT_UNKNOWN = 'unknown';

function computeConversationListVerdict() {
  if (listRowsStillShowThePreviousState()) return LIST_VERDICT_OTHER;

  const networkState = networkListStateForCurrentInbox();
  if (networkState) {
    return networkState === DUPLICATE_OPEN_STATE_TOKEN ? LIST_VERDICT_OPEN : LIST_VERDICT_OTHER;
  }

  const displayState = conversationListStateFromDisplayText();
  if (displayState !== null) return displayState ? LIST_VERDICT_OPEN : LIST_VERDICT_OTHER;

  return unknownListStateHasSettled() ? LIST_VERDICT_OPEN : LIST_VERDICT_UNKNOWN;
}

function conversationListVerdict() {
  return passCached('conversationListVerdict', computeConversationListVerdict);
}

function conversationListShowsOpenOnly() {
  return conversationListVerdict() === LIST_VERDICT_OPEN;
}
