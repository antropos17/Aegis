/**
 * @file tests/main/audit-index-mutation-gate.test.js
 * @description Entry-point that wires scripts/verify-audit-index-gate.mjs into CI via
 * test:coverage. The runner creates a disposable copy of the repo, breaks one invariant
 * at a time, and asserts each mutation kills the specific named test that guards it.
 *
 * ai-mistakes.md #21: a green suite proves only that it ran; the runner script proves
 * the three invariants are load-bearing (a change to the guarded code makes CI go red).
 *
 * Time added to test:coverage: ~15–30 s (four nested vitest runs of ~1 s each plus copy).
 *
 * Targeted run:
 *   npx vitest run tests/main/audit-index-mutation-gate.test.js
 */
import { it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RUNNER = path.join(ROOT, 'scripts', 'verify-audit-index-gate.mjs');

// Strip VITEST* env vars so the runner's nested vitest processes start without the
// parent's worker context (pool assignment, coverage, test runner state).
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !/^VITEST/.test(k)),
);

it(
  'verify-audit-index-gate: all three injection probes killed',
  { timeout: 120000 },
  () => {
    const res = spawnSync(process.execPath, [RUNNER], {
      cwd: ROOT,
      env: cleanEnv,
      encoding: 'utf8',
      timeout: 90000,
    });
    const combined = (res.stdout ?? '') + (res.stderr ?? '');
    expect(res.status, combined).toBe(0);
    expect(combined).toContain('m1-readiness-boundary');
    expect(combined).toContain('m2-jsonl-types-filter');
    expect(combined).toContain('m3-order-by-file-line');
    expect(combined).toContain('All three mutations killed');
    // Prove the runner cleaned up after itself: the copy dir must not exist.
    const copyLine = (res.stdout ?? '').split('\n').find((l) => l.startsWith('copy: '));
    if (copyLine) {
      const copyDir = copyLine.slice('copy: '.length).trim();
      expect(fs.existsSync(copyDir), `copy dir "${copyDir}" was not cleaned up`).toBe(false);
    }
  },
);
