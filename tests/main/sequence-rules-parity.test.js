/**
 * sequence-rules — parity of the PRODUCTION rule file with the loader that reads it.
 *
 * The counterpart of `rule-loader-yaml-parity.test.js` for `rules/sequences/`: a frozen
 * baseline of what the directory holds and what the loader must make of it, so a js-yaml
 * change that re-resolved a scalar, a rule edit that tripped a refusal, or a second file
 * landing in the directory all move at least one assertion. `loadDir` reads the REAL
 * `rules/sequences/`, never a fixture copy — a parity test over a copy proves parity with
 * the copy (ai-mistakes #21).
 *
 * The loader's only channel for its notices is `logger.warn`, so `logger` is pulled in
 * through `createRequire` — the same native module instance `require('./logger')` resolves
 * inside the loader; an ESM `import` of the same path yields a DIFFERENT object and a spy on
 * it never fires. The module under test stays on a plain ESM import so coverage instruments it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
// js-yaml 5 dropped the default export — the ESM entry only has named exports.
import { loadAll as loadYamlAll } from 'js-yaml';
import loader from '../../src/main/sequence-rule-loader.js';
import { normalizeToEcs } from '../../src/shared/ecs-normalizer.js';

const require_ = createRequire(import.meta.url);
const logger = require_('../../src/main/logger.js');

const ROOT = path.resolve(__dirname, '../..');
const PROD_SEQUENCES_DIR = path.join(ROOT, 'rules', 'sequences');

/**
 * Frozen snapshot of the production sequence ruleset, captured from
 * `rules/sequences/sequences.yaml` as it first landed. A new file in the directory, a new
 * document in the file, or a rule the loader reads differently moves one of these.
 */
const BASELINE = {
  /** Every tracked file under rules/sequences, repo-relative, as `git ls-files` prints it. */
  trackedFiles: ['rules/sequences/sequences.yaml'],
  /** The one file's documents in order — base documents by `name`, correlations by `id`. */
  documents: ['cred_file_read', 'outbound_conn', 'SEQ001'],
  /** Every `|re` / `|re|i` pair in the file, as `[document name, selection key]`. */
  regexPairs: [['cred_file_read', 'file.path|re|i']],
  rules: [
    {
      id: 'SEQ001',
      title: 'Credential file read followed by outbound connection',
      level: 'high',
      timespanMs: 300_000,
      steps: [
        { name: 'cred_file_read', category: 'file' },
        { name: 'outbound_conn', category: 'network' },
      ],
    },
  ],
  /** The one notice the file is expected to raise: both steps sit on nullable-entity carriers. */
  warnings: [{ rule: 'SEQ001', step: null, reason: 'nullable-entity-id-steps' }],
};

/** @type {import('vitest').MockInstance} */
let warnSpy;

beforeEach(() => {
  warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  // The createRequire instance is shared by every suite in this worker; an unrestored spy
  // would leak into whichever file runs next (ai-mistakes #26).
  vi.restoreAllMocks();
});

/**
 * Parses one production file straight through js-yaml, with no loader pass, so the
 * assertions see what the parser produced rather than what the loader compiled from it.
 * @param {string} file - file name inside rules/sequences/
 * @returns {Array<Record<string, *>>}
 */
function parseRaw(file) {
  const content = fs.readFileSync(path.join(PROD_SEQUENCES_DIR, file), 'utf8');
  return /** @type {Array<Record<string, *>>} */ (loadYamlAll(content));
}

/** @param {Record<string, *>} doc @returns {string} the reference key a document carries. */
const keyOf = (doc) => (doc.correlation === undefined ? doc.name : doc.id);

