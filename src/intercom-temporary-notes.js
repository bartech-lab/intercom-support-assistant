'use strict';

const ISA_AUTO_DELETE_MARKER_PREFIX = '[ISA-AUTO-DELETE:';
const ISA_AUTO_DELETE_MARKER_VERSION = 'v1';
const ISA_AUTO_DELETE_DAY_MS = 24 * 60 * 60 * 1000;
const ISA_AUTO_DELETE_MIN_LIFETIME_MS = 60 * 1000;
const ISA_AUTO_DELETE_MAX_LIFETIME_MS = 3650 * ISA_AUTO_DELETE_DAY_MS;
const ISA_AUTO_DELETE_DEFAULT_DELAY_MS = 30 * ISA_AUTO_DELETE_DAY_MS;
const ISA_AUTO_DELETE_DELAY_UNITS = {
  hours: 60 * 60 * 1000,
  days: ISA_AUTO_DELETE_DAY_MS,
  weeks: 7 * ISA_AUTO_DELETE_DAY_MS
};
const ISA_AUTO_DELETE_PRESETS = [
  { id: '3600000', label: '1 hour', delayMs: 60 * 60 * 1000 },
  { id: '14400000', label: '4 hours', delayMs: 4 * 60 * 60 * 1000 },
  { id: '43200000', label: '12 hours', delayMs: 12 * 60 * 60 * 1000 },
  { id: '86400000', label: '1 day', delayMs: ISA_AUTO_DELETE_DAY_MS },
  { id: '259200000', label: '3 days', delayMs: 3 * ISA_AUTO_DELETE_DAY_MS },
  { id: '604800000', label: '7 days', delayMs: 7 * ISA_AUTO_DELETE_DAY_MS },
  { id: '2592000000', label: '30 days', delayMs: 30 * ISA_AUTO_DELETE_DAY_MS },
  { id: '7776000000', label: '90 days', delayMs: 90 * ISA_AUTO_DELETE_DAY_MS }
];
const ISA_AUTO_DELETE_LOCAL_MINUTE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const ISA_AUTO_DELETE_IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]+$/;
const ISA_AUTO_DELETE_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ISA_AUTO_DELETE_READABLE_PATTERN = /^Auto-delete after: (\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}) UTC$/;

function autoDeleteValueText(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function normalizeAutoDeleteDelayMs(value) {
  const text = autoDeleteValueText(value);
  if (!/^\d+$/.test(text)) return null;
  const delayMs = Number(text);
  if (!Number.isSafeInteger(delayMs)) return null;
  if (delayMs < ISA_AUTO_DELETE_MIN_LIFETIME_MS || delayMs > ISA_AUTO_DELETE_MAX_LIFETIME_MS) return null;
  return delayMs;
}

function autoDeleteDelayFromUnits(amount, unit) {
  const text = autoDeleteValueText(amount);
  if (!/^\d+$/.test(text)) return null;
  const size = Object.prototype.hasOwnProperty.call(ISA_AUTO_DELETE_DELAY_UNITS, unit)
    ? ISA_AUTO_DELETE_DELAY_UNITS[unit] : null;
  if (size === null) return null;
  const count = Number(text);
  if (!Number.isSafeInteger(count) || count < 1) return null;
  return normalizeAutoDeleteDelayMs(count * size);
}

function parseAutoDeleteTimestamp(value) {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : null;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    return value < 100000000000 ? value * 1000 : value;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return parseAutoDeleteTimestamp(Number(text));
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : null;
}

function autoDeleteIsoTimestamp(value) {
  const timestamp = parseAutoDeleteTimestamp(value);
  if (timestamp === null) return null;
  const iso = new Date(timestamp).toISOString();
  return { timestamp, iso };
}

function normalizeAutoDeleteIdentifier(value) {
  const text = autoDeleteValueText(value);
  return text && ISA_AUTO_DELETE_IDENTIFIER_PATTERN.test(text) ? text : null;
}

function normalizeAutoDeleteInstant(value) {
  if (typeof value !== 'string' || !ISA_AUTO_DELETE_ISO_PATTERN.test(value.trim())) return null;
  const parsed = autoDeleteIsoTimestamp(value.trim());
  return parsed && parsed.iso === value.trim() ? parsed : null;
}

function autoDeletePad(value) {
  return String(value).padStart(2, '0');
}

function localMinuteToUtcIso(value) {
  const match = ISA_AUTO_DELETE_LOCAL_MINUTE_PATTERN.exec(autoDeleteValueText(value));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) return null;
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day
    || date.getHours() !== hour || date.getMinutes() !== minute) return null;
  return new Date(timestamp).toISOString();
}

