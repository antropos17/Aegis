import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const project = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const api = require('../../src/main/owned-gui-profile');
const mainPath = require.resolve('../../src/main/main.js');
const flag = '--aegis-owned-gui-profile';
let root, profile;
const aliases = [];

beforeEach(() => {
  const parent = path.join(project, 'out/development');
  fs.mkdirSync(parent, { recursive: true });
  root = fs.mkdtempSync(path.join(parent, 'owned-gui-profile-'));
  profile = path.join(root, 'profile');
  fs.mkdirSync(profile);
  fs.writeFileSync(path.join(profile, 'retained-user-file'), 'persisted-profile-data');
});
afterEach(() => {
  for (const alias of aliases.splice(0)) {
    expect(fs.lstatSync(alias).isSymbolicLink()).toBe(true);
    fs.unlinkSync(alias);
  }
  expect(fs.readFileSync(path.join(profile, 'retained-user-file'), 'utf8')).toBe('persisted-profile-data');
  expect(path.dirname(fs.realpathSync(root))).toBe(fs.realpathSync(path.join(project, 'out/development')));
  expect(path.basename(root)).toMatch(/^owned-gui-profile-/);
  fs.rmSync(root, { recursive: true });
});

function appProbe(calls = []) {
  const paths = new Map();
  return {
    setPath: vi.fn((name, value) => { calls.push(`set:${name}`); paths.set(name, value); }),
    getPath: vi.fn((name) => { calls.push(`get:${name}`); return paths.get(name) || profile; }),
    getVersion: () => 'test',
    setName: () => {},
    dock: { setIcon: () => {} },
    disableHardwareAcceleration: () => {},
    on: () => {},
    whenReady: () => new Promise(() => {}),
    requestSingleInstanceLock: vi.fn(() => { calls.push('single-instance'); return true; }),
    quit: () => {},
  };
}

// Run the actual CommonJS entrypoint. Only Electron's host/lifecycle is modeled;
// its ready promise never resolves, so no sensors, services or GUI are launched.
function loadMain(argv, app, onCli = () => {}) {
  const previous = require.cache[mainPath], originalLoad = Module._load, originalArgv = process.argv;
  const electron = {
    app,
    BrowserWindow: class {},
    globalShortcut: { register: () => {}, unregisterAll: () => {} },
    shell: {}, ipcMain: { handle: () => {}, on: () => {} }, dialog: {},
    Notification: class {}, Tray: class {}, Menu: { buildFromTemplate: (value) => value },
    nativeImage: {}, safeStorage: { isEncryptionAvailable: () => false },
  };
  let electronLoads = 0;
  Module._load = function (request, parent) {
    if (request === 'electron') { electronLoads++; return electron; }
    if (request === './cli' && parent?.filename === mainPath) {
      return { handleCLI: (...args) => { onCli(...args); return new Promise(() => {}); } };
    }
    return originalLoad.apply(this, arguments);
  };
  process.argv = argv;
  delete require.cache[mainPath];
  try { require(mainPath); return electronLoads; }
  finally {
    process.argv = originalArgv; Module._load = originalLoad;
    delete require.cache[mainPath]; if (previous) require.cache[mainPath] = previous;
  }
}

