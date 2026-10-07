import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const project = fileURLToPath(new URL('../../', import.meta.url));
let root, executable;
describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'compiled VM lifecycle contracts (synthetic provider; native path parser)',
  () => {
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-owned-vm-'));
      executable = path.join(root, 'lifecycle.exe');
      execFileSync(
        path.join(
          process.env.WINDIR || 'C:/Windows',
          'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
        ),
        [
          '/nologo',
          '/target:exe',
          '/platform:x64',
          '/optimize+',
          '/warnaserror+',
          '/reference:System.Management.dll',
          `/out:${executable}`,
          ...['OwnedVmLifecycle.cs', 'VmManagementNative.cs'].map((file) =>
            path.join(project, 'sidecar/session', file),
          ),
          path.join(project, 'tests/fixtures/vm-lifecycle/OwnedVmLifecycleFixture.cs'),
        ],
        { timeout: 30000, windowsHide: true, stdio: 'pipe' },
      );
    }, 35000);
    afterAll(() => {
      if (!root) return;
      expect(path.dirname(root)).toBe(fs.realpathSync(os.tmpdir()));
      expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    });
    function invoke(mode) {
      const value = spawnSync(executable, [mode], {
        timeout: 4000,
        windowsHide: true,
        maxBuffer: 4096,
      });
      expect(value.error).toBeUndefined();
      expect(value.status).toBe(0);
      expect(value.stderr.length).toBe(0);
      return JSON.parse(value.stdout.toString());
    }
    it.each(['synchronous', 'asynchronous', 'null-running-error'])(
      'confirms exact Running and Off after %s settlement',
      (mode) => {
        expect(invoke(mode)).toMatchObject({
          started: true,
          stopped: true,
          off: true,
          pending: false,
          repeat: false,
          requests: 2,
        });
      },
    );
    it.each([
      'unknown-method',
      'missing-result',
      'unknown-code',
      'missing-job',
      'sync-extra-job',
      'lost-job',
      'foreign-job',
      'pending',
      'killed',
      'exception',
      'unknown-state',
      'null-terminal-error',
    ])('retains immutable pending %s and never repeats or stops', (mode) => {
      expect(invoke(mode)).toMatchObject({
        started: false,
        stopped: false,
        off: false,
        pending: true,
        recordStable: true,
        repeat: false,
        requests: 1,
      });
    });
    it.each(['failed-running', 'error-running'])(
      'cleans a Running VM only after observed %s terminal failure',
      (mode) => {
        expect(invoke(mode)).toMatchObject({
          started: false,
          stopped: true,
          off: true,
          pending: false,
          repeat: false,
          requests: 2,
        });
      },
    );
    it('refuses a successful job whose actual VM state is different', () => {
      expect(invoke('wrong-final')).toMatchObject({
        started: false,
        stopped: false,
        off: false,
        pending: false,
        repeat: false,
        requests: 1,
      });
    });
    it('does not grant closure after an observation outage', () => {
      expect(invoke('lost-observation')).toMatchObject({
        started: false,
        stopped: false,
        off: false,
        repeat: false,
        requests: 1,
      });
    });
    it.each(['replaced', 'foreign-vm'])('does not invoke the provider for %s ownership', (mode) => {
      expect(invoke(mode)).toMatchObject({ started: false, off: false, requests: 0 });
    });
    it('retains Off after a documented provider rejection without claiming start', () => {
      expect(invoke('rejected')).toMatchObject({
        started: false,
        off: true,
        pending: false,
        repeat: false,
        requests: 1,
      });
    });
    it.each(['remote', 'namespace', 'class', 'relative'])(
      'rejects provider path with wrong %s',
      (mode) => {
        expect(invoke('path-' + mode).accepted).toBe(false);
      },
    );
    it('accepts a fixed local provider job instance path', () => {
      expect(invoke('path-local').accepted).toBe(true);
    });
    it.each(['16', '32'])('requires a present correctly typed native UInt%s field', (bits) => {
      expect(invoke('field-' + bits + '-valid').accepted).toBe(true);
      for (const kind of ['null', 'string', 'int', 'bool'])
        expect(invoke('field-' + bits + '-' + kind).accepted).toBe(false);
    });
  },
);
