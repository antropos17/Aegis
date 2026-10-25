import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const supervisor = require('../../../bench/lib/resource-supervisor');
const childProcess = require('node:child_process');
const cliFile = require.resolve('../../../bench/self-resource-supervise.cjs');
const repository = path.resolve(path.dirname(cliFile), '..');
const parentFiles = ['supervision-plan.json', 'supervision-pending.json', 'supervision-final.json'];
const childFiles = [
  'session-plan.json',
  'session-pending.json',
  'raw-samples.json',
  'bracketed-intervals.json',
  'session-final.json',
];
const directories = [],
  links = [];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const main = (argv) => require(cliFile).main(argv);
function directory() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resource-supervisor-cli-'));
  directories.push(dir);
  return dir;
}
function argumentsFor(out) {
  return Object.entries({
    '--run-id': 'supervised-cli',
    '--duration-ms': '1000',
    '--max-acquisition-us': '10000',
    '--max-cpu-uncertainty-us': '20000',
    '--wall-limit-ms': '10000',
    '--confirm-ms': '1000',
    '--out': out,
  }).flat();
}
function streams() {
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  return { stdout, stderr, text: (spy) => spy.mock.calls.map(([chunk]) => String(chunk)).join('') };
}
function stringsIn(value) {
  if (typeof value === 'string') return [value];
  return value && typeof value === 'object' ? Object.values(value).flatMap(stringsIn) : [];
}
function bundle(dir, files) {
  const bytes = Object.fromEntries(
    files.map((file) => [file, fs.readFileSync(path.join(dir, file))]),
  );
  return { bytes, values: files.map((file) => JSON.parse(bytes[file])) };
}
function record(file, bytes) {
  return { file, sha256: digest(bytes), byteLength: bytes.length, closed: true };
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const link of links.splice(0)) fs.unlinkSync(link);
  for (const dir of directories.splice(0)) {
    expect(path.dirname(dir)).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(dir)).toMatch(/^resource-supervisor-cli-/);
    expect(fs.lstatSync(dir).isSymbolicLink()).toBe(false);
    fs.rmSync(dir, { recursive: true });
  }
});

