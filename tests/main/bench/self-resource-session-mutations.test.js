import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { AssertionError, strict as assert } from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const root = path.resolve('.');
const sources = [
  'bench/self-resource-run.cjs',
  'bench/lib/self-resource-session.js',
  'bench/lib/own-resource-storage.js',
  'bench/lib/self-resource-sampler.js',
  'bench/lib/bracketed-resource-intervals.js',
];
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const originalHashes = sources.map((file) => hash(path.join(root, file)));
const directories = [];
function stage(file, from, to) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'own-resource-fault-'));
  directories.push(dir);
  for (const source of sources) {
    const target = path.join(dir, source);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, source), target, fs.constants.COPYFILE_EXCL);
  }
  if (file) {
    const target = path.join(dir, file),
      text = fs.readFileSync(target, 'utf8');
    assert.equal(text.split(from).length, 2, 'Fault must target one exact production expression');
    fs.writeFileSync(target, text.replace(from, to));
  }
  return {
    dir,
    session: require(path.join(dir, 'bench/lib/self-resource-session.js')),
    storage: require(path.join(dir, 'bench/lib/own-resource-storage.js')),
    cli: require(path.join(dir, 'bench/self-resource-run.cjs')),
  };
}
function options(dir) {
  return {
    runId: 'fault-control',
    durationMs: 1000,
    maxAcquisitionUs: 10000,
    maxCpuUncertaintyUs: 20000,
    out: path.join(dir, 'output'),
  };
}
function readings() {
  let ns = 0n;
  return { nowNs: () => (ns += 1000n), cpuUsage: () => ({ user: 0, system: 0 }), rss: () => 0 };
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of directories.splice(0)) {
    expect(path.dirname(dir)).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(dir)).toMatch(/^own-resource-fault-/);
    expect(fs.lstatSync(dir).isSymbolicLink()).toBe(false);
    fs.rmSync(dir, { recursive: true });
  }
  expect(sources.map((file) => hash(path.join(root, file)))).toEqual(originalHashes);
});

const faults = [
  {
    name: 'CLI rejects invalid input',
    file: sources[0],
    from: 'return 2;',
    to: 'return 0;',
    async oracle({ cli }) {
      assert.equal(await cli.main([]), 2);
    },
  },
  {
    name: 'cancelled acquisition remains incomplete',
    file: sources[1],
    from: "receipt.acquisition.state === 'complete'",
    to: 'true',
    async oracle({ dir, session }) {
      const controller = new AbortController();
      controller.abort();
      const result = await session.runSelfResourceSession({
        ...options(dir),
        signal: controller.signal,
      });
      assert.equal(result.exitCode, 3);
      assert.equal(result.receipt.acquisition.complete, false);
    },
  },
  {
    name: 'raw persistence precedes derivation',
    file: sources[1],
    from: 'if (!persistenceFailed) {',
    to: 'if (true) {',
    async oracle({ dir, session, storage }) {
      const original = storage.createStorage;
      let derivedWrites = 0;
      storage.createStorage = (...args) => {
        const writer = original(...args);
        return {
          ...writer,
          write(name, value) {
            if (name === 'raw-samples.json') throw new Error('fixture-write-failure');
            if (name === 'bracketed-intervals.json') derivedWrites++;
            return writer.write(name, value);
          },
        };
      };
      try {
        const result = await session.runSelfResourceSession(options(dir), readings());
        assert.equal(result.exitCode, 6);
        assert.equal(derivedWrites, 0);
      } finally {
        storage.createStorage = original;
      }
    },
  },
  {
    name: 'source endpoint disagreement refuses success',
    file: sources[1],
    from: 'JSON.stringify(before) === JSON.stringify(after)',
    to: 'true',
    async oracle({ dir, session, storage }) {
      const inventory = storage.inventory;
      let calls = 0;
      storage.inventory = () => {
        const value = inventory();
        if (++calls === 2) value.files[0].sha256 = 'f'.repeat(64);
        return value;
      };
      try {
        const result = await session.runSelfResourceSession(options(dir), readings());
        assert.equal(result.exitCode, 4);
      } finally {
        storage.inventory = inventory;
      }
    },
  },
];

describe('CI source-copy mutation checks for resource acquisition', () => {
  it.each(faults)('$name fails its independent contract after a source fault', async (fault) => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await fault.oracle(stage());
    await assert.rejects(
      () => fault.oracle(stage(fault.file, fault.from, fault.to)),
      (error) => error instanceof AssertionError,
    );
  });
});
