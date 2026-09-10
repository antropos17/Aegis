/** @file Bounded diagnostic ETW transport owner; never emits FileEvents. */
'use strict';
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const wire = require('./etw-file-protocol');
const model = require('./etw-file-health');
const health = require('../sensor-health');
const { createDiagnostics } = require('./etw-file-diagnostics');

/** Own one broker at a time, with explicit retry and no elevated kill or replay.
 * @param {Object} deps - spawnBroker, optional clocks/ID factory for deterministic tests.
 * @returns {Object} Lifecycle, health and local-only diagnostic snapshot methods.
 * @since v0.14.2
 */
function createSupervisor({
  spawnBroker,
  now = Date.now,
  mono = () => performance.now(),
  id = randomUUID,
  profileClock = process.hrtime.bigint,
}) {
  let current = null,
    child = null,
    timer = null,
    decoder = null;
  let startedAt = 0,
    receivedAt = 0,
    stopAt = null,
    startRequest = null,
    stopRequest = null;
  let sent = 0n,
    pendingWrite = false,
    writeAt = 0,
    closed = true,
    disposed = false;
  let restartRequested = false,
    unsafe = false,
    receivedReady = false;
  let stopSent = false,
    failedAt = null;
  let stopReason = null;
  let capture = null;
  let diagnostics = createDiagnostics(profileClock);
  let summaries = [],
    omittedSummaries = 0;
  let idle = { ...health.createSensorHealth('etw-file'), state: 'DISABLED' };

  function clearRing() {
    diagnostics.clear();
  }
  function fail(code) {
    if (!current || current.phase === 'failed') return;
    current = model.failSession(current, now(), code);
    failedAt = mono();
    unsafe = receivedReady; // Once capture existed, missing cleanup forbids a new capture.
    restartRequested = false;
    clearRing();
    child?.stdin.destroy(); // Broker EOF and collector lease own cleanup.
  }
  function send(t, data) {
    if (!child || closed || pendingWrite) return false;
    const bytes = wire.encodeFrame({
      t,
      proto: wire.PROTOCOL,
      launchId: current.launchId,
      sessionId: current.sessionId,
      seq: String(++sent),
      data,
    });
    pendingWrite = true;
    writeAt = mono();
    const target = child;
    try {
      target.stdin.write(bytes, (error) => {
        if (child !== target) return;
        pendingWrite = false;
        if (error) return fail('consumer-failed');
        flushStop();
      });
    } catch {
      fail('protocol-failed');
      return false;
    }
    return true;
  }
  function flushStop() {
    if (stopAt !== null && !stopSent && current?.phase === 'running' && !pendingWrite) {
      stopSent = true;
      send('stop', { requestId: stopRequest });
    }
  }
  function accept(message) {
    if (message.t === 'ready' && message.data.requestId !== startRequest)
      throw new Error('request');
    if (message.t === 'stopped' && message.data.requestId !== stopRequest)
      throw new Error('request');
    current = model.reduceSession(current, message, now());
    receivedAt = mono();
    if (message.t === 'hello') {
      if (stopAt !== null) {
        child.stdin.end();
        return;
      }
      startRequest = id();
      if (!send('start', { requestId: startRequest, profile: wire.PROFILE, buffersMiB: 16 }))
        throw new Error('write-busy');
    }
    if (message.t === 'ready') {
      receivedReady = true;
      capture = structuredClone({
        buffers: message.data.buffers,
        frequency: message.data.frequency,
        clock: message.data.clock,
      });
    }
    if (current.phase === 'failed') {
      failedAt = mono();
      unsafe = true;
      child.stdin.destroy();
      clearRing();
    }
    if (message.t === 'observations' && stopAt === null) {
      diagnostics.retain(message.data.records);
    }
    if (message.t === 'stopped') {
      clearRing();
      child.stdin.end();
    }
  }
  function tick() {
    if (!child || closed) return;
    const elapsed = mono();
    if (failedAt !== null) {
      if (elapsed - failedAt > 15000) {
        child.kill();
        failedAt = Infinity;
      }
      return;
    }
    if (pendingWrite && elapsed - writeAt > 5000) return fail('consumer-failed');
    if (stopAt !== null && elapsed - stopAt > 10000) return fail('stop-unverified');
    if (current.phase === 'starting' && elapsed - startedAt > 130000) return fail('launch-failed');
    if (current.phase === 'running' && elapsed - receivedAt > 10000) return fail('lease-expired');
    if (current.phase === 'running' && stopAt === null) send('ping', {});
  }
  function finish(target, code) {
    if (target !== child || closed) return;
    closed = true;
    clearInterval(timer);
    timer = null;
    if (current.phase !== 'stopped' || code !== 0) {
      current = model.failSession(current, now(), 'stream-ended');
      // Even pre-ready failure could follow successful enable and a lost ready.
      unsafe = true;
    }
    summaries.push({
      launchId: current.launchId,
      sessionId: current.sessionId,
      endedAt: now(),
      phase: current.phase,
      reasons: [...current.reasons],
      maxima: { ...current.maxima },
      capture,
      finalCounters: structuredClone(current.latest?.counters || null),
      finalTotals: structuredClone(current.latest?.totals || null),
      ringDropped: diagnostics.dropped,
      collectorPerformance: structuredClone(current.latest?.performance || null),
      mainPerformance: diagnostics.performance(),
      stopReason,
      exitCode: code,
      stopVerified: current.phase === 'stopped' && code === 0,
    });
    if (summaries.length > 32) {
      summaries.shift();
      omittedSummaries++;
    }
    child = null;
    clearRing();
    if (restartRequested && !unsafe && !disposed) {
      restartRequested = false;
      start();
    }
  }
  function start() {
    if (disposed || child || unsafe) return false;
    current = model.createSession(id(), id());
    startRequest = null;
    stopRequest = null;
    stopAt = null;
    stopReason = null;
    capture = null;
    sent = 0n;
    pendingWrite = false;
    receivedReady = false;
    diagnostics = createDiagnostics(profileClock);
    stopSent = false;
    failedAt = null;
    clearRing();
    startedAt = receivedAt = mono();
    closed = false;
    try {
      child = spawnBroker(current.launchId, current.sessionId);
    } catch {
      current = model.failSession(current, now(), 'launch-failed');
      closed = true;
      return false;
    }
    const target = child;
    decoder = wire.createFrameDecoder({
      ...current,
      onMessage: (message) => diagnostics.measure('acceptFrame', () => accept(message)),
    });
    const reader = decoder;
    target.stdout.on('data', (bytes) => {
      if (target !== child || closed) return;
      try {
        diagnostics.measure('decodeChunk', () => reader.push(bytes));
      } catch {
        fail('protocol-failed');
      }
    });
    target.stdout.on('end', () => {
      if (target !== child || closed) return;
      try {
        reader.end();
      } catch {
        fail('protocol-failed');
      }
      if (current.phase !== 'stopped') fail('stream-ended');
    });
    target.stdout.on('error', () => {
      if (target === child) fail('stream-ended');
    });
    target.stdin.on('error', () => {
      if (target === child && current.phase !== 'stopped') fail('stream-ended');
    });
    target.on('error', () => {
      if (target === child) fail('launch-failed');
    });
    target.on('close', (code) => finish(target, code));
    timer = setInterval(tick, 2000);
    timer.unref?.();
    return true;
  }
  function stop(reason = 'operator-stop') {
    if (!['operator-stop', 'pause', 'suspend', 'restart', 'shutdown'].includes(reason))
      throw new Error('etw-file:invalid-stop-reason');
    restartRequested = false;
    clearRing();
    if (!child || stopAt !== null || current.phase === 'stopped') return;
    stopAt = mono();
    stopRequest = id();
    stopReason = reason;
    if (current.phase !== 'running') child.stdin.end();
    else flushStop();
  }
  return {
    start,
    stop,
    tick,
    restart() {
      stop('restart');
      restartRequested = true;
      if (!child && !unsafe) {
        restartRequested = false;
        return start();
      }
      return false;
    },
    dispose() {
      disposed = true;
      stop('shutdown');
    },
    setUnavailable(state, detail) {
      idle = { ...idle, state, detail };
    },
    getHealth: () => structuredClone(current?.record || idle),
    getDiagnostics: () =>
      diagnostics.measure('snapshot', () => ({
        ...diagnostics.snapshot(),
        summaries: structuredClone(summaries),
        omittedSummaries,
        restartBlocked: unsafe,
        phase: current?.phase || 'disabled',
        pendingBytes: decoder?.allocatedBytes() || 0,
      })),
  };
}
module.exports = { createSupervisor };
