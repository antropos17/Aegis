/**
 * @file scripts/verify-witness-gate.mjs
 * @description Injection proof for the generation-witness gate AND for the
 *   birth-time freshness contract in src/main/process-utils.js.
 *
 *   A green suite proves the suite ran, not that it inspected anything
 *   (memory-bank/ai-mistakes.md #21). This script breaks each on purpose — one
 *   mutant at a time, in a throwaway copy — and requires the suites to go RED for
 *   every mutant. A mutant that survives is reported and the script exits 1.
 *
 *   TWO PROPERTIES, not one. m1–m3 break the WITNESS comparison: whether a cached
 *   parent chain or cwd may be reused. m4 breaks FRESHNESS: whether the birth time
 *   `instanceId` is built from came from this pass's process map or from a cache
 *   entry. They are separable — the witness gate was already load-bearing while the
 *   freshness link was only asserted by tests — so a mutant exists for each.
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
/**
 * The suites every mutant is run against.
 *
 * A suite has KILLING POWER only if it resolves its module through
 * `AEGIS_PU_UNDER_TEST`. One that hard-imports `src/main/process-utils.js` loads the
 * REAL module and stays green whatever the mutant did — so listing it here buys a
 * regression net for the control run and NOT one assertion of gate strength. Both
 * kinds are run; only the override-aware ones are the gate, they are labelled as
 * such in the report, and the script refuses to report anything at all if none is
 * present. A mutant "killed" by a suite that never loaded it is precisely the
 * green-proves-nothing failure this script exists to prevent
 * (memory-bank/ai-mistakes.md #21).
 * @type {string[]}
 */
const TEST_FILES = [
  path.join('tests', 'main', 'process-utils-witness.test.js'),
  path.join('tests', 'main', 'process-utils.test.js'),
];
const VITEST = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');

/**
 * Whether a suite resolves its module under test through `AEGIS_PU_UNDER_TEST`, and
 * can therefore ever see a mutant.
 * @param {string} relPath - repo-relative path to the suite.
 * @returns {boolean}
 */
function honoursOverride(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8').includes('AEGIS_PU_UNDER_TEST');
}

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
  {
    id: 'm4-startTime-served-from-cache',
    why: 'the stamped birth time comes from a cache entry instead of this pass’s map',
    // Two edits, because the field this mutant reads no longer exists: PR #236 stopped
    // writing `startTime` into the entry precisely so that no later pass could read one.
    // Reinstating BOTH halves is what restores the pre-#236 shape and is the smallest
    // mutation that makes the identity input cacheable again — a one-sided read would
    // find `undefined`, fall through to `birthTime`, and "survive" by changing nothing.
    // `cached` is bound before `proven`, so an entry the witness did NOT prove still
    // answers: same pid, same executable name, a generation the gate rejected, and the
    // dead process's birth time is stamped anyway. That is the poisoning bug itself.
    edits: [
      {
        find: `      parentChainCache.set(key, {
        chain,
        witness: witness ? witness.value : null,
        witnessSource: witness ? witness.source : null,
        timestamp: now,
      });`,
        replace: `      parentChainCache.set(key, {
        chain,
        startTime: birthTime,
        witness: witness ? witness.value : null,
        witnessSource: witness ? witness.source : null,
        timestamp: now,
      });`,
      },
      {
        find: '    a.startTime = birthTime;',
        replace:
          '    a.startTime = cached && typeof cached.startTime === ' +
          "'number' ? cached.startTime : birthTime;",
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
  const res = spawnSync(process.execPath, [VITEST, 'run', '--project', 'main', ...TEST_FILES], {
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

// Which of the listed suites can actually see a mutant. Checked before anything is
// run: if none can, every RED below would be somebody else's failure and every green
// would mean nothing, so there is no result worth printing. Refuse rather than
// annotate (memory-bank/ai-mistakes.md #25).
const overrideAware = TEST_FILES.filter(honoursOverride);
if (overrideAware.length === 0) {
  console.error(
    'No suite in TEST_FILES resolves AEGIS_PU_UNDER_TEST, so every mutant would run\n' +
      'against the real module. There is no gate to report — refusing.',
  );
  process.exit(1);
}

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
console.log('  suites run:');
for (const f of TEST_FILES) {
  const role = honoursOverride(f) ? 'sees the mutant' : 'real module only — no killing power';
  console.log(`    ${f} — ${role}`);
}
for (const r of results) {
  console.log(`  ${r.got.startsWith('green (SURV') ? '✗' : '✓'} ${r.id}: ${r.got}`);
}
if (failed) {
  console.error('\nThe gate is not fully load-bearing — a break in it left the suite green.');
  process.exit(1);
}
console.log(
  `\nEvery mutant was killed by ${overrideAware.join(', ')}: the witness gate AND the` +
    '\nbirth-time freshness link are load-bearing.',
);
