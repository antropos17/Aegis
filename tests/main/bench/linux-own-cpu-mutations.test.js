import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { AssertionError, strict as assert } from 'node:assert';
import { Script } from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  options,
  fixtureDeps,
  referenceWindows,
  statText,
} from './linux-own-cpu-fixtures.js';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../../..');
const sources = require('../../../bench/lib/linux-own-cpu-storage').SOURCES;
const originalBytes = sources.map((file) => fs.readFileSync(path.join(root, file)));
const directories = [];
const native = Object.fromEntries(
  ['openSync', 'closeSync', 'fstatSync', 'lstatSync'].map((key) => [key, fs[key].bind(fs)]),
);
function stage(fault) {
  assert.equal(sources.length, 8);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-own-cpu-mutation-'));
  directories.push(dir);
  for (const source of sources) {
    const target = path.join(dir, source);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, source), target, fs.constants.COPYFILE_EXCL);
  }
  if (fault) {
    const target = path.join(dir, fault.file),
      text = fs.readFileSync(target, 'utf8');
    assert.equal([...text.matchAll(fault.from)].length, 1, 'Mutation must match exactly once');
    const changed = text.replace(fault.from, fault.to);
    assert.notEqual(changed, text);
    new Script(changed, { filename: target });
    fs.writeFileSync(target, changed);
  }
  const load = (file) => require(path.join(dir, 'bench', file));
  return { dir, load };
}
const evaluate = (item, windows) =>
  item
    .load('lib/linux-own-cpu-model.js')
    .evaluateCpuReference({ clockTicksPerSecond: '100', windows });

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
  for (const dir of directories.splice(0)) {
    expect(path.dirname(path.resolve(dir))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(dir)).toMatch(/^linux-own-cpu-mutation-/);
    expect(fs.lstatSync(dir).isDirectory()).toBe(true);
    expect(fs.lstatSync(dir).isSymbolicLink()).toBe(false);
    for (const file of Object.keys(require.cache))
      if (file.startsWith(dir + path.sep)) delete require.cache[file];
    fs.rmSync(dir, { recursive: true });
  }
  sources.forEach((file, index) =>
    expect(fs.readFileSync(path.join(root, file))).toEqual(originalBytes[index]),
  );
});

