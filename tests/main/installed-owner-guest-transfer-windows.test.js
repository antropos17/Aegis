import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const quote = (value) => value.replaceAll("'", "''");

describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'installed-owner Windows PowerShell guest input transfer',
  () => {
    it('copies all caller-produced leaves and keeps both guest pin arrays flat', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-guest-transfer-'));
      try {
        const fixture = path.join(
          project,
          'tests/fixtures/protected-installation/guest-transfer-fixture.ps1',
        );
        const result = spawnSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Restricted',
            '-Command',
            `$text=[IO.File]::ReadAllText('${quote(fixture)}'); & ([scriptblock]::Create($text)) -Project '${quote(project)}' -Root '${quote(root)}'`,
          ],
          { windowsHide: true, timeout: 25000, maxBuffer: 8192 },
        );
        expect(result.error).toBeUndefined();
        expect(result.stderr.toString()).toBe('');
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout.toString())).toEqual({
          copiedLeaves: 16,
          bootstrapPins: 16,
          invocationPins: 16,
          noVmOrInstallation: true,
        });
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }, 30000);
  },
);
