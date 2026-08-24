// @ts-check
/**
 * @file ecs-normalizer.js
 * @module shared/ecs-normalizer
 * @description The ECS VIEW of an AEGIS internal event. AEGIS keeps its own event schema
 *   untouched and exposes Elastic Common Schema 8.11 names at the boundary. This module is the
 *   ONLY place that mapping is written down; `docs/ECS-MAPPING.md` follows it, never the other
 *   way round, and carries the argument for every row.
 *
 *   Pure: no imports, no module state, no clock, no I/O, the input is never mutated, and no value
 *   in the output shares a reference with it. Nothing in `src/` calls it yet — it fixes the naming
 *   before the sequence rule engine, the bench trace format and any SIEM export are built on it.
 *
 *   FOUR CARRIERS, one field-driven mapping — a field is mapped wherever it appears, so a
 *   carrier that lacks it just yields a smaller document. `AuditRecordV1`/`V0` (`type`) ·
 *   `FileEvent` (`file`) · `NetworkConnection` (`remoteIp`) · a session record (`firstSeen`,
 *   with `lastSeen` marking the exit side — `reconcile()` puts it there and withholds it on an
 *   enter). `type` is tested FIRST: only an audit record holds one, and its `path`/`action`
 *   pair would otherwise read as a live shape. An unrecognised shape THROWS, because a
 *   normalizer answering `{}` drops an event silently (ai-mistakes.md #25).
 *
 *   ABSENCE IS WRITTEN AS ABSENCE — a value the record does not carry is OMITTED, never emitted
 *   as `null` (the convention `bench/lib/catalogue.js` states as B2.2). Empty containers go the
 *   same way: no `process: {}`, no `aegis: {}`.
 *
 *   TWO NAMES, not interchangeable: `process` is the OS process name (`node.exe`) →
 *   `process.name`; `agent` is the AEGIS display name (`Claude Code`) → `aegis.agent.name`.
 *   Root ECS `agent.*` belongs to the collector — AEGIS itself — and is never written here.
 *
 *   NEVER WRITTEN for want of a source, none a stub awaiting a value: `process.executable`,
 *   `process.parent.{pid,name}`, `source.{ip,port}`, and a `NetworkConnection`'s `@timestamp`.
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.1.0
 * @since v0.14.0
 */

'use strict';

/**
 * ECS version these field names are taken from. Duplicated deliberately: `bench/lib/catalogue.js`
 * declares the same constant and may not import from `src/` (an oracle sharing code with the
 * sensor stops being independent). The parity case in the test file is the only thing that goes
 * red if the two drift.
 * @type {string}
 * @since v0.14.0
 */
const ECS_VERSION = '8.11.0';

/**
 * @typedef {Object} EcsShape
 * @property {Record<string, unknown>} event - the assembled ECS `event` branch.
 * @property {string|null} timestamp - ISO 8601, or null when the carrier holds none.
 * @property {Record<string, unknown>} fields - carrier-specific ECS branches.
 */

/**
 * The closed `FileAction` union (types/events.ts) mapped to ECS categorization. `holding` is
 * `info`, NOT `access`: file-watcher.js emits it for a point-in-time handle HOLD at the scan
 * tick, explicitly not a read.
 * @type {ReadonlyMap<string, {type: string, action: string}>}
 */
const FILE_ACTIONS = new Map([
  ['created', { type: 'creation', action: 'file-created' }],
  ['modified', { type: 'change', action: 'file-modified' }],
  ['deleted', { type: 'deletion', action: 'file-deleted' }],
  ['accessed', { type: 'access', action: 'file-accessed' }],
  ['holding', { type: 'info', action: 'file-handle-held' }],
]);

/**
 * `AuditEventType` (types/events.ts) mapped to ECS categorization. `file: true` means the record's
 * own `action` selects the pair out of {@link FILE_ACTIONS} and its `path` becomes `file.path`.
 * `permission-deny` and `buffer-overflow-drop` are ABSENT on purpose: nothing emits the first and
 * events.ts refuses to invent its fields, while the second reports that OTHER records were lost —
 * no categorization of THIS one. Both fall to the unknown-type branch of {@link _auditEvent}.
 * @type {ReadonlyMap<string, {kind: string, categories: string[], type?: string, action?: string, file?: boolean}>}
 */
