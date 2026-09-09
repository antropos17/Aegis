import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import configManager from '../../src/main/config-manager.js';

describe('config-manager', () => {
  let tmpDir;
  let settingsPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-config-test-'));
    settingsPath = path.join(tmpDir, 'settings.json');
    configManager._setSettingsPathForTest(settingsPath);
  });

  afterEach(() => {
    // Reset the cached path so it re-resolves next time
    configManager._setSettingsPathForTest(null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it.each(['settings', 'permissions', 'catalog', 'false-positive'])(
    'keeps disk and memory unchanged when %s persistence fails',
    (kind) => {
      configManager.loadSettings();
      configManager.saveSettings({ ...configManager.getSettings(), scanIntervalSec: 15 });
      const before = structuredClone(configManager.getSettings());
      const diskBefore = fs.readFileSync(settingsPath, 'utf8');
      const rename = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
        throw new Error('Disk unavailable');
      });
      try {
        const actions = {
          settings: () => configManager.saveSettings({ ...before, scanIntervalSec: 20 }),
          permissions: () =>
            configManager.saveInstancePermissions(
              'Claude',
              null,
              { filesystem: 'block' },
              '/project',
            ),
          catalog: () =>
            configManager.saveCustomAgents([{ id: 'new', displayName: 'New', names: ['new.exe'] }]),
          'false-positive': () =>
            configManager.addFalsePositive({ agentName: 'Claude', pattern: 'x', timestamp: 1 }),
        };
        expect(actions[kind]).toThrow('Disk unavailable');
        expect(configManager.getSettings()).toEqual(before);
        expect(fs.readFileSync(settingsPath, 'utf8')).toBe(diskBefore);
        expect(fs.readdirSync(tmpDir)).toEqual(['settings.json']);
      } finally {
        rename.mockRestore();
      }
    },
  );

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

  it('instance permission keys match shared buildInstanceKey (cwd beats editor)', () => {
    const { buildInstanceKey } = require('../../src/shared/instance-key.js');
    configManager.init({ knownAgentNames: ['Claude'] });
    configManager.loadSettings();

    const cwdKey = buildInstanceKey('Claude', 'VS Code', '/repo');
    const editorKey = buildInstanceKey('Claude', 'VS Code', null);
    expect(cwdKey).toBe('Claude::/repo');
    expect(editorKey).toBe('Claude::VS Code');

    configManager.saveInstancePermissions('Claude', 'VS Code', { filesystem: 'block' }, '/repo');
    configManager.saveInstancePermissions('Claude', 'VS Code', { filesystem: 'monitor' }, null);

    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(raw.agentPermissions[cwdKey].filesystem).toBe('block');
    expect(raw.agentPermissions[editorKey].filesystem).toBe('monitor');
    expect(configManager.getInstancePermissions('Claude', 'VS Code', '/repo').filesystem).toBe(
      'block',
    );
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
    const agents = [{ id: 'myagent', displayName: 'MyAgent', names: ['myagent'] }];
    configManager.saveCustomAgents(agents);
    expect(configManager.getCustomAgents()).toEqual(agents);

    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(raw.customAgents).toEqual(agents);
  });
});
