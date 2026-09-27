'use strict';

/** Build a private, fixed-shape execution receipt, without action contents.
 * @param {string} decision Policy/execution decision.
 * @param {string} reason Fixed reason code.
 * @param {object} [execution] Observed outcome.
 * @param {object} [options] Trusted protection selection.
 * @returns {object} Redacted receipt. @since v0.16.0 */
function actionReport(decision, reason, execution = {}, options = {}) {
  const isolated = options.appContainer === true;
  const protectedJob = isolated || options.protectedDescendants === true;
  const unknown = execution.state === 'unknown';
  return {
    schemaVersion: 1,
    mode: 'action-exec',
    decision,
    reason,
    execution: {
      state: 'not-started',
      exitCode: null,
      termination: 'not-requested',
      stdoutBytes: 0,
      stderrBytes: 0,
      outputComplete: !unknown,
      ...execution,
    },
    control: isolated
      ? 'windows-appcontainer-job'
      : protectedJob
        ? 'windows-job'
        : 'direct-child-only',
    descendantControl: protectedJob ? (unknown ? 'unconfirmed' : 'not-started') : 'unsupported',
    ...(isolated
      ? {
          input: options.importInput && unknown ? 'unknown' : 'not-imported',
          isolation: {
            state: unknown ? 'unknown' : 'not-started',
            workspace: unknown ? 'unknown' : 'not-created',
            profileCleanup: unknown ? 'unconfirmed' : 'not-required',
          },
        }
      : {}),
  };
}

/** Execute through the native owner, requiring its final cleanup receipt.
 * @param {object} launch Exact authorized launch.
 * @param {AbortSignal|undefined} signal Owning lifetime.
 * @param {object|null} authorization One-use approval metadata.
 * @param {Function} spawnProtected Trusted native adapter.
 * @param {object} limits Runtime and cleanup bounds.
 * @param {object} options Trusted protection selection.
 * @returns {Promise<object>} Redacted, verified or explicitly unknown outcome. @since v0.16.0 */
function runProtectedAction(launch, signal, authorization, spawnProtected, limits, options) {
  let child;
  try {
    child = spawnProtected(launch);
  } catch {
    return Promise.resolve({
      ...actionReport('deny', 'protected-launch-unavailable', {}, options),
      ...(authorization || {}),
    });
  }
  return new Promise((resolve) => {
    let settled = false;
    let interrupted = false;
    let interruptionReason = '';
    let cleanupTimer;
    let runtimeTimer;
    let startupTimer;
    const ready = () => {
      clearTimeout(startupTimer);
      runtimeTimer = setTimeout(() => interrupt('runtime-timeout'), limits.runtimeMs);
    };
    const finish = (decision, reason, state, confirmed, outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(runtimeTimer);
      clearTimeout(startupTimer);
      clearTimeout(cleanupTimer);
      child.removeListener('ready', ready);
      signal?.removeEventListener('abort', onAbort);
      child.stdin?.destroy();
      child.stdout?.destroy();
      child.stderr?.destroy();
      if (!confirmed) child.unref?.();
      resolve({
        ...actionReport(
          decision,
          reason,
          {
            state,
            exitCode: state === 'exited' ? outcome.exitCode : null,
            termination: !confirmed
              ? 'unconfirmed'
              : interrupted || state === 'interrupted'
                ? 'confirmed'
                : 'not-requested',
            stdoutBytes: outcome?.stdoutBytes || 0,
            stderrBytes: outcome?.stderrBytes || 0,
            outputComplete: state === 'exited' && outcome.outputComplete,
          },
          options,
        ),
        descendantControl: confirmed ? 'confirmed' : 'unconfirmed',
        ...(options.appContainer
          ? {
              input:
                options.importInput && confirmed && outcome && child.isolationVerified
                  ? 'imported'
                  : options.importInput
                    ? 'unknown'
                    : 'not-imported',
              isolation: {
                state: child.isolationVerified === true ? 'verified' : 'unknown',
                workspace: outcome?.workspaceRetained === true ? 'retained' : 'unknown',
                profileCleanup: outcome?.profileCleanup === true ? 'confirmed' : 'unconfirmed',
              },
            }
          : {}),
        ...(authorization || {}),
      });
    };
    const interrupt = (why) => {
      if (settled || interrupted) return;
      interrupted = true;
      interruptionReason = why;
      clearTimeout(runtimeTimer);
      clearTimeout(startupTimer);
      child.removeListener('ready', ready);
      try {
        child.stop();
      } catch {
        /* Receipt is the only cleanup confirmation. */
      }
      cleanupTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* Missing receipt stays unconfirmed. */
        }
        finish('unknown', 'cleanup-unconfirmed', 'unknown', false);
      }, limits.protectedCleanupMs);
    };
    const onAbort = () => interrupt('action-cancelled');
    child.on('error', () => interrupt('protected-launch-unavailable'));
    child.once('close', () => {
      const outcome = child.actionOutcome;
      if (!child.cleanupConfirmed || !outcome)
        return finish('unknown', 'cleanup-unconfirmed', 'unknown', false, outcome);
      if (
        options.appContainer &&
        (!child.isolationVerified ||
          !outcome.isolationVerified ||
          !outcome.workspaceRetained ||
          !outcome.profileCleanup)
      )
        return finish('unknown', 'isolation-unconfirmed', 'unknown', true, outcome);
      if (interrupted) return finish('allow', interruptionReason, 'interrupted', true, outcome);
      if (outcome.outputLimit) return finish('allow', 'output-limit', 'interrupted', true, outcome);
      if (outcome.exited) return finish('allow', 'child-exited', 'exited', true, outcome);
      return finish('unknown', 'protected-interrupted', 'interrupted', true, outcome);
    });
    if (options.appContainer && !child.isolationVerified) {
      startupTimer = setTimeout(
        () => interrupt('protected-launch-unavailable'),
        limits.isolationStartupMs,
      );
      child.once('ready', ready);
    } else ready();
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

module.exports = { actionReport, runProtectedAction };
