const ALERT_STORAGE_KEYS = {
  enabled: 'isaAlertEnabled',
  inboxes: 'isaAlertEnabledInboxes',
  roster: 'isaAlertRoster',
  sound: 'isaAlertSound',
  lastSeen: 'isaAlertLastSeen',
  debug: 'isaAlertDebug',
  yourInbox: 'isaAlertYourInbox'
};
const DEBUG_STORAGE_KEY = 'isaDebug';
const ALERT_BLINK_MS = 800;
const ALERT_TITLE_MARKER = '🔴 ';
const ALERT_YOUR_INBOX_ID = 'your-inbox';
const ALERT_YOUR_INBOX_LABEL = 'Your inbox';
const ALERT_ADMIN_FOLDER_LINK = /\/inbox\/admin\/\d+(?:\?|$)/;
const ALERT_ACTIVE_ADMIN_INBOX = /\/inbox\/admin\/\d+/;
const ALERT_DEFAULT_SOUND =
  (window.ISA_ALERT_SOUNDS && window.ISA_ALERT_SOUNDS.defaultId) || 'tritone';

const alertSettings = {
  enabled: false,
  enabledInboxes: [],
  yourInbox: true,
  sound: ALERT_DEFAULT_SOUND
};
let alertRoster = alertableInboxesSeed.map(inbox => ({
  teamId: String(inbox.teamId),
  label: inbox.label
}));

function mergeRoster(...sources) {
  const merged = new Map();
  sources.forEach((list) => {
    if (!Array.isArray(list)) return;
    list.forEach((entry) => {
      if (!entry || entry.teamId == null) return;
      const teamId = String(entry.teamId);
      if (retiredAlertInboxIds.includes(teamId)) return;
      merged.set(teamId, { teamId, label: String(entry.label || teamId) });
    });
  });
  return [...merged.values()];
}
let alertLastSeen = {};

let alertPendingCounts = {};
let alertSettleTimer = null;
var alertClock = () => Date.now();
let alertDebugEnabled = false;

function alertTrace(teamId, count, settled) {
  console.log('[isa-alert]', teamId, {
    count,
    settled,
    lastSeen: alertLastSeen[teamId],
    pending: alertPendingCounts[teamId]
  });
}

const alertVisuals = createAlertVisuals({
  titleMarker: ALERT_TITLE_MARKER,
  blinkMs: ALERT_BLINK_MS,
  runSafe: fn => safeExecute(fn, 'alertBlinkPulse'),
  collectActive: () => collectActiveInboxes(),
  summarize: activeList => ({
    text: activeList
      .map(item => `${alertShortLabel(alertRosterLabel(item.teamId))} (${item.count})`)
      .join(' · '),
    total: activeList.reduce((sum, item) => sum + item.count, 0)
  })
});

function alertBlinkPulse() {
  alertVisuals.pulse();
}

function alertStorageLocal() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return chrome.storage.local;
    }
  } catch (error) {}
  return null;
}

function alertRuntimeAlive() {
  return extensionRuntimeAlive();
}

