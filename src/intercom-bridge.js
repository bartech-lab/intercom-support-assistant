const INTERCOM_BRIDGE_MARKER = '__isaic';
const INTERCOM_BRIDGE_READY_MARKER = '__isaic_ready';
const INTERCOM_BRIDGE_VERSION = 1;
const INTERCOM_BRIDGE_LANGUAGE_KIND = 'conversation-language';
const INTERCOM_BRIDGE_COMPANY_KIND = 'conversation-company';
const INTERCOM_BRIDGE_IDENTITY_KIND = 'conversation-identity';
const INTERCOM_BRIDGE_ADDRESS_KIND = 'conversation-inbound-address';
const INTERCOM_BRIDGE_LIST_STATE_KIND = 'inbox-list-state';
const INTERCOM_BRIDGE_TEAM_KIND = 'conversation-team';
const INTERCOM_BRIDGE_ESCALATION_STATUS_KIND = 'conversation-escalation-status';
const INTERCOM_BRIDGE_CONVERSATION_STATE_KIND = 'conversation-state';
const INTERCOM_BRIDGE_CONTACT_KIND = 'contact-language';
const INTERCOM_BRIDGE_LIST_IDENTITY_KIND = 'inbox-list-identity';
const INTERCOM_BRIDGE_CONTACT_ID_TOKEN = /^[0-9a-f]{24}$/;
const INTERCOM_BRIDGE_TEMPORARY_NOTE_STATE_KINDS = ['temporary-note-armed', 'temporary-note-save'];
const INTERCOM_BRIDGE_TEMPORARY_NOTE_OBSERVATION_KINDS = ['temporary-note-notes', 'temporary-note-contact'];
const INTERCOM_BRIDGE_TEMPORARY_NOTE_TOKEN = /^[A-Za-z0-9_-]{8,128}$/;
const INTERCOM_BRIDGE_TEMPORARY_NOTE_STATUS = /^[a-z-]{1,32}$/;
const INTERCOM_BRIDGE_MAX_LIST_IDENTITIES = 200;
const LIST_IDENTITY_MAX_ROWS = 1000;
const INTERCOM_BRIDGE_USER_ID_TOKEN = /^[A-Za-z0-9]{1,40}$/;
const INTERCOM_BRIDGE_COUNTRY_TOKEN = /^[A-Z]{2}$/;
const INTERCOM_BRIDGE_TEAM_ID_TOKEN = /^\d{1,20}$/;
const NETWORK_TEAM_MAX_CONVERSATIONS = 20;
const INTERCOM_BRIDGE_SOURCES = ['summary', 'stream'];
const INTERCOM_BRIDGE_MAX_LANGUAGE_CHARS = 64;
const INTERCOM_BRIDGE_TOKEN = /^[A-Za-z0-9 _-]{1,64}$/;
const INTERCOM_BRIDGE_COMPANY_TOKEN = /^[\p{L}\p{N} _-]{1,64}$/u;
const INTERCOM_BRIDGE_MAX_ADDRESS_CHARS = 254;
const INTERCOM_BRIDGE_ADDRESS_TOKEN = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;
const INTERCOM_BRIDGE_MAX_ADDRESSES = 5;
const NETWORK_LANGUAGE_MAX_CONVERSATIONS = 20;
const NETWORK_COMPANY_MAX_CONVERSATIONS = 20;
const NETWORK_IDENTITY_MAX_CONVERSATIONS = 20;
const NETWORK_ESCALATION_STATUS_MAX_CONVERSATIONS = 20;
const INTERCOM_BRIDGE_MAX_COMPANY_CHARS = 64;
const INBOUND_ADDRESS_MAX_CONVERSATIONS = 200;
const INTERCOM_BRIDGE_INBOX_TYPE_TOKEN = /^[a-z_]{1,32}$/;
const INTERCOM_BRIDGE_INBOX_ID_TOKEN = /^[A-Za-z0-9_-]{1,64}$/;
const INTERCOM_BRIDGE_STATE_TOKEN = /^[a-z_]{1,16}$/;
const LIST_STATE_MAX_INBOXES = 50;
const NETWORK_INBOX_MAX_KEYS = 100;
const NETWORK_INBOX_MAX_COUNT = 1000000;
const NETWORK_INBOX_MAX_ENTRIES_PER_ENVELOPE = 50;
const NEXUS_WALK_MAX_OBJECTS = 2000;
let networkInboxObservedNormalIntervalMs = null;

