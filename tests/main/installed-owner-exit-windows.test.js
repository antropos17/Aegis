import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let root, fixture;

describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'installed owner exact supervisor exit observation',
  () => {
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-owner-exit-'));
      fixture = path.join(root, 'owner-exit.exe');
      const sources = ['session', 'owner'].flatMap((dir) =>
        fs
          .readdirSync(path.join(project, 'sidecar', dir))
          .filter((name) => name.endsWith('.cs') && name !== 'Program.cs')
          .sort()
          .map((name) => path.join(project, 'sidecar', dir, name)),
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
          '/main:InstalledOwnerExitFixture',
          '/reference:System.Management.dll',
          '/reference:System.Security.dll',
          '/out:' + fixture,
          ...sources,
          path.join(project, 'sidecar/mcpjob/AppContainerExecutable.cs'),
          path.join(project, 'tests/fixtures/session-installed-owner/InstalledOwnerExitFixture.cs'),
        ],
        { timeout: 30000, maxBuffer: 16384, windowsHide: true },
      );
    }, 35000);
    afterAll(() => {
      if (root) fs.rmSync(root, { recursive: true, force: true });
    });

    function run(mode) {
      const child = spawnSync(fixture, [mode], {
        timeout: 8000,
        maxBuffer: 16384,
        windowsHide: true,
      });
      expect(child.error).toBeUndefined();
      expect(child.status).toBe(0);
      expect(child.stderr.length).toBe(0);
      const result = JSON.parse(child.stdout.toString('utf8'));
      expect(result.eofBeforeExit).toBe(true);
      expect(result.cleanupConfirmed).toBe(true);
      expect(result.exactProcessExited).toBe(true);
      return result;
    }

    it('preserves argument refusal and reports a fixed headless startup checkpoint', () => {
      const result = spawnSync(fixture, ['main-checkpoint'], { timeout: 8000, windowsHide: true });
      expect(result.status).toBe(0);
      expect(result.stderr.length).toBe(0);
      expect(JSON.parse(result.stdout.toString('utf8'))).toEqual({
        invalidArgumentsRefused: true,
        headlessGuardCode: 201,
      });
    });

    it.each(['delayed', 'active-code', 'hung'])(
      'observes main %s before forced cleanup',
      (mode) => {
        const result = run('main-' + mode);
        expect(result.mainSignaledBeforeCleanup).toBe(mode !== 'hung');
        expect(result.exitCode).toBe(mode === 'hung' ? null : mode === 'active-code' ? 259 : 2);
      },
    );

    it('records natural exit2 when completion EOF precedes exact supervisor exit', () => {
      const result = run('delayed');
      expect(result.exitCode).toBe(2);
      expect(result.elapsedMs).toBeGreaterThanOrEqual(250);
      expect(result.elapsedMs).toBeLessThan(3000);
    });
    it('caps natural wait and forces owned cleanup for a non-exiting supervisor', () => {
      const result = run('hung');
      expect(result.exitCode).toBeNull();
      expect(result.elapsedMs).toBeGreaterThanOrEqual(1800);
      expect(result.elapsedMs).toBeLessThan(3500);
    });
    it('records genuine signaled exit259 without confusing it with an unobserved exit', () => {
      expect(run('active-code').exitCode).toBe(259);
    });
    it.each(['budget', 'expired', 'stop'])('preserves bounded cleanup for %s', (mode) => {
      const result = run(mode);
      expect(result.exitCode).toBeNull();
      expect(result.elapsedMs).toBeLessThan(1500);
    });
    it.each(['cancel', 'expire'])('allows concurrent %s during natural exit grace', (mode) => {
      const result = run(mode);
      expect(result.exitCode).toBeNull();
      expect(result.elapsedMs).toBeLessThan(1000);
    });
  },
);
