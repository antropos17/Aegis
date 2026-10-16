import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  WINDOWS_SUITES,
  validateTestReport,
  parseWorktrees,
  retentionBlockers,
  classifyRun,
} from '../../tools/development/verification-contract.mjs';
import { boundedCommand } from '../../tools/development/bounded-command.mjs';

const root = path.resolve('test-checkout');
const passing = () => ({
  success: true,
  numFailedTests: 0,
  numFailedTestSuites: 0,
  numPendingTests: 0,
  numTodoTests: 0,
  numPendingTestSuites: 0,
  numTotalTests: WINDOWS_SUITES.length,
  numPassedTests: WINDOWS_SUITES.length,
  testResults: WINDOWS_SUITES.map((name) => ({
    name: path.join(root, name),
    status: 'passed',
    assertionResults: [{ status: 'passed' }],
  })),
});

describe('workflow diagnosis', () => {
  it('separates approval, pending and missing evidence from a successful run', () => {
    expect(classifyRun(null)).toBe('missing-head-run');
    expect(classifyRun({ status: 'in_progress' })).toBe('in-progress');
    expect(classifyRun({ status: 'completed', conclusion: 'action_required' })).toBe(
      'approval-required',
    );
    expect(classifyRun({ status: 'completed', conclusion: 'success' })).toBe('run-succeeded');
    for (const conclusion of ['skipped', 'neutral', 'cancelled', 'failure', 'timed_out', null])
      expect(classifyRun({ status: 'completed', conclusion })).toBe('run-not-successful');
  });
});

describe('Windows evidence validation', () => {
  it('accepts each expected native suite with executed assertions', () => {
    expect(validateTestReport(passing(), root)).toEqual({
      suites: WINDOWS_SUITES.length,
      assertions: WINDOWS_SUITES.length,
    });
  });
  it.each(['pending', 'todo', 'skipped', 'failed'])(
    'rejects an assertion marked %s despite aggregate success',
    (status) => {
      const report = passing();
      report.testResults[0].assertionResults[0].status = status;
      expect(() => validateTestReport(report, root)).toThrow();
    },
  );
  it.each(['numPendingTests', 'numTodoTests', 'numPendingTestSuites'])(
    'rejects missing/nonzero %s',
    (key) => {
      const report = passing();
      delete report[key];
      expect(() => validateTestReport(report, root)).toThrow();
      report[key] = 1;
      expect(() => validateTestReport(report, root)).toThrow();
    },
  );
  it('rejects duplicate, missing, empty and out-of-scope suites', () => {
    for (const mutate of [
      (r) => {
        r.testResults[1] = r.testResults[0];
      },
      (r) => {
        r.testResults.pop();
      },
      (r) => {
        r.testResults[0].assertionResults = [];
      },
      (r) => {
        r.testResults[0].name = path.join(root, 'unexpected.test.js');
      },
      (r) => {
        r.numPassedTests++;
      },
    ]) {
      const report = passing();
      mutate(report);
      expect(() => validateTestReport(report, root)).toThrow();
    }
  });
});

describe('worktree retention inventory', () => {
  it('preserves whitespace and newlines in NUL-delimited paths and lock reasons', () => {
    const input =
      'worktree C:/with space\nnext\0HEAD abc\0branch refs/heads/topic\0locked maintenance window\0\0worktree C:/other\0HEAD def\0detached\0\0';
    expect(parseWorktrees(input)).toEqual([
      {
        path: 'C:/with space\nnext',
        HEAD: 'abc',
        branch: 'refs/heads/topic',
        locked: 'maintenance window',
      },
      { path: 'C:/other', HEAD: 'def', detached: true },
    ]);
  });
  const reviewed = () => ({
    HEAD: 'abc',
    dirty: false,
    ownership: {
      owner: 'task-owner',
      task: 'fixture work',
      observedHead: 'abc',
      reviewAfter: '2026-01-01',
      receipts: ['private/receipt.json'],
    },
    dependencies: { linked: false, consumers: [] },
    retainedPaths: [],
  });
  it('requires explicit ownership, current revision and a due review date', () => {
    expect(retentionBlockers(reviewed(), '2026-01-02')).toEqual([]);
    for (const mutate of [
      (t) => {
        t.ownership = null;
      },
      (t) => {
        t.HEAD = 'def';
      },
      (t) => {
        t.ownership.reviewAfter = '2027-01-01';
      },
      (t) => {
        t.dirty = null;
      },
      (t) => {
        t.ownership.receipts = [];
      },
      (t) => {
        t.primary = true;
      },
      (t) => {
        t.locked = true;
      },
      (t) => {
        t.error = 'timeout';
      },
      (t) => {
        t.dependencies.consumers = ['another checkout'];
      },
      (t) => {
        t.dependencies.linked = true;
      },
      (t) => {
        t.retainedPaths = ['out'];
      },
    ]) {
      const tree = reviewed();
      mutate(tree);
      expect(retentionBlockers(tree, '2026-01-02').length).toBeGreaterThan(0);
    }
  });
});

describe('bounded diagnostic process', () => {
  let dir;
  afterEach(() => {
    if (!dir) return;
    if (
      path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir()) ||
      fs.lstatSync(dir).isSymbolicLink()
    )
      throw new Error('Unexpected fixture cleanup root');
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const run = (code, options = {}) => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-bounded-test-'));
    return boundedCommand(process.execPath, ['-e', code], {
      cwd: dir,
      env: process.env,
      log: path.join(dir, 'child.log'),
      timeoutMs: 5000,
      ...options,
    });
  };
  it('records an ordinary nonzero exit without calling it a timeout', async () => {
    const result = await run('process.stderr.write("failure"); process.exitCode = 7');
    expect(result.code).toBe(7);
    expect(result.reason).toBeNull();
    expect(fs.readFileSync(path.join(dir, 'child.log'), 'utf8')).toBe('failure');
  });
  it('caps output and terminates the owned child', async () => {
    const result = await run('setInterval(() => process.stdout.write("x".repeat(4096)), 1)', {
      maxBytes: 128,
    });
    expect(result.reason).toBe('output-limit');
    expect(result.termination.attempted).toBe(true);
    expect(fs.statSync(path.join(dir, 'child.log')).size).toBe(128);
  }, 15000);
  it('terminates an idle child at the deadline', async () => {
    const result = await run('setInterval(() => {}, 1000)', { timeoutMs: 500 });
    expect(result.reason).toBe('timeout');
    expect(result.termination.attempted).toBe(true);
  }, 15000);
});
