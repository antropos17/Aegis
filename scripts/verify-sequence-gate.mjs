/**
 * @file scripts/verify-sequence-gate.mjs
 * @description Injection proof for the `temporal_ordered` state machine in
 *   src/main/sequence-engine.js — the sibling of verify-witness-gate.mjs.
 *
 *   A green suite proves the suite ran, not that it inspected anything
 *   (memory-bank/ai-mistakes.md #21). This script breaks the engine on purpose — one
 *   mutant at a time, in a throwaway copy — and requires the override-aware suite to
 *   go RED for every mutant. A mutant that survives is reported and the script exits 1.
 *
 *   FOUR PROPERTIES, one mutant each (docs/roadmap/sequence-rules.md §6):
 *   m1 ORDER — a step match is accepted at any index, not only the one the state is
 *   waiting for, so `B A` fires where only `A B` may; m2 EXPIRY — the maxspan comparison
 *   is gone, so a state never expires; m3 GROUP KEY — the state key collapses to the
 *   ruleId, so two instances share one sequence; m4 CAPS — MAX_OPEN_PER_RULE and
 *   MAX_OPEN_TOTAL become effectively unbounded, so nothing is ever evicted.
 *
 *   Nothing under version control is modified: each mutant is written to
 *   `src/main/.mutants/` (gitignored, removed in a finally), and the suite is pointed at
 *   it through AEGIS_SEQ_UNDER_TEST. The mutants live inside src/main so that a single
 *   depth adjustment (`./x` → `../x`) makes every relative require resolve; each
 *   rewritten path is checked on disk before the run, and each mutant is checked to
 *   have actually changed the source, so a broken or unapplied copy can never be
 *   mistaken for a killed mutant.
 *
 *   Usage: npm run verify:seq-gate
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'src', 'main', 'sequence-engine.js');
const MUTANT_DIR = path.join(ROOT, 'src', 'main', '.mutants');
/** The environment variable the gate suite resolves its module through. */
const OVERRIDE_ENV = 'AEGIS_SEQ_UNDER_TEST';
/**
 * The suites every mutant is run against.
 *
 * A suite has KILLING POWER only if it resolves its module through
 * `AEGIS_SEQ_UNDER_TEST`. One that hard-imports `src/main/sequence-engine.js` loads the
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
  path.join('tests', 'main', 'sequence-engine-gate.test.js'),
  path.join('tests', 'main', 'sequence-engine.test.js'),
];
const VITEST = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');

/**
 * Whether a suite resolves its module under test through `AEGIS_SEQ_UNDER_TEST`, and
 * can therefore ever see a mutant.
 * @param {string} relPath - repo-relative path to the suite.
 * @returns {boolean}
 */
function honoursOverride(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8').includes(OVERRIDE_ENV);
}

/**
 * Each mutant is a named, surgical breakage of one property of the engine. `find` must
 * match exactly once — a mutant that silently changed nothing would "survive" for the
 * wrong reason.
 */
const MUTANTS = [
  {
    id: 'm1-order-check-removed',
    why: 'a step match is accepted at any index, so B then A completes a rule written A then B',
    // Two edits, because order is enforced at two transitions: the ADVANCE compares the
    // event against `steps[stepIndex]` only, and the OPEN compares it against `steps[0]`
    // only. Relaxing the advance alone leaves `B A` unable to open on B, so the mutant
    // would "survive" by never reaching the relaxed branch.
    edits: [
      {
        find: '      const wanted = rule.steps[state.stepIndex];',
        replace:
          '      const wanted =\n' +
          '        rule.steps.find((s) => _matches(s, doc, categories)) ?? rule.steps[state.stepIndex];',
      },
      {
        find: '  if (_matches(rule.steps[0], doc, categories)) _openState(rule, key, doc, observedAt);',
        replace:
          '  if (rule.steps.some((s) => _matches(s, doc, categories))) {\n' +
          '    _openState(rule, key, doc, observedAt);\n' +
          '  }',
      },
    ],
  },
  {
    id: 'm2-expiry-comparison-removed',
    why: 'an open state never expires by maxspan, so a step landing past the window still completes',
    // Two edits, because expiry is decided at two places that must agree: transition 1
    // inside `_applyRule` and the `_sweepRule` the tick and the caps' micro-sweep share.
    edits: [
      {
        find: '    if (state !== undefined && _elapsed(state, observedAt) > rule.timespanMs) {',
        replace: '    if (state !== undefined && false) {',
      },
      {
        find: '    if (_elapsed(state, at) > rule.timespanMs) {',
        replace: '    if (_elapsed(state, at) > rule.timespanMs && false) {',
      },
    ],
  },
  {
    id: 'm3-group-key-collapsed-to-rule',
    why: 'the state key drops the instanceId, so two instances advance one shared sequence',
    edits: [
      {
        find:
          'function _applyRule(rule, key, doc, categories, observedAt) {\n' +
          '  const states = _open.get(rule.id);',
        replace:
          'function _applyRule(rule, key, doc, categories, observedAt) {\n' +
          '  key = rule.id;\n' +
          '  const states = _open.get(rule.id);',
      },
    ],
  },
  {
    id: 'm4-caps-removed',
    why: 'both caps are effectively unbounded, so the 129th instance under one rule evicts nothing',
    edits: [
      {
        find: 'const MAX_OPEN_PER_RULE = 128;',
        replace: 'const MAX_OPEN_PER_RULE = Number.MAX_SAFE_INTEGER;',
      },
      {
        find: 'const MAX_OPEN_TOTAL = 1024;',
        replace: 'const MAX_OPEN_TOTAL = Number.MAX_SAFE_INTEGER;',
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
          'The engine was refactored — update this mutant instead of deleting it.',
      );
    }
    code = code.replace(edit.find, edit.replace);
  }
  // A rewrite whose replacement equals its target would pass the count above and run the
  // REAL engine under a mutant's name; that is the unapplied-mutant failure, and it must
  // stop the run rather than be scored.
  if (code === original) {
    throw new Error(
      `${mutant.id}: its edits left the source byte-identical — nothing was mutated.`,
    );
  }
  const file = path.join(MUTANT_DIR, `sequence-engine.${mutant.id}.js`);
  fs.writeFileSync(file, reparentRequires(code), 'utf8');
  return file;
}

/**
 * @param {string|null} modulePath - null runs the suite against the real module.
 * @returns {{code: number, output: string}}
 */
function runSuite(modulePath) {
  const env = { ...process.env };
  if (modulePath) env[OVERRIDE_ENV] = pathToFileURL(modulePath).href;
  else delete env[OVERRIDE_ENV];
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
    `No suite in TEST_FILES resolves ${OVERRIDE_ENV}, so every mutant would run\n` +
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

console.log('\nSequence-engine injection proof');
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
  `\nEvery mutant was killed by ${overrideAware.join(', ')}: order, the maxspan boundary,` +
    '\ngroup-by isolation and the caps are load-bearing.',
);
