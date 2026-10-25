import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { hashPlan, evaluateReproducibility, LIMITS } = require('../../../bench/lib/reproducibility');
const { parseInput, readStable } = require('../../../bench/lib/reproducibility-input');
const root = path.resolve(import.meta.dirname, '../../..');
const temporary = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true });
});
function fixture() {
  const identity = {
    commit: 'a'.repeat(40),
    ...Object.fromEntries(
      [
        'sourceSha256',
        'harnessSha256',
        'binarySha256',
        'configSha256',
        'inputSha256',
        'agentVersionsSha256',
        'providerVersionsSha256',
        'osImageSha256',
        'calibrationSha256',
      ].map((key) => [key, 'b'.repeat(64)]),
    ),
    machine: 'fixture',
    os: 'fixture',
    agentVersions: 'fixture-v1',
    sensorMode: 'fixture',
    method: 'offline',
    privileges: 'ordinary',
  };
  const key = {
    metric: 'cpu',
    phase: 'idle',
    cohort: 'product',
    percentile: 'p50',
    unit: 'percent',
  };
  const plan = {
    id: 'fixture-plan',
    version: 1,
    frozenAt: '2026-10-24T00:00:00.000Z',
    identity,
    runIds: ['r1', 'r2', 'r3'],
    cells: [
      {
        ...key,
        A: 0,
        R: 0,
        plannedCount: 1,
        rationaleId: 'fixture',
        rationaleSha256: 'c'.repeat(64),
        calibrationUncertainty: { value: 0, reason: null },
      },
    ],
  };
  return {
    schema: 'reproducibility-input',
    schemaVersion: 1,
    planSha256: hashPlan(plan),
    plan,
    runs: plan.runIds.map((runId) => ({
      runId,
      startedAt: '2026-10-24T00:00:01.000Z',
      identity,
      cells: [
        {
          ...key,
          status: 'complete',
          estimate: 1,
          reason: null,
          counts: { planned: 1, valid: 1, excluded: 0, missing: 0, failed: 0 },
        },
      ],
    })),
  };
}
function files(text = JSON.stringify(fixture())) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reproducibility-'));
  temporary.push(directory);
  const input = path.join(directory, 'input.json'),
    output = path.join(directory, 'output.json');
  fs.writeFileSync(input, text);
  return { input, output, directory };
}
function invoke(item, args = ['--input', item.input, '--output', item.output]) {
  return spawnSync(process.execPath, ['bench/reproducibility.cjs', ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 8192,
  });
}
describe('bounded reproducibility JSON and CLI', () => {
  it('writes one exact deterministic result while preserving the input bytes', () => {
    const input = fixture(),
      item = files(JSON.stringify(input));
    const before = fs.readFileSync(item.input);
    expect(invoke(item).status).toBe(0);
    const result = JSON.parse(fs.readFileSync(item.output, 'utf8'));
    const { inputBytesSha256, ...arithmetic } = result;
    expect(inputBytesSha256).toBe(createHash('sha256').update(before).digest('hex'));
    expect(arithmetic).toEqual(evaluateReproducibility(input));
    expect(fs.readFileSync(item.input)).toEqual(before);
    const second = files(JSON.stringify(input));
    expect(invoke(second).status).toBe(0);
    expect(fs.readFileSync(second.output)).toEqual(fs.readFileSync(item.output));
  });
  it('refuses existing output exclusively and preserves its contents', () => {
    const item = files();
    fs.writeFileSync(item.output, 'preserve');
    const result = invoke(item);
    expect(result.status).toBe(5);
    expect(result.stderr).toBe('reproducibility: output-path\n');
    expect(fs.readFileSync(item.output, 'utf8')).toBe('preserve');
  });
  it('preserves a racing output created immediately before the exclusive open', () => {
    const item = files(),
      preload = path.join(item.directory, 'race-preload.cjs');
    fs.writeFileSync(
      preload,
      `
      const fs = require('node:fs');
      const original = fs.openSync;
      const output = ${JSON.stringify(item.output)};
      fs.openSync = function(file, flags, ...args) {
        if (file === output && typeof flags === 'number' && (flags & fs.constants.O_CREAT)) {
          const sentinel = original(output, 'wx');
          try { fs.writeFileSync(sentinel, 'race-sentinel'); } finally { fs.closeSync(sentinel); }
        }
        return original(file, flags, ...args);
      };
    `,
    );
    const result = spawnSync(
      process.execPath,
      [
        '--require',
        preload,
        'bench/reproducibility.cjs',
        '--input',
        item.input,
        '--output',
        item.output,
      ],
      { cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 8192 },
    );
    expect(result.status).toBe(5);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('reproducibility: output-path\n');
    expect(fs.readFileSync(item.output, 'utf8')).toBe('race-sentinel');
  });
  it('rejects malformed UTF-8 embedded in an otherwise valid JSON string', () => {
    const bytes = Buffer.concat([
      Buffer.from('{"value":"'),
      Buffer.from([0xc3, 0x28]),
      Buffer.from('"}'),
    ]);
    expect(() => parseInput(bytes)).toThrow('reproducibility-input-invalid');
  });
  it('emits fixed diagnostics for private input sentinels and privately named paths', () => {
    const item = files('{"private-content-sentinel":private-prompt-sentinel}');
    const privateInput = path.join(item.directory, 'private-path-sentinel.json');
    fs.renameSync(item.input, privateInput);
    item.input = privateInput;
    const result = invoke(item);
    expect(result.status).toBe(4);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('reproducibility: input-invalid\n');
    expect(result.stdout + result.stderr).not.toMatch(/private-|sentinel/);
    expect(fs.existsSync(item.output)).toBe(false);
  });
  it.each(['1.0', '1e0', '-0', '1E+0', '9007199254740993', '1e309'])(
    'refuses noncanonical or nonfinite number %s',
    (token) => {
      const item = files(JSON.stringify(fixture()).replace('"estimate":1', `"estimate":${token}`));
      const result = invoke(item);
      expect(result.status).toBe(4);
      expect(result.stderr).toBe('reproducibility: input-invalid\n');
      expect(fs.existsSync(item.output)).toBe(false);
    },
  );
  it.each([
    Buffer.from('{"x":1,"x":2}'),
    Buffer.from('{"x":1,"\\u0078":2}'),
    Buffer.from('{"private prompt": invalid}'),
    Buffer.from([0xff]),
    Buffer.from('{"x":"\0"}'),
    Buffer.from('['.repeat(14) + '0' + ']'.repeat(14)),
    Buffer.alloc(LIMITS.bytes + 1, 32),
    Buffer.from('{"a":"' + 's'.repeat(1025) + '"}'),
  ])('refuses malformed, duplicate, deep or oversized input %# with fixed errors', (bytes) => {
    expect(() => parseInput(bytes)).toThrow('reproducibility-input-invalid');
  });
  it('accepts canonical JSON.stringify numeric spellings including subnormal/exponent values', () => {
    for (const value of [0, 1, 1e21, -1e21, 5e-324, 1.7976931348623157e308])
      expect(parseInput(Buffer.from(JSON.stringify({ value }))).value).toBe(value);
  });
  it('refuses growth observed during a bounded read', () => {
    const item = files(),
      original = fs.readSync;
    vi.spyOn(fs, 'readSync').mockImplementationOnce((...args) => {
      const count = original(...args);
      fs.appendFileSync(item.input, ' ');
      return count;
    });
    expect(() => readStable(item.input)).toThrow('reproducibility-input-invalid');
  });
  it('refuses a same-size rewrite with an explicitly changed modification timestamp', () => {
    const item = files(),
      original = fs.readSync;
    fs.utimesSync(item.input, new Date('2000-01-01T00:00:00Z'), new Date('2000-01-01T00:00:00Z'));
    const size = fs.statSync(item.input).size;
    vi.spyOn(fs, 'readSync').mockImplementationOnce((...args) => {
      const read = original(...args);
      fs.writeFileSync(item.input, Buffer.alloc(size, 32));
      fs.utimesSync(item.input, new Date('2001-01-01T00:00:00Z'), new Date('2001-01-01T00:00:00Z'));
      return read;
    });
    expect(() => readStable(item.input)).toThrow('reproducibility-input-invalid');
    expect(fs.statSync(item.input).size).toBe(size);
  });
  it('refuses a named-path replacement identity even when other metadata agrees', () => {
    const item = files(),
      named = fs.lstatSync(item.input, { bigint: true });
    vi.spyOn(fs, 'lstatSync').mockReturnValueOnce({
      ...named,
      ino: named.ino + 1n,
      isSymbolicLink: () => false,
    });
    expect(() => readStable(item.input)).toThrow('reproducibility-input-invalid');
  });
  it('refuses oversized input without writing output', () => {
    const item = files(Buffer.alloc(LIMITS.bytes + 1));
    expect(invoke(item).status).toBe(3);
    expect(fs.existsSync(item.output)).toBe(false);
  });
  it('rejects directories and hard links as input', () => {
    const item = files();
    expect(invoke(item, ['--input', item.directory, '--output', item.output]).status).toBe(3);
    const linked = path.join(item.directory, 'linked.json');
    fs.linkSync(item.input, linked);
    expect(invoke(item).status).toBe(3);
    expect(fs.existsSync(item.output)).toBe(false);
  });
  it('uses fixed usage diagnostics and documents canonical numerals in help', () => {
    const item = files();
    expect(invoke(item, []).status).toBe(2);
    const help = invoke(item, ['--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toMatch(/1\.0, 1e0 and -0 are refused/);
  });
});
