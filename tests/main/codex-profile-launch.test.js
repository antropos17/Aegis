import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  rmdirSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { createHash } = require('node:crypto');
const { parse } = require('smol-toml');
const { hookCommand } = require('../../src/main/codex-profile-model');
const {
  encodeLaunch,
  validatedOverride,
  terminalScript,
  overrideFor,
  handleLaunchOverride,
} = require('../../src/main/codex-profile-launch');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const windowsIsAbsolute = path.win32.isAbsolute;

afterEach(() => vi.restoreAllMocks());

function fixture(hostIsAbsolute = path.isAbsolute) {
  const executable = 'C:/Program Files/AEGIS & Monitor/AEGIS.exe';
  const appPath = 'C:/Program Files/AEGIS & Monitor/resources/app.asar';
  const powershell = 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
  const policyPath = 'C:/Project/policy.json';
  const profilePath = 'C:/AEGIS/codex-hook-profile/hooks.json';
  const cwd = 'C:/Project';
  // This fixture models a Windows-only launch on every CI host. Preserve the
  // real schema validator, but give its one synthetic cwd Windows semantics.
  vi.spyOn(path, 'isAbsolute').mockImplementation((value) =>
    value === cwd ? windowsIsAbsolute(value) : hostIsAbsolute(value),
  );
  const codexPath = 'C:/Tools/codex.exe';
  const codexIdentity = 'fixture-identity';
  const codexSha256 = 'c'.repeat(64);
  const verifyCodexExecutable = vi.fn(async () => ({ codexPath, codexIdentity, codexSha256 }));
  const nativePath = 'C:\\AEGIS\\codex-hook-profile\\native-' + 'a'.repeat(32);
  const templateCommand = hookCommand(executable, appPath, policyPath, powershell, undefined, nativePath);
  const profile = Buffer.from(
    JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: '^Bash$', hooks: [{ type: 'command', command: templateCommand, timeout: 5 }] },
        ],
      },
    }),
  );
  const policy = Buffer.from(
    JSON.stringify({ schemaVersion: 1, cwd, defaultDecision: 'deny', rules: [] }),
  );
  const ids = [
    '1234567890abcdef:1234567890abcdef1234567890abcdef',
    'fedcba0987654321:fedcba0987654321fedcba0987654321',
  ];
  const command = hookCommand(executable, appPath, policyPath, powershell, hash(policy), nativePath);
  const token = encodeLaunch({
    profilePath,
    profileIdentity: ids[0],
    profileSha256: hash(profile),
    policyPath,
    policyIdentity: ids[1],
    policySha256: hash(policy),
    cwd,
    codexPath,
    codexIdentity,
    codexSha256,
  });
  const files = [profile, policy];
  let calls = 0;
  const readers = [];
  const makeReadIO = vi.fn(async (input) => {
    const index = calls++;
    const reader = {
      input,
      closed: false,
      reads: 0,
      readTarget: vi.fn(async () => ({ identity: ids[index], bytes: Buffer.from(files[index]) })),
      close: vi.fn(async () => {
        reader.closed = true;
      }),
      status: () => ({
        admission: reader.closed ? 'closed' : 'open',
        exit: reader.closed ? 'confirmed' : 'unknown',
      }),
    };
    readers.push(reader);
    return reader;
  });
  return {
    token,
    ids,
    files,
    readers,
    makeReadIO,
    command,
    options: {
      verifyNativeStorage: vi.fn(async () => 'native-storage-identity'),
      executable,
      appPath,
      powershell,
      cwd,
      assets: {},
      makeReadIO,
      verifyCodexExecutable,
    },
  };
}

it('validates the Windows fixture when the host uses POSIX path semantics', async () => {
  expect(path.posix.isAbsolute('C:/Project')).toBe(false);
  const f = fixture(path.posix.isAbsolute);
  expect((await validatedOverride(f.token, f.options)).codexPath).toBe('C:/Tools/codex.exe');
  expect(path.isAbsolute('/unrelated')).toBe(true);
  expect(path.isAbsolute('relative')).toBe(false);
  const { validActionPolicy } = require('../../src/main/action-policy');
  expect(
    validActionPolicy({ schemaVersion: 1, cwd: 'relative', defaultDecision: 'deny', rules: [] }),
  ).toBe(false);
});

