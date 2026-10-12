import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe.skipIf(process.platform !== 'win32')('pinned diagnostic actor read lease', () => {
  it('restores RX after callback success/failure and refuses image mutation or a wrong hash', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-actor-read-'));
    try {
      const result = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          path.join(project, 'tests/fixtures/protected-installation/actor-read-fixture.ps1'),
          '-Project',
          project,
          '-Root',
          root,
        ],
        { windowsHide: true, timeout: 10000, maxBuffer: 8192 },
      );
      expect(result.error).toBeUndefined();
      expect(result.stderr.toString()).toBe('');
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout.toString())).toEqual({
        observedRxOnly: 2,
        heldWritesRefused: 2,
        restoredAfterSuccessAndFailure: true,
        wrongHashRefused: true,
        foreignPrincipalLogon: false,
        noInstallation: true,
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 15000);
});
