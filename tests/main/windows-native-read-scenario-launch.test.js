import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  prepareNativeReadWindow: vi.fn(),
  readFixture: vi.fn(),
  observeCustodian: vi.fn(),
  exitWithin: vi.fn(),
  until: vi.fn(),
}));

vi.mock('playwright', () => ({ _electron: { launch: mocks.launch } }));
vi.mock('../../scripts/produce-protected-gui-manifest.mjs', () => ({
  GUI_EXECUTABLE: 'AEGIS.exe',
}));
vi.mock('../../scripts/qualification/windows-native-read-support.mjs', () => ({
  until: mocks.until,
  evidence: vi.fn(),
  displayedRisk: vi.fn(),
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
} from '../../scripts/qualification/windows-native-read-readiness.mjs';

describe('actual native-read scenario launch composition', () => {
  let app;
  let fixture;
  let observer;
  let receipt;

  beforeEach(() => {
    vi.clearAllMocks();
    receipt = { reads: [] };
    fixture = {
      child: { pid: 42, exitCode: null },
      next: vi.fn().mockResolvedValue({ pid: 42, birth: '123', shareDelete: false }),
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

  afterEach(() => vi.useRealTimers());

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
        out: 'X:/owned/evidence',
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
        out: 'X:/owned/evidence',
        env: {},
        r: receipt,
      }),
    ).rejects.toThrow('Unrelated startup refusal');
    expect(receipt.fixtureFailure).toBeUndefined();
    expect(fixture.close).toHaveBeenCalledOnce();
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
        out: 'X:/owned/evidence',
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
    mocks.prepareNativeReadWindow.mockRejectedValue(new Error('stop after launch composition'));

    const pending = runNativeReadScenario({
      fixtureExe: 'fixture.exe',
      file: 'X:/owned/.env',
      out: 'X:/owned/evidence',
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
      out: 'X:/owned/evidence',
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

    await expect(
      runNativeReadScenario({
        fixtureExe: 'fixture.exe',
        file: 'X:/owned/.env',
        out: 'X:/owned/evidence',
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
    expect(receipt.reads).toEqual([]);
    expect(fixture.close).toHaveBeenCalledOnce();
    expect(app.close).toHaveBeenCalledOnce();
    expect(observer.stop).toHaveBeenCalledOnce();
  });

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
        out: 'X:/owned/evidence',
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
        out: 'X:/owned/evidence',
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
