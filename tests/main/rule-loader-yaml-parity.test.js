import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
// js-yaml 5 dropped the default export — the ESM entry only has named exports.
import { load as loadYaml } from 'js-yaml';
import ruleLoader from '../../src/main/rule-loader.js';

const PROD_RULES_DIR = path.resolve(__dirname, '../../rules');

/**
 * Frozen snapshot of the production rule set, captured from `rules/*.yaml`
 * while js-yaml 4.3.0 was installed — i.e. before the 5.x upgrade.
 *
 * These numbers and IDs are the contract the YAML parser has to keep honouring.
 * A js-yaml major that changed scalar resolution, dropped a document, or
 * reordered a sequence would move at least one of them.
 */
const BASELINE = {
  'ai-config.yaml': [
    'AI001',
    'AI002',
    'AI003',
    'AI004',
    'AI005',
    'AI006',
    'AI007',
    'AI008',
    'AI009',
    'AI010',
    'AI011',
    'AI012',
    'AI013',
    'AI014',
    'AI015',
    'AI016',
    'AI017',
    'AI018',
    'AI019',
    'AI020',
    'AI021',
    'AI022',
    'AI023',
    'AI024',
    'AI025',
    'AI026',
    'AI027',
    'AI028',
    'AI029',
    'AI030',
    'AI031',
    'AI032',
    'AI033',
    'AI034',
    'AI035',
    'AI036',
    'AI037',
    'AI038',
  ],
  'browser.yaml': ['BR001', 'BR002', 'BR003', 'BR004', 'BR005', 'BR006', 'BR007', 'BR008', 'BR009'],
  'certificates.yaml': ['CE001', 'CE002', 'CE003', 'CE004'],
  'cloud.yaml': ['CL001', 'CL002', 'CL003'],
  'crypto.yaml': ['CR001'],
  'devtools.yaml': ['DV001', 'DV002', 'DV003', 'DV004'],
  'secrets.yaml': ['SC001', 'SC002', 'SC003', 'SC004', 'SC005', 'SC006', 'SC007', 'SC008'],
  'ssh.yaml': ['SS001', 'SS002', 'SS003', 'SS004', 'SS005', 'SS006'],
};

const BASELINE_FILES = Object.keys(BASELINE).sort();
const BASELINE_IDS = BASELINE_FILES.flatMap((f) => BASELINE[f]);

/**
 * Reads and parses one ruleset straight through js-yaml, with no ajv pass.
 * `initValidator` runs Ajv with `useDefaults: true`, which mutates the parsed
 * document in place — so anything that wants to see what the parser actually
 * produced has to look before the loader does.
 * @param {string} file - Ruleset file name inside rules/
 * @returns {{ rules: Array<{ id: string; pattern: string; reason: string; category: string }> }}
 */
function parseRaw(file) {
  const content = fs.readFileSync(path.join(PROD_RULES_DIR, file), 'utf8');
  return /** @type {*} */ (loadYaml(content));
}

describe('rule-loader — YAML parser parity', () => {
  it('rules/ holds exactly the 8 ruleset files of the baseline', () => {
    const files = fs
      .readdirSync(PROD_RULES_DIR)
      .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
      .sort();
    expect(files).toEqual(BASELINE_FILES);
  });

  describe('per-file rule count', () => {
    for (const file of BASELINE_FILES) {
      it(`${file} parses to ${BASELINE[file].length} rules`, () => {
        expect(parseRaw(file).rules).toHaveLength(BASELINE[file].length);
      });
    }
  });

  describe('per-file rule IDs, in document order', () => {
    for (const file of BASELINE_FILES) {
      it(`${file} yields the baseline IDs`, () => {
        expect(parseRaw(file).rules.map((r) => r.id)).toEqual(BASELINE[file]);
      });
    }
  });

  it('the loader merges all 8 files into 73 rules', () => {
    const rules = ruleLoader.reloadRules(PROD_RULES_DIR);
    expect(rules.size).toBe(BASELINE_IDS.length);
    expect(rules.size).toBe(73);
  });

  it('the merged rule set carries exactly the baseline IDs', () => {
    const rules = ruleLoader.reloadRules(PROD_RULES_DIR);
    expect([...rules.keys()].sort()).toEqual([...BASELINE_IDS].sort());
  });

  it('every pattern reaches RegExp byte-for-byte as written in YAML', () => {
    const rules = ruleLoader.reloadRules(PROD_RULES_DIR);
    for (const file of BASELINE_FILES) {
      for (const rawRule of parseRaw(file).rules) {
        const loaded = rules.get(rawRule.id);
        expect(loaded, `${rawRule.id} missing from the merged set (${file})`).toBeDefined();
        // Guards against a parser that re-resolves, unescapes or trims scalars:
        // the regex source has to equal the string the YAML file spells out.
        expect(loaded.pattern.source, `${rawRule.id} pattern mangled (${file})`).toBe(
          rawRule.pattern,
        );
        expect(loaded.pattern.flags).toBe('i');
      }
    }
  });

  it('every reason and category survives parsing unchanged', () => {
    const rules = ruleLoader.reloadRules(PROD_RULES_DIR);
    for (const file of BASELINE_FILES) {
      for (const rawRule of parseRaw(file).rules) {
        const loaded = rules.get(rawRule.id);
        expect(loaded.reason, `${rawRule.id} reason mangled (${file})`).toBe(rawRule.reason);
        expect(loaded.category, `${rawRule.id} category mangled (${file})`).toBe(rawRule.category);
      }
    }
  });

  it('every rule parses its scalars to the expected primitive types', () => {
    const rules = ruleLoader.reloadRules(PROD_RULES_DIR);
    for (const rule of rules.values()) {
      // `enabled: true` must stay a boolean, not become the string "true"
      expect(typeof rule.enabled, `${rule.id} enabled is not boolean`).toBe('boolean');
      expect(typeof rule.risk, `${rule.id} risk is not string`).toBe('string');
      expect(Array.isArray(rule.tags), `${rule.id} tags is not an array`).toBe(true);
    }
  });

  it('each ruleset document header parses with the expected scalar types', () => {
    for (const file of BASELINE_FILES) {
      const doc = /** @type {*} */ (parseRaw(file));
      expect(doc.version, `${file} version is not the number 1`).toBe(1);
      expect(typeof doc.category, `${file} category is not a string`).toBe('string');
    }
  });
});
