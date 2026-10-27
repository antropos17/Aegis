'use strict';

const { createToolContext } = require('./tool-context-record');
const { createSessionContext } = require('./session-context');
const { readLiveSessionFile } = require('./live-session-file');
const { readClaudeProcesses, processWitness } = require('./live-session-process');
const { validCreateTime100ns } = require('./platform/windows-observer');
const { randomBytes, randomUUID } = require('node:crypto');
const { projectAuditIdentity, auditOrigin } = require('./audit-observation-identity');
const path = require('node:path');
const os = require('node:os');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const AGE_MS = 15 * 60 * 1000;
const MAX_TOKEN_COUNTER = 0xffffffffffff;

/** Issue process-local UUID locators without reuse or counter wrap.
 * @param {string} selectedEpoch Random UUID for the current process lifetime.
 * @param {number} [initial] Starting counter for deterministic boundary tests.
 * @returns {function(): string|null} Next locator, or null after exhaustion. @since v0.21.0 */
function createAuditTokenIssuer(selectedEpoch, initial = 0) {
  if (
    !UUID.test(selectedEpoch) ||
    !Number.isSafeInteger(initial) ||
    initial < 0 ||
    initial > MAX_TOKEN_COUNTER
  )
    throw Error('audit-token-unavailable');
  const prefix = selectedEpoch.toLowerCase().slice(0, 24);
  let counter = initial;
  return () =>
    counter >= MAX_TOKEN_COUNTER ? null : prefix + (++counter).toString(16).padStart(12, '0');
}
const platform = process.platform === 'win32' ? 'win32' : 'posix';
const normalized = (value) =>
  typeof value === 'string' &&
  path.isAbsolute(value) &&
  (platform !== 'win32' || /^[a-z]:[\\/]/i.test(value))
    ? platform === 'win32'
      ? path.resolve(value).toLowerCase()
      : path.resolve(value)
    : null;
const unavailable = (reason) => ({
  success: true,
  source: 'claude-code',
  availability: 'unavailable',
  toolContext: createToolContext({ strength: 'unattributed', reasons: [reason], candidates: [] }),
});

async function registryAt(home, pid) {
  const { bytes } = await readLiveSessionFile(
    path.join(home, '.claude', 'sessions', `${pid}.json`),
    65536,
  );
  try {
    const row = JSON.parse(bytes.toString('utf8'));
    if (
      !row ||
      !UUID.test(row.sessionId) ||
      !normalized(row.cwd) ||
      !Number.isSafeInteger(row.startedAt)
    )
      throw Error();
    return { sessionId: row.sessionId, cwd: row.cwd, startedAt: row.startedAt };
  } finally {
    bytes.fill(0);
  }
}

function observed(agent) {
  return (
    agent &&
    agent.agent === 'Claude Code' &&
    Number.isSafeInteger(agent.pid) &&
    agent.pid > 0 &&
    Number.isSafeInteger(agent.startTime) &&
    agent.startTime > 0 &&
    agent.instanceIdSource === 'os' &&
    agent.instanceId === `${agent.pid}:${agent.startTime}`
  );
}
const witness = (agent) =>
  JSON.stringify([
    agent.pid,
    agent.startTime,
    agent.instanceId,
    normalized(agent.cwd),
    agent.createTime100ns ?? null,
  ]);

/** Create the application-owned live explanation service.
 * @param {object} options Local source and process snapshot dependencies.
 * @returns {object} record and explain operations. @since v0.21.0 */
