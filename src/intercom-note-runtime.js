const NOTE_RUNTIME_CHECK_INTERVAL_MS = 60000;
const NOTE_RUNTIME_OBSERVED_DEBOUNCE_MS = 1500;
const NOTE_RUNTIME_MAX_RESPONSE_CHARS = 200000;
const NOTE_RUNTIME_ID_TOKEN = /^\d{1,32}$/;
const NOTE_RUNTIME_CARD_TESTID = /^note-(\d{1,32})$/;
const NOTE_RUNTIME_REFERENCE_KEYS = ['note_ids', 'notes'];
const NOTE_RUNTIME_WORKSPACE_TOKEN = /^[A-Za-z0-9_-]{1,64}$/;
const NOTE_RUNTIME_CONTACT_TOKEN = /^[a-f0-9]{24}$/;

let noteRuntimeController = null;
let noteRuntimeInitialized = false;
let noteRuntimeObservedTimer = null;
let noteRuntimeContextKey = null;
let noteRuntimeStatus = null;
let noteRuntimeLastCheckAt = 0;

function noteRuntimeRequestHeaders() {
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  const csrf = document.querySelector('meta[name="csrf-token"]');
  const revision = document.querySelector('meta[name="embercom_revision_id"]');
  if (csrf && csrf.content) headers['X-CSRF-Token'] = csrf.content;
  if (revision && revision.content) headers['X-EMBERCOM-REVISION-ID'] = revision.content;
  return headers;
}

function noteRuntimeUrl(path, params) {
  const url = new URL(path, window.location.origin);
  Object.keys(params).forEach((key) => {
    const value = params[key];
    if (Array.isArray(value)) value.forEach(entry => url.searchParams.append(key, entry));
    else url.searchParams.set(key, value);
  });
  return url.toString();
}

function noteRuntimeRequest(path, params, method) {
  return fetch(noteRuntimeUrl(path, params), {
    method,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: noteRuntimeRequestHeaders()
  });
}

async function noteRuntimeJson(response) {
  const text = await response.text();
  if (typeof text !== 'string' || !text || text.length > NOTE_RUNTIME_MAX_RESPONSE_CHARS) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function noteRuntimeReferenceContainers(payload) {
  const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  if (!source) return [];
  const containers = [source];
  const user = Array.isArray(source.users) ? source.users[0] : null;
  if (user && typeof user === 'object' && !Array.isArray(user)) containers.push(user);
  return containers;
}

function noteRuntimeReferenceIds(payload) {
  const ids = [];
  let found = false;
  for (const container of noteRuntimeReferenceContainers(payload)) {
    for (const key of NOTE_RUNTIME_REFERENCE_KEYS) {
      if (!Array.isArray(container[key])) continue;
      found = true;
      for (const entry of container[key]) {
        const id = String(entry && typeof entry === 'object' ? entry.id : entry);
        if (!NOTE_RUNTIME_ID_TOKEN.test(id) || ids.includes(id)) continue;
        ids.push(id);
      }
    }
  }
  return found ? ids : null;
}

function noteRuntimeSidebarIds() {
  const context = typeof temporaryNoteContext === 'function' ? temporaryNoteContext() : null;
  if (!context) return [];
  const ids = [];
  for (const row of context.sidebar.querySelectorAll('[data-testid^="note-"]')) {
    const id = NOTE_RUNTIME_CARD_TESTID.exec(row.getAttribute('data-testid') || '')?.[1];
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function noteRuntimeNote(payload, expectedId) {
  const entries = Array.isArray(payload) ? payload
    : Array.isArray(payload && payload.notes) ? payload.notes : [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const id = String(entry.id === undefined || entry.id === null ? '' : entry.id);
    if (id !== expectedId || typeof entry.body !== 'string') continue;
    const createdAt = entry.created_at || entry.createdAt;
    const updatedAt = entry.updated_at || entry.updatedAt;
    if (typeof createdAt !== 'string' || typeof updatedAt !== 'string') continue;
    return { id, body: entry.body, createdAt, updatedAt };
  }
  return null;
}

function noteRuntimeSendMessage(message) {
  return new Promise((resolve) => {
    if (!alertRuntimeAlive()) {
      resolve({ ok: false, reason: 'runtime-unavailable' });
      return;
    }
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError || !response) {
          resolve({ ok: false, reason: 'runtime-unavailable' });
          return;
        }
        resolve(response);
      });
    } catch (error) {
      resolve({ ok: false, reason: 'runtime-unavailable' });
    }
  });
}

