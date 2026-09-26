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

  it('leaves an old plaintext key inactive and preserves its file when secure storage is unavailable', () => {
    const original = JSON.stringify({ darkMode: true, anthropicApiKey: 'legacy-key-canary' });
    fs.writeFileSync(file, original);
    vi.spyOn(safeStore, 'isAvailable').mockReturnValue(false);
    config.loadSettings();
    expect(config.getSettings().darkMode).toBe(true);
    expect(config.getSettings().anthropicApiKey).toBe('');
    expect(config.hasPendingLegacyApiKey()).toBe(true);
    expect(() => config.saveSettings({ darkMode: false }, { patch: true })).toThrow(
      'Legacy API key migration is pending',
    );
    config.trackSeenAgent('Claude Code');
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
  });

  it('does not activate a legacy key when encrypted migration cannot replace the file', () => {
    const original = JSON.stringify({ anthropicApiKey: 'legacy-key-canary' });
    fs.writeFileSync(file, original);
    vi.spyOn(safeStore, 'isAvailable').mockReturnValue(true);
    vi.spyOn(safeStore, 'encrypt').mockReturnValue('encrypted-canary');
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('fixture rename failure');
    });
    config.loadSettings();
    expect(config.getSettings().anthropicApiKey).toBe('');
    expect(config.hasPendingLegacyApiKey()).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
    expect(fs.readdirSync(directory)).toEqual(['settings.json']);
  });

  it('retries encrypted migration before persisting unrelated settings after storage recovers', () => {
    fs.writeFileSync(file, JSON.stringify({ anthropicApiKey: 'legacy-key-canary' }));
    const available = vi.spyOn(safeStore, 'isAvailable').mockReturnValue(false);
    config.loadSettings();
    available.mockReturnValue(true);
    vi.spyOn(safeStore, 'encrypt').mockReturnValue('encrypted-canary');
    config.saveSettings({ agentPermissions: { Claude: { filesystem: 'block' } } }, { patch: true });
    expect(config.hasPendingLegacyApiKey()).toBe(false);
    expect(config.getSettings().anthropicApiKey).toBe('legacy-key-canary');
    expect(disk()).toMatchObject({
      _encryptedApiKey: 'encrypted-canary',
      agentPermissions: { Claude: { filesystem: 'block' } },
    });
    expect(disk()).not.toHaveProperty('anthropicApiKey');
  });

  it('keeps the legacy key inactive when the retry write fails', () => {
    const original = JSON.stringify({ anthropicApiKey: 'legacy-key-canary' });
    fs.writeFileSync(file, original);
    const available = vi.spyOn(safeStore, 'isAvailable').mockReturnValue(false);
    config.loadSettings();
    available.mockReturnValue(true);
    vi.spyOn(safeStore, 'encrypt').mockReturnValue('encrypted-canary');
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('fixture retry failure');
    });
    expect(() => config.saveSettings({ darkMode: true }, { patch: true })).toThrow(
      'fixture retry failure',
    );
    expect(config.getSettings().anthropicApiKey).toBe('');
    expect(config.getSettings().darkMode).toBe(false);
    expect(config.hasPendingLegacyApiKey()).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
    expect(fs.readdirSync(directory)).toEqual(['settings.json']);
  });

  it('rejects a changed legacy settings file before retry can activate a different key', () => {
    fs.writeFileSync(file, JSON.stringify({ anthropicApiKey: 'legacy-key-canary' }));
    const available = vi.spyOn(safeStore, 'isAvailable').mockReturnValue(false);
    config.loadSettings();
    const changed = JSON.stringify({ anthropicApiKey: 'swapped-key-canary' });
    fs.writeFileSync(file, changed);
    available.mockReturnValue(true);
    vi.spyOn(safeStore, 'encrypt').mockReturnValue('encrypted-canary');
    expect(() => config.saveSettings({ darkMode: true }, { patch: true })).toThrow(
      'Legacy API key migration is pending',
    );
    expect(config.getSettings().anthropicApiKey).toBe('');
    expect(config.hasPendingLegacyApiKey()).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe(changed);
  });

  it('activates a legacy key only after encrypted replacement and permits explicit removal', () => {
    fs.writeFileSync(file, JSON.stringify({ anthropicApiKey: 'legacy-key-canary' }));
    const available = vi.spyOn(safeStore, 'isAvailable').mockReturnValue(false);
    config.loadSettings();
    expect(config.hasPendingLegacyApiKey()).toBe(true);
    config.saveSettings({}, { patch: true, clearAnthropicApiKey: true });
    expect(config.hasPendingLegacyApiKey()).toBe(false);
    expect(disk()).not.toHaveProperty('anthropicApiKey');

    fs.writeFileSync(file, JSON.stringify({ anthropicApiKey: 'legacy-key-canary' }));
    available.mockReturnValue(true);
    vi.spyOn(safeStore, 'encrypt').mockReturnValue('encrypted-canary');
    config.loadSettings();
    expect(config.getSettings().anthropicApiKey).toBe('legacy-key-canary');
    expect(config.hasPendingLegacyApiKey()).toBe(false);
    expect(disk()).toMatchObject({ _encryptedApiKey: 'encrypted-canary' });
    expect(fs.readFileSync(file, 'utf8')).not.toContain('legacy-key-canary');
  });

  it('replaces a pending legacy key only after an explicit encrypted save succeeds', () => {
    const original = JSON.stringify({ anthropicApiKey: 'legacy-key-canary' });
    fs.writeFileSync(file, original);
    const available = vi.spyOn(safeStore, 'isAvailable').mockReturnValue(false);
    config.loadSettings();
    const encrypt = vi.spyOn(safeStore, 'encrypt').mockReturnValue(null);
    expect(() =>
      config.saveSettings({ anthropicApiKey: 'replacement-canary' }, { patch: true }),
    ).toThrow('Secure key storage');
    expect(config.hasPendingLegacyApiKey()).toBe(true);
    expect(config.getSettings().anthropicApiKey).toBe('');
    expect(fs.readFileSync(file, 'utf8')).toBe(original);

    available.mockReturnValue(true);
    encrypt.mockReturnValue('encrypted-replacement');
    config.saveSettings({ anthropicApiKey: 'replacement-canary' }, { patch: true });
    expect(config.hasPendingLegacyApiKey()).toBe(false);
    expect(config.getSettings().anthropicApiKey).toBe('replacement-canary');
    expect(disk()).toMatchObject({ _encryptedApiKey: 'encrypted-replacement' });
    expect(fs.readFileSync(file, 'utf8')).not.toContain('legacy-key-canary');
    expect(fs.readFileSync(file, 'utf8')).not.toContain('replacement-canary');
  });

  it('scrubs a plaintext legacy field even when an encrypted blob is also present', () => {
    fs.writeFileSync(
      file,
      JSON.stringify({ anthropicApiKey: 'legacy-key-canary', _encryptedApiKey: 'old-blob' }),
    );
    vi.spyOn(safeStore, 'isAvailable').mockReturnValue(true);
    vi.spyOn(safeStore, 'decrypt').mockReturnValue('decrypted-canary');
    config.loadSettings();
    expect(config.getSettings().anthropicApiKey).toBe('decrypted-canary');
    expect(config.hasPendingLegacyApiKey()).toBe(false);
    expect(disk()).toMatchObject({ _encryptedApiKey: 'old-blob' });
    expect(disk()).not.toHaveProperty('anthropicApiKey');
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
