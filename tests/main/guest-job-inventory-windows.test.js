import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let root, executable;
describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'retained initial guest Job inventory (same-principal native fixture)',
  () => {
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-guest-job-'));
      executable = path.join(root, 'inventory.exe');
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
          '/main:GuestJobFixture',
          `/out:${executable}`,
          ...['GuestJobNative', 'GuestJobInventory'].map((name) =>
            path.join(project, `sidecar/session/${name}.cs`),
          ),
          ...[
            'Native',
            'AppContainerProfile',
            'AppContainerWorkspace',
            'AppContainerWorkspaceInventory',
            'AppContainerInput',
            'AppContainerExecutable',
          ].map((name) => path.join(project, `sidecar/mcpjob/${name}.cs`)),
          path.join(project, 'tests/fixtures/guest-job-inventory/GuestJobFixture.cs'),
        ],
        { timeout: 30000, windowsHide: true, stdio: 'pipe' },
      );
    }, 35000);
    afterAll(() => {
      if (!root) return;
      expect(path.dirname(root)).toBe(fs.realpathSync(os.tmpdir()));
      expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
      for (const file of fs.readdirSync(root)) {
        expect(file).toBe('inventory.exe');
        fs.unlinkSync(path.join(root, file));
      }
      fs.rmdirSync(root);
    });
    function invoke(mode) {
      return new Promise((resolve, reject) => {
        // Native.Start requires the owner cancellation pipe to remain open.
        const child = spawn(executable, [mode], { windowsHide: true, stdio: 'pipe' });
        let output = '',
          errors = '';
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error('fixture-timeout'));
        }, 12000);
        child.on('error', reject);
        child.stdout.on('data', (part) => {
          output += part;
          if (output.length > 4096) child.kill();
        });
        child.stderr.on('data', (part) => {
          errors += part;
          if (errors.length > 4096) child.kill();
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          child.stdin.destroy();
          try {
            expect(code, errors).toBe(0);
            expect(errors).toBe('');
            resolve(JSON.parse(output));
          } catch (error) {
            reject(error);
          }
        });
      });
    }
    it.each(['positive', 'growth'])(
      'retains actual members and verifies closure: %s',
      async (mode) => {
        expect(await invoke(mode)).toMatchObject({ refused: false, closureConfirmed: true });
      },
    );
    it('observes root kill on last Job-handle close while leaving complete closure unknown', async () => {
      expect(await invoke('close-owner')).toMatchObject({
        refused: false,
        killOnCloseObserved: true,
        closureConfirmed: false,
      });
    });
    it.each(['foreign', 'wrong-image', 'late-member', 'exited', 'disposed'])(
      'refuses unsafe admission: %s',
      async (mode) => {
        expect((await invoke(mode)).refused).toBe(true);
      },
    );
    it.each(['partial', 'cap', 'duplicate', 'zero-pid'])(
      'rejects malformed synthetic native-list decoding: %s',
      async (mode) => {
        expect(await invoke(mode)).toEqual({ refused: true, syntheticDecode: true });
      },
    );
  },
);
