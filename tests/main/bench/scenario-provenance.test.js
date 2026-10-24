import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const runner = require('../../../bench/run');
const actor = require('../../../bench/lib/actor');
const manifest = require('../../../bench/lib/manifest');
const provenance = require('../../../bench/lib/scenario-provenance');
const sensor = require('../../../bench/lib/sensor');
const sysmon = require('../../../bench/lib/oracles/sysmon');
const directories = [];
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true });
});
let serial = 0;
function ownRun(arm = 'C', id = 'S3-ordinary-fixture') {
  vi.useFakeTimers({ toFake: ['Date'] });
  const now = new Date(Date.UTC(2036, 9, 24, 0, 0, serial++));
  vi.setSystemTime(now);
  const runId = runner.buildRunId(now, id, arm),
    dir = path.join(runner.RUNS_DIR, runId);
  expect(fs.existsSync(dir)).toBe(false);
  const mkdir = fs.mkdirSync;
  vi.spyOn(fs, 'mkdirSync').mockImplementation((file, ...args) => {
    const result = mkdir(file, ...args);
    if (file === dir) directories.push(dir);
    return result;
  });
  vi.spyOn(manifest, 'collect').mockImplementation((opts) => ({
    schemaVersion: 2,
    runId: opts.runId,
    scenario: opts.scenario,
    arm: opts.arm,
    host: {},
    sensor: {},
    oracles: {},
    processCountAtStart: {},
  }));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  return { id, runId, dir, source: path.join(actor.SCENARIOS_DIR, id, 'scenario.json'), errors };
}
function ownedScenario() {
  const id = `S99-provenance-${serial++}`,
    dir = path.join(actor.SCENARIOS_DIR, id);
  fs.mkdirSync(dir);
  directories.push(dir);
  const scenario = JSON.parse(
    fs.readFileSync(path.join(actor.SCENARIOS_DIR, 'S3-ordinary-fixture', 'scenario.json'), 'utf8'),
  );
  scenario.id = id;
  scenario.title = 'Public multibyte inert café';
  const source = path.join(dir, 'scenario.json'),
    bytes = Buffer.from(JSON.stringify(scenario, null, 2) + '\r\n');
  fs.writeFileSync(source, bytes);
  return { id, source, bytes };
}
describe('exact loaded scenario provenance', () => {
  it('detects a valid same-length source rewrite from its independently changed digest', () => {
    const fixture = ownedScenario(),
      scenario = actor.loadScenario(fixture.id).scenario;
    provenance.seal(scenario);
    const rewritten = Buffer.from(fixture.bytes.toString('utf8').replace('inert', 'other'));
    expect(rewritten.length).toBe(fixture.bytes.length);
    expect(JSON.parse(rewritten.toString('utf8')).title).toContain('other');
    fs.writeFileSync(fixture.source, rewritten);
    const result = provenance.finish(scenario),
      digest = createHash('sha256').update(rewritten).digest('hex');
    expect(digest).not.toBe(result.loaded.sha256);
    expect(result.final).toEqual({
      state: 'changed',
      sha256: digest,
      byteLength: result.loaded.byteLength,
    });
  });
  it('collects provenance only for a sealed prepared scenario with the matching manifest ID', () => {
    const scenario = runner.prepareScenario('S3-ordinary-fixture', 'C'),
      filename = require.resolve('../../../bench/lib/manifest'),
      previous = require.cache[filename];
    const exec = vi.spyOn(require('node:child_process'), 'execFileSync').mockImplementation(() => {
      throw Error('fixture-probe-unavailable');
    });
    try {
      delete require.cache[filename];
      const collector = require(filename),
        options = {
          runId: 'fixture',
          scenario: scenario.id,
          arm: 'C',
          startedAt: '2026-10-24T00:00:00.000Z',
        };
      expect(collector.collect({ ...options, preparedScenario: scenario }).scenarioProvenance).toBe(
        null,
      );
      expect(collector.collect({ ...options, preparedScenario: null }).scenarioProvenance).toBe(
        null,
      );
      provenance.seal(scenario);
      expect(
        collector.collect({ ...options, preparedScenario: scenario }).scenarioProvenance,
      ).toEqual(provenance.initial(scenario));
      expect(
        collector.collect({
          ...options,
          scenario: 'S4-outside-project',
          preparedScenario: scenario,
        }).scenarioProvenance,
      ).toBe(null);
    } finally {
      if (previous) require.cache[filename] = previous;
      else delete require.cache[filename];
      exec.mockRestore();
    }
  });
  it('refuses an existing final staging file without overwriting its owner', async () => {
    const item = ownRun(),
      execute = actor.execute,
      sentinel = 'owned-competing-staging-sentinel';
    const staged = path.join(item.dir, 'manifest.scenario-provenance.tmp');
    vi.spyOn(actor, 'execute').mockImplementation(async (...args) => {
      fs.writeFileSync(staged, sentinel, { flag: 'wx' });
      return execute(...args);
    });
    expect(await runner.main(['--scenario', item.id, '--arm', 'C'])).toBe(1);
    expect(fs.readFileSync(staged, 'utf8')).toBe(sentinel);
    expect(
      JSON.parse(fs.readFileSync(path.join(item.dir, 'manifest.json'), 'utf8')).scenarioProvenance
        .final.state,
    ).toBe('pending');
  });
  it('uses exact filesystem identity for ordinary NTFS file IDs beyond safe Number precision', () => {
    const fixture = ownedScenario(),
      lstat = fs.lstatSync,
      fstat = fs.fstatSync;
    const identity = (stat) => {
      stat.ino = 19140298421138132n;
      return stat;
    };
    vi.spyOn(fs, 'lstatSync').mockImplementation((file) => identity(lstat(file, { bigint: true })));
    vi.spyOn(fs, 'fstatSync').mockImplementation((fd) => identity(fstat(fd, { bigint: true })));
    const scenario = actor.loadScenario(fixture.id).scenario;
    provenance.seal(scenario);
    expect(provenance.finish(scenario).final.state).toBe('unchanged');
  });
  it('hashes one exact parsed read including UTF-8 bytes and formatting, without an initial reread', () => {
    const fixture = ownedScenario(),
      open = fs.openSync;
    let opens = 0;
    vi.spyOn(fs, 'openSync').mockImplementation((file, ...args) => {
      if (file === fixture.source) opens++;
      return open(file, ...args);
    });
    const scenario = actor.loadScenario(fixture.id).scenario;
    provenance.seal(scenario);
    const initial = provenance.initial(scenario);
    expect(opens).toBe(1);
    expect(initial.loaded).toEqual({
      sha256: createHash('sha256').update(fixture.bytes).digest('hex'),
      byteLength: fixture.bytes.length,
    });
    expect(initial.loaded.byteLength).not.toBe(fixture.bytes.toString('utf8').length);
    expect(initial.loaded.sha256).not.toBe(
      createHash('sha256').update(JSON.stringify(scenario)).digest('hex'),
    );
    expect(provenance.finish(scenario).final.state).toBe('unchanged');
    expect(opens).toBe(2);
    expect(JSON.stringify(initial)).not.toContain(JSON.stringify(fixture.source).slice(1, -1));
  });
  it('loops legitimate short descriptor reads and closes the actual descriptor', () => {
    const fixture = ownedScenario(),
      read = fs.readSync,
      close = vi.spyOn(fs, 'closeSync');
    vi.spyOn(fs, 'readSync').mockImplementation((fd, buffer, offset, length, position) =>
      read(fd, buffer, offset, Math.min(length, 17), position),
    );
    const scenario = actor.loadScenario(fixture.id).scenario;
    provenance.seal(scenario);
    expect(provenance.initial(scenario).loaded.byteLength).toBe(fixture.bytes.length);
    expect(close).toHaveBeenCalledTimes(1);
    expect(() => fs.fstatSync(close.mock.calls[0][0])).toThrow();
  });
  it.each(['oversized', 'linked', 'close-failed'])(
    'refuses unsafe endpoint evidence: %s',
    (kind) => {
      const fixture = ownedScenario(),
        scenario = actor.loadScenario(fixture.id).scenario;
      provenance.seal(scenario);
      if (kind === 'oversized') fs.writeFileSync(fixture.source, Buffer.alloc(65537, 32));
      else if (kind === 'linked')
        fs.linkSync(fixture.source, path.join(path.dirname(fixture.source), 'duplicate.json'));
      else {
        const close = fs.closeSync;
        vi.spyOn(fs, 'closeSync').mockImplementation((fd) => {
          close(fd);
          throw Error('private-close-error');
        });
      }
      expect(provenance.finish(scenario)).toEqual({
        ...provenance.initial(scenario),
        final: { state: 'unavailable', sha256: null, byteLength: null },
      });
    },
  );
  it('rejects oversized and malformed UTF-8 initial source before execution', () => {
    const fixture = ownedScenario();
    fs.writeFileSync(fixture.source, Buffer.alloc(65537, 32));
    expect(() => runner.prepareScenario(fixture.id, 'C')).toThrow();
    fs.writeFileSync(
      fixture.source,
      Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]),
    );
    expect(() => runner.prepareScenario(fixture.id, 'C')).toThrow();
  });
  it('finalizes loaded evidence on unexpected execution failure while preserving the pending snapshot', async () => {
    const item = ownRun();
    let initial;
    vi.spyOn(actor, 'execute').mockImplementation(() => {
      initial = JSON.parse(
        fs.readFileSync(path.join(item.dir, 'manifest.json'), 'utf8'),
      ).scenarioProvenance;
      throw Error('private-execution-error');
    });
    await expect(runner.main(['--scenario', item.id, '--arm', 'C'])).rejects.toThrow(
      'private-execution-error',
    );
    const final = JSON.parse(
      fs.readFileSync(path.join(item.dir, 'manifest.json'), 'utf8'),
    ).scenarioProvenance;
    expect(initial.final).toEqual({ state: 'pending', sha256: null, byteLength: null });
    expect(final).toMatchObject({ loaded: initial.loaded, final: { state: 'unchanged' } });
    expect(fs.existsSync(path.join(item.dir, 'steps.json'))).toBe(false);
  });
  it.each(['changed', 'unavailable'])(
    'retains initial pending facts and completed artifacts when endpoint is %s',
    async (state) => {
      const fixture = ownedScenario(),
        item = ownRun('C', fixture.id),
        execute = actor.execute;
      let pending;
      vi.spyOn(actor, 'execute').mockImplementation(async (scenario, opts) => {
        pending = JSON.parse(
          fs.readFileSync(path.join(item.dir, 'manifest.json'), 'utf8'),
        ).scenarioProvenance;
        expect(Object.isFrozen(scenario)).toBe(true);
        expect(Object.isFrozen(scenario.steps[0].with)).toBe(true);
        const result = await execute(scenario, opts);
        if (state === 'changed') fs.appendFileSync(fixture.source, ' ');
        else fs.unlinkSync(fixture.source);
        return result;
      });
      expect(await runner.main(['--scenario', item.id, '--arm', 'C'])).toBe(1);
      const result = JSON.parse(
        fs.readFileSync(path.join(item.dir, 'manifest.json'), 'utf8'),
      ).scenarioProvenance;
      const loaded = {
        sha256: createHash('sha256').update(fixture.bytes).digest('hex'),
        byteLength: fixture.bytes.length,
      };
      expect(pending).toMatchObject({
        loaded,
        final: { state: 'pending', sha256: null, byteLength: null },
      });
      expect(result.loaded).toEqual(loaded);
      expect(result.final).toEqual(
        state === 'changed'
          ? {
              state,
              sha256: createHash('sha256')
                .update(Buffer.concat([fixture.bytes, Buffer.from(' ')]))
                .digest('hex'),
              byteLength: fixture.bytes.length + 1,
            }
          : { state, sha256: null, byteLength: null },
      );
      expect(fs.existsSync(path.join(item.dir, 'steps.json'))).toBe(true);
    },
  );
  it('preserves legacy mutable preparation and refuses to seal an altered loaded object', () => {
    const scenario = runner.prepareScenario('S3-ordinary-fixture', 'C');
    expect(Object.isFrozen(scenario)).toBe(false);
    scenario.steps[0].with.content = 'changed public canary';
    expect(() => provenance.seal(scenario)).toThrow('scenario-provenance-invalid');
    expect(provenance.initial(scenario)).toBe(null);
  });
  it('retains loaded evidence on real main startup refusal without executing any steps', async () => {
    const item = ownRun('A');
    vi.spyOn(sysmon, 'probeVersion').mockReturnValue(null);
    vi.spyOn(sysmon, 'manifestBlock').mockReturnValue({});
    vi.spyOn(sensor, 'start').mockRejectedValue(new sensor.SensorError('start', 'fixture refusal'));
    const execute = vi.spyOn(actor, 'execute');
    expect(await runner.main(['--scenario', item.id, '--arm', 'A'])).toBe(1);
    expect(execute).not.toHaveBeenCalled();
    expect(
      JSON.parse(fs.readFileSync(path.join(item.dir, 'manifest.json'), 'utf8')).scenarioProvenance,
    ).toMatchObject({ final: { state: 'unchanged' } });
    expect(fs.existsSync(path.join(item.dir, 'steps.json'))).toBe(false);
  });
  it('leaves endpoint pending and preserves execution failure when sensor shutdown fails', async () => {
    const item = ownRun('A');
    vi.spyOn(sysmon, 'probeVersion').mockReturnValue(null);
    vi.spyOn(sysmon, 'manifestBlock').mockReturnValue({});
    vi.spyOn(sensor, 'start').mockResolvedValue({ exit: null });
    vi.spyOn(actor, 'execute').mockRejectedValue(Error('execution-fixture-failure'));
    vi.spyOn(sensor, 'stop').mockRejectedValue(Error('cleanup-fixture-failure'));
    await expect(runner.main(['--scenario', item.id, '--arm', 'A'])).rejects.toThrow(
      'execution-fixture-failure',
    );
    expect(
      JSON.parse(fs.readFileSync(path.join(item.dir, 'manifest.json'), 'utf8')).scenarioProvenance
        .final,
    ).toEqual({ state: 'pending', sha256: null, byteLength: null });
  });
  it.each(['execution-failed', 'steps-completed'])(
    'leaves endpoint pending when stop resolves without an observed exit: %s',
    async (state) => {
      const item = ownRun('A');
      const handle = { exit: null, profileDir: item.dir, ticks: [], steadyCadence: false };
      vi.spyOn(sysmon, 'probeVersion').mockReturnValue(null);
      vi.spyOn(sysmon, 'manifestBlock').mockReturnValue({});
      vi.spyOn(sysmon, 'collect').mockReturnValue({
        ok: false,
        events: [],
        loss: { collection: { unavailable: 'fixture' } },
      });
      vi.spyOn(sysmon, 'writeLoss').mockReturnValue(path.join(item.dir, 'oracle-loss.json'));
      vi.spyOn(sensor, 'start').mockResolvedValue(handle);
      vi.spyOn(sensor, 'waitForTicks').mockRejectedValue(
        new sensor.SensorError('fixture-capture', 'fixture'),
      );
      vi.spyOn(sensor, 'stop').mockResolvedValue(undefined);
      const execute = vi.spyOn(actor, 'execute');
      if (state === 'execution-failed')
        execute.mockRejectedValue(Error('execution-fixture-failure'));
      await expect(runner.main(['--scenario', item.id, '--arm', 'A'])).rejects.toThrow(
        state === 'execution-failed' ? 'execution-fixture-failure' : 'sensor-shutdown-unconfirmed',
      );
      expect(handle.exit).toBe(null);
      expect(
        JSON.parse(fs.readFileSync(path.join(item.dir, 'manifest.json'), 'utf8')).scenarioProvenance
          .final,
      ).toEqual({ state: 'pending', sha256: null, byteLength: null });
      expect(fs.existsSync(path.join(item.dir, 'steps.json'))).toBe(state === 'steps-completed');
    },
  );
  it.each(['write', 'close', 'rename'])(
    'retains a readable initial manifest if final %s fails',
    async (failure) => {
      const item = ownRun(),
        write = fs.writeFileSync,
        open = fs.openSync,
        close = fs.closeSync;
      const staged = path.join(item.dir, 'manifest.scenario-provenance.tmp');
      let stagedFd;
      vi.spyOn(fs, 'openSync').mockImplementation((file, ...args) => {
        const fd = open(file, ...args);
        if (file === staged) stagedFd = fd;
        return fd;
      });
      vi.spyOn(fs, 'writeFileSync').mockImplementation((file, ...args) => {
        if (
          failure === 'write' &&
          (file === staged || (stagedFd !== undefined && file === stagedFd))
        ) {
          write(file, '{');
          throw new Error('private-final-write-error');
        }
        return write(file, ...args);
      });
      vi.spyOn(fs, 'closeSync').mockImplementation((fd) => {
        close(fd);
        if (failure === 'close' && fd === stagedFd) throw Error('private-close-error');
      });
      if (failure === 'rename')
        vi.spyOn(fs, 'renameSync').mockImplementation(() => {
          throw Error('private-rename-error');
        });
      expect(await runner.main(['--scenario', item.id, '--arm', 'C'])).toBe(1);
      expect(
        JSON.parse(fs.readFileSync(path.join(item.dir, 'manifest.json'), 'utf8')).scenarioProvenance
          .final.state,
      ).toBe('pending');
      expect(item.errors).toHaveBeenCalledWith('bench: scenario-provenance-write-unavailable');
      expect(JSON.stringify(item.errors.mock.calls)).not.toContain('private-');
    },
  );
  it('records exact loaded bytes and unchanged endpoint in the real main manifest', async () => {
    const item = ownRun(),
      bytes = fs.readFileSync(item.source),
      sha256 = createHash('sha256').update(bytes).digest('hex');
    expect(await runner.main(['--scenario', item.id, '--arm', 'C'])).toBe(0);
    const record = JSON.parse(fs.readFileSync(path.join(item.dir, 'manifest.json'), 'utf8'));
    expect(record.scenarioProvenance).toEqual({
      version: 1,
      loaded: { sha256, byteLength: bytes.length },
      final: { state: 'unchanged', sha256, byteLength: bytes.length },
      sourceAuthenticated: false,
      measurementAccepted: false,
    });
    expect(fs.existsSync(path.join(item.dir, 'expected.ndjson'))).toBe(true);
  });
});
