import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const project = fileURLToPath(new URL('../../', import.meta.url));
let root, executable;
describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'offline VM storage observation',
  () => {
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-vm-storage-'));
      executable = path.join(root, 'storage.exe');
      const sources = ['sidecar/session', 'sidecar/owner'].flatMap((directory) =>
        fs
          .readdirSync(path.join(project, directory))
          .filter((name) => name.endsWith('.cs'))
          .map((name) => path.join(project, directory, name)),
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
          '/optimize+',
          '/warnaserror+',
          '/reference:System.Management.dll',
          '/reference:System.Security.dll',
          '/main:VmStorageFixture',
          `/out:${executable}`,
          ...sources,
          path.join(project, 'sidecar/mcpjob/AppContainerExecutable.cs'),
          path.join(project, 'tests/fixtures/vm-lifecycle/VmStorageFixture.cs'),
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
    function invoke(mode, args = []) {
      const result = spawnSync(executable, [mode, ...args], {
        timeout: 4000,
        windowsHide: true,
        maxBuffer: 4096,
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr.toString().slice(0, 1024)).toBe(0);
      expect(result.stderr.length).toBe(0);
      return JSON.parse(result.stdout.toString());
    }
    it.each(['positive', 'reordered'])('accepts unchanged attachments: %s', (mode) => {
      const result = invoke(mode);
      expect(result).toMatchObject({ acquired: true, checked: true, refusedAgain: false });
      expect(result.closed).toBe(result.opened);
    });
    it.each([
      'empty',
      'missing',
      'foreign-path',
      'ads',
      'dot-path',
      'unsupported',
      'empty-disk',
      'duplicate-id',
      'duplicate-path',
      'null-row',
      'quota',
      'link',
      'zero',
      'file-failure',
      'partial-open',
      'metadata',
    ])('refuses invalid initial storage: %s', (mode) => {
      const result = invoke(`initial-${mode}`);
      expect(result.acquired).toBe(false);
      expect(result.closed).toBe(result.opened);
    });
    it.each(['changed-file', 'reconnected', 'outage', 'changed-during-query'])(
      'retains refusal after %s',
      (mode) => {
        const result = invoke(mode);
        expect(result).toMatchObject({ acquired: true, checked: false, refusedAgain: true });
        expect(result.closed).toBe(result.opened);
      },
    );
    it.each(['changed-identity', 'changed-metadata'])(
      'binds %s across separate acquisitions',
      (mode) => {
        expect(invoke(mode)).toMatchObject({ acquired: true, changedDigest: true });
      },
    );
    it('denies native file writes/deletion while held, detects replacement and releases every handle', () => {
      const scratch = path.join(root, 'native');
      fs.mkdirSync(scratch);
      expect(invoke('native', [scratch])).toEqual({
        writeDenied: true,
        deleteDenied: true,
        replacementChanged: true,
        cleanup: true,
      });
      expect(fs.readdirSync(scratch)).toEqual([]);
    });
    it.each(['native-writer', 'native-hardlink'])(
      'refuses %s and closes partial native holds',
      (mode) => {
        const scratch = path.join(root, mode);
        fs.mkdirSync(scratch);
        expect(invoke(mode, [scratch])).toEqual({ refused: true, cleanup: true });
        expect(fs.readdirSync(scratch)).toEqual([]);
      },
    );
  },
);
