import { createRequire } from 'node:module';
import { AssertionError, strict as assert } from 'node:assert';
import { Script } from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, createBundle, readJson, restamp, writeJson } from './resource-replay-fixtures';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../../..');
const sources = [
  ...new Set([
    ...require('../../../bench/lib/resource-supervisor-storage').SOURCES,
    ...require('../../../bench/lib/resource-replay-current').SOURCES,
  ]),
];
const originalBytes = sources.map((file) => fs.readFileSync(path.join(root, file)));
const directories = [];
const native = Object.fromEntries(
  ['openSync', 'closeSync', 'fstatSync', 'lstatSync'].map((key) => [key, fs[key].bind(fs)]),
);
function stage(fault) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resource-replay-fault-'));
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
  return {
    dir,
    replay: load('lib/resource-replay.js'),
    io: load('lib/resource-replay-io.js'),
    json: load('lib/resource-replay-json.js'),
    cli: load('resource-session-replay.cjs'),
  };
}
async function bundle(item) {
  const value = await createBundle({ root: item.dir });
  assert.equal(value.producerResult.exitCode, 0);
  assert.equal(value.producerResult.receipt.executionMode, 'injected');
  return { ...value, out: path.join(value.parent, 'report') };
}
const inspect = (item, value) =>
  item.replay.inspectResourceReplay({ input: value.input, out: value.out });

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
  for (const dir of directories.splice(0)) {
    expect(path.dirname(path.resolve(dir))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(dir)).toMatch(/^resource-replay-fault-/);
    expect(fs.lstatSync(dir).isDirectory()).toBe(true);
    expect(fs.lstatSync(dir).isSymbolicLink()).toBe(false);
    for (const file of Object.keys(require.cache))
      if (file.startsWith(dir + path.sep)) delete require.cache[file];
    fs.rmSync(dir, { recursive: true });
  }
  sources.forEach((file, i) =>
    expect(fs.readFileSync(path.join(root, file))).toEqual(originalBytes[i]),
  );
});