function initAlertSettingsSync() {
  const storage = alertStorageLocal();
  if (!storage) return;

  storage.get(
    {
      [ALERT_STORAGE_KEYS.enabled]: false,
      [ALERT_STORAGE_KEYS.inboxes]: [],
      [ALERT_STORAGE_KEYS.sound]: ALERT_DEFAULT_SOUND,
      [ALERT_STORAGE_KEYS.lastSeen]: {},
      [ALERT_STORAGE_KEYS.roster]: null,
      [ALERT_STORAGE_KEYS.debug]: false,
      [ALERT_STORAGE_KEYS.yourInbox]: true,
      [DEBUG_STORAGE_KEY]: false
    },
    (result) => {
      debugEnabled = Boolean(result[DEBUG_STORAGE_KEY]);
      alertDebugEnabled = Boolean(result[ALERT_STORAGE_KEYS.debug]);
      alertSettings.enabled = Boolean(result[ALERT_STORAGE_KEYS.enabled]);
      alertSettings.yourInbox = result[ALERT_STORAGE_KEYS.yourInbox] !== false;
      alertSettings.enabledInboxes = Array.isArray(result[ALERT_STORAGE_KEYS.inboxes])
        ? result[ALERT_STORAGE_KEYS.inboxes].map(String)
        : [];
      alertSettings.sound = result[ALERT_STORAGE_KEYS.sound] || ALERT_DEFAULT_SOUND;
      alertLastSeen = normalizeLastSeen(result[ALERT_STORAGE_KEYS.lastSeen]);
      alertRoster = mergeRoster(alertRoster, result[ALERT_STORAGE_KEYS.roster]);
      safeExecute(evaluateInboxAlerts, 'initAlertSettingsSync evaluate');
    }
  );

  try {
    if (chrome.storage.onChanged && chrome.storage.onChanged.addListener) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !changes) return;
        let touched = false;
        if (changes[ALERT_STORAGE_KEYS.enabled]) {
          const wasEnabled = alertSettings.enabled;
          alertSettings.enabled = Boolean(changes[ALERT_STORAGE_KEYS.enabled].newValue);
          if (!wasEnabled && alertSettings.enabled) baselineInboxes(alertWatchedInboxIds());
          touched = true;
        }
        if (changes[ALERT_STORAGE_KEYS.yourInbox]) {
          const wasWatched = alertSettings.yourInbox;
          alertSettings.yourInbox = changes[ALERT_STORAGE_KEYS.yourInbox].newValue !== false;
          if (!wasWatched && alertSettings.yourInbox) baselineInboxes([ALERT_YOUR_INBOX_ID]);
          touched = true;
        }
        if (changes[ALERT_STORAGE_KEYS.inboxes]) {
          const next = changes[ALERT_STORAGE_KEYS.inboxes].newValue;
          const nextList = Array.isArray(next) ? next.map(String) : [];
          const added = nextList.filter(id => !alertSettings.enabledInboxes.includes(id));
          alertSettings.enabledInboxes = nextList;
          if (added.length) baselineInboxes(added);
          touched = true;
        }
        if (changes[ALERT_STORAGE_KEYS.sound]) {
          alertSettings.sound = changes[ALERT_STORAGE_KEYS.sound].newValue || ALERT_DEFAULT_SOUND;
        }
        if (changes[ALERT_STORAGE_KEYS.debug]) {
          alertDebugEnabled = Boolean(changes[ALERT_STORAGE_KEYS.debug].newValue);
        }
        if (changes[DEBUG_STORAGE_KEY]) {
          debugEnabled = Boolean(changes[DEBUG_STORAGE_KEY].newValue);
        }
        if (changes[ALERT_STORAGE_KEYS.lastSeen]) {
          alertLastSeen = normalizeLastSeen(changes[ALERT_STORAGE_KEYS.lastSeen].newValue);
        }
        if (touched) safeExecute(evaluateInboxAlerts, 'storage.onChanged evaluate');
      });
    }
  } catch (error) {}
}

function alertCollectTextPieces(root) {
  const pieces = [];
  (function walk(node) {
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        const text = (child.textContent || '').trim();
        if (text) pieces.push(text);
      } else if (child.nodeType === 1) {
        walk(child);
      }
    });
  })(root);
  return pieces;
}

const ALERT_COUNT_SEPARATORS = /[.,\u00a0\u202f\u2009\s]/g;
const ALERT_GROUPED_COUNT = /^\d{1,3}(?:[.,\u00a0\u202f\u2009\s]\d{3})+$/;

function alertParseCountPiece(piece) {
  if (/^\d+$/.test(piece)) return parseInt(piece, 10);
  if (!ALERT_GROUPED_COUNT.test(piece)) return null;
  return parseInt(piece.replace(ALERT_COUNT_SEPARATORS, ''), 10);
}

function alertReadNavLink(link) {
  const pieces = alertCollectTextPieces(link);
  let count = 0;
  let countFound = false;
  const labelParts = [];
  pieces.forEach((piece) => {
    const parsed = alertParseCountPiece(piece);
    if (parsed === null) {
      labelParts.push(piece);
    } else {
      count = parsed;
      countFound = true;
    }
  });
  return { label: labelParts.join(' ').trim(), count, countFound };
}

const alertFolderTeamLinkPatterns = new Map();

function alertFolderTeamLinkPattern(teamId) {
  let pattern = alertFolderTeamLinkPatterns.get(teamId);
  if (!pattern) {
    pattern = new RegExp(`/inbox/team/${teamId}(?:\\?|$)`);
    alertFolderTeamLinkPatterns.set(teamId, pattern);
  }
  return pattern;
}

function alertIsFolderTeamLink(href, teamId) {
  return alertFolderTeamLinkPattern(teamId).test(href || '');
}

function alertIsPinnedNavLink(link) {
  try {
    return Boolean(link.closest && link.closest(SELECTORS.yourInboxNavScope));
  } catch (error) {
    return false;
  }
}

function alertFilterYourInboxLinks(links) {
  return links.filter((link) => {
    if (alertIsPinnedNavLink(link)) return false;
    const href = link.getAttribute('href') || link.href || '';
    return ALERT_ADMIN_FOLDER_LINK.test(href);
  });
}

