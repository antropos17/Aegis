/** @file Bounded diagnostic ETW transport owner; never emits FileEvents. */
'use strict';
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const wire = require('./etw-file-protocol');
const model = require('./etw-file-health');
const health = require('../sensor-health');
const { createDiagnostics, createSummary } = require('./etw-file-diagnostics');
const { bindTransport } = require('./etw-file-transport');
const { createIssuerPreparation } = require('./etw-file-issuer-preparation');

/** Own one broker at a time, with explicit retry and no elevated kill or replay.
 * @param {Object} deps - spawnBroker, optional clocks/ID factory for deterministic tests.
 * @returns {Object} Lifecycle, health and local-only diagnostic snapshot methods.
 * @since v0.14.2
 */
function createSupervisor({
  spawnBroker,
  spawnRecovery = null,
  ownerPid = process.pid,
  now = Date.now,
  mono = () => performance.now(),
  id = randomUUID,
  profileClock = process.hrtime.bigint,
  maxCaptureMs = null,
  onHealthChange = () => {},
  onObservations = () => {},
  onSessionStart = () => {},
  getIssuerTargets = null,
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
  let failureGraceMs = 15000;
  let stopReason = null;
  let capture = null;
  let readyAt = null;
  let privateLease = null,
    rescuing = false,
    lostBrokerCode = null,
    startPending = false,
    custodyObserved = false,
    consentAckPending = false,
    cleanupAttemptObserved = false;
  let nativeProcessIds = [];
  let completion = Promise.resolve(false),
    resolveCompletion = null;
  let diagnostics = createDiagnostics(profileClock);
  let summaries = [],
    omittedSummaries = 0;
  let idle = { ...health.createSensorHealth('etw-file'), state: 'DISABLED' };
  let lastHealth = '';
  const issuerPreparation = createIssuerPreparation({
    getTargets: getIssuerTargets,
    mono,
    id,
    send,
  });
  function refreshIssuers() {
    if (!child || closed || pendingWrite || stopAt !== null || current?.phase !== 'running') return;
    try {
      issuerPreparation.flush();
    } catch {
      fail('consumer-failed');
    }
  }
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
    if (!current) return;
    if (current.phase === 'failed') {
      consentAckPending = false;
      child?.stdin?.destroy();
      return;
    }
    current = model.failSession(current, now(), code);
    failedAt = mono();
    unsafe = receivedReady; // Once capture existed, missing cleanup forbids a new capture.
    restartRequested = false;
    clearRing();
    child?.stdin?.destroy(); // Broker EOF and collector lease own cleanup.
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
        flushStart();
        flushConsentAck();
        flushStop();
        refreshIssuers();
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
  function flushStart() {
    if (startPending && !pendingWrite && stopAt === null && current?.phase === 'starting') {
      startPending = false;
      if (!send('start', { requestId: startRequest, profile: wire.PROFILE, buffersMiB: 16 }))
        fail('consumer-failed');
    }
  }
  function flushConsentAck() {
    if (consentAckPending && !pendingWrite && current?.recoveryPending && !closed) {
      consentAckPending = false;
      if (!send('consent-ack', {})) fail('consumer-failed');
    }
  }
  function accept(message) {
    if (message.t === 'escrow') {
      if (
        rescuing ||
        privateLease ||
        typeof spawnRecovery !== 'function' ||
        current.lastSeq !== '0' ||
        current.helloSeen ||
        message.data.ownerPid !== ownerPid ||
        message.data.peers[0].pid !== child.pid
      )
        throw new Error('custody');
      privateLease = structuredClone(message.data);
      nativeProcessIds = message.data.peers.map((peer) => peer.pid);
      custodyObserved = true;
      receivedAt = mono();
      if (!send('escrow-ack', {})) throw new Error('write-busy');
      return; // Never enter health, diagnostics, summary or renderer state.
    }
    if (['recovering', 'recovered'].includes(message.t)) {
      if ((message.data.cause === 'broker-and-all-helpers-exited') !== rescuing)
        throw new Error('controller');
      if (
        rescuing &&
        message.t === 'recovered' &&
        Number.isInteger(lostBrokerCode) &&
        message.data.brokerExit !== lostBrokerCode
      )
        throw new Error('broker-exit');
    }
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
      startPending = true;
      flushStart();
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
    if (current.phase === 'failed' && message.t !== 'recovering') {
      failedAt = mono();
      unsafe = true;
      child.stdin.destroy();
      clearRing();
    }
    if (message.t === 'recovering') {
      failedAt = mono();
      failureGraceMs = 145000; // ACK <=8 s, one 120 s UAC window, receipt/exit/flush.
      cleanupAttemptObserved = true;
      consentAckPending = true;
      stopAt = null;
      unsafe = true;
      clearRing();
      flushConsentAck();
    }
    if (message.t === 'observations' && stopAt === null) {
      diagnostics.retain(message.data.records);
      onObservations(message.data.records);
    }
    if (message.t === 'issuers-primed') issuerPreparation.accept(message.data);
    if (message.t === 'stopped') {
      clearRing();
      child.stdin.end();
    }
    if (message.t === 'recovered') {
      clearRing();
      stopAt = null;
      failedAt = mono(); // Broker still has a bounded deadline to exit with the recovery code.
      failureGraceMs = 15000;
      unsafe = true; // A terminal frame alone cannot authorize retry.
      child.stdin.end();
    }
    notify();
    refreshIssuers();
  }
  function tick() {
    if (!child || closed) return;
    const elapsed = mono();
    if (failedAt !== null) {
      if (elapsed - failedAt > failureGraceMs) {
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
    if (current.phase === 'running' && stopAt === null) {
      refreshIssuers();
      if (current.phase === 'running' && stopAt === null) send('ping', {});
    }
  }
  function finish(target, code) {
    if (target !== child || closed) return;
    if (
      !['stopped', 'recovered'].includes(current.phase) &&
      privateLease &&
      !cleanupAttemptObserved &&
      !rescuing &&
      !disposed &&
      typeof spawnRecovery === 'function'
    ) {
      rescuing = true;
      lostBrokerCode = Number.isInteger(code) && code >= 0 && code <= 0xffffffff ? code | 0 : code;
      unsafe = true;
      restartRequested = false;
      current = {
        ...model.failSession(current, now(), 'broker-recovery-pending'),
        groupRecoveryAuthorized: true,
      };
      failedAt = mono();
      failureGraceMs = 40000;
      stopAt = null;
      pendingWrite = false;
      startPending = false;
      clearRing();
      try {
        child = spawnRecovery(current.launchId, current.sessionId);
        attach(child);
        if (!send('rescue', { lease: privateLease, lastSeq: current.lastSeq }))
          child.stdin?.destroy();
        notify();
        return;
      } catch {
        child = target;
        current = model.failSession(current, now(), 'broker-recovery-unverified');
      }
    }
    closed = true;
    issuerPreparation.reset();
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
    if (!unsafe) privateLease = null;
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
    issuerPreparation.reset();
    sent = 0n;
    pendingWrite = false;
    receivedReady = false;
    diagnostics = createDiagnostics(profileClock);
    onSessionStart();
    stopSent = false;
    failedAt = null;
    failureGraceMs = 15000;
    privateLease = null;
    nativeProcessIds = [];
    custodyObserved = false;
    cleanupAttemptObserved = false;
    consentAckPending = false;
    rescuing = false;
    lostBrokerCode = null;
    startPending = false;
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
    attach(child);
    timer = setInterval(tick, 2000);
    timer.unref?.();
    return true;
  }
  function attach(target) {
    decoder = bindTransport({
      target,
      launchId: current.launchId,
      sessionId: current.sessionId,
      isCurrent: () => target === child && !closed,
      measure: (name, operation) => diagnostics.measure(name, operation),
      onMessage: (message) => diagnostics.measure('acceptFrame', () => accept(message)),
      onEnd: () => {
        if (!['stopped', 'recovered'].includes(current.phase)) fail('stream-ended');
      },
      onFailure: fail,
      onClose: (code) => finish(target, code),
      stopped: () => current.phase === 'stopped',
    });
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
    refreshIssuers,
    restart() {
      if (unsafe || (rescuing && child)) return false;
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
        recoveryPending: (current?.recoveryPending === true || rescuing) && !closed,
        cleanupConsentPending: current?.recoveryPending === true && !closed,
        custodyObserved,
        issuerPreparation:
          current?.phase === 'running' && stopAt === null ? issuerPreparation.snapshot() : null,
        nativeProcessIds: [...nativeProcessIds], // IDs only; private handles, births and GUID never leave custody.
        phase: current?.phase || 'disabled',
        pendingBytes: decoder?.allocatedBytes() || 0,
      })),
  };
}
module.exports = { createSupervisor };