const faults = [
  {
    name: 'getconf high-bit bytes cannot alias canonical ASCII digits',
    file: 'bench/lib/linux-own-cpu-proc.js',
    from: /bytes\.some\(\(byte\) => byte > 127\)/g,
    to: 'false',
    async oracle(item) {
      const bytes = Buffer.from([0xb1, 0xb0, 0xb0, 0x0a]);
      assert.equal(bytes.toString('ascii'), '100\n');
      assert.throws(
        () => item.load('lib/linux-own-cpu-proc.js').parseClockTicks(bytes),
        /linux-own-cpu-proc-unavailable/,
      );
    },
  },
  {
    name: 'selected SELF fields preserve exact utime rather than an adjacent field',
    file: 'bench/lib/linux-own-cpu-proc.js',
    from: /userTicks: fields\[11\]/g,
    to: 'userTicks: fields[10]',
    async oracle(item) {
      const bytes = statText({
        pid: 17,
        user: '9007199254740993',
        system: '23',
        start: '9007199254740994',
      });
      assert.deepEqual(item.load('lib/linux-own-cpu-proc.js').parseSelfStat(bytes, 17), {
        userTicks: '9007199254740993',
        systemTicks: '23',
        startTicks: '9007199254740994',
        byteLength: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    },
  },
  {
    name: 'touching the exclusive reference upper endpoint is not overlap',
    file: 'bench/lib/linux-own-cpu-model.js',
    from: /api \* hz < upper/g,
    to: 'api * hz <= upper',
    async oracle(item) {
      const windows = referenceWindows();
      windows[0].api.userUs = 1020000;
      const result = evaluate(item, windows);
      assert.equal(result.endpoints[0].apiLowerUs, '1220000');
      assert.equal(result.endpoints[0].consistent, false);
    },
  },
  {
    name: 'delta reference bounds include uncertainty from the first endpoint',
    file: 'bench/lib/linux-own-cpu-model.js',
    from: /sum\(b\.before\) - sum\(a\.after\) - 2n/g,
    to: 'sum(b.before) - sum(a.after)',
    async oracle(item) {
      const result = evaluate(item, referenceWindows());
      assert.deepEqual(result.delta.referenceLowerUs, { numerator: '8000000', denominator: '100' });
      assert.deepEqual(result.delta.referenceUpperExclusiveUs, {
        numerator: '12000000',
        denominator: '100',
      });
      assert.equal(result.delta.apiDeltaUs, '100000');
    },
  },
  {
    name: 'zero progress cannot be described as nonvacuous corroboration',
    file: 'bench/lib/linux-own-cpu-model.js',
    from: /lower > 4n \* hz\s*&&\s*apiDelta > 0n/g,
    to: 'true',
    async oracle(item) {
      const windows = referenceWindows();
      windows[1].before.userTicks = '100';
      windows[1].after.userTicks = '100';
      windows[1].api.userUs = 1000000;
      const result = evaluate(item, windows);
      assert.equal(result.delta.apiDeltaUs, '0');
      assert.equal(result.state, 'insufficient-resolution');
      assert.equal(result.delta.sufficientResolution, false);
    },
  },
  {
    name: 'a reported full iteration count cannot override a partial work state',
    file: 'bench/lib/linux-own-cpu-reference.js',
    from: /receipt\.workload\.state === 'completed'/g,
    to: 'true',
    async oracle(item) {
      const work = item.load('lib/linux-own-cpu-work.js');
      // This inconsistent seam isolates the state guard from the independent iteration guard.
      const stub = vi.spyOn(work, 'runFixedWork').mockReturnValue({
        state: 'partial',
        reason: 'work-budget',
        completedIterations: work.WORK.iterations,
        checksum: 1,
        beforeNs: '10000000',
        afterNs: '10000000',
      });
      try {
        const core = item.load('lib/linux-own-cpu-reference.js');
        const result = await core.runLinuxOwnCpuReference(options(), fixtureDeps());
        assert.equal(stub.mock.calls.length, 1);
        assert.equal(result.receipt.acquisition.complete, true);
        assert.equal(result.receipt.comparison.state, 'consistent-under-declared-model');
        assert.equal(result.receipt.workload.completedIterations, work.WORK.iterations);
        assert.equal(result.receipt.workload.state, 'partial');
        assert.equal(result.exitCode, 3);
        assert.equal(result.receipt.state, 'incomplete');
      } finally {
        stub.mockRestore();
      }
    },
  },
  {
    name: 'invalid fixed CLI arguments cannot return success',
    file: 'bench/linux-own-cpu-qualify.cjs',
    from: /return 2;/g,
    to: 'return 0;',
    async oracle(item) {
      assert.equal(await item.load('linux-own-cpu-qualify.cjs').main([]), 2);
    },
  },
  {
    name: 'source descriptors must match their names observed before open',
    file: 'bench/lib/linux-own-cpu-storage.js',
    from: /!same\(named, before\)/g,
    to: 'false',
    async oracle(item) {
      const target = path.join(item.dir, sources[0]);
      let calls = 0;
      const named = vi.spyOn(fs, 'lstatSync').mockImplementation((file, ...args) => {
        const stat = native.lstatSync(file, ...args);
        if (file === target && args[0]?.bigint && ++calls === 1) stat.ino += 1n;
        return stat;
      });
      try {
        assert.throws(
          () => item.load('lib/linux-own-cpu-storage.js').inventory(),
          /linux-own-cpu-storage-unavailable/,
        );
      } finally {
        named.mockRestore();
      }
    },
  },
  {
    name: 'an uncertain source close cannot produce a successful source inventory',
    file: 'bench/lib/linux-own-cpu-storage.js',
    from: /if \(fd !== undefined\) fs\.closeSync\(fd\);/g,
    to: 'if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }',
    async oracle(item) {
      const target = path.join(item.dir, sources[0]);
      let sourceFd,
        active = false,
        failures = 0;
      const open = vi.spyOn(fs, 'openSync').mockImplementation((file, ...args) => {
        const fd = native.openSync(file, ...args);
        if (file === target) {
          sourceFd = fd;
          active = true;
        }
        return fd;
      });
      const close = vi.spyOn(fs, 'closeSync').mockImplementation((fd) => {
        native.closeSync(fd);
        if (fd === sourceFd && active) {
          active = false;
          failures++;
          throw Error('owned-source-close-unavailable');
        }
      });
      try {
        assert.throws(
          () => item.load('lib/linux-own-cpu-storage.js').inventory(),
          /owned-source-close-unavailable/,
        );
        assert.equal(failures, 1);
        assert.throws(() => native.fstatSync(sourceFd), { code: 'EBADF' });
      } finally {
        close.mockRestore();
        open.mockRestore();
      }
    },
  },
  {
    name: 'uncertain final publication close cannot return zero even for a cancelled capture',
    file: 'bench/lib/linux-own-cpu-reference.js',
    from: /exitCode = 6;/g,
    to: 'exitCode = 0;',
    async oracle(item) {
      const opts = options(),
        deps = fixtureDeps(),
        controller = new AbortController();
      controller.abort();
      const target = path.join(opts.out, 'cpu-reference-final.json');
      const work = vi
        .spyOn(item.load('lib/linux-own-cpu-work.js'), 'runFixedWork')
        .mockImplementation(() => {
          throw Error('fixture-work-forbidden');
        });
      const core = item.load('lib/linux-own-cpu-reference.js');
      let finalFd,
        active = false,
        failures = 0;
      const open = vi.spyOn(fs, 'openSync').mockImplementation((file, ...args) => {
        const fd = native.openSync(file, ...args);
        if (file === target) {
          finalFd = fd;
          active = true;
        }
        return fd;
      });
      const close = vi.spyOn(fs, 'closeSync').mockImplementation((fd) => {
        native.closeSync(fd);
        if (fd === finalFd && active) {
          active = false;
          failures++;
          throw Error('owned-final-close-unavailable');
        }
      });
      try {
        const result = await core.runLinuxOwnCpuReference(
          { ...opts, signal: controller.signal },
          deps,
        );
        assert.equal(failures, 1);
        assert.equal(work.mock.calls.length, 0);
        assert.throws(() => native.fstatSync(finalFd), { code: 'EBADF' });
        assert.equal(result.exitCode, 6);
        assert.equal(result.receipt.state, 'persistence-failed');
      } finally {
        close.mockRestore();
        open.mockRestore();
        work.mockRestore();
      }
    },
  },
];

describe('CI private source-copy mutation controls for Linux SELF CPU reference', () => {
  it.each(faults)('$name has a passing baseline and AssertionError-only mutant', async (fault) => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await fault.oracle(stage());
    await assert.rejects(
      () => fault.oracle(stage(fault)),
      (error) => error instanceof AssertionError,
    );
  });
});
