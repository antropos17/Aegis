import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const childProcess = require('node:child_process');
const hookPath = require.resolve('../../scripts/electron-builder-before-build.js');
const projectRoot = path.resolve(path.dirname(hookPath), '..');

afterEach(() => {
  vi.restoreAllMocks();
  delete require.cache[hookPath];
});

describe('packaging production preflight', () => {
  it('stops every packaging target when its fresh production renderer cannot build', () => {
    const failure = new Error('renderer build failed');
    const build = vi.spyOn(childProcess, 'execFileSync').mockImplementation(() => {
      throw failure;
    });
    const beforeBuild = require(hookPath);
    expect(() => beforeBuild({ platform: { name: 'linux' } })).toThrow(failure);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('builds the desktop renderer before Windows helpers, independently of caller cwd', () => {
    const build = vi.spyOn(childProcess, 'execFileSync').mockReturnValue(Buffer.alloc(0));
    const beforeBuild = require(hookPath);
    expect(beforeBuild({ platform: { name: 'windows' } })).toBe(true);
    expect(build).toHaveBeenCalledTimes(2);
    const [executable, args, options] = build.mock.calls[0];
    expect(executable).toBe(process.execPath);
    expect(args).toContain('build');
    expect(args.slice(-2)).toEqual(['--mode', 'production']);
    expect(options.cwd).toBe(projectRoot);
    expect(options.env.NODE_ENV).toBe('production');
    expect(build.mock.calls[1][1]).toEqual([path.join(projectRoot, 'scripts/build-sidecar.js')]);
  });
});