const networkLanguageByConversation = new Map();
const networkCompanyByConversation = new Map();
const networkIdentityByConversation = new Map();
const networkTeamByConversation = new Map();
const networkEscalationStatusByConversation = new Map();
const inboundAddressByConversation = new Map();
const listIdentityByInbox = new Map();
let listIdentityVersion = 0;
const listStateByInbox = new Map();
const listStateUnknownSince = new Map();
let listStateRowsAwaitingRerender = null;
const networkInboxCountByKey = new Map();
let networkTeamDirectory = null;
let networkEscalationStatusVisibility = null;

function isValidBridgeShell(data) {
  if (!data || typeof data !== 'object') return false;
  if (data[INTERCOM_BRIDGE_MARKER] !== true) return false;
  return data.version === INTERCOM_BRIDGE_VERSION;
}

function isValidConversationShell(data) {
  if (typeof data.conversationId !== 'string' || !/^\d+$/.test(data.conversationId)) return false;
  return INTERCOM_BRIDGE_SOURCES.includes(data.source);
}

function isValidListStateEnvelope(data) {
  if (typeof data.inboxType !== 'string' || !INTERCOM_BRIDGE_INBOX_TYPE_TOKEN.test(data.inboxType)) return false;
  if (typeof data.inboxId !== 'string' || !INTERCOM_BRIDGE_INBOX_ID_TOKEN.test(data.inboxId)) return false;
  return typeof data.state === 'string' && INTERCOM_BRIDGE_STATE_TOKEN.test(data.state);
}

function isValidLanguageEnvelope(data) {
  if (typeof data.language !== 'string') return false;
  if (data.language.length > INTERCOM_BRIDGE_MAX_LANGUAGE_CHARS) return false;
  return INTERCOM_BRIDGE_TOKEN.test(data.language);
}

function isValidConversationStateEnvelope(data) {
  if (typeof data.conversationId !== 'string' || !/^\d{1,20}$/.test(data.conversationId)) return false;
  return typeof data.state === 'string' && INTERCOM_BRIDGE_STATE_TOKEN.test(data.state);
}

function isValidTeamEnvelope(data) {
  if (typeof data.teamId !== 'string') return false;
  return INTERCOM_BRIDGE_TEAM_ID_TOKEN.test(data.teamId);
}

function rememberNetworkTeam(conversationId, teamId) {
  if (networkTeamByConversation.get(conversationId) === teamId) return;
  networkTeamByConversation.set(conversationId, teamId);
  while (networkTeamByConversation.size > NETWORK_TEAM_MAX_CONVERSATIONS) {
    networkTeamByConversation.delete(networkTeamByConversation.keys().next().value);
  }

  if (typeof refreshInProgressActionHighlights === 'function') refreshInProgressActionHighlights();
}

function resolveNetworkTeamCompany(conversationId) {
  if (!conversationId) return null;
  const teamId = networkTeamByConversation.get(conversationId);
  if (!teamId) return null;
  return teamIdToCompany[teamId] || null;
}

