import { createRequire } from 'node:module';
import { AssertionError, strict as assert } from 'node:assert';
import { Script } from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, createBundle, files, read, restamp, write } from './linux-cpu-replay-fixtures.js';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../../..');
const sources = require('../../../bench/lib/linux-cpu-replay-io').SOURCES;
const original = sources.map((file) => fs.readFileSync(path.join(root, file)));
const directories = [];
const native = Object.fromEntries(
  ['openSync', 'closeSync', 'fstatSync'].map((key) => [key, fs[key].bind(fs)]),
);

function stage(fault) {
  assert.equal(sources.length, 13);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-cpu-replay-mutant-'));
  directories.push(dir);
  for (const source of sources) {
    const target = path.join(dir, source);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, source), target, fs.constants.COPYFILE_EXCL);
  }
  if (fault) {
    const target = path.join(dir, fault.file),
      text = fs.readFileSync(target, 'utf8');
    assert.equal([...text.matchAll(fault.from)].length, 1, 'Fault must match exactly once');
    const changed = text.replace(fault.from, fault.to);
    assert.notEqual(changed, text);
    new Script(changed, { filename: target });
    fs.writeFileSync(target, changed);
  }
  return { dir, replay: require(path.join(dir, 'bench/lib/linux-cpu-replay.js')) };
}
const inspect = (item, b) => item.replay.replayLinuxCpu({ input: b.input, out: b.out });
async function healthy(item) {
  const b = createBundle({ root: item.dir });
  const result = await inspect(item, b);
  assert.equal(result.exitCode, 0, 'The independent fabricated control must pass first');
  assert.equal(result.report.state, 'consistent-for-conditional-replay');
  assert.equal(result.report.originalFinalPublication, 'unknown');
  for (const key of [
    'sourceAuthenticated',
    'measurementAccepted',
    'calibrationAccepted',
    'w8Accepted',
  ])
    assert.equal(result.report[key], false);
  b.out = path.join(b.base, 'observed');
  return b;
}
function update(b, file, change) {
  const value = read(b, file);
  change(value);
  write(b, file, value);
}
async function refusal(item, b) {
  const result = await inspect(item, b);
  assert.equal(result.exitCode, 4);
  assert.equal(result.report.state, 'refused');
}
async function uncertainClose(target, action) {
  let fd,
    active = false,
    failures = 0;
  const open = vi.spyOn(fs, 'openSync').mockImplementation((file, ...args) => {
    const value = native.openSync(file, ...args);
    if (file === target) {
      fd = value;
      active = true;
    }
    return value;
  });
  const close = vi.spyOn(fs, 'closeSync').mockImplementation((value) => {
    native.closeSync(value);
    if (value === fd && active) {
      active = false;
      if (!failures) {
        failures++;
        throw Error('owned-close-unavailable');
      }
    }
  });
  try {
    const result = await action();
    assert.equal(failures, 1);
    assert.equal(Number.isSafeInteger(fd), true);
    assert.throws(() => native.fstatSync(fd), { code: 'EBADF' });
    return result;
  } finally {
    close.mockRestore();
    open.mockRestore();
  }
}
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
  for (const dir of directories.splice(0)) {
    expect(path.dirname(path.resolve(dir))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(dir)).toMatch(/^linux-cpu-replay-mutant-/);
    expect(fs.lstatSync(dir).isDirectory()).toBe(true);
    expect(fs.lstatSync(dir).isSymbolicLink()).toBe(false);
    for (const file of Object.keys(require.cache))
      if (file.startsWith(dir + path.sep)) delete require.cache[file];
    fs.rmSync(dir, { recursive: true });
  }
  sources.forEach((file, index) =>
    expect(fs.readFileSync(path.join(root, file))).toEqual(original[index]),
  );
});