const faults = [
  {
    name: 'invalid CLI arguments cannot return success',
    file: 'bench/resource-session-replay.cjs',
    from: /return 2;/g,
    to: 'return 0;',
    async oracle(item) {
      assert.equal(await item.cli.main([]), 2);
    },
  },
  {
    name: 'surviving parent and child option declarations must agree despite other missing files',
    file: 'bench/lib/resource-replay-child.js',
    from: /!c\.equal\(parent\.plan\.child,/g,
    to: 'false && !c.equal(parent.plan.child,',
    async oracle(item) {
      const value = await bundle(item);
      writeJson(value.input, 'supervision-plan.json', (v) => {
        v.child.maxAcquisitionUs++;
      });
      for (const name of ['raw-samples.json', 'bracketed-intervals.json', 'session-final.json'])
        fs.unlinkSync(path.join(value.input, 'capture', name));
      restamp(value.input);
      const result = inspect(item, value);
      assert.equal(result.exitCode, 4);
      assert.equal(result.report.classification, 'refused');
    },
  },
  {
    name: 'coherently restamped stored arithmetic must equal the whole current recomputation',
    file: 'bench/lib/resource-replay.js',
    from: /!c\.equal\(recomputed, child\.derived\)/g,
    to: 'false',
    async oracle(item) {
      const value = await bundle(item);
      writeJson(value.input, 'capture/bracketed-intervals.json', (v) => {
        v.memory[0].residentBytes++;
      });
      restamp(value.input);
      assert.equal(inspect(item, value).exitCode, 4);
    },
  },
  {
    name: 'missing pending evidence cannot be admitted as a complete bundle',
    file: 'bench/lib/resource-replay.js',
    from: /report\.input\.missing\.length === 0/g,
    to: 'true',
    async oracle(item) {
      const value = await bundle(item);
      fs.unlinkSync(path.join(value.input, 'capture/session-pending.json'));
      const result = inspect(item, value);
      assert.equal(result.exitCode, 3);
      assert.equal(result.report.classification, 'incomplete');
      assert.deepEqual(result.report.input.missing, ['capture/session-pending.json']);
    },
  },
  {
    name: 'a reported latched failure survives matching later zero exit and close',
    file: 'bench/lib/resource-replay.js',
    from: /parent\?\.success === true/g,
    to: 'true',
    async oracle(item) {
      const value = await bundle(item);
      writeJson(value.input, 'supervision-final.json', (v) => {
        v.supervision.cause = 'wall-limit';
        v.supervision.elapsedMs = 10001;
        v.state = 'failed';
      });
      const original = readJson(value.input, 'supervision-final.json');
      assert.deepEqual(original.supervision.exit, { observed: true, code: 0, signal: null });
      assert.deepEqual(original.supervision.close, { observed: true, code: 0, signal: null });
      const result = inspect(item, value);
      assert.equal(result.exitCode, 3);
      assert.equal(result.report.reportedChildPublicationSupport, 'not-supported');
    },
  },
  {
    name: 'decoded duplicate JSON keys are refused before ordinary object accumulation',
    file: 'bench/lib/resource-replay-json.js',
    from: /Object\.hasOwn\(out, key\)/g,
    to: 'false',
    async oracle(item) {
      assert.throws(
        () => item.json.parse(Buffer.from('{"a":1,"\\u0061":2}')),
        /resource-replay-refused/,
      );
    },
  },
  {
    name: 'the maximum JSON byte bound applies even to harmless trailing whitespace',
    file: 'bench/lib/resource-replay-json.js',
    from: /bytes\.length > 524289/g,
    to: 'false',
    async oracle(item) {
      const bytes = Buffer.concat([Buffer.from('{}'), Buffer.alloc(524288, 0x20)]);
      assert.equal(bytes.length, 524290);
      assert.throws(() => item.json.parse(bytes), /resource-replay-refused/);
    },
  },
  {
    name: 'the opened descriptor must match the file identity observed before open',
    file: 'bench/lib/resource-replay-io.js',
    from: /!same\(named, before\)/g,
    to: 'false',
    async oracle(item) {
      const target = path.join(item.dir, 'descriptor-input.json');
      fs.writeFileSync(target, '{}');
      let seen = 0;
      const named = vi.spyOn(fs, 'lstatSync').mockImplementation((file, ...args) => {
        const stat = native.lstatSync(file, ...args);
        if (file === target && ++seen === 1) stat.ino += 1n;
        return stat;
      });
      try {
        assert.throws(() => item.io.read(target, 16, { bytes: 0 }), /resource-replay-refused/);
      } finally {
        named.mockRestore();
      }
    },
  },
  {
    name: 'the retained name must still match the descriptor after reading',
    file: 'bench/lib/resource-replay-io.js',
    from: /!same\(before, fs\.lstatSync\(file, \{ bigint: true \}\)\)/g,
    to: 'false',
    async oracle(item) {
      const target = path.join(item.dir, 'named-input.json');
      fs.writeFileSync(target, '{}');
      let seen = 0;
      const named = vi.spyOn(fs, 'lstatSync').mockImplementation((file, ...args) => {
        const stat = native.lstatSync(file, ...args);
        if (file === target && ++seen === 2) stat.ctimeNs += 1n;
        return stat;
      });
      try {
        assert.throws(() => item.io.read(target, 16, { bytes: 0 }), /resource-replay-refused/);
      } finally {
        named.mockRestore();
      }
    },
  },
  {
    name: 'uncertain report close cannot become successful publication',
    file: 'bench/lib/resource-replay.js',
    from: /error\.message === 'resource-replay-output-refused'\s*\? 5\s*: 6/g,
    to: "error.message === 'resource-replay-output-refused' ? 5 : 0",
    async oracle(item) {
      const value = await bundle(item),
        target = path.join(value.out, 'resource-replay.json');
      let finalFd,
        failed = 0;
      const open = vi.spyOn(fs, 'openSync').mockImplementation((file, ...args) => {
        const fd = native.openSync(file, ...args);
        if (file === target) finalFd = fd;
        return fd;
      });
      const close = vi.spyOn(fs, 'closeSync').mockImplementation((fd) => {
        native.closeSync(fd);
        if (fd === finalFd) {
          failed++;
          throw Error('owned-report-close-unavailable');
        }
      });
      try {
        const result = inspect(item, value);
        assert.equal(failed, 1);
        assert.equal(Number.isSafeInteger(finalFd), true);
        assert.throws(() => native.fstatSync(finalFd), { code: 'EBADF' });
        assert.equal(result.exitCode, 6);
      } finally {
        close.mockRestore();
        open.mockRestore();
      }
    },
  },
];

describe('CI private source-copy mutation controls for offline resource replay', () => {
  it.each(faults)(
    '$name has a passing baseline and an AssertionError-only mutant',
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