function isValidListIdentityEnvelope(data) {
  if (typeof data.inboxType !== 'string' || !INTERCOM_BRIDGE_INBOX_TYPE_TOKEN.test(data.inboxType)) return false;
  if (typeof data.inboxId !== 'string' || !INTERCOM_BRIDGE_INBOX_ID_TOKEN.test(data.inboxId)) return false;
  if (typeof data.state !== 'string' || !INTERCOM_BRIDGE_STATE_TOKEN.test(data.state)) return false;
  if (!Array.isArray(data.identities)) return false;
  if (!data.identities.length || data.identities.length > INTERCOM_BRIDGE_MAX_LIST_IDENTITIES) return false;
  return data.identities.every(entry => entry
    && typeof entry.conversationId === 'string'
    && /^\d{1,20}$/.test(entry.conversationId)
    && typeof entry.contactId === 'string'
    && INTERCOM_BRIDGE_CONTACT_ID_TOKEN.test(entry.contactId)
    && isValidListIdentityEmail(entry.email));
}

function isValidListIdentityEmail(value) {
  if (value === undefined) return true;
  if (typeof value !== 'string') return false;
  if (value.length > INTERCOM_BRIDGE_MAX_ADDRESS_CHARS) return false;
  return INTERCOM_BRIDGE_ADDRESS_TOKEN.test(value);
}

function rememberListIdentities(inboxType, inboxId, state, identities) {
  const key = `${inboxType}:${inboxId}:${state}`;
  let known = listIdentityByInbox.get(key);
  if (!known) {
    known = new Map();
    listIdentityByInbox.set(key, known);
    while (listIdentityByInbox.size > LIST_STATE_MAX_INBOXES) {
      listIdentityByInbox.delete(listIdentityByInbox.keys().next().value);
    }
  }

  let learned = false;
  identities.forEach((entry) => {
    const email = entry.email || null;
    const seen = known.get(entry.conversationId);
    if (seen && seen.contactId === entry.contactId && seen.email === email) return;
    known.set(entry.conversationId, { contactId: entry.contactId, email });
    learned = true;
  });

  while (known.size > LIST_IDENTITY_MAX_ROWS) {
    known.delete(known.keys().next().value);
  }

  if (!learned) return;
  listIdentityVersion += 1;
  refreshDuplicateCustomerHighlights();
}

function forgetClosedConversation(conversationId, state) {
  if (state === DUPLICATE_OPEN_STATE_TOKEN) {
    rememberDuplicateConversationOpen(conversationId);
    return;
  }

  let dropped = false;
  listIdentityByInbox.forEach((known, key) => {
    if (!key.endsWith(`:${DUPLICATE_OPEN_STATE_TOKEN}`)) return;
    if (known.delete(conversationId)) dropped = true;
  });

  forgetDuplicateConversation(conversationId);
  if (!dropped) return;
  listIdentityVersion += 1;
  refreshDuplicateCustomerHighlights();
}

function listIdentitiesForCurrentInbox() {
  const teamId = getTeamIdFromHref(window.location.href);
  if (!teamId) return null;
  return listIdentityByInbox.get(`team:${teamId}:${DUPLICATE_OPEN_STATE_TOKEN}`) || null;
}

function isValidContactLanguageToken(value) {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'string') return false;
  if (value.length > INTERCOM_BRIDGE_MAX_LANGUAGE_CHARS) return false;
  return INTERCOM_BRIDGE_TOKEN.test(value);
}

function isValidContactLanguageEnvelope(data) {
  if (typeof data.userId !== 'string' || !INTERCOM_BRIDGE_USER_ID_TOKEN.test(data.userId)) return false;
  if (!isValidContactLanguageToken(data.languageOverride)) return false;
  if (!isValidContactLanguageToken(data.browserLocale)) return false;
  if (data.countryCode === null || data.countryCode === undefined) return true;
  return typeof data.countryCode === 'string' && INTERCOM_BRIDGE_COUNTRY_TOKEN.test(data.countryCode);
}

function isValidAddressEnvelope(data) {
  if (!Array.isArray(data.addresses)) return false;
  if (!data.addresses.length || data.addresses.length > INTERCOM_BRIDGE_MAX_ADDRESSES) return false;
  return data.addresses.every(address => typeof address === 'string'
    && address.length <= INTERCOM_BRIDGE_MAX_ADDRESS_CHARS
    && INTERCOM_BRIDGE_ADDRESS_TOKEN.test(address));
}

