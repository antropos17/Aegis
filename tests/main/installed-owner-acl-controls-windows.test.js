import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
describe.skipIf(process.platform !== 'win32')(
  'installed ACL control contract (no installation)',
  () => {
    it('retains positive refusals and cleans up before mutation resource creation', () => {
      const result = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          path.join(
            project,
            'tests/fixtures/protected-installation/installed-owner-positive-fail-fast-fixture.ps1',
          ),
        ],
        { windowsHide: true, timeout: 15000, maxBuffer: 8192 },
      );
      expect(result.error).toBeUndefined();
      expect(result.stderr.toString()).toBe('');
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout.toString())).toEqual({
        refusedCases: 6,
        resourcesSkipped: true,
        originalRefusalRetained: true,
        exactCleanupReached: true,
        successfulPositiveReachesControls: true,
        nativeQualification: false,
      });
    }, 20000);
    it('refuses missing or successful security denials', () => {
      const result = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          path.join(
            project,
            'tests/fixtures/protected-installation/installed-owner-acl-fixture.ps1',
          ),
        ],
        { windowsHide: true, timeout: 15000, maxBuffer: 8192 },
      );
      expect(result.error).toBeUndefined();
      expect(result.stderr.toString()).toBe('');
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout.toString())).toEqual({
        contractActions: 50,
        malformedSecurityDenialsRefused: true,
        scratchSecurityAccessGranted: true,
        nativeAclQualification: false,
      });
    }, 20000);
  },
);
