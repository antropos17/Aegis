import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sources = [
  'CallerNative.cs',
  'CallerIdentity.cs',
  'CallerRegistration.cs',
  'CallerAdmission.cs',
];
let root, executable;

describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'native retained-instance caller admission (same-principal fixture)',
  () => {
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-session-caller-'));
      executable = path.join(root, 'caller-fixture.exe');
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
          `/out:${executable}`,
          ...sources.map((file) => path.join(project, 'sidecar/session', file)),
          path.join(project, 'tests/fixtures/session-caller/SessionCallerFixture.cs'),
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

    function invoke(mode) {
      const result = spawnSync(executable, [mode], {
        timeout: 12000,
        maxBuffer: 4096,
        windowsHide: true,
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stderr.length).toBe(0);
      return JSON.parse(result.stdout.toString());
    }

    it('admits the actual live registered child and returns only after native reversion', () => {
      expect(invoke('positive')).toMatchObject({
        accepted: true,
        reverted: true,
        contextRevoked: false,
        impersonationAttempted: true,
        tokenQueried: true,
        reversionAttempted: true,
        fatalReversionObserved: false,
      });
    });

    it.each([
      'sibling',
      'exited',
      'disposed',
      'malformed',
      'oversize',
      'partial',
      'invalid-utf8',
      'extra-frame',
      'wrong-generation',
      'forged-pid',
      'impersonation-failure',
      'query-failure',
      'revert-failure',
    ])('rejects %s without returning a dispatch context', (mode) => {
      const result = invoke(mode);
      expect(result).toMatchObject({ accepted: false, reverted: true, contextRevoked: false });
      if (mode === 'impersonation-failure')
        expect(result).toMatchObject({
          impersonationAttempted: true,
          tokenQueried: false,
          reversionAttempted: false,
        });
      if (mode === 'query-failure')
        expect(result).toMatchObject({ tokenQueried: true, reversionAttempted: true });
      if (mode === 'revert-failure')
        expect(result).toMatchObject({ reversionAttempted: true, fatalReversionObserved: true });
    });

    it.each(['revoke-context', 'disconnect-context', 'expired-context'])('revokes %s', (mode) => {
      expect(invoke(mode)).toMatchObject({ accepted: true, reverted: true, contextRevoked: true });
    });

    it('verifies the actual server against a retained registration', () => {
      expect(invoke('server-positive').accepted).toBe(true);
      expect(invoke('server-mismatch').accepted).toBe(false);
    });
  },
);