function isValidCompanyEnvelope(data) {
  if (typeof data.company !== 'string') return false;
  if (data.company.length > INTERCOM_BRIDGE_MAX_COMPANY_CHARS) return false;
  return INTERCOM_BRIDGE_COMPANY_TOKEN.test(data.company);
}

function rememberNetworkCompany(conversationId, source, rawCompany) {
  const company = typeof rawCompany === 'string' ? rawCompany.trim() : '';
  if (!company) return;

  const slots = networkCompanyByConversation.get(conversationId)
    || { summary: null, stream: null };
  slots[source] = company;
  networkCompanyByConversation.set(conversationId, slots);

  while (networkCompanyByConversation.size > NETWORK_COMPANY_MAX_CONVERSATIONS) {
    networkCompanyByConversation.delete(networkCompanyByConversation.keys().next().value);
  }
}

function resolveNetworkCompany(conversationId) {
  const slots = networkCompanyByConversation.get(conversationId);
  if (!slots) return null;
  if (slots.summary && slots.stream) {
    return slots.summary === slots.stream ? slots.summary : slots.stream;
  }
  return slots.summary || slots.stream || null;
}

function isValidIdentityEnvelope(data) {
  return typeof data.email === 'string' && data.email.length <= INTERCOM_BRIDGE_MAX_ADDRESS_CHARS
    && INTERCOM_BRIDGE_ADDRESS_TOKEN.test(data.email);
}

function rememberNetworkIdentity(conversationId, email) {
  networkIdentityByConversation.set(conversationId, { email: email.toLowerCase() });

  while (networkIdentityByConversation.size > NETWORK_IDENTITY_MAX_CONVERSATIONS) {
    networkIdentityByConversation.delete(networkIdentityByConversation.keys().next().value);
  }
}

function resolveNetworkIdentity(conversationId) {
  return networkIdentityByConversation.get(conversationId) || null;
}

function isValidEscalationStatusEnvelope(data) {
  return data.source === 'stream' && typeof data.inProgress === 'boolean';
}

function rememberNetworkEscalationStatus(conversationId, inProgress) {
  if (networkEscalationStatusByConversation.get(conversationId) === inProgress) return;
  networkEscalationStatusByConversation.delete(conversationId);
  networkEscalationStatusByConversation.set(conversationId, inProgress);
  while (networkEscalationStatusByConversation.size > NETWORK_ESCALATION_STATUS_MAX_CONVERSATIONS) {
    networkEscalationStatusByConversation.delete(networkEscalationStatusByConversation.keys().next().value);
  }

  if (typeof refreshInProgressActionHighlights === 'function') refreshInProgressActionHighlights();
}

function rememberEscalationStatusVisibility(teamIds) {
  networkEscalationStatusVisibility = { teamIds: teamIds === null ? null : new Set(teamIds) };
  if (typeof refreshInProgressActionHighlights === 'function') refreshInProgressActionHighlights();
}

function escalationStatusVisibleForConversation(conversationId) {
  if (!networkEscalationStatusVisibility) return false;
  if (!networkEscalationStatusVisibility.teamIds) return true;
  const teamId = networkTeamByConversation.get(conversationId);
  return Boolean(teamId) && networkEscalationStatusVisibility.teamIds.has(teamId);
}

function resolveNetworkEscalationInProgress(conversationId) {
  if (!conversationId) return null;
  if (!escalationStatusVisibleForConversation(conversationId)) return null;
  const inProgress = networkEscalationStatusByConversation.get(conversationId);
  return typeof inProgress === 'boolean' ? inProgress : null;
}

