import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import Module from 'module';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock electron via Module._load interception (covers every `require('electron')`).
const mockGetPath = vi.fn(() => os.tmpdir());
const fakeElectron = { app: { getPath: mockGetPath } };

const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return fakeElectron;
  return originalLoad.apply(this, arguments);
};

afterAll(() => {
  Module._load = originalLoad;
});

// Load via Node's real CJS require so the test and blocklist's internal
// `require('./config-manager')` share ONE config-manager singleton (mirrors
// production, where main.js loads settings once). _setSettingsPathForTest then
// pins the exact instance blocklist writes through — config-manager caches
// _settingsPath, so a per-test override is required for isolation.
const require = createRequire(import.meta.url);
const configManager = require('../../src/main/config-manager.js');
const blocklist = require('../../src/main/blocklist.js');

describe('blocklist (alert-only watchlist)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-blocklist-test-'));
    configManager._setSettingsPathForTest(path.join(tmpDir, 'settings.json'));
    // The config-manager singleton persists across tests, and loadSettings()
    // only resets in-memory state when the file exists. saveSettings({}) writes
    // a fresh defaults file and resets memory — a clean baseline per test.
    configManager.saveSettings({});
  });

  afterEach(() => {
    configManager._setSettingsPathForTest(null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('list() is empty by default', () => {
    expect(blocklist.list()).toEqual([]);
  });

  it('add() canonicalizes a known signature and marks it known', () => {
    const entry = blocklist.add({ signature: 'Claude Code', reason: 'suspicious' });
    expect(entry.signature).toBe('claude-code');
    expect(entry.known).toBe(true);
    expect(entry.pid).toBe(null);
    expect(entry.reason).toBe('suspicious');
    expect(blocklist.list()).toHaveLength(1);
  });

  it('canonicalizes case-insensitively so an id alias and a scanned display name unify', () => {
    // Added by the (upper-cased) id; a scan reports the agent by display name.
    // Both must resolve to the same canonical id so the flag matches.
    blocklist.add({ signature: 'CLAUDE-CODE' });
    expect(blocklist.isFlagged({ agent: 'Claude Code', pid: 1 })).toBe(true);
  });

  it('add() stores an unknown signature normalized and marks it not known', () => {
    const entry = blocklist.add({ signature: 'Totally Unknown Bot' });
    expect(entry.known).toBe(false);
    expect(entry.signature).toBe('totally unknown bot');
  });

  it('add() persists and round-trips without wiping unrelated settings', () => {
    // pre-existing unrelated setting must survive the watchlist write
    configManager.saveSettings({ scanIntervalSec: 30, darkMode: true });
    blocklist.add({ signature: 'Claude Code', pid: 4242, reason: 'leak' });

    // reload from disk → both the unrelated setting and the watchlist survive
    configManager.loadSettings();
    expect(configManager.getSettings().scanIntervalSec).toBe(30);
    expect(configManager.getSettings().darkMode).toBe(true);

    const list = blocklist.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ signature: 'claude-code', pid: 4242, reason: 'leak' });
  });

  it('add() upserts the same (signature, pid) pair instead of duplicating', () => {
    blocklist.add({ signature: 'Claude Code', pid: 100, reason: 'first' });
    blocklist.add({ signature: 'claude-code', pid: 100, reason: 'updated' });
    const list = blocklist.list();
    expect(list).toHaveLength(1);
    expect(list[0].reason).toBe('updated');
  });

  it('add() throws on an empty/invalid signature or pid', () => {
    expect(() => blocklist.add({ signature: '' })).toThrow(TypeError);
    expect(() => blocklist.add({})).toThrow(TypeError);
    expect(() => blocklist.add({ signature: 'Claude Code', pid: -5 })).toThrow(TypeError);
    expect(() => blocklist.add({ signature: 'Claude Code', pid: 1.5 })).toThrow(TypeError);
  });

  it('remove() returns true when present and false when absent', () => {
    blocklist.add({ signature: 'Claude Code', pid: 7 });
    expect(blocklist.remove({ signature: 'Claude Code', pid: 7 })).toBe(true);
    expect(blocklist.list()).toHaveLength(0);
    expect(blocklist.remove({ signature: 'Claude Code', pid: 7 })).toBe(false);
  });

  it('remove() with no pid removes only the any-PID entry, not per-PID ones', () => {
    blocklist.add({ signature: 'Claude Code' }); // any-PID
    blocklist.add({ signature: 'Claude Code', pid: 9 }); // per-PID
    expect(blocklist.remove({ signature: 'Claude Code' })).toBe(true);
    const list = blocklist.list();
    expect(list).toHaveLength(1);
    expect(list[0].pid).toBe(9);
  });

  // ── C-01: matching is per-PID + signature, never a bare-PID coincidence ──
  it('isFlagged() does NOT cross-wire a PID to a different agent (C-01)', () => {
    blocklist.add({ signature: 'claude-code', pid: 111 });
    // same PID, different agent → must be false (would be true under PID-only match)
    expect(blocklist.isFlagged({ agent: 'GitHub Copilot', pid: 111 })).toBe(false);
    // same PID, same agent → true
    expect(blocklist.isFlagged({ agent: 'Claude Code', pid: 111 })).toBe(true);
  });

  it('isFlagged() with a per-PID entry does not match a different pid', () => {
    blocklist.add({ signature: 'Claude Code', pid: 111 });
    expect(blocklist.isFlagged({ agent: 'Claude Code', pid: 222 })).toBe(false);
  });

  it('isFlagged() with an any-PID entry matches every pid of that signature', () => {
    blocklist.add({ signature: 'Claude Code' }); // pid null = any
    expect(blocklist.isFlagged({ agent: 'Claude Code', pid: 1 })).toBe(true);
    expect(blocklist.isFlagged({ agent: 'Claude Code', pid: 99999 })).toBe(true);
    expect(blocklist.isFlagged({ agent: 'GitHub Copilot', pid: 1 })).toBe(false);
  });

  it('isFlagged() returns false for empty/garbage input', () => {
    expect(blocklist.isFlagged(null)).toBe(false);
    expect(blocklist.isFlagged({})).toBe(false);
    expect(blocklist.isFlagged({ pid: 5 })).toBe(false);
  });

  // ── Honesty / does-not-change-monitoring guarantees ──
  // NOTE: the enforcement-verb tokens below appear ONLY inside a *negative*
  // assertion that proves the public API contains none of them — they are not
  // claims of capability.
  it('exposes exactly the alert-only surface — no enforcement export', () => {
    expect(Object.keys(blocklist).sort()).toEqual(['add', 'isFlagged', 'list', 'remove']);
    for (const name of Object.keys(blocklist)) {
      expect(name).not.toMatch(/block|kill|prevent|enforce|kernel|terminate/i);
    }
  });

  it('isFlagged() is a pure read — it never mutates the watchlist', () => {
    blocklist.add({ signature: 'Claude Code', pid: 5 });
    const before = blocklist.list();
    blocklist.isFlagged({ agent: 'Claude Code', pid: 5 });
    blocklist.isFlagged({ agent: 'GitHub Copilot', pid: 5 });
    expect(blocklist.list()).toEqual(before);
  });
});
