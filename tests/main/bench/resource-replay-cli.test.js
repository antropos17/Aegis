import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const replay = require('../../../bench/lib/resource-replay');
const childProcess = require('node:child_process');
const cliFile = require.resolve('../../../bench/resource-session-replay.cjs');
const main = (argv) => require(cliFile).main(argv);
const directories = [],
  links = [];
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'resource-replay-cli-'));
  directories.push(base);
  const input = path.join(base, 'input'),
    sentinel = path.join(input, 'sentinel');
  fs.mkdirSync(input);
  fs.writeFileSync(sentinel, 'private-input-sentinel');
  return { base, input, sentinel, out: path.join(base, 'new-output') };
}
function streams() {
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  return { stdout, stderr, text: (spy) => spy.mock.calls.map(([value]) => String(value)).join('') };
}
function forbidProcesses() {
  return ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync'].map((name) =>
    vi.spyOn(childProcess, name).mockImplementation(() => {
      throw Error('offline-must-not-execute');
    }),
  );
}
const args = ({ input, out }) => ['--input', input, '--out', out];
afterEach(() => {
  vi.restoreAllMocks();
  for (const link of links.splice(0)) fs.unlinkSync(link);
  for (const dir of directories.splice(0)) {
    expect(path.dirname(dir)).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(dir)).toMatch(/^resource-replay-cli-/);
    expect(fs.lstatSync(dir).isSymbolicLink()).toBe(false);
    fs.rmSync(dir, { recursive: true });
  }
});

describe('offline resource replay CLI', () => {
  it('imports and prints help without inspecting input, creating output or starting processes', async () => {
    const item = fixture(),
      output = streams(),
      previous = require.cache[cliFile];
    const inspect = vi
      .spyOn(replay, 'inspectResourceReplay')
      .mockReturnValue({ exitCode: 6, report: null });
    const processes = forbidProcesses(),
      open = vi.spyOn(fs, 'openSync');
    try {
      delete require.cache[cliFile];
      const cli = require(cliFile);
      expect(output.text(output.stdout)).toBe('');
      expect(output.text(output.stderr)).toBe('');
      expect(await cli.main(['--help'])).toBe(0);
      expect(output.text(output.stdout)).toContain('--input');
      expect(output.text(output.stdout)).toContain('--out');
      expect(output.text(output.stderr)).toBe('');
      expect(inspect).not.toHaveBeenCalled();
      expect(
        open.mock.calls.some(
          ([file]) => typeof file === 'string' && file.startsWith(item.input + path.sep),
        ),
      ).toBe(false);
      for (const operation of processes) expect(operation).not.toHaveBeenCalled();
      expect(fs.existsSync(item.out)).toBe(false);
    } finally {
      if (previous) require.cache[cliFile] = previous;
      else delete require.cache[cliFile];
    }
  });

  it('rejects missing, duplicate, unknown and arbitrary-target options before input reads', async () => {
    const item = fixture(),
      output = streams();
    const inspect = vi
      .spyOn(replay, 'inspectResourceReplay')
      .mockReturnValue({ exitCode: 6, report: null });
    const processes = forbidProcesses(),
      open = vi.spyOn(fs, 'openSync');
    const invalid = [
      [],
      ['--input', item.input],
      ['--out', item.out],
      ['--input', item.input, '--input', item.input],
      [...args(item), '--help'],
    ];
    for (const option of [
      '--unknown',
      '--pid',
      '--command',
      '--script',
      '--executable',
      '--profile',
      '--duration-ms',
    ])
      invalid.push(['--input', item.input, option, item.out]);
    for (const argv of invalid) expect(await main(argv)).toBe(2);
    expect(inspect).not.toHaveBeenCalled();
    expect(
      open.mock.calls.some(
        ([file]) => typeof file === 'string' && file.startsWith(item.input + path.sep),
      ),
    ).toBe(false);
    for (const operation of processes) expect(operation).not.toHaveBeenCalled();
    expect(fs.existsSync(item.out)).toBe(false);
    expect(output.text(output.stdout)).toBe('');
    expect(output.text(output.stderr)).toBe(
      'resource-session-replay: input-invalid\n'.repeat(invalid.length),
    );
  });

  it.each([
    [0, null],
    [2, 'input-invalid'],
    [3, 'incomplete'],
    [4, 'bundle-refused'],
    [5, 'output-refused'],
    [6, 'partial-report'],
    [7, 'replay-unavailable'],
  ])(
    'maps inspection result %i to a fixed public diagnostic without printing the report',
    async (code, reason) => {
      const item = fixture(),
        output = streams(),
        processes = forbidProcesses();
      const inspect = vi.spyOn(replay, 'inspectResourceReplay').mockReturnValue({
        exitCode: code,
        report: { privateText: `private-report:${item.input}` },
      });
      expect(await main(args(item))).toBe(code);
      expect(inspect).toHaveBeenCalledOnce();
      expect(inspect).toHaveBeenCalledWith({ input: item.input, out: item.out });
      expect(output.text(output.stdout)).toBe(
        code === 0 ? 'resource-session-replay: consistent\n' : '',
      );
      expect(output.text(output.stderr)).toBe(
        code === 0 ? '' : `resource-session-replay: ${reason}\n`,
      );
      expect(fs.existsSync(item.out)).toBe(false);
      for (const operation of processes) expect(operation).not.toHaveBeenCalled();
    },
  );

  it('contains unexpected inspection exceptions without printing private paths or content', async () => {
    const item = fixture(),
      output = streams(),
      processes = forbidProcesses();
    vi.spyOn(replay, 'inspectResourceReplay').mockImplementation(() => {
      throw Error(`private-content:${item.input}`);
    });
    expect(await main(args(item))).toBe(6);
    expect(output.text(output.stdout)).toBe('');
    expect(output.text(output.stderr)).toBe('resource-session-replay: partial-report\n');
    expect(fs.existsSync(item.out)).toBe(false);
    for (const operation of processes) expect(operation).not.toHaveBeenCalled();
  });

  it.each(['existing', 'linked-parent'])(
    'refuses %s output and preserves input and output owners',
    async (kind) => {
      const item = fixture(),
        before = hash(item.sentinel),
        target = path.join(item.base, 'owned-output');
      fs.mkdirSync(target);
      fs.writeFileSync(path.join(target, 'sentinel'), 'preserved');
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
      expect(hash(item.sentinel)).toBe(before);
      expect(fs.readdirSync(item.input)).toEqual(['sentinel']);
      expect(fs.readdirSync(target)).toEqual(['sentinel']);
      expect(fs.readFileSync(path.join(target, 'sentinel'), 'utf8')).toBe('preserved');
      expect(output.text(output.stdout)).toBe('');
      expect(output.text(output.stderr)).toBe('resource-session-replay: output-refused\n');
      for (const operation of processes) expect(operation).not.toHaveBeenCalled();
    },
  );

  it('rejects identical and overlapping output in either direction without changing the input', async () => {
    const item = fixture(),
      before = hash(item.sentinel),
      output = streams(),
      processes = forbidProcesses();
    for (const out of [item.input, path.join(item.input, 'nested-report'), item.base])
      expect(await main(args({ ...item, out }))).toBe(2);
    expect(hash(item.sentinel)).toBe(before);
    expect(fs.readdirSync(item.input)).toEqual(['sentinel']);
    expect(fs.readdirSync(item.base)).toEqual(['input']);
    expect(output.text(output.stdout)).toBe('');
    expect(output.text(output.stderr)).toBe('resource-session-replay: input-invalid\n'.repeat(3));
    for (const operation of processes) expect(operation).not.toHaveBeenCalled();
  });
});
