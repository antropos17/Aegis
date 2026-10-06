/**
 * @file scripts/verify-audit-index-gate.mjs
 * @description Injection proof for three invariants of the audit-index history subsystem.
 *
 *   M1: the readiness/fallback boundary in getEntriesBefore — audit-logger.js
 *   M2: the type filter on the canonical JSONL fallback path — audit-logger.js
 *   M3: the timestamp ordering in the SQL projection — audit-index-query.js
 *
 *   A green suite proves the suite ran, not that it inspected anything
 *   (memory-bank/ai-mistakes.md #21). This script breaks each invariant on purpose —
 *   one mutant at a time, in a disposable copy of the repo — and requires the suites to
 *   go RED for the specific named test that guards that invariant. A mutant that
 *   survives (or a result that is inconclusive) is reported and the script exits 1.
 *
 *   Disposable-copy approach: the repo is copied to a temp dir (excluding node_modules,
 *   .git, coverage, runtime), node_modules is linked as a junction, and the mutation is
 *   applied by directly editing the target file in the copy. Nothing under version
 *   control is modified, even temporarily. The junction is removed explicitly before the
 *   recursive delete in the finally block to prevent traversal into the main node_modules
 *   (memory-bank/ai-mistakes.md #37).
 *
 *   Called by: tests/main/audit-index-mutation-gate.test.js (discovered by test:coverage)
 *   Usage: node scripts/verify-audit-index-gate.mjs
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VITEST = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');

/**
 * The test suites run for every mutant. The gate test file is intentionally absent:
 * including it would cause infinite recursion (it spawns this script).
 * The fallback suite kills M1 and M2; the audit-index suite catches M3.
 */
const TEST_FILES = [
  path.join('tests', 'main', 'audit-index-fallback.test.js'),
  path.join('tests', 'main', 'audit-index.test.js'),
];

/** Top-level directories excluded from the disposable copy. */
const EXCLUDE_TOPS = new Set([
  'node_modules',
  '.git',
  'coverage',
  'runtime',
  'dist',
  '.cache',
  '.nyc_output',
]);

/**
 * Three mutations, each a named surgical break of one clause.
 * `find` must match the normalised (LF) source exactly once — a mutant that
 * silently changed nothing would "survive" for the wrong reason.
 * `killedBy` is a substring expected in the `fullName` of the intended failing test.
 *
 * Kill targets (all in audit-index-fallback.test.js):
 *   M1: 'serves the real log/flush history' — baselineReads spy is 0 because jsonl()
 *       silently goes through SQL when the isReady guard is removed (private isReady is
 *       still true inside queryBefore). The strengthened assertion catches this.
 *   M2: 'serves the real log/flush history' — parity comparison fails because jsonl()
 *       now returns unfiltered JSONL while SQL still filters correctly.
 *   M3: 'orders clock-step records by timestamp' — SQL tie-break order changes, so the
 *       same-timestamp entries come back in file/line order rather than timestamp order.
 */
const MUTANTS = [
  {
    id: 'm1-readiness-boundary',
    why: 'getEntriesBefore always calls queryBefore without the isReady guard; throws when the index is not ready instead of falling back to JSONL',
    file: path.join('src', 'main', 'audit-logger.js'),
    find:
      '  try {\n' +
      '    if (auditIndex.isReady())\n' +
      '      return auditIndex.queryBefore(beforeTs, limit, typeFilter, boundaryOffset);\n' +
      '  } catch (_) {\n' +
      '    // The index records its failure without raw audit data; canon remains readable.\n' +
      '  }',
    replace:
      '  return auditIndex.queryBefore(beforeTs, limit, typeFilter, boundaryOffset);',
    killedBy: 'serves the real log/flush history',
  },
  {
    id: 'm2-jsonl-types-filter',
    why: 'JSONL fallback returns every entry regardless of type, ignoring typeFilter',
    file: path.join('src', 'main', 'audit-logger.js'),
    find: 'typeFilter === null || typeFilter.has(entry.type)',
    replace: 'true',
    killedBy: 'serves the real log/flush history',
  },
  {
    id: 'm3-order-by-file-line',
    why: 'SQL orders by file and line number instead of timestamp, scrambling the chronological history page',
    file: path.join('src', 'main', 'audit-index-query.js'),
    find: 'ORDER BY timestamp DESC, file DESC, line_no DESC LIMIT ?',
    replace: 'ORDER BY file DESC, line_no DESC LIMIT ?',
    killedBy: 'orders clock-step records by timestamp',
  },
];

/**
 * Normalise path separators to forward slashes for reliable prefix matching on Windows.
 * @param {string} p
 * @returns {string}
 */
function fwd(p) {
  return p.replace(/\\/g, '/');
}

/**
 * Populate a disposable copy of the repo, skipping large/irrelevant top-level dirs.
 * @param {string} dest
 */
