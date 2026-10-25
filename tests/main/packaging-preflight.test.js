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
    expect(beforeBuild({ platform: { name: 'windows' }, arch: 'x64' })).toBe(true);
    expect(build).toHaveBeenCalledTimes(3);
    const [executable, args, options] = build.mock.calls[0];
    expect(executable).toBe(process.execPath);
    expect(args).toContain('build');
    expect(args.slice(-2)).toEqual(['--mode', 'production']);
    expect(options.cwd).toBe(projectRoot);
    expect(options.env.NODE_ENV).toBe('production');
    expect(build.mock.calls[1][1]).toEqual([path.join(projectRoot, 'scripts/build-sidecar.js')]);
    expect(build.mock.calls[2][1]).toEqual([
      path.join(projectRoot, 'scripts/build-etw-sidecar.js'),
    ]);
  });

  it('refuses Windows packaging when the self-contained read helper cannot publish', () => {
    const build = vi.spyOn(childProcess, 'execFileSync').mockReturnValue(Buffer.alloc(0));
    build
      .mockImplementationOnce(() => Buffer.alloc(0))
      .mockImplementationOnce(() => Buffer.alloc(0))
      .mockImplementationOnce(() => {
        throw new Error('ETW publish failed');
      });
    expect(() => require(hookPath)({ platform: { name: 'windows' }, arch: 'x64' })).toThrow(
      'ETW publish failed',
    );
  });

  it.each(['ia32', 'arm64', 'armv7l', 'universal', undefined])(
    'refuses Windows %s packaging before building x64-only native helpers',
    (arch) => {
      const build = vi.spyOn(childProcess, 'execFileSync').mockReturnValue(Buffer.alloc(0));
      expect(() => require(hookPath)({ platform: { name: 'windows' }, arch })).toThrow(
        'Windows packaging requires x64',
      );
      expect(build).not.toHaveBeenCalled();
    },
  );

  it.each(['linux', 'mac'])(
    'preserves the %s renderer build without Windows helpers for arm64',
    (name) => {
      const build = vi.spyOn(childProcess, 'execFileSync').mockReturnValue(Buffer.alloc(0));
      expect(require(hookPath)({ platform: { name }, arch: 'arm64' })).toBe(true);
      expect(build).toHaveBeenCalledTimes(1);
      expect(build.mock.calls[0][1]).toContain('build');
    },
  );
});
