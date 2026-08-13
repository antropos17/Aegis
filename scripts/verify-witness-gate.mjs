/**
 * @file scripts/verify-witness-gate.mjs
 * @description Injection proof for the generation-witness gate in
 *   src/main/process-utils.js.
 *
 *   A green suite proves the suite ran, not that it inspected anything
 *   (memory-bank/ai-mistakes.md #21). This script breaks the gate on purpose — one
 *   mutant at a time, in a throwaway copy — and requires the witness suite to go
 *   RED for every mutant. A mutant that survives is reported and the script exits 1.
 *
 *   Nothing under version control is modified: each mutant is written to
 *   `src/main/.mutants/` (gitignored, removed in a finally), and the suite is
 *   pointed at it through AEGIS_PU_UNDER_TEST. The mutants live inside src/main so
 *   that a single depth adjustment (`./x` → `../x`) makes every relative require
 *   resolve; each rewritten path is checked on disk before the run, so a broken
 *   copy can never be mistaken for a killed mutant.
 *
 *   Usage: npm run verify:gate
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'src', 'main', 'process-utils.js');
const MUTANT_DIR = path.join(ROOT, 'src', 'main', '.mutants');
const TEST_FILE = path.join('tests', 'main', 'process-utils-witness.test.js');
const VITEST = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');

/**
 * Each mutant is a named, surgical breakage of one clause of the gate. `find` must
 * match exactly once — a mutant that silently changed nothing would "survive" for
 * the wrong reason.
 */
const MUTANTS = [
  {
    id: 'm1-gate-ignores-witness',
    why: 'the parent-chain gate trusts a live TTL entry without comparing the witness',
    edits: [
      {
        find: `    const proven =
      live &&
      (a.pid <= 0 ||
        (witness !== null &&
          cached.witness === witness.value &&
          cached.witnessSource === witness.source));`,
        replace: '    const proven = live;',
      },
    ],
  },
  {
    id: 'm2-witness-read-from-cache',
    why: 'the cwd gate reads the witness out of the shared cache instead of off the record',
    edits: [
      {
        find: '    witness: _providesStartTime && a.pid > 0 ? _recordWitness(a) : undefined,',
        replace: `    witness:
      _providesStartTime && a.pid > 0
        ? (() => {
            const shared = parentChainCache.get(_cacheKey(a.pid, _agentName(a)));
            return shared && shared.witness
              ? { value: shared.witness, source: shared.witnessSource }
              : null;
          })()
        : undefined,`,
      },
    ],
  },
  {
    id: 'm3-source-not-compared',
    why: 'the witness value is compared without its provenance, so two sources can prove each other',
    edits: [
      {
        find: `        (witness !== null &&
          cached.witness === witness.value &&
          cached.witnessSource === witness.source));`,
        replace: `        (witness !== null &&
          cached.witness === witness.value));`,
      },
      {
        find: `      (e.witness !== null &&
        cached &&
        cached.witness === e.witness.value &&
        cached.witnessSource === e.witness.source);`,
        replace: `      (e.witness !== null && cached && cached.witness === e.witness.value);`,
      },
    ],
  },
];

/**
 * Re-point every relative require one directory deeper, and prove each target
 * exists.
 * @param {string} code
 * @returns {string}
 */
function reparentRequires(code) {
  return code.replace(/require\('(\.[^']*)'\)/g, (_match, specifier) => {
    const deeper = `../${specifier.startsWith('./') ? specifier.slice(2) : specifier}`;
    const resolved = path.resolve(MUTANT_DIR, deeper);
    const exists =
      fs.existsSync(resolved) ||
      fs.existsSync(`${resolved}.js`) ||
      fs.existsSync(path.join(resolved, 'index.js'));
    if (!exists) {
      throw new Error(`mutant require rewrite points nowhere: ${specifier} → ${deeper}`);
    }
    return `require('${deeper}')`;
  });
}

/**
 * @param {{id: string, edits: Array<{find: string, replace: string}>}} mutant
 * @param {string} original
 * @returns {string} the mutated module path.
 */
function writeMutant(mutant, original) {
  let code = original;
  for (const edit of mutant.edits) {
    const occurrences = code.split(edit.find).length - 1;
    if (occurrences !== 1) {
      throw new Error(
        `${mutant.id}: expected its target to appear exactly once, found ${occurrences}. ` +
          'The gate was refactored — update this mutant instead of deleting it.',
      );
    }
    code = code.replace(edit.find, edit.replace);
  }
  const file = path.join(MUTANT_DIR, `process-utils.${mutant.id}.js`);
  fs.writeFileSync(file, reparentRequires(code), 'utf8');
  return file;
}

/**
 * @param {string|null} modulePath - null runs the suite against the real module.
 * @returns {{code: number, output: string}}
 */
function runSuite(modulePath) {
  const env = { ...process.env };
  if (modulePath) env.AEGIS_PU_UNDER_TEST = pathToFileURL(modulePath).href;
  else delete env.AEGIS_PU_UNDER_TEST;
  const res = spawnSync(process.execPath, [VITEST, 'run', '--project', 'main', TEST_FILE], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
  });
  return {
    code: res.status === null ? 1 : res.status,
    output: `${res.stdout || ''}${res.stderr || ''}`,
  };
}

// Newlines are normalised before matching: the repository normalises line endings
// per checkout (`.gitattributes` text=auto), so a mutant that only matched LF would
// find nothing on a Windows working tree and report a false "refactored" error.
const original = fs.readFileSync(SOURCE, 'utf8').replace(/\r\n/g, '\n');
const results = [];
let failed = false;

try {
  fs.mkdirSync(MUTANT_DIR, { recursive: true });

  // The control run: an unmutated module must be GREEN, or a red mutant proves
  // nothing at all.
  const control = runSuite(null);
  results.push({
    id: 'control (unmutated)',
    expected: 'green',
    got: control.code === 0 ? 'green' : 'RED',
  });
  if (control.code !== 0) {
    failed = true;
    console.error(control.output);
  }

  for (const mutant of MUTANTS) {
    const file = writeMutant(mutant, original);
    const run = runSuite(file);
    const killed = run.code !== 0;
    results.push({
      id: mutant.id,
      expected: 'RED',
      got: killed ? 'RED (killed)' : 'green (SURVIVED)',
    });
    if (!killed) {
      failed = true;
      console.error(`\nMutant SURVIVED: ${mutant.id}\n  ${mutant.why}\n`);
      console.error(run.output);
    }
  }
} finally {
  fs.rmSync(MUTANT_DIR, { recursive: true, force: true });
}

console.log('\nWitness-gate injection proof');
for (const r of results) {
  console.log(`  ${r.got.startsWith('green (SURV') ? '✗' : '✓'} ${r.id}: ${r.got}`);
}
if (failed) {
  console.error('\nThe gate is not fully load-bearing — a break in it left the suite green.');
  process.exit(1);
}
console.log('\nEvery mutant was killed: the witness gate is load-bearing.');
