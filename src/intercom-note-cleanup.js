'use strict';

const ISA_NOTE_CLEANUP_INTERVAL_MS = 60000;
const ISA_NOTE_CLEANUP_LEASE_MS = 60000;
const ISA_NOTE_CLEANUP_TIMEOUT_MS = 15000;
const ISA_NOTE_CLEANUP_MIN_GAP_MS = 1000;
const ISA_NOTE_CLEANUP_MAX_ATTEMPTS = 3;
const ISA_NOTE_CLEANUP_RETRY_DELAYS_MS = [30000, 120000];

function cleanupTimestamp(value) {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp = Date.parse(value.trim());
  return Number.isFinite(timestamp) ? timestamp : null;
}

function cleanupServerNow(value) {
  if (typeof value === 'string' || value instanceof Date || typeof value === 'number') {
    return cleanupTimestamp(value);
  }
  if (!value || typeof value !== 'object') return null;
  const direct = value.serverDate !== undefined ? value.serverDate
    : value.dateHeader !== undefined ? value.dateHeader
      : value.serverNow !== undefined ? value.serverNow : undefined;
  if (direct !== undefined) return cleanupTimestamp(direct);
  if (value.headers && typeof value.headers === 'object') {
    const header = value.headers.date || value.headers.Date;
    return cleanupTimestamp(header);
  }
  return null;
}

function cleanupResultStatus(errorOrResult) {
  if (!errorOrResult || typeof errorOrResult !== 'object') return null;
  const status = errorOrResult.status !== undefined ? errorOrResult.status : errorOrResult.statusCode;
  return Number.isInteger(status) ? status : null;
}

function cleanupRetryAfter(value, now) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value * 1000;
  if (typeof value !== 'string' || !value.trim()) return null;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : null;
  const timestamp = cleanupTimestamp(value);
  if (timestamp === null) return null;
  return Math.max(0, timestamp - now);
}

function cleanupHeaders(value) {
  if (!value || typeof value !== 'object') return {};
  if (value.headers && typeof value.headers === 'object') return value.headers;
  return value;
}

function cleanupIdentity(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) ? value : null;
}

function cleanupContext(value) {
  if (!value || typeof value !== 'object') return null;
  const workspaceId = cleanupIdentity(value.workspaceId);
  const contactId = cleanupIdentity(value.contactId);
  if (!workspaceId || !contactId) return null;
  return {
    workspaceId,
    contactId,
    visible: value.visible !== false,
    key: `${workspaceId}/${contactId}`
  };
}

function cleanupIds(result) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.ids)) return null;
  const ids = [];
  for (const id of result.ids) {
    if (id === null || id === undefined) continue;
    const normalized = cleanupIdentity(String(id));
    if (!normalized || ids.includes(normalized)) return null;
    ids.push(normalized);
  }
  return ids;
}

function cleanupNote(note, expectedId) {
  if (!note || typeof note !== 'object') return null;
  const id = cleanupIdentity(String(note.id));
  if (!id || id !== expectedId || typeof note.body !== 'string') return null;
  if (cleanupTimestamp(note.createdAt) === null || cleanupTimestamp(note.updatedAt) === null) return null;
  return {
    id,
    body: note.body,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    version: note.version
  };
}

function cleanupNoteSameVersion(left, right) {
  if (!left || !right || left.id !== right.id || left.body !== right.body) return false;
  if (cleanupTimestamp(left.updatedAt) !== cleanupTimestamp(right.updatedAt)) return false;
  if (left.version !== undefined || right.version !== undefined) return left.version === right.version;
  return true;
}

function cleanupFooterApi(value) {
  if (value && typeof value.evaluateEligibility === 'function') return value;
  if (typeof window !== 'undefined' && window.ISA_TEMPORARY_NOTES
    && typeof window.ISA_TEMPORARY_NOTES.evaluateEligibility === 'function') return window.ISA_TEMPORARY_NOTES;
  return null;
}

