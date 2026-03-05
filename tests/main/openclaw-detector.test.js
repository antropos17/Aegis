import { describe, it, expect, beforeAll } from 'vitest';
import agentDatabase from '../../src/shared/agent-database.json';
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

describe('OpenClaw agent detection', () => {
  // ═══ Agent Database Tests ═══

  describe('agent-database.json', () => {
    it('finds OpenClaw agent with correct id', () => {
      const openclaw = agentDatabase.agents.find((a) => a.id === 'openclaw');
      expect(openclaw).toBeDefined();
      expect(openclaw.displayName).toBe('OpenClaw');
    });

    it('has correct legacy aliases for OpenClaw', () => {
      const openclaw = agentDatabase.agents.find((a) => a.id === 'openclaw');
      expect(openclaw.names).toContain('openclaw');
      expect(openclaw.names).toContain('moltbot');
      expect(openclaw.names).toContain('clawdbot');
      expect(openclaw.names).toContain('molty');
    });

    it('has correct known ports for OpenClaw', () => {
      const openclaw = agentDatabase.agents.find((a) => a.id === 'openclaw');
      expect(openclaw.knownPorts).toContain(18789);
    });

    it('has correct config paths for OpenClaw', () => {
      const openclaw = agentDatabase.agents.find((a) => a.id === 'openclaw');
      expect(openclaw.configPaths).toContain('~/.openclaw/');
      expect(openclaw.configPaths).toContain('~/.openclaw/config');
      expect(openclaw.configPaths).toContain('~/.moltbot/');
    });

    it('has correct known domains for OpenClaw', () => {
      const openclaw = agentDatabase.agents.find((a) => a.id === 'openclaw');
      expect(openclaw.knownDomains).toContain('openclaw.ai');
      expect(openclaw.knownDomains).toContain('127.0.0.1');
    });

    it('legacy names resolve to same agent id', () => {
      const openclaw = agentDatabase.agents.find((a) => a.id === 'openclaw');
      // All legacy names should resolve to 'openclaw'
      expect(openclaw.names).toContain('moltbot');
      expect(openclaw.names).toContain('clawdbot');
      expect(openclaw.names).toContain('molty');
    });
  });

  // ═══ Detection Rules Tests ═══

  describe('detection rules (rules/ai-config.yaml)', () => {
    let aiConfigRules;

    beforeAll(() => {
      const aiConfigPath = path.resolve(__dirname, '../../rules/ai-config.yaml');
      const aiConfigContent = fs.readFileSync(aiConfigPath, 'utf8');
      const aiConfig = YAML.parse(aiConfigContent);
      aiConfigRules = aiConfig.rules ?? [];
    });

    it('has rules referencing OpenClaw config paths', () => {
      const openclawDirRule = aiConfigRules.find(
        (r) => r.pattern && r.pattern.includes('.openclaw'),
      );
      expect(openclawDirRule).toBeDefined();
      expect(openclawDirRule.pattern).toMatch(/\.openclaw/);
    });

    it('has rules referencing moltbot config paths (legacy)', () => {
      const moltbotRule = aiConfigRules.find((r) => r.pattern && r.pattern.includes('.moltbot'));
      expect(moltbotRule).toBeDefined();
      expect(moltbotRule.pattern).toMatch(/\.moltbot/);
    });

    it('has rules referencing OpenClaw config.yaml', () => {
      const openclawConfigRule = aiConfigRules.find(
        (r) => r.pattern && r.pattern.includes('.openclaw') && r.pattern.includes('config'),
      );
      expect(openclawConfigRule).toBeDefined();
    });
  });
});
