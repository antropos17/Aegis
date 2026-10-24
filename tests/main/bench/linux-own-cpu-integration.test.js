import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const cli = require.resolve('../../../bench/linux-own-cpu-qualify.cjs');
const root = path.resolve(path.dirname(cli), '..');
const { evaluateCpuReference } = require('../../../bench/lib/linux-own-cpu-model');
const sources = [
  'bench/linux-own-cpu-qualify.cjs',
  'bench/lib/linux-own-cpu-reference.js',
  'bench/lib/linux-own-cpu-proc.js',
  'bench/lib/linux-own-cpu-work.js',
  'bench/lib/linux-own-cpu-model.js',
  'bench/lib/linux-own-cpu-capture.js',
  'bench/lib/linux-own-cpu-storage.js',
  'bench/lib/self-resource-sampler.js',
];
const roster = [
  'cpu-reference-plan.json',
  'cpu-reference-pending.json',
  'raw-samples.json',
  'cpu-reference-windows.json',
  'cpu-reference-final.json',
];
const caps = [16384, 4096, 16385, 32768, 16384];
const directories = [];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceRecords = () =>
  sources.map((file) => {
    const bytes = fs.readFileSync(path.join(root, file));
    return { file, sha256: digest(bytes), byteLength: bytes.length };
  });
const rational = (n, d) => ({ numerator: String(n), denominator: String(d) });
const ticks = (value) => BigInt(value.userTicks) + BigInt(value.systemTicks);
const api = (value) => BigInt(value.api.userUs) + BigInt(value.api.systemUs);
function jumpLcg(iterations) {
  const modulus = 1n << 32n;
  let n = BigInt(iterations),
    a = 1664525n,
    c = 1013904223n,
    scale = 1n,
    shift = 0n;
  while (n > 0n) {
    if (n & 1n) {
      shift = (a * shift + c) % modulus;
      scale = (a * scale) % modulus;
    }
    c = (a * c + c) % modulus;
    a = (a * a) % modulus;
    n >>= 1n;
  }
  return Number((scale + shift) % modulus);
}
function stringsIn(value) {
  if (typeof value === 'string') return [value];
  return value && typeof value === 'object' ? Object.values(value).flatMap(stringsIn) : [];
}
function keysIn(value) {
  return value && typeof value === 'object'
    ? [...Object.keys(value), ...Object.values(value).flatMap(keysIn)]
    : [];
}
afterEach(() => {
  for (const dir of directories.splice(0)) {
    expect(path.dirname(path.resolve(dir))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(dir)).toMatch(/^linux-own-cpu-integration-/);
    expect(fs.lstatSync(dir).isSymbolicLink()).toBe(false);
    fs.rmSync(dir, { recursive: true });
  }
});

