import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const runner = require('../../../bench/run');
const actor = require('../../../bench/lib/actor');
const stepAdapter = require('../../../bench/lib/loopback-step');
const manifest = require('../../../bench/lib/manifest');
const sensor = require('../../../bench/lib/sensor');
const sysmon = require('../../../bench/lib/oracles/sysmon');
const metrics = require('../../../bench/lib/metrics');
const join = require('../../../bench/lib/join');
const catalogue = require('../../../bench/lib/catalogue');
const { LIMITS } = require('../../../bench/lib/loopback-receiver');
const directories = [];
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  stepAdapter._resetForTest();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true });
});
const ownedDirectory = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'loopback-scenario-'));
  directories.push(directory);
  return directory;
};
const prepared = () => runner.prepareScenario('S7-owned-loopback-transfer', 'B');
function identity(scenario, arm = 'B') {
  return runner.buildRunId(new Date('2026-10-24T00:00:00.000Z'), scenario.id, arm);
}
// Synthetic injected control receipts isolate sender evidence from receiver evidence.
function receipt({ runId, nonce, durationMs }, receiver = {}, sender = {}) {
  const bytes = Buffer.from(`AEGIS_PUBLIC_INERT_LOOPBACK_V1\n${runId}\n${nonce}\n`, 'ascii'),
    digest = createHash('sha256').update(bytes).digest('hex');
  return {
    version: 'loopback-control/1',
    runId,
    nonce,
    scope: 'controlled-node-loopback',
    confirmed: false,
    limits: LIMITS,
    sender: {
      attempted: true,
      writeFinished: true,
      sentBytes: bytes.length,
      responseCompleted: true,
      statusCode: 204,
      socketClosed: true,
      reason: null,
      ...sender,
    },
    receiver: {
      version: 'loopback-receiver/1',
      runId,
      nonce,
      expectedCount: 1,
      expectedSha256: digest,
      expectedBytes: bytes.length,
      plannedDurationMs: durationMs,
      connections: 1,
      requests: 1,
      completedBodies: 1,
      matchingPayloads: 1,
      duplicates: 0,
      wrong: 0,
      oversize: 0,
      incomplete: 0,
      protocolErrors: 0,
      observedHashes: [digest],
      verifiedCount: 1,
      exact: true,
      reason: null,
      cleanup: { listenerClosed: true, socketsClosed: true, confirmed: true },
      ...receiver,
    },
  };
}
function ownMainRun(arm) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2032-11-09T00:00:00.000Z'));
  const scenario = prepared(),
    runId = identity(scenario, arm).replace('2026-10-24', '2032-11-09');
  const dir = path.join(runner.RUNS_DIR, runId);
  expect(fs.existsSync(dir)).toBe(false);
  const original = fs.mkdirSync;
  vi.spyOn(fs, 'mkdirSync').mockImplementation((file, ...args) => {
    const result = original(file, ...args);
    if (file === dir) directories.push(dir);
    return result;
  });
  vi.spyOn(manifest, 'collect').mockImplementation((opts) => ({
    runId: opts.runId,
    scenario: opts.scenario,
    arm: opts.arm,
    host: {},
    sensor: {},
    oracles: {},
    processCountAtStart: {},
  }));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  return { scenario, runId, dir };
}
describe('owned loopback scenario integration', () => {
  it('refuses malformed network observations with a fixed privacy-safe error', () => {
    expect(() =>
      catalogue.buildEvent({
        scenario: prepared().id,
        step: 'send-canary',
        expect: 'E1',
        shape: 'network.start',
        observed: {
          timestamp: '2026-10-24T00:00:00.000Z',
          pid: 'private-pid-sentinel',
          executable: process.execPath,
          runId: 'run',
          nonce: 'nonce',
          sentBytes: 10,
        },
      }),
    ).toThrow(/^loopback-catalogue-input-invalid$/);
  });
  it('writes fixture outcomes from real main arm C with actual generated run binding', async () => {
    const { runId, dir, scenario } = ownMainRun('C');
    expect(await runner.main(['--scenario', scenario.id, '--arm', 'C'])).toBe(0);
    const record = JSON.parse(fs.readFileSync(path.join(dir, 'fixture-outcomes.json'), 'utf8'));
    const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.ndjson'), 'utf8').trim());
    expect(record.runId).toBe(runId);
    expect(record.outcomes[0].control.runId).toBe(runId);
    expect(expected.bench).toMatchObject({ runId, nonce: record.outcomes[0].nonce });
    expect(record.outcomes[0].control.receiver.exact).toBe(true);
    expect(fs.readdirSync(dir).sort()).toEqual([
      'expected.ndjson',
      'fixture-outcomes.json',
      'manifest.json',
      'steps.json',
    ]);
  });
  it('writes fixture outcomes only after the controlled arm A sensor has stopped', async () => {
    const { dir, scenario } = ownMainRun('A');
    let stopped = false,
      written = false;
    const handle = {
      profileDir: ownedDirectory(),
      pid: 123,
      ticks: [],
      startedAt: new Date().toISOString(),
      exit: null,
      steadyCadence: false,
    };
    vi.spyOn(sensor, 'start').mockResolvedValue(handle);
    vi.spyOn(sensor, 'waitForTicks').mockRejectedValue(
      new sensor.SensorError('died-mid-run', 'fixture'),
    );
    vi.spyOn(sensor, 'stop').mockImplementation(async () => {
      stopped = true;
      handle.stoppedAt = new Date().toISOString();
      handle.exit = { code: 0 };
    });
    vi.spyOn(sysmon, 'probeVersion').mockReturnValue(null);
    vi.spyOn(sysmon, 'manifestBlock').mockReturnValue({});
    vi.spyOn(sysmon, 'collect').mockReturnValue({
      ok: false,
      events: [],
      loss: { collection: { unavailable: 'fixture' } },
    });
    vi.spyOn(sysmon, 'writeLoss').mockReturnValue(path.join(dir, 'oracle-loss.json'));
    const open = fs.openSync;
    vi.spyOn(fs, 'openSync').mockImplementation((file, ...args) => {
      if (file === path.join(dir, 'fixture-outcomes.json')) {
        expect(stopped).toBe(true);
        written = true;
      }
      return open(file, ...args);
    });
    expect(await runner.main(['--scenario', scenario.id, '--arm', 'A'])).toBe(1);
    expect(written).toBe(true);
    expect(handle.exit).toEqual({ code: 0 });
    expect(
      JSON.parse(fs.readFileSync(path.join(dir, 'fixture-outcomes.json'), 'utf8')).outcomes,
    ).toHaveLength(1);
  });
  it.each([
    { verifiedCount: 0, exact: false, matchingPayloads: 0, reason: 'receipt-count-mismatch' },
    {
      verifiedCount: 2,
      exact: false,
      matchingPayloads: 2,
      duplicates: 1,
      reason: 'duplicate-receipt',
    },
    { verifiedCount: 0, exact: false, wrong: 1, reason: 'wrong-receipt' },
    { verifiedCount: null, exact: null, reason: 'listen-unavailable' },
  ])('keeps a written sender stimulus despite receiver outcome %#', async (receiver) => {
    const scenario = prepared(),
      runId = identity(scenario),
      dir = ownedDirectory();
    stepAdapter._setDepsForTest({ runLoopbackControl: async (opts) => receipt(opts, receiver) });
    const outcome = await actor.execute(scenario, { runDir: dir, runId });
    expect(outcome.ok).toBe(true);
    expect(outcome.events).toHaveLength(1);
    expect(outcome.events[0].event.action).toBe('loopback-canary-write-finished');
    runner.writeScenarioArtifacts({ dir, runId, scenario, arm: 'B', outcome });
    const record = JSON.parse(fs.readFileSync(path.join(dir, 'fixture-outcomes.json'), 'utf8'));
    expect(record.outcomes[0].control.receiver).toMatchObject(receiver);
    expect(record).toMatchObject({
      osOracle: false,
      sensorScored: false,
      measurementAccepted: false,
    });
  });
  it('persists an unwritten sender outcome, emits nothing and skips later steps', async () => {
    const scenario = prepared();
    scenario.steps.push({ id: 'later-wait', kind: 'wait', with: { ms: 1 } });
    const runId = identity(scenario),
      dir = ownedDirectory();
    stepAdapter._setDepsForTest({
      runLoopbackControl: async (opts) =>
        receipt(opts, {}, { writeFinished: null, sentBytes: null, reason: 'request-unavailable' }),
    });
    const outcome = await actor.execute(scenario, { runDir: dir, runId });
    expect(outcome.ok).toBe(false);
    expect(outcome.events).toEqual([]);
    expect(outcome.steps.map((step) => step.status)).toEqual(['failed', 'skipped']);
    runner.writeScenarioArtifacts({ dir, runId, scenario, arm: 'B', outcome });
    const record = JSON.parse(fs.readFileSync(path.join(dir, 'fixture-outcomes.json'), 'utf8'));
    expect(record.outcomes[0].control.sender.writeFinished).toBeNull();
    expect(fs.readFileSync(path.join(dir, 'expected.ndjson'), 'utf8')).toBe('');
  });
  it.each([
    { writeFinished: false, sentBytes: 7 },
    { writeFinished: null, sentBytes: 7 },
    { writeFinished: true, sentBytes: null },
  ])(
    'requires both sender finish and positive bytes despite an exact receiver %#',
    async (sender) => {
      const scenario = prepared();
      scenario.steps.push({ id: 'later-wait', kind: 'wait', with: { ms: 1 } });
      const runId = identity(scenario),
        dir = ownedDirectory();
      stepAdapter._setDepsForTest({
        runLoopbackControl: async (opts) => receipt(opts, {}, sender),
      });
      const outcome = await actor.execute(scenario, { runDir: dir, runId });
      expect(outcome.ok).toBe(false);
      expect(outcome.events).toEqual([]);
      expect(outcome.steps.map((step) => step.status)).toEqual(['failed', 'skipped']);
      runner.writeScenarioArtifacts({ dir, runId, scenario, arm: 'B', outcome });
      const record = JSON.parse(fs.readFileSync(path.join(dir, 'fixture-outcomes.json'), 'utf8'));
      expect(record.outcomes[0].control.sender).toMatchObject(sender);
      expect(record.outcomes[0].control.receiver.exact).toBe(true);
      expect(fs.readFileSync(path.join(dir, 'expected.ndjson'), 'utf8')).toBe('');
    },
  );
  it('sources catalogue byte count from the sender when receiver expected bytes differ', async () => {
    const scenario = prepared(),
      runId = identity(scenario),
      dir = ownedDirectory();
    stepAdapter._setDepsForTest({
      runLoopbackControl: async (opts) => receipt(opts, {}, { sentBytes: 7 }),
    });
    const outcome = await actor.execute(scenario, { runDir: dir, runId });
    expect(outcome.ok).toBe(true);
    expect(outcome.events[0].network.bytes).toBe(7);
    runner.writeScenarioArtifacts({ dir, runId, scenario, arm: 'B', outcome });
    const record = JSON.parse(fs.readFileSync(path.join(dir, 'fixture-outcomes.json'), 'utf8'));
    expect(record.outcomes[0].control.receiver.expectedBytes).not.toBe(7);
    expect(record.outcomes[0].control.sender.sentBytes).toBe(7);
  });
  it.each(['with', 'durationMs'])(
    'refuses a missing required %s before any control call',
    async (field) => {
      const scenario = prepared();
      if (field === 'with') delete scenario.steps[0].with;
      else delete scenario.steps[0].with.durationMs;
      const runLoopbackControl = vi.fn();
      stepAdapter._setDepsForTest({ runLoopbackControl });
      await expect(
        actor.execute(scenario, { runDir: ownedDirectory(), runId: identity(scenario) }),
      ).rejects.toThrow();
      expect(runLoopbackControl).not.toHaveBeenCalled();
    },
  );
  it.each([50, 3000])(
    'accepts the declared duration endpoint %s without a real timeout wait',
    async (durationMs) => {
      const scenario = prepared();
      scenario.steps[0].with.durationMs = durationMs;
      const runId = identity(scenario),
        runLoopbackControl = vi.fn(async (opts) => receipt(opts));
      stepAdapter._setDepsForTest({ runLoopbackControl });
      const outcome = await actor.execute(scenario, { runDir: ownedDirectory(), runId });
      expect(outcome.ok).toBe(true);
      expect(runLoopbackControl).toHaveBeenCalledTimes(1);
      expect(runLoopbackControl.mock.calls[0][0]).toMatchObject({ runId, durationMs });
    },
  );
  it('retains a fixed unavailable record when the control unexpectedly throws private text', async () => {
    const scenario = prepared(),
      runId = identity(scenario),
      dir = ownedDirectory();
    stepAdapter._setDepsForTest({
      runLoopbackControl: async () => {
        throw new Error('private-prompt-sentinel');
      },
    });
    const outcome = await actor.execute(scenario, { runDir: dir, runId });
    runner.writeScenarioArtifacts({ dir, runId, scenario, arm: 'B', outcome });
    const record = fs.readFileSync(path.join(dir, 'fixture-outcomes.json'), 'utf8');
    expect(record).not.toContain('private');
    expect(JSON.parse(record).outcomes[0]).toMatchObject({
      control: null,
      reason: 'control-unavailable',
    });
    expect(outcome.steps[0].error).toBe('loopback-sender-unavailable');
  });
  it.each([undefined, '', '../private', ['run'], 'r'.repeat(65)])(
    'refuses invalid actual runId before control startup %#',
    async (runId) => {
      const runLoopbackControl = vi.fn();
      stepAdapter._setDepsForTest({ runLoopbackControl });
      await expect(actor.execute(prepared(), { runDir: ownedDirectory(), runId })).rejects.toThrow(
        'loopback-step-input-invalid',
      );
      expect(runLoopbackControl).not.toHaveBeenCalled();
    },
  );
  it.each(['host', 'port', 'path', 'payload', 'endpoint', 'header', 'command', 'nonce'])(
    'refuses %s options before activity',
    async (field) => {
      const scenario = prepared();
      scenario.steps[0].with[field] = 'private-sentinel';
      const runLoopbackControl = vi.fn();
      stepAdapter._setDepsForTest({ runLoopbackControl });
      await expect(
        actor.execute(scenario, { runDir: ownedDirectory(), runId: identity(scenario) }),
      ).rejects.toThrow();
      expect(runLoopbackControl).not.toHaveBeenCalled();
    },
  );
  it.each([49, 3001, 50.5, '1000', true, null])(
    'refuses invalid duration before activity %#',
    async (durationMs) => {
      const scenario = prepared();
      scenario.steps[0].with.durationMs = durationMs;
      const runLoopbackControl = vi.fn();
      stepAdapter._setDepsForTest({ runLoopbackControl });
      await expect(
        actor.execute(scenario, { runDir: ownedDirectory(), runId: identity(scenario) }),
      ).rejects.toThrow();
      expect(runLoopbackControl).not.toHaveBeenCalled();
    },
  );
  it('refuses two independently valid loopback steps before activity', async () => {
    const scenario = prepared();
    scenario.expect.push({ ...scenario.expect[0], id: 'E2' });
    scenario.steps.push({ ...structuredClone(scenario.steps[0]), id: 'send-second', expect: 'E2' });
    actor.validateScenario(scenario);
    const runLoopbackControl = vi.fn();
    stepAdapter._setDepsForTest({ runLoopbackControl });
    await expect(
      actor.execute(scenario, { runDir: ownedDirectory(), runId: identity(scenario) }),
    ).rejects.toThrow('loopback-step-input-invalid');
    expect(runLoopbackControl).not.toHaveBeenCalled();
  });
  it('executes the prepared scenario and persists independent receiver bytes through the production artifact flow', async () => {
    const scenario = runner.prepareScenario('S7-owned-loopback-transfer', 'B');
    const runId = runner.buildRunId(new Date('2026-10-24T00:00:00.000Z'), scenario.id, 'B');
    const dir = ownedDirectory();
    const outcome = await actor.execute(scenario, { runDir: dir, runId });
    expect(outcome.ok).toBe(true);
    runner.writeScenarioArtifacts({ dir, runId, scenario, arm: 'B', outcome });
    const fixture = JSON.parse(fs.readFileSync(path.join(dir, 'fixture-outcomes.json'), 'utf8'));
    expect(fixture).toMatchObject({ runId, scenario: scenario.id, arm: 'B', osOracle: false });
    const record = fixture.outcomes[0],
      control = record.control;
    const bytes = Buffer.from(
      `AEGIS_PUBLIC_INERT_LOOPBACK_V1\n${runId}\n${record.nonce}\n`,
      'ascii',
    );
    expect(control.sender.sentBytes).toBe(bytes.length);
    expect(control.receiver.observedHashes).toEqual([
      createHash('sha256').update(bytes).digest('hex'),
    ]);
    expect(control.receiver).toMatchObject({
      verifiedCount: 1,
      exact: true,
      cleanup: { confirmed: true },
    });
    const expected = fs
      .readFileSync(path.join(dir, 'expected.ndjson'), 'utf8')
      .trim()
      .split('\n')
      .map(JSON.parse);
    expect(expected).toHaveLength(1);
    expect(expected[0]).toMatchObject({
      process: { pid: process.pid },
      event: { category: ['network'], type: ['start'], action: 'loopback-canary-write-finished' },
      destination: { ip: '127.0.0.1' },
      network: { transport: 'tcp', protocol: 'http', bytes: bytes.length },
      bench: { runId, step: 'send-canary', nonce: record.nonce },
    });
    expect(expected[0].destination).not.toHaveProperty('port');
    const scored = metrics.buildMetrics({
      runId,
      scenario: scenario.id,
      arm: 'A',
      expected,
      oracle: expected,
      observed: expected,
      loss: {
        oracle: 'sysmon',
        collection: { ran: true },
        config: { enabledEventIds: [1, 5, 11, 26, 3], sha256: 'a'.repeat(64) },
      },
      maxLatency: { value: 1000, source: 'fixture' },
      ticksWhileProcessAlive: null,
      inputs: [],
    });
    expect(scored.matched[0]).toMatchObject({
      groundTruth: false,
      oracle: { reasonCode: 'category-not-scored' },
    });
    expect(scored.metrics.sensor.scored).toBe(true);
    expect(Object.keys(scored.metrics.groundTruth)).toEqual([...join.CATEGORIES]);
    const blocks = Object.entries(scored.metrics.sensor).filter(([key]) =>
      join.CATEGORIES.includes(key),
    );
    expect(blocks.map(([key]) => key)).toEqual([...join.CATEGORIES]);
    expect(blocks).toHaveLength(4);
    for (const [category, block] of blocks) {
      expect(scored.metrics.oracle.coverage[category].measurable).toBe(true);
      expect(block).toMatchObject({
        groundTruth: 0,
        detected: 0,
        observationsInWindow: 0,
        precisionDenominator: 0,
      });
    }
    expect(scored.metrics.sensor).not.toHaveProperty('network/start');
    expect(scored.metrics.groundTruth).not.toHaveProperty('network/start');
  });
});