function rememberNetworkLanguage(conversationId, source, rawLanguage) {
  const language = signatureLanguageFromAttribute(rawLanguage);
  if (!language) return;

  const slots = networkLanguageByConversation.get(conversationId)
    || { summary: null, stream: null };
  slots[source] = language;
  networkLanguageByConversation.set(conversationId, slots);

  while (networkLanguageByConversation.size > NETWORK_LANGUAGE_MAX_CONVERSATIONS) {
    networkLanguageByConversation.delete(networkLanguageByConversation.keys().next().value);
  }

  if (conversationId === getConversationId()
    && cachedLanguageDetection.conversationId === conversationId
    && cachedLanguageDetection.language !== resolveNetworkLanguage(conversationId)) {
    cachedLanguageDetection = { conversationId: null, language: null };
  }
}

function resolveNetworkLanguage(conversationId) {
  const slots = networkLanguageByConversation.get(conversationId);
  if (!slots) return null;
  if (slots.summary && slots.stream) {
    return slots.summary === slots.stream ? slots.summary : null;
  }
  return slots.summary || slots.stream || null;
}

function rememberInboundAddresses(conversationId, addresses) {
  const learned = addresses.map(address => address.toLowerCase());
  const known = inboundAddressByConversation.get(conversationId);
  if (known && known.join(',') === learned.join(',')) return;

  inboundAddressByConversation.set(conversationId, learned);

  while (inboundAddressByConversation.size > INBOUND_ADDRESS_MAX_CONVERSATIONS) {
    inboundAddressByConversation.delete(inboundAddressByConversation.keys().next().value);
  }

  refreshSupportOriginHighlights();
  refreshDuplicateCustomerHighlights();
}

function conversationListRowSignature() {
  return conversationListRows()
    .map(row => row.getAttribute('data-conversation-id'))
    .join(',');
}

function rememberListState(inboxType, inboxId, state) {
  const key = `${inboxType}:${inboxId}`;
  const known = listStateByInbox.get(key);
  if (known === state) return;

  listStateByInbox.set(key, state);
  listStateUnknownSince.delete(key);
  while (listStateByInbox.size > LIST_STATE_MAX_INBOXES) {
    const oldest = listStateByInbox.keys().next().value;
    listStateByInbox.delete(oldest);
    listStateUnknownSince.delete(oldest);
  }

  if (known !== undefined && key === currentInboxStateKey()) {
    listStateRowsAwaitingRerender = conversationListRowSignature();
  }

  refreshDuplicateCustomerHighlights();
  refreshSupportOriginHighlights();
}

function currentInboxStateKey() {
  const teamId = getTeamIdFromHref(window.location.href);
  return teamId ? `team:${teamId}` : null;
}

function listRowsStillShowThePreviousState() {
  if (listStateRowsAwaitingRerender === null) return false;
  if (conversationListRowSignature() !== listStateRowsAwaitingRerender) {
    listStateRowsAwaitingRerender = null;
    return false;
  }
  return true;
}

function networkListStateForCurrentInbox() {
  const key = currentInboxStateKey();
  return key ? (listStateByInbox.get(key) || null) : null;
}

function inboundAddressLocalPart(address) {
  const at = address.indexOf('@');
  return at > 0 ? address.slice(0, at) : null;
}

function resolveInboundMailboxCompany(conversationId) {
  if (!conversationId) return null;
  const addresses = inboundAddressByConversation.get(conversationId);
  if (!addresses || !addresses.length) return null;

  const resolved = new Set();
  addresses.forEach((address) => {
    const inboxLabel = senderFromEmailToInbox[address];
    if (!inboxLabel) return;
    const company = getCompanyFromInboxName(inboxLabel);
    if (company) resolved.add(company);
  });

  return resolved.size === 1 ? [...resolved][0] : null;
}

function inboundOriginForConversation(conversationId) {
  const addresses = inboundAddressByConversation.get(conversationId);
  if (!addresses) return null;

  const localParts = addresses.map(inboundAddressLocalPart).filter(Boolean);
  const support = localParts.find(part => CONFIG.supportInboundLocalParts.includes(part));
  if (support) {
    return {
      role: 'support',
      address: addresses.find(address => inboundAddressLocalPart(address) === support)
    };
  }
  return null;
}

