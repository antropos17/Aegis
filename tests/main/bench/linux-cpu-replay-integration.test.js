import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const collectCli = require.resolve('../../../bench/linux-own-cpu-qualify.cjs');
const replayCli = require.resolve('../../../bench/linux-cpu-replay.cjs');
const root = path.resolve(path.dirname(replayCli), '..');
const currentSources = require('../../../bench/lib/linux-cpu-replay-io').SOURCES;
const historicalSources = require('../../../bench/lib/linux-own-cpu-storage').SOURCES;
const sources = [...new Set([...currentSources, ...historicalSources])];
const files = [
  'cpu-reference-plan.json',
  'cpu-reference-pending.json',
  'raw-samples.json',
  'cpu-reference-windows.json',
  'cpu-reference-final.json',
];
const directories = [];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (input, file) => JSON.parse(fs.readFileSync(path.join(input, file), 'utf8'));
const write = (input, file, value) =>
  fs.writeFileSync(path.join(input, file), JSON.stringify(value, null, 2) + '\n');
const record = (input, file) => {
  const bytes = fs.readFileSync(path.join(input, file));
  return { file, sha256: hash(bytes), byteLength: bytes.length };
};
const inputs = (input) => files.map((file) => ({ ...record(input, file), closed: true }));
function invoke(cli, argv, base, timeout = 8000) {
  return spawnSync(process.execPath, [cli, ...argv], {
    cwd: root,
    encoding: 'utf8',
    timeout,
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
      CPU_REPLAY_TEST_PRIVATE: 'private-cpu-replay-environment-sentinel',
    },
  });
}
function copied(base, name, original) {
  const input = path.join(base, name);
  fs.mkdirSync(input);
  files.forEach((file, i) => fs.writeFileSync(path.join(input, file), original[i]));
  return input;
}
function assertLinks(input) {
  const [plan, pending, raw, windows, final] = files.map((file) => json(input, file));
  const hashes = files.map((file) => record(input, file).sha256);
  expect(pending.planSha256).toBe(hashes[0]);
  expect(windows.planSha256).toBe(hashes[0]);
  expect(final.planSha256).toBe(hashes[0]);
  expect(windows.rawSha256).toBe(hashes[2]);
  expect(final.rawSha256).toBe(hashes[2]);
  expect(final.windowsSha256).toBe(hashes[3]);
  expect(final.files).toEqual(inputs(input).slice(0, 4));
  for (const value of [pending, raw, windows, final]) expect(value.runId).toBe(plan.runId);
  return { plan, raw, windows, final };
}
function jumpChecksum(count) {
  const mask = 0xffffffffn;
  let n = BigInt(count),
    a = 1664525n,
    c = 1013904223n,
    scale = 1n,
    shift = 0n;
  while (n) {
    if (n & 1n) {
      shift = (a * shift + c) & mask;
      scale = (a * scale) & mask;
    }
    c = (a * c + c) & mask;
    a = (a * a) & mask;
    n >>= 1n;
  }
  return Number((scale + shift) & mask);
}
const tickSum = (value) => BigInt(value.userTicks) + BigInt(value.systemTicks);
const apiSum = (value) => BigInt(value.api.userUs) + BigInt(value.api.systemUs);
const rational = (numerator, denominator) => ({
  numerator: String(numerator),
  denominator: String(denominator),
});
function assertArithmetic(raw, packet) {
  const hz = BigInt(packet.clockTicksPerSecond),
    windows = packet.windows,
    comparison = packet.comparison;
  expect(raw.samples).toHaveLength(2);
  expect(windows).toHaveLength(2);
  const identities = [];
  const endpoints = windows.map((value, index) => {
    expect(value.index).toBe(index);
    expect(value.reason).toBeNull();
    expect(raw.samples[index].cpu).toMatchObject({
      userUs: value.api.userUs,
      systemUs: value.api.systemUs,
      reason: null,
    });
    for (const ref of [value.before, value.after]) {
      expect(ref.closed).toBe(true);
      expect(ref.startTicks).toMatch(/^[1-9][0-9]*$/);
      identities.push(ref.startTicks);
    }
    const lower = tickSum(value.before) * 1000000n,
      upper = (tickSum(value.after) + 2n) * 1000000n,
      api = apiSum(value);
    expect((api + 2n) * hz > lower && api * hz < upper).toBe(true);
    return {
      index,
      apiLowerUs: String(api),
      apiUpperExclusiveUs: String(api + 2n),
      referenceLowerUs: rational(lower, hz),
      referenceUpperExclusiveUs: rational(upper, hz),
      consistent: true,
    };
  });
  expect(new Set(identities).size).toBe(1);
  expect(comparison.endpoints).toEqual(endpoints);
  const difference = tickSum(windows[1].before) - tickSum(windows[0].after) - 2n;
  const lower = (difference > 0n ? difference : 0n) * 1000000n;
  const upper = (tickSum(windows[1].after) + 2n - tickSum(windows[0].before)) * 1000000n;
  const delta = apiSum(windows[1]) - apiSum(windows[0]);
  const apiLower = delta > 2n ? delta - 2n : 0n;
  expect(lower).toBeGreaterThan(4n * hz);
  expect(delta).toBeGreaterThan(0n);
  expect((delta + 2n) * hz > lower && apiLower * hz < upper).toBe(true);
  expect(comparison.delta).toEqual({
    apiDeltaUs: String(delta),
    apiLowerUs: String(apiLower),
    apiUpperExclusiveUs: String(delta + 2n),
    referenceLowerUs: rational(lower, hz),
    referenceUpperExclusiveUs: rational(upper, hz),
    consistent: true,
    sufficientResolution: true,
  });
  expect(packet.workload).toMatchObject({
    state: 'completed',
    reason: null,
    completedIterations: 67108864,
    checksum: jumpChecksum(67108864),
  });
  expect(BigInt(packet.workload.beforeNs)).toBeGreaterThanOrEqual(BigInt(windows[0].after.afterNs));
  expect(BigInt(packet.workload.afterNs)).toBeLessThanOrEqual(BigInt(windows[1].before.beforeNs));
}
function privacy(report, privateValues) {
  const walk = (value) => {
    if (typeof value === 'string') {
      expect(path.posix.isAbsolute(value)).toBe(false);
      expect(path.win32.isAbsolute(value)).toBe(false);
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        expect([
          'pid',
          'comm',
          'env',
          'path',
          'cwd',
          'argv',
          'hostname',
          'command',
          'executable',
        ]).not.toContain(key);
        walk(child);
      }
    }
  };
  walk(report);
  const text = JSON.stringify(report);
  for (const value of privateValues) expect(text).not.toContain(value);
  for (const key of [
    'sourceAuthenticated',
    'measurementAccepted',
    'calibrationAccepted',
    'w8Accepted',
  ])
    expect(report[key]).toBe(false);
  expect(report.originalFinalPublication).toBe('unknown');
  expect(report.finalPublication).toBe('not-self-attested');
  expect(report.recorded.finalPublication).toBe('unknown');
  expect(report.recorded.predecessorClosure).toBe('reported-only');
}
afterEach(() => {
  for (const dir of directories.splice(0)) {
    expect(path.dirname(path.resolve(dir))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(dir)).toMatch(/^linux-cpu-replay-integration-/);
    expect(fs.lstatSync(dir).isSymbolicLink()).toBe(false);
    fs.rmSync(dir, { recursive: true });
  }
});

