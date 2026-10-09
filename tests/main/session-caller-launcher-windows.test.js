import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixture = path.join(project, 'tests/fixtures/session-caller-launcher');
const sources = [
  'CallerNative',
  'CallerIdentity',
  'CallerRegistration',
  'CallerLauncher',
  'CallerLauncherNative',
];
let root, executable, child, wrong;

function compile(target, files) {
  execFileSync(
    path.join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    [
      '/nologo',
      '/target:exe',
      '/platform:x64',
      '/optimize+',
      '/warnaserror+',
      `/out:${target}`,
      ...files,
    ],
    { timeout: 30000, maxBuffer: 8192, windowsHide: true },
  );
}

function compileParent(target, native) {
  compile(target, [
    ...sources.map((name) =>
      native && name === 'CallerLauncherNative'
        ? native
        : path.join(project, 'sidecar/session', `${name}.cs`),
    ),
    path.join(project, 'sidecar/mcpjob/AppContainerExecutable.cs'),
    path.join(fixture, 'LauncherObservation.cs'),
    path.join(fixture, 'CallerLauncherFixture.cs'),
  ]);
}

describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'native suspended retained caller launcher (same-principal fixture)',
  () => {
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-caller-launcher-'));
      executable = path.join(root, 'launcher-fixture.exe');
      child = path.join(root, 'marker-child.exe');
      wrong = path.join(root, 'injected-second-image.exe');
      const childSources = [
        path.join(fixture, 'LauncherObservation.cs'),
        path.join(fixture, 'LauncherChild.cs'),
      ];
      compile(child, childSources);
      compile(wrong, childSources);
      compileParent(executable);
    }, 35000);

    function invoke(mode, target = executable) {
      const markers = fs.mkdtempSync(path.join(root, `${mode}-`));
      const result = spawnSync(target, [mode, child, wrong, markers], {
        timeout: 18000,
        maxBuffer: 8192,
        windowsHide: true,
      });
      fs.writeFileSync(
        path.join(markers, 'observation.json'),
        JSON.stringify({
          mode,
          executable: target,
          selectedImage: child,
          injectedImage: mode === 'wrong-image' ? wrong : null,
          status: result.status,
          signal: result.signal,
          error: result.error?.message ?? null,
          stdout: result.stdout.toString(),
          stderr: result.stderr.toString(),
        }),
      );
      return result;
    }
    function success(mode) {
      const result = invoke(mode);
      expect(result.error).toBeUndefined();
      expect(result.stderr.toString()).toBe('');
      expect(result.status).toBe(0);
      return JSON.parse(result.stdout.toString());
    }

    it('waits for the visible native PID marker writer to close before reading the complete actual PID', () => {
      expect(success('pid-marker-race')).toEqual({
        completedBeforeClose: false,
        readerError: null,
        readerErrorCode: null,
        observedPidMatches: true,
      });
    });

    it('executes the actual selected image only after retained registration and closes root and descendant on disposal', () => {
      expect(success('positive')).toMatchObject({
        refused: false,
        created: true,
        imageMatchesSelected: true,
        rootExited: true,
        descendantExited: true,
        revoked: true,
        pinned: true,
        imagePinsReleased: true,
        access: { matched: false, wrote: false },
      });
    });
    it('holds the registered native child without a payload marker through an intervening setup phase and releases it afterward', () => {
      expect(success('deferred-release')).toMatchObject({
        markerAtSetup: false,
        markerAfterRelease: true,
        imagePinnedAtSetup: true,
        rootExited: true,
        descendantExited: true,
      });
    });
    it.each([
      'deferred-cancel',
      'deferred-revoke',
      'deferred-impersonated',
      'deferred-extra-suspend',
    ])('terminates %s before any payload effect and makes later release terminal', (mode) => {
      expect(success(mode)).toMatchObject({
        markerAtSetup: false,
        markerAfterRelease: false,
        rootExited: true,
        releaseRejected: true,
        laterReleaseRejected: true,
        threadTokenObserved: mode === 'deferred-impersonated',
        imagePinsReleased: true,
      });
    });
    it('refuses a duplicate release while preserving the live owned child until disposal', () => {
      expect(success('deferred-double')).toMatchObject({
        markerAtSetup: false,
        markerAfterRelease: true,
        duplicateRejected: true,
        rootExited: true,
        descendantExited: true,
      });
    });
    it('refuses actual post-create registration failure with no marker and independent retained root exit', () => {
      expect(success('registration-refusal')).toMatchObject({
        refused: true,
        created: true,
        rootExited: true,
        access: null,
        imagePinsReleased: true,
      });
    });
    it('refuses an injected actual second executable using independently observed OS image identity', () => {
      expect(success('wrong-image')).toMatchObject({
        refused: true,
        created: true,
        imageMatchesSelected: false,
        imageMatchesInjected: true,
        rootExited: true,
        access: null,
      });
    });
    it('refuses changed expected hash before creating a process', () => {
      expect(success('wrong-hash')).toMatchObject({ refused: true, created: false, access: null });
    });
    it('revokes a naturally exited registered root while retaining its descendant until owned disposal', () => {
      expect(success('natural')).toMatchObject({
        natural: true,
        revoked: true,
        rootExited: true,
        descendantExited: true,
      });
    });
    it('observes kill-on-close root and descendant exit when the owning launcher process dies', () => {
      expect(success('owner-death')).toEqual({
        ownerExited: true,
        rootExited: true,
        descendantExited: true,
      });
    });
    it('detects actual outside-file access when native handle inheritance is enabled in a disposable mutant', () => {
      const native = fs.readFileSync(
        path.join(project, 'sidecar/session/CallerLauncherNative.cs'),
        'utf8',
      );
      const selected = 'IntPtr.Zero, IntPtr.Zero, input != null, 0x00000004';
      expect(native.split(selected)).toHaveLength(2);
      const mutated = path.join(root, 'inherit-mutant.cs');
      const target = path.join(root, 'inherit-mutant.exe');
      fs.writeFileSync(
        mutated,
        native.replace(selected, 'IntPtr.Zero, IntPtr.Zero, true, 0x00000004'),
      );
      compileParent(target, mutated);
      const result = invoke('positive', target);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout.toString()).access).toMatchObject({
        matched: true,
        wrote: true,
      });
      expect(result.stderr.toString()).toContain('outside-sentinel-changed');
    }, 35000);
    it('detects pre-registration execution when initial native suspension is removed in a disposable mutant', () => {
      const native = fs.readFileSync(
        path.join(project, 'sidecar/session/CallerLauncherNative.cs'),
        'utf8',
      );
      const selected = 'input != null, 0x00000004 |';
      expect(native.split(selected)).toHaveLength(2);
      const mutated = path.join(root, 'early-execution-mutant.cs');
      const target = path.join(root, 'early-execution-mutant.exe');
      fs.writeFileSync(mutated, native.replace(selected, 'input != null, 0x00000000 |'));
      compileParent(target, mutated);
      const result = invoke('registration-refusal', target);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr.toString()).toContain('refused-child-executed');
    }, 35000);
  },
);
