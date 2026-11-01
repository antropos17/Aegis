import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nativeReadEnvironment } from '../../scripts/qualification/windows-native-read-support.mjs';

const roots = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-native-read-home-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'temp'));
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    const resolved = fs.realpathSync(root);
    if (
      path.dirname(resolved) !== fs.realpathSync(os.tmpdir()) ||
      !path.basename(resolved).startsWith('aegis-native-read-home-') ||
      fs.lstatSync(root).isSymbolicLink()
    )
      throw new Error('native-home-cleanup-boundary');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

describe('native phase private Windows profile', () => {
  it('creates conventional Windows known folders within the owned home', () => {
    const root = fixture();
    const inherited = {
      APPDATA: 'C:\\personal\\Roaming',
      LOCALAPPDATA: 'C:\\personal\\Local',
      PATH: 'system-path',
      API_KEY: 'private-key',
      AUTH_TOKEN: 'private-token',
      NODE_OPTIONS: 'private-option',
    };
    const before = { ...inherited };
    const env = nativeReadEnvironment(root, inherited);
    expect(env.HOME).toBe(path.join(root, 'home'));
    expect(env.USERPROFILE).toBe(env.HOME);
    expect(env.APPDATA).toBe(path.join(env.HOME, 'AppData', 'Roaming'));
    expect(env.LOCALAPPDATA).toBe(path.join(env.HOME, 'AppData', 'Local'));
    for (const key of ['HOME', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP']) {
      expect(fs.statSync(env[key]).isDirectory()).toBe(true);
      expect(path.relative(root, env[key])).not.toMatch(/^\.\./);
    }
    expect(env.PATH).toBe('system-path');
    expect(env.API_KEY).toBeUndefined();
    expect(env.AUTH_TOKEN).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(inherited).toEqual(before);
  });
  it('refuses an existing home and leaves its contents intact', () => {
    const root = fixture();
    fs.mkdirSync(path.join(root, 'home'));
    const marker = path.join(root, 'home', 'keep');
    fs.writeFileSync(marker, 'existing bytes');
    expect(() => nativeReadEnvironment(root, {})).toThrow();
    expect(fs.readFileSync(marker, 'utf8')).toBe('existing bytes');
    expect(fs.readdirSync(path.join(root, 'home'))).toEqual(['keep']);
  });
});