function isValidInboxCountsEnvelope(data) {
  if (!Array.isArray(data.counts) || !data.counts.length) return false;
  if (data.counts.length > NETWORK_INBOX_MAX_ENTRIES_PER_ENVELOPE) return false;
  if (data.observedAt !== undefined
    && (!Number.isFinite(data.observedAt) || data.observedAt < 0 || data.observedAt > Date.now())) return false;
  return data.counts.every(entry => entry && typeof entry === 'object' &&
    typeof entry.inboxType === 'string' && INTERCOM_BRIDGE_INBOX_TYPE_TOKEN.test(entry.inboxType) &&
    typeof entry.inboxId === 'string' && INTERCOM_BRIDGE_INBOX_ID_TOKEN.test(entry.inboxId) &&
    typeof entry.count === 'number' && entry.count >= 0 &&
    entry.count <= NETWORK_INBOX_MAX_COUNT && Math.floor(entry.count) === entry.count);
}

function isValidTeamDirectoryEnvelope(data) {
  if (!Array.isArray(data.teams) || !data.teams.length || data.teams.length > 2000) return false;
  if (data.observedAt !== undefined
    && (!Number.isFinite(data.observedAt) || data.observedAt < 0 || data.observedAt > Date.now())) return false;
  return data.teams.every(entry => entry && typeof entry === 'object' &&
    typeof entry.id === 'string' && /^\d{1,20}$/.test(entry.id) &&
    typeof entry.name === 'string' && entry.name.length > 0 && entry.name.length <= 120 &&
    !/[\u0000-\u001f]/.test(entry.name));
}

function rememberTeamDirectory(teams, observedAt = Date.now()) {
  networkTeamDirectory = {
    observedAt: new Date(Number.isFinite(observedAt) ? observedAt : Date.now()).toISOString(),
    teams: teams.map(entry => ({ id: entry.id, name: entry.name }))
  };
}

function teamDirectorySnapshot() {
  return networkTeamDirectory
    ? { observedAt: networkTeamDirectory.observedAt, teams: networkTeamDirectory.teams.map(entry => ({ ...entry })) }
    : null;
}

function isValidVisibilityEnvelope(data) {
  if (data.observedAt !== undefined
    && (!Number.isFinite(data.observedAt) || data.observedAt < 0 || data.observedAt > Date.now())) return false;
  if (data.teamIds === null) return true;
  return Array.isArray(data.teamIds) && data.teamIds.length <= 2000
    && data.teamIds.every(id => typeof id === 'string' && INTERCOM_BRIDGE_TEAM_ID_TOKEN.test(id));
}

function rememberNetworkInboxCounts(entries, observedAt = Date.now()) {
  entries.forEach((entry) => {
    const key = `${entry.inboxType}:${entry.inboxId}`;
    const known = networkInboxCountByKey.get(key);
    if (known && observedAt < known.at) return;
    networkInboxCountByKey.set(key, { count: entry.count, at: observedAt });
  });
  while (networkInboxCountByKey.size > NETWORK_INBOX_MAX_KEYS) {
    let oldestKey = null;
    let oldestAt = Infinity;
    networkInboxCountByKey.forEach((value, key) => {
      if (value.at < oldestAt) {
        oldestAt = value.at;
        oldestKey = key;
      }
    });
    if (oldestKey === null) break;
    networkInboxCountByKey.delete(oldestKey);
  }
}

function networkInboxObservation(inboxType, inboxId, options = {}) {
  if (typeof inboxType !== 'string' || !INTERCOM_BRIDGE_INBOX_TYPE_TOKEN.test(inboxType)) return null;
  if (typeof inboxId !== 'string' || !INTERCOM_BRIDGE_INBOX_ID_TOKEN.test(inboxId)) return null;
  const entry = networkInboxCountByKey.get(`${inboxType}:${inboxId}`);
  if (!entry) return null;
  const configuredWindowMs = Number.isFinite(options.freshnessWindowMs)
    && options.freshnessWindowMs > 0
    ? options.freshnessWindowMs
    : null;
  const freshnessWindowMs = configuredWindowMs || (Number.isFinite(networkInboxObservedNormalIntervalMs)
    && networkInboxObservedNormalIntervalMs > 0
    ? networkInboxObservedNormalIntervalMs * 2
    : null);
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const ageMs = now - entry.at;
  return {
    count: entry.count,
    observedAt: entry.at,
    ageMs,
    freshnessWindowMs,
    fresh: freshnessWindowMs !== null && ageMs >= 0 && ageMs <= freshnessWindowMs
  };
}

