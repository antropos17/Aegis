import assert from 'node:assert/strict';
import path from 'node:path';

export const NATIVE_OBJECT_SUITES = Object.freeze([
  'tests/main/platform/etw-file-operational-runtime.test.js',
  'tests/main/platform/etw-file-admission.test.js',
  'tests/main/live-native-file-ingress.test.js',
  'tests/main/live-native-object-consumers.test.js',
  'tests/main/live-native-main-wiring.test.js',
  'tests/main/windows-native-read-logon.test.js',
  'tests/main/windows-native-read-manifest.test.js',
  'tests/main/windows-native-read-invocation.test.js',
  'tests/main/package-window-observation.test.js',
]);
// Includes the fresh-profile refusal and hidden-window classification regressions.
export const JAVASCRIPT_ASSERTIONS = 128;
export const NATIVE_ASSERTIONS = 146;
export const NATIVE_OBJECT_SOURCE_PATHS = Object.freeze([
  'src/main/platform/etw-file-admission.js',
  'sidecar/etw-file/FileObjectLease.cs',
  'sidecar/etw-file/FileMapping.cs',
  'src/main/platform/etw-file-runtime.js',
  'src/main/platform/etw-file-supervisor.js',
  'sidecar/etw-file/FileOrphanObserver.cs',
  'sidecar/etw-file/FileObjectNative.cs',
  'src/main/main.js',
  'src/main/native-file-ingress.js',
  'src/main/baselines.js',
  'src/shared/ecs-normalizer.js',
  'src/renderer/lib/utils/enrich-agents.ts',
  'scripts/qualification/windows-native-read-host.ps1',
  'frontend/observatory/tests/package-window-observation.mjs',
  'tools/development/etw-window-preflight.mjs',
  'scripts/qualification/windows-native-read-support.mjs',
]);
const slash = (value) => value.replaceAll('\\', '/');

/** Require the exact selected suites and complete passing assertions.
 * @param {object} report Vitest JSON report. @param {number} exitCode Actual process status.
 * @param {string} root Tested checkout. @returns {object} Verified control counts. @since v0.20.1
 */
export function validateJavascriptControls(report, exitCode, root) {
  const suites = report?.testResults;
  assert.equal(exitCode, 0, 'JavaScript controls failed');
  assert.equal(report?.success, true, 'JavaScript report is not successful');
  assert(
    Array.isArray(suites) && suites.length === NATIVE_OBJECT_SUITES.length,
    'Incomplete selected suites',
  );
  const expected = new Set(NATIVE_OBJECT_SUITES.map((name) => slash(path.resolve(root, name))));
  const names = new Set(),
    identities = new Set();
  let assertions = 0;
  for (const suite of suites) {
    assert(
      typeof suite.name === 'string' &&
        expected.has(slash(suite.name)) &&
        !names.has(slash(suite.name)),
      'Unexpected or duplicate suite',
    );
    names.add(slash(suite.name));
    assert.equal(suite.status, 'passed', 'Suite did not pass');
    assert(
      Array.isArray(suite.assertionResults) && suite.assertionResults.length > 0,
      'Empty suite',
    );
    for (const test of suite.assertionResults) {
      assert.equal(test.status, 'passed', 'Incomplete or failed assertion');
      assert(
        typeof test.fullName === 'string' && test.fullName.length > 0,
        'Missing assertion identity',
      );
      const identity = suite.name + '\0' + test.fullName;
      assert(!identities.has(identity), 'Duplicate assertion');
      identities.add(identity);
      assert(
        Array.isArray(test.failureMessages) && test.failureMessages.length === 0,
        'Assertion failure text',
      );
      assertions++;
    }
  }
  assert.equal(assertions, JAVASCRIPT_ASSERTIONS, 'Incomplete assertion inventory');
  for (const [key, count] of Object.entries({
    numTotalTests: assertions,
    numPassedTests: assertions,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
  }))
    assert.equal(report[key], count, `Incomplete report: ${key}`);
  assert.equal(report.numRuntimeErrorTestSuites ?? 0, 0, 'Runtime error suite');
  assert(
    Number.isInteger(report.numTotalTestSuites) &&
      report.numTotalTestSuites >= suites.length &&
      report.numPassedTestSuites === report.numTotalTestSuites,
    'Incomplete suite totals',
  );
  return { status: 'PASS', suites: suites.length, assertions, failed: 0 };
}

/** Validate the actual complete native self-test transcript and matching terminal summary.
 * @param {string} stdout Bounded native output. @param {number} exitCode Actual self-test status.
 * @param {number} buildExitCode Actual compiler status. @returns {object} Verified native counts. @since v0.20.1
 */
