import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { claudeHookLaunchCommand } from '../../frontend/observatory/runtime/claude-hook-guide';

it.skipIf(process.platform !== 'win32')(
  'passes the exact settings path as one native argument and refuses cancellation or a missing file',
  () => {
    const root = mkdtempSync(join(tmpdir(), 'aegis-guide-'));
    try {
      const folder = join(root, "Spaces & O'Brien [$literal]");
      mkdirSync(folder);
      const settings = join(folder, 'settings.json');
      writeFileSync(settings, '{}');
      const shell = join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe');
      const run = (input: string) => {
        const code = `
$ErrorActionPreference = 'Stop'
function Read-Host { return $env:AEGIS_GUIDE_INPUT }
function claude { & $env:AEGIS_GUIDE_NODE -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' -- @args }
try {
${claudeHookLaunchCommand}
} catch { Write-Output 'MISSING' }
`;
        return execFileSync(
          shell,
          [
            '-NoProfile',
            '-NonInteractive',
            '-EncodedCommand',
            Buffer.from(code, 'utf16le').toString('base64'),
          ],
          {
            encoding: 'utf8',
            env: { ...process.env, AEGIS_GUIDE_INPUT: input, AEGIS_GUIDE_NODE: process.execPath },
          },
        ).trim();
      };
      expect(JSON.parse(run(folder))).toEqual(['--settings', settings]);
      expect(run('')).toBe('');
      expect(run(join(root, 'missing'))).toBe('MISSING');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
