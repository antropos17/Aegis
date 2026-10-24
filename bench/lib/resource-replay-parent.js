'use strict';
const { hash } = require('./resource-replay-json');
const c = require('./resource-replay-common');
const CAUSES = [
  null,
  'clock-unavailable',
  'timer-cleanup-unavailable',
  'detach-unavailable',
  'confirmation-timeout',
  'timer-unavailable',
  'wall-limit',
  'cancelled',
  'child-error',
  'lifecycle-invalid',
  'lifecycle-mismatch',
  'close-without-exit',
  'stream-unavailable',
  'stream-error',
  'output-overflow',
  'spawn-unavailable',
];
function termination(v) {
  c.exact(v, 'observed code signal');
  if (
    typeof v.observed !== 'boolean' ||
    (v.code !== null && !c.integer(v.code, -2147483648, 4294967295)) ||
    (v.signal !== null &&
      ![
        'SIGHUP',
        'SIGINT',
        'SIGQUIT',
        'SIGILL',
        'SIGTRAP',
        'SIGABRT',
        'SIGIOT',
        'SIGBUS',
        'SIGFPE',
        'SIGKILL',
        'SIGUSR1',
        'SIGSEGV',
        'SIGUSR2',
        'SIGPIPE',
        'SIGALRM',
        'SIGTERM',
        'SIGCHLD',
        'SIGSTKFLT',
        'SIGCONT',
        'SIGSTOP',
        'SIGTSTP',
        'SIGTTIN',
        'SIGTTOU',
        'SIGURG',
        'SIGXCPU',
        'SIGXFSZ',
        'SIGVTALRM',
        'SIGPROF',
        'SIGWINCH',
        'SIGIO',
        'SIGPOLL',
        'SIGPWR',
        'SIGSYS',
        'SIGBREAK',
        'SIGINFO',
        'SIGLOST',
      ].includes(v.signal))
  )
    c.fail();
  if (
    (!v.observed && (v.code !== null || v.signal !== null)) ||
    (v.code !== null && v.signal !== null)
  )
    c.fail();
}
/** @param {object} v Recorded prefix facts. @returns {void} @since unreleased */
function stream(v) {
  c.exact(
    v,
    'capBytes observedBytes observedBytesExact hashBytes overflow ended closed errorObserved destroyRequested sha256 complete',
  );
  for (const key of [
    'observedBytesExact',
    'overflow',
    'ended',
    'closed',
    'errorObserved',
    'destroyRequested',
    'complete',
  ])
    if (typeof v[key] !== 'boolean') c.fail();
  if (
    v.capBytes !== 16384 ||
    !c.integer(v.observedBytes) ||
    !c.integer(v.hashBytes, 0, 16384) ||
    !c.sha(v.sha256) ||
    v.hashBytes !== Math.min(v.observedBytes, 16384) ||
    v.overflow !== (v.observedBytes > 16384 || !v.observedBytesExact) ||
    (!v.observedBytesExact && v.observedBytes !== Number.MAX_SAFE_INTEGER) ||
    (v.hashBytes === 0 && v.sha256 !== hash(Buffer.alloc(0)))
  )
    c.fail();
  if (
    v.complete !== (v.ended && !v.errorObserved && !v.overflow && !v.destroyRequested) ||
    (v.complete && !v.closed)
  )
    c.fail();
}
/** @param {object} s Recorded lifecycle. @returns {boolean} Reconstructed success predicate. @since unreleased */
function lifecycle(s) {
  c.exact(
    s,
    'cause spawnObserved errorObserved exit close kill confirmation elapsedMs handleUnrefRequested stdout stderr',
  );
  if (
    !CAUSES.includes(s.cause) ||
    ['spawnObserved', 'errorObserved', 'handleUnrefRequested'].some(
      (key) => typeof s[key] !== 'boolean',
    ) ||
    (s.elapsedMs !== null && !c.integer(s.elapsedMs))
  )
    c.fail();
  termination(s.exit);
  termination(s.close);
  stream(s.stdout);
  stream(s.stderr);
  c.exact(s.kill, 'attempted returned reason');
  if (
    typeof s.kill.attempted !== 'boolean' ||
    ![null, true, false].includes(s.kill.returned) ||
    ![null, 'kill-unavailable'].includes(s.kill.reason) ||
    (!s.kill.attempted && (s.kill.returned !== null || s.kill.reason !== null)) ||
    (s.kill.reason && s.kill.returned !== null) ||
    (s.kill.attempted && s.cause === null)
  )
    c.fail();
  if (
    s.confirmation !==
      (s.exit.observed && s.close.observed
        ? 'exit-and-close-observed'
        : s.exit.observed
          ? 'exit-observed-close-unconfirmed'
          : 'exit-unconfirmed') ||
    (s.exit.observed && s.handleUnrefRequested) ||
    ((s.stdout.overflow || s.stderr.overflow || s.stdout.errorObserved || s.stderr.errorObserved) &&
      s.cause === null)
  )
    c.fail();
  if (
    (s.errorObserved && s.cause === null) ||
    (s.exit.observed &&
      s.close.observed &&
      (s.exit.code !== s.close.code || s.exit.signal !== s.close.signal) &&
      s.cause === null)
  )
    c.fail();
  const success =
    s.cause === null &&
    s.spawnObserved &&
    s.exit.observed &&
    s.exit.code === 0 &&
    s.exit.signal === null &&
    s.close.observed &&
    s.close.code === 0 &&
    s.close.signal === null &&
    s.stdout.complete &&
    s.stderr.complete;
  if (success && s.elapsedMs === null) c.fail();
  if (s.cause === 'wall-limit' && !c.integer(s.elapsedMs, 1)) c.fail();
  return success;
}
/** Validate all present parent declarations independently of missing child files. @param {object} bundle Exact parsed parts. @returns {object} Reported facts. @since unreleased */
function validateParent(bundle) {
  const p = bundle['supervision-plan.json'],
    n = bundle['supervision-pending.json'],
    f = bundle['supervision-final.json'];
  if (p) {
    const v = p.value;
    c.base(
      v,
      'resource-supervision-plan/1',
      'version runId scope executionMode child wallLimitMs confirmMs streams environment sources limits',
      'owned-node-child',
    );
    if (
      !['real-child', 'injected'].includes(v.executionMode) ||
      !c.integer(v.wallLimitMs, 1, 120000) ||
      !c.integer(v.confirmMs, 1, 10000) ||
      v.environment !== 'minimal-os-and-owned-temporary-no-inherited-node-options'
    )
      c.fail();
    c.exact(v.child, 'entry output durationMs maxAcquisitionUs maxCpuUncertaintyUs');
    c.options(v.child);
    if (v.child.entry !== 'bench/self-resource-run.cjs' || v.child.output !== 'capture') c.fail();
    c.fixed(v.streams, { capBytesEach: 16384, retention: 'sha256-prefix-no-text' });
    c.fixed(v.limits, { totalParentBytes: 65536, files: c.PARENT_CAPS });
    c.inventory(v.sources, true);
  }
  if (n) {
    const v = n.value;
    c.base(v, 'resource-supervision-pending/1', 'version runId state planSha256 executionMode');
    if (v.state !== 'pending' || !['real-child', 'injected'].includes(v.executionMode)) c.fail();
    c.link(v.planSha256, p);
    if (p && v.executionMode !== p.value.executionMode) c.fail();
  }
  let success = null;
  if (f) {
    const v = f.value;
    c.base(
      v,
      'resource-supervision-final/1',
      'version runId scope executionMode state finalPublication childBundleAssessment planSha256 supervision sources files',
      'owned-node-child',
    );
    if (
      v.finalPublication !== 'not-self-attested' ||
      v.childBundleAssessment !== 'not-inspected' ||
      !['real-child', 'injected'].includes(v.executionMode)
    )
      c.fail();
    c.link(v.planSha256, p);
    c.files(v.files, Object.keys(c.PARENT_CAPS).slice(0, 2), bundle, '');
    if (
      v.files.length !== 2 ||
      (p && v.executionMode !== p.value.executionMode) ||
      (n && v.executionMode !== n.value.executionMode)
    )
      c.fail();
    c.sources(v.sources, p?.value.sources, true);
    success = lifecycle(v.supervision);
    if (success && p && v.supervision.elapsedMs >= p.value.wallLimitMs) c.fail();
    if (p && v.supervision.cause === 'wall-limit' && v.supervision.elapsedMs < p.value.wallLimitMs)
      c.fail();
    if (
      v.state !==
      (v.sources.state !== 'unchanged'
        ? 'source-refused'
        : success
          ? 'completed-candidate'
          : 'failed')
    )
      c.fail();
  }
  return { plan: p?.value ?? null, final: f?.value ?? null, success };
}
module.exports = { validateParent, lifecycle, stream };