describe('owned GUI profile storage selector (no enrollment authority)', () => {
  it('passes selected CLI arguments and captured owner bootstrap without exposing bootstrap secrets to descendants', () => {
    const keys = ['AEGIS_OWNER_PIPE', 'AEGIS_OWNER_SECRET', 'AEGIS_OWNER_PROFILE_ROOT'];
    const previous = keys.map((key) => process.env[key]);
    try {
      process.env.AEGIS_OWNER_PIPE = 'fixture-owner-pipe';
      process.env.AEGIS_OWNER_SECRET = 'fixture-owner-secret';
      process.env.AEGIS_OWNER_PROFILE_ROOT = profile;
      const app = appProbe();
      const cli = vi.fn(() => {
        expect(keys.map((key) => process.env[key])).toEqual([undefined, undefined, undefined]);
      });
      const args = ['--action-mcp-delete-review', 'fixture-policy'];
      expect(loadMain(['node', 'main.js', ...args], app, cli)).toBe(0);
      expect(cli).toHaveBeenCalledExactlyOnceWith(args, {
        ownerConsoleBootstrap: expect.objectContaining({
          pipe: 'fixture-owner-pipe', secret: 'fixture-owner-secret', profileRoot: profile,
        }),
      });
      expect(app.setPath).not.toHaveBeenCalled();
      expect(app.getPath).not.toHaveBeenCalled();
    } finally {
      keys.forEach((key, index) => {
        if (previous[index] === undefined) delete process.env[key];
        else process.env[key] = previous[index];
      });
    }
  });
  it('leaves ordinary startup arguments and application paths untouched when absent', () => {
    const app = appProbe();
    expect(api.configureOwnedGuiProfile(['main.js', '--help'], app)).toBe(false);
    expect(app.setPath).not.toHaveBeenCalled();
    expect(app.getPath).not.toHaveBeenCalled();
  });

  it('selects the exact existing profile for userData and sessionData without altering persisted bytes', () => {
    const calls = [], app = appProbe(calls);
    expect(api.configureOwnedGuiProfile([flag, profile], app)).toBe(true);
    expect(app.setPath.mock.calls).toEqual([['userData', profile], ['sessionData', profile]]);
    expect(calls).toEqual(['set:userData', 'set:sessionData']);
  });

  it.each([
    ['missing path', () => [flag]],
    ['relative path', () => [flag, 'relative/profile']],
    ['null path', () => [flag, null]],
    ['wrong case', () => [flag.toUpperCase(), profile]],
    ['prefix lookalike', () => [`${flag}-extra`, profile]],
    ['equals form', () => [`${flag}=${profile}`]],
    ['duplicate selector', () => [flag, profile, flag, profile]],
    ['CLI ambiguity', () => [flag, profile, '--help']],
    ['Chromium profile ambiguity', () => [flag, profile, '--user-data-dir=other']],
    ['unpackaged entry argument', () => ['main.js', flag, profile]],
    ['NUL', () => [flag, `${profile}\0private`]],
    ['parent alias', () => [flag, `${profile}${path.sep}..${path.sep}profile`]],
    ['missing directory', () => [flag, path.join(root, 'missing')]],
    ['regular file', () => [flag, path.join(profile, 'retained-user-file')]],
  ])('refuses %s before changing paths', (_name, args) => {
    const app = appProbe();
    expect(() => api.configureOwnedGuiProfile(args(), app)).toThrow(/^owned-gui-profile-refused$/);
    expect(app.setPath).not.toHaveBeenCalled();
    expect(app.getPath).not.toHaveBeenCalled();
  });

  it('refuses an actual linked profile without following it into configured storage', () => {
    const alias = path.join(root, 'linked-profile');
    fs.symlinkSync(profile, alias, process.platform === 'win32' ? 'junction' : 'dir');
    aliases.push(alias);
    const app = appProbe();
    expect(() => api.configureOwnedGuiProfile([flag, alias], app)).toThrow(/^owned-gui-profile-refused$/);
    expect(app.setPath).not.toHaveBeenCalled();
  });

  it('projects a fixed refusal when Electron rejects a path without exposing private input', () => {
    const app = appProbe();
    app.setPath.mockImplementation(() => { throw Error(`PRIVATE ${profile}`); });
    let failure;
    try { api.configureOwnedGuiProfile([flag, profile], app); } catch (value) { failure = value; }
    expect(failure?.message).toBe('owned-gui-profile-refused');
    expect(failure?.cause).toBeUndefined();
  });

  it('configures the actual main entrypoint before the first settings-path read and singleton decision', () => {
    const calls = [], app = appProbe(calls);
    loadMain(['owned.exe', flag, profile], app);
    expect(calls.slice(0, 3)).toEqual(['set:userData', 'set:sessionData', 'get:userData']);
    expect(calls.indexOf('single-instance')).toBeGreaterThan(calls.indexOf('get:userData'));
    expect(app.requestSingleInstanceLock).toHaveBeenCalledOnce();
  });

  it('rejects malformed owned startup before settings, singleton or CLI handling', () => {
    const calls = [], app = appProbe(calls), cli = vi.fn();
    expect(() => loadMain(['owned.exe', flag, profile, '--help'], app, cli)).toThrow(/^owned-gui-profile-refused$/);
    expect(calls).toEqual([]);
    expect(cli).not.toHaveBeenCalled();
  });

  it('preserves the existing ordinary CLI early return without importing Electron', () => {
    const app = appProbe(), cli = vi.fn();
    expect(loadMain(['node', 'main.js', '--help'], app, cli)).toBe(0);
    expect(cli).toHaveBeenCalledOnce();
    expect(app.setPath).not.toHaveBeenCalled();
    expect(app.requestSingleInstanceLock).not.toHaveBeenCalled();
  });
});