export function validateNativeControls(stdout, exitCode, buildExitCode) {
  assert.equal(buildExitCode, 0, 'Native build failed');
  assert.equal(exitCode, 0, 'Native self-test failed');
  assert(
    typeof stdout === 'string' && Buffer.byteLength(stdout) <= 2 * 1024 ** 2,
    'Native output budget',
  );
  const lines = stdout.trimEnd().split(/\r?\n/);
  assert.equal(
    lines.pop(),
    `${NATIVE_ASSERTIONS} self-tests passed; no ETW session or UAC requested.`,
    'Missing native completion',
  );
  const number = '(0|[1-9][0-9]{0,18})';
  const metrics = [
    {
      pattern: new RegExp(
        `^OUTPUT_ALLOC bytes: previous=${number}, current=${number}, batches=30$`,
      ),
      next: 'PASS single-pass output allocates less than the previous three-pass batch writer',
    },
    {
      pattern: new RegExp(
        `^BROKER_FORWARD frames=100 records=6400 previousBytes=${number} currentBytes=${number} previousMedianTicks=${number} currentMedianTicks=${number} frequency=([1-9][0-9]{0,18})$`,
      ),
      next: 'PASS broker forwarding allocates less than re-encoding validated observation frames',
    },
  ];
  const assertions = [],
    seenMetrics = new Set();
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^PASS .+/.test(line)) {
      assertions.push(line);
      continue;
    }
    const metric = metrics.find((value) => value.pattern.test(line));
    assert(
      metric && !seenMetrics.has(metric) && lines[index + 1] === metric.next,
      'Unexpected native output',
    );
    const values = metric.pattern.exec(line).slice(1);
    assert(
      values.every((value) => BigInt(value) <= 9223372036854775807n),
      'Native metric bounds',
    );
    seenMetrics.add(metric);
  }
  assert.equal(assertions.length, NATIVE_ASSERTIONS, 'Incomplete native inventory');
  assert.equal(new Set(assertions).size, assertions.length, 'Duplicate native assertion');
  return { status: 'PASS', assertions: assertions.length, buildExitCode, exitCode };
}

/** Refuse a final PASS unless one complete control pass left the source unchanged.
 * @param {object} receipt Producer receipt. @returns {true} Only for the complete controls contract. @since v0.20.1
 */
export function validateNativeObjectControls(receipt) {
  assert.equal(receipt?.schema, 'aegis-native-object-controls/1');
  assert.equal(receipt.mode, 'controls-only');
  assert.equal(receipt.status, 'PASS');
  assert.equal(receipt.error, null);
  assert.equal(receipt.platform, 'windows-x64-actions');
  assert.equal(receipt.mutationsPerformed, 0);
  assert.equal(receipt.sourceUnchanged, true);
  for (const key of ['restored', 'mutations', 'killed'])
    assert(!Object.hasOwn(receipt, key), 'Legacy mutation claim');
  for (const source of [receipt.source, receipt.sourceAfter])
    assert(
      source?.clean === true &&
        /^[a-f0-9]{40}$/.test(source.head) &&
        /^[a-f0-9]{40}$/.test(source.tree),
      'Source identity missing',
    );
  assert.deepEqual(receipt.sourceAfter, receipt.source, 'Source changed');
  for (const hashes of [receipt.sourceHashes, receipt.sourceHashesAfter]) {
    assert(
      hashes && Object.keys(hashes).length === NATIVE_OBJECT_SOURCE_PATHS.length,
      'Incomplete source hashes',
    );
    for (const name of NATIVE_OBJECT_SOURCE_PATHS)
      assert(
        Object.hasOwn(hashes, name) && /^[a-f0-9]{64}$/.test(hashes[name]),
        'Missing source digest',
      );
  }
  assert.deepEqual(receipt.sourceHashesAfter, receipt.sourceHashes, 'Source bytes changed');
  assert.deepEqual(receipt.focusedSuites, NATIVE_OBJECT_SUITES, 'Unexpected suites');
  assert.deepEqual(
    receipt.execution,
    { javascriptRuns: 1, nativeBuilds: 1, nativeRuns: 1 },
    'Repeated or missing controls',
  );
  assert.deepEqual(
    receipt.controls,
    {
      javascript: { status: 'PASS', suites: 9, assertions: JAVASCRIPT_ASSERTIONS, failed: 0 },
      native: { status: 'PASS', assertions: NATIVE_ASSERTIONS, buildExitCode: 0, exitCode: 0 },
    },
    'Incomplete controls',
  );
  assert(
    Array.isArray(receipt.diskSamples) && receipt.diskSamples.length === 6,
    'Missing storage observations',
  );
  for (const stage of ['before-javascript', 'before-native', 'after-controls'])
    for (const location of ['source', 'evidence']) {
      const samples = receipt.diskSamples.filter(
        (sample) => sample.stage === stage && sample.location === location,
      );
      assert(
        samples.length === 1 &&
          Number.isSafeInteger(samples[0].freeBytes) &&
          samples[0].freeBytes >= 6 * 1024 ** 3,
        'Insufficient storage',
      );
    }
  return true;
}
