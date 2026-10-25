import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const replay = require('../../../bench/lib/linux-cpu-replay');
const childProcess = require('node:child_process');
const cliFile = require.resolve('../../../bench/linux-cpu-replay.cjs');
const main = (argv) => require(cliFile).main(argv);
const directories = [],
  links = [];
function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-cpu-replay-cli-'));
  directories.push(base);
  const input = path.join(base, 'private-input');
  fs.mkdirSync(input);
  return { base, input, out: path.join(base, 'private-output') };
}
const args = (item) => ['--input', item.input, '--out', item.out];
function streams() {
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  return { stdout, stderr, text: (spy) => spy.mock.calls.map(([chunk]) => String(chunk)).join('') };
}
function forbidProcesses() {
  return ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync'].map((key) =>
    vi.spyOn(childProcess, key).mockImplementation(() => {
      throw Error('offline-process-forbidden');
    }),
  );
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const link of links.splice(0)) fs.unlinkSync(link);
  for (const dir of directories.splice(0)) {
    expect(path.dirname(path.resolve(dir))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(dir)).toMatch(/^linux-cpu-replay-cli-/);
    expect(fs.lstatSync(dir).isSymbolicLink()).toBe(false);
    fs.rmSync(dir, { recursive: true });
  }
});

describe('offline Linux CPU replay CLI (CI only)', () => {
  it('imports and prints help without inspecting artifacts, publishing output or executing code', async () => {
    const item = fixture(),
      output = streams(),
      previous = require.cache[cliFile];
    const run = vi.spyOn(replay, 'replayLinuxCpu').mockReturnValue({ exitCode: 6, report: null });
    const processes = forbidProcesses(),
      open = vi.spyOn(fs, 'openSync'),
      mkdir = vi.spyOn(fs, 'mkdirSync');
    try {
      delete require.cache[cliFile];
      const cli = require(cliFile);
      expect(output.text(output.stdout)).toBe('');
      expect(output.text(output.stderr)).toBe('');
      expect(await cli.main(['--help'])).toBe(0);
      expect(output.text(output.stdout)).toContain('--input');
      expect(output.text(output.stdout)).toContain('--out');
      expect(output.text(output.stderr)).toBe('');
      expect(run).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
      expect(mkdir).not.toHaveBeenCalled();
      for (const operation of processes) expect(operation).not.toHaveBeenCalled();
      expect(fs.existsSync(item.out)).toBe(false);
    } finally {
      if (previous) require.cache[cliFile] = previous;
      else delete require.cache[cliFile];
    }
  });

  it('rejects missing, duplicate and caller-selected execution options before any input IO', async () => {
    const item = fixture(),
      output = streams();
    const run = vi.spyOn(replay, 'replayLinuxCpu').mockReturnValue({ exitCode: 6, report: null });
    const processes = forbidProcesses(),
      open = vi.spyOn(fs, 'openSync');
    const invalid = [
      null,
      [],
      ['--input', item.input],
      ['--out', item.out],
      ['--input', item.input, '--input', item.input],
      ['--out', item.out, '--out', item.out],
      ['--input', '', '--out', item.out],
      [...args(item), '--help'],
    ];
    for (const key of [
      '--pid',
      '--command',
      '--script',
      '--source',
      '--model',
      '--getconf',
      '--ticks-per-second',
      '--duration-ms',
      '--unknown',
    ])
      invalid.push(['--input', item.input, key, 'private-caller-value']);
    for (const argv of invalid) expect(await main(argv)).toBe(2);
    expect(run).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    for (const operation of processes) expect(operation).not.toHaveBeenCalled();
    expect(output.text(output.stdout)).toBe('');
    expect(output.stderr).toHaveBeenCalledTimes(invalid.length);
    expect(output.text(output.stderr)).toBe(
      'linux-cpu-replay: input-invalid\n'.repeat(invalid.length),
    );
    expect(fs.readdirSync(item.input)).toEqual([]);
    expect(fs.existsSync(item.out)).toBe(false);
  });

  it.each([
    [0, 0, null],
    [2, 2, 'input-invalid'],
    [3, 3, 'incomplete-or-recorded-nonpass'],
    [4, 4, 'bundle-refused'],
    [5, 5, 'output-refused'],
    [6, 6, 'publication-failed'],
    [7, 7, 'replay-unavailable'],
    [99, 6, 'publication-failed'],
  ])(
    'maps dynamic result %i to code %i without printing private report data',
    async (code, expected, reason) => {
      const item = fixture(),
        output = streams(),
        processes = forbidProcesses();
      const run = vi.spyOn(replay, 'replayLinuxCpu').mockReturnValue({
        exitCode: code,
        report: {
          input: item.input,
          out: item.out,
          error: 'private-raw-exception',
          env: 'private-environment-sentinel',
        },
      });
      expect(await main(args(item))).toBe(expected);
      expect(run).toHaveBeenCalledOnce();
      expect(run).toHaveBeenCalledWith({ input: item.input, out: item.out });
      expect(output.text(output.stdout)).toBe('');
      expect(output.text(output.stderr)).toBe(
        expected === 0 ? '' : `linux-cpu-replay: ${reason}\n`,
      );
      for (const operation of processes) expect(operation).not.toHaveBeenCalled();
      expect(fs.existsSync(item.out)).toBe(false);
    },
  );

  it('contains unexpected exceptions without exposing their paths, environment or raw text', async () => {
    const item = fixture(),
      output = streams(),
      processes = forbidProcesses();
    vi.spyOn(replay, 'replayLinuxCpu').mockImplementation(() => {
      throw Error(`private-environment-sentinel:${item.input}`);
    });
    expect(await main(args(item))).toBe(6);
    expect(output.text(output.stdout)).toBe('');
    expect(output.stderr).toHaveBeenCalledOnce();
    expect(output.text(output.stderr)).toBe('linux-cpu-replay: publication-failed\n');
    for (const operation of processes) expect(operation).not.toHaveBeenCalled();
    expect(fs.existsSync(item.out)).toBe(false);
  });

  it.each(['existing', 'linked-parent'])(
    'refuses %s output while preserving its owner',
    async (kind) => {
      const item = fixture(),
        target = path.join(item.base, 'owner');
      fs.mkdirSync(target);
      fs.writeFileSync(path.join(target, 'sentinel'), 'private-owner-sentinel');
      item.out = target;
      if (kind === 'linked-parent') {
        const link = path.join(item.base, 'linked');
        fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
        links.push(link);
        item.out = path.join(link, 'new-output');
      }
      const output = streams(),
        processes = forbidProcesses();
      expect(await main(args(item))).toBe(5);
      expect(output.text(output.stdout)).toBe('');
      expect(output.text(output.stderr)).toBe('linux-cpu-replay: output-refused\n');
      expect(fs.readdirSync(target)).toEqual(['sentinel']);
      expect(fs.readFileSync(path.join(target, 'sentinel'), 'utf8')).toBe('private-owner-sentinel');
      expect(fs.readdirSync(item.input)).toEqual([]);
      for (const operation of processes) expect(operation).not.toHaveBeenCalled();
    },
  );

  it('refuses equal and overlapping input/output before inspecting input', async () => {
    const item = fixture(),
      output = streams(),
      processes = forbidProcesses(),
      open = vi.spyOn(fs, 'openSync');
    for (const out of [item.input, path.join(item.input, 'nested'), item.base])
      expect(await main(args({ ...item, out }))).toBe(2);
    expect(open).not.toHaveBeenCalled();
    expect(output.text(output.stdout)).toBe('');
    expect(output.text(output.stderr)).toBe('linux-cpu-replay: input-invalid\n'.repeat(3));
    expect(fs.readdirSync(item.input)).toEqual([]);
    for (const operation of processes) expect(operation).not.toHaveBeenCalled();
  });
});
