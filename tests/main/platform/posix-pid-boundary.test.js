/**
 * @file posix-pid-boundary.test.js
 * @description Behavioral regression tests for strict PID validation in shared POSIX parsers.
 *
 * Each test that covers a known defect is documented with the defect it exercises.
 * Tests that already pass on unfixed code are marked "guard" — they protect existing
 * invariants but do not exercise the listed defects.
 *
 * Targeted run:
 *   npx vitest run tests/main/platform/posix-pid-boundary.test.js \
 *     tests/main/platform/posix-shared.test.js
 */
import { describe, it, expect } from 'vitest';
import posixShared from '../../../src/main/platform/posix-shared.js';

const { parsePsOutput, parseLsofOutput, parseParentProcessMapFromPs } = posixShared;

// ─── parsePsOutput ─────────────────────────────────────────────────────────

describe('parsePsOutput() — strict PID validation', () => {
  // DEFECT: parseInt("100garbage", 10) === 100 passes the isNaN guard.
  it('rejects a pid token with a non-digit suffix (100garbage)', () => {
    const stdout = 'node 100garbage\n';
    const results = parsePsOutput(stdout);
    expect(results).toHaveLength(0);
  });

  // DEFECT: parseInt("0", 10) === 0, and isNaN(0) is false, so pid 0 is accepted.
  it('rejects a zero pid', () => {
    const stdout = 'zombie 0\n';
    const results = parsePsOutput(stdout);
    expect(results).toHaveLength(0);
  });

  // DEFECT: parseInt("-5", 10) === -5, and isNaN(-5) is false, so a negative pid is accepted.
  it('rejects a negative pid', () => {
    const stdout = 'ghost -5\n';
    const results = parsePsOutput(stdout);
    expect(results).toHaveLength(0);
  });

  // DEFECT: parseInt("99999999999999999999", 10) is not NaN, so an unsafe integer passes.
  it('rejects an unsafe-integer pid', () => {
    const stdout = 'big 99999999999999999999\n';
    const results = parsePsOutput(stdout);
    expect(results).toHaveLength(0);
  });

  // Boundary: Number.MAX_SAFE_INTEGER is accepted.
  it('accepts pid equal to Number.MAX_SAFE_INTEGER', () => {
    const pid = String(Number.MAX_SAFE_INTEGER); // "9007199254740991"
    const stdout = `node ${pid}\n`;
    const results = parsePsOutput(stdout);
    expect(results).toHaveLength(1);
    expect(results[0].pid).toBe(Number.MAX_SAFE_INTEGER);
  });

  // Boundary: Number.MAX_SAFE_INTEGER + 1 is rejected.
  it('rejects pid equal to Number.MAX_SAFE_INTEGER + 1', () => {
    const stdout = `node ${Number.MAX_SAFE_INTEGER + 1}\n`;
    const results = parsePsOutput(stdout);
    expect(results).toHaveLength(0);
  });

  // Guard: valid integer pid passes (was already handled, preserved by fix).
  it('accepts a valid positive integer pid (guard)', () => {
    const stdout = 'node 1234\n';
    const results = parsePsOutput(stdout);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: 'node', pid: 1234 });
  });

  // Guard: a mix of valid and invalid lines — valid ones pass through.
  it('passes valid lines and drops invalid-pid lines in a mixed batch', () => {
    const stdout = [
      'cursor 1234',       // valid
      'node 100garbage',   // invalid suffix — defect
      'orphan 0',          // zero pid — defect
      'bash 5678',         // valid
      'big 99999999999999999999', // unsafe integer — defect
    ].join('\n');
    const results = parsePsOutput(stdout);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ name: 'cursor', pid: 1234 });
    expect(results[1]).toMatchObject({ name: 'bash', pid: 5678 });
  });
});

// ─── parseLsofOutput ───────────────────────────────────────────────────────

