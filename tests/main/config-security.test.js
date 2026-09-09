import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import config from '../../src/main/config-manager.js';
const safeStore = require('../../src/main/safe-storage.js');

describe('configuration persistence boundaries', () => {
  let directory;
  let file;
  const disk = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-config-security-'));
    file = path.join(directory, 'settings.json');
    config._setSettingsPathForTest(file);
    config.loadSettings();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    config._setSettingsPathForTest(null);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it.each([
    { agentPermissions: null },
    { customAgents: {} },
    { scanIntervalSec: NaN },
    { seenAgents: null },
  ])('rejects malformed settings before disk or memory changes: %j', (patch) => {
    config.saveSettings({ scanIntervalSec: 20 });
    const before = structuredClone(config.getSettings());
    const saved = disk();
    expect(() => config.saveSettings({ ...before, ...patch })).toThrow();
    expect(config.getSettings()).toEqual(before);
    expect(disk()).toEqual(saved);
  });

  it('recovers valid preferences from a malformed persisted file', () => {
    fs.writeFileSync(
      file,
      JSON.stringify({
        darkMode: true,
        scanIntervalSec: 25,
        customSensitivePatterns: null,
        agentPermissions: null,
        seenAgents: null,
        customAgents: {},
        notificationsEnabled: 'false',
      }),
    );
    expect(() => config.loadSettings()).not.toThrow();
    expect(config.getSettings()).toMatchObject({
      darkMode: true,
      scanIntervalSec: 25,
      customSensitivePatterns: [],
      agentPermissions: {},
      seenAgents: [],
      customAgents: [],
      notificationsEnabled: true,
    });
    expect(() => config.getAgentPermissions('Claude')).not.toThrow();
  });

  it('refuses plaintext key persistence and rolls back failed replacement', () => {
    vi.spyOn(safeStore, 'encrypt').mockReturnValue(null);
    config.saveSettings({ darkMode: true });
    const saved = disk();
    expect(() =>
      config.saveSettings({ ...config.getSettings(), anthropicApiKey: 'fixture-secret' }),
    ).toThrow('Secure key storage');
    expect(config.getSettings().anthropicApiKey).toBe('');
    expect(disk()).toEqual(saved);
    expect(fs.readdirSync(directory)).toEqual(['settings.json']);
  });

  it('keeps a locked encrypted key through unrelated saves, reload and failed replacement', () => {
    vi.spyOn(safeStore, 'decrypt').mockReturnValue('');
    vi.spyOn(safeStore, 'encrypt').mockReturnValue(null);
    fs.writeFileSync(file, JSON.stringify({ _encryptedApiKey: 'opaque-fixture' }));
    config.loadSettings();
    expect(config.getSettings()).not.toHaveProperty('_encryptedApiKey');
    config.saveSettings({ ...config.getSettings(), scanIntervalSec: 30 });
    expect(disk()).toMatchObject({ _encryptedApiKey: 'opaque-fixture', scanIntervalSec: 30 });
    expect(() =>
      config.saveSettings({ ...config.getSettings(), anthropicApiKey: 'replacement-fixture' }),
    ).toThrow();
    config.loadSettings();
    config.saveSettings({ ...config.getSettings(), darkMode: true });
    expect(disk()._encryptedApiKey).toBe('opaque-fixture');
  });

  it('supports explicit removal of locked keys and rolls back a failed removal', () => {
    vi.spyOn(safeStore, 'decrypt').mockReturnValue('');
    fs.writeFileSync(file, JSON.stringify({ _encryptedApiKey: 'opaque-fixture' }));
    config.loadSettings();
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('Disk unavailable');
    });
    expect(() => config.saveSettings(config.getSettings(), { clearAnthropicApiKey: true })).toThrow(
      'Disk unavailable',
    );
    config.saveSettings({ ...config.getSettings(), darkMode: true });
    expect(disk()._encryptedApiKey).toBe('opaque-fixture');
    config.saveSettings(config.getSettings(), { clearAnthropicApiKey: true });
    expect(disk()).not.toHaveProperty('_encryptedApiKey');
    expect(disk()).not.toHaveProperty('anthropicApiKey');
  });

  it('reuses existing encryption when unrelated preferences are saved', () => {
    const encrypt = vi.spyOn(safeStore, 'encrypt').mockReturnValue('opaque-fixture');
    config.saveSettings({ anthropicApiKey: 'fixture-secret' });
    encrypt.mockReturnValue(null);
    config.saveSettings({ ...config.getSettings(), darkMode: true });
    expect(disk()._encryptedApiKey).toBe('opaque-fixture');
    expect(fs.readFileSync(file, 'utf8')).not.toContain('fixture-secret');
    expect(disk()).not.toHaveProperty('anthropicApiKey');
  });

  it.each([
    '(a|aa)+$',
    '((a+))+$',
    '(a{1,8})+$',
    '(?:ab)+',
    '(a)\\1+',
    '(?=x).*',
    'a+a+$',
    'a{1,8}a{1,8}$',
    'a{999999999}',
  ])('rejects unsupported backtracking pattern %s', (pattern) => {
    expect(config.isSafeRegex(pattern)).toBe(false);
  });
  it.each(['\\.env$', '[/\\\\]\\.ssh[/\\\\]', '(secret|password)', 'token[0-9]+$', 'key.{0,64}$'])(
    'retains supported path pattern %s',
    (pattern) => {
      expect(config.isSafeRegex(pattern)).toBe(true);
    },
  );
  it.each([null, [], 'clear', { clearAnthropicApiKey: 'true' }, { unexpected: true }])(
    'rejects invalid save options without mutating memory: %j',
    (options) => {
      config.saveSettings({ scanIntervalSec: 20 });
      const before = structuredClone(config.getSettings());
      const saved = disk();
      expect(() => config.saveSettings({ darkMode: true }, options)).toThrow(
        'Invalid settings save options',
      );
      expect(config.getSettings()).toEqual(before);
      expect(disk()).toEqual(saved);
    },
  );
});
