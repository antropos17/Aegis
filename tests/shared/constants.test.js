import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  SENSITIVE_RULES,
  AGENT_SELF_CONFIG,
  PERMISSION_CATEGORIES,
  EDITORS,
  IGNORE_PROCESS_PATTERNS,
} = require('../../src/shared/constants');

describe('constants', () => {
  describe('SENSITIVE_RULES', () => {
    it('all patterns are valid RegExp', () => {
      for (const rule of SENSITIVE_RULES) {
        expect(rule.pattern).toBeInstanceOf(RegExp);
        expect(typeof rule.reason).toBe('string');
        expect(rule.reason.length).toBeGreaterThan(0);
      }
    });

    it('agent config rules match expected paths', () => {
      const agentConfigRules = SENSITIVE_RULES.filter((r) => r.category === 'agent-config');
      expect(agentConfigRules.length).toBeGreaterThan(0);

      const claudeRule = agentConfigRules.find((r) => r.reason.includes('Claude Code'));
      expect(claudeRule).toBeDefined();
      expect(claudeRule.pattern.test('/home/user/.claude/config.json')).toBe(true);

      const cursorRule = agentConfigRules.find((r) => r.reason.includes('Cursor'));
      expect(cursorRule).toBeDefined();
      expect(cursorRule.pattern.test('/home/user/.cursor/settings.json')).toBe(true);
    });
  });

  describe('AGENT_SELF_CONFIG', () => {
    it('each matches its own config path', () => {
      expect(AGENT_SELF_CONFIG.claude.test('/home/.claude/config')).toBe(true);
      expect(AGENT_SELF_CONFIG.cursor.test('/home/.cursor/settings')).toBe(true);
      expect(AGENT_SELF_CONFIG.copilot.test('/home/.copilot/hosts.json')).toBe(true);
      expect(AGENT_SELF_CONFIG.codeium.test('/home/.codeium/config')).toBe(true);
    });

    it('no cross-matching (claude ≠ .cursor/)', () => {
      expect(AGENT_SELF_CONFIG.claude.test('/home/.cursor/settings')).toBe(false);
      expect(AGENT_SELF_CONFIG.cursor.test('/home/.claude/config')).toBe(false);
      expect(AGENT_SELF_CONFIG.copilot.test('/home/.claude/config')).toBe(false);
    });
  });

  describe('PERMISSION_CATEGORIES', () => {
    it('exactly 6 entries', () => {
      expect(PERMISSION_CATEGORIES).toHaveLength(6);
      expect(PERMISSION_CATEGORIES).toContain('filesystem');
      expect(PERMISSION_CATEGORIES).toContain('sensitive');
      expect(PERMISSION_CATEGORIES).toContain('network');
      expect(PERMISSION_CATEGORIES).toContain('terminal');
      expect(PERMISSION_CATEGORIES).toContain('clipboard');
      expect(PERMISSION_CATEGORIES).toContain('screen');
    });
  });

  describe('EDITORS', () => {
    it('all have names[] and label', () => {
      for (const editor of EDITORS) {
        expect(Array.isArray(editor.names)).toBe(true);
        expect(editor.names.length).toBeGreaterThan(0);
        expect(typeof editor.label).toBe('string');
        expect(editor.label.length).toBeGreaterThan(0);
      }
    });
  });

  describe('IGNORE_PROCESS_PATTERNS', () => {
    it("doesn't match known AI agents", () => {
      const aiNames = ['claude', 'copilot', 'cursor', 'codeium', 'tabnine', 'aider'];
      for (const name of aiNames) {
        const matches = IGNORE_PROCESS_PATTERNS.some((p) => name.includes(p));
        expect(matches).toBe(false);
      }
    });

    it('matches hardware/driver process names', () => {
      expect(IGNORE_PROCESS_PATTERNS.some((p) => 'nvidia-smi'.includes(p))).toBe(true);
      expect(IGNORE_PROCESS_PATTERNS.some((p) => 'logioptionsplus'.includes(p))).toBe(true);
      expect(IGNORE_PROCESS_PATTERNS.some((p) => 'razer-control'.includes(p))).toBe(true);
    });
  });
});
