import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createScannerIdentityCheckpoint,
  readScannerSnapshotDiagnostic,
} from '../../scripts/qualification/windows-native-read-readiness.mjs';

const witness = { pid: 42, birth: '134373359662404617' };
const population = () => ({
  readiness: { populationReliable: true, identityDegraded: true, monitoringPaused: false },
  agents: [{ pid: 42, instanceIdSource: 'unknown' }],
});
const diagnostic = (extra = {}) => ({
  ...readScannerSnapshotDiagnostic({}),
  snapshotAvailable: true,
  clientAvailable: true,
  state: 'STARTING',
  source: 'none',
  mode: 'auto',
  failures: 0,
  ...extra,
});
const failed = () =>
  diagnostic({
    state: 'FAILED',
    failures: 1,
    firstFailure: {
      kind: 'child-exit',
      exitCode: 2,
      stderrClass: 'probe-query-failed',
      nativeStatus: 0xc0000022,
      responseClass: null,
    },
  });

describe('durable native identity diagnostic checkpoint', () => {
  let output;
  let temporaryRoot;
  let observation;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1700000000000);
    temporaryRoot = fs.realpathSync(os.tmpdir());
    output = fs.mkdtempSync(path.join(temporaryRoot, 'native-identity-checkpoint-'));
    observation = { samples: 0, last: null };
  });
  afterEach(() => {
    vi.useRealTimers();
    const resolved = fs.realpathSync(output);
    if (
      resolved !== output ||
      path.dirname(resolved) !== temporaryRoot ||
      !path.basename(resolved).startsWith('native-identity-checkpoint-') ||
      fs.lstatSync(resolved).isSymbolicLink()
    )
      throw new Error('checkpoint-cleanup-boundary');
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const readFile = (output) =>
    JSON.parse(fs.readFileSync(path.join(output, 'identity-diagnostic.json'), 'utf8'));

  it('durably marks entry before any main-process diagnostic or evidence RPC', () => {
    const read = vi.fn();
    const checkpoint = createScannerIdentityCheckpoint({ output, witness, observation, read });
    checkpoint.begin();
    expect(read).not.toHaveBeenCalled();
    expect(readFile(output)).toMatchObject({
      phase: 'observing',
      readiness: null,
      initial: null,
      firstFailure: null,
      last: null,
      capture: { attempts: 0, unavailable: false, timedOut: false },
    });
  });

  it('persists initial state and first real helper failure while alive, preserving them after disconnect', async () => {
    const initial = diagnostic();
    const failure = failed();
    const read = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(failure)
      .mockRejectedValueOnce(new Error('PRIVATE_DISCONNECT'));
    const checkpoint = createScannerIdentityCheckpoint({ output, witness, observation, read });
    await checkpoint.observe(population());
    await vi.advanceTimersByTimeAsync(0);
    expect(readFile(output)).toMatchObject({
      phase: 'observing',
      initial: { diagnostic: { state: 'STARTING' } },
      firstFailure: null,
    });
    await vi.advanceTimersByTimeAsync(1000);
    await checkpoint.observe(population());
    await vi.advanceTimersByTimeAsync(0);
    const beforeCleanup = readFile(output);
    expect(beforeCleanup.firstFailure.diagnostic.firstFailure.nativeStatus).toBe(0xc0000022);
    failure.firstFailure.nativeStatus = 0;
    initial.state = 'PRIVATE_CHANGED';
    await vi.advanceTimersByTimeAsync(1000);
    await checkpoint.observe(population());
    await checkpoint.finish('failed');
    const retained = readFile(output);
    expect(retained).toMatchObject({
      phase: 'failed',
      capture: { attempts: 3, unavailable: true, timedOut: false },
    });
    expect(retained.initial.diagnostic.state).toBe('STARTING');
    expect(retained.firstFailure).toEqual(beforeCleanup.firstFailure);
    expect(retained.last).toEqual(beforeCleanup.last);
    expect(observation.snapshotDiagnostic.firstFailure.nativeStatus).toBe(0xc0000022);
    expect(JSON.stringify(retained)).not.toContain('PRIVATE');
    expect(fs.statSync(path.join(output, 'identity-diagnostic.json')).size).toBeLessThanOrEqual(
      16384,
    );
    expect(fs.existsSync(path.join(output, 'identity-diagnostic.json.tmp'))).toBe(false);
  });

  it('never admits a late diagnostic after its bounded read timed out', async () => {
    let resolve;
    const read = vi.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const checkpoint = createScannerIdentityCheckpoint({ output, witness, observation, read });
    const pending = checkpoint.observe(population());
    await vi.advanceTimersByTimeAsync(1000);
    await pending;
    resolve(failed());
    await Promise.resolve();
    await checkpoint.finish('failed');
    expect(read).toHaveBeenCalledOnce();
    expect(readFile(output)).toMatchObject({
      initial: null,
      firstFailure: null,
      last: null,
      capture: { timedOut: true, attempts: 1 },
    });
    expect(observation.snapshotDiagnostic).toEqual(readScannerSnapshotDiagnostic({}));
  });

  it('does not hold a ready identity result for a pending diagnostic RPC', async () => {
    let resolve;
    const read = vi.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const checkpoint = createScannerIdentityCheckpoint({ output, witness, observation, read });
    checkpoint.begin();
    const value = population();
    value.readiness.identityDegraded = false;
    value.agents = [{ pid: witness.pid, createTime100ns: witness.birth, instanceIdSource: 'os' }];
    const before = Date.now();
    expect(checkpoint.observe(value)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(0);
    await checkpoint.finish('accepted');
    expect(Date.now()).toBe(before);
    expect(readFile(output)).toMatchObject({ phase: 'accepted', readiness: { accepted: true } });
    resolve(failed());
    await vi.advanceTimersByTimeAsync(0);
    expect(readFile(output).last).toBeNull();
  });

  it('retains at most three fixed slots and caps all diagnostic reads at32', async () => {
    const read = vi.fn().mockResolvedValue(diagnostic());
    const checkpoint = createScannerIdentityCheckpoint({ output, witness, observation, read });
    for (let index = 0; index < 40; index++) {
      await checkpoint.observe(population());
      await vi.advanceTimersByTimeAsync(1000);
    }
    await checkpoint.finish('failed');
    expect(read).toHaveBeenCalledTimes(32);
    expect(readFile(output).capture.attempts).toBe(32);
    expect(readFile(output).firstFailure).toBeNull();
    expect(Object.keys(readFile(output))).toEqual([
      'schema',
      'phase',
      'readiness',
      'initial',
      'firstFailure',
      'last',
      'capture',
    ]);
  });

  it('keeps malformed transported fields outside the checkpoint', async () => {
    const read = vi.fn().mockResolvedValue({ ...failed(), private: 'PRIVATE_CANARY' });
    const checkpoint = createScannerIdentityCheckpoint({ output, witness, observation, read });
    await checkpoint.observe(population());
    await checkpoint.finish('failed');
    expect(readFile(output)).toMatchObject({
      initial: null,
      firstFailure: null,
      last: null,
      capture: { unavailable: true },
    });
    expect(JSON.stringify(readFile(output))).not.toContain('PRIVATE');
  });

  it('marks successful identity observation without treating diagnostics as acceptance authority', async () => {
    const read = vi.fn().mockResolvedValue(diagnostic());
    const checkpoint = createScannerIdentityCheckpoint({ output, witness, observation, read });
    await checkpoint.observe(population());
    await checkpoint.finish('accepted');
    expect(readFile(output)).toMatchObject({ phase: 'accepted', readiness: { accepted: false } });
    expect(read).toHaveBeenCalledOnce();
    expect(observation.samples).toBe(0);
  });

  it('refuses an existing temporary checkpoint without changing its bytes', async () => {
    const temporary = path.join(output, 'identity-diagnostic.json.tmp');
    fs.writeFileSync(temporary, 'existing-marker');
    const checkpoint = createScannerIdentityCheckpoint({
      output,
      witness,
      observation,
      read: async () => diagnostic(),
    });
    expect(() => checkpoint.observe(population())).toThrow('checkpoint persistence failed');
    expect(fs.readFileSync(temporary, 'utf8')).toBe('existing-marker');
  });
});
