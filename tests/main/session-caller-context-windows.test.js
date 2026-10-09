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
  'retained native caller context after supervisor thread impersonation',
  () => {
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-caller-context-'));
      executable = path.join(root, 'context-fixture.exe');
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
          path.join(project, 'tests/fixtures/session-caller-context/CallerContextFixture.cs'),
        ],
        { timeout: 30000, maxBuffer: 8192, windowsHide: true, stdio: 'pipe' },
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
        timeout: 8000,
        maxBuffer: 8192,
        windowsHide: true,
      });
      expect(result.error).toBeUndefined();
      expect(result.stderr.toString()).toBe('');
      expect(result.status).toBe(0);
      return JSON.parse(result.stdout.toString());
    }

    it('permits the actual retained peer with a clean supervisor thread before and after the fence', () => {
      expect(invoke('clean')).toEqual({
        admitted: true,
        initialEffects: 1,
        threadTokenObserved: false,
        rejected: false,
        impersonatedEffects: 0,
        reverted: true,
        revertedEffects: 1,
        childExited: true,
      });
    });

    it('denies the independently observed impersonation token and permits the clean reverted thread', () => {
      expect(invoke('impersonated')).toEqual({
        admitted: true,
        initialEffects: 1,
        threadTokenObserved: true,
        rejected: true,
        impersonatedEffects: 0,
        reverted: true,
        revertedEffects: 1,
        childExited: true,
      });
    });
  },
);
