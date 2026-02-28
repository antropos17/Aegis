import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import os from 'os';

const require = createRequire(import.meta.url);

describe('config-manager', () => {
  let configManager;
  let tmpDir;
  let settingsPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-config-test-'));
    settingsPath = path.join(tmpDir, 'settings.json');
    configManager = require('../../src/main/config-manager.js');
    configManager._setSettingsPathForTest(settingsPath);
  });

  afterEach(() => {
    // Reset the cached path so it re-resolves next time
    configManager._setSettingsPathForTest(null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loadSettings() returns defaults when no file', () => {
    configManager.loadSettings();
    const settings = configManager.getSettings();
    expect(settings.scanIntervalSec).toBe(10);
    expect(settings.notificationsEnabled).toBe(true);
    expect(settings.customSensitivePatterns).toEqual([]);
    expect(settings.seenAgents).toEqual([]);
  });

  it('loadSettings() merges saved file with defaults', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ scanIntervalSec: 30, darkMode: true }));
    configManager.loadSettings();
    const settings = configManager.getSettings();
    expect(settings.scanIntervalSec).toBe(30);
    expect(settings.darkMode).toBe(true);
    expect(settings.notificationsEnabled).toBe(true);
  });

  it('saveSettings() round-trip', () => {
    configManager.loadSettings();
    configManager.saveSettings({ scanIntervalSec: 20, darkMode: true });

    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(raw.scanIntervalSec).toBe(20);
    expect(raw.darkMode).toBe(true);
  });

  it('buildCustomRules() compiles valid regex, skips invalid', () => {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        customSensitivePatterns: ['valid\\.pattern', '[invalid', 'another\\.rule'],
      }),
    );
    configManager.loadSettings();
    const rules = configManager.getCustomSensitiveRules();
    expect(rules).toHaveLength(2);
    expect(rules[0].pattern).toBeInstanceOf(RegExp);
    expect(rules[0].reason).toBe('Custom: valid\\.pattern');
    expect(rules[1].reason).toBe('Custom: another\\.rule');
  });

  it('getDefaultPermissions() — monitor for known, block for unknown', () => {
    configManager.init({ knownAgentNames: ['Claude Code'] });
    const knownPerms = configManager.getDefaultPermissions('Claude Code');
    expect(Object.values(knownPerms).every((v) => v === 'monitor')).toBe(true);

    const unknownPerms = configManager.getDefaultPermissions('UnknownAgent');
    expect(Object.values(unknownPerms).every((v) => v === 'block')).toBe(true);
  });

  it('getAgentPermissions() — saved perms or fallback to defaults', () => {
    configManager.init({ knownAgentNames: ['Claude Code'] });
    configManager.loadSettings();
    const perms = configManager.getAgentPermissions('Claude Code');
    expect(Object.values(perms).every((v) => v === 'monitor')).toBe(true);
  });

  it('getInstanceKey() — builds correct keys', () => {
    expect(configManager.getInstanceKey('Claude', null, '/project')).toBe('Claude::/project');
    expect(configManager.getInstanceKey('Claude', 'VS Code', null)).toBe('Claude::VS Code');
    expect(configManager.getInstanceKey('Claude', null, null)).toBe('Claude');
  });

  it('getInstancePermissions() — fallback chain: cwd → editor → agent → default', () => {
    configManager.init({ knownAgentNames: ['Claude'] });
    configManager.loadSettings();

    const settings = configManager.getSettings();
    settings.agentPermissions['Claude'] = { filesystem: 'agent-level' };
    settings.agentPermissions['Claude::VS Code'] = { filesystem: 'editor-level' };
    settings.agentPermissions['Claude::/project'] = { filesystem: 'cwd-level' };

    const cwdPerms = configManager.getInstancePermissions('Claude', 'VS Code', '/project');
    expect(cwdPerms.filesystem).toBe('cwd-level');

    const editorPerms = configManager.getInstancePermissions('Claude', 'VS Code', null);
    expect(editorPerms.filesystem).toBe('editor-level');

    const agentPerms = configManager.getInstancePermissions('Claude', null, null);
    expect(agentPerms.filesystem).toBe('agent-level');
  });

  it('saveInstancePermissions() persists and reads back', () => {
    configManager.loadSettings();
    configManager.saveInstancePermissions('Claude', 'VS Code', { filesystem: 'allow' }, null);

    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(raw.agentPermissions['Claude::VS Code']).toEqual({ filesystem: 'allow' });
  });

  it('trackSeenAgent() adds to list, creates perms, is idempotent', () => {
    configManager.init({ knownAgentNames: ['Claude'] });
    configManager.loadSettings();

    configManager.trackSeenAgent('Claude');
    let settings = configManager.getSettings();
    expect(settings.seenAgents).toContain('Claude');
    expect(settings.agentPermissions['Claude']).toBeDefined();

    configManager.trackSeenAgent('Claude');
    settings = configManager.getSettings();
    expect(settings.seenAgents.filter((a) => a === 'Claude')).toHaveLength(1);
  });

  it('getCustomAgents() / saveCustomAgents() round-trip', () => {
    configManager.loadSettings();
    const agents = [{ name: 'MyAgent', patterns: ['myagent'] }];
    configManager.saveCustomAgents(agents);
    expect(configManager.getCustomAgents()).toEqual(agents);

    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(raw.customAgents).toEqual(agents);
  });
});