const AUDIT_ROUTES = new Map([
  ['file-access', { kind: 'event', categories: ['file'], file: true }],
  ['config-access', { kind: 'event', categories: ['configuration', 'file'], file: true }],
  [
    'network-connection',
    { kind: 'event', categories: ['network'], type: 'connection', action: 'network-connection' },
  ],
  ['agent-enter', { kind: 'event', categories: ['process'], type: 'start', action: 'agent-enter' }],
  ['agent-exit', { kind: 'event', categories: ['process'], type: 'end', action: 'agent-exit' }],
  [
    'anomaly-alert',
    { kind: 'alert', categories: ['intrusion_detection'], type: 'info', action: 'anomaly-alert' },
  ],
]);

/**
 * A usable string, or null. `''` means absent throughout the internal schema (`agent: ''` is
 * the C-01 unattributed marker), so it maps to nothing.
 * @param {unknown} v @returns {string|null}
 */
function _text(v) {
  return typeof v === 'string' && v !== '' ? v : null;
}

/**
 * An epoch-ms observation as ISO 8601 UTC, or null when it is not one. `8.64e15` is the largest
 * epoch-ms a Date can hold; past it `toISOString()` throws instead of answering.
 * @param {unknown} v @returns {string|null}
 */
function _iso(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 8.64e15) return null;
  return new Date(v).toISOString();
}

/**
 * The ECS `event` branch for a file-shaped record. An `action` outside the closed union yields the
 * category alone: it IS about a file, but no type or action is invented for an unknown verb.
 * @param {unknown} action @param {string[]} categories @returns {Record<string, unknown>}
 */
function _fileEvent(action, categories) {
  /** @type {Record<string, unknown>} */
  const out = { kind: 'event', category: categories.slice() };
  const known = typeof action === 'string' ? FILE_ACTIONS.get(action) : undefined;
  if (known) {
    out.type = [known.type];
    out.action = known.action;
  }
  return out;
}

/**
 * The ECS `event` branch for an audit record, chosen by its `type`.
 * @param {string} auditType @param {unknown} action @returns {Record<string, unknown>}
 */
function _auditEvent(auditType, action) {
  const route = AUDIT_ROUTES.get(auditType);
  if (!route) return { kind: 'event', action: auditType };
  if (route.file) return _fileEvent(action, route.categories);
  /** @type {Record<string, unknown>} */
  const out = { kind: route.kind, category: route.categories.slice() };
  if (route.type) out.type = [route.type];
  if (route.action) out.action = route.action;
  return out;
}

/**
 * Attribution copied into `aegis`; the evidence array is COPIED, so no reference is shared.
 * @param {unknown} value @returns {Record<string, unknown>|null}
 */
