import path from 'node:path';

export const WINDOWS_SUITES = [
  'tests/main/session-caller-windows.test.js',
  'tests/main/session-caller-context-windows.test.js',
  'tests/main/sealed-import-windows.test.js',
  'tests/main/result-review-sealed-import.test.js',
  'tests/main/protected-gui-process-windows.test.js',
];

const STAGE_PHASES = new Set([
  'none',
  'setup',
  'stage',
  'execution-link-substitution',
  'preexisting-profile',
  'start',
  'ready',
  'query',
  'release',
  'initial-query',
  'initial-state',
  'busy-check-unbound',
  'busy-check-bound',
  'busy-check-result',
  'strict-payload-write',
  'strict-payload-delete',
  'strict-payload-result',
  'strict-payload-preserved',
  'active-upgrade-guard',
  'active-uninstall-guard',
  'active-guard-result',
  'stop',
  'restore-after-busy-check',
  'retry',
  'retire-original',
  'finally-clear-controls',
  'finally-stop',
  'finally-dispose-process',
  'finally-dispose-principal',
  'finally-dispose-parent',
]);
const STAGE_CODES = new Set([
  'none',
  'unclassified',
  'protected-gui-process-refused',
  'protected-gui-process-cleanup-unknown',
  'protected-gui-process-profile-refused',
  'protected-gui-principal-refused',
  'protected-gui-bundle-refused',
  'protected-gui-cleanup-unknown',
  'protected-gui-process-active',
  'protected-gui-process-association-refused',
  'protected-stage-acl-refused',
  'desktop-root-not-live',
  'desktop-window-capture-failed',
  'desktop-window-empty',
  'desktop-dpi-context-refused',
]);
const LEASE_PHASES = new Set([
  'none',
  'unavailable',
  'native-observe',
  'principal',
  'pins',
  'profile',
  'native-live',
  'binding',
  'native-exit-reobserve',
  'deadline-before',
  'deadline-after',
  'native-stop',
  'native-observe-stopped',
  'native-terminal-invariant',
  'known-cleanup',
  'native-close',
  'binding-close',
  'pins-restore',
  'profile-close',
  'principal-release',
]);

/** Project only finite failure enums; never copy a raw assertion message.
 * @param {object[]} assertions Native GUI assertions. @returns {object[]} Safe codes.
 * @since v0.19.2
 */
function stageFailures(assertions) {
  return assertions.slice(0, 32).flatMap((row, index) => {
    if (row?.status !== 'failed' || !Array.isArray(row.failureMessages)) return [];
    for (const text of row.failureMessages.slice(0, 4)) {
      if (typeof text !== 'string' || text.length > 32768) continue;
      const marker = /AEGIS_GUI_STAGE:([^\r\n]{1,1024})/.exec(text);
      if (!marker) continue;
      try {
        const v = JSON.parse(marker[1]);
        const fields = ['first', 'code', 'leasePhase', 'cleanup', 'cleanupCode'];
        if (
          !v ||
          typeof v !== 'object' ||
          Array.isArray(v) ||
          Object.keys(v).length !== 5 ||
          !fields.every((k) => Object.hasOwn(v, k)) ||
          !STAGE_PHASES.has(v.first) ||
          !STAGE_CODES.has(v.code) ||
          !LEASE_PHASES.has(v.leasePhase) ||
          !STAGE_PHASES.has(v.cleanup) ||
          !STAGE_CODES.has(v.cleanupCode)
        )
          continue;
        return [
          {
            assertion: index + 1,
            first: v.first,
            code: v.code,
            leasePhase: v.leasePhase,
            cleanup: v.cleanup,
            cleanupCode: v.cleanupCode,
          },
        ];
      } catch {
        /* Unknown/malformed diagnostics stay private. */
      }
    }
    return [];
  });
}

/** Locate failed native assertions without publishing titles, messages, paths or payloads.
 * @param {object} report Vitest JSON output. @param {string} root Tested checkout.
 * @returns {object[]} Fixed suite names, assertion positions and optional finite GUI codes. @since v0.19.2
 */
export function describeTestFailure(report, root) {
  const results = Array.isArray(report?.testResults) ? report.testResults : [];
  return WINDOWS_SUITES.flatMap((suite) => {
    const result = results.find(
      (row) =>
        typeof row?.name === 'string' && path.resolve(row.name) === path.resolve(root, suite),
    );
    if (!result || result.status === 'passed') return [];
    const assertions = Array.isArray(result.assertionResults) ? result.assertionResults : [];
    const stages =
      suite === 'tests/main/protected-gui-process-windows.test.js' ? stageFailures(assertions) : [];
    return [
      {
        suite,
        failedAssertions: assertions
          .flatMap((row, index) => (row?.status === 'failed' ? [index + 1] : []))
          .slice(0, 32),
        nonPassingAssertions: assertions.filter((row) => row?.status !== 'passed').length,
        totalAssertions: assertions.length,
        ...(stages.length ? { stageFailures: stages } : {}),
      },
    ];
  });
}