const faults = [
  {
    name: 'every value of the whole stored current-model comparison is material',
    file: 'bench/lib/linux-cpu-replay.js',
    from: /c\.equal\(producerComparison,\s*w\.comparison\)/g,
    to: 'true',
    async oracle(item) {
      const b = await healthy(item);
      for (const file of [files[3], files[4]])
        update(b, file, (value) => {
          value.comparison.delta.referenceLowerUs.numerator = '8000001';
        });
      restamp(b);
      await refusal(item, b);
    },
  },
  {
    name: 'an exact surviving plan-file hash cannot be replaced by a same-shaped declaration',
    file: 'bench/lib/linux-cpu-replay-bindings.js',
    from: /x\s*===\s*part\.sha256/g,
    to: 'true',
    async oracle(item) {
      const b = await healthy(item);
      for (const file of files.slice(2)) fs.unlinkSync(path.join(b.input, file));
      update(b, files[1], (value) => {
        value.planSha256 = 'f'.repeat(64);
      });
      await refusal(item, b);
    },
  },
  {
    name: 'coherently rehashed raw CPU counters must match their ordinal window',
    file: 'bench/lib/linux-cpu-replay-bindings.js',
    from: /cpu\.userUs\s*===\s*row\.api\.userUs/g,
    to: 'true',
    async oracle(item) {
      const b = await healthy(item);
      update(b, files[2], (value) => {
        value.samples[0].cpu.userUs++;
      });
      restamp(b);
      await refusal(item, b);
    },
  },
  {
    name: 'a present endpoint contradiction survives a missing second window and external peers',
    file: 'bench/lib/linux-own-cpu-model.js',
    from: /result\.endpoints\.some\(\(e\)\s*=>\s*!e\.consistent\)/g,
    to: 'false',
    async oracle(item) {
      const b = await healthy(item);
      for (const file of [files[2], files[4]]) fs.unlinkSync(path.join(b.input, file));
      update(b, files[3], (value) => {
        value.windows = value.windows.slice(0, 1);
        value.windows[0].api.userUs = 1020000;
        value.comparison.state = 'incomplete';
        value.comparison.reason = 'missing-reference';
        value.comparison.delta = null;
        value.comparison.endpoints = [
          {
            index: 0,
            apiLowerUs: '1220000',
            apiUpperExclusiveUs: '1220002',
            referenceLowerUs: { numerator: '120000000', denominator: '100' },
            referenceUpperExclusiveUs: { numerator: '122000000', denominator: '100' },
            consistent: false,
          },
        ];
      });
      restamp(b);
      await refusal(item, b);
    },
  },
  {
    name: 'an acceptance declaration cannot be promoted by coherent hashes',
    file: 'bench/lib/linux-cpu-replay-common.js',
    from: /v\[key\]\s*===\s*value/g,
    to: 'true',
    async oracle(item) {
      const b = await healthy(item);
      update(b, files[0], (value) => {
        value.calibrationAccepted = true;
      });
      restamp(b);
      await refusal(item, b);
    },
  },
  {
    name: 'confirmed predecessor records retain the fixed producer order',
    file: 'bench/lib/linux-cpu-replay-packets.js',
    from: /index\s*>\s*last/g,
    to: 'true',
    async oracle(item) {
      const b = await healthy(item);
      update(b, files[4], (value) => {
        [value.files[0], value.files[1]] = [value.files[1], value.files[0]];
      });
      await refusal(item, b);
    },
  },
  {
    name: 'uncertain current-source closure prevents a successful current implementation inventory',
    file: 'bench/lib/resource-replay-io.js',
    from: /if\s*\(fd\s*!==\s*undefined\)\s*fs\.closeSync\(fd\);/g,
    to: 'if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }',
    async oracle(item) {
      const b = await healthy(item);
      const result = await uncertainClose(path.join(item.dir, sources[0]), () => inspect(item, b));
      assert.equal(result.exitCode, 7);
      assert.equal(result.report.state, 'replay-unavailable');
    },
  },
  {
    name: 'a parseable report with uncertain final close cannot return publication success',
    file: 'bench/lib/linux-cpu-replay.js',
    from: /error\.message\s*===\s*'linux-cpu-replay-output-refused'\s*\?\s*5\s*:\s*6/g,
    to: '0',
    async oracle(item) {
      const b = await healthy(item),
        target = path.join(b.out, 'linux-cpu-replay.json');
      const result = await uncertainClose(target, () => inspect(item, b));
      assert.equal(result.exitCode, 6);
      const retained = JSON.parse(fs.readFileSync(target, 'utf8'));
      assert.equal(retained.state, 'consistent-for-conditional-replay');
      assert.equal(retained.finalPublication, 'not-self-attested');
      assert.equal(retained.originalFinalPublication, 'unknown');
    },
  },
];

describe('CI private source-copy controls for Linux CPU replay', () => {
  it.each(faults)(
    '$name has an independent passing baseline and AssertionError-only mutant',
    async (fault) => {
      await fault.oracle(stage());
      const mutant = stage(fault);
      await assert.rejects(
        () => fault.oracle(mutant),
        (error) => error instanceof AssertionError,
      );
    },
  );
});