function createNoteCleanupController(options = {}) {
  const adapter = options.adapter || {};
  const footer = cleanupFooterApi(options.footer);
  const timing = options.timing && typeof options.timing === 'object' ? options.timing : {};
  const timeoutMs = Number.isFinite(timing.timeoutMs) ? timing.timeoutMs : ISA_NOTE_CLEANUP_TIMEOUT_MS;
  const minGapMs = Number.isFinite(timing.minGapMs) ? timing.minGapMs : ISA_NOTE_CLEANUP_MIN_GAP_MS;
  const maxAttempts = Number.isInteger(timing.maxAttempts) && timing.maxAttempts > 0
    ? Math.min(timing.maxAttempts, ISA_NOTE_CLEANUP_MAX_ATTEMPTS) : ISA_NOTE_CLEANUP_MAX_ATTEMPTS;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const schedule = typeof options.setTimeout === 'function' ? options.setTimeout : setTimeout;
  const cancelSchedule = typeof options.clearTimeout === 'function' ? options.clearTimeout : clearTimeout;
  const statusHandler = typeof options.onStatus === 'function' ? options.onStatus : () => {};
  const invalidHandler = typeof options.onInvalid === 'function' ? options.onInvalid : () => {};
  const confirmedHandler = typeof options.onConfirmedDeleted === 'function' ? options.onConfirmedDeleted : () => {};
  const alreadyDeletedHandler = typeof options.onAlreadyDeleted === 'function' ? options.onAlreadyDeleted : () => {};
  const waitOverride = typeof options.wait === 'function' ? options.wait : null;
  const sessions = new Map();
  const blockedWorkspaces = new Set();
  let context = null;
  let paused = options.paused === true;
  let running = null;
  let generation = 0;
  let lastDeleteStart = null;
  let cooldownUntil = 0;

  function status(value) {
    try { statusHandler(value); } catch (error) {}
  }

  function currentContext(expectedGeneration, expectedContext) {
    return generation === expectedGeneration && context && context.key === expectedContext.key
      && context.visible && !paused && !blockedWorkspaces.has(expectedContext.workspaceId);
  }

  function adapterMethod(...names) {
    for (const name of names) {
      if (typeof adapter[name] === 'function') return adapter[name].bind(adapter);
    }
    return null;
  }

  function delay(ms) {
    if (!ms || ms <= 0) return Promise.resolve();
    if (waitOverride) return Promise.resolve(waitOverride(ms));
    return new Promise(resolve => {
      const handle = schedule(resolve, ms);
      if (handle === undefined) return;
    });
  }

  function timedCall(method, args, operation) {
    if (!method) return Promise.reject(Object.assign(new Error(`${operation}-adapter-missing`), { code: 'adapter-missing' }));
    let timer;
    let settled = false;
    const timeout = new Promise((resolve, reject) => {
      timer = schedule(() => {
        if (settled) return;
        settled = true;
        reject(Object.assign(new Error(`${operation}-timeout`), { code: 'timeout' }));
      }, timeoutMs);
    });
    const call = Promise.resolve().then(() => method(...args)).then(value => {
      if (settled) return value;
      settled = true;
      if (timer !== undefined) cancelSchedule(timer);
      return value;
    }, error => {
      if (settled) throw error;
      settled = true;
      if (timer !== undefined) cancelSchedule(timer);
      throw error;
    });
    return Promise.race([call, timeout]).finally(() => {
      if (timer !== undefined) cancelSchedule(timer);
    });
  }

  function referenceServerNow(result) {
    return cleanupServerNow(result && result.serverDate !== undefined ? result.serverDate : result);
  }

  function evaluate(note, ids, serverNow, expected) {
    if (!footer) return { eligible: false, reason: 'footer-api-unavailable' };
    return footer.evaluateEligibility(note, {
      workspaceId: expected.workspaceId,
      contactId: expected.contactId,
      contactNoteIds: ids,
      ownsNote: true,
      serverNow,
      expectedUpdatedAt: expected.expectedUpdatedAt,
      expectedVersion: expected.expectedVersion
    });
  }

  function leaseAcquire(ctx, noteId) {
    const method = adapterMethod('acquireLease', 'acquireNoteLease');
    if (!method) return Promise.resolve({ ok: true, lease: null });
    return timedCall(method, [{ workspaceId: ctx.workspaceId, contactId: ctx.contactId, noteId }], 'lease-acquire')
      .then(result => result && result.ok === true ? result : { ok: false, reason: 'lease-failed' });
  }

  function leaseRelease(ctx, noteId, lease) {
    if (!lease) return Promise.resolve();
    const method = adapterMethod('releaseLease', 'releaseNoteLease');
    if (!method) return Promise.resolve();
    return timedCall(method, [{ workspaceId: ctx.workspaceId, contactId: ctx.contactId, noteId, ownerToken: lease.ownerToken }], 'lease-release')
      .catch(() => {});
  }

  async function readFresh(ctx, expectedGeneration, noteId) {
    const readReferences = adapterMethod('readReferences', 'getNoteReferences');
    const readNote = adapterMethod('readNote', 'getNote');
    const references = await timedCall(readReferences, [ctx], 'read-references');
    const ids = cleanupIds(references);
    const serverNow = referenceServerNow(references);
    if (!ids || serverNow === null) return { ok: false, reason: 'missing-server-time' };
    if (!currentContext(expectedGeneration, ctx)) return { ok: false, reason: 'context-changed' };
    if (!ids.includes(noteId)) return { ok: true, ids, serverNow, note: null, references };
    const rawNote = await timedCall(readNote, [noteId, ctx], 'read-note');
    if (rawNote === null || rawNote === undefined) return { ok: false, reason: 'note-unreadable' };
    const note = cleanupNote(rawNote, noteId);
    if (!note) return { ok: false, reason: 'invalid-note' };
    return { ok: true, ids, serverNow, note, references };
  }

  async function verifyAbsence(ctx, expectedGeneration, noteId) {
    const fresh = await readFresh(ctx, expectedGeneration, noteId);
    if (!fresh.ok) return fresh;
    return { ...fresh, absent: !fresh.note && !fresh.ids.includes(noteId) };
  }

  async function verifyAfterDelete(ctx, expectedGeneration, noteId) {
    try {
      return await verifyAbsence(ctx, expectedGeneration, noteId);
    } catch (error) {
      if (resultKind(error) === 429) {
        rateLimit(error);
        return { ok: false, reason: 'rate-limited' };
      }
      return { ok: false, reason: 'verification-pending' };
    }
  }

  async function waitForGap(expectedGeneration, expectedContext) {
    const currentNow = now();
    const earliest = lastDeleteStart === null ? currentNow : lastDeleteStart + minGapMs;
    const waitMs = Math.max(0, earliest - currentNow);
    if (waitMs > 0) await delay(waitMs);
    if (!currentContext(expectedGeneration, expectedContext)) return false;
    lastDeleteStart = now();
    return true;
  }

  function resultKind(result) {
    const statusCode = cleanupResultStatus(result);
    if (statusCode !== null) return statusCode;
    return cleanupResultStatus(result && result.error);
  }

  function isRetryable(errorOrResult) {
    const statusCode = resultKind(errorOrResult);
    return errorOrResult && errorOrResult.code === 'timeout' || statusCode !== null && statusCode >= 500 && statusCode <= 599;
  }

  function retryAfter(result) {
    const headers = cleanupHeaders(result);
    return headers['retry-after'] ?? headers['Retry-After'];
  }

  function alreadyDeleted(candidate, expectedContext) {
    alreadyDeletedHandler({
      noteId: candidate.note.id,
      workspaceId: expectedContext.workspaceId,
      contactId: expectedContext.contactId
    });
    return { kind: 'already-deleted' };
  }

  function rateLimit(response) {
    const waitMs = cleanupRetryAfter(retryAfter(response), now());
    cooldownUntil = now() + (waitMs === null ? ISA_NOTE_CLEANUP_INTERVAL_MS : waitMs);
    status({ state: 'rate-limited', cooldownUntil });
    return { state: 'rate-limited', cooldownUntil };
  }

  async function deleteCandidate(candidate, ids, expectedContext, expectedGeneration, leaseDeadline) {
    let refreshed;
    try {
      refreshed = await readFresh(expectedContext, expectedGeneration, candidate.note.id);
    } catch (error) {
      if (resultKind(error) === 429) {
        rateLimit(error);
        return { kind: 'rate-limited', cooldownUntil };
      }
      return { kind: error && error.code === 'timeout' ? 'timeout' : 'read-failed' };
    }
    if (!refreshed.ok) return { kind: refreshed.reason };
    if (!refreshed.note) return alreadyDeleted(candidate, expectedContext);
    if (!cleanupNoteSameVersion(candidate.note, refreshed.note)) return { kind: 'stale-version' };
    const eligibility = evaluate(refreshed.note, refreshed.ids, refreshed.serverNow, {
      workspaceId: expectedContext.workspaceId,
      contactId: expectedContext.contactId,
      expectedUpdatedAt: refreshed.note.updatedAt,
      expectedVersion: refreshed.note.version
    });
    if (!eligibility.eligible) return { kind: eligibility.reason };
    if (!currentContext(expectedGeneration, expectedContext)) return { kind: 'context-changed' };
    if (cooldownUntil > now()) return { kind: 'rate-limited', cooldownUntil };
    if (!(await waitForGap(expectedGeneration, expectedContext))) return { kind: 'context-changed' };
    const deleteMethod = adapterMethod('deleteNote');
    let attempt = 0;
    while (attempt < maxAttempts) {
      attempt += 1;
      let response;
      try {
        response = await timedCall(deleteMethod, [candidate.note.id, expectedContext], 'delete-note');
      } catch (error) {
        response = error;
      }
      const statusCode = resultKind(response);
      if (statusCode === 401 || statusCode === 403) {
        blockedWorkspaces.add(expectedContext.workspaceId);
        status({ state: 'auth-stopped', workspaceId: expectedContext.workspaceId });
        return { kind: 'auth-stopped' };
      }
      if (statusCode === 404) {
        const absent = await verifyAfterDelete(expectedContext, expectedGeneration, candidate.note.id);
        if (absent.absent) return alreadyDeleted(candidate, expectedContext);
        if (absent.reason === 'rate-limited') return { kind: 'rate-limited', cooldownUntil };
        return { kind: 'verification-pending' };
      }
      if (statusCode === 429) {
        rateLimit(response);
        return { kind: 'rate-limited', cooldownUntil };
      }
      if (isRetryable(response) && attempt < maxAttempts) {
        const fresh = await verifyAfterDelete(expectedContext, expectedGeneration, candidate.note.id);
        if (!fresh.ok) return { kind: fresh.reason };
        if (fresh.absent) return alreadyDeleted(candidate, expectedContext);
        if (!fresh.note || !cleanupNoteSameVersion(candidate.note, fresh.note)) return { kind: 'stale-version' };
        const retryDelayMs = ISA_NOTE_CLEANUP_RETRY_DELAYS_MS[attempt - 1] || ISA_NOTE_CLEANUP_RETRY_DELAYS_MS[1];
        if (now() + retryDelayMs + timeoutMs > leaseDeadline) return { kind: 'retry-deferred' };
        await delay(retryDelayMs);
        if (!currentContext(expectedGeneration, expectedContext)) return { kind: 'context-changed' };
        const current = await verifyAfterDelete(expectedContext, expectedGeneration, candidate.note.id);
        if (!current.ok) return { kind: current.reason };
        if (current.absent) return alreadyDeleted(candidate, expectedContext);
        if (!current.note || !cleanupNoteSameVersion(candidate.note, current.note)) return { kind: 'stale-version' };
        continue;
      }
      if (isRetryable(response)) return { kind: 'retry-exhausted' };
      if (statusCode === null || statusCode < 200 || statusCode > 299) return { kind: 'unexpected-delete-response' };
      const absent = await verifyAfterDelete(expectedContext, expectedGeneration, candidate.note.id);
      if (absent.reason === 'rate-limited') return { kind: 'rate-limited', cooldownUntil };
      if (!absent.ok) return { kind: 'verification-pending' };
      if (!absent.absent) return { kind: 'verification-pending' };
      confirmedHandler({ noteId: candidate.note.id, workspaceId: expectedContext.workspaceId, contactId: expectedContext.contactId });
      return { kind: 'deleted' };
    }
    return { kind: 'retry-exhausted' };
  }

  async function checkNow() {
    if (running) return running;
    running = (async () => {
      if (!context || !context.visible || paused) return { state: paused ? 'paused' : 'inactive' };
      if (blockedWorkspaces.has(context.workspaceId)) return { state: 'auth-stopped' };
      if (cooldownUntil > now()) return { state: 'rate-limited', cooldownUntil };
      const expectedContext = context;
      const expectedGeneration = generation;
      const readReferences = adapterMethod('readReferences', 'getNoteReferences');
      const readNote = adapterMethod('readNote', 'getNote');
      if (!readReferences || !readNote || !adapterMethod('deleteNote')) return { state: 'adapter-incomplete' };
      let references;
      try {
        references = await timedCall(readReferences, [expectedContext], 'read-references');
      } catch (error) {
        return { state: error.code === 'timeout' ? 'timeout' : 'read-failed' };
      }
      const ids = cleanupIds(references);
      const serverNow = referenceServerNow(references);
      if (!ids || serverNow === null) return { state: 'deferred', reason: 'missing-server-time' };
      const candidates = [];
      for (const id of ids) {
        if (!currentContext(expectedGeneration, expectedContext)) return { state: 'context-changed' };
        let rawNote;
        try {
          rawNote = await timedCall(readNote, [id, expectedContext], 'read-note');
        } catch (error) {
          if (resultKind(error) === 429) return rateLimit(error);
          continue;
        }
        if (rawNote === null || rawNote === undefined) continue;
        const note = cleanupNote(rawNote, id);
        if (!note) continue;
        const eligibility = evaluate(note, ids, serverNow, {
          workspaceId: expectedContext.workspaceId,
          contactId: expectedContext.contactId
        });
        if (eligibility.reason !== 'ordinary-note' && !eligibility.eligible && eligibility.reason !== 'not-expired') {
          if (eligibility.reason !== 'missing-server-time') invalidHandler({ noteId: id, reason: eligibility.reason });
        }
        if (eligibility.eligible) candidates.push({ note, ids });
      }
      const outcomes = [];
      for (const candidate of candidates) {
        if (!currentContext(expectedGeneration, expectedContext)) break;
        let lease;
        try {
          lease = await leaseAcquire(expectedContext, candidate.note.id);
        } catch (error) {
          lease = { ok: false, reason: 'lease-failed' };
        }
        const leaseDeadline = now() + ISA_NOTE_CLEANUP_LEASE_MS;
        if (!lease.ok) {
          outcomes.push({ noteId: candidate.note.id, kind: lease.reason || 'lease-held' });
          continue;
        }
        try {
          const outcome = await deleteCandidate(candidate, candidate.ids, expectedContext, expectedGeneration, leaseDeadline);
          outcomes.push({ noteId: candidate.note.id, kind: outcome.kind });
          if (outcome.kind === 'auth-stopped' || outcome.kind === 'rate-limited') break;
        } finally {
          await leaseRelease(expectedContext, candidate.note.id, lease.lease);
        }
      }
      return { state: 'checked', outcomes };
    })();
    try {
      return await running;
    } finally {
      running = null;
    }
  }

  function setContext(value) {
    const next = cleanupContext(value);
    generation += 1;
    if (!next || !context || next.key !== context.key) sessions.clear();
    context = next;
    return context;
  }

  function setVisible(value) {
    if (!context) return;
    context = { ...context, visible: value === true };
    generation += 1;
  }

  function pause(reason = 'paused') {
    paused = true;
    status({ state: 'paused', reason });
    return paused;
  }

  function resume() {
    paused = false;
    status({ state: 'resumed' });
    return paused;
  }

  function stop() {
    generation += 1;
    context = null;
  }

  return {
    start: setContext,
    stop,
    setContext,
    setVisible,
    checkNow,
    pause,
    resume,
    isPaused: () => paused,
    getState: () => ({
      paused,
      visible: Boolean(context && context.visible),
      workspaceId: context && context.workspaceId,
      contactId: context && context.contactId,
      cooldownUntil,
      blockedWorkspaceIds: Array.from(blockedWorkspaces),
      checkIntervalMs: ISA_NOTE_CLEANUP_INTERVAL_MS,
      leaseTtlMs: ISA_NOTE_CLEANUP_LEASE_MS,
      timeoutMs,
      maxAttempts
    })
  };
}

var ISA_NOTE_CLEANUP = {
  createController: createNoteCleanupController,
  createNoteCleanupController,
  intervalMs: ISA_NOTE_CLEANUP_INTERVAL_MS,
  leaseTtlMs: ISA_NOTE_CLEANUP_LEASE_MS,
  timeoutMs: ISA_NOTE_CLEANUP_TIMEOUT_MS,
  minDeletionGapMs: ISA_NOTE_CLEANUP_MIN_GAP_MS,
  maxAttempts: ISA_NOTE_CLEANUP_MAX_ATTEMPTS
};

if (typeof window !== 'undefined') window.ISA_NOTE_CLEANUP = ISA_NOTE_CLEANUP;
if (typeof module !== 'undefined' && module.exports) module.exports = ISA_NOTE_CLEANUP;
