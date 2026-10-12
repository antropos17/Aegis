import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let root;
describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'installed owner partial control cleanup and held EXE loader',
  () => {
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-partial-controls-'));
    });
    afterAll(() => {
      if (root) {
        const absolute = fs.realpathSync(root);
        if (path.dirname(absolute) !== fs.realpathSync(os.tmpdir()))
          throw new Error('fixture cleanup path refused');
        fs.rmSync(absolute, { recursive: true, force: true });
      }
    });
    function invoke(mode) {
      const directory = fs.mkdtempSync(path.join(root, mode + '-'));
      if (mode === 'loader') {
        for (const [name, value] of [
          ['one', 27],
          ['two', 42],
        ]) {
          const output = path.join(directory, name);
          fs.mkdirSync(output);
          const source = path.join(output, 'actor.cs');
          fs.writeFileSync(
            source,
            `public static class InstalledOwnerMutationLauncher { public static int Main() { return 1; } public static int Run(string a, string b, string c, string d, string e) { return ${value}; } }`,
          );
          execFileSync(
            path.join(
              process.env.WINDIR || 'C:/Windows',
              'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
            ),
            [
              '/nologo',
              '/target:exe',
              '/platform:x64',
              '/out:' + path.join(output, 'actor.exe'),
              source,
            ],
            { windowsHide: true, timeout: 15000, maxBuffer: 8192 },
          );
        }
      }
      const result = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          path.join(project, 'tests/fixtures/protected-installation/partial-controls-fixture.ps1'),
          '-Root',
          directory,
          '-Mode',
          mode,
          ...(process.env.AEGIS_PARTIAL_GUARD_SOURCE
            ? ['-GuardSource', process.env.AEGIS_PARTIAL_GUARD_SOURCE]
            : []),
        ],
        { windowsHide: true, timeout: 20000, maxBuffer: 8192 },
      );
      expect(result.error).toBeUndefined();
      expect(result.stderr.toString()).toBe('');
      expect(result.status).toBe(0);
      return JSON.parse(result.stdout.toString());
    }
    it.each(['empty', 'seeded'])(
      'removes exact owned %s controls after pre-actor failure',
      (mode) => {
        expect(invoke(mode)).toEqual({ refused: false, removed: true, remaining: 0 });
      },
    );
    it.each(['foreign', 'replaced'])(
      'preserves %s controls when association is unconfirmed',
      (mode) => {
        expect(invoke(mode)).toEqual({
          refused: true,
          removed: false,
          remaining: mode === 'foreign' ? 3 : 2,
        });
      },
    );
    it('loads held executable bytes and binds each call to its exact assembly', () => {
      expect(invoke('loader')).toEqual({ values: [27, 42], noActorExecuted: true });
    });
    it('allows same-volume replacement under the retained control pin and deletes only the original directory', () => {
      expect(invoke('replacement-control')).toEqual({
        refused: false,
        removed: true,
        remaining: 0,
        replacementSucceeded: true,
      });
    });
    it('detects a renamed disposable directory and preserves it without deleting through the old path', () => {
      expect(invoke('renamed-control')).toEqual({ refused: true, removed: false, remaining: 2 });
    });
  },
);
