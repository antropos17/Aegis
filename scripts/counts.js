#!/usr/bin/env node
/**
 * @file scripts/counts.js
 * @description Derives the repository's countable facts from the tree and fails the
 *   build when a tracked file declares a different number.
 *
 *   memory-bank/ai-mistakes.md #24: a hand-maintained counter is true only until the
 *   next merge, and NOTHING goes red when it stops being true. The `audit-check`
 *   skill derives the agent count and only when somebody runs it. This script is the
 *   missing red: every counter below has a DERIVATION over the tree and a SCANNER
 *   that finds where the number is asserted, and any disagreement exits 1 naming the
 *   file, the line, the declared value and the derived one.
 *
 *   Two rules the script is built around:
 *
 *   1. **Nothing is hardcoded.** There is no expected value anywhere in this file —
 *      only commands that compute one. An `EXPECTED = 51` here would be ai-mistakes
 *      #24 reimplemented inside the tool written to kill it.
 *
 *   2. **A located line that cannot be parsed is RED, not skipped.** Each scanner is
 *      two independent layers: a deliberately over-broad LOCATOR keyed on the phrase
 *      ("CJS modules", "verification commands", "exceed it") and a PARSER that pulls
 *      the asserted integer out. Locator fires + parser yields nothing → reported as
 *      an unparseable declaration site. That is what makes a doc REWORD go red
 *      instead of quietly green; a single regex per counter would silently pass, and
 *      an empty result reading as a clean sweep is exactly the failure ai-mistakes
 *      #28 is about.
 *
 *   Every enumeration reads the INDEX (`git ls-files -z`), never a working-tree walk:
 *   a tracked file under an ignored path drops out of a walk with the standard
 *   exclusions (ai-mistakes #28). Note also that git pathspec
 *   globbing is fnmatch WITHOUT FNM_PATHNAME — `git ls-files 'src/main/*.js'` returns
 *   the whole subtree, not the top level — so every derivation lists a directory and
 *   splits the paths here rather than trusting a glob.
 *
 *   Usage: npm run counts:check
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');

/** This file's own repo-relative path. See SELF_EXCLUSION below. */
const SELF = 'scripts/counts.js';

/**
 * Every tracked path, straight out of the index.
 * @returns {string[]} repo-relative POSIX paths.
 */
function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

const TRACKED = trackedFiles();

/**
 * Tracked paths directly inside `dir`, one level deep only.
 * @param {string} dir - repo-relative directory, no trailing slash.
 * @param {(p: string) => boolean} [filter] - applied to the basename.
 * @returns {string[]}
 */
function trackedTopLevel(dir, filter = () => true) {
  const prefix = `${dir}/`;
  return TRACKED.filter((p) => {
    if (!p.startsWith(prefix)) return false;
    const rest = p.slice(prefix.length);
    return !rest.includes('/') && filter(rest);
  });
}

/**
 * Tracked paths anywhere under `dir`, at any depth.
 * @param {string} dir - repo-relative directory, no trailing slash.
 * @param {(p: string) => boolean} [filter] - applied to the full repo-relative path.
 * @returns {string[]}
 */
function trackedUnder(dir, filter = () => true) {
  const prefix = `${dir}/`;
  return TRACKED.filter((p) => p.startsWith(prefix) && filter(p));
}

/**
 * Newline count of a tracked file, matching `wc -l` (which counts terminators, so a
 * file without a trailing newline reports one less than its visible line count). The
 * documented derivation in CLAUDE.md is `git ls-files -z src | xargs -0 wc -l`, so
 * this must agree with `wc -l` and not with "number of visible lines".
 * @param {string} rel
 * @returns {number}
 */
function wcLines(rel) {
  const buf = fs.readFileSync(path.join(ROOT, rel));
  let n = 0;
  for (const byte of buf) if (byte === 0x0a) n += 1;
  return n;
}

