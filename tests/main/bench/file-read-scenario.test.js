import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const runner = require('../../../bench/run');
const actor = require('../../../bench/lib/actor');
const metrics = require('../../../bench/lib/metrics');
const join = require('../../../bench/lib/join');
const manifest = require('../../../bench/lib/manifest');
const sensor = require('../../../bench/lib/sensor');
const sysmon = require('../../../bench/lib/oracles/sysmon');
const { writeFileReadOutcomes, FILENAME } = require('../../../bench/lib/file-read-outcomes');
const directories = [];
const directory = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-scenario-'));
  directories.push(dir);
  return dir;
};
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true });
});
const prepared = () => runner.prepareScenario('S8-owned-file-read', 'B');
const runIdentity = (scenario, arm = 'B', at = new Date('2026-10-24T00:00:00.000Z')) =>
  runner.buildRunId(at, scenario.id, arm);
async function execute() {
  const scenario = prepared(),
    runId = runIdentity(scenario),
    dir = directory();
  return { scenario, runId, dir, outcome: await actor.execute(scenario, { runDir: dir, runId }) };
}
function mainRun(arm) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2033-10-24T00:00:00.000Z'));
  const scenario = prepared(),
    runId = runIdentity(scenario, arm, new Date()),
    dir = path.join(runner.RUNS_DIR, runId);
  expect(fs.existsSync(dir)).toBe(false);
  const mkdir = fs.mkdirSync;
  vi.spyOn(fs, 'mkdirSync').mockImplementation((file, ...args) => {
    const result = mkdir(file, ...args);
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
describe('S8 owned read integration and artifacts', () => {
  it('retains a failed partial outcome, emits no access and skips later steps', async () => {
    const scenario = prepared();
    scenario.steps.push({ id: 'later-wait', kind: 'wait', with: { ms: 1 } });
    const runId = runIdentity(scenario),
      dir = directory(),
      read = fs.readSync;
    vi.spyOn(fs, 'readSync')
      .mockImplementationOnce((fd, bytes, offset, _length, position) =>
        read(fd, bytes, offset, 5, position),
      )
      .mockImplementationOnce(() => {
        throw new Error('private-read-error');
      });
    const outcome = await actor.execute(scenario, { runDir: dir, runId });
    expect(outcome.ok).toBe(false);
    expect(outcome.steps.map((step) => step.status)).toEqual(['ok', 'failed', 'skipped']);
    expect(outcome.events).toHaveLength(1);
    runner.writeScenarioArtifacts({ dir, runId, scenario, arm: 'B', outcome });
    const artifact = fs.readFileSync(path.join(dir, FILENAME), 'utf8');
    expect(artifact).not.toContain('private');
    expect(JSON.parse(artifact).outcomes[0]).toMatchObject({
      status: 'failed',
      reason: 'read-unavailable',
      readBytes: 5,
      progressKnown: false,
      closure: { closed: true },
    });
    expect(fs.readFileSync(path.join(dir, 'expected.ndjson'), 'utf8')).not.toContain(
      'fixture-file-read',
    );
  });
  it.each([undefined, '', ['run'], '../outside', 'x'.repeat(65)])(
    'rejects invalid actual run binding before the initial write %#',
    async (runId) => {
      const scenario = prepared(),
        dir = directory(),
        open = vi.spyOn(fs, 'openSync');
      await expect(actor.execute(scenario, { runDir: dir, runId })).rejects.toThrow(
        'file-read-input-invalid',
      );
      expect(open).not.toHaveBeenCalled();
    },
  );
  it.each(['path', 'dir', 'content', 'offset', 'length', 'commands'])(
    'rejects %s read options before the initial write',
    async (key) => {
      const scenario = prepared(),
        dir = directory();
      scenario.steps[1].with[key] = 'private-option';
      const open = vi.spyOn(fs, 'openSync');
      await expect(
        actor.execute(scenario, { runDir: dir, runId: runIdentity(scenario) }),
      ).rejects.toThrow();
      expect(open).not.toHaveBeenCalled();
    },
  );
  it.each([
    'missing-with',
    'missing-fromStep',
    'missing-reference',
    'forward-reference',
    'wrong-kind',
    'duplicate-read',
  ])('rejects %s before any scenario action', async (kind) => {
    const scenario = prepared();
    if (kind === 'missing-with') delete scenario.steps[1].with;
    if (kind === 'missing-fromStep') delete scenario.steps[1].with.fromStep;
    if (kind === 'missing-reference') scenario.steps[1].with.fromStep = 'does-not-exist';
    if (kind === 'forward-reference') scenario.steps.reverse();
    if (kind === 'wrong-kind') {
      scenario.steps[0].kind = 'copy-binary';
      scenario.steps[0].with = { from: 'unused.exe', agentId: 'unused', agentName: 'unused.exe' };
    }
    if (kind === 'duplicate-read') {
      scenario.expect.push({ ...scenario.expect[1], id: 'E3' });
      scenario.steps.push({
        ...structuredClone(scenario.steps[1]),
        id: 'read-second',
        expect: 'E3',
      });
      actor.validateScenario(scenario);
    }
    const dir = directory(),
      open = vi.spyOn(fs, 'openSync');
    await expect(
      actor.execute(scenario, { runDir: dir, runId: runIdentity(scenario) }),
    ).rejects.toThrow();
    expect(open).not.toHaveBeenCalled();
  });
  it.each([
    (x) => (x.runId = ['coerced']),
    (x) => (x.outcomes[0].runId = 'another-run'),
    (x) => (x.outcomes[0].scenario = 'S99-other'),
    (x) => (x.outcomes[0].step = 'another-step'),
    (x) => (x.outcomes[0].fromStep = 'read-canary'),
    (x) => (x.outcomes[0].fixtureLabel = 'project/canary-other.txt'),
    (x) => (x.outcomes[0].expectedSha256 = 'f'.repeat(64)),
    (x) => (x.outcomes[0].readSha256 = 'f'.repeat(64)),
    (x) => (x.outcomes[0].readBytes = '32'),
    (x) => (x.outcomes[0].readBytes = 16386),
    (x) => (x.outcomes[0].status = ['complete']),
    (x) => (x.outcomes[0].originalIdentitySha256 = 'private-identity'),
    (x) => (x.outcomes[0].readSha256 = 's'.repeat(20000)),
    (x) => (x.outcomes[0].closure.closed = null),
    (x) => x.outcomes.push(structuredClone(x.outcomes[0])),
    (x) => Object.defineProperty(x.outcomes[0], 'runId', { value: x.runId, enumerable: false }),
    (x) =>
      Object.defineProperty(x.outcomes[0].closure, 'closed', { value: true, enumerable: false }),
  ])(
    'refuses invalid outcome type/binding/bounds/enumerability %# without writing',
    async (change) => {
      const item = await execute(),
        opts = { ...itemWithArm(item), outcomes: structuredClone(item.outcome.readOutcomes) };
      change(opts);
      expect(() => writeFileReadOutcomes(opts)).toThrow(/^file-read-outcomes-invalid$/);
      expect(fs.existsSync(path.join(item.dir, FILENAME))).toBe(false);
    },
  );
  it('rejects private accessors without evaluating them', async () => {
    const item = await execute(),
      opts = { ...itemWithArm(item), outcomes: structuredClone(item.outcome.readOutcomes) },
      get = vi.fn(() => 'private-sentinel');
    Object.defineProperty(opts.outcomes[0], 'reason', { enumerable: true, get });
    expect(() => writeFileReadOutcomes(opts)).toThrow(/^file-read-outcomes-invalid$/);
    expect(get).not.toHaveBeenCalled();
  });
  it('preserves an existing artifact and a genuine racing exclusive-create sentinel', async () => {
    const item = await execute(),
      opts = { ...itemWithArm(item), outcomes: item.outcome.readOutcomes },
      file = path.join(item.dir, FILENAME),
      open = fs.openSync;
    vi.spyOn(fs, 'openSync').mockImplementation((target, flags, ...args) => {
      if (target === file && typeof flags === 'number' && flags & fs.constants.O_CREAT) {
        const fd = open(file, 'wx');
        try {
          fs.writeFileSync(fd, 'owned-sentinel');
        } finally {
          fs.closeSync(fd);
        }
      }
      return open(target, flags, ...args);
    });
    expect(() => writeFileReadOutcomes(opts)).toThrow(/^file-read-outcomes-invalid$/);
    expect(fs.readFileSync(file, 'utf8')).toBe('owned-sentinel');
    vi.restoreAllMocks();
    expect(() => writeFileReadOutcomes(opts)).toThrow(/^file-read-outcomes-invalid$/);
    expect(fs.readFileSync(file, 'utf8')).toBe('owned-sentinel');
  });
  it('prepares, executes and persists the actual production read flow without scoring access', async () => {
    const item = await execute(),
      { scenario, runId, dir, outcome } = item;
    expect(outcome.ok).toBe(true);
    expect(outcome.events).toHaveLength(2);
    runner.writeScenarioArtifacts(itemWithArm(item));
    const artifact = JSON.parse(fs.readFileSync(path.join(dir, FILENAME), 'utf8')),
      record = artifact.outcomes[0];
    expect(Object.keys(artifact).sort()).toEqual(
      [
        'schema',
        'schemaVersion',
        'runId',
        'scenario',
        'arm',
        'scope',
        'osOracle',
        'sourceAuthenticated',
        'sensorScored',
        'measurementAccepted',
        'outcomes',
      ].sort(),
    );
    expect(Object.keys(record).sort()).toEqual(
      [
        'version',
        'runId',
        'scenario',
        'step',
        'fromStep',
        'fixtureLabel',
        'originalIdentitySha256',
        'preIdentitySha256',
        'postIdentitySha256',
        'namedIdentitySha256',
        'expectedBytes',
        'expectedSha256',
        'readBytes',
        'readSha256',
        'progressKnown',
        'status',
        'reason',
        'closure',
      ].sort(),
    );
    expect(Object.keys(record.closure).sort()).toEqual(
      ['opened', 'closeAttempted', 'closed'].sort(),
    );
    const decodedStrings = [];
    function collectStrings(value) {
      if (typeof value === 'string') decodedStrings.push(value);
      else if (value && typeof value === 'object') Object.values(value).forEach(collectStrings);
    }
    collectStrings(artifact);
    for (const privateValue of [
      scenario.steps[0].with.content,
      dir,
      path.join(dir, 'fixtures', scenario.steps[0].with.target, scenario.steps[0].with.name),
    ]) {
      expect(decodedStrings.some((value) => value.includes(privateValue))).toBe(false);
    }
    const bytes = Buffer.from(scenario.steps[0].with.content, 'utf8'),
      digest = createHash('sha256').update(bytes).digest('hex');
    expect(record).toMatchObject({
      runId,
      scenario: scenario.id,
      step: 'read-canary',
      fromStep: 'write-canary',
      fixtureLabel: 'project/canary-read.txt',
      expectedBytes: bytes.length,
      expectedSha256: digest,
      readBytes: bytes.length,
      readSha256: digest,
      status: 'complete',
      reason: null,
      closure: { opened: true, closeAttempted: true, closed: true },
    });
    expect(artifact).toMatchObject({
      osOracle: false,
      sourceAuthenticated: false,
      sensorScored: false,
      measurementAccepted: false,
    });
    const expected = fs
        .readFileSync(path.join(dir, 'expected.ndjson'), 'utf8')
        .trim()
        .split('\n')
        .map(JSON.parse),
      access = expected.filter((event) => event.event.type[0] === 'access');
    expect(access).toHaveLength(1);
    expect(access[0]).toMatchObject({
      event: { category: ['file'], type: ['access'], action: 'fixture-file-read' },
      process: { pid: process.pid },
      file: { size: bytes.length, hash: { sha256: digest } },
      bench: {
        runId,
        sourceStep: 'write-canary',
        timestampBasis: 'harness-read-completion-observation',
      },
    });
    expect(access[0].file).not.toHaveProperty('path');
    const scored = metrics.buildMetrics({
      runId,
      scenario: scenario.id,
      arm: 'A',
      expected: access,
      oracle: access,
      observed: access,
      loss: {
        oracle: 'sysmon',
        collection: { ran: true },
        config: { enabledEventIds: [1, 5, 11, 26], sha256: 'a'.repeat(64) },
      },
      maxLatency: { value: 1000, source: 'fixture' },
      ticksWhileProcessAlive: null,
      inputs: [],
    });
    expect(scored.metrics.sensor.scored).toBe(true);
    expect(scored.matched[0]).toMatchObject({
      groundTruth: false,
      oracle: { reasonCode: 'category-not-scored' },
    });
    expect(Object.keys(scored.metrics.groundTruth)).toEqual([...join.CATEGORIES]);
    for (const category of join.CATEGORIES) {
      expect(scored.metrics.oracle.coverage[category].measurable).toBe(true);
      expect(scored.metrics.sensor[category]).toMatchObject({
        groundTruth: 0,
        detected: 0,
        observationsInWindow: 0,
        precisionDenominator: 0,
      });
    }
    expect(scored.metrics.sensor).not.toHaveProperty('file/access');
  });
  it('reaches the read artifact through real main arm C with its actual run ID', async () => {
    const { scenario, runId, dir } = mainRun('C');
    expect(await runner.main(['--scenario', scenario.id, '--arm', 'C'])).toBe(0);
    const artifact = JSON.parse(fs.readFileSync(path.join(dir, FILENAME), 'utf8'));
    expect(artifact).toMatchObject({ runId, scenario: scenario.id, arm: 'C' });
    expect(artifact.outcomes[0]).toMatchObject({ runId, status: 'complete' });
    expect(fs.existsSync(path.join(dir, 'fixture-outcomes.json'))).toBe(false);
  });
  it('writes read outcomes after the controlled arm A sensor stops', async () => {
    const { scenario, dir } = mainRun('A');
    let stopped = false,
      written = false;
    const handle = {
      profileDir: directory(),
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
      if (file === path.join(dir, FILENAME)) {
        expect(stopped).toBe(true);
        written = true;
      }
      return open(file, ...args);
    });
    expect(await runner.main(['--scenario', scenario.id, '--arm', 'A'])).toBe(1);
    expect(written).toBe(true);
  });
});
function itemWithArm(item) {
  return { ...item, arm: 'B' };
}