describe('fixed-child resource supervisor CLI', () => {
  it('imports and prints help without invoking supervision, spawning or creating output', async () => {
    const parent = directory(),
      output = streams(),
      previous = require.cache[cliFile];
    const run = vi.spyOn(supervisor, 'superviseSelfResources').mockResolvedValue({ exitCode: 6 });
    const spawn = vi.spyOn(childProcess, 'spawn');
    try {
      delete require.cache[cliFile];
      const cli = require(cliFile);
      expect(output.text(output.stdout)).toBe('');
      expect(output.text(output.stderr)).toBe('');
      expect(await cli.main(['--help'])).toBe(0);
      expect(output.text(output.stdout)).toContain(
        'Supervises only the fixed own-Node resource CLI',
      );
      expect(output.text(output.stderr)).toBe('');
      expect(run).not.toHaveBeenCalled();
      expect(spawn).not.toHaveBeenCalled();
      expect(fs.readdirSync(parent)).toEqual([]);
    } finally {
      if (previous) require.cache[cliFile] = previous;
      else delete require.cache[cliFile];
    }
  });

  it('refuses incomplete, duplicate, noncanonical, out-of-range and arbitrary-target flags before supervision', async () => {
    const parent = directory(),
      out = path.join(parent, 'new-output'),
      valid = argumentsFor(out);
    const replace = (flag, value) =>
      valid.map((part, index) => (valid[index - 1] === flag ? value : part));
    const duplicate = [...valid];
    duplicate[duplicate.indexOf('--confirm-ms')] = '--wall-limit-ms';
    const invalid = [
      [],
      valid.slice(0, -2),
      duplicate,
      [...valid, '--help'],
      replace('--run-id', '../private'),
      replace('--duration-ms', '999'),
      replace('--wall-limit-ms', '01000'),
      replace('--wall-limit-ms', '120001'),
      replace('--confirm-ms', '0'),
      replace('--confirm-ms', '10001'),
    ];
    for (const flag of [
      '--unknown',
      '--script',
      '--command',
      '--pid',
      '--executable',
      '--profile',
      '--env',
    ]) {
      const argv = [...valid];
      argv[argv.indexOf('--run-id')] = flag;
      invalid.push(argv);
    }
    const output = streams();
    const run = vi.spyOn(supervisor, 'superviseSelfResources').mockResolvedValue({ exitCode: 6 });
    const spawn = vi.spyOn(childProcess, 'spawn');
    for (const argv of invalid) expect(await main(argv)).toBe(2);
    expect(run).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(fs.readdirSync(parent)).toEqual([]);
    expect(output.text(output.stdout)).toBe('');
    expect(output.text(output.stderr)).toBe(
      'self-resource-supervise: input-invalid\n'.repeat(invalid.length),
    );
  });

  it.each([
    [0, null],
    [2, 'input-invalid'],
    [3, 'supervision-failed'],
    [4, 'source-unavailable-or-changed'],
    [5, 'output-refused'],
    [6, 'partial-parent-bundle'],
  ])(
    'maps supervisor result %i and removes its temporary signal listeners',
    async (code, reason) => {
      const out = path.join(directory(), 'unused-output'),
        output = streams();
      const run = vi
        .spyOn(supervisor, 'superviseSelfResources')
        .mockResolvedValue({ exitCode: code, receipt: null });
      const before = ['SIGINT', 'SIGTERM'].map((name) => process.listenerCount(name));
      expect(await main(argumentsFor(out))).toBe(code);
      expect(run).toHaveBeenCalledOnce();
      expect(run.mock.calls[0][0]).toMatchObject({
        runId: 'supervised-cli',
        durationMs: 1000,
        maxAcquisitionUs: 10000,
        maxCpuUncertaintyUs: 20000,
        wallLimitMs: 10000,
        confirmMs: 1000,
        out,
      });
      expect(run.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
      expect(['SIGINT', 'SIGTERM'].map((name) => process.listenerCount(name))).toEqual(before);
      expect(output.text(output.stdout)).toBe(
        code === 0 ? 'self-resource-supervise: complete\n' : '',
      );
      expect(output.text(output.stderr)).toBe(
        code === 0 ? '' : `self-resource-supervise: ${reason}\n`,
      );
      expect(fs.existsSync(out)).toBe(false);
    },
  );

  it.each(['SIGINT', 'SIGTERM'])(
    'forwards the owned %s handler through AbortSignal and cleans up after settling',
    async (name) => {
      const out = path.join(directory(), 'cancelled-output'),
        output = streams();
      const names = ['SIGINT', 'SIGTERM'];
      const before = names.map((signal) => process.rawListeners(signal));
      let forwarded, settle;
      const run = vi.spyOn(supervisor, 'superviseSelfResources').mockImplementation((options) => {
        forwarded = options.signal;
        return new Promise((resolve) => {
          settle = resolve;
        });
      });
      const pending = main(argumentsFor(out));
      try {
        expect(run).toHaveBeenCalledOnce();
        expect(forwarded).toBeInstanceOf(AbortSignal);
        expect(forwarded.aborted).toBe(false);
        const existing = before[names.indexOf(name)];
        const owned = process.rawListeners(name).filter((handler) => !existing.includes(handler));
        expect(owned).toHaveLength(1);
        owned[0]();
        expect(forwarded.aborted).toBe(true);
        settle({ exitCode: 3, receipt: null });
        expect(await pending).toBe(3);
        expect(names.map((signal) => process.rawListeners(signal))).toEqual(before);
        expect(output.text(output.stdout)).toBe('');
        expect(output.text(output.stderr)).toBe('self-resource-supervise: supervision-failed\n');
        expect(fs.existsSync(out)).toBe(false);
      } finally {
        settle?.({ exitCode: 3, receipt: null });
        await pending;
      }
    },
  );

  it('contains private supervisor exceptions and restores listeners on rejection', async () => {
    const out = path.join(directory(), 'private-output'),
      output = streams();
    vi.spyOn(supervisor, 'superviseSelfResources').mockRejectedValue(
      new Error(`private-error:${out}`),
    );
    const before = ['SIGINT', 'SIGTERM'].map((name) => process.listenerCount(name));
    expect(await main(argumentsFor(out))).toBe(6);
    expect(output.text(output.stdout)).toBe('');
    expect(output.text(output.stderr)).toBe('self-resource-supervise: partial-parent-bundle\n');
    expect(['SIGINT', 'SIGTERM'].map((name) => process.listenerCount(name))).toEqual(before);
    expect(fs.existsSync(out)).toBe(false);
  });

  it.each(['existing', 'linked-parent'])(
    'refuses %s output before any child spawn and preserves its owner',
    async (kind) => {
      const parent = directory(),
        target = path.join(parent, 'owned');
      fs.mkdirSync(target);
      fs.writeFileSync(path.join(target, 'sentinel'), 'preserved');
      let out = target;
      if (kind === 'linked-parent') {
        const link = path.join(parent, 'linked');
        fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
        links.push(link);
        out = path.join(link, 'new-output');
      }
      const output = streams();
      const spawn = vi.spyOn(childProcess, 'spawn').mockImplementation(() => {
        throw Error('must-not-spawn');
      });
      expect(await main(argumentsFor(out))).toBe(5);
      expect(spawn).not.toHaveBeenCalled();
      expect(fs.readdirSync(target)).toEqual(['sentinel']);
      expect(fs.readFileSync(path.join(target, 'sentinel'), 'utf8')).toBe('preserved');
      expect(output.text(output.stdout)).toBe('');
      expect(output.text(output.stderr)).toBe('self-resource-supervise: output-refused\n');
    },
  );

  it('runs the actual fixed child and retains separate parent and unadmitted child evidence', () => {
    const parent = directory(),
      out = path.join(parent, 'supervised'),
      capture = path.join(out, 'capture');
    const result = childProcess.spawnSync(process.execPath, [cliFile, ...argumentsFor(out)], {
      cwd: repository,
      encoding: 'utf8',
      timeout: 20000,
      maxBuffer: 32768,
      windowsHide: true,
      env: { ...process.env, TEMP: parent, TMP: parent, NODE_DISABLE_COMPILE_CACHE: '1' },
    });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(fs.readdirSync(out).sort()).toEqual([...parentFiles, 'capture', 'temporary'].sort());
    expect(fs.readdirSync(capture).sort()).toEqual([...childFiles].sort());
    const outer = bundle(out, parentFiles),
      child = bundle(capture, childFiles);
    const [plan, pending, final] = outer.values;
    const [childPlan, childPending, raw, derived, childFinal] = child.values;
    expect(plan).toMatchObject({
      version: 'resource-supervision-plan/1',
      scope: 'owned-node-child',
      executionMode: 'real-child',
      child: {
        entry: 'bench/self-resource-run.cjs',
        output: 'capture',
        durationMs: 1000,
        maxAcquisitionUs: 10000,
        maxCpuUncertaintyUs: 20000,
      },
      wallLimitMs: 10000,
      confirmMs: 1000,
      environment: 'minimal-os-and-owned-temporary-no-inherited-node-options',
    });
    expect(pending).toMatchObject({
      state: 'pending',
      planSha256: digest(outer.bytes[parentFiles[0]]),
    });
    expect(final).toMatchObject({
      version: 'resource-supervision-final/1',
      scope: 'owned-node-child',
      executionMode: 'real-child',
      planSha256: pending.planSha256,
      childBundleAssessment: 'not-inspected',
      finalPublication: 'not-self-attested',
      sources: { state: 'unchanged', after: plan.sources },
    });
    expect(final.files).toEqual(
      parentFiles.slice(0, 2).map((file) => record(file, outer.bytes[file])),
    );
    expect(
      Object.values(outer.bytes).reduce((total, bytes) => total + bytes.length, 0),
    ).toBeLessThanOrEqual(65536);
    for (const file of parentFiles)
      expect(outer.bytes[file].length).toBeLessThanOrEqual(plan.limits.files[file]);
    expect(plan.sources.files).toHaveLength(10);
    expect(plan.sources.files.map((entry) => entry.file)).toEqual(
      expect.arrayContaining([
        'bench/self-resource-supervise.cjs',
        'bench/lib/resource-supervisor.js',
        'bench/self-resource-run.cjs',
      ]),
    );
    for (const inventory of [plan.sources, childPlan.sources])
      for (const entry of inventory.files) {
        const bytes = fs.readFileSync(path.join(repository, entry.file));
        expect(entry).toEqual({
          file: entry.file,
          sha256: digest(bytes),
          byteLength: bytes.length,
        });
      }
    expect(childPending.planSha256).toBe(digest(child.bytes['session-plan.json']));
    expect(childFinal.planSha256).toBe(childPending.planSha256);
    expect(childFinal.rawSha256).toBe(digest(child.bytes['raw-samples.json']));
    expect(childFinal.sources).toEqual({ state: 'unchanged', after: childPlan.sources });
    expect(childFinal.files).toEqual(
      childFiles.slice(0, 4).map((file) => record(file, child.bytes[file])),
    );
    expect(derived.provenance.sourceSha256).toBe(childPending.planSha256);
    expect(derived.raw).toEqual(raw);
    expect(derived.plan).toEqual(childPlan.plan);
    expect(raw).toMatchObject({
      scope: 'calling-node-process',
      readingMode: 'own-process',
      plannedPoints: 1,
      identity: { osBirthTime: null, reason: 'not-observed' },
      population: { complete: null, reason: 'not-collected' },
    });
    expect(raw.samples.length).toBeLessThanOrEqual(1);
    expect(derived.intervals).toEqual([]);
    expect(derived.boundaries).toMatchObject({
      plannedEndUs: 1000000,
      closingScheduledPoint: false,
      reason: 'end-exclusive-schedule',
    });
    expect(derived.schedule.map((point) => point.scheduledUs)).toEqual([0]);
    const childCode =
      raw.complete && raw.pendingTimer === false && raw.cleanupReason === null ? 0 : 3;
    expect(final.supervision).toMatchObject({
      cause: null,
      spawnObserved: true,
      errorObserved: false,
      exit: { observed: true, code: childCode, signal: null },
      close: { observed: true, code: childCode, signal: null },
      kill: { attempted: false, returned: null, reason: null },
      confirmation: 'exit-and-close-observed',
    });
    const childOutput =
      childCode === 0
        ? ['self-resource-run: complete\n', '']
        : ['', 'self-resource-run: acquisition-or-derivation-incomplete\n'];
    for (const [index, name] of ['stdout', 'stderr'].entries()) {
      const bytes = Buffer.from(childOutput[index]);
      expect(final.supervision[name]).toMatchObject({
        capBytes: 16384,
        observedBytes: bytes.length,
        observedBytesExact: true,
        hashBytes: bytes.length,
        sha256: digest(bytes),
        overflow: false,
        ended: true,
        closed: true,
        errorObserved: false,
        destroyRequested: false,
        complete: true,
      });
    }
    expect(result.status).toBe(childCode);
    expect(final.state).toBe(childCode === 0 ? 'completed-candidate' : 'failed');
    expect(result.stdout).toBe(childCode === 0 ? 'self-resource-supervise: complete\n' : '');
    expect(result.stderr).toBe(
      childCode === 0 ? '' : 'self-resource-supervise: supervision-failed\n',
    );
    for (const value of [plan, pending, final, childPlan, childPending, childFinal])
      expect(value).toMatchObject({
        runId: 'supervised-cli',
        sourceAuthenticated: false,
        measurementAccepted: false,
        w8Accepted: false,
      });
    const strings = [...outer.values, ...child.values].flatMap(stringsIn);
    for (const value of strings) {
      expect(path.posix.isAbsolute(value)).toBe(false);
      expect(path.win32.isAbsolute(value)).toBe(false);
    }
    const published = strings.join('\n') + result.stdout + result.stderr;
    for (const privatePath of [parent, out, capture, repository, os.homedir()])
      expect(published).not.toContain(privatePath);
    const parentText = outer.values.flatMap(stringsIn).join('\n');
    for (const text of childOutput.filter(Boolean)) expect(parentText).not.toContain(text.trim());
    for (const field of ['pid', 'hostname', 'argv', 'cwd', 'env', 'command', 'executable'])
      expect(Object.values(outer.bytes).map(String).join('\n')).not.toContain(`"${field}":`);
  }, 25000);
});
