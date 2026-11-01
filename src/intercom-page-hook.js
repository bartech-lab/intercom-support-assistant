(function () {
  'use strict';

  if (window.__isaIntercomPageHookInstalled) return;
  window.__isaIntercomPageHookInstalled = true;

  var MARKER = '__isaic';
  var READY_MARKER = '__isaic_ready';
  var ENVELOPE_VERSION = 1;
  var LANGUAGE_KIND = 'conversation-language';
  var COMPANY_KIND = 'conversation-company';
  var IDENTITY_KIND = 'conversation-identity';
  var ADDRESS_KIND = 'conversation-inbound-address';
  var LIST_STATE_KIND = 'inbox-list-state';
  var TEAM_KIND = 'conversation-team';
  var CONVERSATION_STATE_KIND = 'conversation-state';
  var CONTACT_KIND = 'contact-language';
  var LIST_IDENTITY_KIND = 'inbox-list-identity';
  var COUNTS_KIND = 'inbox-counts';
  var NEXUS_KIND = 'nexus-frame';
  var TEAM_DIRECTORY_KIND = 'team-directory';
  var ESCALATION_STATUS_KIND = 'conversation-escalation-status';
  var ESCALATION_STATUS_VISIBILITY_KIND = 'escalation-status-visibility';

  var INBOXES_PATH = /^\/ember\/inbox\/inboxes\/inboxes$/;
  var ASSIGNEES_PATH = /^\/ember\/inbox\/assignees$/;
  var DESCRIPTORS_PATH = /^\/ember\/conversation_attributes\/descriptors$/;
  var MAX_TEAM_DIRECTORY_ENTRIES = 2000;
  var MAX_TEAM_NAME_CHARS = 120;
  var WS_URL_PATTERN = /nexus|websocket/i;
  var WS_FRAME_PATTERN = /inbox|conversation|notification|count/i;
  var MAX_INBOX_COUNT_ENTRIES = 50;
  var MAX_COUNT_VALUE = 1000000;

  var MAX_PAYLOAD_CHARS = 4 * 1024 * 1024;
  var MAX_LANGUAGE_CHARS = 64;
  var MAX_BUFFERED_CONVERSATIONS = 20;
  var MAX_ADDRESS_CHARS = 254;
  var MAX_ADDRESSES = 5;

  var TEMP_NOTE_MESSAGE_MARKER = '__isaTempNote';
  var TEMP_NOTE_CREATE_PATH = /^\/ember\/inbox\/notes$/;
  var TEMP_NOTE_FETCH_PATH = /^\/ember\/inbox\/notes$/;
  var TEMP_NOTE_WORKSPACE_TOKEN = /^[A-Za-z0-9_-]{1,64}$/;
  var TEMP_NOTE_CONTACT_TOKEN = /^[A-Za-z0-9_-]{1,64}$/;
  var TEMP_NOTE_ID_TOKEN = /^\d{1,32}$/;
  var TEMP_NOTE_TOKEN = /^[A-Za-z0-9_-]{8,128}$/;
  var TEMP_NOTE_MIN_LIFETIME_MS = 60000;
  var TEMP_NOTE_MAX_LIFETIME_MS = 315360000000;
  var TEMP_NOTE_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  var TEMP_NOTE_MAX_DRAFT_CHARS = 200000;
  var TEMP_NOTE_MAX_REQUEST_CHARS = TEMP_NOTE_MAX_DRAFT_CHARS * 6 + 4096;
  var TEMP_NOTE_SAVE_TIMEOUT_MS = 15000;

  var LIST_PATH = /^\/ember\/inbox\/conversations(\/list)?$/;
  var INBOX_TYPE_TOKEN = /^[a-z_]{1,32}$/;
  var INBOX_ID_TOKEN = /^[A-Za-z0-9_-]{1,64}$/;
  var STATE_TOKEN = /^[a-z_]{1,16}$/;
  var CONTACT_ID_TOKEN = /^[0-9a-f]{24}$/i;
  var CONVERSATION_ID_TOKEN = /^\d{1,20}$/;
  var MAX_LIST_IDENTITIES = 200;

  var SUMMARY_PATH = /^\/ember\/inbox\/conversations\/(\d+)$/;
  var STREAM_PATH = /^\/ember\/inbox\/conversations\/(\d+)\/stream$/;
  var LANGUAGE_TOKEN = /^[A-Za-z0-9 _-]{1,64}$/;
  var COMPANY_VALUE_TOKEN = /^[\p{L}\p{N} _-]{1,64}$/u;
  var ADDRESS_TOKEN = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;
  var TEAM_ID_TOKEN = /^\d{1,20}$/;
  var USER_PATH = /^\/ember\/users\/([A-Za-z0-9]{1,40})$/;
  var COUNTRY_TOKEN = /^[A-Za-z]{2}$/;
  var LANGUAGE_ATTRIBUTE_ID = 'language';
  var LANGUAGE_ATTRIBUTE_NAME = 'language';
  var COMPANY_ATTRIBUTE_NAME = 'brand';
  var ESCALATION_STATUS_ATTRIBUTE_NAME = 'escalation status';
  var IN_PROGRESS_TEXT = 'in progress';
  var OPTION_ID_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var ATTRIBUTE_RENDERABLE_TYPE = 14;
  var CUSTOMER_EMAIL_RENDERABLE_TYPE = 12;
  var ADDRESS_HEADERS = ['to', 'cc'];

  var buffer = [];
  var listenerReady = false;
  var temporaryNoteArm = null;

  function envelopeSlot(envelope) {
    if (envelope.kind === COUNTS_KIND || envelope.kind === NEXUS_KIND || envelope.kind === TEAM_DIRECTORY_KIND) return envelope.kind;
    if (envelope.kind === LIST_STATE_KIND) return envelope.kind + '::' + envelope.inboxKey;
    if (envelope.kind === CONTACT_KIND) return envelope.kind + '::' + envelope.userId;
    if (envelope.kind === LIST_IDENTITY_KIND) return envelope.kind + '::' + envelope.inboxKey;
    return envelope.kind + '::' + envelope.conversationId + '::' + envelope.source;
  }

  function bufferEnvelope(envelope) {
    var slot = envelopeSlot(envelope);
    for (var i = 0; i < buffer.length; i += 1) {
      if (envelopeSlot(buffer[i]) === slot) {
        buffer[i] = envelope;
        return;
      }
    }
    buffer.push(envelope);
    while (countBufferedConversations() > MAX_BUFFERED_CONVERSATIONS) evictOldestBufferedConversation();
  }

  function evictOldestBufferedConversation() {
    for (var i = 0; i < buffer.length; i += 1) {
      if (buffer[i].conversationId === undefined) continue;
      var oldest = buffer[i].conversationId;
      buffer = buffer.filter(function (item) { return item.conversationId !== oldest; });
      return;
    }
  }

  function countBufferedConversations() {
    var seen = {};
    var total = 0;
    for (var i = 0; i < buffer.length; i += 1) {
      if (buffer[i].conversationId === undefined) continue;
      if (!seen[buffer[i].conversationId]) {
        seen[buffer[i].conversationId] = true;
        total += 1;
      }
    }
    return total;
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window || listenerReady) return;
    var data = event.data;
    if (!data || data[READY_MARKER] !== true) return;
    listenerReady = true;
    var pending = buffer;
    buffer = [];
    for (var i = 0; i < pending.length; i += 1) {
      try {
        window.postMessage(pending[i], window.location.origin);
      } catch (error) {}
    }
  });

  function send(envelope) {
    if (!listenerReady) {
      bufferEnvelope(envelope);
      return;
    }
    try {
      window.postMessage(envelope, window.location.origin);
    } catch (error) {}
  }

  function postTemporaryNote(kind, values) {
    var envelope = {};
    envelope[MARKER] = true;
    envelope.version = ENVELOPE_VERSION;
    envelope.kind = kind;
    for (var key in values) envelope[key] = values[key];
    send(envelope);
  }

  function validWorkspace(value) {
    return typeof value === 'string' && TEMP_NOTE_WORKSPACE_TOKEN.test(value);
  }

  function validContact(value) {
    return typeof value === 'string' && TEMP_NOTE_CONTACT_TOKEN.test(value);
  }

  function validTemporaryToken(value) {
    return typeof value === 'string' && TEMP_NOTE_TOKEN.test(value);
  }

  function validTemporaryLifetime(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    var keys = Object.keys(value);
    if (keys.length !== 2 || keys.indexOf('mode') === -1) return false;
    if (value.mode === 'relative') {
      if (keys.indexOf('delayMs') === -1 || typeof value.delayMs !== 'number') return false;
      return Number.isSafeInteger(value.delayMs)
        && value.delayMs >= TEMP_NOTE_MIN_LIFETIME_MS && value.delayMs <= TEMP_NOTE_MAX_LIFETIME_MS;
    }
    if (value.mode === 'absolute') {
      if (keys.indexOf('expiresAt') === -1 || typeof value.expiresAt !== 'string') return false;
      if (!TEMP_NOTE_ISO_PATTERN.test(value.expiresAt)) return false;
      var parsed = Date.parse(value.expiresAt);
      return Number.isFinite(parsed) && new Date(parsed).toISOString() === value.expiresAt;
    }
    return false;
  }

  function validTemporaryRevision(value) {
    return typeof value === 'number' && Number.isFinite(value)
      && Math.floor(value) === value && value >= 0 && value <= 1000000000;
  }

  function temporaryWorkspaceFromUrl(url) {
    if (!url || !url.searchParams) return null;
    var appId = String(url.searchParams.get('app_id') || '');
    if (validWorkspace(appId)) return appId;
    var parts = url.pathname.split('/');
    var pathWorkspace = parts.length > 3 ? String(parts[3] || '') : '';
    return validWorkspace(pathWorkspace) ? pathWorkspace : null;
  }

  function temporaryNoteRequestInfo(url) {
    if (!url || !TEMP_NOTE_FETCH_PATH.test(url.pathname)) return null;
    var workspace = String(url.searchParams.get('app_id') || '');
    if (!validWorkspace(workspace)) return null;
    var ids = url.searchParams.getAll('ids[]');
    var noteIds = [];
    for (var i = 0; i < ids.length; i += 1) {
      var id = String(ids[i] || '');
      if (!TEMP_NOTE_ID_TOKEN.test(id) || noteIds.indexOf(id) !== -1) continue;
      noteIds.push(id);
      if (noteIds.length === 200) break;
    }
    return { workspace: workspace, noteIds: noteIds };
  }

  function temporaryNoteFooter(arm, expiresAt) {
    var date = new Date(expiresAt);
    if (!Number.isFinite(date.getTime())) return null;
    var iso = date.toISOString();
    var readable = iso.slice(0, 16).replace('T', ' ') + ' UTC';
    return 'Auto-delete after: ' + readable + '\n'
      + '[ISA-AUTO-DELETE:v1;workspace=' + arm.workspace
      + ';contact=' + arm.contact + ';expires=' + iso + ';token=' + arm.token + ']';
  }

  function temporaryNoteBody(input, init) {
    if (init && Object.prototype.hasOwnProperty.call(init, 'body')) {
      if (typeof init.body === 'string') return Promise.resolve({ supported: true, text: init.body });
      return Promise.resolve({ supported: false });
    }
    if (!input || typeof input !== 'object') return Promise.resolve({ supported: false });
    if (typeof input.body === 'string') return Promise.resolve({ supported: true, text: input.body });
    if (typeof input.clone !== 'function') return Promise.resolve({ supported: false });
    var clone;
    try {
      clone = input.clone();
    } catch (error) {
      return Promise.resolve({ supported: false });
    }
    if (!clone || typeof clone.text !== 'function') return Promise.resolve({ supported: false });
    return Promise.resolve().then(function () {
      return clone.text();
    }).then(function (text) {
      return { supported: typeof text === 'string', text: text };
    }).catch(function () {
      return { supported: false };
    });
  }

  function temporaryNoteParsedBody(bodyText) {
    if (typeof bodyText !== 'string' || bodyText.length > TEMP_NOTE_MAX_REQUEST_CHARS) return null;
    try {
      var payload = JSON.parse(bodyText);
      return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
    } catch (error) {
      return null;
    }
  }

  function temporaryNoteSaveBody(payload, arm) {
    if (!payload || payload.model_id === undefined || payload.model_id === null) return null;
    if (String(payload.model_id) !== arm.contact || payload.is_company !== false
      || typeof payload.body !== 'string' || payload.body !== arm.draft) return null;
    return payload.body;
  }

  function temporaryNoteSaveError(arm, status, reason) {
    arm.pending = false;
    arm.needsRearm = true;
    postTemporaryNote('temporary-note-save', {
      token: arm.token,
      revision: arm.revision,
      status: status,
      reason: reason
    });
  }

  function temporaryNoteUncertain(arm, reason) {
    if (arm.uncertain) return;
    arm.pending = false;
    arm.uncertain = true;
    postTemporaryNote('temporary-note-save', {
      token: arm.token,
      revision: arm.revision,
      status: 'uncertain',
      reason: reason
    });
  }

  function temporaryNoteResponseBody(response) {
    if (!response || typeof response.clone !== 'function') return Promise.reject(new Error('response-unreadable'));
    var clone;
    try {
      clone = response.clone();
    } catch (error) {
      return Promise.reject(new Error('response-unreadable'));
    }
    if (!clone || typeof clone.text !== 'function') return Promise.reject(new Error('response-unreadable'));
    return clone.text().then(function (text) {
      if (typeof text !== 'string' || !text || text.length > TEMP_NOTE_MAX_REQUEST_CHARS) {
        throw new Error('response-unreadable');
      }
      var payload;
      try {
        payload = JSON.parse(text);
      } catch (error) {
        throw new Error('response-unreadable');
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || typeof payload.body !== 'string') throw new Error('response-shape');
      return payload.body;
    });
  }

  function temporaryNoteResponseMatches(response, footer, arm) {
    return temporaryNoteResponseBody(response).then(function (body) {
      if (body.slice(-footer.length) !== footer
        || body.indexOf('[ISA-AUTO-DELETE:v1;') === -1
        || body.indexOf(';token=' + arm.token + ']') === -1) {
        throw new Error('response-footer');
      }
      return true;
    });
  }

  function finishTemporaryNoteSave(response, arm, footer) {
    if (arm.uncertain && arm.finished) return response;
    if (response && response.status >= 200 && response.status < 300) {
      return temporaryNoteResponseMatches(response, footer, arm).then(function () {
        arm.finished = true;
        arm.pending = false;
        arm.uncertain = false;
        temporaryNoteArm = null;
        postTemporaryNote('temporary-note-save', {
          token: arm.token,
          revision: arm.revision,
          status: 'success'
        });
        return response;
      }).catch(function (error) {
        temporaryNoteUncertain(arm, error.message === 'response-shape' ? 'response-shape' : 'response-footer');
        return response;
      });
    }
    if (response && response.status >= 400 && response.status < 500) {
      temporaryNoteSaveError(arm, 'failed', 'http-' + response.status);
      return Promise.resolve(response);
    }
    temporaryNoteUncertain(arm, response ? 'http-' + response.status : 'network');
    return Promise.resolve(response);
  }

  function invokeTemporaryNoteCreate(input, init, arm, bodyText, footer, originalFetch, thisArg) {
    var payload = temporaryNoteParsedBody(bodyText);
    var outgoingBody = temporaryNoteSaveBody(payload, arm);
    if (outgoingBody === null) {
      temporaryNoteSaveError(arm, 'blocked', 'request-mismatch');
      return Promise.reject(new Error('Temporary note request does not match the armed draft'));
    }
    var body = JSON.stringify({
      model_id: payload.model_id,
      is_company: false,
      body: outgoingBody + (outgoingBody ? '\n\n' : '') + footer
    });
    var outgoingInit = init && typeof init === 'object' ? Object.assign({}, init, { body: body }) : { body: body };
    arm.pending = true;
    arm.finished = false;
    var result;
    try {
      result = originalFetch.call(thisArg, input, outgoingInit);
    } catch (error) {
      temporaryNoteUncertain(arm, 'network');
      return Promise.reject(error);
    }
    var settled = Promise.resolve(result).then(function (response) {
      return finishTemporaryNoteSave(response, arm, footer);
    }, function (error) {
      temporaryNoteUncertain(arm, 'network');
      throw error;
    });
    var timerId = null;
    var timer = typeof window.setTimeout === 'function' ? new Promise(function (_, reject) {
      timerId = window.setTimeout(function () {
        timerId = null;
        temporaryNoteUncertain(arm, 'timeout');
        reject(new Error('Temporary note save timed out; reconciliation is required'));
      }, TEMP_NOTE_SAVE_TIMEOUT_MS);
    }) : null;
    if (!timer) return settled;
    var clearTimer = function () {
      if (timerId !== null && typeof window.clearTimeout === 'function') window.clearTimeout(timerId);
      timerId = null;
    };
    settled.then(clearTimer, clearTimer);
    return Promise.race([settled, timer]);
  }

  function temporaryNoteReferenceIds(payload) {
    var values = [];
    function add(value) {
      var id = value && typeof value === 'object' ? value.id : value;
      id = String(id === undefined || id === null ? '' : id);
      if (TEMP_NOTE_ID_TOKEN.test(id) && values.indexOf(id) === -1) values.push(id);
    }
    function read(container) {
      if (!container || typeof container !== 'object') return;
      ['note_ids', 'notes'].forEach(function (key) {
        if (!Array.isArray(container[key])) return;
        container[key].forEach(add);
      });
    }
    read(payload);
    if (Array.isArray(payload && payload.users)) read(payload.users[0]);
    return values.slice(0, 200);
  }

  function noteTimestamp(value) {
    if (typeof value !== 'string' || !value || !Number.isFinite(Date.parse(value))) return null;
    return value;
  }

  function parseTemporaryNotes(payload, requestedIds) {
    if (!Array.isArray(payload)) return null;
    var notes = [];
    for (var i = 0; i < payload.length && notes.length < 200; i += 1) {
      var note = payload[i];
      if (!note || typeof note !== 'object') continue;
      var id = String(note.id === undefined || note.id === null ? '' : note.id);
      var createdAt = noteTimestamp(note.created_at || note.createdAt);
      var updatedAt = noteTimestamp(note.updated_at || note.updatedAt);
      if (!TEMP_NOTE_ID_TOKEN.test(id) || requestedIds.indexOf(id) === -1
        || typeof note.body !== 'string' || !createdAt || !updatedAt) continue;
      notes.push({ id: id, body: note.body, createdAt: createdAt, updatedAt: updatedAt });
    }
    return notes.length ? notes : null;
  }

  function serverDateFromResponse(response) {
    var value = response && response.headers && typeof response.headers.get === 'function'
      ? response.headers.get('date') : null;
    return typeof value === 'string' && Number.isFinite(Date.parse(value))
      ? new Date(value).toISOString() : null;
  }

  function observeTemporaryNotesResponse(response, requestUrl, requestInfo) {
    readJsonResponse(response, requestUrl, function (payload) {
      var notes = parseTemporaryNotes(payload, requestInfo.noteIds);
      if (!notes) return;
      postTemporaryNote('temporary-note-notes', {
        workspace: requestInfo.workspace,
        notes: notes,
        serverDate: serverDateFromResponse(response),
        observedAt: Date.now()
      });
    });
  }

  function observeTemporaryContactResponse(response, requestUrl, contactId) {
    readJsonResponse(response, requestUrl, function (payload) {
      var noteIds = temporaryNoteReferenceIds(payload);
      if (!noteIds.length) return;
      var workspace = temporaryWorkspaceFromUrl(requestUrl);
      postTemporaryNote('temporary-note-contact', {
        workspace: workspace,
        contact: contactId,
        noteIds: noteIds,
        serverDate: serverDateFromResponse(response),
        observedAt: Date.now()
      });
    });
  }

  function temporaryNoteMessage(event) {
    if (!event || event.source !== window || event.origin !== window.location.origin) return;
    var data = event.data;
    if (!data || data[TEMP_NOTE_MESSAGE_MARKER] !== true) return;
    var kind = data.kind;
    if (kind !== 'arm' && kind !== 'disarm') return;
    var workspace = data.workspace;
    var contact = data.contact;
    var token = data.token;
    var revision = data.revision;
    if (!validWorkspace(workspace) || !validContact(contact) || !validTemporaryToken(token)
      || !validTemporaryRevision(revision)) {
      postTemporaryNote('temporary-note-' + (kind === 'arm' ? 'armed' : 'save'), {
        token: validTemporaryToken(token) ? token : null,
        revision: validTemporaryRevision(revision) ? revision : null,
        status: 'blocked',
        reason: 'invalid-arm'
      });
      return;
    }
    var currentWorkspace = temporaryWorkspaceFromUrl(resolveUrl(window.location.href));
    if (!currentWorkspace || currentWorkspace !== workspace) {
      postTemporaryNote('temporary-note-' + (kind === 'arm' ? 'armed' : 'save'), {
        token: token,
        revision: revision,
        status: 'blocked',
        reason: 'workspace-mismatch'
      });
      return;
    }
    if (kind === 'disarm') {
      if (temporaryNoteArm && (temporaryNoteArm.pending || temporaryNoteArm.uncertain)) {
        postTemporaryNote('temporary-note-save', {
          token: token,
          revision: revision,
          status: 'blocked',
          reason: 'save-pending'
        });
        return;
      }
      temporaryNoteArm = null;
      postTemporaryNote('temporary-note-armed', {
        token: token,
        revision: revision,
        status: 'disarmed'
      });
      return;
    }
    if (!validTemporaryLifetime(data.lifetime) || typeof data.draft !== 'string'
      || data.draft.length > TEMP_NOTE_MAX_DRAFT_CHARS) {
      postTemporaryNote('temporary-note-armed', {
        token: token,
        revision: revision,
        status: 'blocked',
        reason: 'invalid-arm'
      });
      return;
    }
    if (temporaryNoteArm && (temporaryNoteArm.pending || temporaryNoteArm.uncertain)) {
      postTemporaryNote('temporary-note-armed', {
        token: token,
        revision: revision,
        status: 'blocked',
        reason: temporaryNoteArm.uncertain ? 'save-uncertain' : 'save-pending'
      });
      return;
    }
    temporaryNoteArm = {
      workspace: workspace,
      contact: contact,
      draft: data.draft,
      lifetime: data.lifetime,
      token: token,
      revision: revision,
      pending: false,
      uncertain: false,
      needsRearm: false,
      href: window.location.href
    };
    postTemporaryNote('temporary-note-armed', {
      workspace: workspace,
      contact: contact,
      token: token,
      revision: revision,
      lifetime: data.lifetime,
      status: 'armed'
    });
  }

  window.addEventListener('message', temporaryNoteMessage);

  function post(conversationId, language, source) {
    var envelope = {};
    envelope[MARKER] = true;
    envelope.version = ENVELOPE_VERSION;
    envelope.kind = LANGUAGE_KIND;
    envelope.conversationId = conversationId;
    envelope.language = language;
    envelope.source = source;
    send(envelope);
  }

  function postCompany(conversationId, company, source) {
    var envelope = {};
    envelope[MARKER] = true;
    envelope.version = ENVELOPE_VERSION;
    envelope.kind = COMPANY_KIND;
    envelope.conversationId = conversationId;
    envelope.company = company;
    envelope.source = source;
    send(envelope);
  }

  function postIdentity(conversationId, identity, source) {
    var envelope = {};
    envelope[MARKER] = true;
    envelope.version = ENVELOPE_VERSION;
    envelope.kind = IDENTITY_KIND;
    envelope.conversationId = conversationId;
    envelope.email = identity.email;
    envelope.source = source;
    send(envelope);
  }

  function postEscalationStatus(conversationId, inProgress, source) {
    var envelope = {};
    envelope[MARKER] = true;
    envelope.version = ENVELOPE_VERSION;
    envelope.kind = ESCALATION_STATUS_KIND;
    envelope.conversationId = conversationId;
    envelope.inProgress = inProgress;
    envelope.source = source;
    send(envelope);
  }

  function postTeam(conversationId, teamId, source) {
    var envelope = {};
    envelope[MARKER] = true;
    envelope.version = ENVELOPE_VERSION;
    envelope.kind = TEAM_KIND;
    envelope.conversationId = conversationId;
    envelope.teamId = teamId;
    envelope.source = source;
    send(envelope);
  }

  function postConversationState(conversationId, state) {
    var envelope = {};
    envelope[MARKER] = true;
    envelope.version = ENVELOPE_VERSION;
    envelope.kind = CONVERSATION_STATE_KIND;
    envelope.conversationId = conversationId;
    envelope.state = state;
    send(envelope);
  }

  function parseConversationState(payload) {
    if (!payload || typeof payload !== 'object') return null;
    var state = String(payload.state || '').toLowerCase();
    return STATE_TOKEN.test(state) ? state : null;
  }

  function postAddresses(conversationId, addresses, source) {
    var envelope = {};
    envelope[MARKER] = true;
    envelope.version = ENVELOPE_VERSION;
    envelope.kind = ADDRESS_KIND;
    envelope.conversationId = conversationId;
    envelope.addresses = addresses;
    envelope.source = source;
    send(envelope);
  }

  function postContactLanguage(userId, tokens) {
    var envelope = {};
    envelope[MARKER] = true;
    envelope.version = ENVELOPE_VERSION;
    envelope.kind = CONTACT_KIND;
    envelope.userId = userId;
    envelope.languageOverride = tokens.languageOverride;
    envelope.browserLocale = tokens.browserLocale;
    envelope.countryCode = tokens.countryCode;
    send(envelope);
  }

  function postListState(inboxType, inboxId, state) {
    var envelope = {};
    envelope[MARKER] = true;
    envelope.version = ENVELOPE_VERSION;
    envelope.kind = LIST_STATE_KIND;
    envelope.inboxType = inboxType;
    envelope.inboxId = inboxId;
    envelope.inboxKey = inboxType + ':' + inboxId;
    envelope.state = state;
    send(envelope);
  }

  function listStateFromQuery(requestUrl) {
    var params = requestUrl.searchParams;
    if (!params || typeof params.get !== 'function') return null;

    var inboxType = String(params.get('inbox_type') || '');
    var inboxId = String(params.get('inbox_id') || '');
    var state = String(params.get('state') || '').toLowerCase();
    if (!INBOX_TYPE_TOKEN.test(inboxType)) return null;
    if (!INBOX_ID_TOKEN.test(inboxId)) return null;
    if (!STATE_TOKEN.test(state)) return null;
    return { inboxType: inboxType, inboxId: inboxId, state: state };
  }

  function acceptableAttributeValue(value, token) {
    if (typeof value !== 'string') return null;
    var trimmed = value.trim();
    if (!trimmed || trimmed.length > MAX_LANGUAGE_CHARS) return null;
    return (token || LANGUAGE_TOKEN).test(trimmed) ? trimmed : null;
  }

  function acceptableLanguage(value) {
    return acceptableAttributeValue(value);
  }

  function conversationPathId(pathname) {
    var summary = SUMMARY_PATH.exec(pathname);
    if (summary) return { id: summary[1], source: 'summary' };
    var stream = STREAM_PATH.exec(pathname);
    if (stream) return { id: stream[1], source: 'stream' };
    return null;
  }

  function resolveUrl(raw) {
    try {
      return new URL(String(raw), window.location.href);
    } catch (error) {
      return null;
    }
  }

  function requestMethod(input, init) {
    var method = (init && init.method) || (input && typeof input === 'object' && input.method) || 'GET';
    return String(method).toUpperCase();
  }

  function isLanguageDescriptor(descriptor) {
    if (!descriptor || typeof descriptor !== 'object') return false;
    if (String(descriptor.id) === LANGUAGE_ATTRIBUTE_ID) return true;
    return String(descriptor.name || '').trim().toLowerCase() === LANGUAGE_ATTRIBUTE_NAME;
  }

  function isCompanyDescriptor(descriptor) {
    if (!descriptor || typeof descriptor !== 'object') return false;
    return String(descriptor.name || '').trim().toLowerCase() === COMPANY_ATTRIBUTE_NAME;
  }

  function parseTeamAssigneeId(payload) {
    if (!payload || typeof payload !== 'object') return null;
    var team = payload.team_assignee;
    if (!team || typeof team !== 'object') return null;
    if (team.is_redacted === true) return null;
    if (team.id === undefined || team.id === null) return null;
    var id = String(team.id);
    return TEAM_ID_TOKEN.test(id) ? id : null;
  }

  function summaryAttributeLabel(attribute, token) {
    var descriptor = attribute.descriptor;
    var options = descriptor && Array.isArray(descriptor.options) ? descriptor.options : null;
    if (options) {
      for (var i = 0; i < options.length; i += 1) {
        var option = options[i];
        if (!option || String(option.id) !== String(attribute.value)) continue;
        return acceptableAttributeValue(option.label || option.name || option.value, token);
      }
    }
    return acceptableAttributeValue(attribute.value, token);
  }

  function parseSummaryAttribute(payload, matchesDescriptor, token) {
    if (!payload || typeof payload !== 'object') return null;
    if (!Array.isArray(payload.attributes)) return null;
    for (var i = 0; i < payload.attributes.length; i += 1) {
      var attribute = payload.attributes[i];
      if (attribute && matchesDescriptor(attribute.descriptor)) {
        return summaryAttributeLabel(attribute, token);
      }
    }
    return null;
  }

  function parseSummaryLanguage(payload) {
    return parseSummaryAttribute(payload, isLanguageDescriptor);
  }

  function parseSummaryCompany(payload) {
    var company = parseSummaryAttribute(payload, isCompanyDescriptor, COMPANY_VALUE_TOKEN);
    return company && !OPTION_ID_TOKEN.test(company) ? company : null;
  }

  function streamPartOrder(part) {
    var numeric = Number(part.id);
    if (Number.isFinite(numeric)) return numeric;
    var stamped = Date.parse(part.created_at);
    return Number.isFinite(stamped) ? stamped : null;
  }

  function parseStreamAttribute(payload, conversationId, matchesDescriptor, token) {
    if (!payload || typeof payload !== 'object') return null;
    if (String(payload.id) !== conversationId) return null;
    if (!Array.isArray(payload.renderable_parts)) return null;

    var best = null;
    for (var i = 0; i < payload.renderable_parts.length; i += 1) {
      var part = payload.renderable_parts[i];
      if (!part || part.renderable_type !== ATTRIBUTE_RENDERABLE_TYPE) continue;
      var data = part.renderable_data;
      if (!data || !matchesDescriptor(data.attribute_summary)) continue;
      var value = acceptableAttributeValue(data.value, token);
      if (!value) continue;
      var order = streamPartOrder(part);
      if (order === null) return null;
      if (!best || order > best.order) best = { order: order, value: value };
    }
    return best ? best.value : null;
  }

  function parseStreamLanguage(payload, conversationId) {
    return parseStreamAttribute(payload, conversationId, isLanguageDescriptor);
  }

  function parseStreamCompany(payload, conversationId) {
    return parseStreamAttribute(payload, conversationId, isCompanyDescriptor, COMPANY_VALUE_TOKEN);
  }

  function isEscalationStatusDescriptor(descriptor) {
    if (!descriptor || typeof descriptor !== 'object') return false;
    return String(descriptor.name || '').trim().toLowerCase() === ESCALATION_STATUS_ATTRIBUTE_NAME;
  }

  function parseStreamEscalationStatus(payload, conversationId) {
    if (!payload || typeof payload !== 'object') return null;
    if (String(payload.id) !== conversationId) return null;
    if (!Array.isArray(payload.renderable_parts)) return null;

    var best = null;
    for (var i = 0; i < payload.renderable_parts.length; i += 1) {
      var part = payload.renderable_parts[i];
      if (!part || part.renderable_type !== ATTRIBUTE_RENDERABLE_TYPE) continue;
      var data = part.renderable_data;
      if (!data || !isEscalationStatusDescriptor(data.attribute_summary)) continue;
      var order = streamPartOrder(part);
      if (order === null) return null;
      if (!best || order > best.order) best = { order: order, value: data.value };
    }
    if (!best) return null;
    if (best.value === null || best.value === undefined) return { inProgress: false };
    if (typeof best.value !== 'string' || best.value.length > MAX_LANGUAGE_CHARS) return null;
    return { inProgress: best.value.trim().toLowerCase().indexOf(IN_PROGRESS_TEXT) !== -1 };
  }

  function acceptableAddress(value) {
    if (typeof value !== 'string') return null;
    var trimmed = value.trim().toLowerCase();
    if (!trimmed || trimmed.length > MAX_ADDRESS_CHARS) return null;
    return ADDRESS_TOKEN.test(trimmed) ? trimmed : null;
  }

  function earliestCustomerEmailPart(payload) {
    if (!payload || !Array.isArray(payload.renderable_parts)) return null;

    var best = null;
    for (var i = 0; i < payload.renderable_parts.length; i += 1) {
      var part = payload.renderable_parts[i];
      if (!part || part.renderable_type !== CUSTOMER_EMAIL_RENDERABLE_TYPE) continue;
      var data = part.renderable_data;
      if (!data || !data.email_metadata || !data.email_metadata.header_addresses) continue;
      var order = streamPartOrder(part);
      if (order === null) return null;
      if (!best || order < best.order) best = { order: order, part: part };
    }
    return best ? best.part : null;
  }

  function parseConversationIdentity(payload) {
    if (!payload || typeof payload !== 'object') return null;
    var summary = payload.user_summary;
    if (!summary || typeof summary !== 'object') return null;
    if (summary.is_redacted === true) return null;

    var identity = { email: acceptableAddress(summary.email) };
    return identity.email ? identity : null;
  }

  function parseInboundAddresses(payload, conversationId) {
    if (!payload || typeof payload !== 'object') return null;
    if (String(payload.id) !== conversationId) return null;

    var part = earliestCustomerEmailPart(payload);
    if (!part) return null;

    var headers = part.renderable_data.email_metadata.header_addresses;
    var customerAddress = payload.user_summary
      ? acceptableAddress(payload.user_summary.email)
      : null;

    var addresses = [];
    for (var h = 0; h < ADDRESS_HEADERS.length; h += 1) {
      var entries = headers[ADDRESS_HEADERS[h]];
      if (!Array.isArray(entries)) continue;
      for (var i = 0; i < entries.length; i += 1) {
        if (!entries[i]) continue;
        var address = acceptableAddress(entries[i].email);
        if (!address || address === customerAddress) continue;
        if (addresses.indexOf(address) === -1) addresses.push(address);
        if (addresses.length === MAX_ADDRESSES) return addresses;
      }
    }
    return addresses.length ? addresses : null;
  }

  function postListIdentities(inboxType, inboxId, state, identities) {
    var envelope = {};
    envelope[MARKER] = true;
    envelope.version = ENVELOPE_VERSION;
    envelope.kind = LIST_IDENTITY_KIND;
    envelope.inboxType = inboxType;
    envelope.inboxId = inboxId;
    envelope.state = state;
    envelope.inboxKey = inboxType + ':' + inboxId + ':' + state;
    envelope.identities = identities;
    send(envelope);
  }

  function parseListIdentities(payload) {
    if (!payload || typeof payload !== 'object') return null;
    if (!Array.isArray(payload.conversations)) return null;

    var identities = [];
    for (var i = 0; i < payload.conversations.length; i += 1) {
      var conversation = payload.conversations[i];
      if (!conversation || typeof conversation !== 'object') continue;

      var conversationId = String(conversation.id);
      if (!CONVERSATION_ID_TOKEN.test(conversationId)) continue;

      var summary = conversation.user_summary;
      if (!summary || typeof summary !== 'object') continue;

      var contactId = String(summary.id);
      if (!CONTACT_ID_TOKEN.test(contactId)) continue;

      var identity = { conversationId: conversationId, contactId: contactId.toLowerCase() };
      var email = acceptableAddress(summary.email);
      if (email) identity.email = email;

      identities.push(identity);
      if (identities.length === MAX_LIST_IDENTITIES) break;
    }
    return identities.length ? identities : null;
  }

  function observeListResponse(response, requestUrl, listState) {
    readJsonResponse(response, requestUrl, function (payload) {
      var identities = parseListIdentities(payload);
      if (identities) postListIdentities(listState.inboxType, listState.inboxId, listState.state, identities);
    });
  }

  function validCountValue(value) {
    return typeof value === 'number' && value >= 0 &&
      value <= MAX_COUNT_VALUE && Math.floor(value) === value;
  }

  function parseInboxCounts(payload) {
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.inboxes)) return null;

    var counts = [];
    for (var i = 0; i < payload.inboxes.length && counts.length < MAX_INBOX_COUNT_ENTRIES; i += 1) {
      var inbox = payload.inboxes[i];
      if (!inbox || typeof inbox !== 'object') continue;
      var id = String(inbox.id === undefined ? '' : inbox.id);
      var type = String(inbox.inbox_type || '');
      var count = typeof inbox.count === 'number'
        ? inbox.count
        : inbox.count && typeof inbox.count === 'object' ? inbox.count.count : undefined;
      if (!INBOX_ID_TOKEN.test(id)) continue;
      if (!INBOX_TYPE_TOKEN.test(type)) continue;
      if (!validCountValue(count)) continue;
      counts.push({ inboxType: type, inboxId: id, count: count });
    }
    return counts.length ? counts : null;
  }

  function postInboxCounts(counts) {
    var envelope = {};
    envelope[MARKER] = true;
    envelope.version = ENVELOPE_VERSION;
    envelope.kind = COUNTS_KIND;
    envelope.counts = counts;
    envelope.observedAt = Date.now();
    send(envelope);
  }

  function observeInboxesResponse(response, requestUrl) {
    readJsonResponse(response, requestUrl, function (payload) {
      var counts = parseInboxCounts(payload);
      if (counts) postInboxCounts(counts);
    });
  }

  function parseTeamDirectory(payload) {
    var results = payload && payload.teams && Array.isArray(payload.teams.results) ? payload.teams.results : null;
    if (!results) return null;
    var teams = [];
    for (var i = 0; i < results.length && teams.length < MAX_TEAM_DIRECTORY_ENTRIES; i += 1) {
      var team = results[i];
      if (!team || typeof team !== 'object' || team.is_redacted === true) continue;
      var id = String(team.id === undefined || team.id === null ? '' : team.id);
      var name = typeof team.name === 'string' ? team.name.trim() : '';
      if (!TEAM_ID_TOKEN.test(id)) continue;
      if (!name || name.length > MAX_TEAM_NAME_CHARS || /[\u0000-\u001f]/.test(name)) continue;
      teams.push({ id: id, name: name });
    }
    return teams.length ? teams : null;
  }

  function postTeamDirectory(teams) {
    var envelope = {};
    envelope[MARKER] = true;
    envelope.version = ENVELOPE_VERSION;
    envelope.kind = TEAM_DIRECTORY_KIND;
    envelope.teams = teams;
    envelope.observedAt = Date.now();
    send(envelope);
  }

  function observeAssigneesResponse(response, requestUrl) {
    readJsonResponse(response, requestUrl, function (payload, finalUrl) {
      if (!ASSIGNEES_PATH.test(finalUrl.pathname)) return;
      var teams = parseTeamDirectory(payload);
      if (teams) postTeamDirectory(teams);
    });
  }

  function parseAttributeVisibility(payload, matchesDescriptor) {
    if (!Array.isArray(payload)) return null;
    var live = payload.filter(function (descriptor) {
      return matchesDescriptor(descriptor) && descriptor.archived !== true;
    });
    if (live.length !== 1) return null;
    var teams = live[0].visible_to_team_ids;
    if (teams === null || teams === undefined) return { teamIds: null };
    if (!Array.isArray(teams) || teams.length > MAX_TEAM_DIRECTORY_ENTRIES) return null;
    var teamIds = [];
    for (var i = 0; i < teams.length; i += 1) {
      var id = String(teams[i] === undefined || teams[i] === null ? '' : teams[i]);
      if (!TEAM_ID_TOKEN.test(id)) return null;
      if (teamIds.indexOf(id) === -1) teamIds.push(id);
    }
    return { teamIds: teamIds };
  }

  function postEscalationStatusVisibility(visibility) {
    var envelope = {};
    envelope[MARKER] = true;
    envelope.version = ENVELOPE_VERSION;
    envelope.kind = ESCALATION_STATUS_VISIBILITY_KIND;
    envelope.teamIds = visibility.teamIds;
    envelope.observedAt = Date.now();
    send(envelope);
  }

  function observeDescriptorsResponse(response, requestUrl) {
    readJsonResponse(response, requestUrl, function (payload, finalUrl) {
      if (!DESCRIPTORS_PATH.test(finalUrl.pathname)) return;
      var statusVisibility = parseAttributeVisibility(payload, isEscalationStatusDescriptor);
      if (statusVisibility) postEscalationStatusVisibility(statusVisibility);
    });
  }

  function postNexusFrame(url, text) {
    var envelope = {};
    envelope[MARKER] = true;
    envelope.version = ENVELOPE_VERSION;
    envelope.kind = NEXUS_KIND;
    envelope.url = url;
    envelope.data = text;
    envelope.observedAt = Date.now();
    send(envelope);
  }

  function acceptableCountry(value) {
    if (typeof value !== 'string') return null;
    var trimmed = value.trim().toUpperCase();
    return COUNTRY_TOKEN.test(trimmed) ? trimmed : null;
  }

  function parseContactLanguage(payload, userId) {
    if (!payload || typeof payload !== 'object') return null;
    if (!Array.isArray(payload.users) || !payload.users.length) return null;

    var user = payload.users[0];
    if (!user || typeof user !== 'object') return null;
    if (String(user.id) !== userId) return null;

    var geoip = user.geoip_data && typeof user.geoip_data === 'object' ? user.geoip_data : {};
    var custom = user.custom_data && typeof user.custom_data === 'object' ? user.custom_data : {};

    var tokens = {
      languageOverride: acceptableLanguage(user.language_override),
      browserLocale: acceptableLanguage(user.browser_locale),
      countryCode: acceptableCountry(geoip.country_code2) || acceptableCountry(custom.profile_country)
    };

    return tokens;
  }

  function readJsonResponse(response, requestUrl, onPayload) {
    if (!response || typeof response.clone !== 'function') return;
    if (response.status !== 200) return;

    var finalUrl = resolveUrl(response.url || requestUrl.href);
    if (!finalUrl || finalUrl.origin !== window.location.origin) return;

    var headers = response.headers;
    var contentType = headers && typeof headers.get === 'function' ? headers.get('content-type') : '';
    if (String(contentType || '').indexOf('json') === -1) return;
    var declaredLength = headers && typeof headers.get === 'function' ? Number(headers.get('content-length')) : NaN;
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PAYLOAD_CHARS) return;

    var clone;
    try {
      clone = response.clone();
    } catch (error) {
      return;
    }

    clone.text().then(function (text) {
      if (typeof text !== 'string' || !text || text.length > MAX_PAYLOAD_CHARS) return;
      onPayload(JSON.parse(text), finalUrl, response);
    }).catch(function () {});
  }

  function observeUserResponse(response, requestUrl, userId) {
    readJsonResponse(response, requestUrl, function (payload, finalUrl) {
      var finalMatch = USER_PATH.exec(finalUrl.pathname);
      if (!finalMatch || finalMatch[1] !== userId) return;
      var tokens = parseContactLanguage(payload, userId);
      if (tokens) postContactLanguage(userId, tokens);
    });
  }

  function observeResponse(response, requestUrl, match) {
    readJsonResponse(response, requestUrl, function (payload, finalUrl) {
      var finalMatch = conversationPathId(finalUrl.pathname);
      if (!finalMatch || finalMatch.id !== match.id || finalMatch.source !== match.source) return;
      var language = match.source === 'summary'
        ? parseSummaryLanguage(payload)
        : parseStreamLanguage(payload, match.id);
      if (language) post(match.id, language, match.source);

      var company = match.source === 'summary'
        ? parseSummaryCompany(payload)
        : parseStreamCompany(payload, match.id);
      if (company) postCompany(match.id, company, match.source);

      var identity = parseConversationIdentity(payload);
      if (identity) postIdentity(match.id, identity, match.source);

      if (match.source === 'summary') {
        var teamId = parseTeamAssigneeId(payload);
        if (teamId) postTeam(match.id, teamId, match.source);
        var conversationState = parseConversationState(payload);
        if (conversationState) postConversationState(match.id, conversationState);
      }

      if (match.source !== 'stream') return;
      var escalationStatus = parseStreamEscalationStatus(payload, match.id);
      if (escalationStatus) postEscalationStatus(match.id, escalationStatus.inProgress, match.source);
      var addresses = parseInboundAddresses(payload, match.id);
      if (addresses) postAddresses(match.id, addresses, match.source);
    });
  }

  var originalFetch = window.fetch;
  if (typeof originalFetch !== 'function') return;

  window.fetch = function (input, init) {
    var thisArg = this;
    var raw = (input && typeof input === 'object' && input.url) ? input.url : input;
    var requestUrl = resolveUrl(raw);
    var method = requestMethod(input, init);

    if (requestUrl && requestUrl.origin === window.location.origin
      && method === 'POST' && TEMP_NOTE_CREATE_PATH.test(requestUrl.pathname)
      && temporaryNoteArm && temporaryWorkspaceFromUrl(requestUrl) === temporaryNoteArm.workspace) {
      var arm = temporaryNoteArm;
      if (arm.pending || arm.uncertain || arm.needsRearm) {
        postTemporaryNote('temporary-note-save', {
          token: arm.token,
          revision: arm.revision,
          status: 'blocked',
          reason: arm.uncertain ? 'save-uncertain' : arm.pending ? 'save-pending' : 'rearm-required'
        });
        return Promise.reject(new Error('Temporary note submission is not armed for another attempt'));
      }
      if (arm.href !== window.location.href) {
        temporaryNoteSaveError(arm, 'blocked', 'contact-changed');
        return Promise.reject(new Error('Temporary note contact changed before submission'));
      }
      var submittedAt = Date.now();
      var expiresAt = arm.lifetime.mode === 'relative'
        ? submittedAt + arm.lifetime.delayMs
        : Date.parse(arm.lifetime.expiresAt);
      if (!Number.isFinite(expiresAt)) {
        temporaryNoteSaveError(arm, 'blocked', 'footer-unavailable');
        return Promise.reject(new Error('Temporary note expiry could not be resolved'));
      }
      if (expiresAt < submittedAt + TEMP_NOTE_MIN_LIFETIME_MS) {
        temporaryNoteSaveError(arm, 'blocked', 'expiry-in-past');
        return Promise.reject(new Error('Temporary note expiry has already passed'));
      }
      if (expiresAt > submittedAt + TEMP_NOTE_MAX_LIFETIME_MS) {
        temporaryNoteSaveError(arm, 'blocked', 'expiry-out-of-range');
        return Promise.reject(new Error('Temporary note expiry is beyond the maximum lifetime'));
      }
      var footer = temporaryNoteFooter(arm, expiresAt);
      if (!footer) {
        temporaryNoteSaveError(arm, 'blocked', 'footer-unavailable');
        return Promise.reject(new Error('Temporary note expiry footer is unavailable'));
      }
      return temporaryNoteBody(input, init).then(function (bodyInfo) {
        if (!bodyInfo.supported) {
          temporaryNoteSaveError(arm, 'blocked', 'request-body-unreadable');
          throw new Error('Temporary note request body is unreadable');
        }
        return invokeTemporaryNoteCreate(input, init, arm, bodyInfo.text, footer, originalFetch, thisArg);
      });
    }

    var result = originalFetch.apply(this, arguments);

    try {
      var isInboxesPoll = requestUrl && INBOXES_PATH.test(requestUrl.pathname);
      if (requestUrl
        && requestUrl.origin === window.location.origin
        && (method === 'GET' || isInboxesPoll)) {
        var noteRequest = temporaryNoteRequestInfo(requestUrl);
        if (noteRequest && method === 'GET') {
          result.then(function (response) {
            try {
              observeTemporaryNotesResponse(response, requestUrl, noteRequest);
            } catch (error) {}
          }).catch(function () {});
        }
        var match = conversationPathId(requestUrl.pathname);
        if (match) {
          result.then(function (response) {
            try {
              observeResponse(response, requestUrl, match);
            } catch (error) {}
          }).catch(function () {});
        } else if (LIST_PATH.test(requestUrl.pathname)) {
          var listState = listStateFromQuery(requestUrl);
          if (listState) {
            postListState(listState.inboxType, listState.inboxId, listState.state);
            (function (state) {
              result.then(function (response) {
                try {
                  observeListResponse(response, requestUrl, state);
                } catch (error) {}
              }).catch(function () {});
            }(listState));
          }
        } else if (isInboxesPoll) {
          result.then(function (response) {
            try {
              observeInboxesResponse(response, requestUrl);
            } catch (error) {}
          }).catch(function () {});
        } else if (method === 'GET' && ASSIGNEES_PATH.test(requestUrl.pathname)) {
          result.then(function (response) {
            try {
              observeAssigneesResponse(response, requestUrl);
            } catch (error) {}
          }).catch(function () {});
        } else if (method === 'GET' && DESCRIPTORS_PATH.test(requestUrl.pathname)) {
          result.then(function (response) {
            try {
              observeDescriptorsResponse(response, requestUrl);
            } catch (error) {}
          }).catch(function () {});
        } else {
          var userMatch = USER_PATH.exec(requestUrl.pathname);
          if (userMatch) {
            (function (userId) {
              result.then(function (response) {
                try {
                  observeUserResponse(response, requestUrl, userId);
                  observeTemporaryContactResponse(response, requestUrl, userId);
                } catch (error) {}
              }).catch(function () {});
            }(userMatch[1]));
          }
        }
      }
    } catch (error) {}

    return result;
  };

  var OriginalWebSocket = window.WebSocket;
  if (typeof OriginalWebSocket === 'function') {
    var WrappedWebSocket = function (url, protocols) {
      var socket = protocols === undefined
        ? new OriginalWebSocket(url)
        : new OriginalWebSocket(url, protocols);
      try {
        if (WS_URL_PATTERN.test(String(url || ''))) {
          socket.addEventListener('message', function (event) {
            try {
              if (typeof event.data !== 'string') return;
              if (event.data.length > MAX_PAYLOAD_CHARS) return;
              if (!WS_FRAME_PATTERN.test(event.data)) return;
              postNexusFrame(String(url || ''), event.data);
            } catch (error) {}
          });
        }
      } catch (error) {}
      return socket;
    };
    WrappedWebSocket.prototype = OriginalWebSocket.prototype;
    for (var wsKey in OriginalWebSocket) {
      try { WrappedWebSocket[wsKey] = OriginalWebSocket[wsKey]; } catch (error) {}
    }
    window.WebSocket = WrappedWebSocket;
  }
}());
