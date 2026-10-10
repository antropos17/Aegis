import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceNames = [
  'EnrollmentNative',
  'EnrollmentInspection',
  'EnrollmentLease',
  'CallerNative',
  'CallerIdentity',
  'CallerRegistration',
  'CallerLauncherNative',
  'GuestJobNative',
];
let root, executable;

function compile(target, files) {
  execFileSync(
    path.join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    [
      '/nologo',
      '/target:exe',
      '/platform:x64',
      '/define:ENROLLMENT_LEASE_TEST',
      '/optimize+',
      '/warnaserror+',
      `/out:${target}`,
      ...files,
    ],
    { timeout: 30000, maxBuffer: 8192, windowsHide: true },
  );
  expect(fs.statSync(target).size).toBeLessThanOrEqual(256 * 1024);
}

describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'native enrollment ancestor and protected-root metadata roles',
  () => {
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-enrollment-ancestor-'));
      executable = path.join(root, 'ancestor-fixture.exe');
      compile(path.join(root, 'fixed-child.exe'), [
        path.join(project, 'tests/fixtures/session-enrollment-lease/EnrollmentLeaseChild.cs'),
      ]);
      compile(executable, [
        ...sourceNames.map((name) => path.join(project, `sidecar/session/${name}.cs`)),
        path.join(project, 'sidecar/mcpjob/AppContainerExecutable.cs'),
        path.join(
          project,
          'tests/fixtures/session-enrollment-ancestor/EnrollmentAncestorFixture.cs',
        ),
      ]);
    }, 35000);

    afterAll(() => {
      if (!root) return;
      expect(path.dirname(root)).toBe(fs.realpathSync(os.tmpdir()));
      expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    });

    function invoke(mode) {
      const result = spawnSync(executable, [mode, path.join(root, mode)], {
        timeout: 10000,
        maxBuffer: 8192,
        windowsHide: true,
      });
      expect(result.error).toBeUndefined();
      expect(result.stderr.toString()).toBe('');
      expect(result.status).toBe(0);
      return JSON.parse(result.stdout.toString());
    }

    it('keeps actual native snapshot and lease usable without a metadata mutation', () => {
      expect(invoke('clean')).toMatchObject({
        cleanControlPassed: true,
        acquisitionRefused: false,
        bindingsUnchanged: true,
        retainedSnapshotRefused: false,
        leaseRefused: false,
      });
    });

    it.each(['sibling', 'capture-sibling'])(
      'accepts actual %s creation and deletion with unchanged native ancestor bindings',
      (mode) => {
        expect(invoke(mode)).toMatchObject({
          protectedDescriptorsModeled: true,
          acquisitionRefused: false,
          mutationApplied: true,
          bindingsUnchanged: true,
          writeOrChangeTimestampChanged: true,
          retainedSnapshotRefused: false,
          leaseRefused: false,
          leasePassedAfterDelete: true,
        });
      },
    );

    it('permanently rejects actual child churn inside the protected enrollment root', () => {
      expect(invoke('root-child')).toMatchObject({
        acquisitionRefused: false,
        mutationApplied: true,
        bindingsUnchanged: true,
        writeOrChangeTimestampChanged: true,
        retainedSnapshotRefused: true,
        leaseRefused: true,
        stickyAfterDelete: true,
      });
    });

    it('refuses an ancestor role on an actual nondirectory without invalidating its strict lease', () => {
      expect(invoke('leaf-role')).toMatchObject({
        acquisitionRefused: false,
        mutationApplied: false,
        mutationBlocked: false,
        bindingsUnchanged: true,
        writeOrChangeTimestampChanged: false,
        retainedSnapshotRefused: true,
        leaseRefused: false,
      });
    });

    it.each([
      'ancestor-creation',
      'ancestor-attributes',
      'root-time',
      'root-attributes',
      'leaf-time',
      'leaf-attributes',
    ])('preserves the native %s refusal or the native pinning control', (mode) => {
      const result = invoke(mode);
      expect(result.acquisitionRefused).toBe(false);
      expect(result.mutationApplied || result.mutationBlocked).toBe(true);
      expect(result.retainedSnapshotRefused).toBe(result.mutationApplied);
      expect(result.leaseRefused).toBe(result.mutationApplied);
      if (result.mutationApplied) {
        const field = mode.endsWith('-attributes')
          ? 'attributeTagHex'
          : mode === 'ancestor-creation'
            ? 'creationTime'
            : 'lastWriteTime';
        expect(result.after[field]).not.toBe(result.before[field]);
      } else {
        expect(result.bindingsUnchanged).toBe(true);
        expect(result.after.fileIdInfoHex).toBe(result.before.fileIdInfoHex);
        expect(result.after.securitySha256).toBe(result.before.securitySha256);
        expect(result.after.attributeTagHex).toBe(result.before.attributeTagHex);
        expect(result.after.creationTime).toBe(result.before.creationTime);
        expect(result.after.lastWriteTime).toBe(result.before.lastWriteTime);
        expect(result.after.changeTime).toBe(result.before.changeTime);
      }
    });
  },
);
