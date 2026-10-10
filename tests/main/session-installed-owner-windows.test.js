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

    it('retains canonical stage-2 private-pipe diagnostics in a failed attempt without cleanup authority', () => {
      const parsed = spawnSync(fixture, ['--failure-frames'], {
        timeout: 5000,
        maxBuffer: 16384,
        windowsHide: true,
      });
      expect(parsed.error).toBeUndefined();
      expect(parsed.status).toBe(0);
      expect(parsed.stderr.length).toBe(0);
      const native = JSON.parse(parsed.stdout.toString('utf8'));
      const receipt = path.join(root, 'failure-frames.json');
      fs.writeFileSync(receipt, parsed.stdout);
      const attempted = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          path.join(project, 'tests/fixtures/protected-installation/orchestration-fixture.ps1'),
          'attempt-failure-frame',
          receipt,
        ],
        { timeout: 10000, maxBuffer: 16384, windowsHide: true },
      );
      expect(attempted.error).toBeUndefined();
      expect(attempted.status).toBe(0);
      expect(attempted.stderr.length).toBe(0);
      fs.writeFileSync(path.join(root, 'failure-frame-attempt.json'), attempted.stdout);
      const report = JSON.parse(attempted.stdout.toString('utf8'));
      // Both real parser output and the maintained attempt execute before the
      // regression assertions, including the legacy parser's genuine zero.
      expect(report).toMatchObject({
        passed: false,
        failedAttempt: {
          cleanupUnknown: true,
          checkpoint: 'attempt-validate-closure',
          native: { supervisorStage: 2, supervisorSubstage: native.parsed.substage },
        },
        fixture: {
          cleanupUnknown: true,
          stopCalls: 0,
          deleteCalls: 0,
          genuinelyParsed: native.parsed,
        },
        installation: { cleanup: { state: 'unknown' } },
      });
      expect(native.frameBytes).toBe(104);
      expect(native.writer).toEqual({ accepted: true, stage: 2, substage: 8 });
      expect(native.parsed).toEqual({ accepted: true, stage: 2, substage: 8 });
      expect(native.rows).toHaveLength(35);
      for (const row of native.rows) {
        for (const boundary of ['whole', 'split']) {
          if (row.kind === 'invalid') expect(row[boundary].accepted).toBe(false);
          else
            expect(row[boundary]).toEqual({
              accepted: true,
              stage: row.expectedStage,
              substage: row.expectedSubstage,
            });
        }
      }
      expect(report.fixture.projectionRows).toHaveLength(33);
      for (const row of report.fixture.projectionRows) {
        if (row.expected) expect(row.observation.supervisorSubstage).toBe(row.value);
        else expect(row.observation).not.toHaveProperty('supervisorSubstage');
      }
      expect(JSON.stringify(report)).not.toMatch(
        /unsafe|private-image|private-result|fixture-credential/,
      );
    }, 16000);

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