function createLiveToolContext(options) {
  const {
    getAgents,
    home = os.homedir(),
    now = Date.now,
    monotonicNow = () => performance.now(),
    observeProcesses = readClaudeProcesses,
    onAuditRevision = () => {},
    auditProof = () => null,
  } = options;
  const events = new Map();
  const sightings = new Map();
  const auditTokens = new Map();
  const auditRows = new Map();
  const ingress = new WeakMap();
  // One random process-lifetime epoch supplies a UUID prefix; the final 48 bits
  // are a monotonic counter. Tokens never repeat in this process, and stop at
  // 2^48-1 instead of wrapping. Tokens are locators, not authentication.
  const epoch = randomUUID().toLowerCase();
  const nextToken = createAuditTokenIssuer(epoch, options.initialAuditTokenCounter ?? 0);
  const digestKey = randomBytes(32);
  let busy = false,
    nextRead = 0;
  let revision = 0;
  let expiryTimer = null;

  function auditRevision() {
    return Number.isSafeInteger(revision) ? { epoch, revision } : null;
  }

  function invalidateAudit() {
    const wasActive = auditTokens.size !== 0;
    auditTokens.clear();
    auditRows.clear();
    if (expiryTimer) clearTimeout(expiryTimer);
    expiryTimer = null;
    revision = revision < Number.MAX_SAFE_INTEGER ? revision + 1 : NaN;
    if (wasActive) try { onAuditRevision(auditRevision()); } catch { /* no renderer is required */ }
  }

  function scheduleExpiry() {
    if (expiryTimer) clearTimeout(expiryTimer);
    if (!auditTokens.size) { expiryTimer = null; return; }
    let delay = AGE_MS;
    for (const id of auditTokens.values()) {
      const sighting = sightings.get(id);
      const retained = events.get(id);
      if (!sighting || !retained) { delay = 1; break; }
      delay = Math.min(delay, AGE_MS - (monotonicNow() - sighting.monotonicAt),
        AGE_MS - (now() - sighting.at), AGE_MS - (now() - retained.timestamp));
    }
    expiryTimer = setTimeout(() => { expiryTimer = null; prune(); scheduleExpiry(); }, Math.max(1, delay + 1));
    expiryTimer.unref?.();
  }

  function forget(id) {
    const sighting = sightings.get(id);
    if (sighting && auditTokens.has(sighting.token)) invalidateAudit();
    sightings.delete(id);
    events.delete(id);
  }

  function prune() {
    const instant = now();
    const monotonic = monotonicNow();
    for (const [id, row] of sightings) {
      const retained = events.get(id);
      if (
        !Number.isFinite(monotonic) || !Number.isFinite(row.monotonicAt) || monotonic < row.monotonicAt ||
        monotonic - row.monotonicAt > AGE_MS || instant - row.at > AGE_MS ||
        (retained && instant - retained.timestamp > AGE_MS)
      )
        forget(id);
    }
    while (sightings.size > 256) forget(sightings.keys().next().value);
  }

  /** Register each ingress observation before sensitive audit or display dedup.
   * @param {object} event Main-process file observation.
   * @returns {object|null} Private audit identity or null. @since v0.21.0 */
  function prepare(event) {
    if (!event || typeof event.eventId !== 'string' || !UUID.test(event.eventId)) return null;
    // Admission can race a pending uniqueness proof, before any alias exists.
    invalidateAudit();
    const id = event.eventId.toLowerCase();
    ingress.delete(event);
    prune();
    const aliasOwner = auditTokens.get(id);
    if (aliasOwner) {
      const aliased = sightings.get(aliasOwner);
      if (aliased) aliased.auditAmbiguous = true;
      invalidateAudit();
    }
    const existing = sightings.get(id);
    if (existing) {
      existing.ambiguous = true;
      if (auditTokens.has(existing.token)) invalidateAudit();
      events.delete(id);
    }
    const token = nextToken();
    const identity = Object.freeze({ eventId: id, epoch, token });
    ingress.set(event, identity);
    if (existing) return token ? identity : null;
    sightings.set(id, { token, at: now(), monotonicAt: monotonicNow(), ambiguous: false });
    prune();
    return token ? identity : null;
  }

  /** Retain only a bounded selection of already accepted OS observations.
   * @param {object} event Main-process event. @returns {void} @since v0.21.0 */
  function record(event) {
    if (
      !event ||
      !UUID.test(event.eventId) ||
      !Number.isSafeInteger(event.timestamp) ||
      typeof event.instanceId !== 'string' ||
      event.instanceId.length > 100 ||
      !Number.isSafeInteger(event.pid) ||
      event.pid <= 0 ||
      !normalized(event.file) ||
      event.file.length > 4096
    )
      return;
    if (!ingress.has(event)) prepare(event);
    const identity = ingress.get(event);
    const id = event.eventId.toLowerCase();
    const sighting = sightings.get(id);
    if (
      !identity ||
      identity.eventId !== id ||
      identity.epoch !== epoch ||
      !sighting ||
      sighting.ambiguous ||
      sighting.token !== identity.token ||
      events.has(id)
    )
      return;
    events.set(
      id,
      Object.freeze({
        eventId: id,
        pid: event.pid,
        instanceId: event.instanceId,
        timestamp: event.timestamp,
        file: event.file,
        action: typeof event.action === 'string' ? event.action : '',
        createTime100ns: validCreateTime100ns(event.createTime100ns) ? event.createTime100ns : null,
      }),
    );
    prune();
  }

  /** Issue an existing opaque lookup only for an exact live audit observation.
   * @param {unknown} row Stored audit row. @returns {string|{revoked: string}|null} Locator, revocation, or null. @since v0.21.0 */
  function auditLookup(row, pageProof = undefined) {
    prune();
    if (!row || !['file-access', 'config-access'].includes(row.type)) return null;
    const identity = projectAuditIdentity(row.details?.auditIdentity);
    if (!identity || identity.epoch !== epoch) return null;
    let proof;
    try { proof = pageProof === undefined ? auditProof() : pageProof; } catch { return null; }
    if (!proof || typeof proof.unique !== 'function' || !proof.unique(row)) {
      if (auditTokens.has(identity.token)) invalidateAudit();
      return null;
    }
    const sighting = sightings.get(identity.eventId);
    const retained = events.get(identity.eventId);
    if (
      !sighting ||
      sighting.ambiguous ||
      sighting.token !== identity.token ||
      (auditTokens.has(identity.token) && auditTokens.get(identity.token) !== identity.eventId) ||
      !retained
    )
      return null;
    // Distinct canonical audit rows claiming one tuple revoke the alias even
    // if a previously opened Details view still holds that alias. A repeated
    // read of the same seq/hash is not a second observation.
    const origin = auditOrigin(row);
    if (!origin || !Number.isSafeInteger(row.seq) || row.seq < 0 ||
      typeof row.hash !== 'string' || !/^[a-f0-9]{64}$/.test(row.hash)) return null;
    const auditKey = `${origin}:${row.seq}:${row.hash}`;
    if (sighting.auditAmbiguous) {
      return sighting.auditKey ? { revoked: `audit:${identity.token}` } : null;
    }
    if (sighting.auditKey && sighting.auditKey !== auditKey) {
      sighting.auditAmbiguous = true;
      invalidateAudit();
      return { revoked: `audit:${identity.token}` };
    }
    if (
      row.pid !== retained.pid ||
      row.instanceId !== retained.instanceId ||
      row.path !== retained.file ||
      row.action !== retained.action
    )
      return null;
    sighting.auditKey = auditKey;
    // A token that is also any source UUID is ambiguous, even if that source
    // observation was dropped by display dedup and has no retained event.
    if (sightings.has(identity.token)) return null;
    if (!auditRevision()) return null;
    auditTokens.set(identity.token, identity.eventId);
    auditRows.set(identity.token, row);
    scheduleExpiry();
    return `audit:${identity.token}`;
  }

  function selected(id) {
    const key = id.toLowerCase();
    if (!key.startsWith('audit:')) return events.get(key);
    const token = key.slice(6);
    const aliasId = auditTokens.get(token);
    if (!aliasId || sightings.has(token)) return undefined;
    return events.get(aliasId);
  }

  async function resolve(event) {
    const snapshots = getAgents();
    if (!Array.isArray(snapshots)) return unavailable('process-identity-unavailable');
    const matches = snapshots.filter(
      (a) => observed(a) && a.instanceId === event.instanceId && a.pid === event.pid,
    );
    if (matches.length !== 1) return unavailable('process-identity-unavailable');
    const agent = { ...matches[0] },
      stamp = witness(agent);
    if (event.createTime100ns !== null && event.createTime100ns !== agent.createTime100ns)
      return unavailable('process-binding-mismatch');
    const population = snapshots.filter(observed);
    const claudeRows = snapshots.filter((row) => row?.agent === 'Claude Code');
    // Every Claude row must be examined, even when native inspection is unavailable.
    if (
      claudeRows.length !== population.length ||
      new Set(population.map((row) => row.pid)).size !== population.length
    )
      return unavailable('process-identity-unavailable');
    const populationStamp = JSON.stringify(population.map(witness).sort());
    const samePopulation = (rows) =>
      Array.isArray(rows) &&
      rows.filter((row) => row?.agent === 'Claude Code').length === claudeRows.length &&
      JSON.stringify(rows.filter(observed).map(witness).sort()) === populationStamp;
    if (population.length > 32) return unavailable('binding-limit');
    const nativeBefore = await observeProcesses(population);
    const native = processWitness(nativeBefore, agent);
    if (nativeBefore?.some((row) => row.ProcessId === agent.pid) && !native)
      return unavailable('process-binding-mismatch');
    if (native && normalized(agent.cwd) && normalized(agent.cwd) !== normalized(native.Cwd))
      return unavailable('process-binding-mismatch');
    const selectedCwd = native?.Cwd ?? agent.cwd;
    if (!normalized(selectedCwd)) return unavailable('process-identity-unavailable');
    if (
      event.timestamp < agent.startTime ||
      event.timestamp > now() ||
      now() - event.timestamp > AGE_MS
    )
      return unavailable('binding-unavailable-or-outside-lifetime');
    const selected = await registryAt(home, agent.pid);
    // Registry start is agent-reported startup, NOT an independent OS birth witness.
    // Confirmation additionally requires the independently observed native launch
    // selector, full-resolution birth and cwd before/after the source read.
    if (
      selected.startedAt < agent.startTime ||
      selected.startedAt > agent.startTime + 60000 ||
      selected.startedAt > event.timestamp ||
      normalized(selected.cwd) !== normalized(selectedCwd)
    )
      return unavailable('process-binding-mismatch');
    const peers = snapshots.filter((a) => observed(a) && a.pid !== agent.pid);
    let oneToOne =
      event.createTime100ns !== null &&
      native?.SessionId === selected.sessionId &&
      Array.isArray(nativeBefore) &&
      nativeBefore.length === population.length &&
      path.resolve(native.Cwd) === path.resolve(selected.cwd) &&
      snapshots.filter((row) => row?.agent === 'Claude Code').length === population.length;
    if (peers.length > 31) return unavailable('binding-limit');
    const peerRegistries = [];
    for (const peer of peers) {
      let other;
      try {
        other = await registryAt(home, peer.pid);
      } catch {
        peerRegistries.push(null);
        oneToOne = false;
        continue;
      }
      peerRegistries.push(other);
      if (other.sessionId === selected.sessionId) return unavailable('session-binding-mismatch');
      const peerProof = processWitness(nativeBefore, peer);
      if (
        !peerProof ||
        peerProof.SessionId !== other.sessionId ||
        path.resolve(peerProof.Cwd) !== path.resolve(other.cwd)
      )
        oneToOne = false;
    }
    const file = path.join(
      home,
      '.claude',
      'projects',
      selected.cwd.replace(/[/\\:.]/g, '-'),
      `${selected.sessionId}.jsonl`,
    );
    const { bytes, headTruncated, tailTruncated } = await readLiveSessionFile(
      file,
      512 * 1024,
      true,
    );
    const adapter = createSessionContext({ digestKey });
    let batch;
    try {
      batch = adapter.parse('claude-code', bytes, {
        ...selected,
        platform,
        format: 'jsonl',
        headTruncated,
        tailTruncated,
      });
    } finally {
      bytes.fill(0);
    }
    const after = await registryAt(home, agent.pid);
    const current = getAgents();
    if (
      JSON.stringify(after) !== JSON.stringify(selected) ||
      !samePopulation(current) ||
      current.filter(
        (a) => observed(a) && a.instanceId === agent.instanceId && witness(a) === stamp,
      ).length !== 1
    )
      return unavailable('process-binding-mismatch');
    for (let index = 0; index < peers.length; index++) {
      let afterPeer = null;
      try {
        afterPeer = await registryAt(home, peers[index].pid);
      } catch {
        // A missing or unreadable registry cannot establish one-to-one ownership.
      }
      if (JSON.stringify(afterPeer) !== JSON.stringify(peerRegistries[index]))
        return unavailable('session-binding-mismatch');
    }
    if (native) {
      const nativeAfter = await observeProcesses(population);
      if (JSON.stringify(nativeAfter) !== JSON.stringify(nativeBefore))
        return unavailable('process-binding-mismatch');
    }
    if (!samePopulation(getAgents())) return unavailable('process-binding-mismatch');
    if (batch.availability === 'unavailable')
      return {
        ...unavailable('source-unavailable'),
        toolContext: createToolContext({
          strength: 'unattributed',
          reasons: batch.reasons,
          candidates: [],
        }),
      };
    const binding = adapter.bind(
      batch,
      // Source spelling is used after the independently observed directory check;
      // the lexical digest intentionally preserves trailing separators and case.
      { ...agent, cwd: selected.cwd },
      {
        sessionId: selected.sessionId,
        pid: agent.pid,
        cwd: selected.cwd,
        processStartTime: oneToOne ? agent.startTime : undefined,
        oneToOne,
        provenance: oneToOne ? 'verified-local-registry' : 'local-registry-hint',
      },
    );
    // Native local Claude and AEGIS timestamps use this host's UTC wall clock.
    // This same-clock assumption is not a measured remote-clock calibration;
    // tool association stays inferred even when session ownership is confirmed.
    const result = adapter.correlate(
      {
        instanceId: event.instanceId,
        atMs: event.timestamp,
        objectKind: 'path',
        objectValue: event.file,
      },
      [binding],
      { clockBasis: 'same-host-assumed', missingEndToleranceMs: 5000 },
    );
    return {
      success: true,
      source: 'claude-code',
      availability: batch.availability,
      toolContext: createToolContext(result),
    };
  }

  /** Explain by retained event ID only; no renderer-controlled paths or process data.
   * @param {unknown} id Event UUID. @returns {Promise<object>} Metadata-only reply. @since v0.21.0 */
  async function explain(id) {
    prune();
    if (typeof id !== 'string' || !(UUID.test(id) || (id.startsWith('audit:') && UUID.test(id.slice(6)))))
      return unavailable('context-unavailable');
    const retained = selected(id);
    if (!retained) return unavailable('context-unavailable');
    const auditRow = id.startsWith('audit:') ? auditRows.get(id.slice(6).toLowerCase()) : null;
    const validAudit = async () => {
      if (!auditRow) return !id.startsWith('audit:');
      try { const proof = await auditProof(); return !!proof && proof.unique(auditRow) === true; }
      catch { return false; }
    };
    if (busy || now() < nextRead) return unavailable('source-unavailable');
    busy = true;
    nextRead = now() + 1000;
    let timer;
    let work = null;
    let workFinished = false;
    try {
      if (!await validAudit() || selected(id) !== retained) {
        if (auditRow) invalidateAudit();
        return unavailable('context-unavailable');
      }
      work = resolve(retained).catch(() => unavailable('source-unavailable')).finally(() => { workFinished = true; });
      const result = await Promise.race([
        work,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(unavailable('source-unavailable')), 3000);
        }),
      ]);
      prune();
      if (selected(id) !== retained || !await validAudit() || selected(id) !== retained) {
        if (auditRow) invalidateAudit();
        return unavailable('context-unavailable');
      }
      return result;
    } finally {
      clearTimeout(timer);
      if (work && !workFinished) void work.finally(() => { busy = false; });
      else busy = false;
    }
  }
  return Object.freeze({ prepare, record, auditLookup, explain, auditRevision, invalidateAudit });
}

module.exports = { createLiveToolContext, createAuditTokenIssuer };