function _attribution(value) {
  if (value === null || typeof value !== 'object') return null;
  const src = /** @type {{status?: unknown, evidence?: unknown}} */ (value);
  /** @type {Record<string, unknown>} */
  const out = {};
  const status = _text(src.status);
  if (status !== null) out.status = status;
  if (Array.isArray(src.evidence)) out.evidence = src.evidence.slice();
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Categorize one record and lift the branches only its own carrier can fill.
 * @param {Record<string, unknown>} event
 * @param {string|null} auditType - the record's `type`, when it is an audit record.
 * @returns {EcsShape}
 * @throws {TypeError} When the record matches none of the four carriers.
 */
function _shape(event, auditType) {
  /** @type {Record<string, unknown>} */
  const fields = {};
  if (auditType !== null) {
    const route = AUDIT_ROUTES.get(auditType);
    // A `network-connection` audit record yields NO `destination.*`: its `path` is the display
    // string `${remoteIp}:${remotePort}`, and splitting that apart would rebuild an identity out
    // of a rendering — ambiguous the moment the address is IPv6.
    if (route && route.file) {
      const path = _text(event.path);
      if (path !== null) fields.file = { path };
    }
    return {
      event: _auditEvent(auditType, event.action),
      timestamp: _text(event.timestamp),
      fields,
    };
  }

  if (typeof event.file === 'string') {
    const path = _text(event.file);
    if (path !== null) fields.file = { path };
    return { event: _fileEvent(event.action, ['file']), timestamp: _iso(event.timestamp), fields };
  }

  if (typeof event.remoteIp === 'string') {
    /** @type {Record<string, unknown>} */
    const destination = {};
    const ip = _text(event.remoteIp);
    if (ip !== null) destination.ip = ip;
    const port = event.remotePort;
    if (typeof port === 'number' && Number.isSafeInteger(port) && port > 0) destination.port = port;
    const domain = _text(event.domain);
    if (domain !== null) destination.domain = domain;
    // `tcp` is a constant because the sole provider, `platform.getRawTcpConnections`, enumerates
    // TCP and nothing else. `source.*` stays absent — a `RawTcpConnection` is `{pid, ip, port,
    // state}` with no local endpoint — and the timestamp is null because the connection object
    // carries no observation time at all; the audit record for the same socket does.
    fields.network = { transport: 'tcp' };
    if (Object.keys(destination).length > 0) fields.destination = destination;
    const ev = { kind: 'event', category: ['network'], type: ['connection'] };
    return { event: { ...ev, action: 'network-connection' }, timestamp: null, fields };
  }

  if (typeof event.firstSeen === 'number') {
    // `agent-enter`/`agent-exit`, never `process-started`: an enter is AEGIS's first SIGHTING of
    // an agent, which is not a process start, and a synthetic agent has no process to start.
    // `category`/`type` still read `process`/`start`, which is what a Sysmon join uses.
    // `firstSeen` is an AEGIS observation time, so it never becomes ECS `process.start`, which
    // means the OS birth time.
    const exited = typeof event.lastSeen === 'number';
    const ev = {
      kind: 'event',
      category: ['process'],
      type: [exited ? 'end' : 'start'],
      action: exited ? 'agent-exit' : 'agent-enter',
    };
    return { event: ev, timestamp: _iso(exited ? event.lastSeen : event.firstSeen), fields };
  }

  throw new TypeError(
    'normalizeToEcs: unrecognised event shape — expected an audit record (type), a FileEvent ' +
      '(file), a NetworkConnection (remoteIp) or a session record (firstSeen)',
  );
}

/**
 * Project one AEGIS internal event onto its ECS view.
 * @param {Record<string, unknown>} event - a `FileEvent`, a `NetworkConnection`, a session
 *   record, or an audit record; see the file header for the discriminators.
 * @returns {Record<string, unknown>} An ECS 8.11 document.
 * @throws {TypeError} When the argument is not an object, or matches none of the four carriers
 *   — an unrecognised event is refused, never silently emptied.
 * @since v0.14.0
 */
function normalizeToEcs(event) {
  if (event === null || typeof event !== 'object') {
    throw new TypeError(`normalizeToEcs: expected an event object, received ${typeof event}`);
  }
  const shape = _shape(event, _text(event.type));

  // Vestigial in Event Schema v1 — audit-logger writes 0 on every record. Mapped as it stands,
  // 0 included, rather than filtered: a value the record carries is not an absence. Nothing may
  // be derived from it; see docs/ECS-MAPPING.md.
  const riskScore = event.riskScore;
  if (typeof riskScore === 'number' && Number.isFinite(riskScore)) {
    shape.event.risk_score = riskScore;
  }

  /** @type {Record<string, unknown>} */
  const ecsProcess = {};
  // Verbatim, format unchanged (`pid:startTime`, `0:<name>`, `<pid>:u`). Parsing it apart here
  // would be a second identity resolution (ai-mistakes.md #19).
  const entityId = _text(event.instanceId);
  if (entityId !== null) ecsProcess.entity_id = entityId;
  // Only a pid the OS handed out. 0 is a real value meaning a synthetic, process-less agent and
  // `null` means none was observed; writing either would invite a join on it, and the synthetic
  // stays identified by its `0:<name>` entity_id. Same rule as bench `processIdentity()`.
  const pid = event.pid;
  if (typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0) ecsProcess.pid = pid;
  const processName = _text(event.process);
  if (processName !== null) ecsProcess.name = processName;
  const cwd = _text(event.cwd);
  if (cwd !== null) ecsProcess.working_directory = cwd;

  /** @type {Record<string, unknown>} */
  const aegis = {};
  const agentName = _text(event.agent);
  if (agentName !== null) aegis.agent = { name: agentName };
  const attribution = _attribution(event.attribution);
  if (attribution !== null) aegis.attribution = attribution;
  const schemaVersion = event.schemaVersion;
  if (typeof schemaVersion === 'number' && Number.isSafeInteger(schemaVersion)) {
    aegis.schema_version = schemaVersion;
  }
  // Strictly `true`, never truthiness: absence is the observed case and presence the claim
  // (DetectedAgent._demo). An unmarked record must not be marked here, and a marked one must
  // not reach a SIEM looking like a real observation.
  if (event._demo === true) aegis.demo = true;

  /** @type {Record<string, unknown>} */
  const doc = {};
  if (shape.timestamp !== null) doc['@timestamp'] = shape.timestamp;
  doc.ecs = { version: ECS_VERSION };
  doc.event = shape.event;
  Object.assign(doc, shape.fields);
  if (Object.keys(ecsProcess).length > 0) doc.process = ecsProcess;
  if (Object.keys(aegis).length > 0) doc.aegis = aegis;
  return doc;
}

module.exports = {
  ECS_VERSION,
  normalizeToEcs,
};