function freshNetworkInboxCount(inboxType, inboxId) {
  const observation = networkInboxObservation(inboxType, inboxId);
  return observation && observation.fresh ? observation.count : null;
}

function networkInboxCount(inboxType, inboxId) {
  return freshNetworkInboxCount(inboxType, inboxId);
}

function isValidNexusCountObject(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  if (obj.id === undefined || obj.id === null) return false;
  if (!INTERCOM_BRIDGE_INBOX_ID_TOKEN.test(String(obj.id))) return false;
  if (typeof obj.inbox_type !== 'string' || !INTERCOM_BRIDGE_INBOX_TYPE_TOKEN.test(obj.inbox_type)) return false;
  const nested = obj.count && typeof obj.count === 'object' ? obj.count.count : undefined;
  const flat = typeof obj.unread_count === 'number' ? obj.unread_count : undefined;
  const count = nested !== undefined ? nested : flat;
  return typeof count === 'number' && count >= 0 &&
    count <= NETWORK_INBOX_MAX_COUNT && Math.floor(count) === count;
}

function nexusCountFrom(obj) {
  const nested = obj.count && typeof obj.count === 'object' ? obj.count.count : undefined;
  return nested !== undefined ? nested : obj.unread_count;
}

function rememberCountsFromNexusPayload(payload, observedAt) {
  const queue = [payload];
  const entries = [];
  let processed = 0;

  while (queue.length && processed < NEXUS_WALK_MAX_OBJECTS && entries.length < NETWORK_INBOX_MAX_ENTRIES_PER_ENVELOPE) {
    const value = queue.shift();
    processed += 1;
    if (!value || typeof value !== 'object') continue;
    if (isValidNexusCountObject(value)) {
      entries.push({
        inboxType: value.inbox_type,
        inboxId: String(value.id),
        count: nexusCountFrom(value)
      });
      continue;
    }
    const children = Array.isArray(value) ? value : Object.values(value);
    for (let i = 0; i < children.length && queue.length < NEXUS_WALK_MAX_OBJECTS; i += 1) {
      queue.push(children[i]);
    }
  }

  if (entries.length) rememberNetworkInboxCounts(entries, observedAt);
}

function isValidTemporaryNoteToken(value) {
  return typeof value === 'string' && INTERCOM_BRIDGE_TEMPORARY_NOTE_TOKEN.test(value);
}

function isValidTemporaryNoteStateEnvelope(data) {
  if (data.token !== null && !isValidTemporaryNoteToken(data.token)) return false;
  if (data.revision !== null && !Number.isInteger(data.revision)) return false;
  return typeof data.status === 'string' && INTERCOM_BRIDGE_TEMPORARY_NOTE_STATUS.test(data.status);
}

function isValidTemporaryNoteObservation(data) {
  return typeof data.workspace === 'string'
    && INTERCOM_BRIDGE_INBOX_ID_TOKEN.test(data.workspace);
}

