import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = process.env.AEGIS_CONTROLLER_NATIVE_SOURCE || project;
const session = path.join(source, 'sidecar/session');
const baseline = process.env.AEGIS_CONTROLLER_BASELINE === '1';
let root, executable, child;
function compile(target, files) {
  try {
    execFileSync(
      path.join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
      [
        '/nologo',
        '/target:exe',
        '/platform:x64',
        '/define:ENROLLMENT_LEASE_TEST' + (baseline ? '' : ',CALLER_CONTROLLER_TEST'),
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
  expect(fs.statSync(target).size).toBeLessThanOrEqual(256 * 1024);
}
describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'retained caller controller (same principal)',
  () => {
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-caller-controller-'));
      executable = path.join(root, 'controller-fixture.exe');
      child = path.join(root, 'bootstrap-child.exe');
      const common = [
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
      const native = [
        ...common,
        path.join(source, 'sidecar/mcpjob/AppContainerExecutable.cs'),
        path.join(source, 'tests/fixtures/session-caller-launcher/LauncherObservation.cs'),
      ];
      compile(child, [
        ...native,
        path.join(source, 'tests/fixtures/session-caller-bootstrap/BootstrapChild.cs'),
      ]);
      compile(executable, [
        ...native,
        path.join(source, 'tests/fixtures/session-caller-composition/CompositionFiles.cs'),
        path.join(source, 'tests/fixtures/session-caller-bootstrap/BootstrapObservation.cs'),
        path.join(source, 'tests/fixtures/session-caller-controller/ControllerFixture.cs'),
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
    it('refuses a later effect after the exact registered main exits', () => {
      expect(invoke('main-exit-after-admission')).toMatchObject({
        admitted: true,
        refused: true,
        effects: 0,
        stopped: true,
      });
    });
    it('admits the same-operator main binding and preserves both borrowed registrations after owned cleanup', () => {
      expect(invoke('positive')).toMatchObject({
        admitted: true,
        effects: 1,
        payloadBeforeRelease: false,
        borrowedMainLive: true,
        borrowedServerLive: true,
        stopped: true,
      });
    });
    it.each(['main-exit-before-release', 'main-revoke-before-release'])(
      'refuses %s and closes the suspended exact child',
      (mode) => {
        expect(invoke(mode)).toMatchObject({
          admitted: false,
          released: false,
          refused: true,
          effects: 0,
          stopped: true,
        });
      },
    );
    it('revoking the exact main invalidates an already admitted context', () => {
      expect(invoke('main-revoke-after-admission')).toMatchObject({
        admitted: true,
        refused: true,
        effects: 0,
        stopped: true,
      });
    });
    it.each(['main-exit-before-admission', 'main-revoke-before-admission'])(
      'refuses %s after release without issuing a context',
      (mode) => {
        expect(invoke(mode)).toMatchObject({
          released: true,
          admitted: false,
          refused: true,
          effects: 0,
          stopped: true,
        });
      },
    );
    it('a fresh same-process registration cannot replace the revoked registration generation', () => {
      expect(invoke('main-generation-replacement')).toMatchObject({
        admitted: true,
        replacementLive: true,
        refused: true,
        effects: 0,
        stopped: true,
      });
    });
    it.each(['main-revoke-before-setup', 'wrong-server', 'reversed-registration'])(
      'refuses %s before creating or releasing a child',
      (mode) => {
        expect(invoke(mode)).toMatchObject({
          setupRefused: true,
          created: false,
          effects: 0,
          borrowedServerLive: true,
        });
      },
    );
    it('gate equality cannot substitute another server registration object', () => {
      expect(invoke('wrong-server-same-gate')).toMatchObject({
        setupRefused: true,
        sharedWrongGate: true,
        created: false,
        effects: 0,
        borrowedMainLive: true,
      });
    });
    it('cancels before release without consuming the borrowed caller registrations', () => {
      expect(invoke('cancel')).toMatchObject({
        released: false,
        effects: 0,
        refused: true,
        stopped: true,
        borrowedMainLive: true,
        borrowedServerLive: true,
      });
    });
    it('parses independently marshaled old SID/GROUPS layout and refuses a short table (buffer model)', () => {
      expect(invoke('identity-abi')).toMatchObject({
        syntheticBuffers: true,
        schemaSidBytes: 16,
        schemaGroupOffset: 8,
        nativePointerBytes: 8,
        parsedFromMarshaledLayout: true,
        shortTableRefused: true,
      });
    });
  },
);
