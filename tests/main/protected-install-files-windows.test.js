import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe.skipIf(process.platform !== 'win32')('protected installer directory pins', () => {
  it('keeps metadata readers and directory fences while projecting exact native refusals', () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-install-pinning-'));
    try {
      const result = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          path.join(project, 'tests/fixtures/protected-installation/pinning-fixture.ps1'),
          scratch,
        ],
        { windowsHide: true, timeout: 15000, maxBuffer: 8192 },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stderr.toString()).toBe('');
      if (process.env.AEGIS_INSTALL_PINNING_PACKET) {
        fs.writeFileSync(process.env.AEGIS_INSTALL_PINNING_PACKET, result.stdout);
      }
      expect(JSON.parse(result.stdout.toString())).toEqual({
        schemaVersion: 2,
        snapshotSucceeded: true,
        sameIdentity: true,
        readPinError: 0,
        maintainedEnrollmentMatches: true,
        foreignDeleteError: 32,
        foreignWriteError: 32,
        leafOpenFailure: {
          operation: 'protected-file-open-leaf',
          nativeWin32: 32,
          code: 'protected-file-native-refused',
        },
        existingDirectoryFailure: {
          operation: 'protected-file-create-directory',
          nativeWin32: 183,
          code: 'protected-file-native-refused',
        },
        directoryCleanup: true,
      });
    } finally {
      fs.rmdirSync(scratch);
    }
  }, 20000);
});
