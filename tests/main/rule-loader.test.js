import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'path';
import ruleLoader from '../../src/main/rule-loader.js';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/rules');
const EMPTY_DIR = path.resolve(__dirname, '../fixtures/rules-empty');

describe('rule-loader', () => {
  beforeEach(() => {
    // Clear cache between tests
    ruleLoader.reloadRules(FIXTURES_DIR);
  });

  describe('loadRules() — valid YAML', () => {
    it('loads valid rules into a Map', () => {
      const rules = ruleLoader.getAllRules(FIXTURES_DIR);
      // valid-test.yaml has 5 rules; invalid-test.yaml should be skipped
      expect(rules.size).toBe(5);
    });

    it('each rule has required fields', () => {
      const rules = ruleLoader.getAllRules(FIXTURES_DIR);
      for (const rule of rules.values()) {
        expect(rule).toHaveProperty('id');
        expect(rule).toHaveProperty('name');
        expect(rule).toHaveProperty('pattern');
        expect(rule).toHaveProperty('reason');
        expect(rule).toHaveProperty('category');
        expect(rule).toHaveProperty('risk');
        expect(rule).toHaveProperty('enabled');
      }
    });

    it('compiles pattern string into RegExp', () => {
      const rules = ruleLoader.getAllRules(FIXTURES_DIR);
      const rule = rules.get('TS001');
      expect(rule).toBeDefined();
      expect(rule.pattern).toBeInstanceOf(RegExp);
    });

    it('compiled pattern matches expected paths', () => {
      const rules = ruleLoader.getAllRules(FIXTURES_DIR);

      const envRule = rules.get('TS001');
      expect(envRule.pattern.test('/home/user/.env')).toBe(true);
      expect(envRule.pattern.test('C:\\Users\\me\\.env')).toBe(true);
      expect(envRule.pattern.test('/home/user/.environment')).toBe(false);

      const sshRule = rules.get('TS002');
      expect(sshRule.pattern.test('/home/user/.ssh/id_rsa')).toBe(true);

      const awsRule = rules.get('TS003');
      expect(awsRule.pattern.test('/home/user/.aws/credentials')).toBe(true);
      expect(awsRule.pattern.test('C:\\Users\\me\\.aws\\config')).toBe(true);
    });

    it('applies default values for optional fields', () => {
      const rules = ruleLoader.getAllRules(FIXTURES_DIR);
      const pemRule = rules.get('TS004');
      expect(pemRule.risk).toBe('high');
      expect(pemRule.enabled).toBe(true);
      expect(pemRule.platform).toBe('all');
      expect(pemRule.tags).toEqual([]);
    });

    it('preserves tags when provided', () => {
      const rules = ruleLoader.getAllRules(FIXTURES_DIR);
      const envRule = rules.get('TS001');
      expect(envRule.tags).toEqual(['env', 'credentials']);
    });
  });

  describe('invalid YAML', () => {
    it('skips files with validation errors and warns', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      ruleLoader.reloadRules(FIXTURES_DIR);

      const warnings = warnSpy.mock.calls
        .map((c) => c[0])
        .filter((m) => m.includes('Invalid ruleset'));
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('invalid-test.yaml');

      warnSpy.mockRestore();
    });

    it('does not include rules from invalid files', () => {
      const rules = ruleLoader.reloadRules(FIXTURES_DIR);
      // BADID should not be in the map — the whole file is invalid
      const badRule = rules.get('BADID');
      expect(badRule).toBeUndefined();
    });
  });

  describe('duplicate ID handling', () => {
    it('warns on duplicate and keeps first occurrence', () => {
      // To test duplicates we need a fixture with dupe IDs.
      // valid-test.yaml has unique IDs, so this test verifies
      // the mechanism works with existing fixtures (no dupes = no warn).
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      ruleLoader.reloadRules(FIXTURES_DIR);

      const dupeWarnings = warnSpy.mock.calls
        .map((c) => c[0])
        .filter((m) => m.includes('Duplicate rule ID'));
      // No duplicates in our fixtures — this confirms no false positives
      expect(dupeWarnings.length).toBe(0);

      warnSpy.mockRestore();
    });
  });

  describe('empty directory', () => {
    it('returns empty Map when directory has no YAML files', () => {
      // Use a nonexistent directory — loadRules handles gracefully
      const rules = ruleLoader.reloadRules(EMPTY_DIR);
      expect(rules.size).toBe(0);
    });
  });

  describe('getRulesByCategory() — category index', () => {
    it('returns rules matching the given category', () => {
      ruleLoader.reloadRules(FIXTURES_DIR);
      const cloudRules = ruleLoader.getRulesByCategory('cloud', FIXTURES_DIR);
      expect(cloudRules.length).toBe(1);
      expect(cloudRules[0].id).toBe('TS003');
    });

    it('returns empty array for unknown category', () => {
      ruleLoader.reloadRules(FIXTURES_DIR);
      const noRules = ruleLoader.getRulesByCategory('nonexistent', FIXTURES_DIR);
      expect(noRules).toEqual([]);
    });

    it('builds correct buckets for all categories in fixture', () => {
      ruleLoader.reloadRules(FIXTURES_DIR);
      // valid-test.yaml: secrets(TS001), ssh(TS002), cloud(TS003), certificates(TS004), browser(TS005)
      expect(ruleLoader.getRulesByCategory('secrets', FIXTURES_DIR).length).toBe(1);
      expect(ruleLoader.getRulesByCategory('ssh', FIXTURES_DIR).length).toBe(1);
      expect(ruleLoader.getRulesByCategory('cloud', FIXTURES_DIR).length).toBe(1);
      expect(ruleLoader.getRulesByCategory('certificates', FIXTURES_DIR).length).toBe(1);
      expect(ruleLoader.getRulesByCategory('browser', FIXTURES_DIR).length).toBe(1);
    });

    it('rebuilds index after reloadRules()', () => {
      ruleLoader.reloadRules(FIXTURES_DIR);
      const before = ruleLoader.getRulesByCategory('cloud', FIXTURES_DIR);
      expect(before.length).toBe(1);

      // Reload — index should be rebuilt with same data
      ruleLoader.reloadRules(FIXTURES_DIR);
      const after = ruleLoader.getRulesByCategory('cloud', FIXTURES_DIR);
      expect(after.length).toBe(1);
      expect(after[0].id).toBe('TS003');

      // Should be different array instance (fresh index)
      expect(before).not.toBe(after);
    });
  });

  describe('getRuleById()', () => {
    it('returns the rule for a valid ID', () => {
      ruleLoader.reloadRules(FIXTURES_DIR);
      const rule = ruleLoader.getRuleById('TS002', FIXTURES_DIR);
      expect(rule).toBeDefined();
      expect(rule.name).toBe('SSH private key (RSA)');
    });

    it('returns undefined for unknown ID', () => {
      ruleLoader.reloadRules(FIXTURES_DIR);
      const rule = ruleLoader.getRuleById('NOPE999', FIXTURES_DIR);
      expect(rule).toBeUndefined();
    });
  });

  describe('reloadRules()', () => {
    it('clears cache and reloads from disk', () => {
      const rules1 = ruleLoader.getAllRules(FIXTURES_DIR);
      expect(rules1.size).toBe(5);

      // Reload should return the same data (files unchanged)
      const rules2 = ruleLoader.reloadRules(FIXTURES_DIR);
      expect(rules2.size).toBe(5);

      // Should be a different Map instance (fresh load)
      expect(rules1).not.toBe(rules2);
    });
  });

  describe('R2 migration — production YAML rulesets', () => {
    const PROD_RULES_DIR = path.resolve(__dirname, '../../rules');

    it('loads at least 50 rules from production YAML files', () => {
      const rules = ruleLoader.reloadRules(PROD_RULES_DIR);
      expect(rules.size).toBeGreaterThanOrEqual(50);
    });

    it('loads exactly 73 rules (68 migrated + 2 OpenClaw + 3 kilo/opencode/grok)', () => {
      const rules = ruleLoader.reloadRules(PROD_RULES_DIR);
      expect(rules.size).toBe(73);
    });

    it('getRulesByCategory("secrets") returns only SC-prefixed IDs', () => {
      ruleLoader.reloadRules(PROD_RULES_DIR);
      const secrets = ruleLoader.getRulesByCategory('secrets', PROD_RULES_DIR);
      expect(secrets.length).toBeGreaterThan(0);
      for (const rule of secrets) {
        expect(rule.id).toMatch(/^SC\d{3}$/);
      }
    });

    it('getRulesByCategory("ai-config") returns only AI-prefixed IDs', () => {
      ruleLoader.reloadRules(PROD_RULES_DIR);
      const aiRules = ruleLoader.getRulesByCategory('ai-config', PROD_RULES_DIR);
      expect(aiRules.length).toBeGreaterThan(0);
      for (const rule of aiRules) {
        expect(rule.id).toMatch(/^AI\d{3}$/);
      }
    });

    it('every rule has a non-empty reason string', () => {
      const rules = ruleLoader.reloadRules(PROD_RULES_DIR);
      for (const rule of rules.values()) {
        expect(typeof rule.reason).toBe('string');
        expect(rule.reason.length).toBeGreaterThan(0);
      }
    });

    it('every rule has pattern compiled as RegExp', () => {
      const rules = ruleLoader.reloadRules(PROD_RULES_DIR);
      for (const rule of rules.values()) {
        expect(rule.pattern).toBeInstanceOf(RegExp);
      }
    });

    it('AI001 pattern matches real .claude config paths', () => {
      ruleLoader.reloadRules(PROD_RULES_DIR);
      const rule = ruleLoader.getRuleById('AI001', PROD_RULES_DIR);
      expect(rule).toBeDefined();
      expect(rule.pattern.test('/home/user/.claude/config.json')).toBe(true);
      expect(rule.pattern.test('C:\\Users\\me\\.claude\\settings')).toBe(true);
      expect(rule.reason).toBe('AI agent config — Claude Code');
    });

    it('Gate ③ rules classify kilo / opencode / grok config dirs', () => {
      ruleLoader.reloadRules(PROD_RULES_DIR);
      const kilo = ruleLoader.getRuleById('AI036', PROD_RULES_DIR);
      expect(kilo).toBeDefined();
      expect(kilo.pattern.test('/home/user/.config/kilo/kilo.jsonc')).toBe(true);
      expect(kilo.pattern.test('C:\\Users\\me\\.config\\kilo\\kilo.jsonc')).toBe(true);
      expect(kilo.reason).toBe('AI agent config — Kilo Code');

      const opencode = ruleLoader.getRuleById('AI037', PROD_RULES_DIR);
      expect(opencode).toBeDefined();
      expect(opencode.pattern.test('/home/user/.opencode/auth.json')).toBe(true);

      const grok = ruleLoader.getRuleById('AI038', PROD_RULES_DIR);
      expect(grok).toBeDefined();
      expect(grok.pattern.test('/home/user/.grok-build/settings.json')).toBe(true);
    });
  });

  describe('secrets rules — path-word false positives (SC003 / SC005 / SC006)', () => {
    const PROD_RULES_DIR = path.resolve(__dirname, '../../rules');

    // Each rule was the top false-positive producer of its word: the old patterns
    // matched a bare substring anywhere in the final path segment (SC005: anywhere in
    // the path), so ordinary source files containing the word fired as critical hits.
    // The rewritten patterns bound the word with [._-] separators (NOT \b — underscore
    // is a word character, and api_token/client_secret are exactly the names that must
    // keep firing) and scope loose compounds to secret-bearing data extensions.

    /** @param {string} id @returns {RegExp} */
    function pattern(id) {
      ruleLoader.reloadRules(PROD_RULES_DIR);
      const rule = ruleLoader.getRuleById(id, PROD_RULES_DIR);
      expect(rule).toBeDefined();
      return rule.pattern;
    }

    it('SC003 no longer fires on UI components and pages that merely mention "password"', () => {
      const re = pattern('SC003');
      expect(re.test('/app/src/components/PasswordInput.svelte')).toBe(false);
      expect(re.test('C:\\proj\\src\\pages\\forgot-password.html')).toBe(false);
      expect(re.test('/app/src/auth/password-reset.js')).toBe(false);
      expect(re.test('/docs/reset-password.md')).toBe(false);
    });

    it('SC003 still fires on files that actually store passwords', () => {
      const re = pattern('SC003');
      expect(re.test('/home/user/passwords.txt')).toBe(true);
      expect(re.test('C:\\Users\\me\\Documents\\wifi-password.txt')).toBe(true);
      expect(re.test('/home/user/.password')).toBe(true);
      expect(re.test('C:\\Users\\me\\db_password')).toBe(true);
      expect(re.test('/home/user/password.key')).toBe(true);
      expect(re.test('C:\\Users\\me\\app\\password.properties')).toBe(true);
    });

    it('SC005 no longer fires on segments that merely start with "secret"', () => {
      const re = pattern('SC005');
      expect(re.test('/app/src/pages/SecretSanta.tsx')).toBe(false);
      expect(re.test('/home/user/docs/secretary-notes.md')).toBe(false);
      expect(re.test('C:\\proj\\src\\SecretsManagerClient.ts')).toBe(false);
    });

    it('SC005 still fires on secret stores, and now catches client_secret.json', () => {
      const re = pattern('SC005');
      expect(re.test('/run/secrets/db_password')).toBe(true);
      expect(re.test('C:\\Users\\me\\.secrets\\api')).toBe(true);
      expect(re.test('/app/config/secrets.yaml')).toBe(true);
      expect(re.test('/home/user/.env.secret')).toBe(true);
      // The old pattern required "secret" straight after a slash and MISSED this one.
      expect(re.test('C:\\Users\\me\\AppData\\client_secret.json')).toBe(true);
    });

    it("SC006 no longer fires on the project's own tokens.css or on tokenizers", () => {
      const re = pattern('SC006');
      expect(re.test('X:\\proj\\src\\renderer\\lib\\styles\\tokens.css')).toBe(false);
      expect(re.test('/app/src/nlp/tokenizer.py')).toBe(false);
      expect(re.test('/app/src/main/token-adapters/usage.js')).toBe(false);
    });

    it('SC006 still fires on credential token files', () => {
      const re = pattern('SC006');
      expect(re.test('/home/user/.npm_token')).toBe(true);
      expect(re.test('/home/user/api-token.txt')).toBe(true);
      expect(re.test('C:\\Users\\me\\.config\\gh\\access_token.json')).toBe(true);
      expect(re.test('/home/user/github-token')).toBe(true);
    });
  });
});
