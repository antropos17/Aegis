import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const reference = require('../../../bench/lib/linux-own-cpu-reference');
const sampler = require('../../../bench/lib/self-resource-sampler');
const childProcess = require('node:child_process');
const actualRun = reference.runLinuxOwnCpuReference;
const cliFile = require.resolve('../../../bench/linux-own-cpu-qualify.cjs');
const main = (argv) => require(cliFile).main(argv);
const signals = ['SIGINT', 'SIGTERM'];
const directories = [],
  links = [];
let listeners;
function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-own-cpu-cli-'));
  directories.push(base);
  return { base, out: path.join(base, 'private-output') };
}
const args = (out) => ['--run-id', 'cli-self', '--out', out];
function streams() {
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  return { stdout, stderr, text: (spy) => spy.mock.calls.map(([chunk]) => String(chunk)).join('') };
}
function forbidProcesses() {
  return ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync'].map((key) =>
    vi.spyOn(childProcess, key).mockImplementation(() => {
      throw Error('fixture-process-forbidden');
    }),
  );
}
beforeEach(() => {
  listeners = signals.map((signal) => process.listeners(signal));
});
afterEach(() => {
  vi.restoreAllMocks();
  signals.forEach((signal, index) => {
    for (const listener of process.listeners(signal))
      if (!listeners[index].includes(listener)) process.removeListener(signal, listener);
  });
  for (const link of links.splice(0)) fs.unlinkSync(link);
  for (const dir of directories.splice(0)) {
    expect(path.dirname(path.resolve(dir))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(dir)).toMatch(/^linux-own-cpu-cli-/);
    expect(fs.lstatSync(dir).isSymbolicLink()).toBe(false);
    fs.rmSync(dir, { recursive: true });
  }
});

