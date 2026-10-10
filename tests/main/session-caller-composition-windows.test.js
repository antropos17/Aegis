import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixture = path.join(project, 'tests/fixtures/session-caller-composition');
const session = path.join(project, 'sidecar/session');
let root, executable, productionExecutable, child;
const common = [
  ...[
    'CallerNative',
    'CallerIdentity',
    'CallerRegistration',
    'CallerAdmission',
    'CallerEndpointNative',
    'CallerEndpoint',
  ].map((name) => path.join(session, name + '.cs')),
  path.join(project, 'tests/fixtures/session-caller-launcher/LauncherObservation.cs'),
];
function compile(target, files, testDescriptors = true) {
  execFileSync(
    path.join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    [
      '/nologo',
      '/target:exe',
      '/platform:x64',
      ...(testDescriptors ? ['/define:ENROLLMENT_LEASE_TEST'] : []),
      '/optimize+',
      '/warnaserror+',
      '/out:' + target,
      ...files,
    ],
    { timeout: 30000, maxBuffer: 8192, windowsHide: true },
  );
  expect(fs.statSync(target).size).toBeLessThanOrEqual(256 * 1024);
}
describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'retained caller/enrollment composition (native objects; modeled protected descriptors)',
  () => {
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-caller-composition-'));
      executable = path.join(root, 'composition-fixture.exe');
      productionExecutable = path.join(root, 'production-composition-fixture.exe');
      child = path.join(root, 'fixed-child.exe');
      compile(child, [...common, path.join(fixture, 'CompositionChild.cs')]);
      const parentSources = [
        ...common,
        ...[
          'CallerLauncher',
          'CallerLauncherNative',
          'CallerSession',
          'EnrollmentNative',
          'EnrollmentInspection',
          'EnrollmentLease',
          'GuestJobNative',
        ].map((name) => path.join(session, name + '.cs')),
        path.join(project, 'sidecar/mcpjob/AppContainerExecutable.cs'),
        path.join(fixture, 'CompositionFiles.cs'),
        path.join(fixture, 'CompositionFixture.cs'),
      ];
      compile(executable, parentSources);
      compile(productionExecutable, parentSources, false);
    }, 35000);
    function invoke(mode, target = executable) {
      const directory = fs.mkdtempSync(path.join(root, mode + '-'));
      const installed = path.join(directory, 'installed'),
        control = path.join(directory, 'control');
      fs.mkdirSync(installed);
      fs.mkdirSync(control);
      fs.copyFileSync(child, path.join(installed, 'aegis-session.exe'));
      const result = spawnSync(target, [mode, installed, control], {
        timeout: 15000,
        maxBuffer: 8192,
        windowsHide: true,
      });
      fs.writeFileSync(
        path.join(directory, 'observation.json'),
        JSON.stringify(
          {
            status: result.status,
            stdout: result.stdout.toString(),
            stderr: result.stderr.toString(),
          },
          null,
          2,
        ),
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stderr.length).toBe(0);
      return JSON.parse(result.stdout.toString());
    }
    it('refuses release after an applied enrollment-root metadata change before any payload effect', () => {
      expect(invoke('metadata')).toMatchObject({
        protectedDescriptorsModeled: true,
        metadataApplied: true,
        leaseRefused: true,
        payload: false,
        stopped: true,
      });
    });
    it('holds native setup pins and suspension, admits the actual child, and revokes its returned context', () => {
      expect(invoke('positive')).toMatchObject({
        payloadBeforeRelease: false,
        pinsHeld: true,
        released: true,
        payload: true,
        accepted: true,
        contextRefused: true,
        stopped: true,
        descendantStopped: true,
        pinsReleased: true,
      });
    });
    it('cancels the suspended child and refuses later release without payload execution', () => {
      expect(invoke('cancel')).toMatchObject({
        payloadBeforeRelease: false,
        payload: false,
        releaseRefused: true,
        stopped: true,
        pinsReleased: true,
      });
    });
    it('a repeated release refuses while the correctly released child remains owned and live', () => {
      expect(invoke('duplicate')).toMatchObject({
        duplicateRefused: true,
        duplicateKeptLive: true,
        accepted: true,
        stopped: true,
        descendantStopped: true,
      });
    });
    it('a native endpoint closure prevents the initial release and stops the suspended child', () => {
      expect(invoke('closed-endpoint')).toMatchObject({
        endpointClosed: true,
        releaseRefused: true,
        payload: false,
        stopped: true,
        pinsReleased: true,
      });
    });
    it('a caller admission deadline terminates the released child and its descendant', () => {
      expect(invoke('admission-timeout')).toMatchObject({
        admissionRefused: true,
        accepted: false,
        released: true,
        stopped: true,
        descendantStopped: true,
      });
    });
    it('a premature admission refuses and cancels the still-suspended child', () => {
      expect(invoke('before-release-admission')).toMatchObject({
        admissionRefused: true,
        payload: false,
        stopped: true,
        pinsReleased: true,
      });
    });
    it('an applied enrollment metadata change invalidates the returned context and closes owned processes', () => {
      expect(invoke('context-metadata')).toMatchObject({
        metadataApplied: true,
        accepted: true,
        contextRefused: true,
        stopped: true,
        descendantStopped: true,
      });
    });
    it('context checks and owner revocation serialize without leaving a reusable context', () => {
      expect(invoke('concurrent')).toMatchObject({
        serialized: true,
        accepted: true,
        contextRefused: true,
        stopped: true,
        descendantStopped: true,
      });
    });
    it('the real protected-enrollment path refuses an ordinary root and cleans up before execution', () => {
      expect(invoke('strict-root', productionExecutable)).toMatchObject({
        protectedDescriptorsModeled: false,
        testInjectionAbsent: true,
        setupRefused: true,
        payload: false,
        stopped: true,
        pinsReleased: true,
      });
    });
    it('a missing native enrollment record aborts setup and confirms owned cleanup', () => {
      expect(invoke('missing-record')).toMatchObject({
        setupRefused: true,
        payload: false,
        stopped: true,
        pinsReleased: true,
      });
    });
  },
);
