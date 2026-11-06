import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
const childProcess = require('node:child_process');
const fs = require('node:fs');
const hookPath = require.resolve('../../scripts/electron-builder-before-build.js');
const projectRoot = path.resolve(path.dirname(hookPath), '..');
const { buildLinuxSensor, verifyElf } = require('../../scripts/build-linux-sensor.js');

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
    expect(build).toHaveBeenCalledTimes(4);
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
    expect(build.mock.calls[3][1]).toEqual([
      path.join(projectRoot, 'scripts/build-hook-review-assets.cjs'),
      '--replace',
    ]);
  });

  it('stages the owner console through the ordinary Windows sidecar build', () => {
    const manifest = require('../../package.json');
    const sidecar = manifest.build.win.extraResources.find(
      (entry) => entry.from === 'build/sidecar',
    );
    expect(sidecar).toEqual({ from: 'build/sidecar', to: 'sidecar', filter: ['**/*'] });
    const buildSource = fs.readFileSync(path.join(projectRoot, 'scripts/build-sidecar.js'), 'utf8');
    expect(buildSource).toContain("'aegis-owner-console.exe'");
    expect(buildSource).toContain("'sidecar', 'owner-console', name");
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

  it('refuses Windows packaging when portable review assets cannot be prepared', () => {
    const build = vi.spyOn(childProcess, 'execFileSync').mockReturnValue(Buffer.alloc(0));
    build
      .mockImplementationOnce(() => Buffer.alloc(0))
      .mockImplementationOnce(() => Buffer.alloc(0))
      .mockImplementationOnce(() => Buffer.alloc(0))
      .mockImplementationOnce(() => {
        throw new Error('review assets unavailable');
      });
    expect(() => require(hookPath)({ platform: { name: 'windows' }, arch: 'x64' })).toThrow(
      'review assets unavailable',
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

  it('preserves the macOS renderer build without Windows helpers', () => {
    const build = vi.spyOn(childProcess, 'execFileSync').mockReturnValue(Buffer.alloc(0));
    expect(require(hookPath)({ platform: { name: 'mac' }, arch: 'arm64' })).toBe(true);
    expect(build).toHaveBeenCalledTimes(1);
  });
});

describe('Linux sensor package asset', () => {
  function elf(machine) {
    const header = Buffer.alloc(64);
    Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]).copy(header);
    header.writeUInt16LE(3, 16);
    header.writeUInt16LE(machine, 18);
    header.writeUInt32LE(1, 20);
    return header;
  }

  function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-linux-sensor-test-'));
    fs.mkdirSync(path.join(root, 'sensors'));
    fs.writeFileSync(
      path.join(root, 'sensors', 'rust-toolchain.toml'),
      '[toolchain]\nchannel = "1.99.1"\n',
    );
    return root;
  }

  function executableModeFixture() {
    const lstat = fs.lstatSync.bind(fs);
    vi.spyOn(fs, 'lstatSync').mockImplementation((name, ...args) => {
      const stat = lstat(name, ...args);
      stat.mode |= 0o111;
      return stat;
    });
  }

  it.each([
    ['x64', 'x86_64-unknown-linux-gnu', 62],
    ['arm64', 'aarch64-unknown-linux-gnu', 183],
  ])('stages a checked %s ELF using the pinned toolchain and lock', (arch, triple, machine) => {
    const root = fixture();
    // Windows cannot set Unix executable bits. This supplies the modeled Linux mode only.
    executableModeFixture();
    const run = vi.fn((command, args, options) => {
      expect(command).toBe('rustup');
      if (args[2] === 'rustc') return `release: 1.99.1\nhost: ${triple}\n`;
      expect(args).toEqual([
        'run',
        '1.99.1',
        'cargo',
        'build',
        '--release',
        '--locked',
        '-p',
        'aegis-sensor-linux',
        '--target',
        triple,
      ]);
      const dir = path.join(options.env.CARGO_TARGET_DIR, triple, 'release');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'aegis-sensor-linux'), elf(machine));
      return '';
    });
    try {
      const output = buildLinuxSensor({ arch, platform: 'linux', hostArch: arch, root, run });
      expect(output).toBe(path.join(root, 'build', 'linux-sensor', arch, 'aegis-sensor-linux'));
      expect(fs.readFileSync(output)).toEqual(elf(machine));
      expect(run).toHaveBeenCalledTimes(2);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects cross-host and mismatched targets before invoking a build', () => {
    const run = vi.fn();
    expect(() =>
      buildLinuxSensor({ arch: 'x64', platform: 'win32', hostArch: 'x64', run }),
    ).toThrow('matching Linux');
    expect(() =>
      buildLinuxSensor({ arch: 'arm64', platform: 'linux', hostArch: 'x64', run }),
    ).toThrow('matching Linux');
    expect(() =>
      buildLinuxSensor({ arch: 'ia32', platform: 'linux', hostArch: 'ia32', run }),
    ).toThrow('matching Linux');
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects a mismatched Rust host before running cargo', () => {
    const root = fixture();
    const run = vi.fn(() => 'release: 1.99.1\nhost: aarch64-unknown-linux-gnu\n');
    try {
      expect(() =>
        buildLinuxSensor({ arch: 'x64', platform: 'linux', hostArch: 'x64', root, run }),
      ).toThrow('Rust host or toolchain does not match');
      expect(run).toHaveBeenCalledTimes(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails on missing compiler output without replacing the prior staged asset', () => {
    const root = fixture();
    const staged = path.join(root, 'build', 'linux-sensor', 'x64', 'aegis-sensor-linux');
    fs.mkdirSync(path.dirname(staged), { recursive: true });
    fs.writeFileSync(staged, 'previous');
    const run = vi.fn((command, args) =>
      args[2] === 'rustc' ? 'release: 1.99.1\nhost: x86_64-unknown-linux-gnu\n' : '',
    );
    try {
      expect(() =>
        buildLinuxSensor({ arch: 'x64', platform: 'linux', hostArch: 'x64', root, run }),
      ).toThrow();
      expect(fs.readFileSync(staged, 'utf8')).toBe('previous');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects non-executable and wrong-architecture output', () => {
    const root = fixture();
    const binary = path.join(root, 'binary');
    try {
      fs.writeFileSync(binary, elf(183));
      const lstat = fs.lstatSync.bind(fs);
      const spy = vi.spyOn(fs, 'lstatSync').mockImplementation((name, ...args) => {
        const stat = lstat(name, ...args);
        stat.mode |= 0o111;
        return stat;
      });
      expect(() => verifyElf(binary, 'x64')).toThrow('invalid ELF');
      spy.mockRestore();
      fs.chmodSync(binary, 0o644);
      expect(() => verifyElf(binary, 'arm64')).toThrow('not an executable');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['x64', 1, 62],
    ['arm64', 3, 183],
  ])(
    'builds and verifies the copied %s sensor even when beforeBuild is skipped',
    (arch, archId, machine) => {
      const root = fixture();
      const context = {
        electronPlatformName: 'linux',
        arch: archId,
        appOutDir: path.join(root, 'unpacked'),
        packager: { projectDir: root },
      };
      const sensor = require('../../scripts/build-linux-sensor.js');
      const hooks = require('../../scripts/linux-sensor-pack-hooks.js');
      const config = require('../../package.json').build;
      executableModeFixture();
      const build = vi
        .spyOn(sensor, 'buildLinuxSensor')
        .mockImplementation(({ root: dir, arch: target }) => {
          const staged = path.join(dir, 'build', 'linux-sensor', target, 'aegis-sensor-linux');
          fs.mkdirSync(path.dirname(staged), { recursive: true });
          fs.writeFileSync(staged, elf(machine));
          return staged;
        });
      try {
        expect(config.beforePack).toBe('scripts/linux-sensor-before-pack.js');
        expect(config.afterPack).toBe('scripts/linux-sensor-after-pack.js');
        // electron-builder invokes beforePack independently of npmRebuild/beforeBuild.
        hooks.beforePack(context);
        expect(build).toHaveBeenCalledExactlyOnceWith({ arch, root });
        const copied = path.join(context.appOutDir, 'resources', 'sensor', 'aegis-sensor-linux');
        fs.mkdirSync(path.dirname(copied), { recursive: true });
        fs.copyFileSync(build.mock.results[0].value, copied);
        expect(() => hooks.afterPack(context)).not.toThrow();
        expect(() => hooks.afterPack(context)).toThrow('build receipt is missing');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it('rejects missing or different resources and ignores other platforms', () => {
    const root = fixture();
    const context = {
      electronPlatformName: 'linux',
      arch: 1,
      appOutDir: path.join(root, 'out'),
      packager: { projectDir: root },
    };
    const sensor = require('../../scripts/build-linux-sensor.js');
    const hooks = require('../../scripts/linux-sensor-pack-hooks.js');
    executableModeFixture();
    const build = vi.spyOn(sensor, 'buildLinuxSensor').mockImplementation(() => {
      const staged = path.join(root, 'staged');
      fs.writeFileSync(staged, elf(62));
      return staged;
    });
    try {
      hooks.beforePack({ ...context, electronPlatformName: 'win32' });
      hooks.afterPack({ ...context, electronPlatformName: 'darwin' });
      expect(build).not.toHaveBeenCalled();
      hooks.beforePack(context);
      expect(() => hooks.afterPack(context)).toThrow();
      hooks.beforePack(context);
      const copied = path.join(context.appOutDir, 'resources', 'sensor', 'aegis-sensor-linux');
      fs.mkdirSync(path.dirname(copied), { recursive: true });
      const different = elf(62);
      different[63] = 1;
      fs.writeFileSync(copied, different);
      expect(() => hooks.afterPack(context)).toThrow('does not match');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
