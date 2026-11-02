import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repository = path.resolve(import.meta.dirname, '../../..');
const cases = [
  'baseline',
  'independent-service-latencies',
  'bad-guard-ack',
  'bad-broker-ack',
  'bad-guard-ack-broker-pending',
  'bad-broker-ack-guard-pending',
  'guard-exit-before-reserved',
];

describe.skipIf(process.platform !== 'win32')('production guard reservation choreography', () => {
  it('overlaps bounded independent preparation and still requires both valid acknowledgements', () => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), 'aegis-guard-choreography-'),
    );
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
      AEGIS_ETW_QUALIFICATION_COLLECTOR_DIAGNOSTICS: '1',
    };
    const run = (stage, args, timeout, extra = {}) => {
      const result = spawnSync('dotnet', args, {
        cwd: repository,
        env: { ...env, ...extra },
        encoding: 'utf8',
        timeout,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      });
      fs.writeFileSync(path.join(root, `${stage}.stdout.log`), result.stdout || '');
      fs.writeFileSync(path.join(root, `${stage}.stderr.log`), result.stderr || '');
      if (result.error || result.status !== 0)
        throw new Error(`Guard choreography fixture ${stage} failed; inspect ${root}`);
      return result.stdout;
    };
    const sdks = run('sdk', ['--list-sdks'], 10_000);
    expect(/^10\.\d+\.\d+\s+\[/m.test(sdks)).toBe(true);
    run(
      'build',
      [
        'build',
        path.join(repository, 'tests/fixtures/etw-guard-choreography/EtwGuardChoreography.csproj'),
        '--artifacts-path',
        path.join(root, 'artifacts'),
        '--configuration',
        'Release',
        '--disable-build-servers',
      ],
      60_000,
    );
    const executable = path.join(
      root,
      'artifacts/bin/EtwGuardChoreography/release/EtwGuardChoreography.dll',
    );
    const receipts = [];
    for (const name of cases) {
      const events = path.join(root, name);
      fs.mkdirSync(events);
      const receipt = JSON.parse(
        run(name, [executable, '--case', name], 15_000, {
          AEGIS_GUARD_FIXTURE_EVENTS: events,
        }).trim(),
      );
      const positive = name === 'baseline' || name === 'independent-service-latencies';
      expect(receipt).toMatchObject({
        schema: 'aegis-guard-choreography-fixture/1',
        status: 'PASS',
        case: name,
        guardOwnerStartupBudgetMs: 8000,
        ownerReturned: positive,
        reserveAcknowledged: positive,
        normalDisarm: positive,
        expectedRejection: !positive,
        actualPrimaryBrokerStartup: !name.startsWith('bad-broker-ack'),
        fallbackExercised: false,
        controlledAuthentication: true,
        nativeTraceCalls: false,
        elevation: false,
      });
      expect(receipt.elapsedMs).toBeLessThan(10_000);
      if (name === 'independent-service-latencies') {
        expect(receipt.guardAcknowledgedBeforeBroker).toBe(true);
        expect(receipt.elapsedMs).toBeGreaterThanOrEqual(6000);
      }
      if (name.endsWith('-pending')) {
        expect(receipt.otherAcknowledgementPendingOnRejection).toBe(true);
        expect(receipt.elapsedMs).toBeLessThan(5000);
      }
      receipts.push(receipt);
    }
    fs.writeFileSync(
      path.join(root, 'receipt.json'),
      JSON.stringify({ passed: receipts.length, receipts }, null, 2),
    );
  }, 90_000);
});
