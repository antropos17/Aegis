import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const project = fileURLToPath(new URL('../../', import.meta.url));
let root, executable;
describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'installed VM registration (compiled contract; synthetic authority/provider)',
  () => {
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-vm-registration-'));
      executable = path.join(root, 'registration.exe');
      const sources = ['sidecar/session', 'sidecar/owner'].flatMap((directory) =>
        fs
          .readdirSync(path.join(project, directory))
          .filter((name) => name.endsWith('.cs'))
          .map((name) => path.join(project, directory, name)),
      );
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
          '/define:INSTALLED_VM_TEST',
          '/reference:System.Management.dll',
          '/reference:System.Security.dll',
          '/main:InstalledVmRegistrationFixture',
          `/out:${executable}`,
          ...sources,
          path.join(project, 'sidecar/mcpjob/AppContainerExecutable.cs'),
          path.join(project, 'tests/fixtures/vm-lifecycle/InstalledVmRegistrationFixture.cs'),
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
    function invoke(mode, args = []) {
      const result = spawnSync(executable, [mode, ...args], {
        timeout: 4000,
        windowsHide: true,
        maxBuffer: 4096,
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stderr.length).toBe(0);
      return JSON.parse(result.stdout.toString());
    }
    it('binds the recorded VM and retains the read-only lease until closure', () => {
      expect(invoke('positive')).toMatchObject({
        acquired: true,
        inspected: true,
        constructed: 1,
        observations: 2,
        requests: 0,
        fileClosed: true,
        providerClosed: true,
      });
    });
    it.each([
      'stale-install',
      'stale-revision',
      'stale-epoch',
      'stale-policy',
      'stale-selection',
      'stale-selection-epoch',
      'revoked',
      'extra-field',
      'duplicate-field',
      'zero-vm',
      'overflow-revision',
      'oversized',
      'invalid-utf8',
      'unprotected',
      'reparse',
    ])('refuses %s before opening VM management', (mode) => {
      expect(invoke(mode)).toMatchObject({
        acquired: false,
        constructed: 0,
        requests: 0,
        fileClosed: true,
      });
    });
    it('refuses an unadmitted caller before even opening the registration', () => {
      expect(invoke('unadmitted')).toMatchObject({
        acquired: false,
        constructed: 0,
        opened: 0,
        requests: 0,
      });
    });
    it.each(['initial-replacement', 'initial-foreign'])(
      'closes the registration and provider on %s',
      (mode) => {
        expect(invoke(mode)).toMatchObject({
          acquired: false,
          requests: 0,
          fileClosed: true,
          providerClosed: true,
        });
      },
    );
    it.each(['lost-authority', 'replaced-vm', 'replaced-file', 'changed-bytes'])(
      'refuses %s before further observation and never revives that lease',
      (mode) => {
        expect(invoke(mode)).toMatchObject({
          acquired: true,
          inspected: false,
          requests: 0,
          refusedAgain: true,
          fileClosed: true,
          providerClosed: true,
        });
      },
    );
    it('discards an observation made during loss of installed authority', () => {
      expect(invoke('lost-after-observation')).toMatchObject({
        acquired: true,
        inspected: false,
        observations: 2,
        requests: 0,
        refusedAgain: true,
        fileClosed: true,
        providerClosed: true,
      });
    });
    it('rejects an actual ordinary-owned file without a native VM call', () => {
      const directory = path.join(root, 'ordinary');
      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, 'registered-vm.json'), '{}');
      expect(invoke('native-unprotected', [directory])).toMatchObject({
        acquired: false,
        constructed: 0,
        requests: 0,
      });
    });
  },
);
