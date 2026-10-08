import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sources = ['EnrollmentNative.cs', 'EnrollmentInspection.cs'];
let root, fixture, executable;

describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'read-only protected enrollment inspection',
  () => {
    function compile(output, inputs) {
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
          `/out:${output}`,
          ...inputs,
        ],
        { timeout: 30000, windowsHide: true, maxBuffer: 4096, stdio: 'pipe' },
      );
      expect(fs.statSync(output).size).toBeLessThanOrEqual(65536);
    }

    beforeAll(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-enrollment-test-'));
      fixture = path.join(root, 'fixture.exe');
      executable = path.join(root, 'aegis-session.exe');
      const common = sources.map((file) => path.join(project, 'sidecar/session', file));
      compile(fixture, [
        ...common,
        path.join(project, 'tests/fixtures/session-enrollment/EnrollmentFixture.cs'),
      ]);
      compile(executable, [
        ...common,
        ...['Program.cs', 'Protocol.cs'].map((file) => path.join(project, 'sidecar/session', file)),
      ]);
    }, 65000);

    afterAll(() => {
      if (!root) return;
      expect(path.dirname(root)).toBe(fs.realpathSync(os.tmpdir()));
      expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
      // Only these two closed fixture binaries are owned by this suite.
      for (const file of [fixture, executable]) {
        if (!fs.existsSync(file)) continue;
        expect(fs.lstatSync(file).isSymbolicLink()).toBe(false);
        fs.unlinkSync(file);
      }
      fs.rmdirSync(root);
    });

    function invoke(file, args, input) {
      const result = spawnSync(file, args, {
        input,
        timeout: 10000,
        maxBuffer: 4096,
        windowsHide: true,
      });
      expect(result.error).toBeUndefined();
      expect(result.stderr.length).toBe(0);
      return result;
    }

    function model(mode) {
      const result = invoke(fixture, [mode]);
      expect(result.status).toBe(0);
      const report = JSON.parse(result.stdout.toString());
      expect(report).toMatchObject({
        schemaVersion: 1,
        scope: 'protected-enrollment-inspection',
        ownershipQualified: false,
        callerQualified: false,
        launchAllowed: false,
      });
      expect(result.stdout.toString()).not.toContain('dummy-secret');
      return report;
    }

    it('observes a canonical pinned enrollment from disposable observation doubles without granting launch', () => {
      expect(model('positive')).toMatchObject({
        observed: true,
        phase: 'complete',
        reason: 'protected-enrollment-observed',
      });
    });

    it.each([
      'world-writable',
      'owner-user',
      'null-dacl',
      'path',
      'reparse',
      'root-id',
      'root-volume',
      'image-hash',
      'revision-zero',
      'revision-overflow',
      'duplicate',
      'unknown-field',
      'bom',
      'oversize',
      'invalid-utf8',
      'missing-record',
      'running-image',
      'changed',
      'close',
    ])('refuses %s and closes every retained observation', (mode) => {
      expect(model(mode)).toMatchObject({ observed: false, reason: 'enrollment-unavailable' });
    });

    it('reports revocation separately without an ownership or launch capability', () => {
      expect(model('revoked')).toMatchObject({
        observed: false,
        phase: 'record',
        reason: 'enrollment-revoked',
      });
    });

    it('evaluates actual descriptors, including effective and inheritance-only mutation grants', () => {
      const result = invoke(fixture, ['descriptor-controls']);
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout.toString())).toMatchObject({
        native: false,
        descriptorControls: 10,
        passed: true,
        aclChanged: false,
      });
    });

    it('observes actual held directory identity and refuses an empty unregistered current-principal root', () => {
      const result = invoke(fixture, ['native-ordinary-root']);
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout.toString())).toMatchObject({
        native: true,
        ordinaryRootRefused: true,
        heldIdentityObserved: true,
        aclChanged: false,
      });
    });

    it('reads and rechecks an actual held file while replacement and writes are refused', () => {
      const result = invoke(fixture, ['native-held-file']);
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout.toString())).toMatchObject({
        native: true,
        heldBytesObserved: true,
        writeRefused: true,
        deleteRefused: true,
        rechecked: true,
      });
    });

    it('exposes only the fixed installed read-only inspection at the real Program entrypoint', () => {
      const result = invoke(executable, ['--inspect-enrollment']);
      // Fixture executable lives outside the fixed installed path and cannot qualify it.
      expect(result.status).toBe(3);
      expect(JSON.parse(result.stdout.toString())).toMatchObject({
        observed: false,
        ownershipQualified: false,
        callerQualified: false,
        launchAllowed: false,
      });
    });

    it.each(['probe', 'prepare'])('preserves the inactive framed %s protocol', (operation) => {
      const payload = Buffer.from(
        JSON.stringify({
          protocol: 'aegis-protected-session',
          version: 1,
          operation,
          requestId: 'a'.repeat(32),
          sessionId: 'b'.repeat(32),
        }),
      );
      const header = Buffer.alloc(4);
      header.writeUInt32LE(payload.length);
      const result = invoke(executable, [], Buffer.concat([header, payload]));
      expect(result.status).toBe(operation === 'probe' ? 0 : 3);
      expect(result.stdout.readUInt32LE(0)).toBe(result.stdout.length - 4);
      expect(JSON.parse(result.stdout.subarray(4).toString())).toMatchObject({
        operation,
        state: 'unavailable',
        reason: 'containment-unavailable',
        launchAllowed: false,
      });
    });

    it('refuses caller-selected enrollment paths without opening a production authority', () => {
      const result = invoke(executable, ['--inspect-enrollment', root]);
      expect(result.status).toBe(2);
      expect(result.stdout.length).toBe(0);
    });
  },
);
