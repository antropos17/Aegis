import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  prepareNativeReadWindow: vi.fn(),
  readFixture: vi.fn(),
  observeCustodian: vi.fn(),
  exitWithin: vi.fn(),
  until: vi.fn(),
  displayedRisk: vi.fn(),
}));

vi.mock('playwright', () => ({ _electron: { launch: mocks.launch } }));
vi.mock('../../scripts/produce-protected-gui-manifest.mjs', () => ({
  GUI_EXECUTABLE: 'AEGIS.exe',
}));
vi.mock('../../scripts/qualification/windows-native-read-support.mjs', () => ({
  until: mocks.until,
  evidence: vi.fn(),
  displayedRisk: mocks.displayedRisk,
  prepareNativeReadWindow: mocks.prepareNativeReadWindow,
  probeRetainedObjectRelease: vi.fn(),
}));
vi.mock('../../frontend/observatory/tests/etw-support.mjs', () => ({
  diagnostics: vi.fn(),
  readFixture: mocks.readFixture,
  observeQuit: vi.fn(),
  matchingRead: vi.fn(),
}));
vi.mock('../../frontend/observatory/tests/sensor-support.mjs', () => ({
  inspectProfile: vi.fn(),
  exitWithin: mocks.exitWithin,
}));
vi.mock('../../frontend/observatory/tests/etw-custodian-support.mjs', () => ({
  observeCustodian: mocks.observeCustodian,
}));

import { runNativeReadScenario } from '../../scripts/qualification/windows-native-read-scenario.mjs';
import {
  projectIssuerPreparationReadiness,
  recordIssuerPreparationReadiness,
  projectOperationalAdmission,
  readScannerSnapshotDiagnostic,
} from '../../scripts/qualification/windows-native-read-readiness.mjs';

const admissionFixture = () => ({
  qualified: true,
  qualification: {
    schema: 'aegis-etw-object-qualification/1',
    conditions: {
      qualified: true,
      revoked: false,
      scopePresent: true,
      contextPresent: true,
      contextActive: true,
      continuous: true,
      exactProfile: true,
    },
    continuity: {
      telemetryAvailable: true,
      operational: true,
      querySucceeded: true,
      eventsLostZero: true,
      realTimeBuffersLostZero: true,
      logBuffersLostZero: true,
      droppedZero: true,
      decoderErrorsZero: true,
      mapEpochZero: true,
      mapResetsZero: true,
      mapConflictsZero: true,
      stickyClear: true,
    },
    firstRevocation: null,
  },
});

