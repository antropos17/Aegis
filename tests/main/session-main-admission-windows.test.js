import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const nativeSource = process.env.AEGIS_MAIN_NATIVE_SOURCE || project;
let root, executable;
describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'enrolled main inspection (native; descriptor model)',
  () => {
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-main-admission-'));
      executable = path.join(root, 'main-fixture.exe');
      const sourceNames = [
        'CallerNative',
        'CallerIdentity',
        'CallerRegistration',
        'CallerAdmission',
        'CallerEndpointNative',
        'CallerEndpoint',
        'CallerLauncherNative',
        'EnrollmentNative',
        'EnrollmentInspection',
        'EnrollmentLease',
        'GuestJobNative',
      ];
      sourceNames.push('MainRegistrationEvidence', 'CallerMainOperation');
      const sources = [
        ...sourceNames.map((name) => path.join(nativeSource, 'sidecar/session', name + '.cs')),
        path.join(nativeSource, 'sidecar/mcpjob/AppContainerExecutable.cs'),
        path.join(project, 'tests/fixtures/session-caller-composition/CompositionFiles.cs'),
        ...['MainFixtureTransport', 'MainClientFixture', 'MainAdmissionFixture'].map((name) =>
          path.join(project, 'tests/fixtures/session-main-admission', name + '.cs'),
        ),
      ];
      try {
        execFileSync(
          path.join(
            process.env.WINDIR || 'C:/Windows',
            'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
          ),
          [
            '/nologo',
            '/target:exe',
            '/platform:x64',
            '/define:ENROLLMENT_LEASE_TEST',
            '/optimize+',
            '/warnaserror+',
            '/out:' + executable,
            ...sources,
          ],
          { timeout: 30000, maxBuffer: 8192, windowsHide: true },
        );
      } catch (error) {
        throw new Error(String(error.stdout) + String(error.stderr), { cause: error });
      }
      expect(fs.statSync(executable).size).toBeLessThanOrEqual(256 * 1024);
    }, 35000);
    function invoke(mode) {
      const directory = fs.mkdtempSync(path.join(root, mode + '-'));
      const result = spawnSync(executable, [mode, directory], {
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
      expect(
        fs.readFileSync(path.join(directory, 'control/supervisor-job-empty.txt'), 'utf8'),
      ).toBe('true');
      const observed = JSON.parse(result.stdout.toString());
      const counter = path.join(directory, 'control/effect-counter.txt');
      expect(fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0).toBe(
        observed.effects,
      );
      const inspection = path.join(directory, 'control/inspection.json');
      return {
        ...observed,
        inspection: fs.existsSync(inspection)
          ? JSON.parse(fs.readFileSync(inspection, 'utf8'))
          : null,
      };
    }
    it('refuses a real held same-operator main image outside the role inventory before any effect', () => {
      expect(invoke('unlisted')).toMatchObject({
        refused: true,
        admitted: false,
        effects: 0,
        mainJobEmpty: true,
      });
    });
    it('authenticates the exact enrolled main peer and performs only fixed inventory inspection', () => {
      expect(invoke('positive')).toMatchObject({
        refused: false,
        admitted: true,
        effects: 1,
        mainJobEmpty: true,
        protectedDescriptorsModeled: true,
        inspection: {
          scope: 'retained-inventory-inspection',
          selectionId: 'c'.repeat(32),
          inventoryObserved: true,
          ownershipQualified: false,
          launchAllowed: false,
        },
      });
    });
    it('refuses an ordinary root through real production descriptor checks', () => {
      expect(invoke('strict-root')).toMatchObject({
        enrollmentRejected: true,
        childCreated: false,
        effects: 0,
        protectedDescriptorsModeled: false,
      });
    });
    it('keeps the independently built maintained supervisor within its enrolled image guard', () => {
      const production = fs.statSync(path.join(project, 'build/sidecar/aegis-session.exe'));
      expect(production.size).toBeGreaterThan(0);
      expect(production.size).toBeLessThanOrEqual(4 * 1024 * 1024);
    });
    it('refuses an already-bound different server before acquiring its unrelated held gate', () => {
      expect(invoke('server-held-gate')).toMatchObject({
        refused: true,
        effects: 0,
        earlyAssociationRefused: true,
        borrowedUsable: true,
      });
    });
    it.each(['role-metadata', 'inventory-metadata'])(
      'terminally revokes after actual %s change even when restored',
      (mode) => {
        expect(invoke(mode)).toMatchObject({
          admitted: true,
          refused: true,
          effects: 0,
          mainJobEmpty: true,
          metadataApplied: true,
          laterRefused: true,
        });
      },
    );
    it.each(['owner-revoked', 'frame-role', 'server-replacement'])(
      'leaves borrowed owners usable after %s',
      (mode) => {
        expect(invoke(mode)).toMatchObject({
          refused: true,
          effects: 0,
          mainJobEmpty: true,
          borrowedUsable: true,
        });
      },
    );
    it.each([
      'role-protocol',
      'role-epoch',
      'role-image',
      'role-inventory',
      'duplicate-selection',
      'operator-sid',
      'operator-authentication',
      'operator-session',
      'server-replacement',
      'server-reversed',
      'legacy-frame',
      'frame-role',
      'frame-generation',
      'unknown-selection',
      'stale-selection',
      'stale-revision',
    ])('refuses %s before any effect', (mode) => {
      expect(invoke(mode)).toMatchObject({
        refused: true,
        admitted: false,
        effects: 0,
        mainJobEmpty: true,
      });
    });
    it.each([
      'lease-revoked',
      'server-revoked',
      'owner-revoked',
      'main-exit',
      'duplicate-admission',
    ])('revokes published context after %s', (mode) => {
      expect(invoke(mode)).toMatchObject({
        refused: true,
        admitted: true,
        effects: 0,
        mainJobEmpty: true,
      });
    });
  },
);
