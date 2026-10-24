import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { AssertionError, strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import { Script } from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const root = path.resolve('.');
const sources = require('../../../bench/lib/resource-supervisor-storage').SOURCES;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hash = (file) => digest(fs.readFileSync(file));
const originalHashes = sources.map((file) => hash(path.join(root, file)));
const directories = [];
const native = Object.fromEntries(
  ['openSync', 'closeSync', 'fstatSync'].map((key) => [key, fs[key].bind(fs)]),
);
function stage(fault) {
  assert.equal(sources.length, 10);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resource-supervisor-fault-'));
  directories.push(dir);
  for (const source of sources) {
    const target = path.join(dir, source);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, source), target, fs.constants.COPYFILE_EXCL);
  }
  if (fault) {
    const target = path.join(dir, fault.file),
      text = fs.readFileSync(target, 'utf8');
    assert.equal(
      text.split(fault.from).length,
      2,
      'Mutation must change one production expression',
    );
    const changed = text.replace(fault.from, fault.to);
    new Script(changed, { filename: target });
    fs.writeFileSync(target, changed);
  }
  const load = (file) => require(path.join(dir, 'bench', file));
  return {
    dir,
    supervisor: load('lib/resource-supervisor.js'),
    storage: load('lib/resource-supervisor-storage.js'),
    stream: load('lib/resource-supervisor-stream.js'),
    cli: load('self-resource-supervise.cjs'),
  };
}
function options(dir) {
  return {
    runId: 'mutation-control',
    durationMs: 1000,
    maxAcquisitionUs: 10000,
    maxCpuUncertaintyUs: 20000,
    wallLimitMs: 10,
    confirmMs: 10,
    out: path.join(dir, 'output'),
  };
}
function lifecycleFixture() {
  let nowMs = 0;
  const child = new EventEmitter(),
    kills = [],
    timers = [];
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.destroy = child.stderr.destroy = () => {};
  child.kill = (signal) => {
    kills.push(signal);
    return true;
  };
  child.unref = () => {};
  return {
    kills,
    deps: {
      spawn: () => child,
      nowNs: () => BigInt(nowMs) * 1000000n,
      setTimer: (fn, ms) => {
        const timer = { fn, ms, active: true };
        timers.push(timer);
        return timer;
      },
      clearTimer: (timer) => {
        timer.active = false;
      },
    },
    complete(late = false) {
      child.emit('spawn');
      if (late) nowMs = 20;
      child.emit('exit', 0, null);
      for (const pipe of [child.stdout, child.stderr]) {
        pipe.emit('end');
        pipe.emit('close');
      }
      child.emit('close', 0, null);
    },
  };
}
async function observe(item, late = false) {
  const fixture = lifecycleFixture();
  const pending = item.supervisor.superviseSelfResources(options(item.dir), fixture.deps);
  fixture.complete(late);
  return { result: await pending, kills: fixture.kills };
}
async function prefixOracle({ stream }) {
  const observer = stream.streamObserver();
  const first = Buffer.alloc(16382, 0x61),
    second = Buffer.from('bcdefghijk');
  assert.equal(observer.data(first), null);
  assert.equal(observer.data(second), 'output-overflow');
  observer.state.ended = true;
  observer.state.closed = true;
  const result = observer.result();
  assert.equal(result.observedBytes, 16392);
  assert.equal(result.hashBytes, 16384);
  assert.equal(result.sha256, digest(Buffer.concat([first, second]).subarray(0, 16384)));
  assert.equal(result.overflow, true);
  assert.equal(result.complete, false);
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of directories.splice(0)) {
    expect(path.dirname(dir)).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(dir)).toMatch(/^resource-supervisor-fault-/);
    expect(fs.lstatSync(dir).isSymbolicLink()).toBe(false);
    for (const file of Object.keys(require.cache))
      if (file.startsWith(dir + path.sep)) delete require.cache[file];
    fs.rmSync(dir, { recursive: true });
  }
  expect(sources.map((file) => hash(path.join(root, file)))).toEqual(originalHashes);
});

