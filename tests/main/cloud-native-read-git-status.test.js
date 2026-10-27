import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  portableGitCommand,
  portableGitEnvironment,
  reconstructPortableGit,
  discoverGitLayout,
} from '../../tools/development/cloud-native-read-git.mjs';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const folders = [];
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const scratch = () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-git-status-'));
  folders.push(folder);
  return folder;
};
afterEach(() => {
  vi.unstubAllEnvs();
  for (const folder of folders.splice(0)) {
    expect(path.dirname(folder)).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(folder).startsWith('aegis-git-status-')).toBe(true);
    expect(fs.realpathSync(folder)).toBe(path.resolve(folder));
    fs.rmSync(folder, { recursive: true });
  }
});

function reconstructionFixture(mode = 'clean') {
  vi.stubEnv('GITHUB_ACTIONS', 'true');
  vi.stubEnv('RUNNER_ENVIRONMENT', 'github-hosted-hyperv-guest');
  const root = scratch();
  const bundle = path.join(root, 'bundle');
  const output = path.join(root, 'output');
  const executable = path.join(bundle, 'runtime/git/bin/git.exe');
  const copiedDriver = path.join(bundle, 'runtime/cloud-native-read-git.mjs');
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.mkdirSync(path.join(bundle, 'gitstore/objects'), { recursive: true });
  fs.writeFileSync(executable, 'owned pure-executor fixture; never executable');
  fs.copyFileSync(path.join(source, 'tools/development/cloud-native-read-git.mjs'), copiedDriver);
  const context = {
    sourceSha: 'a'.repeat(40),
    sourceTree: 'b'.repeat(40),
    nodeVersion: process.versions.node,
    coreAutoCrlf: 'false',
    coreEol: 'lf',
    portableGit: { executableSha256: sha(executable), version: 'git version 2.56.0.windows.2' },
  };
  const trace = { stage: 'input-validation', commands: 0, commandKind: null };
  const calls = [];
  const execute = (file, args, options) => {
    const kind = trace.commandKind;
    calls.push({ file, args, options, kind });
    if (kind === 'version') return context.portableGit.version;
    if (kind === 'exec-path') return options.env.GIT_EXEC_PATH;
    if (kind === 'init-bare')
      fs.mkdirSync(path.join(output, 'repository.git'), { recursive: true });
    if (kind === 'worktree-add') {
      const driver = path.join(output, 'source/tools/development/cloud-native-read-git.mjs');
      fs.mkdirSync(path.dirname(driver), { recursive: true });
      fs.copyFileSync(copiedDriver, driver);
      if (mode === 'driver') fs.writeFileSync(driver, 'foreign driver bytes');
    }
    if (kind === 'head') return mode === 'head' ? 'c'.repeat(40) : context.sourceSha;
    if (kind === 'tree') return mode === 'tree' ? 'c'.repeat(40) : context.sourceTree;
    if (kind === 'status') {
      if (mode === 'cold' && options.timeout < 25000) {
        throw Object.assign(new Error('PRIVATE_STATUS_CANARY'), {
          code: 'ETIMEDOUT',
          status: null,
          signal: 'SIGTERM',
        });
      }
      if (mode === 'timeout' || mode === 'nonzero' || mode === 'overflow') {
        throw Object.assign(new Error('PRIVATE_STATUS_CANARY'), {
          code: mode === 'timeout' ? 'ETIMEDOUT' : mode === 'overflow' ? 'ENOBUFS' : null,
          signal: mode === 'timeout' ? 'SIGTERM' : null,
          status: mode === 'nonzero' ? 128 : null,
          stdout: 'PRIVATE_STATUS_CANARY',
          stderr: 'PRIVATE_STATUS_CANARY',
        });
      }
      if (mode === 'tracked') return ' M tracked.txt\n';
      if (mode === 'staged') return 'M  tracked.txt\n';
      if (mode === 'untracked') return '?? new.txt\n';
    }
    if (kind === 'git-dir') return path.join(output, 'repository.git/worktrees/source');
    if (kind === 'common-dir')
      return mode === 'isolation'
        ? path.join(output, 'repository.git/worktrees/source')
        : path.join(output, 'repository.git');
    return '';
  };
  return {
    calls,
    trace,
    executable,
    context,
    run: () => reconstructPortableGit({ bundle, output, context }, { trace, execute }),
  };
}

describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'portable Git status policy',
  () => {
    it('lets only status use a bounded cold allowance without optional index writes', () => {
      vi.stubEnv('GIT_OPTIONAL_LOCKS', '1');
      vi.stubEnv('GIT_CONFIG_GLOBAL', 'PRIVATE_STATUS_CANARY');
      vi.stubEnv('GIT_ASKPASS', 'PRIVATE_STATUS_CANARY');
      vi.stubEnv('HOME', 'PRIVATE_STATUS_CANARY');
      const fixture = reconstructionFixture('cold');
      expect(fixture.run()).toMatchObject({
        status: 'PASS',
        commands: 12,
        clean: true,
        isolated: true,
        driverSourceMatched: true,
      });
      expect(fixture.calls.map((call) => call.kind)).toEqual([
        'version',
        'exec-path',
        'init-bare',
        'config-autocrlf',
        'config-eol',
        'update-ref',
        'worktree-add',
        'head',
        'tree',
        'status',
        'git-dir',
        'common-dir',
      ]);
      for (const call of fixture.calls) {
        expect(call.file).toBe(fixture.executable);
        expect(call.options).toMatchObject({
          timeout: call.kind === 'status' ? 60000 : 20000,
          maxBuffer: 16384,
          windowsHide: true,
          encoding: 'utf8',
          stdio: 'pipe',
        });
        expect(call.options.env.GIT_OPTIONAL_LOCKS).toBe('0');
        expect(call.options.env.GIT_CONFIG_NOSYSTEM).toBe('1');
        expect(call.options.env.HOME).toBeUndefined();
        expect(call.options.env.GIT_ASKPASS).toBeUndefined();
        expect(call.options.env.GIT_CONFIG_GLOBAL).not.toContain('PRIVATE_STATUS_CANARY');
      }
      expect(fixture.calls[9].args).toEqual([
        '-C',
        expect.any(String),
        'status',
        '--porcelain',
        '--untracked-files=normal',
      ]);
    });

    it.each(['tracked', 'staged', 'untracked'])(
      'continues to reject %s worktree output',
      (mode) => {
        const fixture = reconstructionFixture(mode);
        expect(fixture.run).toThrow('portable-git-worktree-dirty');
        expect(fixture.trace).toMatchObject({ stage: 'status', commands: 10 });
        expect(fixture.calls).toHaveLength(10);
      },
    );

    it.each(['timeout', 'nonzero', 'overflow'])(
      'refuses status %s once without private streams or later acceptance',
      (mode) => {
        const fixture = reconstructionFixture(mode);
        let error;
        try {
          fixture.run();
        } catch (caught) {
          error = caught;
        }
        expect(error?.portableGitDiagnostic).toMatchObject({
          status: 'FAIL',
          stage: 'status',
          commandKind: 'status',
          commandIndex: 10,
          commandsAttempted: 10,
          code: 'portable-git-command-refused',
          timedOut: mode === 'timeout',
        });
        expect(Object.keys(error.portableGitDiagnostic).sort()).toEqual(
          [
            'status',
            'code',
            'stage',
            'commandsAttempted',
            'commandIndex',
            'commandKind',
            'processStatus',
            'signal',
            'errorCode',
            'timedOut',
          ].sort(),
        );
        expect(JSON.stringify(error)).not.toContain('PRIVATE_STATUS_CANARY');
        expect(fixture.calls).toHaveLength(10);
      },
    );

    it.each([
      ['head', 'portable-git-head-mismatch'],
      ['tree', 'portable-git-tree-mismatch'],
      ['isolation', 'portable-git-worktree-not-isolated'],
      ['driver', 'portable-git-driver-source-mismatch'],
    ])('still refuses %s mismatch', (mode, message) => {
      expect(reconstructionFixture(mode).run).toThrow(message);
    });

    it('keeps real tracked, staged and untracked changes visible while leaving a stale clean index untouched', () => {
      const root = scratch();
      const repository = path.join(root, 'repository');
      const empty = path.join(root, 'empty-template');
      fs.mkdirSync(empty);
      const env = portableGitEnvironment(root, path.join(root, 'temp'));
      const where = path.join(process.env.SystemRoot, 'System32/where.exe');
      const launcher = execFileSync(where, ['git.exe'], {
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: 16384,
        windowsHide: true,
      })
        .trim()
        .split(/\r?\n/)[0];
      const discoveryEnv = { ...env };
      delete discoveryEnv.GIT_EXEC_PATH;
      const execPath = execFileSync(launcher, ['--exec-path'], {
        env: discoveryEnv,
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: 16384,
        windowsHide: true,
      }).trim();
      const executable = discoverGitLayout(launcher, execPath).native;
      const git = (...args) =>
        execFileSync(
          executable,
          [
            '-c',
            'core.hooksPath=' + empty,
            '-c',
            'maintenance.auto=false',
            '-c',
            'gc.auto=0',
            '-c',
            'core.autocrlf=false',
            '-c',
            'commit.gpgsign=false',
            ...args,
          ],
          {
            env,
            encoding: 'utf8',
            timeout: 5000,
            maxBuffer: 16384,
            windowsHide: true,
            stdio: 'pipe',
          },
        );
      git('init', '--quiet', '--template=' + empty, repository);
      const tracked = path.join(repository, 'tracked.txt');
      fs.writeFileSync(tracked, 'committed\n');
      git('-C', repository, 'add', 'tracked.txt');
      git(
        '-C',
        repository,
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@invalid',
        'commit',
        '--no-gpg-sign',
        '--quiet',
        '-m',
        'owned fixture',
      );
      const index = path.join(repository, '.git/index');
      const indexHash = sha(index);
      const indexTime = fs.statSync(index).mtimeMs;
      const future = new Date(Date.now() + 2000);
      fs.utimesSync(tracked, future, future);
      const status = () =>
        portableGitCommand(
          executable,
          ['-C', repository, 'status', '--porcelain', '--untracked-files=normal'],
          {
            env,
            encoding: 'utf8',
            timeout: 2000,
            maxBuffer: 16384,
            windowsHide: true,
            stdio: 'pipe',
          },
          { stage: 'status', commandKind: 'status', commands: 0 },
        );
      expect(env.GIT_OPTIONAL_LOCKS).toBe('0');
      expect(status()).toBe('');
      expect(sha(index)).toBe(indexHash);
      expect(fs.statSync(index).mtimeMs).toBe(indexTime);
      fs.writeFileSync(tracked, 'working change with another length\n');
      expect(status()).toMatch(/^M tracked\.txt$/);
      fs.writeFileSync(tracked, 'committed\n');
      git('-C', repository, 'add', 'tracked.txt');
      fs.writeFileSync(tracked, 'staged change\n');
      git('-C', repository, 'add', 'tracked.txt');
      expect(status()).toMatch(/^M {2}tracked\.txt$/);
      fs.writeFileSync(tracked, 'committed\n');
      git('-C', repository, 'add', 'tracked.txt');
      fs.writeFileSync(path.join(repository, 'new.txt'), 'untracked\n');
      expect(status()).toBe('?? new.txt');
    }, 60000);
  },
);