describe('actual native-read scenario launch composition', () => {
  let app;
  let fixture;
  let observer;
  let receipt;
  let output;
  let temporaryRoot;

  beforeEach(() => {
    vi.clearAllMocks();
    temporaryRoot = fs.realpathSync(os.tmpdir());
    output = fs.mkdtempSync(path.join(temporaryRoot, 'native-identity-scenario-'));
    receipt = { reads: [] };
    fixture = {
      child: { pid: 42, exitCode: null },
      next: vi.fn().mockResolvedValue({ pid: 42, birth: '123', shareDelete: false }),
      windowDpi: vi.fn().mockResolvedValue({
        command: 'window-dpi',
        schema: 'aegis-window-dpi/1',
        windowExists: true,
        ownerMatched: true,
        dpi: 96,
      }),
      close: vi.fn(async () => {
        fixture.child.exitCode = 0;
      }),
    };
    observer = {
      child: { exitCode: null },
      until: vi.fn().mockResolvedValue({ type: 'endpoint', address: 'owned-endpoint' }),
      stop: vi.fn(() => {
        observer.child.exitCode = 0;
      }),
      settled: vi.fn(),
    };
    app = {
      process: vi.fn(() => ({ pid: 84 })),
      close: vi.fn(),
    };
    mocks.readFixture.mockReturnValue(fixture);
    mocks.observeCustodian.mockReturnValue(observer);
    mocks.exitWithin.mockResolvedValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    const resolved = fs.realpathSync(output);
    if (
      resolved !== output ||
      path.dirname(resolved) !== temporaryRoot ||
      !path.basename(resolved).startsWith('native-identity-scenario-') ||
      fs.lstatSync(resolved).isSymbolicLink()
    )
      throw new Error('identity-fixture-cleanup-boundary');
    fs.rmSync(resolved, { recursive: true, force: true });
  });

  it('retains a closed reader failure before cleanup changes its observed exit state', async () => {
    const diagnostic = {
      phase: 'ready',
      expectedCommand: 'ready',
      stdoutBytes: 80,
      stderrBytes: 12,
      queuedLines: 0,
      exitCode: null,
      signalCode: null,
      stdoutEnded: true,
      stdinFailed: false,
      privateOutput: 'PRIVATE_READER_CANARY',
    };
    fixture.next.mockRejectedValue(
      Object.assign(new Error('Read fixture refused: stdout-ended'), {
        code: 'AEGIS_READ_FIXTURE_STDOUT_ENDED',
        fixtureDiagnostic: diagnostic,
      }),
    );
    fixture.close.mockImplementation(async () => {
      diagnostic.exitCode = 0;
      diagnostic.phase = 'close';
      fixture.child.exitCode = 0;
    });
    await expect(
      runNativeReadScenario({
        fixtureExe: 'fixture.exe',
        file: 'X:/owned/.env',
        out: output,
        env: {},
        r: receipt,
      }),
    ).rejects.toThrow('Read fixture refused: stdout-ended');
    expect(mocks.launch).not.toHaveBeenCalled();
    expect(receipt.fixtureExit).toBe(0);
    expect(receipt.fixtureFailure).toMatchObject({
      schema: 'aegis-read-fixture-failure/1',
      failureCode: 'stdout-ended',
      phase: 'ready',
      exitCode: null,
    });
    expect(Object.isFrozen(receipt.fixtureFailure)).toBe(true);
    expect(JSON.stringify(receipt.fixtureFailure)).not.toContain('PRIVATE_READER_CANARY');
  });

  it('does not invent a reader diagnostic from an unrelated scenario error', async () => {
    fixture.next.mockRejectedValue(new Error('Unrelated startup refusal'));
    await expect(
      runNativeReadScenario({
        fixtureExe: 'fixture.exe',
        file: 'X:/owned/.env',
        out: output,
        env: {},
        r: receipt,
      }),
    ).rejects.toThrow('Unrelated startup refusal');
    expect(receipt.fixtureFailure).toBeUndefined();
    expect(fixture.close).toHaveBeenCalledOnce();
  });

  it('consumes sanitized command diagnostics after cleanup while preserving the original failure projection', async () => {
    fixture.next.mockRejectedValue(
      Object.assign(new Error('Read fixture refused: timeout'), {
        code: 'AEGIS_READ_FIXTURE_TIMEOUT',
        fixtureDiagnostic: {
          phase: 'command',
          expectedCommand: 'sync',
          stdoutBytes: 245,
          stderrBytes: 100,
          queuedLines: 0,
          exitCode: null,
          signalCode: null,
          stdoutEnded: false,
          stdinFailed: false,
        },
      }),
    );
    const atFailure = {
      writeCompleted: true,
      metadataPresent: true,
      accepted: true,
      opened: true,
      completedReads: 32,
      completed: false,
      metadataInvalid: false,
      elapsedMs: 12000,
    };
    fixture.commandDiagnostic = vi.fn(() => ({
      schema: 'aegis-read-fixture-command/1',
      command: 'sync',
      atFailure,
      afterClose: { ...atFailure, completedReads: 160, completed: true, elapsedMs: 13000 },
      completionObservedAfterFailure: true,
      closeConfirmed: true,
      privateOutput: 'PRIVATE_READER_CANARY',
    }));
    await expect(
      runNativeReadScenario({
        fixtureExe: 'fixture.exe',
        file: 'X:/owned/.env',
        out: output,
        env: {},
        r: receipt,
      }),
    ).rejects.toThrow('Read fixture refused: timeout');
    expect(receipt.fixtureFailure).toMatchObject({ failureCode: 'timeout', exitCode: null });
    expect(receipt.fixtureCommandDiagnostic).toMatchObject({
      atFailure: { completedReads: 32 },
      afterClose: { completedReads: 160 },
      completionObservedAfterFailure: true,
      closeConfirmed: true,
    });
    expect(fixture.close.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.commandDiagnostic.mock.invocationCallOrder[0],
    );
    expect(JSON.stringify(receipt)).not.toContain('PRIVATE_READER_CANARY');
  });

  it('retains a cleanup-only reader refusal without replacing the original scenario failure', async () => {
    fixture.next.mockRejectedValue(new Error('Unrelated startup refusal'));
    fixture.close.mockRejectedValue(
      Object.assign(new Error('Read fixture refused: close-unconfirmed'), {
        code: 'AEGIS_READ_FIXTURE_CLOSE_UNCONFIRMED',
        fixtureDiagnostic: {
          phase: 'close',
          expectedCommand: null,
          stdoutBytes: 0,
          stderrBytes: 0,
          queuedLines: 0,
          exitCode: null,
          signalCode: null,
          stdoutEnded: false,
          stdinFailed: false,
        },
      }),
    );
    await expect(
      runNativeReadScenario({
        fixtureExe: 'fixture.exe',
        file: 'X:/owned/.env',
        out: output,
        env: {},
        r: receipt,
      }),
    ).rejects.toThrow('Unrelated startup refusal');
    expect(receipt.fixtureFailure).toMatchObject({
      failureCode: 'close-unconfirmed',
      phase: 'close',
    });
    expect(receipt.fixtureCleanupUnconfirmed).toBe(true);
  });

  it('lets the real scenario cross a 45 second cold connection under the 90 second bound', async () => {
    vi.useFakeTimers();
    mocks.launch.mockImplementation(
      (options) =>
        new Promise((resolve, reject) => {
          setTimeout(() => {
            if (options.timeout < 45_000)
              reject(Object.assign(new Error('too early'), { name: 'TimeoutError' }));
            else resolve(app);
          }, 45_000);
        }),
    );
    const target = { handle: '1234', mainPid: 73 };
    mocks.prepareNativeReadWindow.mockImplementation(
      async (_app, _destination, _env, _receipt, queryDpi) => {
        await queryDpi(target);
        throw new Error('stop after launch composition');
      },
    );

    const pending = runNativeReadScenario({
      fixtureExe: 'fixture.exe',
      file: 'X:/owned/.env',
      out: output,
      env: {},
      r: receipt,
      canary: 'canary',
      candidate: 'X:/owned/candidate',
      helper: 'helper.exe',
    });
    const rejection = expect(pending).rejects.toThrow('stop after launch composition');
    await vi.advanceTimersByTimeAsync(45_000);
    await rejection;

    expect(mocks.launch).toHaveBeenCalledWith(expect.objectContaining({ timeout: 90_000 }));
    expect(receipt.launch).toMatchObject({
      phase: 'connected',
      returned: true,
      timeoutMilliseconds: 90_000,
      elapsedMilliseconds: 45_000,
    });
    expect(mocks.prepareNativeReadWindow).toHaveBeenCalledOnce();
    expect(fixture.windowDpi).toHaveBeenCalledWith(target);
    expect(fixture.close).toHaveBeenCalledOnce();
    expect(app.close).toHaveBeenCalledOnce();
    expect(observer.stop).toHaveBeenCalledOnce();
  });

  it('projects a launch timeout before cleanup without retaining the raw failure', async () => {
    const privateValue = 'PRIVATE_CANARY_C:\\Users\\owner\\profile';
    mocks.launch.mockRejectedValue(
      Object.assign(new Error(privateValue), { name: 'TimeoutError' }),
    );

    const pending = runNativeReadScenario({
      fixtureExe: 'fixture.exe',
      file: 'X:/owned/.env',
      out: output,
      env: {},
      r: receipt,
      canary: 'canary',
      candidate: 'X:/owned/candidate',
      helper: 'helper.exe',
    });

    await expect(pending).rejects.toThrow('Native-read Electron launch timed out');
    expect(JSON.stringify(receipt.launch)).not.toContain(privateValue);
    expect(receipt.launch).toMatchObject({
      phase: 'failed',
      returned: false,
      failureCode: 'timeout',
    });
    expect(mocks.prepareNativeReadWindow).not.toHaveBeenCalled();
    expect(fixture.close).toHaveBeenCalledOnce();
    expect(app.close).not.toHaveBeenCalled();
    expect(observer.stop).toHaveBeenCalledOnce();
  });

  it('retains the failed scanner condition through the actual scenario timeout and cleanup', async () => {
    const controls = {
      getByRole: () => controls,
      waitFor: vi.fn(),
      click: vi.fn(),
      check: vi.fn(),
    };
    app.firstWindow = vi.fn().mockResolvedValue({
      getByRole: () => controls,
      evaluate: vi.fn(),
    });
    mocks.launch.mockResolvedValue(app);
    app.evaluate = vi.fn((read) =>
      read({ app: {} }, (name) =>
        name.endsWith('/process-snapshot.js')
          ? {
              getSnapshotHealth: () => ({
                state: 'FAILED',
                detail: 'none',
                lastError: 'PRIVATE_ERROR',
              }),
              getSourceStats: () => ({ lastSource: 'none', transitions: 2 }),
              getMode: () => 'auto',
            }
          : {
              getState: () => ({
                connected: false,
                sticky: 'PRIVATE_FAILURE',
                failures: 3,
                caps: null,
              }),
            },
      ),
    );
    mocks.prepareNativeReadWindow.mockResolvedValue(undefined);
    mocks.until.mockImplementationOnce(async (_read, accept, ms, message) => {
      expect(ms).toBe(30_000);
      expect(message).toBe('Actual reliable scanner identity unavailable');
      expect(
        accept({
          readiness: {
            populationReliable: false,
            identityDegraded: false,
            monitoringPaused: false,
          },
          agents: [{ pid: 42, instanceIdSource: 'os', createTime100ns: '123', name: 'PRIVATE' }],
        }),
      ).toBe(false);
      throw new Error(message);
    });
    app.close.mockImplementationOnce(async () => {
      const checkpoint = JSON.parse(
        fs.readFileSync(path.join(output, 'identity-diagnostic.json'), 'utf8'),
      );
      expect(checkpoint.phase).toBe('failed');
      expect(checkpoint.firstFailure.diagnostic.state).toBe('FAILED');
    });

    await expect(
      runNativeReadScenario({
        fixtureExe: 'fixture.exe',
        file: 'X:/owned/.env',
        out: output,
        env: {},
        r: receipt,
        canary: 'canary',
        candidate: 'X:/owned/candidate',
        helper: 'helper.exe',
      }),
    ).rejects.toThrow('Actual reliable scanner identity unavailable');

    expect(receipt.identityWait).toMatchObject({
      samples: 1,
      last: {
        accepted: false,
        populationReliable: false,
        identityNonDegraded: true,
        monitoringActive: true,
        actorExactMatch: true,
      },
    });
    expect(JSON.stringify(receipt.identityWait)).not.toContain('PRIVATE');
    expect(app.evaluate).toHaveBeenCalledExactlyOnceWith(readScannerSnapshotDiagnostic);
    expect(receipt.identityWait.snapshotDiagnostic).toMatchObject({
      snapshotAvailable: true,
      clientAvailable: true,
      state: 'FAILED',
      source: 'none',
      mode: 'auto',
      stickyPresent: true,
      failures: 3,
    });
    expect(app.evaluate.mock.invocationCallOrder[0]).toBeLessThan(
      app.close.mock.invocationCallOrder[0],
    );
    expect(receipt.reads).toEqual([]);
    expect(fixture.close).toHaveBeenCalledOnce();
    expect(app.close).toHaveBeenCalledOnce();
    expect(observer.stop).toHaveBeenCalledOnce();
  });

  it.each(['timeout', 'rejection'])(
    'preserves the original scanner failure through diagnostic %s and cleanup',
    async (mode) => {
      vi.useFakeTimers();
      const controls = {
        getByRole: () => controls,
        waitFor: vi.fn(),
        click: vi.fn(),
        check: vi.fn(),
      };
      app.firstWindow = vi.fn().mockResolvedValue({ getByRole: () => controls, evaluate: vi.fn() });
      app.evaluate = vi.fn(() =>
        mode === 'timeout'
          ? new Promise(() => {})
          : Promise.reject(new Error('PRIVATE_TRANSPORT_FAILURE')),
      );
      mocks.launch.mockResolvedValue(app);
      mocks.prepareNativeReadWindow.mockResolvedValue(undefined);
      mocks.until.mockRejectedValueOnce(new Error('Actual reliable scanner identity unavailable'));
      const pending = runNativeReadScenario({
        fixtureExe: 'fixture.exe',
        file: 'X:/owned/.env',
        out: output,
        env: {},
        r: receipt,
        candidate: 'X:/owned/candidate',
        helper: 'helper.exe',
      });
      const rejection = expect(pending).rejects.toThrow(
        'Actual reliable scanner identity unavailable',
      );
      await vi.advanceTimersByTimeAsync(1000);
      await rejection;
      expect(receipt.identityWait.snapshotDiagnostic).toEqual(readScannerSnapshotDiagnostic({}));
      expect(app.evaluate).toHaveBeenCalledOnce();
      expect(fixture.close).toHaveBeenCalledOnce();
      expect(app.close).toHaveBeenCalledOnce();
      expect(receipt.reads).toEqual([]);
    },
  );

  it('retains preparation conditions and refuses an ended capture before polling again or cleanup', async () => {
    const controls = {
      getByRole: () => controls,
      waitFor: vi.fn(),
      click: vi.fn(),
      check: vi.fn(),
    };
    app.firstWindow = vi.fn().mockResolvedValue({ getByRole: () => controls, evaluate: vi.fn() });
    mocks.launch.mockResolvedValue(app);
    mocks.prepareNativeReadWindow.mockResolvedValue(undefined);
    fixture.command = vi.fn();
    const scanner = {
      readiness: { populationReliable: true, identityDegraded: false, monitoringPaused: false },
      agents: [{ pid: 42, instanceIdSource: 'os', createTime100ns: '123' }],
    };
    const terminal = {
      phase: 'failed',
      issuerPreparation: null,
      restartBlocked: true,
      recoveryPending: false,
      cleanupConsentPending: false,
      summaries: [
        {
          phase: 'failed',
          reasons: ['protocol-failed'],
          stopReason: null,
          exitCode: 2,
          stopVerified: false,
          recoveryVerified: false,
          launchId: 'PRIVATE_SESSION',
          capture: 'PRIVATE_CAPTURE',
        },
      ],
    };
    let samples = 0;
    mocks.until
      .mockImplementationOnce(async (_read, accept) => {
        expect(accept(scanner)).toBe(true);
        return scanner;
      })
      .mockImplementationOnce(async (_read, accept, ms, message) => {
        expect(ms).toBe(30000);
        expect(message).toBe('Native issuer preparation did not complete');
        samples++;
        expect(accept({ phase: 'starting', issuerPreparation: null })).toBe(false);
        samples++;
        accept(terminal);
        samples++;
        throw new Error('fixture-terminal-polled-again');
      });
    fixture.close.mockImplementation(async () => {
      terminal.phase = 'stopped';
      terminal.summaries[0].exitCode = 0;
      fixture.child.exitCode = 0;
    });
    await expect(
      runNativeReadScenario({
        fixtureExe: 'fixture.exe',
        file: 'X:/owned/.env',
        out: output,
        env: {},
        r: receipt,
        candidate: 'X:/owned/candidate',
        helper: 'helper.exe',
      }),
    ).rejects.toThrow('Native issuer preparation refused: capture-ended');
    expect(samples).toBe(2);
    expect(receipt.issuerPreparationWait).toMatchObject({
      samples: 2,
      first: { capturePhase: 'starting', captureRunning: false, preparationAvailable: false },
      last: {
        capturePhase: 'failed',
        captureRunning: false,
        accepted: false,
        captureEnded: true,
        latestSummary: {
          phase: 'failed',
          reasons: ['protocol-failed'],
          stopReason: null,
          exitCode: 2,
        },
      },
    });
    expect(Object.isFrozen(receipt.issuerPreparationWait.first)).toBe(true);
    expect(Object.isFrozen(receipt.issuerPreparationWait.last)).toBe(true);
    expect(JSON.stringify(receipt.issuerPreparationWait)).not.toMatch(
      /PRIVATE|"pid"|"birth"|"createTime100ns"/,
    );
    expect(fixture.command).not.toHaveBeenCalled();
    expect(fixture.close).toHaveBeenCalledOnce();
    expect(app.close).toHaveBeenCalledOnce();
    expect(observer.stop).toHaveBeenCalledOnce();
  });

  it('retains every admission condition and first revocation before immediate refusal and cleanup', async () => {
    const controls = {
      getByRole: () => controls,
      waitFor: vi.fn(),
      click: vi.fn(),
      check: vi.fn(),
    };
    const admission = admissionFixture();
    admission.qualified = false;
    Object.assign(admission.qualification.conditions, {
      qualified: false,
      revoked: true,
      continuous: false,
      exactProfile: false,
    });
    Object.assign(admission.qualification.continuity, {
      querySucceeded: false,
      eventsLostZero: false,
      mapEpochZero: false,
    });
    admission.qualification.firstRevocation = {
      cause: 'both',
      conditions: { ...admission.qualification.conditions },
      continuity: { ...admission.qualification.continuity },
    };
    const page = {
      getByRole: () => controls,
      evaluate: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ admission, raw: 'PRIVATE_PATH_GUID_CLOCK' }),
    };
    app.firstWindow = vi.fn().mockResolvedValue(page);
    mocks.launch.mockResolvedValue(app);
    mocks.prepareNativeReadWindow.mockResolvedValue(undefined);
    fixture.command = vi.fn();
    mocks.until
      .mockImplementationOnce(async () => ({ agents: [{ pid: 42, createTime100ns: '123' }] }))
      .mockImplementationOnce(async (_read, accept) => {
        expect(
          accept({
            phase: 'running',
            issuerPreparation: { prepared: [{ pid: 42, createTime100ns: '123', threads: 2 }] },
          }),
        ).toBe(true);
      });
    fixture.close.mockImplementation(async () => {
      admission.qualified = true;
      admission.qualification.conditions.revoked = false;
      admission.qualification.continuity.querySucceeded = true;
      admission.qualification.firstRevocation.cause = 'PRIVATE_CAUSE';
      fixture.child.exitCode = 0;
    });
    await expect(
      runNativeReadScenario({
        fixtureExe: 'fixture.exe',
        file: 'X:/owned/.env',
        out: output,
        env: {},
        r: receipt,
        candidate: 'X:/owned/candidate',
        helper: 'helper.exe',
      }),
    ).rejects.toThrow('Native object admission unavailable: revoked-both');
    expect(receipt.operationalAdmission).toMatchObject({
      qualified: false,
      qualificationValid: true,
      accepted: false,
      refusalCode: 'revoked-both',
      qualification: {
        conditions: { revoked: true, continuous: false, exactProfile: false },
        continuity: { querySucceeded: false, eventsLostZero: false, mapEpochZero: false },
        firstRevocation: {
          cause: 'both',
          conditions: { revoked: true },
          continuity: { querySucceeded: false },
        },
      },
    });
    expect(Object.keys(receipt.operationalAdmission.qualification.conditions)).toHaveLength(7);
    expect(Object.keys(receipt.operationalAdmission.qualification.continuity)).toHaveLength(12);
    expect(
      Object.isFrozen(receipt.operationalAdmission.qualification.firstRevocation.conditions),
    ).toBe(true);
    expect(JSON.stringify(receipt.operationalAdmission)).not.toMatch(
      /PRIVATE|"pid"|"createTime100ns"/,
    );
    expect(mocks.until).toHaveBeenCalledTimes(2);
    expect(observer.until).toHaveBeenCalledOnce();
    expect(fixture.command).not.toHaveBeenCalled();
    expect(mocks.displayedRisk).not.toHaveBeenCalled();
    expect(fixture.close).toHaveBeenCalledOnce();
    expect(app.close).toHaveBeenCalledOnce();
  });

  it('continues the strictly qualified capture immediately without adding another readiness wait', async () => {
    const controls = {
      getByRole: () => controls,
      waitFor: vi.fn(),
      click: vi.fn(),
      check: vi.fn(),
    };
    app.firstWindow = vi.fn().mockResolvedValue({
      getByRole: () => controls,
      evaluate: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ admission: admissionFixture() }),
    });
    mocks.launch.mockResolvedValue(app);
    mocks.prepareNativeReadWindow.mockResolvedValue(undefined);
    mocks.until
      .mockImplementationOnce(async () => ({ agents: [{ pid: 42, createTime100ns: '123' }] }))
      .mockImplementationOnce(async (_read, accept) => {
        expect(
          accept({
            phase: 'running',
            issuerPreparation: { prepared: [{ pid: 42, createTime100ns: '123', threads: 2 }] },
          }),
        ).toBe(true);
      });
    observer.until
      .mockResolvedValueOnce({ type: 'endpoint', address: 'owned-endpoint' })
      .mockRejectedValueOnce(new Error('fixture-after-qualified-admission'));
    await expect(
      runNativeReadScenario({
        fixtureExe: 'fixture.exe',
        file: 'X:/owned/.env',
        out: output,
        env: {},
        r: receipt,
        candidate: 'X:/owned/candidate',
        helper: 'helper.exe',
      }),
    ).rejects.toThrow('fixture-after-qualified-admission');
    expect(receipt.operationalAdmission).toMatchObject({
      qualified: true,
      qualificationValid: true,
      accepted: true,
      refusalCode: null,
    });
    expect(mocks.until).toHaveBeenCalledTimes(2);
    expect(observer.until).toHaveBeenCalledTimes(2);
    expect(mocks.displayedRisk).not.toHaveBeenCalled();
  });

  it('uses the owned-profile Settings flow before subscribing in the Simple investigation workspace', async () => {
    let simple = false;
    let workspace = 'Monitoring';
    const actions = [];
    const navigation = {
      getByRole(role, { name, exact }) {
        expect(role).toBe('button');
        expect(exact).toBe(true);
        return {
          async click() {
            actions.push(name);
            if (name === 'Settings') workspace = 'Settings';
            else if (name === 'Investigate' && simple) workspace = 'Investigate';
            else throw new Error('Requested workspace is unavailable in the current mode');
          },
        };
      },
    };
    const page = {
      getByRole(role, options) {
        if (role === 'navigation' && options.name === 'Main navigation') return navigation;
        if (role === 'heading')
          return {
            async waitFor() {
              expect(workspace).toBe(options.name);
            },
          };
        if (role === 'checkbox' && options.name === 'Simple interface')
          return {
            async check() {
              expect(workspace).toBe('Settings');
              simple = true;
              actions.push('Simple interface');
            },
          };
        if (role === 'region' && options.name === 'Investigation workspace')
          return {
            async waitFor() {
              expect(simple && workspace === 'Investigate').toBe(true);
              actions.push('workspace-ready');
            },
          };
        throw new Error('Unscoped or unavailable UI control');
      },
      evaluate: vi.fn(async () => {
        expect(actions.at(-1)).toBe('workspace-ready');
        actions.push('subscribe');
      }),
    };
    app.firstWindow = vi.fn().mockResolvedValue(page);
    mocks.launch.mockResolvedValue(app);
    mocks.prepareNativeReadWindow.mockResolvedValue(undefined);
    mocks.until.mockRejectedValue(new Error('stop before native readiness'));

    await expect(
      runNativeReadScenario({
        fixtureExe: 'fixture.exe',
        file: 'X:/owned/.env',
        out: output,
        env: {},
        r: receipt,
        canary: 'canary',
        candidate: 'X:/owned/candidate',
        helper: 'helper.exe',
      }),
    ).rejects.toThrow('stop before native readiness');

    expect(actions).toEqual([
      'Settings',
      'Simple interface',
      'Investigate',
      'workspace-ready',
      'subscribe',
    ]);
    expect(page.evaluate).toHaveBeenCalledOnce();
    expect(mocks.launch).toHaveBeenCalledOnce();
    expect(fixture.close).toHaveBeenCalledOnce();
    expect(app.close).toHaveBeenCalledOnce();
    expect(observer.stop).toHaveBeenCalledOnce();
  });
});

