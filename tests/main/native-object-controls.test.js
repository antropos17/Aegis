import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  NATIVE_OBJECT_SUITES,
  JAVASCRIPT_ASSERTIONS,
  NATIVE_ASSERTIONS,
  NATIVE_OBJECT_SOURCE_PATHS,
  validateJavascriptControls,
  validateNativeControls,
  validateNativeObjectControls,
} from '../../tools/development/native-object-controls.mjs';

const root = path.resolve('control-fixture');
function javascriptReport() {
  let index = 0;
  return {
    success: true,
    numTotalTests: JAVASCRIPT_ASSERTIONS,
    numPassedTests: JAVASCRIPT_ASSERTIONS,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    numTotalTestSuites: 22,
    numPassedTestSuites: 22,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    testResults: NATIVE_OBJECT_SUITES.map((name) => ({
      name: path.resolve(root, name),
      status: 'passed',
      assertionResults: Array.from({ length: 14 }, () => ({
        fullName: `behavior ${++index}`,
        status: 'passed',
        failureMessages: [],
      })),
    })),
  };
}
const nativeOutput = () =>
  Array.from({ length: NATIVE_ASSERTIONS }, (_, i) => `PASS native behavior ${i}`).join('\r\n') +
  `\r\n${NATIVE_ASSERTIONS} self-tests passed; no ETW session or UAC requested.\r\n`;
function receipt() {
  const source = { head: 'a'.repeat(40), tree: 'b'.repeat(40), clean: true };
  return {
    schema: 'aegis-native-object-controls/1',
    mode: 'controls-only',
    status: 'PASS',
    error: null,
    platform: 'windows-x64-actions',
    source,
    sourceAfter: { ...source },
    sourceHashes: Object.fromEntries(
      NATIVE_OBJECT_SOURCE_PATHS.map((name) => [name, 'c'.repeat(64)]),
    ),
    sourceHashesAfter: Object.fromEntries(
      NATIVE_OBJECT_SOURCE_PATHS.map((name) => [name, 'c'.repeat(64)]),
    ),
    mutationsPerformed: 0,
    sourceUnchanged: true,
    focusedSuites: [...NATIVE_OBJECT_SUITES],
    execution: { javascriptRuns: 1, nativeBuilds: 1, nativeRuns: 1 },
    controls: {
      javascript: validateJavascriptControls(javascriptReport(), 0, root),
      native: validateNativeControls(nativeOutput(), 0, 0),
    },
    diskSamples: ['before-javascript', 'before-native', 'after-controls'].flatMap((stage) =>
      ['source', 'evidence'].map((location) => ({ stage, location, freeBytes: 8 * 1024 ** 3 })),
    ),
  };
}

describe('single-pass native object controls evidence', () => {
  it('accepts complete distinct suites and native completion exactly once without mutation claims', () => {
    expect(validateNativeObjectControls(receipt())).toBe(true);
    const js = javascriptReport();
    js.numRuntimeErrorTestSuites = 0;
    expect(validateJavascriptControls(js, 0, root).assertions).toBe(126);
  });

  it('refuses passing totals hiding omitted, substituted, skipped, duplicated or failed assertions', () => {
    const cases = [
      (r) => r.testResults.pop(),
      (r) => {
        r.testResults[0].name = path.resolve(root, 'unselected.test.js');
      },
      (r) => {
        r.testResults[0] = r.testResults[1];
      },
      (r) => r.testResults[0].assertionResults.pop(),
      (r) => {
        r.testResults[0].assertionResults[0].status = 'pending';
      },
      (r) => {
        r.testResults[0].assertionResults[0] = r.testResults[0].assertionResults[1];
      },
      (r) => {
        r.testResults[0].assertionResults[0].failureMessages = ['AssertionError'];
      },
      (r) => {
        r.numRuntimeErrorTestSuites = 1;
      },
      (r) => {
        r.numPassedTests = 125;
      },
      (r) => {
        r.numFailedTestSuites = 1;
      },
      (r) => {
        r.numPassedTestSuites = 21;
      },
      (r) => {
        r.success = false;
      },
    ];
    for (const change of cases) {
      const report = javascriptReport();
      change(report);
      expect(() => validateJavascriptControls(report, 0, root)).toThrow();
    }
    expect(() => validateJavascriptControls(javascriptReport(), 1, root)).toThrow();
  });

  it('requires the actual matching native terminal count and all distinct passing controls', () => {
    for (const text of [
      nativeOutput().replace('PASS native behavior 0\r\n', ''),
      nativeOutput().replace('PASS native behavior 0', 'FAIL native behavior 0'),
      nativeOutput().replace('PASS native behavior 0', 'PASS native behavior 1'),
      nativeOutput().replace('146 self-tests', '145 self-tests'),
      nativeOutput().split('\r\n').slice(0, -2).join('\r\n'),
      nativeOutput() + 'unexpected tail',
    ])
      expect(() => validateNativeControls(text, 0, 0)).toThrow();
    expect(() => validateNativeControls(nativeOutput(), 2, 0)).toThrow();
    expect(() => validateNativeControls(nativeOutput(), 0, 1)).toThrow();
  });

  it('refuses repeated or absent runs, changed source, old mutation assertions and missing disk guards', () => {
    for (const change of [
      (r) => {
        r.execution.javascriptRuns = 2;
      },
      (r) => {
        r.execution.nativeBuilds = 0;
      },
      (r) => {
        r.execution.nativeRuns = 2;
      },
      (r) => {
        r.controls.native.assertions = 145;
      },
      (r) => {
        r.sourceAfter.clean = false;
      },
      (r) => {
        r.sourceAfter.head = 'c'.repeat(40);
      },
      (r) => {
        r.sourceAfter.tree = 'c'.repeat(40);
      },
      (r) => {
        delete r.sourceHashes[NATIVE_OBJECT_SOURCE_PATHS[0]];
      },
      (r) => {
        r.sourceHashesAfter[NATIVE_OBJECT_SOURCE_PATHS[0]] = 'd'.repeat(64);
      },
      (r) => {
        r.sourceUnchanged = false;
      },
      (r) => {
        r.restored = true;
      },
      (r) => {
        r.killed = 29;
      },
      (r) => {
        r.mutations = [];
      },
      (r) => {
        r.mutationsPerformed = 1;
      },
      (r) => {
        r.mode = 'mutations';
      },
      (r) => r.diskSamples.pop(),
      (r) => {
        r.diskSamples[0].freeBytes = 1;
      },
      (r) => {
        r.diskSamples[0] = r.diskSamples[1];
      },
    ]) {
      const r = receipt();
      change(r);
      expect(() => validateNativeObjectControls(r)).toThrow();
    }
  });
});