function formatLocalMinuteInput(timestamp) {
  const parsed = autoDeleteIsoTimestamp(timestamp);
  if (!parsed) return null;
  const date = new Date(parsed.timestamp);
  return `${date.getFullYear()}-${autoDeletePad(date.getMonth() + 1)}-${autoDeletePad(date.getDate())}`
    + `T${autoDeletePad(date.getHours())}:${autoDeletePad(date.getMinutes())}`;
}

function normalizeAutoDeleteLifetime(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes('mode')) return null;
  if (value.mode === 'relative') {
    if (!keys.includes('delayMs')) return null;
    if (typeof value.delayMs !== 'number') return null;
    const delayMs = normalizeAutoDeleteDelayMs(value.delayMs);
    return delayMs === null ? null : { mode: 'relative', delayMs };
  }
  if (value.mode === 'absolute') {
    if (!keys.includes('expiresAt')) return null;
    const instant = normalizeAutoDeleteInstant(value.expiresAt);
    return instant === null ? null : { mode: 'absolute', expiresAt: instant.iso, expiresAtMs: instant.timestamp };
  }
  return null;
}

function resolveAutoDeleteLifetime(lifetime, submittedAt) {
  const normalized = normalizeAutoDeleteLifetime(lifetime);
  const parsedSubmittedAt = autoDeleteIsoTimestamp(submittedAt);
  if (!normalized || !parsedSubmittedAt) return { ok: false, reason: 'invalid-lifetime' };
  const base = parsedSubmittedAt.timestamp;
  const expiresAtMs = normalized.mode === 'relative' ? base + normalized.delayMs : normalized.expiresAtMs;
  if (!Number.isSafeInteger(expiresAtMs)) return { ok: false, reason: 'invalid-lifetime' };
  if (expiresAtMs < base + ISA_AUTO_DELETE_MIN_LIFETIME_MS) return { ok: false, reason: 'expiry-in-past' };
  if (expiresAtMs > base + ISA_AUTO_DELETE_MAX_LIFETIME_MS) return { ok: false, reason: 'expiry-out-of-range' };
  return { ok: true, mode: normalized.mode, expiresAtMs, expiresAt: new Date(expiresAtMs).toISOString() };
}

function autoDeleteUtcMinuteText(expiresAt) {
  const parsed = autoDeleteIsoTimestamp(expiresAt);
  if (!parsed) return null;
  const date = new Date(parsed.timestamp);
  return `${date.getUTCFullYear()}-${autoDeletePad(date.getUTCMonth() + 1)}-${autoDeletePad(date.getUTCDate())}`
    + ` ${autoDeletePad(date.getUTCHours())}:${autoDeletePad(date.getUTCMinutes())} UTC`;
}

function formatAutoDeleteDeadline(expiresAt) {
  const text = autoDeleteUtcMinuteText(expiresAt);
  return text === null ? null : `Auto-delete after: ${text}`;
}

function formatAutoDeleteSummary(expiresAt) {
  const text = autoDeleteUtcMinuteText(expiresAt);
  return text === null ? null : `Expires ${text}`;
}