/** Classify a workflow observation without treating absent/skipped evidence as success.
 * @param {object|null} run GitHub Actions run.
 * @returns {string} Diagnostic state. @since v0.19.2
 */
export function classifyRun(run) {
  if (!run) return 'missing-head-run';
  if (run.status !== 'completed') return 'in-progress';
  if (run.conclusion === 'action_required') return 'approval-required';
  return run.conclusion === 'success' ? 'run-succeeded' : 'run-not-successful';
}

/** Reject missing, skipped, duplicate or unexpected suite evidence.
 * @param {object} report Vitest JSON reporter output.
 * @param {string} root Tested checkout.
 * @param {string[]} suites Expected relative suite paths.
 * @returns {{suites: number, assertions: number}} @since v0.19.2
 */
export function validateTestReport(report, root, suites = WINDOWS_SUITES) {
  if (report.success !== true || report.numFailedTests !== 0 || report.numFailedTestSuites !== 0)
    throw new Error('Test report did not succeed');
  for (const key of ['numPendingTests', 'numTodoTests', 'numPendingTestSuites']) {
    if (report[key] !== 0) throw new Error(`Missing or nonzero ${key}`);
  }
  if (!Array.isArray(report.testResults) || report.testResults.length !== suites.length)
    throw new Error('Missing or unexpected suite');
  const expected = new Set(suites.map((file) => path.resolve(root, file)));
  let assertions = 0;
  for (const suite of report.testResults) {
    if (typeof suite.name !== 'string' || !expected.delete(path.resolve(suite.name)))
      throw new Error('Unexpected or duplicate suite');
    if (suite.status !== 'passed' || !suite.assertionResults?.length)
      throw new Error('Empty or failed suite');
    for (const assertion of suite.assertionResults) {
      if (assertion.status !== 'passed') throw new Error('Skipped or failed assertion');
      assertions++;
    }
  }
  if (expected.size || report.numTotalTests !== assertions || report.numPassedTests !== assertions)
    throw new Error('Inconsistent assertion totals');
  return { suites: suites.length, assertions };
}

/** Parse Git's NUL-delimited worktree inventory without unquoting paths.
 * @param {string} text `git worktree list --porcelain -z` output.
 * @returns {object[]} Worktrees including lock/prune reasons. @since v0.19.2
 */
export function parseWorktrees(text) {
  const records = [];
  let current;
  for (const field of text.split('\0')) {
    if (!field) {
      current = undefined;
      continue;
    }
    const space = field.indexOf(' ');
    const key = space < 0 ? field : field.slice(0, space);
    const value = space < 0 ? true : field.slice(space + 1);
    if (key === 'worktree') {
      current = { path: value };
      records.push(current);
    } else if (current) current[key] = value;
  }
  return records;
}

/** Explain blockers to a human retention review; this never authorizes deletion.
 * @param {object} tree Observed checkout plus explicitly supplied ownership.
 * @param {string} today UTC date.
 * @returns {string[]} Review blockers. @since v0.19.2
 */
export function retentionBlockers(tree, today) {
  const blockers = [];
  if (tree.primary) blockers.push('primary checkout');
  if (tree.error) blockers.push('inspection incomplete');
  if (tree.locked || tree.prunable || tree.bare) blockers.push('special Git state');
  if (tree.dirty !== false) blockers.push('dirty state or unknown');
  if (!tree.ownership?.owner || !tree.ownership?.task) blockers.push('owner/task unknown');
  if (tree.ownership?.observedHead !== tree.HEAD) blockers.push('ownership record needs refresh');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(tree.ownership?.reviewAfter ?? '') ||
    tree.ownership.reviewAfter > today
  )
    blockers.push('retention review not due');
  if (!tree.ownership?.receipts?.length) blockers.push('receipt locations unrecorded');
  if (tree.dependencies?.consumers?.length) blockers.push('dependency consumers attached');
  if (tree.dependencies?.linked) blockers.push('linked dependencies require owner review');
  if (tree.retainedPaths?.length) blockers.push('ignored artifacts need preservation review');
  return blockers;
}
