import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixture = path.join(project, 'tests/fixtures/session-enrollment-lease');
let root, executable, child;

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
  expect(fs.statSync(target).size).toBeLessThanOrEqual(65536);
}
function parentSources(lease = path.join(project, 'sidecar/session/EnrollmentLease.cs')) {
  return [
    ...[
      'EnrollmentNative',
      'EnrollmentInspection',
      'EnrollmentLease',
      'CallerNative',
      'CallerIdentity',
      'CallerRegistration',
      'CallerLauncherNative',
      'GuestJobNative',
    ].map((name) =>
      name === 'EnrollmentLease' ? lease : path.join(project, 'sidecar/session', `${name}.cs`),
    ),
    path.join(project, 'sidecar/mcpjob/AppContainerExecutable.cs'),
    path.join(project, 'tests/fixtures/session-caller-launcher/LauncherObservation.cs'),
    path.join(fixture, 'EnrollmentLeaseFixture.cs'),
  ];
}

describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'retained enrollment lease (native same-principal and labeled descriptor models)',
  () => {
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-enrollment-lease-'));
      executable = path.join(root, 'lease-fixture.exe');
      child = path.join(root, 'fixed-child.exe');
      compile(child, [path.join(fixture, 'EnrollmentLeaseChild.cs')]);
      compile(executable, parentSources());
    }, 35000);

    function spawnFixture(mode, target = executable) {
      const directory = fs.mkdtempSync(path.join(root, `${mode}-`));
      fs.copyFileSync(child, path.join(directory, 'aegis-session.exe'));
      const result = spawnSync(target, [mode, directory], {
        timeout: 12000,
        maxBuffer: 8192,
        windowsHide: true,
      });
      fs.writeFileSync(
        path.join(root, `${path.basename(directory)}-observation.json`),
        JSON.stringify({
          status: result.status,
          stdout: result.stdout.toString(),
          stderr: result.stderr.toString(),
        }),
      );
      return result;
    }
    function invoke(mode) {
      const result = spawnFixture(mode);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stderr.length).toBe(0);
      return JSON.parse(result.stdout.toString());
    }

    it('keeps the actual enrollment record pinned against competing write until lease disposal', () => {
      expect(invoke('retained-pins')).toMatchObject({
        nativeFiles: true,
        protectedDescriptorsModeled: true,
        recordWriteRefused: true,
      });
    });
    it('retains duplicated actual process/token/Job handles after original handles close', () => {
      expect(invoke('original-handles-closed')).toMatchObject({
        originalsClosed: true,
        recordPinsReleased: true,
      });
    });
    it.each(['strict-root', 'wrong-image', 'wrong-job', 'partial-open'])(
      'refuses %s during acquisition and closes partial native pins',
      (mode) => {
        expect(invoke(mode)).toMatchObject({
          invalidated: true,
          recordPinsReleased: true,
          launchAllowed: false,
        });
      },
    );
    it.each([
      'owner-exit',
      'token-change',
      'token-change-restore',
      'thread-impersonation',
      'revoke',
      'dispose',
      'concurrent-revoke',
    ])('permanently invalidates %s without reacquisition', (mode) => {
      expect(invoke(mode)).toMatchObject({ invalidated: true, recordPinsReleased: true });
    });
    it.each([
      'root-identity',
      'root-volume',
      'root-path',
      'root-kind',
      'root-reparse',
      'root-security',
      'ancestor-identity',
      'ancestor-security',
      'record-identity',
      'record-epoch',
      'record-revision',
      'record-status',
      'image-identity',
      'image-bytes',
      'query-failure',
    ])('refuses modeled changed %s over actual native held objects and never revives', (mode) => {
      expect(invoke(mode)).toMatchObject({ invalidated: true, recordPinsReleased: true });
    });
    it('preserves cleanup uncertainty on repeated disposal after an injected close refusal', () => {
      expect(invoke('close-failure')).toMatchObject({ cleanupUnknown: true, invalidated: true });
    });
    it('rejects serialization of the live lease and preserves its current native observation', () => {
      expect(invoke('serialization')).toMatchObject({
        recordWriteRefused: true,
        recordPinsReleased: true,
      });
    });
    it('detects removal of both current-primary-token fences in a disposable source mutant', () => {
      const source = fs.readFileSync(
        path.join(project, 'sidecar/session/EnrollmentLease.cs'),
        'utf8',
      );
      const selected = 'owner.CheckCurrent();';
      expect(source.split(selected)).toHaveLength(3);
      const mutant = path.join(root, 'token-check-mutant.cs');
      const target = path.join(root, 'token-check-mutant.exe');
      fs.writeFileSync(mutant, source.replaceAll(selected, '/* omitted token observation */'));
      compile(target, parentSources(mutant));
      const result = spawnFixture('token-change', target);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr.toString()).toBe('enrollment-lease-fixture-refused\r\n');
    }, 35000);
  },
);