describe('sequence rules — production file parity', () => {
  it('rules/sequences holds exactly the 1 tracked file of the baseline', () => {
    // The INDEX, not a directory walk: counts.js derives `sequences.files` the same way, and
    // a file that is on disk but untracked never reaches CI (ai-mistakes #28).
    const tracked = execFileSync('git', ['ls-files', '-z', 'rules/sequences'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .split('\0')
      .filter(Boolean)
      .sort();
    expect(tracked).toEqual(BASELINE.trackedFiles);
    // And the directory itself carries nothing else — no stray `.yml`, no notes, no backup.
    expect(fs.readdirSync(PROD_SEQUENCES_DIR).sort()).toEqual(
      BASELINE.trackedFiles.map((p) => path.basename(p)),
    );
  });

  it("the loader's default directory IS the production directory", () => {
    expect(path.resolve(loader.DEFAULT_SEQUENCES_DIR)).toBe(PROD_SEQUENCES_DIR);
  });

  it('sequences.yaml parses to exactly the baseline documents, in document order', () => {
    const docs = parseRaw('sequences.yaml');
    expect(docs.map(keyOf)).toEqual(BASELINE.documents);
    // Exactly one correlation document; the other two are the base documents it orders.
    expect(docs.filter((d) => d.correlation !== undefined).map((d) => d.id)).toEqual(
      BASELINE.rules.map((r) => r.id),
    );
  });

  it('loadDir on the real directory: 0 load errors, the one expected warning, exactly SEQ001', () => {
    const out = loader.loadDir(PROD_SEQUENCES_DIR);

    expect(out.loadErrors).toBe(0);
    expect(out.warnings).toHaveLength(BASELINE.warnings.length);
    expect(out.warnings.map(({ rule, step, reason }) => ({ rule, step, reason }))).toEqual(
      BASELINE.warnings,
    );
    expect(out.warnings[0].message.startsWith('sequences.yaml: ')).toBe(true);

    expect(out.rules).toHaveLength(BASELINE.rules.length);
    const [rule] = out.rules;
    expect(rule.id).toBe('SEQ001');
    expect(rule.title).toBe(BASELINE.rules[0].title);
    expect(rule.level).toBe('high');
    expect(rule.timespanMs).toBe(300_000);
    expect(rule.steps).toHaveLength(2);
    expect(rule.steps.map(({ name, category }) => ({ name, category }))).toEqual(
      BASELINE.rules[0].steps,
    );
    for (const step of rule.steps) expect(typeof step.matcher).toBe('function');

    // The logger saw exactly the warning line and no rejection line: the return value
    // carries the counts, the log carries the causes, and the two must agree.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toBe('sequence-loader');
    expect(warnSpy.mock.calls[0][2]).toEqual({
      rule: 'SEQ001',
      step: null,
      reason: 'nullable-entity-id-steps',
    });
  });

  it('loadDir with no argument reads the same production file', () => {
    const out = loader.loadDir();
    expect(out.loadErrors).toBe(0);
    expect(out.rules.map((r) => r.id)).toEqual(BASELINE.rules.map((r) => r.id));
  });

  it('every re pattern reaches RegExp byte-for-byte as written in YAML, flags pinned', () => {
    /** @type {Array<[string, string]>} */
    const seen = [];
    for (const doc of parseRaw('sequences.yaml')) {
      if (doc.correlation !== undefined) continue;
      for (const [key, value] of Object.entries(doc.detection.selection)) {
        const modifier = key.slice(key.indexOf('|') + 1);
        if (!key.includes('|') || (modifier !== 're' && modifier !== 're|i')) continue;
        seen.push([doc.name, key]);
        expect(typeof value, `${doc.name} ${key} is not a single string`).toBe('string');
        // The loader builds `new RegExp(String(value), flags)` and nothing else: the source
        // has to equal the string the YAML file spells out, or the parser re-resolved,
        // unescaped or trimmed it on the way in.
        const flags = modifier === 're|i' ? 'i' : '';
        const re = new RegExp(value, flags);
        expect(re.source, `${doc.name} ${key} mangled`).toBe(value);
        expect(re.flags, `${doc.name} ${key} flags`).toBe(flags);
      }
    }
    // Pinned as the whole list, so the loop above is never vacuous (ai-mistakes #21).
    expect(seen).toEqual(BASELINE.regexPairs);
  });

  it('the compiled steps decide on the ECS documents the normalizer emits', () => {
    const [fileStep, networkStep] = loader.loadDir(PROD_SEQUENCES_DIR).rules[0].steps;
    const file = (/** @type {string} */ p, action = 'accessed') =>
      normalizeToEcs({
        file: p,
        action,
        timestamp: 1_700_000_000_000,
        instanceId: '4242:1700000000000',
        pid: 4242,
        agent: 'Claude Code',
        attribution: { status: 'confirmed', evidence: ['os-file-handle'] },
      });
    const net = (/** @type {number} */ port) =>
      normalizeToEcs({
        remoteIp: '203.0.113.7',
        remotePort: port,
        domain: 'api.anthropic.com',
        instanceId: '4242:1700000000000',
        pid: 4242,
        agent: 'Claude Code',
      });

    expect(fileStep.matcher(file('C:\\Users\\me\\.aws\\credentials'))).toBe(true);
    expect(fileStep.matcher(file('/home/me/passwords.txt'))).toBe(true);
    // `re|i` reached the RegExp: the same basename in capitals still matches.
    expect(fileStep.matcher(file('C:\\Users\\me\\PASSWORDS.TXT'))).toBe(true);
    // A digit adjacent to the keyword — the case `[._\d-]` exists for (ai-mistakes #30).
    expect(fileStep.matcher(file('C:\\Users\\me\\1password_backup.csv'))).toBe(true);
    // The keyword in a DIRECTORY name is not a credential file.
    expect(fileStep.matcher(file('C:\\Users\\me\\password-manager\\README.md'))).toBe(false);
    expect(fileStep.matcher(file('C:\\Users\\me\\notes.md'))).toBe(false);
    // The action list is doing work too: a creation is not a read.
    expect(fileStep.matcher(file('C:\\Users\\me\\.aws\\credentials', 'created'))).toBe(false);
    expect(fileStep.matcher(file('C:\\Users\\me\\.aws\\credentials', 'holding'))).toBe(true);

    expect(networkStep.matcher(net(443))).toBe(true);
    expect(networkStep.matcher(net(80))).toBe(true);
    expect(networkStep.matcher(net(8080))).toBe(false);
    // Neither step accepts the other's carrier.
    expect(networkStep.matcher(file('C:\\Users\\me\\.aws\\credentials'))).toBe(false);
    expect(fileStep.matcher(net(443))).toBe(false);
  });
});
