'use strict';
const childProcess = require('node:child_process');
const { constants } = require('node:os');
const { streamObserver } = require('./resource-supervisor-stream');
const termination = (code, signal) =>
  (Number.isSafeInteger(code) && code >= -2147483648 && code <= 4294967295 && signal === null) ||
  (code === null && typeof signal === 'string' && Object.hasOwn(constants.signals, signal));
/** Observe only the returned owned child, with separate exit, close and bounded pipe facts.
 * @param {object} request Fixed command/args/spawnOptions plus wallLimitMs/confirmMs/signal.
 * @param {object} [deps] Validated spawn/nowNs/setTimer/clearTimer instrumentation.
 * @returns {Promise<object>} Sanitized monotonic/lifecycle observations; no child PID or text.
 * @since unreleased
 */
function observeChild(request, deps = {}) {
  const d = {
    spawn: childProcess.spawn,
    nowNs: () => process.hrtime.bigint(),
    setTimer: setTimeout,
    clearTimer: clearTimeout,
    ...deps,
  };
  return new Promise((resolve) => {
    const stdout = streamObserver(),
      stderr = streamObserver();
    const r = {
      cause: null,
      spawnObserved: false,
      errorObserved: false,
      exit: { observed: false, code: null, signal: null },
      close: { observed: false, code: null, signal: null },
      kill: { attempted: false, returned: null, reason: null },
      confirmation: 'pending',
      elapsedMs: null,
      handleUnrefRequested: false,
    };
    let child,
      origin,
      last,
      wallTimer,
      confirmTimer,
      done = false,
      confirmStarted = false,
      wallArms = 0;
    function now() {
      try {
        const ns = d.nowNs();
        if (typeof ns !== 'bigint' || ns < 0n || (last !== undefined && ns < last)) throw Error();
        last = ns;
        origin ??= ns;
        const elapsed = Number((ns - origin) / 1000000n);
        if (!Number.isSafeInteger(elapsed)) throw Error();
        r.elapsedMs = elapsed;
        return elapsed;
      } catch {
        r.cause ??= 'clock-unavailable';
        return null;
      }
    }
    function clear(timer) {
      if (timer !== undefined) {
        try {
          d.clearTimer(timer);
        } catch {
          r.cause ??= 'timer-cleanup-unavailable';
        }
      }
    }
    function finish() {
      if (done) return;
      done = true;
      clear(wallTimer);
      clear(confirmTimer);
      request.signal?.removeEventListener('abort', cancel);
      if (!r.exit.observed) {
        r.handleUnrefRequested = !!child;
        try {
          child?.unref();
        } catch {
          r.cause ??= 'detach-unavailable';
        }
      }
      for (const [pipe, observer] of [
        [child?.stdout, stdout],
        [child?.stderr, stderr],
      ]) {
        if (!observer.state.ended || !observer.state.closed) {
          observer.state.destroyRequested = !!pipe;
          try {
            pipe?.destroy();
          } catch {
            r.cause ??= 'detach-unavailable';
          }
        }
      }
      r.confirmation =
        r.exit.observed && r.close.observed
          ? 'exit-and-close-observed'
          : r.exit.observed
            ? 'exit-observed-close-unconfirmed'
            : 'exit-unconfirmed';
      resolve({ ...r, stdout: stdout.result(), stderr: stderr.result() });
    }
    function confirmation() {
      if (confirmStarted || done) return;
      confirmStarted = true;
      try {
        confirmTimer = d.setTimer(() => {
          now();
          r.cause ??= 'confirmation-timeout';
          finish();
        }, request.confirmMs);
      } catch {
        r.cause ??= 'timer-unavailable';
        finish();
      }
    }
    function stop(cause) {
      if (done) return;
      r.cause ??= cause;
      if (child && !r.exit.observed && !r.kill.attempted) {
        r.kill.attempted = true;
        try {
          const returned = child.kill('SIGKILL');
          r.kill.returned = typeof returned === 'boolean' ? returned : null;
        } catch {
          r.kill.reason = 'kill-unavailable';
        }
      }
      confirmation();
    }
    function deadline() {
      if (done) return;
      const elapsed = now();
      if (elapsed === null || elapsed >= request.wallLimitMs)
        stop(elapsed === null ? 'clock-unavailable' : 'wall-limit');
    }
    function armWall(ms) {
      if (++wallArms > 128) {
        stop('timer-unavailable');
        return;
      }
      wallTimer = d.setTimer(() => {
        deadline();
        if (!done && !r.cause) {
          try {
            armWall(Math.max(1, request.wallLimitMs - r.elapsedMs));
          } catch {
            stop('timer-unavailable');
          }
        }
      }, ms);
    }
    function maybeFinish() {
      if (done) return;
      deadline();
      if (
        r.close.observed &&
        (r.exit.observed || r.errorObserved) &&
        stdout.state.closed &&
        stderr.state.closed
      )
        finish();
    }
    function cancel() {
      stop('cancelled');
    }
    now();
    if (r.cause) {
      finish();
      return;
    }
    if (request.signal?.aborted) {
      r.cause = 'cancelled';
      finish();
      return;
    }
    request.signal?.addEventListener('abort', cancel, { once: true });
    try {
      armWall(request.wallLimitMs);
    } catch {
      r.cause = 'timer-unavailable';
      finish();
      return;
    }
    if (done || r.cause) {
      finish();
      return;
    }
    try {
      child = d.spawn(request.command, request.args, request.spawnOptions);
      child.on('error', () => {
        if (!done) {
          r.errorObserved = true;
          deadline();
          stop('child-error');
          maybeFinish();
        }
      });
      child.on('spawn', () => {
        if (!done) {
          r.spawnObserved = true;
          deadline();
        }
      });
      child.on('exit', (code, signal) => {
        if (done) return;
        r.exit.observed = true;
        if (termination(code, signal)) {
          r.exit.code = code;
          r.exit.signal = signal;
        } else r.cause ??= 'lifecycle-invalid';
        deadline();
        confirmation();
        maybeFinish();
      });
      child.on('close', (code, signal) => {
        if (done) return;
        r.close.observed = true;
        if (termination(code, signal)) {
          r.close.code = code;
          r.close.signal = signal;
        } else r.cause ??= 'lifecycle-invalid';
        if (r.exit.observed && (code !== r.exit.code || signal !== r.exit.signal))
          r.cause ??= 'lifecycle-mismatch';
        if (!r.exit.observed && !r.errorObserved) stop('close-without-exit');
        confirmation();
        maybeFinish();
      });
      for (const [pipe, observer] of [
        [child.stdout, stdout],
        [child.stderr, stderr],
      ]) {
        if (!pipe || typeof pipe.on !== 'function') {
          stop('stream-unavailable');
          continue;
        }
        pipe.on('error', () => {
          if (!done) {
            observer.state.errorObserved = true;
            stop('stream-error');
          }
        });
        pipe.on('data', (chunk) => {
          if (!done) {
            const reason = observer.data(chunk);
            deadline();
            if (reason) stop(reason);
          }
        });
        pipe.on('end', () => {
          if (!done) {
            observer.state.ended = true;
            maybeFinish();
          }
        });
        pipe.on('close', () => {
          if (!done) {
            observer.state.closed = true;
            maybeFinish();
          }
        });
      }
      deadline();
      if (r.cause && !r.kill.attempted) stop(r.cause);
    } catch {
      r.errorObserved = true;
      deadline();
      stop('spawn-unavailable');
      if (!child) finish();
    }
  });
}
module.exports = { observeChild };