function copyRepo(dest) {
  fs.cpSync(ROOT, dest, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(ROOT, src);
      if (!rel) return true; // the root itself always passes
      return !EXCLUDE_TOPS.has(rel.split(path.sep)[0]);
    },
  });
}

/**
 * Strip VITEST* env vars so nested vitest processes do not inherit the parent's
 * worker context (pool assignment, coverage, test-runner state).
 * @returns {NodeJS.ProcessEnv}
 */
function cleanEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !/^VITEST/.test(k)),
  );
}

/**
 * Run `node --check` on a file. Returns {ok: boolean, message: string}.
 * @param {string} filePath
 * @returns {{ok: boolean, message: string}}
 */
function syntaxCheck(filePath) {
  const res = spawnSync(process.execPath, ['--check', filePath], {
    encoding: 'utf8',
    timeout: 10000,
  });
  if (res.status !== 0) {
    return {
      ok: false,
      message: `syntax error in mutated file: ${(res.stderr || '').slice(0, 500)}`,
    };
  }
  return { ok: true, message: '' };
}

/**
 * Run the audit-index test suites from within a disposable copy and capture JSON output.
 * @param {string} copyRoot
 * @param {string} outputFile - where vitest writes its JSON reporter output
 * @param {number} [timeoutMs]
 * @returns {{code: number, json: object|null, stderr: string}}
 */
function runSuite(copyRoot, outputFile, timeoutMs = 60000) {
  const testPaths = TEST_FILES.map((f) => path.join(copyRoot, f));
  const res = spawnSync(
    process.execPath,
    [
      VITEST,
      'run',
      '--project',
      'main',
      '--reporter',
      'json',
      '--outputFile',
      outputFile,
      ...testPaths,
    ],
    { cwd: copyRoot, env: cleanEnv(), encoding: 'utf8', timeout: timeoutMs },
  );
  let json = null;
  if (fs.existsSync(outputFile)) {
    try {
      json = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
    } catch (_) {
      /* leave null — captured below */
    }
  }
  return {
    code: res.status === null ? 1 : res.status,
    json,
    stderr: (res.stderr || '').slice(0, 3000),
  };
}

/**
 * Verify a mutant run was killed by its named intended test, not merely by a load error,
 * a skip, or a file-path mismatch (which would mean the real module loaded instead of the
 * mutant), or a crash that incidentally produces exit 1.
 * @param {string} killedBy - substring expected in `fullName` of the failing test
 * @param {{code: number, json: object|null}} result
 * @param {string} copyRoot
 * @returns {{ok: boolean, reason: string}}
 */
function verify(killedBy, result, copyRoot) {
  if (result.code === 0) {
    return { ok: false, reason: 'suite passed — mutant survived' };
  }

  const json = result.json;
  if (!json) {
    return { ok: false, reason: 'no JSON output — load error or process crash (inconclusive)' };
  }

  const totalTests = json.numTotalTests ?? 0;
  if (totalTests === 0) {
    return { ok: false, reason: 'no tests collected — inconclusive' };
  }

  // Every reported test-file path must start with the copy root. This proves the mutant
  // files were loaded, not the originals. Use forward-slash normalisation (Windows).
  const copyPrefix = fwd(copyRoot);
  const allUnderCopy = (json.testResults ?? []).every((tr) =>
    fwd(tr.testFilePath ?? tr.name ?? '').startsWith(copyPrefix),
  );
  if (!allUnderCopy) {
    return {
      ok: false,
      reason: 'a test file resolved outside the copy root — original module loaded instead of mutant',
    };
  }

  // A suite that failed without any individual assertion results indicates a load or
  // syntax error, not a behavioural kill. (Syntax is also caught by `syntaxCheck`, but
  // a runtime require error at test-load time produces the same pattern here.)
  const hasLoadError = (json.testResults ?? []).some(
    (tr) => tr.numFailingTests > 0 && !(tr.assertionResults ?? []).length,
  );
  if (hasLoadError) {
    return {
      ok: false,
      reason: 'a suite failed without individual test results — likely a load/require error (inconclusive)',
    };
  }

  // Skipped tests could hide the gate assertion (a skipped test cannot fail).
  const skipped = json.numPendingTests ?? json.numSkippedTests ?? 0;
  if (skipped > 0) {
    return { ok: false, reason: `${skipped} skipped tests — inconclusive` };
  }

  // The specific named test must have failed with at least one failure message (an
  // assertion or thrown error) — not just been marked failed for an unrelated reason.
  const allResults = (json.testResults ?? []).flatMap((tr) => tr.assertionResults ?? []);
  const killingTest = allResults.find(
    (r) =>
      r.status === 'failed' &&
      (r.fullName ?? '').includes(killedBy) &&
      (r.failureMessages ?? []).length > 0,
  );
  if (!killingTest) {
    return {
      ok: false,
      reason: `no failing test (with failure messages) whose fullName contains "${killedBy}" — mutation not killed by its intended assertion`,
    };
  }

  return { ok: true, reason: `killed by "${killingTest.fullName}"` };
}