describe.runIf(process.platform === 'linux')(
  'actual Linux SELF CPU corroboration (CI only)',
  () => {
    it('requires nonvacuous model agreement and independently checks retained units, bindings and fixed work', () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-own-cpu-integration-'));
      directories.push(base);
      const out = path.join(base, 'retained'),
        before = sourceRecords();
      const observedHz = spawnSync('/usr/bin/getconf', ['CLK_TCK'], {
        encoding: 'utf8',
        timeout: 2000,
        maxBuffer: 128,
        shell: false,
        env: { LC_ALL: 'C' },
      });
      expect(observedHz.error).toBeUndefined();
      expect(observedHz.status).toBe(0);
      expect(observedHz.stdout).toMatch(/^[1-9][0-9]*\n?$/);
      const hz = BigInt(observedHz.stdout.trim());
      expect(1000000000n % hz).toBe(0n);
      const result = spawnSync(
        process.execPath,
        ['--max-old-space-size=128', cli, '--run-id', 'real-self-cpu', '--out', out],
        {
          cwd: root,
          encoding: 'utf8',
          timeout: 15000,
          maxBuffer: 32768,
          shell: false,
          env: {
            PATH: process.env.PATH,
            LANG: 'C',
            LC_ALL: 'C',
            TEMP: base,
            TMP: base,
            TMPDIR: base,
            NODE_DISABLE_COMPILE_CACHE: '1',
            CPU_TEST_PRIVATE: 'private-cpu-environment-sentinel',
          },
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('linux-own-cpu-qualify: consistent-under-declared-model\n');
      expect(result.stderr).toBe('');
      expect(fs.readdirSync(out).sort()).toEqual([...roster].sort());
      const bytes = roster.map((file, i) => {
        const value = fs.readFileSync(path.join(out, file));
        expect(value.length).toBeLessThanOrEqual(caps[i]);
        return value;
      });
      expect(bytes.reduce((total, value) => total + value.length, 0)).toBeLessThanOrEqual(131072);
      const [plan, pending, raw, windows, final] = bytes.map((value) => JSON.parse(value));
      const hashes = bytes.map(digest);
      expect(plan).toMatchObject({
        version: 'linux-own-cpu-plan/1',
        runId: 'real-self-cpu',
        collectionMode: 'linux-own-defaults',
        clockTicksPerSecond: String(hz),
        rssAssessment: 'not-qualified',
        sampler: { durationMs: 2000, maxSamples: 2, maxOutputBytes: 16384 },
        stat: { source: '/proc/self/stat', fields: [14, 15, 22], maxBytes: 16384 },
        getconf: { source: '/usr/bin/getconf CLK_TCK', inheritedEnvironment: false },
      });
      expect(plan.model).toMatchObject({
        version: 'aggregate-floor-enclosure/1',
        tickEndpointAllowance: 2,
        apiEndpointAllowanceUs: 2,
        kernelModelQualified: false,
      });
      expect(pending).toMatchObject({
        version: 'linux-own-cpu-pending/1',
        runId: plan.runId,
        state: 'pending',
        planSha256: hashes[0],
        collectionMode: 'linux-own-defaults',
      });
      expect(raw).toMatchObject({
        version: 'self-resource-samples/1',
        runId: plan.runId,
        scope: 'calling-node-process',
        plannedDurationUs: 2000000,
        plannedPoints: 2,
        cadenceUs: 1000000,
        readingMode: 'injected',
        complete: true,
        pendingTimer: false,
        cleanupReason: null,
        inFlightReading: false,
      });
      expect(raw.samples).toHaveLength(2);
      expect(raw.missed).toEqual([]);
      expect(raw.unattempted).toBeNull();
      expect(windows).toMatchObject({
        version: 'linux-own-cpu-windows/1',
        runId: plan.runId,
        collectionMode: 'linux-own-defaults',
        planSha256: hashes[0],
        rawSha256: hashes[2],
        clockTicksPerSecond: String(hz),
        rssAssessment: 'not-qualified',
      });
      expect(final).toMatchObject({
        version: 'linux-own-cpu-final/1',
        runId: plan.runId,
        state: 'consistent-under-declared-model',
        reason: null,
        collectionMode: 'linux-own-defaults',
        finalPublication: 'not-self-attested',
        planSha256: hashes[0],
        rawSha256: hashes[2],
        windowsSha256: hashes[3],
        clockTicksPerSecond: String(hz),
        rssAssessment: 'not-qualified',
        platform: { family: 'linux', kernelModelQualified: false },
        acquisition: {
          complete: true,
          readingMode: 'injected',
          observedPoints: 2,
          missedPoints: 0,
          unattemptedPoints: 0,
        },
      });
      expect(final.files).toEqual(
        roster
          .slice(0, 4)
          .map((file, i) => ({
            file,
            sha256: hashes[i],
            byteLength: bytes[i].length,
            closed: true,
          })),
      );
      expect(plan.sources.files).toEqual(before);
      expect(final.sources).toEqual({ state: 'unchanged', after: plan.sources });
      expect(plan.sources).toMatchObject({
        basis: 'repository-disk-bytes-at-endpoint',
        nodeVersion: process.version,
        loadedCodeAuthenticated: false,
      });
      expect(sourceRecords()).toEqual(before);
      const samples = windows.windows,
        comparison = windows.comparison;
      expect(samples).toHaveLength(2);
      expect(final.comparison).toEqual(comparison);
      expect(comparison.model).toEqual(plan.model);
      const identities = [],
        times = [];
      samples.forEach((value, index) => {
        expect(value.index).toBe(index);
        expect(value.reason).toBeNull();
        expect(value.api.reason).toBeNull();
        expect(raw.samples[index].cpu).toMatchObject({
          userUs: value.api.userUs,
          systemUs: value.api.systemUs,
          reason: null,
        });
        for (const observed of [value.before, value.after]) {
          for (const key of ['userTicks', 'systemTicks', 'startTicks'])
            expect(observed[key]).toMatch(/^(?:0|[1-9][0-9]*)$/);
          expect(BigInt(observed.startTicks)).toBeGreaterThan(0n);
          identities.push(observed.startTicks);
          expect(observed.closed).toBe(true);
          expect(observed.sha256).toMatch(/^[a-f0-9]{64}$/);
          expect(observed.byteLength).toBeGreaterThan(0);
          expect(observed.byteLength).toBeLessThanOrEqual(16384);
        }
        for (const key of ['userTicks', 'systemTicks']) {
          expect(BigInt(value.after[key])).toBeGreaterThanOrEqual(BigInt(value.before[key]));
          if (index)
            expect(BigInt(value.before[key])).toBeGreaterThanOrEqual(
              BigInt(samples[index - 1].after[key]),
            );
        }
        times.push(
          value.before.beforeNs,
          value.before.afterNs,
          value.api.beforeNs,
          value.api.afterNs,
          value.after.beforeNs,
          value.after.afterNs,
        );
        const lower = ticks(value.before) * 1000000n,
          upper = (ticks(value.after) + 2n) * 1000000n,
          u = api(value);
        expect((u + 2n) * hz > lower && u * hz < upper).toBe(true);
        expect(comparison.endpoints[index]).toEqual({
          index,
          apiLowerUs: String(u),
          apiUpperExclusiveUs: String(u + 2n),
          referenceLowerUs: rational(lower, hz),
          referenceUpperExclusiveUs: rational(upper, hz),
          consistent: true,
        });
      });
      expect(new Set(identities).size).toBe(1);
      times.forEach((time, i) => {
        expect(time).toMatch(/^[0-9]+$/);
        if (i) expect(BigInt(time)).toBeGreaterThanOrEqual(BigInt(times[i - 1]));
      });
      const deltaApi = api(samples[1]) - api(samples[0]);
      const lower = (ticks(samples[1].before) - ticks(samples[0].after) - 2n) * 1000000n;
      const upper = (ticks(samples[1].after) + 2n - ticks(samples[0].before)) * 1000000n;
      expect(lower).toBeGreaterThan(4n * hz);
      expect(deltaApi).toBeGreaterThan(0n);
      expect((deltaApi + 2n) * hz > lower && (deltaApi - 2n) * hz < upper).toBe(true);
      expect(comparison.delta).toEqual({
        apiDeltaUs: String(deltaApi),
        apiLowerUs: String(deltaApi - 2n),
        apiUpperExclusiveUs: String(deltaApi + 2n),
        referenceLowerUs: rational(lower, hz),
        referenceUpperExclusiveUs: rational(upper, hz),
        consistent: true,
        sufficientResolution: true,
      });
      expect(comparison.state).toBe('consistent-under-declared-model');
      expect(plan.workload).toMatchObject({
        multiplier: 1664525,
        increment: 1013904223,
        seed: 1,
        iterations: 67108864,
        chunk: 65536,
        budgetNs: '2000000000',
      });
      expect(windows.workload).toMatchObject({
        state: 'completed',
        reason: null,
        completedIterations: 67108864,
        checksum: jumpLcg(67108864),
      });
      expect(final.workload).toEqual(windows.workload);
      expect(BigInt(windows.workload.beforeNs)).toBeGreaterThanOrEqual(
        BigInt(samples[0].after.afterNs),
      );
      expect(BigInt(windows.workload.afterNs)).toBeLessThanOrEqual(
        BigInt(samples[1].before.beforeNs),
      );
      for (const scale of [1000, 0.001]) {
        const changed = structuredClone(samples);
        for (const value of changed)
          for (const key of ['userUs', 'systemUs'])
            value.api[key] =
              scale === 1000 ? value.api[key] * 1000 : Math.floor(value.api[key] / 1000);
        const refused = evaluateCpuReference({ clockTicksPerSecond: String(hz), windows: changed });
        expect(refused).toMatchObject({
          state: 'refused',
          reason: 'unit-or-enclosure-disagreement',
        });
      }
      for (const packet of [plan, pending, windows, comparison, final])
        for (const key of [
          'sourceAuthenticated',
          'measurementAccepted',
          'calibrationAccepted',
          'w8Accepted',
        ])
          expect(packet[key]).toBe(false);
      const publicFixedPaths = new Set(['/proc/self/stat', '/usr/bin/getconf CLK_TCK']);
      const retained = [plan, pending, raw, windows, final],
        text = bytes.map(String).join('\n') + result.stdout + result.stderr;
      for (const value of retained.flatMap(stringsIn))
        if (!publicFixedPaths.has(value)) {
          expect(path.posix.isAbsolute(value)).toBe(false);
          expect(path.win32.isAbsolute(value)).toBe(false);
        }
      for (const secret of [base, out, root, os.homedir(), 'private-cpu-environment-sentinel'])
        expect(text).not.toContain(secret);
      for (const key of [
        'pid',
        'comm',
        'env',
        'argv',
        'cwd',
        'path',
        'hostname',
        'command',
        'executable',
      ])
        expect(retained.flatMap(keysIn)).not.toContain(key);
    }, 20000);
  },
);
