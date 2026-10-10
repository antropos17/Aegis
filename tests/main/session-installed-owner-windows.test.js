import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let root, fixture;

describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'installed owner native refusal controls (no host installation)',
  () => {
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-installed-owner-'));
      fixture = path.join(root, 'installed-owner-fixture.exe');
      const sources = fs
        .readdirSync(path.join(project, 'sidecar/session'))
        .filter((name) => name.endsWith('.cs') && name !== 'Program.cs')
        .sort()
        .map((name) => path.join(project, 'sidecar/session', name));
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
          '/out:' + fixture,
          ...sources,
          path.join(project, 'sidecar/mcpjob/AppContainerExecutable.cs'),
          path.join(project, 'tests/fixtures/session-installed-owner/InstalledOwnerFixture.cs'),
        ],
        { timeout: 30000, maxBuffer: 16384, windowsHide: true },
      );
    }, 35000);

    it.each(['manufactured-owner', 'missing-eof'])(
      'refuses %s setup using actual original native handles with terminal owned cleanup',
      (mode) => {
        const evidence = fs.mkdtempSync(path.join(root, mode + '-'));
        const result = spawnSync(
          fixture,
          [path.join(project, 'build/sidecar/aegis-session.exe'), mode, evidence],
          {
            timeout: 14000,
            maxBuffer: 8192,
            windowsHide: true,
          },
        );
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(result.stderr.length).toBe(0);
        expect(JSON.parse(result.stdout.toString())).toEqual({
          refused: true,
          effects: 0,
          producerReady: true,
          ownedJobsEmpty: true,
          unrelatedCanarySurvived: true,
        });
        expect(fs.readFileSync(path.join(evidence, 'producer-ready.txt'), 'utf8')).toBe(
          'original-query-handles-created-and-job-bound',
        );
        expect(fs.readFileSync(path.join(evidence, 'effect-counter.txt'), 'utf8')).toBe('0');
      },
      16000,
    );
  },
);