function alertFindYourInboxNavLinks() {
  const primary = alertFilterYourInboxLinks(queryAllIntercom(SELECTORS.yourInboxNavLink));
  if (primary.length) return primary;
  return alertFilterYourInboxLinks(
    queryAllIntercom('[data-intercom-target="inbox-left-nav"] a[href*="/inbox/admin/"]')
  );
}

function alertFindFolderNavLinks(teamId) {
  if (teamId === ALERT_YOUR_INBOX_ID) return alertFindYourInboxNavLinks();

  return queryAllIntercom(`a[href*="/inbox/team/${teamId}"]`).filter((link) => {
    const href = link.getAttribute('href') || link.href || '';
    return alertIsFolderTeamLink(href, teamId);
  });
}

function readInboxUnreadCount(teamId) {
  const readings = alertFindFolderNavLinks(teamId)
    .map(link => alertReadNavLink(link))
    .filter(reading => reading.countFound)
    .map(reading => reading.count);
  if (!readings.length) return null;
  return readings.every(count => count === readings[0]) ? readings[0] : null;
}

function alertRosterEquals(a, b) {
  if (a.length !== b.length) return false;
  const key = list => list.map(i => `${i.teamId}::${i.label}`).sort().join('|');
  return key(a) === key(b);
}

function discoverAlertInboxes() {
  const links = queryAllIntercom('a[href*="/inbox/team/"]');
  const discovered = [];
  links.forEach((link) => {
    const href = link.getAttribute('href') || link.href || '';
    const teamId = getTeamIdFromHref(href);
    if (!teamId || !alertIsFolderTeamLink(href, teamId)) return;
    const label = normalizeInboxText(alertReadNavLink(link).label);
    if (!label || !ALERT_INBOX_PATTERN.test(label)) return;
    discovered.push({ teamId, label });
  });

  const roster = mergeRoster(alertableInboxesSeed, alertRoster, discovered);
  if (!alertRosterEquals(roster, alertRoster)) {
    alertRoster = roster;
    const storage = alertStorageLocal();
    if (storage) {
      try { storage.set({ [ALERT_STORAGE_KEYS.roster]: roster }); } catch (error) {}
    }
  }
}

function alertRosterLabel(teamId) {
  if (teamId === ALERT_YOUR_INBOX_ID) return ALERT_YOUR_INBOX_LABEL;
  const match = alertRoster.find(inbox => inbox.teamId === teamId);
  return match ? match.label : teamId;
}

function alertWatchedInboxIds() {
  const ids = alertSettings.enabledInboxes.slice();
  if (alertSettings.yourInbox) ids.unshift(ALERT_YOUR_INBOX_ID);
  return ids;
}

function alertShortLabel(label) {
  return (label || '').replace(ALERT_INBOX_PATTERN, '').trim() || label;
}

function playAlertSoundOnce() {
  try {
    if (window.ISA_ALERT_SOUNDS && typeof window.ISA_ALERT_SOUNDS.play === 'function') {
      window.ISA_ALERT_SOUNDS.play(alertSettings.sound);
    }
  } catch (error) {}
}

function sendInboxAlertNotification(teamId, count) {
  if (!alertRuntimeAlive()) return;
  try {
    chrome.runtime.sendMessage({
      type: 'inbox-alert',
      teamId,
      label: alertRosterLabel(teamId),
      count
    });
  } catch (error) {}
}

function normalizeLastSeen(value) {
  const out = {};
  if (value && typeof value === 'object') {
    Object.keys(value).forEach((teamId) => {
      const n = Number(value[teamId]);
      if (Number.isFinite(n)) out[String(teamId)] = n;
    });
  }
  return out;
}

function persistAlertLastSeen() {
  const storage = alertStorageLocal();
  if (!storage) return;
  try {
    storage.set({ [ALERT_STORAGE_KEYS.lastSeen]: alertLastSeen });
  } catch (error) {}
}

function alertNetworkInboxIdentity(teamId) {
  if (teamId !== ALERT_YOUR_INBOX_ID) {
    return { inboxType: 'team', inboxId: String(teamId) };
  }

  const ids = alertFindYourInboxNavLinks()
    .map(link => (link.getAttribute('href') || link.href || '').match(/\/inbox\/admin\/([A-Za-z0-9_-]+)(?:\?|$)/))
    .filter(Boolean)
    .map(match => match[1]);
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length !== 1) return null;
  return { inboxType: 'admin', inboxId: uniqueIds[0] };
}

