import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'pinned installed-owner module loading under Restricted policy',
  () => {
    it('loads verified definitions with lexical file paths and refuses unapproved imports', () => {
      const fixture = path.join(
        project,
        'tests/fixtures/protected-installation/pinned-loader-fixture.ps1',
      );
      const result = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Restricted',
          '-Command',
          `$text=[IO.File]::ReadAllText('${fixture.replaceAll("'", "''")}'); & ([scriptblock]::Create($text)) -Project '${project.replaceAll("'", "''")}'`,
        ],
        { windowsHide: true, timeout: 20000, maxBuffer: 8192 },
      );
      expect(result.error).toBeUndefined();
      expect(result.stderr.toString()).toBe('');
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout.toString())).toEqual({
        policyUnchanged: true,
        policyRestricted: true,
        nativeLoaded: true,
        corpusDefined: true,
        rejectedImportsOrSyntax: 3,
        noInstallation: true,
      });
    }, 25000);
  },
);
