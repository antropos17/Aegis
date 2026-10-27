'use strict';

const { review: defaultReview } = require('./local-security-review');
const { performance } = require('node:perf_hooks');
const { validateSnapshot } = require('./inventory-snapshot');
const {
  resolveSnapshotSubject: defaultResolve,
  checkSnapshotSubject: defaultCheck,
  readSnapshotJson: defaultRead,
} = require('./inventory-snapshot-files');

const SUCCESS = 'SNAPSHOT_OK';
const UNAVAILABLE = 'SNAPSHOT_UNAVAILABLE';

function sameFile(first, second) {
  return first?.sha256 === second?.sha256 && first?.sourceSha256 === second?.sourceSha256;
}

function sameSubject(first, second) {
  return (
    first?.root === second?.root &&
    first?.rootSha256 === second?.rootSha256 &&
    first?.dev === second?.dev &&
    first?.ino === second?.ino &&
    first?.ino !== 0
  );
}

/**
 * Bind one explicitly selected accepted project snapshot to a finite launch.
 * This verifies a bounded local inventory, not complete project contents or authenticity.
 * @param {object} options Main-owned paths and optional private test seams.
 * @returns {object} Single-use binding, verification, closure and pending state.
 * @since v0.21.0-beta
 */
function createClaudeGuardSnapshot(options) {
  const { cwd, baselineFile, toolsFile = null, timeoutMs = 2000 } = options;
  const review = options.review ?? defaultReview;
  const read = options.readSnapshotJson ?? defaultRead;
  const resolve = options.resolveSnapshotSubject ?? defaultResolve;
  const checkSubject = options.checkSnapshotSubject ?? defaultCheck;
  let pending = null;
  let binding = null;
  let closed = false;
  let expired = false;

  async function examine() {
    if (typeof cwd !== 'string' || typeof baselineFile !== 'string') return { code: UNAVAILABLE };
    const subject = await resolve(cwd);
    const before = await read(baselineFile, subject);
    const baseline = validateSnapshot(before.value);
    if (baseline.state !== 'accepted') return { code: 'SNAPSHOT_REVIEW_REQUIRED' };
    if (!baseline.body.complete) return { code: 'SNAPSHOT_INCOMPLETE' };
    if (baseline.body.subject.adapter !== 'project') return { code: 'SNAPSHOT_INCOMPATIBLE' };
    if (baseline.body.subject.toolSourceSha256 && !toolsFile)
      return { code: 'SNAPSHOT_CATALOG_REQUIRED' };
    if (!baseline.body.subject.toolSourceSha256 && toolsFile)
      return { code: 'SNAPSHOT_INCOMPATIBLE' };
    const catalog = toolsFile ? await read(toolsFile) : null;
    const result = await review({
      mode: 'compare',
      adapter: 'project',
      directory: cwd,
      baselineFile,
      toolsFile,
    });
    const after = await read(baselineFile, subject);
    const catalogAfter = toolsFile ? await read(toolsFile) : null;
    await checkSubject(subject);
    if (!sameFile(before, after) || (catalog && !sameFile(catalog, catalogAfter)))
      return { code: 'SNAPSHOT_REVIEW_REQUIRED' };
    if (!sameSubject(subject, result.subject)) return { code: 'SNAPSHOT_INCOMPATIBLE' };
    if (result.baseline?.digest !== baseline.digest) return { code: 'SNAPSHOT_REVIEW_REQUIRED' };
    if (result.report?.status === 'incomplete' || result.report?.complete !== true)
      return { code: 'SNAPSHOT_INCOMPLETE' };
    if (result.report?.status === 'incompatible') return { code: 'SNAPSHOT_INCOMPATIBLE' };
    if (
      result.report?.status !== 'accepted-content-unchanged' ||
      result.report?.reviewRequired !== false ||
      result.baseline?.state !== 'accepted'
    )
      return { code: 'SNAPSHOT_REVIEW_REQUIRED' };
    return {
      code: SUCCESS,
      value: {
        subject,
        baseline: { sha256: before.sha256, sourceSha256: before.sourceSha256 },
        catalog: catalog ? { sha256: catalog.sha256, sourceSha256: catalog.sourceSha256 } : null,
        baselineDigest: baseline.digest,
        currentDigest: result.snapshot.digest,
      },
    };
  }

  async function execute() {
    if (closed || expired || pending) return { code: UNAVAILABLE };
    const started = performance.now();
    const operation = Promise.resolve()
      .then(examine)
      .catch(() => ({ code: UNAVAILABLE }));
    pending = operation;
    void operation.finally(() => {
      if (pending === operation) pending = null;
    });
    let timer;
    const result = await Promise.race([
      operation,
      new Promise((resolveTimeout) => {
        timer = setTimeout(() => {
          expired = true;
          resolveTimeout({ code: UNAVAILABLE });
        }, timeoutMs);
      }),
    ]);
    clearTimeout(timer);
    // Synchronous work can delay the timer callback; enforce elapsed time at
    // completion as well so a late microtask never wins the race.
    if (performance.now() - started >= timeoutMs) expired = true;
    return closed || expired ? { code: UNAVAILABLE } : result;
  }

  async function bind() {
    if (binding || closed || expired) return UNAVAILABLE;
    const result = await execute();
    if (result.code === SUCCESS) binding = result.value;
    return result.code;
  }

  async function verify() {
    if (!binding || closed || expired) return false;
    const expected = binding;
    const result = await execute();
    const current = result.value;
    return (
      result.code === SUCCESS &&
      !closed &&
      !expired &&
      binding === expected &&
      sameSubject(expected.subject, current.subject) &&
      sameFile(expected.baseline, current.baseline) &&
      ((!expected.catalog && !current.catalog) || sameFile(expected.catalog, current.catalog)) &&
      expected.baselineDigest === current.baselineDigest &&
      expected.currentDigest === current.currentDigest
    );
  }

  return Object.freeze({
    bind,
    verify,
    close: () => {
      closed = true;
      binding = null;
    },
    hasPending: () => !!pending,
  });
}

module.exports = { createClaudeGuardSnapshot };
