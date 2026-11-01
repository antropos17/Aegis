import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repository = path.resolve(import.meta.dirname, '../../..');
const project = path.join(repository, 'tests/fixtures/etw-guard-startup/EtwGuardStartup.csproj');
const cases = [
  'exit-before-connect',
  'zero-exit-before-connect',
  'exit-during-connect-cancels-io',
  'exit-during-broker-ack-releases-read',
  'exit-during-reserve-ack-releases-read',
  'delayed-valid-success',
  'shared-deadline-expires',
  'completed-operation-cannot-hide-exit',
  'late-completion-cannot-revive',
  'late-fault-cannot-revive',
  'canceled-watcher-is-not-peer-exit',
  'dispose-cancels-pending-io',
  'actual-owner-exit-three-before-connect',
  'actual-diagnostic-closed-peer-exit',
];

describe.skipIf(process.platform !== 'win32')('guard startup with the original child', () => {
  it('bounds startup by child lifetime and the shared deadline through the actual C# sources', () => {
    const parent = fs.realpathSync(os.tmpdir());
    const root = fs.mkdtempSync(path.join(parent, 'aegis-guard-startup-'));
    const temp = path.join(root, 'temp');
    fs.mkdirSync(temp);
    fs.writeFileSync(
      path.join(root, 'retention.json'),
      JSON.stringify({
        disposableDiagnosticsDays: 7,
        preserveFailedReceipts: true,
        automaticDeletion: false,
      }),
    );
    const env = {
      ...process.env,
      TEMP: temp,
      TMP: temp,
      DOTNET_CLI_HOME: path.join(root, 'dotnet-home'),
      DOTNET_CLI_TELEMETRY_OPTOUT: '1',
      DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
      DOTNET_NOLOGO: '1',
      DOTNET_CLI_USE_MSBUILD_SERVER: '0',
      MSBUILDDISABLENODEREUSE: '1',
      NUGET_PACKAGES: path.join(root, 'packages'),
    };
    let stage = 'sdk',
      passed = false;
    const run = (args, timeout) => {
      const result = spawnSync('dotnet', args, {
        cwd: repository,
        env,
        encoding: 'utf8',
        timeout,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
      });
      fs.writeFileSync(
        path.join(root, `${stage}.log`),
        `${result.stdout || ''}${result.stderr || ''}`,
      );
      if (result.error || result.status !== 0)
        throw new Error(`Guard startup fixture ${stage} failed; inspect ${root}`);
      return result.stdout;
    };
    try {
      const sdks = run(['--list-sdks'], 10_000);
      if (!/^10\.\d+\.\d+\s+\[/m.test(sdks))
        throw new Error(`Guard startup fixture requires installed .NET 10 SDK; inspect ${root}`);
      stage = 'build';
      run(
        [
          'build',
          project,
          '--artifacts-path',
          path.join(root, 'artifacts'),
          '--configuration',
          'Release',
          '--disable-build-servers',
        ],
        60_000,
      );
      stage = 'cases';
      const receipt = JSON.parse(
        run(
          [path.join(root, 'artifacts/bin/EtwGuardStartup/release/EtwGuardStartup.dll')],
          15_000,
        ).trim(),
      );
      expect(receipt).toEqual({
        schema: 'aegis-guard-startup-fixture/1',
        passed: cases.length,
        failed: 0,
        cases,
        etw: false,
        elevated: false,
      });
      passed = true;
    } catch (error) {
      fs.writeFileSync(
        path.join(root, 'receipt.json'),
        JSON.stringify({
          schema: 'aegis-guard-startup-fixture/1',
          status: 'FAIL',
          stage,
        }),
      );
      throw error;
    } finally {
      // This fresh exact directory contains only this fixture's disposable output.
      // Retain failures for review; never follow a substituted root link.
      if (
        passed &&
        !fs.lstatSync(root).isSymbolicLink() &&
        path.dirname(fs.realpathSync(root)) === parent
      )
        fs.rmSync(root, { recursive: true, force: true });
    }
  }, 90_000);
});