function handleIntercomBridgeMessage(event) {
  if (event.source !== window) return;
  if (event.origin !== window.location.origin) return;
  const data = event.data;
  if (!isValidBridgeShell(data)) return;

  if (INTERCOM_BRIDGE_TEMPORARY_NOTE_STATE_KINDS.includes(data.kind)) {
    if (isValidTemporaryNoteStateEnvelope(data)) handleTemporaryNoteMessage(data);
    return;
  }

  if (INTERCOM_BRIDGE_TEMPORARY_NOTE_OBSERVATION_KINDS.includes(data.kind)) {
    if (isValidTemporaryNoteObservation(data)) scheduleTemporaryNoteCleanupFromObservation();
    return;
  }

  if (data.kind === INTERCOM_BRIDGE_LIST_STATE_KIND && isValidListStateEnvelope(data)) {
    rememberListState(data.inboxType, data.inboxId, data.state);
    return;
  }

  if (data.kind === INTERCOM_BRIDGE_CONVERSATION_STATE_KIND && isValidConversationStateEnvelope(data)) {
    forgetClosedConversation(data.conversationId, data.state);
    return;
  }

  if (data.kind === INTERCOM_BRIDGE_LIST_IDENTITY_KIND && isValidListIdentityEnvelope(data)) {
    rememberListIdentities(data.inboxType, data.inboxId, data.state, data.identities);
    return;
  }

  if (data.kind === INTERCOM_BRIDGE_CONTACT_KIND && isValidContactLanguageEnvelope(data)) {
    rememberDraftRecipientLanguage(data.userId, {
      languageOverride: data.languageOverride || null,
      browserLocale: data.browserLocale || null,
      countryCode: data.countryCode || null
    });
    return;
  }

  if (data.kind === 'team-directory' && isValidTeamDirectoryEnvelope(data)) {
    rememberTeamDirectory(data.teams, data.observedAt);
    return;
  }

  if (data.kind === 'escalation-status-visibility' && isValidVisibilityEnvelope(data)) {
    rememberEscalationStatusVisibility(data.teamIds);
    return;
  }

  if (data.kind === 'inbox-counts' && isValidInboxCountsEnvelope(data)) {
    rememberNetworkInboxCounts(data.counts, data.observedAt);
    return;
  }

  if (data.kind === 'nexus-frame' && typeof data.data === 'string' &&
      data.data.length > 0 && data.data.length <= 4 * 1024 * 1024 &&
      (data.observedAt === undefined || (Number.isFinite(data.observedAt)
        && data.observedAt >= 0 && data.observedAt <= Date.now()))) {
    safeExecute(() => {
      rememberCountsFromNexusPayload(JSON.parse(data.data), data.observedAt);
    }, 'nexusFrameCounts');
    return;
  }

  if (!isValidConversationShell(data)) return;
  if (data.kind === INTERCOM_BRIDGE_LANGUAGE_KIND && isValidLanguageEnvelope(data)) {
    rememberNetworkLanguage(data.conversationId, data.source, data.language);
    return;
  }
  if (data.kind === INTERCOM_BRIDGE_COMPANY_KIND && isValidCompanyEnvelope(data)) {
    rememberNetworkCompany(data.conversationId, data.source, data.company);
    return;
  }
  if (data.kind === INTERCOM_BRIDGE_IDENTITY_KIND && isValidIdentityEnvelope(data)) {
    rememberNetworkIdentity(data.conversationId, data.email);
    return;
  }
  if (data.kind === INTERCOM_BRIDGE_ESCALATION_STATUS_KIND && isValidEscalationStatusEnvelope(data)) {
    rememberNetworkEscalationStatus(data.conversationId, data.inProgress);
    return;
  }
  if (data.kind === INTERCOM_BRIDGE_TEAM_KIND && isValidTeamEnvelope(data)) {
    rememberNetworkTeam(data.conversationId, data.teamId);
    return;
  }
  if (data.kind === INTERCOM_BRIDGE_ADDRESS_KIND && isValidAddressEnvelope(data)) {
    rememberInboundAddresses(data.conversationId, data.addresses);
  }
}

function initIntercomBridge() {
  window.addEventListener('message', event => safeExecute(
    () => handleIntercomBridgeMessage(event),
    'handleIntercomBridgeMessage'
  ));
  safeExecute(
    () => window.postMessage({ [INTERCOM_BRIDGE_READY_MARKER]: true }, window.location.origin),
    'intercomBridgeReadyHandshake'
  );
}