it('revalidates both native identities and exact bytes before emitting one inline hook override', async () => {
  const f = fixture();
  const result = await validatedOverride(f.token, f.options);
  expect(parse(result.override)).toEqual({
    hooks: {
      PreToolUse: [
        { matcher: '^Bash$', hooks: [{ type: 'command', command: f.command, timeout: 5 }] },
      ],
    },
  });
  expect(result.override).not.toMatch(/model|sandbox|approval|CODEX_HOME/);
  expect(result.codexPath).toBe('C:/Tools/codex.exe');
  expect(f.makeReadIO.mock.calls[0][0]).toMatchObject({
    ownedProfile: true,
    targetPath: 'C:\\AEGIS\\codex-hook-profile\\hooks.json',
  });
  expect(f.makeReadIO.mock.calls[1][0]).toMatchObject({
    selectedPolicy: true,
    targetPath: 'C:\\Project\\policy.json',
  });
  expect(f.readers.map((reader) => reader.readTarget.mock.calls.length)).toEqual([2, 2]);
  expect(f.readers.every((reader) => reader.closed)).toBe(true);
});

it.each(['identity', 'bytes', 'cwd', 'reread', 'release', 'executable'])(
  'refuses launch on %s drift or uncertain cleanup',
  async (kind) => {
    const f = fixture();
    if (kind === 'identity') f.ids[1] = 'aaaaaaaaaaaaaaaa:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    if (kind === 'bytes') f.files[1] = Buffer.from('{}');
    if (kind === 'cwd') f.options.cwd = 'C:/Other';
    if (kind === 'executable')
      f.options.verifyCodexExecutable.mockResolvedValueOnce({
        codexPath: 'C:/Tools/codex.exe',
        codexIdentity: 'changed',
        codexSha256: 'c'.repeat(64),
      });
    const original = f.makeReadIO.getMockImplementation();
    if (kind === 'reread' || kind === 'release')
      f.makeReadIO.mockImplementation(async (input) => {
        const io = await original(input);
        if (kind === 'reread' && input.ownedProfile)
          io.readTarget
            .mockImplementationOnce(async () => ({
              identity: f.ids[0],
              bytes: Buffer.from(f.files[0]),
            }))
            .mockImplementationOnce(async () => ({
              identity: f.ids[0],
              bytes: Buffer.from('changed'),
            }));
        if (kind === 'release' && input.selectedPolicy)
          io.status = () => ({ admission: 'closed', exit: 'unknown' });
        return io;
      });
    await expect(validatedOverride(f.token, f.options)).rejects.toThrow('launch-unavailable');
    expect(f.readers.every((reader) => reader.closed)).toBe(true);
  },
);

it('rejects malformed and unbound tokens without opening any target', async () => {
  const f = fixture();
  await expect(validatedOverride('PRIVATE_INPUT', f.options)).rejects.toThrow('launch-unavailable');
  expect(f.makeReadIO).not.toHaveBeenCalled();
  expect(() => encodeLaunch({ profilePath: 'C:/other/hooks.json' })).toThrow('launch-unavailable');
});

it('emits only the validated fixed override through the bounded packaged CLI entry', async () => {
  const f = fixture();
  const output = [];
  const runtime = {
    platform: 'win32',
    versions: { electron: '45.0.0' },
    resourcesPath: 'C:/Program Files/AEGIS & Monitor/resources',
    execPath: f.options.executable,
    env: { SystemRoot: 'C:/Windows' },
    cwd: () => f.options.cwd,
  };
  expect(
    await handleLaunchOverride(
      ['--codex-launch-override', f.token],
      (value) => output.push(value),
      {
        runtime,
        loadAssets: async () => ({}),
        makeReadIO: f.makeReadIO,
        verifyCodexExecutable: f.options.verifyCodexExecutable,
        verifyNativeStorage: f.options.verifyNativeStorage,
      },
    ),
  ).toBe(0);
  expect(output).toEqual([
    JSON.stringify({ override: overrideFor(f.command), codexPath: 'C:/Tools/codex.exe' }),
  ]);
  expect(
    await handleLaunchOverride(
      ['--codex-launch-override', f.token, 'extra'],
      (value) => output.push(value),
      { runtime },
    ),
  ).toBe(2);
  expect(output).toHaveLength(1);
});

