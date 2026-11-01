import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repository = path.resolve(import.meta.dirname, '../../..');
const project = path.join(repository, 'tests/fixtures/etw-broker-startup/EtwBrokerStartup.csproj');
const cases = [
  'gated-authentication-deposit-and-custody-order',
  'normal-without-custody',
  'preparation-between-hellos-and-custody-outlast-peer-budget',
  'default-eight-second-budgets-cross-former-shared-deadline',
  'global-cancellation-before-first-hello',
  'global-cancellation-between-hellos',
  'global-cancellation-during-primary',
  'global-cancellation-during-fallback',
  'global-cancellation-during-custody',
  'primary-peer-deadline',
  'fallback-peer-deadline',
  'late-primary-callback-cannot-ack',
  'late-fallback-callback-cannot-ack',
  'primary-authentication-refusal',
  'fallback-deposit-refusal',
  'custody-failure-after-both-acks',
  'invalid-primary-identities',
  'invalid-fallback-identities',
  'mismatched-reservation',
  'malformed-first-hello-frames',
  'malformed-second-hello-frames',
  'connection-budget-bounds',
];

describe.skipIf(process.platform !== 'win32')('actual broker startup sequence', () => {
  it('bounds independent authenticated peers and sends custody acknowledgements in order', () => {
    const parent = fs.realpathSync(process.env.AEGIS_ETW_BROKER_FIXTURE_OUTPUT || os.tmpdir());
    const root = fs.mkdtempSync(path.join(parent, 'aegis-broker-startup-'));
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
      NUGET_PACKAGES: process.env.NUGET_PACKAGES || path.join(root, 'packages'),
    };
    let stage = 'sdk';
    let passed = false;
    const run = (args, timeout) => {
      const result = spawnSync('dotnet', args, {
        cwd: repository,
        env,
        encoding: 'utf8',
        timeout,
        maxBuffer: 1024 * 1024 - 1024,
        windowsHide: true,
      });
      fs.writeFileSync(
        path.join(root, `${stage}.log`),
        `${result.stdout || ''}${result.stderr || ''}`,
      );
      if (result.error || result.status !== 0)
        throw new Error(`Broker startup fixture ${stage} failed; inspect ${root}`);
      return result.stdout;
    };
    try {
      if (!/^10\.\d+\.\d+\s+\[/m.test(run(['--list-sdks'], 10_000)))
        throw new Error(`Broker startup fixture requires installed .NET 10 SDK; inspect ${root}`);
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
        70_000,
      );
      stage = 'cases';
      const receipt = JSON.parse(
        run(
          [path.join(root, 'artifacts/bin/EtwBrokerStartup/release/EtwBrokerStartup.dll')],
          40_000,
        ).trim(),
      );
      expect(receipt).toMatchObject({
        schema: 'aegis-broker-startup-fixture/1',
        passed: cases.length,
        failed: 0,
        cases,
        productionAssembly: 'EtwFile',
        nativeAuthentication: false,
        etwInvoked: false,
        elevationRequested: false,
      });
      expect(receipt.productionAssemblySha256).toMatch(/^[a-f0-9]{64}$/);
      const inputs = [
        'sidecar/etw-file/FileBroker.cs',
        'sidecar/etw-file/FileBrokerStartup.cs',
        'sidecar/etw-file/FileGuardWire.cs',
        'sidecar/etw-file/FileWire.cs',
        'sidecar/etw-file/FileBrokerRecovery.cs',
        'sidecar/etw-file/EtwFile.csproj',
        ...fs
          .readdirSync(path.dirname(project))
          .filter((name) => name.endsWith('.cs') || name.endsWith('.csproj'))
          .map((name) => `tests/fixtures/etw-broker-startup/${name}`),
      ];
      const hashes = Object.fromEntries(
        inputs.map((name) => [
          name,
          createHash('sha256')
            .update(fs.readFileSync(path.join(repository, name)))
            .digest('hex'),
        ]),
      );
      fs.writeFileSync(
        path.join(root, 'receipt.json'),
        JSON.stringify({ status: 'PASS', ...receipt, hashes }, null, 2),
      );
      passed = true;
    } catch (error) {
      fs.writeFileSync(
        path.join(root, 'receipt.json'),
        JSON.stringify({ schema: 'aegis-broker-startup-fixture/1', status: 'FAIL', stage }),
      );
      throw error;
    } finally {
      if (
        passed &&
        process.env.AEGIS_ETW_BROKER_FIXTURE_KEEP !== '1' &&
        !fs.lstatSync(root).isSymbolicLink() &&
        path.dirname(fs.realpathSync(root)) === parent
      )
        fs.rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
