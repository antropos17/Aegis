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
          path.join(project, 'tests/fixtures/vm-lifecycle/VmStorageFixture.cs'),
          path.join(project, 'tests/fixtures/vm-lifecycle/VmDiskImageFixture.cs'),
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
      expect(result.status, result.stderr.toString().slice(0, 1024)).toBe(0);
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
    it('checks and closes an unconfigured record without constructing VM management', () => {
      expect(invoke('unconfigured')).toMatchObject({
        acquired: false,
        configured: false,
        constructed: 0,
        requests: 0,
        fileClosed: true,
      });
    });
    it('checks a version-two disk binding without granting state dispatch', () => {
      expect(invoke('storage-positive')).toMatchObject({
        acquired: true,
        inspected: true,
        requests: 0,
        fileClosed: true,
        providerClosed: true,
      });
    });
    it('accepts version-three private storage for the original VM without state dispatch', () => {
      expect(invoke('protected-positive')).toMatchObject({
        acquired: true,
        inspected: true,
        requests: 0,
        fileClosed: true,
        providerClosed: true,
      });
    });
    it.each([
      'protected-world',
      'protected-foreign-vm',
      'protected-owner',
      'protected-directory',
      'protected-missing-sid',
      'protected-malformed',
      'protected-parent-disk',
    ])('refuses protected registration when ownership or ACL provenance fails: %s', (mode) => {
      expect(invoke(mode)).toMatchObject({ acquired: false, requests: 0, fileClosed: true });
    });
    it('latches protection loss even when the original ACL is subsequently restored', () => {
      expect(invoke('protected-changed-acl')).toMatchObject({
        acquired: true,
        inspected: false,
        refusedAgain: true,
        requests: 0,
        fileClosed: true,
        providerClosed: true,
      });
    });
    it('latches loss of standalone disk observation even after it recovers', () => {
      expect(invoke('protected-lost-disk-observation')).toMatchObject({
        acquired: true,
        inspected: false,
        refusedAgain: true,
        requests: 0,
        fileClosed: true,
        providerClosed: true,
      });
    });
    it('prepares expensive storage observation before the two-second caller admission', () => {
      expect(invoke('prepared-slow')).toEqual({
        unboundRefused: true,
        accepted: true,
        requests: 0,
      });
    });
    it.each(['storage-initial-replacement', 'storage-initial-metadata', 'storage-malformed'])(
      'refuses a stale or malformed disk binding: %s',
      (mode) => {
        expect(invoke(mode)).toMatchObject({ acquired: false, requests: 0, fileClosed: true });
      },
    );
    it.each(['storage-changed-file', 'storage-reconnected', 'storage-outage', 'storage-running'])(
      'permanently refuses %s after registration admission',
      (mode) => {
        expect(invoke(mode)).toMatchObject({
          acquired: true,
          inspected: false,
          refusedAgain: true,
          requests: 0,
          fileClosed: true,
          providerClosed: true,
        });
      },
    );
    it('reads the actual installer stage records and rejects unknown runtime leaves', () => {
      const scratch = path.join(root, 'producer');
      fs.mkdirSync(scratch);
      const record = invoke('storage-record');
      const produced = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          path.join(
            project,
            'tests/fixtures/protected-installation/vm-record-producer-fixture.ps1',
          ),
          scratch,
          record.vmId,
          record.identitySha256,
          record.storageSha256,
        ],
        { timeout: 15000, windowsHide: true, maxBuffer: 8192 },
      );
      expect(produced.error).toBeUndefined();
      expect(produced.status, produced.stderr.toString().slice(0, 1024)).toBe(0);
      const stages = JSON.parse(produced.stdout.toString()).stages;
      expect(stages).toHaveLength(4);
      expect(stages.filter((stage) => stage.storageBound)).toHaveLength(2);
      expect(stages.filter((stage) => stage.privateStorage)).toHaveLength(1);
      for (const stage of stages) {
        expect(stage).toMatchObject({ initialLeaves: 8, runtimeLeaves: 9, unknownRefused: true });
        expect(invoke('from-producer', [stage.path])).toMatchObject({
          acquired: stage.configured,
          constructed: stage.configured ? 1 : 0,
          requests: 0,
          fileClosed: true,
        });
      }
    });
    it.each([
      'stale-install',
      'stale-revision',
      'stale-unconfigured',
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
      expect(invoke('native-unprotected', [directory])).toMatchObject({
        nativeProtected: false,
        acquired: false,
        constructed: 0,
        requests: 0,
      });
    });
  },
);