describe('parseLsofOutput() — invalid p record clears context', () => {
  // DEFECT: parseInt("100garbage", 10) === 100, so subsequent n records are attributed
  // to pid 100 even though the p record was malformed.
  it('clears pid context on a malformed p record so subsequent n records are dropped', () => {
    const stdout = [
      'p100',
      'n10.0.0.1:5000->1.1.1.1:443',          // valid: pid 100
      'p100garbage',                             // malformed — must clear context
      'n10.0.0.1:5001->2.2.2.2:80',            // must not be attributed to pid 100
    ].join('\n');
    const results = parseLsofOutput(stdout, new Set([100]));
    expect(results).toHaveLength(1);
    expect(results[0].ip).toBe('1.1.1.1');
  });

  // Edge case: two valid p records interleaved with one invalid one.
  it('resumes correct attribution after a valid p record following an invalid one', () => {
    const stdout = [
      'p100',
      'n10.0.0.1:5000->1.1.1.1:443',   // pid 100, accepted
      'p0',                              // zero pid — invalid, clears context
      'n10.0.0.1:5001->2.2.2.2:80',    // must not be attributed
      'p200',                            // valid pid 200
      'n10.0.0.1:5002->3.3.3.3:8080',  // pid 200, accepted
    ].join('\n');
    const results = parseLsofOutput(stdout, new Set([100, 200]));
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ pid: 100, ip: '1.1.1.1' });
    expect(results[1]).toMatchObject({ pid: 200, ip: '3.3.3.3' });
  });

  // Guard: a purely valid sequence is not disturbed.
  it('handles a purely valid sequence without clearing (guard)', () => {
    const stdout = [
      'p100',
      'n10.0.0.1:5000->8.8.8.8:443',
      'p200',
      'n10.0.0.1:5001->9.9.9.9:80',
    ].join('\n');
    const results = parseLsofOutput(stdout, new Set([100, 200]));
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ pid: 100, ip: '8.8.8.8' });
    expect(results[1]).toMatchObject({ pid: 200, ip: '9.9.9.9' });
  });

  // Guard: T record following an invalid p record does not cause errors.
  it('a T record after an invalid p record does not throw (guard)', () => {
    const stdout = [
      'p100garbage',        // invalid — clears context
      'n10.0.0.1:5000->1.1.1.1:443',
      'TST=ESTABLISHED',    // must not crash or mutate anything
    ].join('\n');
    expect(() => parseLsofOutput(stdout, new Set([100]))).not.toThrow();
    const results = parseLsofOutput(stdout, new Set([100]));
    expect(results).toHaveLength(0);
  });
});

// ─── parseParentProcessMapFromPs ───────────────────────────────────────────

describe('parseParentProcessMapFromPs() — strict PID validation', () => {
  // DEFECT: pid 0 passes the regex and parseInt, so map.set(0, {...}) is executed.
  it('rejects an entry with pid 0 (kernel_task pattern)', () => {
    const stdout = '  0   0 kernel_task\n';
    const map = parseParentProcessMapFromPs(stdout);
    expect(map.has(0)).toBe(false);
    expect(map.size).toBe(0);
  });

  // DEFECT: an unsafe-integer pid passes parseInt without NaN, producing an unusable key.
  it('rejects an entry with an unsafe-integer pid', () => {
    const stdout = '  99999999999999999999   0 bignum\n';
    const map = parseParentProcessMapFromPs(stdout);
    expect(map.size).toBe(0);
  });

  // DEFECT: parseParentProcessMapFromPs also accepts zero as a PID (same pattern as above).
  it('drops zero-pid entries even when mixed with valid ones', () => {
    const stdout = [
      '  0   0 kernel_task',
      '  1   0 init',
      '  100   1 bash',
    ].join('\n');
    const map = parseParentProcessMapFromPs(stdout);
    expect(map.has(0)).toBe(false);
    expect(map.get(1)).toEqual({ name: 'init', ppid: 0 });
    expect(map.get(100)).toEqual({ name: 'bash', ppid: 1 });
    expect(map.size).toBe(2);
  });

  // Guard: ppid 0 is preserved (init/launchd have ppid 0).
  it('preserves pid 1 with ppid 0 (init/launchd) (guard)', () => {
    const stdout = '  1   0 launchd\n';
    const map = parseParentProcessMapFromPs(stdout);
    expect(map.get(1)).toEqual({ name: 'launchd', ppid: 0 });
  });

  // Boundary: MAX_SAFE_INTEGER pid is accepted.
  it('accepts pid equal to Number.MAX_SAFE_INTEGER', () => {
    const pid = String(Number.MAX_SAFE_INTEGER);
    const stdout = `  ${pid}   1 extreme\n`;
    const map = parseParentProcessMapFromPs(stdout);
    expect(map.has(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(map.get(Number.MAX_SAFE_INTEGER)).toEqual({ name: 'extreme', ppid: 1 });
  });

  // Boundary: MAX_SAFE_INTEGER + 1 as pid is rejected.
  it('rejects pid equal to Number.MAX_SAFE_INTEGER + 1', () => {
    const stdout = `  ${Number.MAX_SAFE_INTEGER + 1}   1 toolarge\n`;
    const map = parseParentProcessMapFromPs(stdout);
    expect(map.size).toBe(0);
  });
});