it('refuses a legacy profile without a separate native directory even when its digest matches', async () => {
  const f = fixture();
  f.files[0] = Buffer.from(JSON.stringify({ hooks: { PreToolUse: [{ matcher: '^Bash$', hooks: [{
    type: 'command', timeout: 5,
    command: hookCommand(f.options.executable, f.options.appPath, 'C:/Project/policy.json', f.options.powershell),
  }] }] } }));
  const binding = JSON.parse(Buffer.from(f.token, 'base64').toString());
  binding.profileSha256 = hash(f.files[0]);
  await expect(validatedOverride(encodeLaunch(binding), f.options)).rejects.toThrow('launch-unavailable');
  expect(f.options.verifyCodexExecutable).not.toHaveBeenCalled();
});

it('refuses unavailable or redirected native storage before admitting Codex launch', async () => {
  const f = fixture();
  f.options.verifyNativeStorage.mockRejectedValue(Error('PRIVATE_NATIVE_PATH'));
  await expect(validatedOverride(f.token, f.options)).rejects.toThrow('launch-unavailable');
  expect(f.options.verifyCodexExecutable).not.toHaveBeenCalled();
});

it.skipIf(process.platform !== 'win32').each([true, false])(
  'runs only the fixed shell override after validator success=%s',
  (accept) => {
    const root = mkdtempSync(path.join(tmpdir(), 'aegis-codex-terminal-'));
    const validator = path.join(root, 'validator.js');
    const stub = path.join(root, 'stub.cs');
    const command = path.join(root, 'codex.exe');
    const marker = path.join(root, 'result.txt');
    try {
      const override = overrideFor(fixture().command);
      writeFileSync(
        validator,
        accept
          ? `process.stdout.write(JSON.stringify({override:${JSON.stringify(override)},codexPath:${JSON.stringify(command)}}))`
          : 'process.exit(2)',
        { flag: 'wx' },
      );
      writeFileSync(
        stub,
        'class Stub { static void Main(string[] args) { System.IO.File.WriteAllLines(System.Environment.GetEnvironmentVariable("AEGIS_TEST_OUTPUT"), args); } }',
        { flag: 'wx' },
      );
      const compiler = path.join(
        process.env.SystemRoot,
        'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
      );
      expect(
        spawnSync(compiler, ['/nologo', `/out:${command}`, stub], { encoding: 'utf8' }).status,
      ).toBe(0);
      const script = terminalScript('YWJj', process.execPath, validator);
      const shell = path.join(
        process.env.SystemRoot,
        'System32/WindowsPowerShell/v1.0/powershell.exe',
      );
      const result = spawnSync(
        shell,
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64'),
        ],
        {
          cwd: root,
          env: {
            ...process.env,
            PATH: `${root};${path.join(process.env.SystemRoot, 'System32')}`,
            AEGIS_TEST_OUTPUT: marker,
          },
          encoding: 'utf8',
          timeout: 15000,
        },
      );
      expect(result.status).toBe(accept ? 0 : 1);
      if (accept)
        expect(readFileSync(marker, 'utf8').trim().split(/\r?\n/)).toEqual(['--config', override]);
      else expect(existsSync(marker)).toBe(false);
    } finally {
      for (const file of [validator, stub, command, marker]) if (existsSync(file)) unlinkSync(file);
      expect(path.dirname(root)).toBe(path.resolve(tmpdir()));
      expect(path.basename(root)).toMatch(/^aegis-codex-terminal-/);
      rmdirSync(root);
    }
  },
);