const faults = [
  {
    name: 'public options must have an ordinary prototype',
    file: 'bench/lib/resource-supervisor.js',
    from: '![Object.prototype, null].includes(Object.getPrototypeOf(value))',
    to: 'false',
    async oracle(item) {
      const value = Object.assign(Object.create({ inherited: true }), options(item.dir));
      assert.throws(
        () => item.supervisor.validateOptions(value),
        /resource-supervisor-input-invalid/,
      );
    },
  },
  {
    name: 'source descriptor identity must agree with the name observed before open',
    file: 'bench/lib/resource-supervisor-storage.js',
    from: 'if (!same(named, before)) fail();',
    to: 'if (false) fail();',
    async oracle(item) {
      const target = path.join(item.dir, sources[0]);
      const lstat = fs.lstatSync;
      let sourceFd,
        active = false,
        namedReads = 0;
      const shifted = (stat) =>
        Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, { ino: stat.ino + 1n });
      const open = vi.spyOn(fs, 'openSync').mockImplementation((file, ...args) => {
        const fd = native.openSync(file, ...args);
        if (file === target) {
          sourceFd = fd;
          active = true;
        }
        return fd;
      });
      const named = vi.spyOn(fs, 'lstatSync').mockImplementation((file, ...args) => {
        const stat = lstat(file, ...args);
        return file === target && ++namedReads > 1 ? shifted(stat) : stat;
      });
      const descriptor = vi.spyOn(fs, 'fstatSync').mockImplementation((fd, ...args) => {
        const stat = native.fstatSync(fd, ...args);
        return fd === sourceFd && active ? shifted(stat) : stat;
      });
      const close = vi.spyOn(fs, 'closeSync').mockImplementation((fd) => {
        native.closeSync(fd);
        if (fd === sourceFd) active = false;
      });
      try {
        assert.throws(() => item.storage.inventory(), /resource-supervisor-storage-unavailable/);
        assert.equal(Number.isSafeInteger(sourceFd), true);
        assert.throws(() => native.fstatSync(sourceFd));
      } finally {
        close.mockRestore();
        descriptor.mockRestore();
        named.mockRestore();
        open.mockRestore();
      }
    },
  },
  {
    name: 'invalid CLI input cannot return success',
    file: 'bench/self-resource-supervise.cjs',
    from: 'return 2;',
    to: 'return 0;',
    async oracle({ cli }) {
      assert.equal(await cli.main([]), 2);
    },
  },
  {
    name: 'a zero exit observed after the wall limit cannot become success',
    file: 'bench/lib/resource-supervisor.js',
    from: 's.cause === null',
    to: 'true',
    async oracle(item) {
      const { result } = await observe(item, true);
      assert.equal(result.exitCode, 3);
      assert.equal(result.receipt.supervision.cause, 'wall-limit');
      assert.deepEqual(result.receipt.supervision.exit, { observed: true, code: 0, signal: null });
    },
  },
  {
    name: 'a child with observed exit is never killed',
    file: 'bench/lib/resource-supervisor-child.js',
    from: '!r.exit.observed && !r.kill.attempted',
    to: '!r.kill.attempted',
    async oracle(item) {
      const { result, kills } = await observe(item, true);
      assert.deepEqual(kills, []);
      assert.equal(result.receipt.supervision.exit.observed, true);
      assert.equal(result.receipt.supervision.kill.attempted, false);
    },
  },
  {
    name: 'stream digests retain only the declared byte prefix',
    file: 'bench/lib/resource-supervisor-stream.js',
    from: 'Math.min(CAP - state.hashBytes, chunk.length)',
    to: 'chunk.length',
    oracle: prefixOracle,
  },
  {
    name: 'stream overflow cannot appear complete',
    file: 'bench/lib/resource-supervisor-stream.js',
    from: 'state.observedBytes > CAP || !state.observedBytesExact',
    to: 'false',
    oracle: prefixOracle,
  },
  {
    name: 'source endpoint disagreement refuses success',
    file: 'bench/lib/resource-supervisor.js',
    from: 'JSON.stringify(after) === JSON.stringify(before)',
    to: 'true',
    async oracle(item) {
      const inventory = item.storage.inventory;
      let calls = 0;
      item.storage.inventory = () => {
        const value = inventory();
        if (++calls === 2) {
          const sha = value.files[0].sha256;
          value.files[0].sha256 = (sha[0] === '0' ? '1' : '0') + sha.slice(1);
        }
        return value;
      };
      try {
        const { result } = await observe(item);
        assert.equal(result.exitCode, 4);
        assert.equal(result.receipt.sources.state, 'changed');
      } finally {
        item.storage.inventory = inventory;
      }
    },
  },
  {
    name: 'uncertain final close dominates otherwise completed supervision',
    file: 'bench/lib/resource-supervisor.js',
    from: 'exitCode = 6;',
    to: 'exitCode = 0;',
    async oracle(item) {
      const finalFile = path.join(options(item.dir).out, 'supervision-final.json');
      let finalFd,
        closeFailures = 0;
      const open = vi.spyOn(fs, 'openSync').mockImplementation((file, ...args) => {
        const fd = native.openSync(file, ...args);
        if (file === finalFile) finalFd = fd;
        return fd;
      });
      const close = vi.spyOn(fs, 'closeSync').mockImplementation((fd) => {
        native.closeSync(fd);
        if (fd === finalFd) {
          closeFailures++;
          throw Error('fixture-final-close-unavailable');
        }
      });
      try {
        const { result } = await observe(item);
        assert.equal(closeFailures, 1);
        assert.equal(Number.isSafeInteger(finalFd), true);
        assert.throws(() => native.fstatSync(finalFd));
        assert.equal(result.exitCode, 6);
        assert.equal(result.receipt.state, 'persistence-failed');
      } finally {
        close.mockRestore();
        open.mockRestore();
      }
    },
  },
];

describe('CI private source-copy mutation controls for resource supervision', () => {
  it.each(faults)(
    '$name is enforced by an independent baseline and mutant oracle',
    async (fault) => {
      vi.spyOn(process.stderr, 'write').mockReturnValue(true);
      await fault.oracle(stage());
      await assert.rejects(
        () => fault.oracle(stage(fault)),
        (error) => error instanceof AssertionError,
      );
    },
  );
});