// ─── Main ────────────────────────────────────────────────────────────────────

const copyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-audit-gate-'));
// Print the copy path so the calling test can verify cleanup.
console.log(`copy: ${copyRoot}`);

const junctionPath = path.join(copyRoot, 'node_modules');
const results = [];
let failed = false;

try {
  copyRepo(copyRoot);
  // Link node_modules as a junction so the copy can run tests without re-installing.
  fs.symlinkSync(path.join(ROOT, 'node_modules'), junctionPath, 'junction');

  // Control run: the unmutated suite must be fully green before any mutation is declared
  // killed. A pre-existing failure makes all RED results untrustworthy.
  const controlOutput = path.join(copyRoot, 'vitest-control.json');
  const control = runSuite(copyRoot, controlOutput);
  if (control.code !== 0) {
    failed = true;
    results.push({ id: 'control (unmutated)', expected: 'green', got: 'RED' });
    console.error(
      'Control run failed — a pre-existing failure blocks the mutation gate.',
    );
    console.error(control.stderr);
    // Stop early: mutant results would be meaningless against a broken baseline.
    process.exitCode = 1;
  } else {
    results.push({ id: 'control (unmutated)', expected: 'green', got: 'green' });
  }

  if (!failed) {
    for (const mutant of MUTANTS) {
      const targetFile = path.join(copyRoot, mutant.file);
      const original = fs.readFileSync(targetFile, 'utf8').replace(/\r\n/g, '\n');

      // Exactly-once check: a silent no-op mutant would "survive" for the wrong reason.
      const occurrences = original.split(mutant.find).length - 1;
      if (occurrences !== 1) {
        failed = true;
        results.push({
          id: mutant.id,
          expected: 'RED',
          got: `inconclusive — target appears ${occurrences}× in the source (refactored? update this mutant)`,
        });
        console.error(
          `${mutant.id}: target appeared ${occurrences}× (expected 1).\n` +
            'The production code was likely refactored — update this mutant.',
        );
        continue;
      }

      const mutated = original.replace(mutant.find, mutant.replace);
      fs.writeFileSync(targetFile, mutated, 'utf8');

      // Syntax check before spending time on a full vitest run.
      const syn = syntaxCheck(targetFile);
      if (!syn.ok) {
        fs.writeFileSync(targetFile, original, 'utf8');
        failed = true;
        results.push({ id: mutant.id, expected: 'RED', got: `inconclusive — ${syn.message}` });
        console.error(`${mutant.id}: ${syn.message}`);
        continue;
      }

      const outputFile = path.join(copyRoot, `vitest-${mutant.id}.json`);
      const run = runSuite(copyRoot, outputFile);
      const { ok, reason } = verify(mutant.killedBy, run, copyRoot);

      // Restore the original before the next mutation to keep the copy clean.
      fs.writeFileSync(targetFile, original, 'utf8');

      results.push({
        id: mutant.id,
        expected: 'RED',
        got: ok ? `RED (killed — ${reason})` : `green (SURVIVED — ${reason})`,
      });
      if (!ok) {
        failed = true;
        console.error(`\nMutant SURVIVED: ${mutant.id}`);
        console.error(`  ${mutant.why}`);
        console.error(`  ${reason}`);
        if (run.stderr) console.error(run.stderr);
      }
    }
  }
} finally {
  // Remove the junction before the recursive delete to prevent following it into the
  // main node_modules tree (memory-bank/ai-mistakes.md #37).
  try {
    fs.rmdirSync(junctionPath);
  } catch (_) {
    // On non-Windows, rmdirSync on a symlink may throw ENOTDIR; fall back to unlink.
    try {
      fs.unlinkSync(junctionPath);
    } catch (_2) {
      /* junction may not exist if setup failed before symlinkSync */
    }
  }
  fs.rmSync(copyRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

console.log('\nAudit-index injection proof');
console.log('  test suites run per mutant:');
for (const f of TEST_FILES) {
  console.log(`    ${f}`);
}
console.log('  results:');
for (const r of results) {
  const mark =
    r.got.startsWith('green (SURV') || r.got.startsWith('inconclusive') ? '✗' : '✓';
  console.log(`  ${mark} ${r.id}: ${r.got}`);
}
if (failed) {
  console.error(
    '\nThe audit-index gate is not fully load-bearing — ' +
      'a mutation survived or the control failed.',
  );
  process.exit(1);
}
console.log(
  '\nAll three mutations killed: the readiness boundary, the JSONL types filter,\n' +
    'and the SQL timestamp ordering are load-bearing.',
);
