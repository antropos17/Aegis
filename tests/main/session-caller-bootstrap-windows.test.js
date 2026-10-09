import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const session = path.join(project, 'sidecar/session');
const fixture = path.join(project, 'tests/fixtures/session-caller-bootstrap');
let root, executable, child;
function compile(target, files) {
  try {
    execFileSync(
      path.join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
      [
        '/nologo',
        '/target:exe',
        '/platform:x64',
        '/define:ENROLLMENT_LEASE_TEST',
        '/optimize+',
        '/warnaserror+',
        '/out:' + target,
        ...files,
      ],
      { timeout: 30000, maxBuffer: 8192, windowsHide: true },
    );
  } catch (error) {
    throw new Error(String(error.stdout) + String(error.stderr), { cause: error });
  }
  expect(fs.statSync(target).size).toBeLessThanOrEqual(65536);
}
describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'explicit retained caller bootstrap (same principal)',
  () => {
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-caller-bootstrap-'));
      executable = path.join(root, 'bootstrap-fixture.exe');
      child = path.join(root, 'bootstrap-child.exe');
      const caller = [
        'CallerNative',
        'CallerIdentity',
        'CallerRegistration',
        'CallerAdmission',
        'CallerEndpointNative',
        'CallerEndpoint',
        'CallerLauncher',
        'CallerLauncherNative',
        'CallerSession',
        'CallerBootstrap',
        'CallerBootstrapInput',
        'CallerBootstrapFrame',
        'EnrollmentNative',
        'EnrollmentInspection',
        'EnrollmentLease',
        'GuestJobNative',
      ].map((name) => path.join(session, name + '.cs'));
      const native = [...caller, path.join(project, 'sidecar/mcpjob/AppContainerExecutable.cs')];
      compile(child, [
        ...native,
        path.join(project, 'tests/fixtures/session-caller-launcher/LauncherObservation.cs'),
        path.join(fixture, 'BootstrapChild.cs'),
      ]);
      compile(executable, [
        ...native,
        path.join(project, 'tests/fixtures/session-caller-launcher/LauncherObservation.cs'),
        path.join(project, 'tests/fixtures/session-caller-composition/CompositionFiles.cs'),
        path.join(fixture, 'BootstrapObservation.cs'),
        path.join(fixture, 'BootstrapFixture.cs'),
      ]);
    }, 35000);
    function invoke(mode) {
      const directory = fs.mkdtempSync(path.join(root, mode + '-'));
      const installed = path.join(directory, 'installed'),
        control = path.join(directory, 'control');
      fs.mkdirSync(installed);
      fs.mkdirSync(control);
      fs.copyFileSync(child, path.join(installed, 'aegis-session.exe'));
      const result = spawnSync(executable, [mode, installed, control], {
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
    it('delivers held-server bootstrap to the exact suspended child and admits it after release', () => {
      expect(invoke('positive')).toMatchObject({
        accepted: true,
        payload: true,
        payloadBeforeRelease: false,
        rightsReduced: true,
        canaryExcluded: true,
        contextRefused: true,
        stopped: true,
      });
    });
    it('waits for a deterministically held observation writer before reading the native control', () => {
      expect(invoke('observation-held-writer')).toMatchObject({
        accepted: true,
        payload: true,
        rightsReduced: true,
        canaryExcluded: true,
        contextRefused: true,
        stopped: true,
      });
    });
    it.each([
      'malformed',
      'non-ascii',
      'truncated',
      'trailing',
      'second-frame',
      'invalid-handle',
      'overflow-handle',
    ])('refuses %s bootstrap before import, connection or payload', (mode) => {
      expect(invoke(mode)).toMatchObject({
        accepted: false,
        rejected: true,
        payload: false,
        rejectionStep: 1,
        readerClosedBeforeRelease: true,
        canaryExcluded: true,
        stopped: true,
      });
    });
    it.each(['handle-substitution', 'pid-mismatch', 'birth-mismatch'])(
      'refuses %s against the actual transferred native process reference',
      (mode) => {
        expect(invoke(mode)).toMatchObject({
          accepted: false,
          rejected: true,
          payload: false,
          rejectionStep: 3,
          readerClosedBeforeRelease: true,
          stopped: true,
        });
      },
    );
    it('refuses an imported held server that does not own the actual endpoint', () => {
      expect(invoke('wrong-server')).toMatchObject({
        accepted: false,
        rejected: true,
        payload: false,
        rejectionStep: 4,
        stopped: true,
      });
    });
    it.each(['no-frame', 'no-eof'])(
      'bounds the total %s byte-and-EOF wait with the native writer still held',
      (mode) => {
        const observation = invoke(mode);
        expect(observation).toMatchObject({
          accepted: false,
          rejected: true,
          payload: false,
          rejectionStep: 1,
          readerClosedBeforeRelease: true,
          writerHeldAtRefusal: true,
          stopped: true,
        });
        expect(observation.elapsed).toBeGreaterThanOrEqual(500);
        expect(observation.elapsed).toBeLessThan(2000);
      },
    );
    it.each(['session-substitution', 'generation-substitution'])(
      'denies admission for canonical %s after the inspect submission marker',
      (mode) => {
        expect(invoke(mode)).toMatchObject({
          accepted: false,
          rejected: true,
          payload: true,
          readerClosedBeforeRelease: true,
          stopped: true,
        });
      },
    );
    it('cancels before release with no child effect and refuses reuse', () => {
      expect(invoke('cancel')).toMatchObject({
        payloadBeforeRelease: false,
        payload: false,
        releaseRefused: true,
        stopped: true,
      });
    });
    it('cancels the released receiver while the writer withholds EOF', () => {
      expect(invoke('no-eof-cancel')).toMatchObject({
        payload: false,
        releaseRefused: true,
        readerClosedBeforeRelease: true,
        writerHeldAtRefusal: true,
        stopped: true,
      });
    });
    it('held server revocation prevents first release and stops the suspended child', () => {
      expect(invoke('server-revoke')).toMatchObject({
        accepted: false,
        payload: false,
        releaseRefused: true,
        stopped: true,
      });
    });
    it('held server revocation invalidates an admitted context and terminates its child', () => {
      expect(invoke('context-server-revoke')).toMatchObject({
        accepted: true,
        contextRefused: true,
        stopped: true,
      });
    });
    it('duplicate release refuses while the correctly released child remains owned', () => {
      expect(invoke('duplicate')).toMatchObject({
        releaseRefused: true,
        duplicateKeptLive: true,
        accepted: true,
        contextRefused: true,
        stopped: true,
      });
    });
    it('native enrollment setup failure closes the suspended child before any bootstrap effect', () => {
      expect(invoke('missing-record')).toMatchObject({
        setupRefused: true,
        payload: false,
        accepted: false,
        stopped: true,
      });
    });
  },
);