describe.runIf(process.platform === 'linux')(
  'actual Linux CPU collection followed by offline replay (CI only)',
  () => {
    it('replays one real bundle twice deterministically and refuses rehashed unit, missing and reported-failure copies', () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-cpu-replay-integration-'));
      directories.push(base);
      const input = path.join(base, 'real-input'),
        sourceBefore = sources.map((file) => record(root, file));
      const acquired = invoke(
        collectCli,
        ['--run-id', 'real-replay-cpu', '--out', input],
        base,
        15000,
      );
      expect(acquired.error).toBeUndefined();
      expect(acquired.signal).toBeNull();
      expect(acquired.status).toBe(0);
      expect(acquired.stdout).toBe('linux-own-cpu-qualify: consistent-under-declared-model\n');
      expect(acquired.stderr).toBe('');
      expect(fs.readdirSync(input).sort()).toEqual([...files].sort());
      const original = files.map((file) => fs.readFileSync(path.join(input, file))),
        inputBefore = inputs(input);
      const { plan, raw, windows, final } = assertLinks(input);
      expect(plan.collectionMode).toBe('linux-own-defaults');
      expect(raw.readingMode).toBe('injected');
      expect(raw.complete).toBe(true);
      expect(plan.sources.files).toEqual(historicalSources.map((file) => record(root, file)));
      expect(final.state).toBe('consistent-under-declared-model');
      assertArithmetic(raw, windows);
      const privateValues = [
        base,
        input,
        root,
        os.homedir(),
        'private-cpu-replay-environment-sentinel',
      ];
      const outputBytes = [];
      for (const index of [1, 2]) {
        const out = path.join(base, `replay-${index}`),
          result = invoke(replayCli, ['--input', input, '--out', out], base);
        expect(result.error).toBeUndefined();
        expect(result.signal).toBeNull();
        expect(result.status).toBe(0);
        expect(result.stdout).toBe('');
        expect(result.stderr).toBe('');
        expect(fs.readdirSync(out)).toEqual(['linux-cpu-replay.json']);
        const bytes = fs.readFileSync(path.join(out, 'linux-cpu-replay.json'));
        expect(bytes.length).toBeLessThanOrEqual(65536);
        outputBytes.push(bytes);
        const report = JSON.parse(bytes);
        expect(report).toMatchObject({
          version: 'linux-cpu-replay/1',
          scope: 'offline-linux-self-cpu-bundle',
          state: 'consistent-for-conditional-replay',
          reason: null,
          runId: plan.runId,
          missing: [],
          replay: { state: 'equal', comparison: windows.comparison },
        });
        expect(report.inputs).toEqual(inputBefore);
        expect(report.recorded).toEqual({
          runId: plan.runId,
          collectionMode: 'linux-own-defaults',
          comparisonState: windows.comparison.state,
          workState: 'completed',
          sourceState: 'unchanged',
          finalState: final.state,
          finalPublication: 'unknown',
          predecessorClosure: 'reported-only',
          rssAssessment: 'not-qualified',
        });
        expect(report.current.nodeVersion).toBe(process.version);
        expect(report.current.state).toBe('unchanged');
        expect(report.current.sourcesBefore).toEqual(report.current.sourcesAfter);
        expect(report.current.sourcesBefore).toEqual({
          basis: 'current-repository-disk-bytes-at-endpoint',
          loadedCodeAuthenticated: false,
          nodeVersion: process.version,
          files: currentSources.map((file) => record(root, file)),
        });
        const model = plan.sources.files.find(
          (entry) => entry.file === 'bench/lib/linux-own-cpu-model.js',
        );
        expect(report.current.historicalModel).toEqual({
          ...model,
          nodeVersion: plan.sources.nodeVersion,
          basis: 'recorded-plan-declaration',
        });
        expect(report.current.historicalModelComparison).toBe('match');
        expect(
          report.current.sourcesBefore.files.find((entry) => entry.file === model.file),
        ).toEqual(record(root, model.file));
        privacy(report, [...privateValues, out]);
        expect(inputs(input)).toEqual(inputBefore);
        expect(files.map((file) => fs.readFileSync(path.join(input, file)))).toEqual(original);
      }
      expect(outputBytes[1]).toEqual(outputBytes[0]);

      // These controlled copies are modified recorded claims, not additional native captures.
      const tampered = copied(base, 'tampered-unit-copy', original);
      const changedRaw = json(tampered, files[2]),
        changedWindows = json(tampered, files[3]),
        changedFinal = json(tampered, files[4]);
      for (const value of changedRaw.samples)
        for (const key of ['userUs', 'systemUs']) value.cpu[key] *= 1000;
      for (const value of changedWindows.windows)
        for (const key of ['userUs', 'systemUs']) value.api[key] *= 1000;
      write(tampered, files[2], changedRaw);
      changedWindows.rawSha256 = record(tampered, files[2]).sha256;
      write(tampered, files[3], changedWindows);
      changedFinal.rawSha256 = changedWindows.rawSha256;
      changedFinal.windowsSha256 = record(tampered, files[3]).sha256;
      changedFinal.files = inputs(tampered).slice(0, 4);
      write(tampered, files[4], changedFinal);
      assertLinks(tampered);
      const hz = BigInt(changedWindows.clockTicksPerSecond);
      expect(
        changedWindows.windows.some(
          (value) => apiSum(value) * hz >= (tickSum(value.after) + 2n) * 1000000n,
        ),
      ).toBe(true);
      const changedOut = path.join(base, 'tampered-replay'),
        changed = invoke(replayCli, ['--input', tampered, '--out', changedOut], base);
      expect(changed.error).toBeUndefined();
      expect(changed.signal).toBeNull();
      expect(changed.status).toBe(4);
      expect(changed.stderr).toBe('linux-cpu-replay: bundle-refused\n');
      expect(changed.stdout).toBe('');
      const changedReport = json(changedOut, 'linux-cpu-replay.json');
      expect(changedReport).toMatchObject({
        state: 'refused',
        reason: 'comparison-mismatch',
        replay: {
          state: 'different',
          comparison: { state: 'refused', reason: 'unit-or-enclosure-disagreement' },
        },
      });
      expect(changedReport.inputs).toEqual(inputs(tampered));
      privacy(changedReport, privateValues);

      const missing = copied(base, 'missing-pending-copy', original);
      fs.unlinkSync(path.join(missing, files[1]));
      const missingOut = path.join(base, 'missing-replay'),
        absent = invoke(replayCli, ['--input', missing, '--out', missingOut], base);
      expect(absent.error).toBeUndefined();
      expect(absent.signal).toBeNull();
      expect(absent.status).toBe(3);
      const missingReport = json(missingOut, 'linux-cpu-replay.json');
      expect(missingReport).toMatchObject({
        state: 'incomplete-or-recorded-nonpass',
        missing: [files[1]],
        replay: { state: 'equal' },
      });
      expect(missingReport.inputs[1]).toEqual({ file: files[1], missing: true });
      privacy(missingReport, privateValues);

      const failed = copied(base, 'reported-source-failure-copy', original),
        failedFinal = json(failed, files[4]);
      failedFinal.sources.state = 'changed';
      failedFinal.state = 'unavailable';
      failedFinal.reason = 'source-unavailable-or-changed';
      const previous = failedFinal.sources.after.files[0].sha256;
      failedFinal.sources.after.files[0].sha256 =
        (previous[0] === '0' ? '1' : '0') + previous.slice(1);
      write(failed, files[4], failedFinal);
      assertLinks(failed);
      const failedOut = path.join(base, 'failed-replay'),
        nonpass = invoke(replayCli, ['--input', failed, '--out', failedOut], base);
      expect(nonpass.error).toBeUndefined();
      expect(nonpass.signal).toBeNull();
      expect(nonpass.status).toBe(3);
      const failedReport = json(failedOut, 'linux-cpu-replay.json');
      expect(failedReport).toMatchObject({
        state: 'incomplete-or-recorded-nonpass',
        reason: 'recorded-nonpass',
        recorded: { sourceState: 'changed', finalState: 'unavailable' },
        replay: { state: 'equal' },
      });
      privacy(failedReport, privateValues);
      expect(inputs(input)).toEqual(inputBefore);
      expect(sources.map((file) => record(root, file))).toEqual(sourceBefore);
    }, 65000);
  },
);