const noteRuntimeAdapter = {
  readReferences: async (context) => {
    const response = await noteRuntimeRequest(`/ember/users/${context.contactId}`,
      { app_id: context.workspaceId }, 'GET');
    if (!response.ok) return { status: response.status };
    const serverDate = response.headers.get('date');
    const ids = noteRuntimeReferenceIds(await noteRuntimeJson(response));
    if (ids) return { ids, serverDate };
    const sidebarIds = noteRuntimeSidebarIds();
    if (sidebarIds.length) return { ids: sidebarIds, serverDate };
    debugLog('[Note cleanup] no note references in the contact payload');
    return { status: response.status };
  },
  readNote: async (noteId, context) => {
    const response = await noteRuntimeRequest('/ember/inbox/notes',
      { app_id: context.workspaceId, 'ids[]': [noteId] }, 'GET');
    if (response.status === 404) noteRuntimeForgetNote(noteId);
    if (!response.ok) return null;
    return noteRuntimeNote(await noteRuntimeJson(response), noteId);
  },
  deleteNote: async (noteId, context) => {
    const response = await noteRuntimeRequest(`/ember/notes/${noteId}`,
      { app_id: context.workspaceId }, 'DELETE');
    return { status: response.status, headers: { 'retry-after': response.headers.get('retry-after') } };
  },
  acquireLease: request => noteRuntimeSendMessage({
    type: 'isa-note-lease-acquire',
    workspaceId: request.workspaceId,
    contactId: request.contactId,
    noteId: request.noteId
  }),
  releaseLease: request => noteRuntimeSendMessage({
    type: 'isa-note-lease-release',
    workspaceId: request.workspaceId,
    contactId: request.contactId,
    noteId: request.noteId,
    ownerToken: request.ownerToken
  })
};

function noteRuntimeForgetNote(noteId) {
  if (typeof hideDeletedTemporaryNoteCard !== 'function') return;
  safeExecute(() => hideDeletedTemporaryNoteCard(noteId), 'hideDeletedTemporaryNoteCard');
}

function noteRuntimeCleanupController() {
  if (noteRuntimeController) return noteRuntimeController;
  if (!window.ISA_NOTE_CLEANUP || !window.ISA_TEMPORARY_NOTES) return null;
  noteRuntimeController = window.ISA_NOTE_CLEANUP.createController({
    adapter: noteRuntimeAdapter,
    footer: window.ISA_TEMPORARY_NOTES,
    onStatus: (value) => {
      noteRuntimeStatus = value;
      debugLog('[Note cleanup]', value);
    },
    onConfirmedDeleted: result => noteRuntimeForgetNote(result.noteId),
    onAlreadyDeleted: result => noteRuntimeForgetNote(result.noteId)
  });
  return noteRuntimeController;
}

function noteRuntimeCurrentContext() {
  const context = temporaryNoteContext();
  if (!context) return null;
  if (!NOTE_RUNTIME_WORKSPACE_TOKEN.test(context.workspace)) return null;
  if (!NOTE_RUNTIME_CONTACT_TOKEN.test(context.contact)) return null;
  return {
    workspaceId: context.workspace,
    contactId: context.contact,
    visible: document.visibilityState !== 'hidden'
  };
}

function noteRuntimeCheck() {
  const controller = noteRuntimeCleanupController();
  if (!controller) {
    return;
  }
  if (temporaryNoteCleanupPaused) {
    if (!controller.isPaused()) controller.pause('setting');
    return;
  }
  if (controller.isPaused()) controller.resume();
  noteRuntimeLastCheckAt = Date.now();
  Promise.resolve(controller.checkNow()).catch(() => {});
}

function noteRuntimeCheckWhenDue() {
  if (Date.now() - noteRuntimeLastCheckAt < NOTE_RUNTIME_CHECK_INTERVAL_MS) return;
  noteRuntimeCheck();
}

function refreshTemporaryNoteCleanupContext() {
  const controller = noteRuntimeCleanupController();
  if (!controller) return;
  const context = noteRuntimeCurrentContext();
  const key = context ? `${context.workspaceId}/${context.contactId}/${context.visible}` : null;
  if (key === noteRuntimeContextKey) {
    if (context && context.visible) noteRuntimeCheckWhenDue();
    return;
  }
  noteRuntimeContextKey = key;
  if (!context) {
    controller.stop();
    return;
  }
  controller.setContext(context);
  if (context.visible) noteRuntimeCheck();
}

function scheduleTemporaryNoteCleanupFromObservation() {
  if (noteRuntimeObservedTimer) return;
  noteRuntimeObservedTimer = setTimeout(() => {
    noteRuntimeObservedTimer = null;
    safeExecute(() => {
      refreshTemporaryNoteCleanupContext();
      noteRuntimeCheck();
    }, 'scheduleTemporaryNoteCleanupFromObservation');
  }, NOTE_RUNTIME_OBSERVED_DEBOUNCE_MS);
}

function initTemporaryNoteCleanup() {
  if (noteRuntimeInitialized) return;
  noteRuntimeInitialized = true;
  document.addEventListener('visibilitychange', () => safeExecute(
    refreshTemporaryNoteCleanupContext,
    'temporaryNoteCleanupVisibility'
  ));
  refreshTemporaryNoteCleanupContext();
}

window.ISA_NOTE_RUNTIME = {
  adapter: noteRuntimeAdapter,
  refreshContext: refreshTemporaryNoteCleanupContext,
  check: noteRuntimeCheck,
  observed: scheduleTemporaryNoteCleanupFromObservation,
  getController: noteRuntimeCleanupController,
  getStatus: () => noteRuntimeStatus
};
