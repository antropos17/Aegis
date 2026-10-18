/** @file Bounded diagnostic ETW transport owner; never emits FileEvents. */
'use strict';
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const wire = require('./etw-file-protocol');
const model = require('./etw-file-health');
const health = require('../sensor-health');
const { createDiagnostics, createSummary } = require('./etw-file-diagnostics');

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
  maxCaptureMs = null,
  onHealthChange = () => {},
}) {
  if (maxCaptureMs !== null && (!Number.isSafeInteger(maxCaptureMs) || maxCaptureMs <= 0))
    throw new Error('etw-file:invalid-capture-limit');
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
  let readyAt = null;
  let completion = Promise.resolve(false),
    resolveCompletion = null;
  let diagnostics = createDiagnostics(profileClock);
  let summaries = [],
    omittedSummaries = 0;
  let idle = { ...health.createSensorHealth('etw-file'), state: 'DISABLED' };
  let lastHealth = '';
  function notify() {
    const value = current?.record || idle;
    const signature = JSON.stringify([value.state, value.detail, value.lastError, value.lossCount]);
    if (signature === lastHealth) return;
    lastHealth = signature;
    try {
      onHealthChange();
    } catch {
      /* A UI listener cannot invalidate native ownership. */
    }
  }

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
    notify();
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
      readyAt = mono();
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
    if (message.t === 'recovered') {
      clearRing();
      stopAt = null;
      failedAt = mono(); // Broker still has a bounded deadline to exit with the recovery code.
      unsafe = true; // A terminal frame alone cannot authorize retry.
      child.stdin.end();
    }
    notify();
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
    if (
      stopAt === null &&
      readyAt !== null &&
      maxCaptureMs !== null &&
      elapsed - readyAt >= maxCaptureMs
    )
      stop('duration-limit');
    if (current.phase === 'running' && stopAt === null) send('ping', {});
  }
  function finish(target, code) {
    if (target !== child || closed) return;
    closed = true;
    clearInterval(timer);
    timer = null;
    if (current.phase === 'recovered' && code === 4) unsafe = false;
    else if (current.phase !== 'stopped' || code !== 0) {
      current = model.failSession(
        current,
        now(),
        current.phase === 'stopped' ? 'stop-unverified' : 'stream-ended',
      );
      // Even pre-ready failure could follow successful enable and a lost ready.
      unsafe = true;
    }
    summaries.push(
      createSummary(current, { capture, diagnostics, stopReason, code, endedAt: now() }),
    );
    if (summaries.length > 32) {
      summaries.shift();
      omittedSummaries++;
    }
    child = null;
    clearRing();
    notify();
    resolveCompletion?.(current.phase === 'stopped' && code === 0);
    resolveCompletion = null;
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
    readyAt = null;
    sent = 0n;
    pendingWrite = false;
    receivedReady = false;
    diagnostics = createDiagnostics(profileClock);
    stopSent = false;
    failedAt = null;
    clearRing();
    startedAt = receivedAt = mono();
    closed = false;
    notify();
    completion = Promise.resolve(false);
    try {
      child = spawnBroker(current.launchId, current.sessionId);
    } catch {
      current = model.failSession(current, now(), 'launch-failed');
      closed = true;
      notify();
      return false;
    }
    completion = new Promise((resolve) => {
      resolveCompletion = resolve;
    });
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
      if (!['stopped', 'recovered'].includes(current.phase)) fail('stream-ended');
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
    if (
      !['operator-stop', 'pause', 'suspend', 'restart', 'shutdown', 'duration-limit'].includes(
        reason,
      )
    )
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
      return completion;
    },
    isActive: () => child !== null && !closed,
    setUnavailable(state, detail) {
      idle = { ...idle, state, detail };
      notify();
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
