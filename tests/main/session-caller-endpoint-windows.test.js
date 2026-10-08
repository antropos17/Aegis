import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sources = [
  'CallerNative.cs',
  'CallerIdentity.cs',
  'CallerRegistration.cs',
  'CallerAdmission.cs',
  'CallerEndpointNative.cs',
  'CallerEndpoint.cs',
];
let executable, fixtureRoot;

function compile(target, nativeSource) {
  execFileSync(
    path.join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    [
      '/nologo',
      '/target:exe',
      '/platform:x64',
      '/optimize+',
      '/warnaserror+',
      `/out:${target}`,
      ...sources.map((file) =>
        nativeSource && file === 'CallerEndpointNative.cs'
          ? nativeSource
          : path.join(project, 'sidecar/session', file),
      ),
      path.join(project, 'tests/fixtures/session-caller-endpoint/CallerEndpointFixture.cs'),
    ],
    { timeout: 30000, maxBuffer: 8192, windowsHide: true, stdio: 'pipe' },
  );
}

describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'native owned caller endpoint',
  () => {
    beforeAll(() => {
      fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-caller-endpoint-'));
      executable = path.join(fixtureRoot, 'endpoint-fixture.exe');
      compile(executable);
    }, 35000);

    function invoke(mode) {
      const result = spawnSync(executable, [mode], {
        timeout: 8000,
        maxBuffer: 8192,
        windowsHide: true,
      });
      expect(result.error).toBeUndefined();
      expect(result.stderr.toString()).toBe('');
      expect(result.status).toBe(0);
      return JSON.parse(result.stdout.toString());
    }

    it('admits the separately launched retained child after that child independently verifies the held server', () => {
      expect(invoke('positive')).toMatchObject({
        accepted: true,
        rejected: false,
        crossProcess: true,
      });
    });
    it('denies a same-logon sibling with the valid locator and exact registered frame', () => {
      expect(invoke('sibling')).toMatchObject({ accepted: false, rejected: true, closed: true });
    });
    it('rejects the actual server when the client retains a different server registration', () => {
      expect(invoke('wrong-server')).toMatchObject({ accepted: false, rejected: true });
    });
    it.each(['second-instance', 'squatting'])(
      'refuses %s at an already owned native name',
      (mode) => {
        expect(invoke(mode)).toMatchObject({ rejected: true });
      },
    );
    it('independently reads the actual protected DACL, logon SID, access mask and noninheritance', () => {
      expect(invoke('descriptor').rejected).toBe(true);
    });
    it('inspects the actual distinct-peer ACE with a synthetic SID (no foreign-principal logon)', () => {
      expect(invoke('synthetic-peer-mask').rejected).toBe(true);
    });
    it('detects an actual native descriptor with a changed server access mask', () => {
      const source = fs.readFileSync(
        path.join(project, 'sidecar/session/CallerEndpointNative.cs'),
        'utf8',
      );
      expect(source.split('"D:P(A;;0x001f01ff;;;').length).toBe(2);
      const altered = path.join(fixtureRoot, 'wrong-mask-native.cs');
      const mutant = path.join(fixtureRoot, 'wrong-mask-fixture.exe');
      fs.writeFileSync(altered, source.replace('"D:P(A;;0x001f01ff;;;', '"D:P(A;;0x001f01fd;;;'));
      compile(mutant, altered);
      const result = spawnSync(mutant, ['descriptor'], {
        timeout: 8000,
        maxBuffer: 8192,
        windowsHide: true,
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr.toString()).toContain('inspect-ace:');
    });
    it.each(['deadline', 'client-deadline'])(
      'bounds the absent peer %s and closes failed server admission',
      (mode) => {
        const result = invoke(mode);
        expect(result).toMatchObject({ rejected: true, closed: true });
        expect(result.elapsed).toBeGreaterThanOrEqual(100);
        expect(result.elapsed).toBeLessThan(1500);
      },
    );
    it('rejects a remote locator locally (policy control; no remote-host test)', () => {
      expect(invoke('remote-locator')).toMatchObject({ rejected: true });
    });
    it('closes idempotently and denies a subsequent accept', () => {
      expect(invoke('dispose')).toMatchObject({ rejected: true, closed: true });
    });
    it('invalidates an admitted retained-child context on endpoint disposal', () => {
      expect(invoke('close-context')).toMatchObject({
        accepted: true,
        rejected: true,
        closed: true,
        crossProcess: true,
      });
    });
  },
);