/** @returns {string} full text of a tracked file, CRLF normalised. */
function readTracked(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

// ---------------------------------------------------------------------------
// Derivations. One command per counter, printed in the report so a reader can
// re-run it by hand.
// ---------------------------------------------------------------------------

/** @returns {number} mutants in the `MUTANTS` array of the injection-proof script. */
function deriveMutants() {
  const src = readTracked('scripts/verify-witness-gate.mjs');
  const start = src.indexOf('const MUTANTS = [');
  if (start === -1) throw new Error('scripts/verify-witness-gate.mjs: no `const MUTANTS = [`');
  const end = src.indexOf('\n];', start);
  if (end === -1) throw new Error('scripts/verify-witness-gate.mjs: MUTANTS array is unterminated');
  const body = src.slice(start, end);
  const ids = body.match(/^ {4}id: '/gm);
  if (!ids) throw new Error('scripts/verify-witness-gate.mjs: MUTANTS has no `id:` entries');
  return ids.length;
}

/** @returns {{jobs: number, commands: number}} the CI workflow's shape. */
function deriveCi() {
  const doc = /** @type {*} */ (yaml.load(readTracked('.github/workflows/ci.yml')));
  const jobs = Object.entries(doc.jobs);
  // `npm ci` is dependency installation, not a verification command — CLAUDE.md's own
  // table reads "commands the job runs, after `npm ci`". Everything else with a `run:`
  // counts, including a step this workflow marks continue-on-error: it is still a
  // command the job runs, and pretending otherwise would be the checker tuning its own
  // derivation so a declaration it is meant to police stays green.
  let commands = 0;
  for (const [, def] of jobs) {
    for (const step of def.steps || []) {
      if (typeof step.run !== 'string') continue;
      if (step.run.trim() === 'npm ci') continue;
      commands += 1;
    }
  }
  return { jobs: jobs.length, commands };
}

/** @returns {{invoke: number, push: number}} the preload contextBridge surface. */
function derivePreload() {
  const src = readTracked('src/main/preload.js');
  const invoke = src.match(/ipcRenderer\.invoke\(/g);
  const push = src.match(/ipcRenderer\.on\(/g);
  if (!invoke || !push)
    throw new Error('src/main/preload.js: no ipcRenderer.invoke/on calls found');
  return { invoke: invoke.length, push: push.length };
}

/** @returns {{agents: number, signatures: number}} from the agent database. */
function deriveAgentDatabase() {
  const db = /** @type {*} */ (JSON.parse(readTracked('src/shared/agent-database.json')));
  const list = Array.isArray(db) ? db : db.agents;
  if (!Array.isArray(list)) throw new Error('src/shared/agent-database.json: no agents array');
  const signatures = list.reduce((n, a) => n + (Array.isArray(a.names) ? a.names.length : 0), 0);
  return { agents: list.length, signatures };
}

/** @returns {{rules: number, files: number}} across the YAML rulesets. */
function deriveRules() {
  const files = trackedTopLevel('rules', (f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  let rules = 0;
  for (const file of files) {
    const doc = /** @type {*} */ (yaml.load(readTracked(file)));
    const list = Array.isArray(doc) ? doc : doc && doc.rules;
    if (!Array.isArray(list)) throw new Error(`${file}: no rules array`);
    rules += list.length;
  }
  return { rules, files: files.length };
}

/**
 * @returns {{over300: number, largestSrc: {file: string, lines: number},
 *   largestTest: {file: string, lines: number}}}
 */
function deriveFileSizes() {
  const measure = (dir) =>
    trackedUnder(dir, (p) => !p.endsWith('.json'))
      .map((p) => ({ file: p, lines: wcLines(p) }))
      .sort((a, b) => b.lines - a.lines);
  const src = measure('src');
  const tests = measure('tests');
  // `.json` is excluded because agent-database.json is data, not code — the same
  // exclusion CLAUDE.md's own derivation states. Binary assets under src/ (fonts)
  // are counted by wc as near-zero-line files and never reach the threshold.
  return {
    over300: src.filter((f) => f.lines > 300).length,
    largestSrc: src[0],
    largestTest: tests[0],
  };
}

const mutants = deriveMutants();
const ci = deriveCi();
const preload = derivePreload();
const database = deriveAgentDatabase();
const ruleset = deriveRules();
const sizes = deriveFileSizes();

const mainAll = trackedUnder('src/main', (p) => p.endsWith('.js'));
const mainTop = trackedTopLevel('src/main', (f) => f.endsWith('.js'));

/**
 * The CHECKED set. Every entry here MUST be declared by at least one tracked prose
 * file: the undeclared gate goes red when one is not, which is the invariant that
 * keeps a counter from quietly ceasing to be checked. `key` is what a scanner emits,
 * `command` is the hand-runnable derivation printed in the report.
 *
 * A counter earns a place here only if prose can restate its value and stay true for
 * more than one commit. One that moves on an ordinary single-line edit belongs in
 * `DERIVED_ONLY` below instead.
 * @type {Array<{key: string, label: string, value: number, command: string}>}
 */
const COUNTERS = [
  {
    key: 'main.total',
    label: 'src/main modules (all depths)',
    value: mainAll.length,
    command: "git ls-files -z src/main | tr '\\0' '\\n' | grep -c '\\.js$'",
  },
  {
    key: 'main.topLevel',
    label: 'src/main modules (top level)',
    value: mainTop.length,
    command: "git ls-files -z src/main | tr '\\0' '\\n' | grep -c '^src/main/[^/]*\\.js$'",
  },
  {
    key: 'main.platform',
    label: 'src/main/platform modules',
    value: trackedTopLevel('src/main/platform', (f) => f.endsWith('.js')).length,
    command: "git ls-files -z src/main/platform | tr '\\0' '\\n' | grep -c '\\.js$'",
  },
  {
    key: 'main.tokenAdapters',
    label: 'src/main/token-adapters modules',
    value: trackedTopLevel('src/main/token-adapters', (f) => f.endsWith('.js')).length,
    command: "git ls-files -z src/main/token-adapters | tr '\\0' '\\n' | grep -c '\\.js$'",
  },
  {
    key: 'gate.mutants',
    label: 'verify:gate mutants',
    value: mutants,
    command:
      "sed -n '/const MUTANTS = \\[/,/^\\];/p' scripts/verify-witness-gate.mjs | grep -c \"^    id: '\"",
  },
  {
    key: 'ci.commands',
    label: 'CI verification commands (all jobs, `npm ci` excluded)',
    value: ci.commands,
    command: "grep -E '^ +(- )?run: ' .github/workflows/ci.yml | grep -vc 'npm ci$'",
  },
  {
    key: 'ci.contexts',
    label: 'CI jobs = required status contexts',
    value: ci.jobs,
    command:
      "node -e \"console.log(Object.keys(require('js-yaml').load(require('fs').readFileSync('.github/workflows/ci.yml','utf8')).jobs).length)\"",
  },
  {
    key: 'ipc.invoke',
    label: 'preload invoke channels',
    value: preload.invoke,
    command: "grep -c 'ipcRenderer\\.invoke(' src/main/preload.js",
  },
  {
    key: 'ipc.push',
    label: 'preload push channels',
    value: preload.push,
    command: "grep -c 'ipcRenderer\\.on(' src/main/preload.js",
  },
  {
    key: 'ipc.total',
    label: 'preload channels total',
    value: preload.invoke + preload.push,
    command: "grep -cE 'ipcRenderer\\.(invoke|on)\\(' src/main/preload.js",
  },
  {
    key: 'agents.total',
    label: 'agents in agent-database.json',
    value: database.agents,
    command: 'node -p "require(\'./src/shared/agent-database.json\').agents.length"',
  },
  {
    key: 'agents.signatures',
    label: 'process-name signatures in agent-database.json',
    value: database.signatures,
    command:
      'node -p "require(\'./src/shared/agent-database.json\').agents.reduce((n,a)=>n+a.names.length,0)"',
  },
  {
    key: 'rules.total',
    label: 'detection rules',
    value: ruleset.rules,
    command: "grep -c '^  - id:' rules/*.yaml | awk -F: '{s+=$2} END {print s}'",
  },
  {
    key: 'rules.files',
    label: 'rule YAML files (= categories)',
    value: ruleset.files,
    command: "git ls-files -z rules | tr '\\0' '\\n' | grep -c '\\.yaml$'",
  },
  {
    key: 'renderer.components',
    label: 'Svelte components under lib/components',
    value: trackedUnder('src/renderer/lib/components', (p) => p.endsWith('.svelte')).length,
    command: "git ls-files -z src/renderer/lib/components | tr '\\0' '\\n' | grep -c '\\.svelte$'",
  },
  {
    key: 'renderer.stores',
    label: 'renderer stores',
    value: trackedUnder('src/renderer/lib/stores').length,
    command: "git ls-files -z src/renderer/lib/stores | tr '\\0' '\\n' | grep -c .",
  },
  {
    key: 'renderer.utils',
    label: 'renderer utils',
    value: trackedUnder('src/renderer/lib/utils').length,
    command: "git ls-files -z src/renderer/lib/utils | tr '\\0' '\\n' | grep -c .",
  },
  {
    key: 'shared.types',
    label: '.ts files under src/shared/types',
    value: trackedUnder('src/shared/types', (p) => p.endsWith('.ts')).length,
    command: "git ls-files -z src/shared/types | tr '\\0' '\\n' | grep -c '\\.ts$'",
  },
  {
    key: 'size.over300',
    label: 'src files over 300 lines (.json excluded)',
    value: sizes.over300,
    command:
      "git ls-files -z src | grep -zv '\\.json$' | xargs -0 wc -l | awk '$1 > 300 && $2 != \"total\"' | wc -l",
  },
];

/**
 * DERIVED-ONLY counters: printed on every run, declared by nothing, checked against
 * nothing. They sit outside `COUNTERS`, so no scanner emits their keys and neither the
 * stale gate nor the undeclared gate can ever see them. That is the whole mechanism:
 * there is no skip flag on the declaration-matching path for anyone to forget to set.
 *
 * Write the guarantee, not the impression (ai-mistakes #27): moving a counter here
 * REMOVES a guarantee. Nothing catches prose that restates one of these numbers
 * wrongly, because prose is not meant to state them at all. The trade is deliberate.
 * Each pins the exact length of ONE live file, so any commit that added or removed a
 * single line in that file falsified every prose copy at once and turned a required
 * status context red on a change that had nothing to do with the docs. That is the
 * failure PR #241 made blocking, on files among the most frequently edited in the repo.
 * A figure nobody may restate cannot drift, and `npm run counts:check` stays the one
 * live answer.
 *
 * The bar is narrow and `size.over300` deliberately fails it: that one moves only when
 * a file crosses the 300-line threshold, so it stays in `COUNTERS` and stays checked.
 * @type {Array<{key: string, label: string, value: number, command: string}>}
 */
const DERIVED_ONLY = [
  {
    key: 'size.largestSrc',
    label: `largest src file (${sizes.largestSrc.file})`,
    value: sizes.largestSrc.lines,
    command: "git ls-files -z src | grep -zv '\\.json$' | xargs -0 wc -l | sort -rn | sed -n 2p",
  },
  {
    key: 'size.largestTest',
    label: `largest test file (${sizes.largestTest.file})`,
    value: sizes.largestTest.lines,
    command: 'git ls-files -z tests | xargs -0 wc -l | sort -rn | sed -n 2p',
  },
];

/**
 * Checked counters only. A `DERIVED_ONLY` key is absent from this map by construction,
 * which is what stops the stale gate from ever resolving one.
 * @type {Map<string, {key: string, label: string, value: number, command: string}>}
 */
const BY_KEY = new Map(COUNTERS.map((c) => [c.key, c]));

// ---------------------------------------------------------------------------
// Scanners: locator + parser, per ai-mistakes #24's "assume the figure you were
// sent to fix has siblings".
// ---------------------------------------------------------------------------

/** Spelled-out numbers, because prose declares counts in words. */
const WORDS = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};
const WORD_ALT = Object.keys(WORDS).join('|');
/**
 * A digit run or a spelled-out number. The `\b` on both sides matters: without it
 * `(\d+)\s+signatures` reads "Ed25519 signatures" as a declaration of 25519.
 */
const NUM = `\\b(\\d+|${WORD_ALT})\\b`;
/**
 * Digits only. Used for every counter whose value is too large to be spelled out (73
 * rules, 110 agents, 47 components, 1099 lines): there, a written-out number is always
 * a different noun — "Two rules are non-negotiable" in bench/README.md, "two agents on
 * one pid" in the audit. Counters that plausibly ARE spelled out (4 mutants, 5
 * contexts, 8 commands, 2 token-adapters) keep NUM.
 */
const DIGITS = '\\b(\\d+)\\b';

/**
 * @param {string|undefined} token
 * @returns {number|null}
 */
function toInt(token) {
  if (!token) return null;
  const lower = token.toLowerCase();
  if (lower in WORDS) return WORDS[/** @type {keyof typeof WORDS} */ (lower)];
  return /^\d+$/.test(token) ? Number(token) : null;
}

/**
 * Run a list of `[key, regex]` pairs over a line and collect every capture that
 * parses to an integer.
 * @param {string} line
 * @param {Array<[string, RegExp]>} rules
 * @returns {Array<{key: string, value: number}>}
 */
function pick(line, rules) {
  /** @type {Array<{key: string, value: number}>} */
  const found = [];
  for (const [key, re] of rules) {
    const m = line.match(re);
    const value = m ? toInt(m[1]) : null;
    if (value !== null) found.push({ key, value });
  }
  return found;
}

/**
 * Each scanner's `locate` is intentionally wider than its `parse`. When `locate`
 * fires and `parse` returns nothing, the site is reported as UNPARSEABLE and the run
 * goes red — a reworded declaration must never read as an absent one.
 * @type {Array<{id: string, locate: RegExp, parse: (line: string) =>
 *   Array<{key: string, value: number}>}>}
 */
const SCANNERS = [
  {
    id: 'main-modules',
    locate: new RegExp(
      `(?:CJS|CommonJS)\\s+modules|\\bmain\\s+modules\\b|\\btop-level\\s*\\+|` +
        `${NUM}\\s*\`?(?:platform|token-adapters)/|(?:platform|token-adapters)/\\s*\`?\\s*${NUM}`,
      'i',
    ),
    parse: (line) =>
      pick(line, [
        ['main.total', new RegExp(`${NUM}\\s+(?:CJS|CommonJS|main|working-tree)\\s+modules`, 'i')],
        ['main.total', new RegExp(`\\*\\*${NUM}\\*\\*\\s*=\\s*\\d+\\s+top-level`, 'i')],
        ['main.topLevel', new RegExp(`${NUM}\\s+top-level`, 'i')],
        ['main.platform', new RegExp(`${NUM}\\s*\`?platform/|platform/\\s*\`?\\s*${NUM}`, 'i')],
        [
          'main.tokenAdapters',
          new RegExp(`${NUM}\\s*\`?token-adapters/|token-adapters/\\s*\`?\\s*${NUM}`, 'i'),
        ],
      ]),
  },
  {
    id: 'verify-gate-mutants',
    // The second alternative is what catches ci.yml's "breaks the generation-witness
    // gate three ways": a spelled-out count of the same thing, with the word "mutant"
    // nowhere on the line.
    locate: new RegExp(`${NUM}\\s+mutants?\\b|\\bgate\\b[^.]{0,40}\\b\\w+\\s+ways\\b`, 'i'),
    parse: (line) =>
      pick(line, [
        ['gate.mutants', new RegExp(`${NUM}\\s+mutants?\\b`, 'i')],
        ['gate.mutants', new RegExp(`\\bgate\\b[^.]{0,40}${NUM}\\s+ways\\b`, 'i')],
      ]),
  },
  {
    id: 'ci-commands',
    // Deliberately NOT a bare `${NUM} commands`: CLAUDE.md reads "`lint` and
    // `svelte-check` run two commands each", which is a per-job figure, and a command
    // palette test says "returns 22 commands total". Both are other nouns.
    locate: new RegExp(
      `verification commands?\\b|same\\s+${NUM}\\s+commands\\b|` +
        `${NUM}\\s+local\\s+pre-merge\\s+commands\\b`,
      'i',
    ),
    parse: (line) =>
      pick(line, [
        ['ci.commands', new RegExp(`${NUM}\\s+verification commands?\\b`, 'i')],
        ['ci.commands', new RegExp(`same\\s+${NUM}\\s+commands\\b`, 'i')],
        ['ci.commands', new RegExp(`${NUM}\\s+local\\s+pre-merge\\s+commands\\b`, 'i')],
      ]),
  },
  {
    id: 'ci-contexts',
    locate: new RegExp(
      `${NUM}\\s+required\\s+status\\s+contexts?|${NUM}\\s+required\\s+contexts?|` +
        `inside those ${NUM} jobs`,
      'i',
    ),
    parse: (line) =>
      pick(line, [
        ['ci.contexts', new RegExp(`${NUM}\\s+required\\s+(?:status\\s+)?contexts?`, 'i')],
        ['ci.contexts', new RegExp(`inside those ${NUM} jobs`, 'i')],
      ]),
  },
  {
    id: 'ipc-channels',
    locate: new RegExp(`${DIGITS}\\s+invoke\\b|${DIGITS}\\s+(?:IPC\\s+)?channels\\b`, 'i'),
    parse: (line) =>
      pick(line, [
        ['ipc.invoke', new RegExp(`${DIGITS}\\s+invoke\\b`, 'i')],
        ['ipc.push', new RegExp(`${DIGITS}\\s+(?:push|events)\\b`, 'i')],
        ['ipc.total', new RegExp(`${DIGITS}\\s+(?:IPC\\s+)?channels\\b`, 'i')],
        ['ipc.total', new RegExp(`=\\s*\\*{0,2}${DIGITS}\\*{0,2}\\s*bridge endpoints`, 'i')],
      ]),
  },
  {
    id: 'agent-database',
    locate: new RegExp(
      `${DIGITS}\\s+(?:known\\s+)?agents\\b|` +
        `${DIGITS}\\s+(?:name\\s+|process-name\\s+)?signatures\\b`,
      'i',
    ),
    parse: (line) =>
      pick(line, [
        ['agents.total', new RegExp(`${DIGITS}\\s+(?:known\\s+)?agents\\b`, 'i')],
        [
          'agents.signatures',
          new RegExp(`${DIGITS}\\s+(?:name\\s+|process-name\\s+)?signatures\\b`, 'i'),
        ],
      ]),
  },
  {
    id: 'detection-rules',
    locate: new RegExp(`${DIGITS}\\s+(?:active\\s+)?(?:detection\\s+)?rules\\b`, 'i'),
    parse: (line) =>
      pick(line, [
        ['rules.total', new RegExp(`${DIGITS}\\s+(?:active\\s+)?(?:detection\\s+)?rules\\b`, 'i')],
        [
          'rules.files',
          new RegExp(`${DIGITS}\\s+(?:YAML|\`?\\.ya?ml\`?)\\s+(?:category\\s+)?files\\b`, 'i'),
        ],
        ['rules.files', new RegExp(`(?:across|in)\\s+${DIGITS}\\s+(?:YAML|categories)\\b`, 'i')],
        ['rules.files', new RegExp(`,\\s*${DIGITS}\\s+categories\\b`, 'i')],
      ]),
  },
  {
    id: 'renderer-inventory',
    // `(?<!Svelte )` keeps CLAUDE.md's "Svelte 5 components + stores + utils" — a list
    // of directories carrying no counts at all — from reading as "5 components".
    locate: new RegExp(
      `(?<!Svelte )${DIGITS}\\s+(?:Svelte\\s+)?components\\b|${DIGITS}\\s+stores\\b|` +
        `${DIGITS}\\s+utils\\b`,
      'i',
    ),
    parse: (line) =>
      pick(line, [
        [
          'renderer.components',
          new RegExp(`(?<!Svelte )${DIGITS}\\s+(?:Svelte\\s+)?components\\b`, 'i'),
        ],
        ['renderer.stores', new RegExp(`${DIGITS}\\s+stores\\b`, 'i')],
        ['renderer.utils', new RegExp(`${DIGITS}\\s+utils\\b`, 'i')],
      ]),
  },
  {
    id: 'shared-types',
    locate: new RegExp(
      `types/\\s*(?:—|-)?\\s*${NUM}\\s*\`?\\.ts|types/\\s*\\(\\s*${NUM}|` +
        `${NUM}\\s+(?:TS|type)\\s+files\\b`,
      'i',
    ),
    parse: (line) =>
      pick(line, [
        ['shared.types', new RegExp(`types/\\s*(?:—|-)?\\s*${NUM}\\s*\`?\\.ts`, 'i')],
        ['shared.types', new RegExp(`types/\\s*\\(\\s*${NUM}\\s*\`?\\.?ts`, 'i')],
        ['shared.types', new RegExp(`${NUM}\\s+(?:TS|type)\\s+files\\b`, 'i')],
      ]),
  },
  {
    id: 'file-size-budget',
    // Write the guarantee, not the impression (ai-mistakes #27): this scanner covers
    // `size.over300` and nothing else about file size. The exact length of the largest
    // src file and of the largest test file is DERIVED_ONLY: prose is not meant to
    // restate either, so there is deliberately no locator for them here and a line that
    // does state one is NOT checked. Run `npm run counts:check` for those two figures
    // rather than quoting them; having no declaration site is what stops them drifting.
    locate: new RegExp(`\\bexceeds?\\s+it\\b|${DIGITS}\\s+existing\\b`, 'i'),
    parse: (line) => pick(line, [['size.over300', new RegExp(`${DIGITS}\\s+existing\\b`, 'i')]]),
  },
];

// ---------------------------------------------------------------------------
// Exemptions. Both lists are ENUMERATED, never inferred from phrasing: a
// past-tense sentence can be a live claim (docs/current-state/CORRECTNESS-AUDIT.md
// says "At audit time these read ..." three lines under a table that IS current),
// so a "sounds historical" heuristic would silence the wrong sites. Both lists are
// printed on every run, and an entry that matches nothing is itself RED — an
// exemption for a line that no longer exists is a licence nobody is using.
// ---------------------------------------------------------------------------

/**
 * Whole files whose numbers are FINDINGS, not claims: each entry records the tree as
 * it stood at a named commit or date, so correcting the figure would falsify the
 * record. None of them can be cleaned by a docs sweep, which is the test: a red that
 * no permitted edit can clear would keep this check from ever going blocking.
 * @type {Array<{file: string, why: string}>}
 */
const ARCHIVAL = [
  { file: 'CHANGELOG.md', why: 'release history — every figure describes a shipped version' },
  {
    file: 'memory-bank/ai-mistakes.md',
    why: 'the lessons log quotes dead counts as evidence (#24 itself)',
  },
  {
    file: 'memory-bank/progress.md',
    why: 'dated work log; entries are superseded in place, not rewritten',
  },
  {
    file: 'memory-bank/honesty-audit.md',
    why: 'dated audit; its numbers are the findings being reported',
  },
  {
    file: 'memory-bank/ux-audit.md',
    why: 'dated audit of the command palette, not a repo inventory',
  },
  {
    file: 'memory-bank/fancy-ui-plan.md',
    why: 'a superseded UI plan; its table is the pre-work baseline',
  },
  {
    file: 'memory-bank/DEFERRED-utilityprocess-migration.md',
    why: 'deferred proposal, figures are approximations in an estimate',
  },
  {
    file: 'docs/current-state/STATE-RECON.md',
    why: 'recon transcript: shell sessions and literal diff hunks from a past tree',
  },
  {
    file: 'docs/current-state/NUMBERS-RECON.md',
    why: 'scoring worked examples — "7 agents, base 35" is a hypothetical, not an inventory',
  },
  {
    file: 'docs/current-state/IDENTITY-RECON.md',
    why: 'dated call-site census of the identity migration',
  },
  {
    file: 'docs/GITHUB-AUDIT.md',
    why: 'dated repo audit; the table records what each file said then',
  },
  { file: 'docs/REPO-AUDIT.md', why: 'dated repo audit; rows are resolved findings' },
];
const ARCHIVAL_FILES = new Set(ARCHIVAL.map((a) => a.file));

/**
 * Single lines inside otherwise-live files. `contains` must still appear on the line
 * for the exemption to apply, so a rewrite of that sentence loses its exemption and
 * goes red again.
 * @type {Array<{file: string, contains: string, why: string}>}
 */
const SITE_EXEMPTIONS = [
  {
    file: 'ROADMAP.md',
    contains: 'hardcoded `rgba(255,255,255)` in 15 Svelte components',
    why: 'the size of a defect (15 affected components), not the component inventory',
  },
  {
    file: 'ROADMAP.md',
    contains: '(31 components unlinted)',
    why: 'the size of a lint gap, not the component inventory',
  },
  {
    file: 'README.md',
    contains: '| YAML rulesets, 68 rules, hot-reload, 568 tests |',
    why: 'a release-history table row: it describes v0.7.0-alpha, not the tree',
  },
  {
    file: 'docs/current-state/CORRECTNESS-AUDIT.md',
    contains: 'At audit time these read',
    why: 'the sentence that explicitly reports the SUPERSEDED figures under a current table',
  },
];

/**
 * This file names every locator phrase it searches for, so scanning it would report
 * the regexes as declarations. Excluded by path, deliberately, rather than by wording
 * the phrases so they do not match themselves — an obfuscated locator is a locator
 * nobody can audit.
 */
const SELF_EXCLUSION = { file: SELF, why: 'the scanner would locate its own locator phrases' };

/**
 * Extensions the declaration scan reads. A repository fact is DECLARED in prose —
 * documentation, workflow comments, the landing-page markup — while `.js`/`.ts`/
 * `.svelte`/`.json` are the DERIVATION INPUT: "~12 agents would saturate CPU"
 * (file-watcher.js) and "two distinct pid-0 agents" (a test name) are statements
 * about one code path, not claims about the repository.
 *
 * State the guarantee, not the impression (ai-mistakes #27): the consequence is that
 * a stale count inside a source comment is NOT covered by this gate. The scanned file
 * count is printed on every run so the scope is visible rather than assumed, which is
 * the half of ai-mistakes #28 that actually bites — an unstated narrowing reading as
 * a whole-tree sweep.
 */
const SCANNED_EXTENSIONS = ['.md', '.markdown', '.txt', '.html', '.yml', '.yaml'];

/**
 * Whether a line carries any number at all. A locator may be wider than its parser on
 * purpose, but it must not fire on a line that declares nothing: the electron-main
 * skill's own description reads "CJS modules, platform abstraction, IPC, file
 * watchers" and asserts no count. Without this gate every such mention would be
 * reported as an unparseable declaration and the red would be noise.
 * @param {string} line
 * @returns {boolean}
 */
function hasNumber(line) {
  return new RegExp(`\\b(?:\\d+|${WORD_ALT})\\b`, 'i').test(line);
}

// ---------------------------------------------------------------------------
// Scan.
// ---------------------------------------------------------------------------

/** @type {Array<{file: string, line: number, key: string, declared: number, text: string}>} */
const declarations = [];
/** @type {Array<{file: string, line: number, scanner: string, text: string}>} */
const unparseable = [];
/** Exemption entries that fired, keyed by list index, so unused ones can be reported. */
const usedSiteExemptions = new Set();
const usedArchival = new Set();

let scannedFiles = 0;

for (const file of TRACKED) {
  if (file === SELF_EXCLUSION.file) continue;
  if (!SCANNED_EXTENSIONS.some((ext) => file.toLowerCase().endsWith(ext))) continue;
  if (ARCHIVAL_FILES.has(file)) {
    usedArchival.add(file);
    continue;
  }
  let text;
  try {
    text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  } catch {
    continue; // unreadable as UTF-8 → binary asset, nothing to declare
  }
  if (text.includes('\0')) continue;
  scannedFiles += 1;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const exemption = SITE_EXEMPTIONS.findIndex(
      (e) => e.file === file && line.includes(e.contains),
    );
    if (exemption !== -1) {
      usedSiteExemptions.add(exemption);
      continue;
    }
    if (!hasNumber(line)) continue;
    for (const scanner of SCANNERS) {
      if (!scanner.locate.test(line)) continue;
      const parsed = scanner.parse(line);
      if (parsed.length === 0) {
        unparseable.push({ file, line: i + 1, scanner: scanner.id, text: line.trim() });
        continue;
      }
      for (const { key, value } of parsed) {
        declarations.push({ file, line: i + 1, key, declared: value, text: line.trim() });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Compare and report.
// ---------------------------------------------------------------------------

const mismatches = declarations.filter((d) => BY_KEY.get(d.key).value !== d.declared);
const undeclared = COUNTERS.filter((c) => !declarations.some((d) => d.key === c.key));
const staleSiteExemptions = SITE_EXEMPTIONS.filter((_, i) => !usedSiteExemptions.has(i));
const staleArchival = ARCHIVAL.filter((a) => !usedArchival.has(a.file));

/** @param {string} s */
function head(s) {
  console.log(`\n${s}\n${'─'.repeat(s.length)}`);
}

head('Derived from the tree');
for (const c of COUNTERS) {
  const sites = declarations.filter((d) => d.key === c.key).length;
  console.log(`  ${c.key.padEnd(20)} = ${String(c.value).padStart(5)}   ${c.label}`);
  console.log(`  ${' '.repeat(20)}     ${c.command}`);
  console.log(`  ${' '.repeat(20)}     declared at ${sites} site${sites === 1 ? '' : 's'}`);
}

head('Derived only — no declaration sites by design');
console.log('  Printed on every run, checked against nothing. Each pins the exact length');
console.log('  of one live file, so a one-line edit anywhere in it falsifies a prose copy.');
console.log('  They sit outside COUNTERS: no scanner emits their keys, so neither the stale');
console.log('  gate nor the undeclared gate applies. Quote this output, never the number.');
for (const c of DERIVED_ONLY) {
  console.log(`  ${c.key.padEnd(20)} = ${String(c.value).padStart(5)}   ${c.label}`);
  console.log(`  ${' '.repeat(20)}     ${c.command}`);
  console.log(`  ${' '.repeat(20)}     derived-only — no declaration sites by design`);
}

console.log(
  `\nDeclaration scan: ${scannedFiles} of ${TRACKED.length} tracked files, read from the index
` +
    `  (git ls-files -z, never a working-tree walk — ai-mistakes #28). Scope: ${SCANNED_EXTENSIONS.join(' ')};
` +
    `  source files are the derivation input, not declaration sites.`,
);
console.log(
  `  ${ARCHIVAL.length} file(s) exempted as archival, ${SITE_EXEMPTIONS.length} single line(s) exempted, ` +
    `1 excluded as the scanner itself.`,
);
for (const a of ARCHIVAL) console.log(`    archival  ${a.file} — ${a.why}`);
for (const e of SITE_EXEMPTIONS) console.log(`    line      ${e.file} "${e.contains}" — ${e.why}`);
console.log(`    self      ${SELF_EXCLUSION.file} — ${SELF_EXCLUSION.why}`);

let failed = false;

if (mismatches.length > 0) {
  failed = true;
  head(`Stale declarations (${mismatches.length})`);
  for (const m of mismatches) {
    const c = BY_KEY.get(m.key);
    console.log(`  ${m.file}:${m.line}`);
    console.log(`    ${m.key} declared ${m.declared}, derived ${c.value}  (${c.label})`);
    console.log(`    ${c.command}`);
    console.log(`    > ${m.text.slice(0, 160)}`);
  }
}

if (unparseable.length > 0) {
  failed = true;
  head(`Unparseable declaration sites (${unparseable.length})`);
  console.log(
    '  A locator matched but no number could be read off the line. That is RED, not a\n' +
      '  skip: a reworded declaration must not read as an absent one (ai-mistakes #28).\n' +
      '  Fix the line, teach the parser its shape, or exempt it with a reason.',
  );
  for (const u of unparseable) {
    console.log(`  ${u.file}:${u.line}  [${u.scanner}]`);
    console.log(`    > ${u.text.slice(0, 160)}`);
  }
}

if (undeclared.length > 0) {
  failed = true;
  head(`Counters no tracked file declares (${undeclared.length})`);
  console.log(
    '  Either the declaration was deleted or the scanner has gone blind to it. Both\n' +
      '  mean this counter is no longer being checked — drop it or fix the scanner.',
  );
  for (const c of undeclared) console.log(`  ${c.key} — ${c.label}`);
}

if (staleArchival.length > 0 || staleSiteExemptions.length > 0) {
  failed = true;
  head(`Exemptions that matched nothing (${staleArchival.length + staleSiteExemptions.length})`);
  console.log('  An exemption for a line that no longer exists is a licence nobody is using.');
  for (const a of staleArchival) console.log(`  archival ${a.file} — no such tracked file`);
  for (const e of staleSiteExemptions) {
    console.log(`  line ${e.file} "${e.contains}" — no line contains this any more`);
  }
}

if (failed) {
  console.error(
    `\ncounts:check FAILED — ${mismatches.length} stale, ${unparseable.length} unparseable, ` +
      `${undeclared.length} undeclared, ` +
      `${staleArchival.length + staleSiteExemptions.length} dead exemption(s).`,
  );
  process.exit(1);
}

console.log(
  `\ncounts:check OK — ${COUNTERS.length} checked counters derived from the tree, ` +
    `${declarations.length} declaration sites agree; ` +
    `${DERIVED_ONLY.length} derived-only counters printed and declared nowhere by ` +
    `design (${COUNTERS.length + DERIVED_ONLY.length} counters derived in total).`,
);
