import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
          '/define:INSTALLED_JOB_TEST',
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

    afterAll(() => {
      if (root) fs.rmSync(root, { recursive: true, force: true });
    });

    it('accepts only canonical bounded native failure frames across whole and split reads', () => {
      const parsed = spawnSync(fixture, ['--failure-frames'], {
        timeout: 5000,
        maxBuffer: 32768,
        windowsHide: true,
      });
      expect(parsed.error).toBeUndefined();
      expect(parsed.status).toBe(0);
      expect(parsed.stderr.length).toBe(0);
      const native = JSON.parse(parsed.stdout.toString('utf8'));
      expect(native.frameBytes).toBe(104);
      expect(native.entryChecks).toBe(2);
      expect(native.writerChecks).toBe(130);
      expect(native.writer).toEqual({ accepted: true, stage: 2, substage: 26 });
      expect(native.parsed).toEqual({ accepted: true, stage: 2, substage: 8 });
      expect(native.rows).toHaveLength(171);
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
    }, 16000);

    it('maps native admission refusals to exact stage-seven checkpoints', () => {
      const value = spawnSync(fixture, ['--admission-checkpoints'], {
        timeout: 8000,
        maxBuffer: 8192,
        windowsHide: true,
      });
      expect(value.error).toBeUndefined();
      expect(value.status).toBe(0);
      expect(value.stderr.length).toBe(0);
      expect(JSON.parse(value.stdout.toString('utf8')).rows).toEqual([
        { mode: 'precheck', checkpoint: 22 },
        { mode: 'connect-error', checkpoint: 2 },
        { mode: 'connect-timeout', checkpoint: 3 },
        { mode: 'framing', checkpoint: 4 },
        { mode: 'authentication', checkpoint: 5 },
        { mode: 'postcheck', checkpoint: 6 },
        { mode: 'message-timeout', checkpoint: 7 },
      ]);
    }, 10000);

    it('distinguishes reached early and poll prechecks with nested installed provenance', () => {
      const value = spawnSync(fixture, ['--precheck-checkpoints'], {
        timeout: 5000,
        maxBuffer: 8192,
        windowsHide: true,
      });
      expect(value.error).toBeUndefined();
      expect(value.status).toBe(0);
      expect(value.stderr.length).toBe(0);
      expect(JSON.parse(value.stdout.toString('utf8')).rows).toEqual([
        { mode: 'operation-entry', checkpoint: 9 },
        { mode: 'operation-publication', checkpoint: 8 },
        { mode: 'endpoint-inheritance', checkpoint: 14 },
        { mode: 'installed-fence-entry', checkpoint: 114 },
        { mode: 'installed-poll-entry', checkpoint: 214 },
        { mode: 'endpoint-deadline', checkpoint: 19 },
        { mode: 'endpoint-closed', checkpoint: 13 },
        { mode: 'endpoint-peer', checkpoint: 15 },
        { mode: 'poll-peer', checkpoint: 17 },
        { mode: 'admission-peer', checkpoint: 21 },
      ]);
    }, 7000);

    it('distinguishes accounting refusal and preserves singleton admission with owned cleanup', () => {
      const value = spawnSync(fixture, ['--accounting-controls'], {
        timeout: 8000,
        maxBuffer: 8192,
        windowsHide: true,
      });
      expect(value.error).toBeUndefined();
      expect(value.status).toBe(0);
      expect(value.stderr.length).toBe(0);
      expect(JSON.parse(value.stdout.toString('utf8'))).toEqual({
        syntheticChecks: 13,
        queryRefused: true,
        singletonAccepted: true,
        extraMemberRefused: true,
        ownedJobsEmpty: true,
      });
    }, 10000);

    it('binds installed-only inventory accounting, SYSTEM context and protected image rules', () => {
      const value = spawnSync(fixture, ['--installed-inventory-controls'], {
        timeout: 8000,
        maxBuffer: 8192,
        windowsHide: true,
      });
      expect(value.error).toBeUndefined();
      expect(value.status).toBe(0);
      expect(value.stderr.length).toBe(0);
      expect(JSON.parse(value.stdout.toString('utf8'))).toEqual({
        accountingChecks: 9,
        identityChecks: 6,
        protectionChecks: 5,
        nonSystemRefused: true,
        wrongBirthRefused: true,
        exitedRefused: true,
        ownedJobEmpty: true,
      });
    }, 10000);

    it('retains nullable main exit diagnostics only for an observed signaled process', () => {
      const phase = path.join(project, 'scripts/qualification/installed-owner-phase.ps1');
      const command = `
        . '${phase.replaceAll("'", "''")}'
        $rows = @()
        foreach ($signal in @($null, $false, $true, 'true', 1)) {
          foreach ($code in @($null, 2, 201, 208, 259, 4294967295L, -1, 4294967296L, '201', $true)) {
            $value = Get-InstalledOwnerAttemptObservation @{ mainSignaledBeforeCleanup = $signal; mainExitCode = $code; secret = 'excluded' } native
            $rows += @{ signal = $signal; code = $code; signalIncluded = $value.ContainsKey('mainSignaledBeforeCleanup'); codeIncluded = $value.ContainsKey('mainExitCode'); observed = $value['mainExitCode']; excluded = !$value.ContainsKey('secret') }
          }
        }
        ConvertTo-Json -InputObject $rows -Compress
      `;
      const result = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', command],
        { timeout: 10000, maxBuffer: 65536, windowsHide: true },
      );
      expect(result.status).toBe(0);
      expect(result.stderr.length).toBe(0);
      const rows = JSON.parse(result.stdout.toString('utf8'));
      expect(rows).toHaveLength(50);
      for (const row of rows) {
        expect(row.signalIncluded).toBe(row.signal === null || typeof row.signal === 'boolean');
        const admitted =
          row.code === null ||
          (row.signal === true &&
            Number.isInteger(row.code) &&
            row.code >= 0 &&
            row.code <= 4294967295);
        expect(row.codeIncluded).toBe(admitted);
        if (admitted) expect(row.observed).toBe(row.code);
        expect(row.excluded).toBe(true);
      }
    });

    it('retains only bounded native numeric checkpoints in host observations', () => {
      const phase = path.join(project, 'scripts/qualification/installed-owner-phase.ps1');
      const command = `
        . '${phase.replaceAll("'", "''")}'
        $rows = @()
        foreach ($stage in @(2, 5, 7, 8, 9, 10)) {
          foreach ($substage in @(-1) + @(0..255) + @('26', $true)) {
            $value = Get-InstalledOwnerAttemptObservation @{ supervisorStage = $stage; supervisorSubstage = $substage; arbitrary = 'excluded' } native
            $rows += @{ stage = $stage; input = $substage; included = $value.ContainsKey('supervisorSubstage'); value = $value['supervisorSubstage']; excluded = !$value.ContainsKey('arbitrary') }
          }
        }
        ConvertTo-Json -InputObject $rows -Compress
      `;
      const value = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', command],
        {
          timeout: 10000,
          maxBuffer: 262144,
          windowsHide: true,
        },
      );
      expect(value.error).toBeUndefined();
      expect(value.status).toBe(0);
      expect(value.stderr.length).toBe(0);
      const rows = JSON.parse(value.stdout.toString('utf8'));
      expect(rows).toHaveLength(1554);
      for (const row of rows) {
        const admitted =
          Number.isInteger(row.input) &&
          row.input >= 0 &&
          ((row.stage === 2 && row.input <= 44) ||
            (row.stage === 9 && row.input <= 24) ||
            (row.stage === 10 && row.input <= 6) ||
            (row.stage === 7 &&
              (row.input <= 22 ||
                (row.input >= 114 && row.input <= 126) ||
                (row.input >= 136 && row.input <= 144) ||
                (row.input >= 214 && row.input <= 226) ||
                (row.input >= 236 && row.input <= 244))));
        expect(row.included).toBe(admitted);
        expect(row.excluded).toBe(true);
        if (admitted) expect(row.value).toBe(row.input);
      }
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
