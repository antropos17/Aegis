import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const session = require('../../../bench/lib/self-resource-session');
const sampler = require('../../../bench/lib/self-resource-sampler');
const storage = require('../../../bench/lib/own-resource-storage');
const cliFile = require.resolve('../../../bench/self-resource-run.cjs');
const repository = path.resolve(path.dirname(cliFile), '..');
const files = [
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'self-resource-cli-'));
  directories.push(dir);
  return dir;
}
function argumentsFor(out) {
  return [
    '--run-id',
    'cli-owned',
    '--duration-ms',
    '1000',
    '--max-acquisition-us',
    '10000',
    '--max-cpu-uncertainty-us',
    '20000',
    '--out',
    out,
  ];
}
function streams() {
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  return { stdout, stderr, text: (spy) => spy.mock.calls.map(([chunk]) => String(chunk)).join('') };
}
function stringsIn(value) {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(stringsIn);
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const link of links.splice(0)) fs.unlinkSync(link);
  for (const dir of directories.splice(0)) {
    expect(path.dirname(dir)).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(dir)).toMatch(/^self-resource-cli-/);
    expect(fs.lstatSync(dir).isSymbolicLink()).toBe(false);
    fs.rmSync(dir, { recursive: true });
  }
});

describe('explicit own-Node resource CLI', () => {
  it('imports and prints help without acquiring resources or creating output', async () => {
    const parent = directory(),
      run = vi.spyOn(session, 'runSelfResourceSession');
    const output = streams(),
      previous = require.cache[cliFile];
    try {
      delete require.cache[cliFile];
      const cli = require(cliFile);
      expect(output.text(output.stdout)).toBe('');
      expect(output.text(output.stderr)).toBe('');
      expect(await cli.main(['--help'])).toBe(0);
      expect(output.text(output.stdout)).toContain('Only this Node process is sampled');
      expect(output.text(output.stderr)).toBe('');
      expect(run).not.toHaveBeenCalled();
      expect(fs.readdirSync(parent)).toEqual([]);
    } finally {
      if (previous) require.cache[cliFile] = previous;
      else delete require.cache[cliFile];
    }
  });

  it('rejects missing, duplicate, unknown, noncanonical and arbitrary-target options before acquisition', async () => {
    const out = path.join(directory(), 'new-output'),
      valid = argumentsFor(out);
    const run = vi.spyOn(session, 'runSelfResourceSession'),
      output = streams();
    const replace = (flag, value) => valid.map((part, i) => (valid[i - 1] === flag ? value : part));
    const invalid = [
      [],
      [...valid, '--run-id', 'duplicate'],
      replace('--duration-ms', '01000'),
      replace('--duration-ms', '999'),
      replace('--run-id', '../private'),
    ];
    for (const flag of ['--unknown', '--pid', '--command', '--profile'])
      invalid.push([...valid.slice(0, -2), flag, 'private-value']);
    for (const argv of invalid) expect(await main(argv)).toBe(2);
    expect(run).not.toHaveBeenCalled();
    expect(fs.existsSync(out)).toBe(false);
    expect(output.text(output.stdout)).toBe('');
    expect(output.text(output.stderr)).toBe(
      'self-resource-run: input-invalid\n'.repeat(invalid.length),
    );
  });

  it.each([
    [0, null],
    [2, 'input-invalid'],
    [3, 'acquisition-or-derivation-incomplete'],
    [4, 'source-unavailable-or-changed'],
    [5, 'output-refused'],
    [6, 'partial-bundle'],
  ])(
    'translates session result %i into its fixed public exit and diagnostic',
    async (code, reason) => {
      const out = path.join(directory(), 'unused-output'),
        output = streams();
      const run = vi
        .spyOn(session, 'runSelfResourceSession')
        .mockResolvedValue({ exitCode: code, receipt: null });
      const before = ['SIGINT', 'SIGTERM'].map((signal) => process.listenerCount(signal));
      expect(await main(argumentsFor(out))).toBe(code);
      expect(run).toHaveBeenCalledOnce();
      expect(run.mock.calls[0][0]).toMatchObject({
        runId: 'cli-owned',
        durationMs: 1000,
        maxAcquisitionUs: 10000,
        maxCpuUncertaintyUs: 20000,
        out,
      });
      expect(run.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
      expect(['SIGINT', 'SIGTERM'].map((signal) => process.listenerCount(signal))).toEqual(before);
      expect(output.text(output.stdout)).toBe(code === 0 ? 'self-resource-run: complete\n' : '');
      expect(output.text(output.stderr)).toBe(code === 0 ? '' : `self-resource-run: ${reason}\n`);
      expect(fs.existsSync(out)).toBe(false);
    },
  );

  it('contains unexpected session errors without exposing private output paths or exception text', async () => {
    const out = path.join(directory(), 'private-output'),
      output = streams();
    vi.spyOn(session, 'runSelfResourceSession').mockRejectedValue(
      new Error(`private-error:${out}`),
    );
    const before = ['SIGINT', 'SIGTERM'].map((signal) => process.listenerCount(signal));
    expect(await main(argumentsFor(out))).toBe(6);
    expect(output.text(output.stdout)).toBe('');
    expect(output.text(output.stderr)).toBe('self-resource-run: partial-bundle\n');
    expect(['SIGINT', 'SIGTERM'].map((signal) => process.listenerCount(signal))).toEqual(before);
  });

  it('refuses an existing directory while preserving its owner and avoiding acquisition', async () => {
    const out = path.join(directory(), 'existing');
    fs.mkdirSync(out);
    fs.writeFileSync(path.join(out, 'sentinel'), 'preserved');
    const acquire = vi.spyOn(sampler, 'sampleSelfResources'),
      output = streams();
    expect(await main(argumentsFor(out))).toBe(5);
    expect(acquire).not.toHaveBeenCalled();
    expect(fs.readdirSync(out)).toEqual(['sentinel']);
    expect(fs.readFileSync(path.join(out, 'sentinel'), 'utf8')).toBe('preserved');
    expect(output.text(output.stderr)).toBe('self-resource-run: output-refused\n');
  });

  it('refuses a linked output parent without creating a child in the target', async () => {
    const parent = directory(),
      target = path.join(parent, 'target'),
      link = path.join(parent, 'linked');
    fs.mkdirSync(target);
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    links.push(link);
    const acquire = vi.spyOn(sampler, 'sampleSelfResources'),
      output = streams();
    expect(await main(argumentsFor(path.join(link, 'new-output')))).toBe(5);
    expect(acquire).not.toHaveBeenCalled();
    expect(fs.readdirSync(target)).toEqual([]);
    expect(output.text(output.stderr)).toBe('self-resource-run: output-refused\n');
  });

  it('retains the pre-acquisition binding and an honest failure receipt when acquisition throws', async () => {
    const out = path.join(directory(), 'failed-capture'),
      output = streams();
    let observed;
    vi.spyOn(sampler, 'sampleSelfResources').mockImplementation(async () => {
      const bytes = fs.readFileSync(path.join(out, 'session-plan.json'));
      const pending = JSON.parse(fs.readFileSync(path.join(out, 'session-pending.json'), 'utf8'));
      observed = { files: fs.readdirSync(out).sort(), bytes, pending };
      throw new Error('private-acquisition-error');
    });
    expect(await main(argumentsFor(out))).toBe(3);
    expect(observed.files).toEqual(['session-pending.json', 'session-plan.json']);
    expect(observed.pending).toMatchObject({
      state: 'pending',
      planSha256: digest(observed.bytes),
    });
    const final = JSON.parse(fs.readFileSync(path.join(out, 'session-final.json'), 'utf8'));
    expect(final).toMatchObject({
      state: 'incomplete',
      priorArtifactState: 'partial',
      rawSha256: null,
      acquisition: { state: 'failed', complete: null, reason: 'acquisition-unavailable' },
      derivation: { state: 'not-started' },
      sources: { state: 'unchanged' },
    });
    expect(fs.existsSync(path.join(out, 'raw-samples.json'))).toBe(false);
    expect(fs.existsSync(path.join(out, 'bracketed-intervals.json'))).toBe(false);
    expect(output.text(output.stderr)).toBe(
      'self-resource-run: acquisition-or-derivation-incomplete\n',
    );
    expect(JSON.stringify(final)).not.toContain('private-acquisition-error');
  });

  it('gives changed source evidence precedence over acquisition failure without rewriting source files', async () => {
    const out = path.join(directory(), 'source-changed'),
      output = streams();
    const before = storage.inventory(),
      after = structuredClone(before);
    after.files[0].sha256 =
      before.files[0].sha256 === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64);
    vi.spyOn(storage, 'inventory').mockReturnValueOnce(before).mockReturnValueOnce(after);
    vi.spyOn(sampler, 'sampleSelfResources').mockRejectedValue(
      new Error('private-acquisition-error'),
    );
    expect(await main(argumentsFor(out))).toBe(4);
    const final = JSON.parse(fs.readFileSync(path.join(out, 'session-final.json'), 'utf8'));
    expect(final).toMatchObject({
      state: 'source-refused',
      acquisition: { state: 'failed' },
      sources: { state: 'changed', after },
      sourceAuthenticated: false,
      measurementAccepted: false,
      w8Accepted: false,
    });
    expect(final.rawSha256).toBeNull();
    expect(output.text(output.stdout)).toBe('');
    expect(output.text(output.stderr)).toBe('self-resource-run: source-unavailable-or-changed\n');
  });

  it('retains one bounded real CLI capture with independently checked byte bindings and explicit unknowns', () => {
    const parent = directory(),
      out = path.join(parent, 'real-capture');
    const child = spawnSync(process.execPath, [cliFile, ...argumentsFor(out)], {
      cwd: repository,
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: 32768,
      windowsHide: true,
      env: {
        ...process.env,
        TEMP: parent,
        TMP: parent,
        NODE_COMPILE_CACHE: path.join(parent, 'compile-cache'),
      },
    });
    expect(child.error).toBeUndefined();
    expect(child.signal).toBeNull();
    expect(fs.readdirSync(out).sort()).toEqual([...files].sort());
    const bytes = Object.fromEntries(
      files.map((file) => [file, fs.readFileSync(path.join(out, file))]),
    );
    const [plan, pending, raw, derived, final] = files.map((file) => JSON.parse(bytes[file]));
    expect(
      Object.values(bytes).reduce((total, value) => total + value.length, 0),
    ).toBeLessThanOrEqual(1048576);
    for (const file of files)
      expect(bytes[file].length).toBeLessThanOrEqual(plan.limits.files[file]);
    expect(plan).toMatchObject({
      activity: 'owned-node-waiting-no-workload',
      plan: {
        durationUs: 1000000,
        phases: [{ id: 'owned-idle', kind: 'idle', steady: true, startUs: 0, endUs: 1000000 }],
      },
    });
    expect(pending.planSha256).toBe(digest(bytes['session-plan.json']));
    expect(pending.roster).toEqual(files);
    expect(final.planSha256).toBe(pending.planSha256);
    expect(final.rawSha256).toBe(digest(bytes['raw-samples.json']));
    expect(derived.provenance.sourceSha256).toBe(pending.planSha256);
    expect(derived.raw).toEqual(raw);
    expect(derived.plan).toEqual(plan.plan);
    expect(final.files).toEqual(
      files.slice(0, 4).map((file) => ({
        file,
        sha256: digest(bytes[file]),
        byteLength: bytes[file].length,
        closed: true,
      })),
    );
    expect(final.finalPublication).toBe('not-self-attested');
    expect(final.sources).toEqual({ state: 'unchanged', after: plan.sources });
    expect(plan.sources.files.map((entry) => entry.file)).toEqual([
      'bench/self-resource-run.cjs',
      'bench/lib/self-resource-session.js',
      'bench/lib/own-resource-storage.js',
      'bench/lib/self-resource-sampler.js',
      'bench/lib/bracketed-resource-intervals.js',
    ]);
    for (const entry of plan.sources.files) {
      const source = fs.readFileSync(path.join(repository, entry.file));
      expect(entry).toEqual({
        file: entry.file,
        sha256: digest(source),
        byteLength: source.length,
      });
    }
    expect(raw).toMatchObject({
      readingMode: 'own-process',
      scope: 'calling-node-process',
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
    for (const value of [plan, pending, final])
      expect(value).toMatchObject({
        runId: 'cli-owned',
        scope: 'calling-node-process',
        sourceAuthenticated: false,
        measurementAccepted: false,
        w8Accepted: false,
      });
    const expectedCode =
      raw.complete && raw.pendingTimer === false && raw.cleanupReason === null ? 0 : 3;
    expect(child.status).toBe(expectedCode);
    expect(child.stdout).toBe(expectedCode === 0 ? 'self-resource-run: complete\n' : '');
    expect(child.stderr).toBe(
      expectedCode === 0 ? '' : 'self-resource-run: acquisition-or-derivation-incomplete\n',
    );
    const publishedStrings = [plan, pending, raw, derived, final].flatMap(stringsIn);
    for (const value of publishedStrings) {
      expect(path.posix.isAbsolute(value)).toBe(false);
      expect(path.win32.isAbsolute(value)).toBe(false);
    }
    const published = publishedStrings.join('\n') + child.stdout + child.stderr;
    for (const privatePath of [parent, out, repository, os.homedir()])
      expect(published).not.toContain(privatePath);
    const jsonText = Object.values(bytes).map(String).join('\n');
    for (const field of ['pid', 'hostname', 'argv', 'cwd', 'env'])
      expect(jsonText).not.toContain(`"${field}":`);
  }, 20000);
});
