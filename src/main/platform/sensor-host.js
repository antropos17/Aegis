/** @file Owned sensor/1 host factory; platform startup/polling integration is separate. @since 0.19.2-beta */
'use strict';
const { performance } = require('node:perf_hooks');
const { randomUUID } = require('node:crypto');
const { isPromise } = require('node:util').types;
const healthModel = require('../sensor-health');
const { createLauncher } = require('./sensor-host-launch');
const { createUpdates } = require('./sensor-host-updates');
const { createTransport } = require('./sensor-host-transport');
const { createSession } = require('./sensor-host-session');
const LIMIT = Number.MAX_SAFE_INTEGER;

/** Build an isolated host using trusted startup dependencies, never IPC options.
 * sink({generation,platform,mode,event,identity,nativeObservation}) must return true synchronously.
 * getLinuxContext must read the existing adapter's latest validated D1 context.
 * _test is a process-local fixture seam; production resolution uses fixed names.
 * @param {object} deps Sink, platform selection and optional lifecycle observers.
 * @returns {object} Lifecycle, exact replacement updates and closed status views.
 * @since 0.19.2-beta
 */
function createSensorHost(deps) {
  const ownerEpoch = randomUUID();
  const platform = deps.platform ?? process.platform;
  const test = deps._test ?? {};
  const mono = test.mono ?? (() => performance.now());
  const now = test.now ?? Date.now;
  const launch = createLauncher({
    platform,
    packaged: deps.packaged,
    getLinuxContext: deps.getLinuxContext,
    test,
  });
  const timeoutMs = 5000,
    stopMs = 1000,
    restartMs = 500,
    budget = 3;
  if (typeof deps.sink !== 'function') throw new Error('sensor-host-options-invalid');
  let health = healthModel.markDisabled(healthModel.createSensorHealth('native-sensor'), now());
  let phase = 'idle',
    reason = 'disabled',
    generation = 0,
    attempts = 0;
  let current = null,
    timer = null,
    retryAt = null,
    lastRestartAt = null;
  let desired = false,
    disposed = false,
    requestId = 0;
  let loss = 0n,
    completion = Promise.resolve(true),
    complete = null;
  function notify() {
    try {
      const result = deps.onStatus?.();
      if (isPromise(result)) Promise.prototype.then.call(result, undefined, () => {});
    } catch {
      /* Observers cannot change custody. */
    }
  }
  function setState(nextPhase, code) {
    phase = nextPhase;
    reason = code;
    notify();
  }
  function clearTimer() {
    if (timer) clearInterval(timer);
    timer = null;
  }
  function ensureTimer() {
    if (!timer) {
      timer = setInterval(tick, 100);
      timer.unref?.();
    }
  }
  function addLoss(count, code) {
    loss = loss + count > BigInt(LIMIT) ? BigInt(LIMIT) : loss + count;
    health.lossCount = Number(loss);
    health = healthModel.markDegraded(health, now(), { error: code, detail: code });
    reason = code;
    notify();
  }
  function failed(code) {
    if (!current || current.closing) return;
    current.closing = true;
    current.closeAt = mono();
    current.transport.cancel();
    try {
      current.child.stdin?.end();
    } catch {
      /* Kill deadline remains owned. */
    }
    if (health.state === 'DISABLED') health = healthModel.reenable(health, now());
    health = healthModel.markFailed(health, now(), { error: code, detail: code });
    setState('closing', code);
  }
  function id() {
    if (requestId === 4294967295) {
      failed('request-id-exhausted');
      return null;
    }
    return ++requestId;
  }
  function send(t, data, callback) {
    if (!current?.transport.ready()) return false;
    const request = id();
    if (request === null) return false;
    return current.transport.send({ t, id: request, ...data }, callback);
  }
  const updates = createUpdates({
    platform,
    current: () => current,
    desired: () => desired,
    disposed: () => disposed,
    send,
    notify,
    failed,
  });
  const pump = updates.pump;
  function closed(item, code) {
    if (current !== item) return;
    item.transport.cancel();
    current = null;
    complete?.(Boolean(!desired && item.stopAck && code === 0));
    complete = null;
    if (!desired || disposed) {
      health = healthModel.markDisabled(health, now(), { detail: 'disabled' });
      setState('stopped', 'disabled');
      clearTimer();
    } else {
      if (item.custodyLost) {
        setState('failed', 'custody-unconfirmed');
        clearTimer();
        return;
      }
      if (!item.closing) health = healthModel.markFailed(health, now(), { error: 'child-closed' });
      if (attempts < budget) {
        retryAt = mono() + restartMs;
        setState('waiting', 'restart-pending');
      } else {
        setState('failed', 'restart-exhausted');
        clearTimer();
      }
    }
  }
  function begin() {
    if (current || !desired || disposed) return false;
    retryAt = null;
    if (health.state === 'DISABLED') health = healthModel.reenable(health, now());
    const { child, context, error } = launch();
    if (error) {
      health =
        error === 'unsupported'
          ? healthModel.createUnsupported('native-sensor', { detail: error, now: now() })
          : healthModel.markFailed(health, now(), { error });
      setState('unavailable', error);
      clearTimer();
      return false;
    }
    const item = {
      child,
      generation: ++generation,
      closing: false,
      closeAt: null,
      killed: false,
      stopAck: false,
      applied: { watch: -1, paths: -1 },
      startedAt: mono(),
      lastAt: mono(),
      healthy: false,
    };
    current = item;
    requestId = 0;
    completion = new Promise((resolve) => {
      complete = resolve;
    });
    item.session = createSession({
      ownerEpoch,
      platform,
      pid: child.pid,
      generation,
      linuxContext: context,
      sink: deps.sink,
      onHello: () => {
        notify();
        pump();
      },
      onLoss: addLoss,
      active: () => current === item && desired && !item.closing,
      reply: (message) => item.transport.reply(message),
      onHealth(message) {
        if (message.state === 'HEALTHY') {
          item.healthy = true;
          attempts = 0;
          health = healthModel.markHealthy(health, now(), { detail: 'ready' });
          setState('running', loss ? 'loss-observed' : 'ready');
        } else if (message.state === 'DEGRADED' || message.state === 'STARTING') {
          health = healthModel.markDegraded(health, now(), {
            error: message.detail,
            detail: message.detail,
          });
          setState('running', message.detail);
        } else failed('sensor-failed');
      },
    });
    item.transport = createTransport({
      child,
      mono,
      timeoutMs,
      current: () => current === item && (!item.closing || !desired),
      progress: pump,
      fault: failed,
      accept(message) {
        if (item.closing && desired) return;
        if (!desired && !['ack', 'err', 'snap'].includes(message.t)) return;
        item.lastAt = mono();
        try {
          item.session.accept(message);
        } catch (error) {
          failed(error.message === 'sink-rejected' ? 'sink-rejected' : 'session-invalid');
        }
      },
    });
    child.on('close', (code) => closed(item, code));
    if (health.state === 'DISABLED') health = healthModel.reenable(health, now());
    health = {
      ...health,
      state: 'STARTING',
      lastAttemptAt: now(),
      lastError: null,
      detail: 'starting',
    };
    setState('starting', 'starting');
    ensureTimer();
    if (!item.transport.hasStreams() || !Number.isInteger(child.pid) || child.pid < 1) {
      failed('launch-failed');
      return false;
    }
    return true;
  }
  function tick() {
    if (retryAt !== null && mono() >= retryAt && !current && desired) {
      attempts++;
      lastRestartAt = now();
      begin();
    }
    const item = current;
    if (!item) return;
    if (item.closing || !desired) {
      if (mono() - item.closeAt >= stopMs && !item.killed) {
        item.killed = true;
        item.transport.cancel();
        try {
          item.child.kill('SIGKILL');
        } catch {
          /* Close must still be observed. */
        }
      }
      if (mono() - item.closeAt >= stopMs * 2) {
        item.custodyLost = true;
        if (health.state === 'DISABLED') health = healthModel.reenable(health, now());
        health = healthModel.markFailed(health, now(), { error: 'custody-unconfirmed' });
        setState('failed', 'custody-unconfirmed');
        complete?.(false);
        complete = null;
        clearTimer();
      }
      return;
    }
    item.transport.tick();
    // sensor/1 has no ping frame. A correlated snapshot proves liveness even
    // when a healthy sensor has no events or health transition to report.
    if (item.healthy && mono() - item.lastAt >= 2000)
      send('snap', {}, (message) => {
        if (message.t === 'err') failed('snapshot-rejected');
      });
    if (
      (!item.healthy && mono() - item.startedAt >= timeoutMs) ||
      mono() - item.lastAt >= timeoutMs
    )
      failed(item.session.hasHello() ? 'health-timeout' : 'hello-timeout');
    pump();
  }
  function stop() {
    desired = false;
    retryAt = null;
    if (!current) {
      clearTimer();
      health = healthModel.markDisabled(health, now(), { detail: 'disabled' });
      setState('stopped', 'disabled');
      return Promise.resolve(true);
    }
    current.closeAt ??= mono();
    health = healthModel.markDisabled(health, now(), { detail: 'disabled' });
    setState('stopping', 'disabled');
    if (current.session.hasHello() && !current.closing) pump();
    else {
      current.closing = true;
      try {
        current.transport.end();
      } catch {
        /* Deadline owns termination. */
      }
    }
    return completion;
  }
  return {
    start() {
      if (disposed || current || retryAt !== null) return false;
      desired = true;
      return begin();
    },
    stop,
    dispose() {
      disposed = true;
      updates.clear();
      return stop();
    },
    updateWatch: updates.updateWatch,
    updatePaths: updates.updatePaths,
    requestSnapshot: updates.requestSnapshot,
    getHealth: () => ({ ...health }),
    getStatus() {
      const caps = current?.session.getCapabilities() ?? null;
      const operating =
        phase === 'running' &&
        health.state === 'HEALTHY' &&
        !updates.pending().watchPending &&
        !updates.pending().pathsPending;
      return {
        phase,
        reason,
        platform: ['linux', 'darwin'].includes(platform) ? platform : 'unsupported',
        generation,
        mode: current?.session.getMode() ?? null,
        modeReason: current?.session.getModeReason() ?? null,
        capabilities: caps,
        coverage: Object.fromEntries(
          ['exec', 'exit', 'fork', 'fileOpen', 'tcpConnect'].map((key) => [
            key,
            operating && caps?.[key] ? 'observed' : 'coverage-lost',
          ]),
        ),
        qualification: 'unverified',
        polling: 'unchanged',
        lossCount: Number(loss),
        restart: { used: attempts, remaining: budget - attempts, lastAt: lastRestartAt },
        updates: updates.pending(),
      };
    },
  };
}
module.exports = { createSensorHost };
