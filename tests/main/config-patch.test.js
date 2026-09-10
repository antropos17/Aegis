import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import config from '../../src/main/config-manager.js';
const safeStore = require('../../src/main/safe-storage.js');
let directory;
let file;
const disk = () => JSON.parse(fs.readFileSync(file, 'utf8'));
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-settings-patch-'));
  file = path.join(directory, 'settings.json');
  config._setSettingsPathForTest(file);
  config.loadSettings();
});
afterEach(() => {
  vi.restoreAllMocks();
  config._setSettingsPathForTest(null);
  fs.rmSync(directory, { recursive: true, force: true });
});

it('merges independent stale settings drafts with latest preferences and background discoveries', () => {
  const first = structuredClone(config.getSettings());
  const second = structuredClone(config.getSettings());
  first.scanIntervalSec = 60;
  second.notificationsEnabled = false;
  config.saveSettings({ scanIntervalSec: first.scanIntervalSec }, { patch: true });
  config.trackSeenAgent('Patch fixture');
  config.saveSettings({ notificationsEnabled: second.notificationsEnabled }, { patch: true });
  expect(config.getSettings()).toMatchObject({
    scanIntervalSec: 60,
    notificationsEnabled: false,
    seenAgents: ['Patch fixture'],
  });
  expect(config.getSettings().agentPermissions['Patch fixture']).toBeDefined();
  config.loadSettings();
  expect(config.getSettings()).toMatchObject({
    scanIntervalSec: 60,
    notificationsEnabled: false,
    seenAgents: ['Patch fixture'],
  });
});

it('keeps settings and provider drafts independent in both commit orders', () => {
  vi.spyOn(safeStore, 'encrypt').mockReturnValue('opaque-fixture');
  config.saveSettings({ scanIntervalSec: 60 }, { patch: true });
  config.saveSettings({ anthropicApiKey: 'fixture-secret' }, { patch: true });
  config.saveSettings({ uiScale: 1.5 }, { patch: true });
  expect(config.getSettings()).toMatchObject({
    scanIntervalSec: 60,
    uiScale: 1.5,
    anthropicApiKey: 'fixture-secret',
  });
  expect(disk()).not.toHaveProperty('anthropicApiKey');
  expect(JSON.stringify(disk())).not.toContain('fixture-secret');
  config.saveSettings({ anthropicApiKey: '' }, { patch: true, clearAnthropicApiKey: true });
  expect(config.getSettings()).toMatchObject({
    scanIntervalSec: 60,
    uiScale: 1.5,
    anthropicApiKey: '',
  });
  expect(disk()).not.toHaveProperty('_encryptedApiKey');
});

it('retains legacy replacement semantics and isolates nested patch inputs from canonical state', () => {
  config.saveSettings({ darkMode: true, scanIntervalSec: 60 });
  config.saveSettings({ scanIntervalSec: 20 });
  expect(config.getSettings().darkMode).toBe(false);
  const patch = {
    ignoredDirectories: ['fixture'],
    agentPermissions: { Fixture: { filesystem: 'block' } },
  };
  config.saveSettings(patch, { patch: true });
  patch.ignoredDirectories.push('later');
  patch.agentPermissions.Fixture.filesystem = 'allow';
  expect(config.getSettings().ignoredDirectories).toEqual(['fixture']);
  expect(config.getSettings().agentPermissions.Fixture.filesystem).toBe('block');
});

it.each([
  null,
  [],
  { patch: 'true' },
  { patch: true, clearAnthropicApiKey: 1 },
  { patch: true, unknown: false },
  Object.create({ patch: true }),
  { [Symbol('patch')]: true },
])('rejects malformed patch options before changing memory or disk: %j', (options) => {
  config.saveSettings({ scanIntervalSec: 60 });
  const before = structuredClone(config.getSettings());
  const saved = disk();
  expect(() => config.saveSettings({ darkMode: true }, options)).toThrow(
    'Invalid settings save options',
  );
  expect(config.getSettings()).toEqual(before);
  expect(disk()).toEqual(saved);
});

it('rejects invalid patches and invalid merged canonical state atomically', () => {
  config.saveSettings({ scanIntervalSec: 60 });
  const before = structuredClone(config.getSettings());
  const saved = disk();
  expect(() => config.saveSettings({ scanIntervalSec: 0 }, { patch: true })).toThrow();
  expect(config.getSettings()).toEqual(before);
  // Existing main-process users have mutable access; validate the entire candidate too.
  config.getSettings().agentPermissions = null;
  expect(() => config.saveSettings({ darkMode: true }, { patch: true })).toThrow();
  expect(config.getSettings().darkMode).toBe(false);
  expect(disk()).toEqual(saved);
});

it('retains a locked blob through patches and rolls back failed explicit removal', () => {
  vi.spyOn(safeStore, 'decrypt').mockReturnValue('');
  vi.spyOn(safeStore, 'encrypt').mockReturnValue(null);
  fs.writeFileSync(
    file,
    JSON.stringify({ scanIntervalSec: 60, _encryptedApiKey: 'opaque-fixture' }),
  );
  config.loadSettings();
  config.saveSettings({ uiScale: 1.5 }, { patch: true });
  const before = structuredClone(config.getSettings());
  const saved = disk();
  expect(() =>
    config.saveSettings({ anthropicApiKey: 'replacement-fixture' }, { patch: true }),
  ).toThrow('Secure key storage');
  expect(config.getSettings()).toEqual(before);
  expect(disk()).toEqual(saved);
  vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
    throw new Error('Disk unavailable');
  });
  expect(() =>
    config.saveSettings({ anthropicApiKey: '' }, { patch: true, clearAnthropicApiKey: true }),
  ).toThrow('Disk unavailable');
  expect(config.getSettings()).toEqual(before);
  expect(disk()).toEqual(saved);
  config.saveSettings({ notificationsEnabled: false }, { patch: true });
  expect(disk()).toMatchObject({
    scanIntervalSec: 60,
    uiScale: 1.5,
    _encryptedApiKey: 'opaque-fixture',
  });
  config.saveSettings({ anthropicApiKey: '' }, { patch: true, clearAnthropicApiKey: true });
  expect(config.getSettings()).toMatchObject({
    scanIntervalSec: 60,
    uiScale: 1.5,
    notificationsEnabled: false,
  });
  expect(disk()).not.toHaveProperty('_encryptedApiKey');
  expect(disk()).not.toHaveProperty('anthropicApiKey');
});
