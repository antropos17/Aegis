'use strict';

const { createToolContext } = require('./tool-context-record');
const { createSessionContext } = require('./session-context');
const { readLiveSessionFile } = require('./live-session-file');
const { readClaudeProcesses, processWitness } = require('./live-session-process');
const { validCreateTime100ns } = require('./platform/windows-observer');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const os = require('node:os');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const AGE_MS = 15 * 60 * 1000;
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
    observeProcesses = readClaudeProcesses,
  } = options;
  const events = new Map();
  const digestKey = randomBytes(32);
  let busy = false,
    nextRead = 0;

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
    // First accepted identity for an event ID is immutable. The renderer cannot create it.
    if (events.has(event.eventId)) return;
    events.set(
      event.eventId,
      Object.freeze({
        eventId: event.eventId,
        pid: event.pid,
        instanceId: event.instanceId,
        timestamp: event.timestamp,
        file: event.file,
        createTime100ns: validCreateTime100ns(event.createTime100ns) ? event.createTime100ns : null,
      }),
    );
    for (const [id, row] of events) if (now() - row.timestamp > AGE_MS) events.delete(id);
    while (events.size > 256) events.delete(events.keys().next().value);
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
    const populationStamp = population.map(witness).sort().join('|');
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
      !Array.isArray(current) ||
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
      const finalPopulation = getAgents();
      if (
        JSON.stringify(nativeAfter) !== JSON.stringify(nativeBefore) ||
        !Array.isArray(finalPopulation) ||
        finalPopulation.filter((row) => row?.agent === 'Claude Code').length !==
          snapshots.filter((row) => row?.agent === 'Claude Code').length ||
        finalPopulation.filter(observed).map(witness).sort().join('|') !== populationStamp
      )
        return unavailable('process-binding-mismatch');
    }
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
    for (const [key, event] of events) if (now() - event.timestamp > AGE_MS) events.delete(key);
    if (typeof id !== 'string' || !UUID.test(id) || !events.has(id))
      return unavailable('context-unavailable');
    if (busy || now() < nextRead) return unavailable('source-unavailable');
    busy = true;
    nextRead = now() + 1000;
    const work = resolve(events.get(id))
      .catch(() => unavailable('source-unavailable'))
      .finally(() => {
        busy = false;
      });
    let timer;
    try {
      return await Promise.race([
        work,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(unavailable('source-unavailable')), 3000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  return Object.freeze({ record, explain });
}

module.exports = { createLiveToolContext };