describe('fixed Linux SELF CPU reference CLI (CI only)', () => {
  it('imports and prints help without preflight, acquisition, output IO or subprocesses', async () => {
    const item = fixture(),
      output = streams(),
      previous = require.cache[cliFile];
    const run = vi.spyOn(reference, 'runLinuxOwnCpuReference').mockResolvedValue({ exitCode: 6 });
    const processes = forbidProcesses(),
      open = vi.spyOn(fs, 'openSync'),
      mkdir = vi.spyOn(fs, 'mkdirSync');
    try {
      delete require.cache[cliFile];
      const cli = require(cliFile);
      expect(output.text(output.stdout)).toBe('');
      expect(output.text(output.stderr)).toBe('');
      expect(await cli.main(['--help'])).toBe(0);
      expect(output.text(output.stdout)).toContain('--run-id SAFE --out NEWDIR');
      expect(output.text(output.stderr)).toBe('');
      expect(run).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
      expect(mkdir).not.toHaveBeenCalled();
      for (const operation of processes) expect(operation).not.toHaveBeenCalled();
      expect(fs.readdirSync(item.base)).toEqual([]);
    } finally {
      if (previous) require.cache[cliFile] = previous;
      else delete require.cache[cliFile];
    }
  });

  it('rejects missing, duplicate, unsafe and arbitrary-target options before any work', async () => {
    const item = fixture(),
      output = streams();
    const run = vi.spyOn(reference, 'runLinuxOwnCpuReference').mockResolvedValue({ exitCode: 6 });
    const processes = forbidProcesses(),
      open = vi.spyOn(fs, 'openSync');
    const invalid = [
      null,
      [],
      ['--run-id', 'missing-out'],
      ['--out', item.out],
      ['--run-id', 'one', '--run-id', 'two'],
      ['--out', item.out, '--out', item.out],
      ['--run-id', '../private-run', '--out', item.out],
      ['--run-id', 'ok', '--out', ''],
      [...args(item.out), '--help'],
    ];
    for (const flag of [
      '--pid',
      '--command',
      '--script',
      '--executable',
      '--profile',
      '--duration-ms',
      '--unknown',
    ])
      invalid.push(['--run-id', 'cli-self', flag, 'private-value']);
    for (const argv of invalid) expect(await main(argv)).toBe(2);
    expect(run).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    for (const operation of processes) expect(operation).not.toHaveBeenCalled();
    expect(fs.readdirSync(item.base)).toEqual([]);
    expect(output.text(output.stdout)).toBe('');
    expect(output.text(output.stderr)).toBe(
      'linux-own-cpu-qualify: input-invalid\n'.repeat(invalid.length),
    );
    expect(signals.map((signal) => process.listeners(signal))).toEqual(listeners);
  });

  it.each([
    [0, 0, null],
    [2, 2, 'input-invalid'],
    [3, 3, 'insufficient-or-incomplete'],
    [4, 4, 'reference-refused'],
    [5, 5, 'output-refused'],
    [6, 6, 'partial-bundle'],
    [7, 7, 'unsupported-or-unavailable'],
    [99, 6, 'partial-bundle'],
  ])(
    'maps dynamic result %i to code %i with fixed private-safe output',
    async (code, expected, reason) => {
      const item = fixture(),
        output = streams(),
        processes = forbidProcesses();
      const run = vi.spyOn(reference, 'runLinuxOwnCpuReference').mockResolvedValue({
        exitCode: code,
        receipt: { privateError: `private-content:${item.out}` },
      });
      expect(await main(args(item.out))).toBe(expected);
      expect(run).toHaveBeenCalledOnce();
      expect(run.mock.calls[0][0]).toEqual({
        runId: 'cli-self',
        out: item.out,
        signal: expect.any(AbortSignal),
      });
      expect(output.text(output.stdout)).toBe(
        expected === 0 ? 'linux-own-cpu-qualify: consistent-under-declared-model\n' : '',
      );
      expect(output.text(output.stderr)).toBe(
        expected === 0 ? '' : `linux-own-cpu-qualify: ${reason}\n`,
      );
      expect(signals.map((signal) => process.listeners(signal))).toEqual(listeners);
      for (const operation of processes) expect(operation).not.toHaveBeenCalled();
      expect(fs.existsSync(item.out)).toBe(false);
    },
  );

  it('contains raw exceptions and removes its signal handlers after failure', async () => {
    const item = fixture(),
      output = streams();
    vi.spyOn(reference, 'runLinuxOwnCpuReference').mockRejectedValue(
      Error(`private-failure:${item.out}`),
    );
    expect(await main(args(item.out))).toBe(6);
    expect(output.text(output.stdout)).toBe('');
    expect(output.text(output.stderr)).toBe('linux-own-cpu-qualify: partial-bundle\n');
    expect(signals.map((signal) => process.listeners(signal))).toEqual(listeners);
    expect(fs.existsSync(item.out)).toBe(false);
  });

  it.each(signals)(
    'propagates its own %s handler through a genuine signal and cleans both handlers',
    async (signal) => {
      const item = fixture();
      streams();
      let observed;
      vi.spyOn(reference, 'runLinuxOwnCpuReference').mockImplementation(async (options) => {
        observed = options.signal;
        const own = process
          .listeners(signal)
          .filter((listener) => !listeners[signals.indexOf(signal)].includes(listener));
        expect(own).toHaveLength(1);
        expect(observed.aborted).toBe(false);
        own[0]();
        expect(observed.aborted).toBe(true);
        return { exitCode: 3, receipt: null };
      });
      expect(await main(args(item.out))).toBe(3);
      expect(observed).toBeInstanceOf(AbortSignal);
      expect(signals.map((name) => process.listeners(name))).toEqual(listeners);
      expect(fs.existsSync(item.out)).toBe(false);
    },
  );

  it.each(['existing', 'linked-parent'])(
    'preserves %s output owners before sampler/workload execution',
    async (kind) => {
      const item = fixture(),
        target = path.join(item.base, 'owner');
      fs.mkdirSync(target);
      fs.writeFileSync(path.join(target, 'sentinel'), 'private-owner-content');
      let out = target;
      if (kind === 'linked-parent') {
        const link = path.join(item.base, 'linked');
        fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
        links.push(link);
        out = path.join(link, 'new-output');
      }
      const output = streams(),
        processes = forbidProcesses();
      const acquire = vi.spyOn(sampler, 'sampleSelfResources').mockImplementation(() => {
        throw Error('fixture-acquisition-forbidden');
      });
      vi.spyOn(reference, 'runLinuxOwnCpuReference').mockImplementation((options) =>
        actualRun(options, {
          platform: () => 'linux',
          getconf: () => Buffer.from('100\n'),
        }),
      );
      expect(await main(args(out))).toBe(5);
      expect(acquire).not.toHaveBeenCalled();
      expect(fs.readdirSync(target)).toEqual(['sentinel']);
      expect(fs.readFileSync(path.join(target, 'sentinel'), 'utf8')).toBe('private-owner-content');
      expect(output.text(output.stdout)).toBe('');
      expect(output.text(output.stderr)).toBe('linux-own-cpu-qualify: output-refused\n');
      for (const operation of processes) expect(operation).not.toHaveBeenCalled();
    },
  );

  it('reports an injected unsupported platform without preflight, acquisition or output creation', async () => {
    const item = fixture(),
      output = streams(),
      processes = forbidProcesses();
    const acquire = vi.spyOn(sampler, 'sampleSelfResources');
    vi.spyOn(reference, 'runLinuxOwnCpuReference').mockImplementation((options) =>
      actualRun(options, { platform: () => 'win32' }),
    );
    expect(await main(args(item.out))).toBe(7);
    expect(acquire).not.toHaveBeenCalled();
    expect(output.text(output.stdout)).toBe('');
    expect(output.text(output.stderr)).toBe('linux-own-cpu-qualify: unsupported-or-unavailable\n');
    for (const operation of processes) expect(operation).not.toHaveBeenCalled();
    expect(fs.readdirSync(item.base)).toEqual([]);
  });
});