describe('issuer preparation readiness projection', () => {
  const witness = { pid: 42, birth: '123' };
  const prepared = () => ({
    phase: 'running',
    issuerPreparation: { prepared: [{ pid: 42, createTime100ns: '123', threads: 2 }] },
  });
  const ended = (phase = 'failed') => ({
    phase,
    recoveryPending: false,
    cleanupConsentPending: false,
    summaries: [
      {
        phase,
        reasons: ['protocol-failed'],
        stopReason: null,
        exitCode: phase === 'stopped' ? 0 : phase === 'recovered' ? 4 : 2,
        stopVerified: phase === 'stopped',
        recoveryVerified: phase === 'recovered',
      },
    ],
  });

  it('continues from starting to exact prepared identity without extending or bypassing the wait', () => {
    const receipt = { samples: 0, first: null, last: null };
    expect(recordIssuerPreparationReadiness({ phase: 'starting' }, witness, receipt)).toBe(false);
    expect(recordIssuerPreparationReadiness(prepared(), witness, receipt)).toBe(true);
    expect(receipt).toMatchObject({
      samples: 2,
      first: { capturePhase: 'starting', accepted: false },
      last: { capturePhase: 'running', actorExactMatch: true, accepted: true },
    });
    for (const value of [
      null,
      { phase: 'running' },
      { phase: 'running', issuerPreparation: { prepared: {} } },
      { phase: 'running', issuerPreparation: { prepared: [null] } },
      { phase: 'running', issuerPreparation: { prepared: [{ pid: 42, createTime100ns: '0123' }] } },
      {
        phase: 'running',
        issuerPreparation: {
          prepared: [
            { pid: 42, createTime100ns: '124' },
            { pid: 43, createTime100ns: '123' },
          ],
        },
      },
      { ...prepared(), phase: 'starting' },
    ])
      expect(projectIssuerPreparationReadiness(value, witness).accepted).toBe(false);
  });

  it('requires matching validated ended summary and strict false pending flags before refusing', () => {
    for (const phase of ['failed', 'stopped', 'recovered']) {
      const value = ended(phase);
      expect(projectIssuerPreparationReadiness(value, witness).captureEnded).toBe(true);
      expect(() =>
        recordIssuerPreparationReadiness(value, witness, { samples: 0, first: null, last: null }),
      ).toThrow('Native issuer preparation refused: capture-ended');
    }
    for (const value of [
      { ...ended(), phase: 'starting' },
      { ...ended(), phase: 'recovering' },
      { ...ended(), recoveryPending: true },
      { ...ended(), cleanupConsentPending: true },
      { ...ended(), recoveryPending: undefined },
      { ...ended(), cleanupConsentPending: null },
      { ...ended(), recoveryPending: 'false' },
      { ...ended(), cleanupConsentPending: 0 },
      { ...ended(), summaries: [] },
      { ...ended(), summaries: [null] },
      { ...ended(), summaries: [{ ...ended().summaries[0], phase: 'stopped' }] },
      { ...ended(), summaries: [{ ...ended().summaries[0], exitCode: null }] },
      { ...ended(), summaries: [{ ...ended().summaries[0], exitCode: 2 ** 40 }] },
      { ...ended(), summaries: [{ ...ended().summaries[0], stopReason: 'PRIVATE' }] },
      { ...ended(), summaries: [{ ...ended().summaries[0], reasons: ['PRIVATE'] }] },
      { ...ended(), summaries: [{ ...ended().summaries[0], stopVerified: 'false' }] },
      { ...ended(), summaries: [{ ...ended().summaries[0], recoveryVerified: undefined }] },
      { ...ended('stopped'), summaries: [{ ...ended('stopped').summaries[0], exitCode: 2 }] },
      {
        ...ended('recovered'),
        summaries: [{ ...ended('recovered').summaries[0], recoveryVerified: false }],
      },
    ])
      expect(projectIssuerPreparationReadiness(value, witness).captureEnded).toBe(false);
  });

  it('retains a closed duration-limit reason and finite exit without copying raw summary data', () => {
    const value = ended('stopped');
    Object.assign(value.summaries[0], {
      stopReason: 'duration-limit',
      exitCode: 0,
      launchId: 'PRIVATE_GUID',
      sessionId: 'PRIVATE_GUID',
      capture: { path: 'PRIVATE_PATH' },
      reason: 'PRIVATE_ERROR',
    });
    value.issuerPreparation = {
      requestId: 'PRIVATE_REQUEST',
      prepared: [{ pid: 42, createTime100ns: '123' }],
    };
    const result = projectIssuerPreparationReadiness(value, witness);
    expect(result.latestSummary).toMatchObject({
      stopReason: 'duration-limit',
      stopReasonKnown: true,
      exitCode: 0,
      exitCodeKnown: true,
      valid: true,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /PRIVATE|"pid"|"createTime100ns"|"sessionId"|"launchId"/,
    );
    expect(Object.isFrozen(result.latestSummary.reasons)).toBe(true);
    expect(Object.keys(result.latestSummary)).toEqual([
      'phase',
      'reasons',
      'reasonsKnown',
      'stopReason',
      'stopReasonKnown',
      'exitCode',
      'exitCodeKnown',
      'valid',
    ]);
  });

  it('retains only immutable first/latest conditions and saturates the sample count', () => {
    const receipt = { samples: 0, first: null, last: null };
    const value = { phase: 'starting', issuerPreparation: null };
    for (let sample = 0; sample < 600; sample++)
      recordIssuerPreparationReadiness(value, witness, receipt);
    value.phase = 'PRIVATE';
    recordIssuerPreparationReadiness(null, witness, receipt);
    expect(Object.keys(receipt)).toEqual(['samples', 'first', 'last']);
    expect(receipt.samples).toBe(512);
    expect(receipt.first.capturePhase).toBe('starting');
    expect(receipt.last.capturePhase).toBe('unknown');
    expect(Object.isFrozen(receipt.first)).toBe(true);
    expect(JSON.stringify(receipt)).not.toContain('PRIVATE');
    expect(JSON.stringify(receipt).length).toBeLessThan(2000);
  });
});

describe('closed operational admission projection', () => {
  it('copies only the complete contract and preserves the existing qualified authority', () => {
    const admission = admissionFixture();
    for (const key of Object.keys(admission.qualification.continuity))
      admission.qualification.continuity[key] = false;
    const result = projectOperationalAdmission({ admission, raw: 'PRIVATE_PATH_GUID_CLOCK' });
    expect(result).toMatchObject({
      qualified: true,
      qualificationValid: true,
      accepted: true,
      refusalCode: null,
    });
    expect(Object.isFrozen(result.qualification.continuity)).toBe(true);
    expect(Object.keys(result)).toEqual([
      'schema',
      'admissionAvailable',
      'qualified',
      'qualificationValid',
      'accepted',
      'refusalCode',
      'qualification',
    ]);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('rejects unknown, malformed and inconsistent data without granting qualification', () => {
    const controls = [
      (a) => {
        a.qualified = 'true';
      },
      (a) => {
        a.qualified = false;
      },
      (a) => {
        a.qualification.schema = 'PRIVATE_SCHEMA';
      },
      (a) => {
        delete a.qualification.continuity.querySucceeded;
      },
      (a) => {
        a.qualification.conditions.contextActive = 'true';
      },
      (a) => {
        a.qualification.conditions.extra = 'PRIVATE_ID';
      },
      (a) => {
        a.qualification.conditions.qualified = false;
      },
      (a) => {
        a.qualification.firstRevocation = {
          cause: 'PRIVATE_CAUSE',
          conditions: {},
          continuity: {},
        };
      },
      (a) => {
        a.qualification.conditions.revoked = true;
      },
      (a) => {
        a.qualification.conditions.contextPresent = false;
      },
    ];
    for (const change of controls) {
      const admission = admissionFixture();
      change(admission);
      const result = projectOperationalAdmission({ admission });
      expect(result.accepted).toBe(false);
      expect(result.refusalCode).toBe('invalid-qualification');
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
    }
    for (const view of [null, {}, { admission: { qualified: false } }, { admission: null }])
      expect(projectOperationalAdmission(view)).toMatchObject({
        accepted: false,
        refusalCode: 'invalid-qualification',
      });
  });

  it('retains each first revocation cause after current conditions recover without requalifying', () => {
    for (const cause of ['explicit', 'continuity', 'profile', 'both']) {
      const admission = admissionFixture();
      admission.qualified = false;
      Object.assign(admission.qualification.conditions, { qualified: false, revoked: true });
      const conditions = { ...admission.qualification.conditions };
      if (cause === 'continuity' || cause === 'both') conditions.continuous = false;
      if (cause === 'profile' || cause === 'both') conditions.exactProfile = false;
      admission.qualification.firstRevocation = {
        cause,
        conditions,
        continuity: { ...admission.qualification.continuity },
      };
      const result = projectOperationalAdmission({ admission });
      expect(result).toMatchObject({
        qualified: false,
        qualificationValid: true,
        accepted: false,
        refusalCode: 'revoked-' + cause,
      });
      expect(result.qualification.firstRevocation.conditions).toEqual(conditions);
    }
  });
});
