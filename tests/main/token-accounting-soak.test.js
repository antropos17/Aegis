import { describe, it, expect } from 'vitest';
import { mkdir, mkdtemp, writeFile, lstat, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  oracle,
  checkSample,
  cleanup,
  stopOwned,
  checkAncestors,
  checkWorkload,
  createDeadline,
} from '../../scripts/qualification/token-accounting-soak-support.mjs';
import { packagedStep } from '../../scripts/qualification/token-accounting-soak-runtime.mjs';
import { createLaunchEnvironment } from '../../scripts/qualification/token-accounting-soak-env.mjs';

describe('token soak safety and independent oracle (Node fixtures, no packaged evidence)', () => {
  it('isolates child credentials, runtime flags and executable search paths', () => {
    const parent = {
      sYsTeMrOoT: 'X:\\writable;X:\\injected',
      PATH: 'C:\\untrusted-tools',
      COMSPEC: 'C:\\untrusted-tools\\cmd.exe',
      ANTHROPIC_API_KEY: 'fixture-secret',
      AWS_SECRET_ACCESS_KEY: 'fixture-cloud-secret',
      UNKNOWN_FUTURE_CREDENTIAL: 'fixture-secret',
      NODE_OPTIONS: '--require C:\\untrusted.js',
      ELECTRON_RUN_AS_NODE: '1',
      USERPROFILE: 'C:\\real-home',
    };
    const directories = { home: 'X:\\home', profile: 'X:\\profile', temp: 'X:\\temp' };
    const env = createLaunchEnvironment(parent, directories);
    expect(env).toEqual({
      SystemRoot: 'C:\\Windows',
      WINDIR: 'C:\\Windows',
      COMSPEC: 'C:\\Windows\\System32\\cmd.exe',
      PATH: 'C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\Wbem;C:\\Windows\\System32\\WindowsPowerShell\\v1.0',
      PATHEXT: '.COM;.EXE;.BAT;.CMD',
      USERPROFILE: directories.home,
      HOME: directories.home,
      APPDATA: directories.profile,
      LOCALAPPDATA: directories.profile,
      TEMP: directories.temp,
      TMP: directories.temp,
    });
    expect(parent.ANTHROPIC_API_KEY).toBe('fixture-secret');
    expect(createLaunchEnvironment({}, directories).SystemRoot).toBe('C:\\Windows');
  });

  it.skipIf(process.platform !== 'win32')(
    'resolves system PowerShell in the child environment',
    async () => {
      const env = createLaunchEnvironment(
        { SystemRoot: 'X:\\untrusted;X:\\injected', PATH: 'X:\\untrusted' },
        { home: os.tmpdir(), profile: os.tmpdir(), temp: os.tmpdir() },
      );
      const { stdout } = await promisify(execFile)(
        'C:\\Windows\\System32\\where.exe',
        ['powershell.exe'],
        { env, timeout: 10_000 },
      );
      expect(stdout.trim().toLowerCase()).toBe(
        'c:\\windows\\system32\\windowspowershell\\v1.0\\powershell.exe',
      );
    },
  );

  it('rejects development launch and mismatched numeric totals', async () => {
    await expect(packagedStep({ app: { isPackaged: false } }, {})).rejects.toThrow(
      'packaged-required',
    );
    const sample = {
      ...oracle(2),
      isPackaged: true,
      collection: 'ready',
      rowCount: 2,
      ledgerBytes: 4096,
      ledgerLimitBytes: 128 * 1024 ** 2,
    };
    expect(() => checkSample(sample, 2)).not.toThrow();
    expect(() => checkSample({ ...sample, inputTokens: 300 }, 2)).toThrow('input-divergence');
    expect(() => checkSample({ ...sample, costUsd: NaN }, 2)).toThrow('cost-nonfinite');
    expect(() => checkSample({ ...sample, collection: 'storage-paused' }, 2)).toThrow(
      'collection-unavailable',
    );
    expect(() => checkSample({ ...sample, ledgerBytes: 129 * 1024 ** 2 }, 2)).toThrow(
      'ledger-size-limit',
    );
  });

  it('requires both accounted identities and a minimum workload', () => {
    const receipt = {
      uniqueMessages: 4,
      messagesPerIdentity: [2, 2],
      identitiesObserved: [true, true],
      restarts: 2,
    };
    expect(() => checkWorkload(receipt)).not.toThrow();
    expect(() => checkWorkload({ ...receipt, uniqueMessages: 1 })).toThrow(
      'minimum-workload-missing',
    );
    expect(() => checkWorkload({ ...receipt, messagesPerIdentity: [4, 0] })).toThrow(
      'two-identity-workload-missing',
    );
    expect(() => checkWorkload({ ...receipt, identitiesObserved: [true, false] })).toThrow(
      'two-identity-accounting-missing',
    );
  });

  it('rejects guarded work on deadline and allows awaited owned-process cleanup', async () => {
    const deadline = createDeadline(1);
    const child = { pid: 600004, exitCode: null, signalCode: null };
    const owner = {
      app: {
        process: () => child,
        close: async () => {
          child.exitCode = 0;
        },
      },
    };
    try {
      await expect(deadline.guard(new Promise(() => {}))).rejects.toThrow('run-timeout');
      expect(deadline.cancelled).toBe(true);
      await stopOwned(
        owner,
        async () => {
          throw Error('unexpected-kill');
        },
        1,
      );
      expect(owner.app).toBeUndefined();
      await expect(deadline.guard(Promise.resolve())).rejects.toThrow('run-timeout');
    } finally {
      deadline.close();
    }
  });

  it('preserves a sibling receipt and refuses an unrelated cleanup target', async () => {
    const base = process.platform === 'win32' ? 'X:\\tmp' : os.tmpdir();
    const root = await mkdtemp(path.join(base, 'token-soak-unit-'));
    const disposable = path.join(root, 'disposable');
    try {
      await mkdir(disposable);
      await writeFile(path.join(disposable, 'fixture'), 'numeric fixture');
      await writeFile(path.join(root, 'receipt.json'), '{}');
      await expect(cleanup(root, root)).rejects.toThrow();
      await cleanup(root, disposable);
      expect((await lstat(path.join(root, 'receipt.json'))).isFile()).toBe(true);
      await expect(lstat(disposable)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects cleanup through a junction without deleting its destination', async () => {
    const base = process.platform === 'win32' ? 'X:\\tmp' : os.tmpdir();
    const root = await mkdtemp(path.join(base, 'token-soak-link-unit-'));
    const target = path.join(root, 'preserved');
    const disposable = path.join(root, 'disposable');
    try {
      await mkdir(target);
      await writeFile(path.join(target, 'sentinel'), 'keep');
      await symlink(target, disposable, process.platform === 'win32' ? 'junction' : 'dir');
      await expect(checkAncestors(path.join(disposable, 'nested'))).rejects.toThrow(
        'ancestor-reparse-refused',
      );
      await expect(cleanup(root, disposable)).rejects.toThrow('reparse-refused');
      expect((await lstat(path.join(target, 'sentinel'))).isFile()).toBe(true);
    } finally {
      await rm(disposable, { force: true });
      await rm(root, { recursive: true, force: true });
    }
  });

  it('retains the owned handle when graceful close and forced kill fail', async () => {
    const child = { pid: 600003, exitCode: null, signalCode: null };
    const app = {
      process: () => child,
      close: async () => {
        throw Error('close-failed');
      },
    };
    const owner = { app };
    await expect(
      stopOwned(
        owner,
        async () => {
          throw Error('kill-failed');
        },
        1,
      ),
    ).rejects.toThrow('kill-failed');
    expect(owner.app).toBe(app);
    expect(owner.stopping).toBeUndefined();
    await expect(stopOwned(owner, async () => {}, 1)).rejects.toThrow('process-exit-unconfirmed');
    expect(owner.app).toBe(app);
    await stopOwned(
      owner,
      async () => {
        child.exitCode = 1;
      },
      1,
    );
    expect(owner.app).toBeUndefined();
  });

  it('reads fixture duplicates once and restores/replays an actual SQLite ledger', async () => {
    const base = process.platform === 'win32' ? 'X:\\tmp' : os.tmpdir();
    const root = await mkdtemp(path.join(base, 'token-soak-ledger-unit-'));
    const home = path.join(root, 'home');
    const profile = path.join(root, 'profile');
    const startTime = Date.now();
    const cwd = 'X:\\fixture\\soak-600001';
    const sessionId = 'fixture-600001';
    const project = path.join(home, '.claude', 'projects', cwd.replace(/[/\\:.]/g, '-'));
    const config = {
      home,
      profile,
      ledger: path.join(profile, 'soak.sqlite'),
      procs: [{ pid: 600001, startTime, instanceId: `600001:${startTime}` }],
    };
    const previousHome = process.env.HOME;
    const previousProfile = process.env.USERPROFILE;
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    const app = {
      isPackaged: true,
      getPath: () => profile,
      getVersion: () => 'fixture',
      getAppPath: () => path.resolve(import.meta.dirname, '../..'),
    };
    try {
      await mkdir(profile, { recursive: true });
      await mkdir(path.join(home, '.claude', 'sessions'), { recursive: true });
      await mkdir(project, { recursive: true });
      await writeFile(
        path.join(home, '.claude', 'sessions', '600001.json'),
        JSON.stringify({ cwd, sessionId, startedAt: startTime }),
      );
      const line =
        JSON.stringify({
          type: 'assistant',
          message: {
            id: 'fixture-message',
            model: 'claude-sonnet-4-6',
            usage: { input_tokens: 100, output_tokens: 20 },
          },
        }) + '\n';
      await writeFile(path.join(project, `${sessionId}.jsonl`), line + line);
      const initial = await packagedStep({ app }, config);
      checkSample(initial, 1);
      expect(initial.collectionReason).toBeNull();
      expect(initial.collectionRetryAt).toBeNull();
      expect(initial.ledgerBytes).toBeGreaterThan(0);
      expect(initial.identities).toEqual([{ slot: 0, inputTokens: 100, outputTokens: 20 }]);
      globalThis.__tokenSoak.adapter._resetForTest();
      delete globalThis.__tokenSoak;
      checkSample(await packagedStep({ app }, config), 1);
      checkSample(await packagedStep({ app }, config), 1);
    } finally {
      globalThis.__tokenSoak?.adapter._resetForTest();
      delete globalThis.__tokenSoak;
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousProfile;
      await rm(root, { recursive: true, force: true });
    }
  });
});