function logNetworkInboxCountDisagreement(teamId, domCount) {
  if (typeof networkInboxObservation !== 'function') return;
  const identity = alertNetworkInboxIdentity(teamId);
  if (!identity) return;
  const observation = networkInboxObservation(identity.inboxType, identity.inboxId);
  if (!observation || observation.count === domCount) return;
  debugLog(`[Alerts] inbox ${identity.inboxType}/${identity.inboxId}: nav count ${domCount} differs from network count ${observation.count}`);
}

function resolveAlertInboxCount(teamId) {
  const domCount = readInboxUnreadCount(teamId);
  if (domCount === null) return null;
  logNetworkInboxCountDisagreement(teamId, domCount);
  return domCount;
}

function baselineInboxes(teamIds) {
  let changed = false;
  (teamIds || []).forEach((rawTeamId) => {
    const teamId = String(rawTeamId);
    delete alertPendingCounts[teamId];
    const count = resolveAlertInboxCount(teamId);
    if (count === null) return;
    if (alertLastSeen[teamId] !== count) {
      alertLastSeen[teamId] = count;
      changed = true;
    }
  });
  if (changed) persistAlertLastSeen();
}

function scheduleAlertSettleRecheck() {
  if (alertSettleTimer) return;
  alertSettleTimer = setTimeout(() => {
    alertSettleTimer = null;
    safeExecute(evaluateInboxAlerts, 'alertSettleRecheck');
  }, TIMING.alertSettleMs);
}

function markInboxUnreadable(teamId) {
  const pending = alertPendingCounts[teamId];
  alertPendingCounts[teamId] = {
    count: null,
    since: alertClock(),
    afterUnreadable: pending ? pending.afterUnreadable : false
  };
}

function resolveSettledCount(teamId, count) {
  const pending = alertPendingCounts[teamId];
  const now = alertClock();

  if (!pending || pending.count !== count) {
    alertPendingCounts[teamId] = {
      count,
      since: now,
      afterUnreadable: Boolean(pending && pending.count === null)
    };
    scheduleAlertSettleRecheck();
    return null;
  }

  if (now - pending.since < TIMING.alertSettleMs) {
    scheduleAlertSettleRecheck();
    return null;
  }

  return { count, afterUnreadable: pending.afterUnreadable };
}

function evaluateInboxAlerts() {
  discoverAlertInboxes();

  if (!alertSettings.enabled) {
    clearAllInboxAlerts();
    return;
  }

  const risingInboxes = [];
  let seenChanged = false;

  alertWatchedInboxIds().forEach((rawTeamId) => {
    const teamId = String(rawTeamId);
    const count = resolveAlertInboxCount(teamId);
    if (count === null) {
      markInboxUnreadable(teamId);
      if (alertDebugEnabled) alertTrace(teamId, null, null);
      return;
    }

    const settled = resolveSettledCount(teamId, count);
    if (alertDebugEnabled) alertTrace(teamId, count, settled && settled.count);
    if (!settled) return;

    const hasBaseline = Object.prototype.hasOwnProperty.call(alertLastSeen, teamId);
    const silentBaseline = !hasBaseline || settled.afterUnreadable;
    const prevSeen = silentBaseline ? settled.count : alertLastSeen[teamId];

    if (settled.count > prevSeen) risingInboxes.push({ teamId, count: settled.count });

    if (!hasBaseline || alertLastSeen[teamId] !== settled.count) {
      alertLastSeen[teamId] = settled.count;
      seenChanged = true;
    }
  });

  if (risingInboxes.length) {
    playAlertSoundOnce();
    risingInboxes.forEach(({ teamId, count }) => {
      sendInboxAlertNotification(teamId, count);
    });
  }

  if (seenChanged) persistAlertLastSeen();

  applyAttention(collectActiveInboxes());
}

function collectActiveInboxes() {
  const activeTeam = getActiveInboxId();
  const visible = !document.hidden;
  const activeList = [];
  alertWatchedInboxIds().forEach((rawTeamId) => {
    const teamId = String(rawTeamId);
    const count = resolveAlertInboxCount(teamId);
    if (count === null) return;
    const viewing = activeTeam === teamId && visible;
    if (count > 0 && !viewing) activeList.push({ teamId, count });
  });
  return activeList;
}

function applyAttention(activeList) {
  if (!activeList.length) {
    alertVisuals.stop();
    return;
  }
  alertVisuals.updateSummary(activeList);
  alertVisuals.start();
}

function clearAllInboxAlerts() {
  alertPendingCounts = {};
  alertVisuals.stop();
}