function formatAutoDeleteLocalMinuteText(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${autoDeletePad(date.getMonth() + 1)}-${autoDeletePad(date.getDate())}`
    + ` ${autoDeletePad(date.getHours())}:${autoDeletePad(date.getMinutes())}`;
}

function formatAutoDeleteLocalHint(expiresAt) {
  const parsed = autoDeleteIsoTimestamp(expiresAt);
  return parsed ? `${formatAutoDeleteLocalMinuteText(parsed.timestamp)} local time` : null;
}

function autoDeleteMarker({ workspaceId, contactId, expiresAt, token } = {}) {
  const workspace = normalizeAutoDeleteIdentifier(workspaceId);
  const contact = normalizeAutoDeleteIdentifier(contactId);
  const submissionToken = normalizeAutoDeleteIdentifier(token);
  const parsedExpiry = autoDeleteIsoTimestamp(expiresAt);
  if (!workspace || !contact || !submissionToken || !parsedExpiry) return null;
  return `${ISA_AUTO_DELETE_MARKER_PREFIX}${ISA_AUTO_DELETE_MARKER_VERSION};workspace=${workspace};contact=${contact};expires=${parsedExpiry.iso};token=${submissionToken}]`;
}

function buildAutoDeleteFooter(options, contactId, expiresAt, token) {
  const values = options && typeof options === 'object' && !Array.isArray(options)
    ? options
    : { workspaceId: options, contactId, expiresAt, token };
  const marker = autoDeleteMarker(values);
  const readable = formatAutoDeleteDeadline(values.expiresAt);
  if (!marker || !readable) return null;
  return `\n\n${readable}\n${marker}`;
}

function appendAutoDeleteFooter(body, options, contactId, expiresAt, token) {
  if (typeof body !== 'string') return null;
  const footer = buildAutoDeleteFooter(options, contactId, expiresAt, token);
  return footer === null ? null : body + footer;
}

function parseAutoDeleteMarker(marker) {
  const match = /^\[ISA-AUTO-DELETE:([^\]]+)\]$/.exec(marker);
  if (!match) return null;
  const fields = match[1].split(';');
  if (fields.length !== 5 || fields[0] !== ISA_AUTO_DELETE_MARKER_VERSION) return null;
  const values = {};
  for (const field of fields.slice(1)) {
    const separator = field.indexOf('=');
    if (separator < 1 || Object.prototype.hasOwnProperty.call(values, field.slice(0, separator))) return null;
    values[field.slice(0, separator)] = field.slice(separator + 1);
  }
  if (Object.keys(values).sort().join(',') !== 'contact,expires,token,workspace') return null;
  const workspace = normalizeAutoDeleteIdentifier(values.workspace);
  const contact = normalizeAutoDeleteIdentifier(values.contact);
  const submissionToken = normalizeAutoDeleteIdentifier(values.token);
  if (!workspace || !contact || !submissionToken || !ISA_AUTO_DELETE_ISO_PATTERN.test(values.expires)) return null;
  const expiry = autoDeleteIsoTimestamp(values.expires);
  if (!expiry || expiry.iso !== values.expires) return null;
  return {
    version: ISA_AUTO_DELETE_MARKER_VERSION,
    workspaceId: workspace,
    contactId: contact,
    expiresAt: expiry.timestamp,
    expiresAtIso: expiry.iso,
    token: submissionToken,
    marker
  };
}

function parseAutoDeleteFooter(text) {
  if (typeof text !== 'string') return { valid: false, reason: 'invalid-body' };
  const markerStarts = [];
  let searchAt = 0;
  while (true) {
    const markerStart = text.indexOf(ISA_AUTO_DELETE_MARKER_PREFIX, searchAt);
    if (markerStart < 0) break;
    markerStarts.push(markerStart);
    searchAt = markerStart + ISA_AUTO_DELETE_MARKER_PREFIX.length;
  }
  if (!markerStarts.length) return null;
  if (markerStarts.length !== 1) return { valid: false, reason: 'multiple-markers' };
  const markerStart = markerStarts[0];
  const markerEnd = text.indexOf(']', markerStart);
  if (markerEnd < 0 || markerEnd !== text.length - 1) return { valid: false, reason: 'marker-not-at-end' };
  const marker = text.slice(markerStart, markerEnd + 1);
  const parsedMarker = parseAutoDeleteMarker(marker);
  if (!parsedMarker) return { valid: false, reason: 'invalid-marker' };
  const markerLineStart = text.lastIndexOf('\n', markerStart - 1) + 1;
  if (markerLineStart <= 0) return { valid: false, reason: 'invalid-footer-layout' };
  const readableLineEnd = markerLineStart - 1;
  const readableLineStart = text.lastIndexOf('\n', readableLineEnd - 1) + 1;
  const readable = text.slice(readableLineStart, readableLineEnd);
  const readableMatch = ISA_AUTO_DELETE_READABLE_PATTERN.exec(readable);
  if (!readableMatch) return { valid: false, reason: 'invalid-readable-deadline' };
  const readableIsoPrefix = `${readableMatch[1]}-${readableMatch[2]}-${readableMatch[3]}T${readableMatch[4]}:${readableMatch[5]}`;
  if (parsedMarker.expiresAtIso.slice(0, 16) !== readableIsoPrefix) return { valid: false, reason: 'deadline-mismatch' };
  const footerBody = text.slice(0, readableLineStart);
  const body = footerBody.endsWith('\n\n') ? footerBody.slice(0, -2) : footerBody;
  return {
    valid: true,
    version: parsedMarker.version,
    workspaceId: parsedMarker.workspaceId,
    contactId: parsedMarker.contactId,
    expiresAt: parsedMarker.expiresAt,
    expiresAtIso: parsedMarker.expiresAtIso,
    token: parsedMarker.token,
    marker,
    readableDeadline: readable,
    body,
    footerStart: readableLineStart
  };
}

function autoDeleteNoteField(note, camelName, snakeName) {
  if (!note || typeof note !== 'object') return undefined;
  if (note[camelName] !== undefined) return note[camelName];
  return note[snakeName];
}

function autoDeleteSameIdentifier(left, right) {
  const normalizedLeft = normalizeAutoDeleteIdentifier(left);
  const normalizedRight = normalizeAutoDeleteIdentifier(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function evaluateAutoDeleteEligibility(note, context = {}) {
  if (!note || typeof note !== 'object') return { eligible: false, reason: 'invalid-note' };
  const serverNow = parseAutoDeleteTimestamp(context.serverNow);
  if (serverNow === null) return { eligible: false, reason: 'missing-server-time' };
  const contactId = context.contactId;
  if (!normalizeAutoDeleteIdentifier(context.workspaceId)) return { eligible: false, reason: 'missing-workspace' };
  if (!normalizeAutoDeleteIdentifier(contactId)) return { eligible: false, reason: 'missing-contact' };
  const noteContactId = autoDeleteNoteField(note, 'contactId', 'contact_id');
  const noteId = autoDeleteNoteField(note, 'id', 'note_id');
  const ownershipKnown = noteContactId !== undefined
    || context.ownsNote === true
    || (Array.isArray(context.contactNoteIds) && context.contactNoteIds.map(String).includes(String(noteId)));
  if (!ownershipKnown) return { eligible: false, reason: 'missing-ownership' };
  if (noteContactId !== undefined && !autoDeleteSameIdentifier(noteContactId, contactId)) {
    return { eligible: false, reason: 'ownership-mismatch' };
  }
  const footer = parseAutoDeleteFooter(autoDeleteNoteField(note, 'body', 'text'));
  if (footer === null) return { eligible: false, reason: 'ordinary-note' };
  if (!footer.valid) return { eligible: false, reason: footer.reason };
  if (!autoDeleteSameIdentifier(footer.contactId, contactId)) return { eligible: false, reason: 'marker-contact-mismatch' };
  if (!autoDeleteSameIdentifier(footer.workspaceId, context.workspaceId)) {
    return { eligible: false, reason: 'marker-workspace-mismatch' };
  }
  const createdAt = parseAutoDeleteTimestamp(autoDeleteNoteField(note, 'createdAt', 'created_at'));
  if (createdAt === null) return { eligible: false, reason: 'missing-creation-time' };
  if (serverNow < createdAt) return { eligible: false, reason: 'server-time-before-creation' };
  if (footer.expiresAt <= createdAt) return { eligible: false, reason: 'expiry-before-creation' };
  if (context.expectedUpdatedAt !== undefined) {
    const updatedAt = parseAutoDeleteTimestamp(autoDeleteNoteField(note, 'updatedAt', 'updated_at'));
    const expectedUpdatedAt = parseAutoDeleteTimestamp(context.expectedUpdatedAt);
    if (updatedAt === null || expectedUpdatedAt === null || updatedAt !== expectedUpdatedAt) {
      return { eligible: false, reason: 'stale-version' };
    }
  }
  if (context.expectedVersion !== undefined && note.version !== context.expectedVersion) {
    return { eligible: false, reason: 'stale-version' };
  }
  if (serverNow < footer.expiresAt) return { eligible: false, reason: 'not-expired', footer, expiresAt: footer.expiresAt, expiresAtIso: footer.expiresAtIso };
  return {
    eligible: true,
    reason: 'expired',
    footer,
    noteId,
    expiresAt: footer.expiresAt,
    expiresAtIso: footer.expiresAtIso,
    createdAt
  };
}

function isAutoDeleteEligible(note, context) {
  return evaluateAutoDeleteEligibility(note, context).eligible;
}

var ISA_TEMPORARY_NOTES = {
  markerPrefix: ISA_AUTO_DELETE_MARKER_PREFIX,
  markerVersion: ISA_AUTO_DELETE_MARKER_VERSION,
  presets: ISA_AUTO_DELETE_PRESETS,
  delayUnits: ISA_AUTO_DELETE_DELAY_UNITS,
  defaultDelayMs: ISA_AUTO_DELETE_DEFAULT_DELAY_MS,
  minLifetimeMs: ISA_AUTO_DELETE_MIN_LIFETIME_MS,
  maxLifetimeMs: ISA_AUTO_DELETE_MAX_LIFETIME_MS,
  normalizeDelayMs: normalizeAutoDeleteDelayMs,
  delayFromUnits: autoDeleteDelayFromUnits,
  normalizeInstant: normalizeAutoDeleteInstant,
  localMinuteToUtcIso,
  formatLocalMinuteInput,
  formatLocalMinuteText: formatAutoDeleteLocalMinuteText,
  normalizeLifetime: normalizeAutoDeleteLifetime,
  resolveLifetime: resolveAutoDeleteLifetime,
  formatSummary: formatAutoDeleteSummary,
  formatLocalHint: formatAutoDeleteLocalHint,
  formatDeadline: formatAutoDeleteDeadline,
  buildMarker: autoDeleteMarker,
  parseMarker: parseAutoDeleteMarker,
  buildFooter: buildAutoDeleteFooter,
  appendFooter: appendAutoDeleteFooter,
  parseFooter: parseAutoDeleteFooter,
  evaluateEligibility: evaluateAutoDeleteEligibility,
  isEligible: isAutoDeleteEligible
};

if (typeof window !== 'undefined') window.ISA_TEMPORARY_NOTES = ISA_TEMPORARY_NOTES;
