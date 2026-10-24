import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const supervisorCli = require.resolve('../../../bench/self-resource-supervise.cjs');
const replayCli = require.resolve('../../../bench/resource-session-replay.cjs');
const repository = path.resolve(path.dirname(replayCli), '..');
const currentSources = require('../../../bench/lib/resource-replay-current').SOURCES;
const producerSources = require('../../../bench/lib/resource-supervisor-storage').SOURCES;
const sourceFiles = [...new Set([...currentSources, ...producerSources])];
const roster = [
  'supervision-plan.json',
  'supervision-pending.json',
  'supervision-final.json',
  'capture/session-plan.json',
  'capture/session-pending.json',
  'capture/raw-samples.json',
  'capture/bracketed-intervals.json',
  'capture/session-final.json',
];
const directories = [];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
function fileRecord(file, root) {
  const bytes = fs.readFileSync(path.join(root, file));
  return { file, sha256: digest(bytes), byteLength: bytes.length };
}
function tree(dir, prefix = '') {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap((entry) => {
      const file = prefix + entry.name;
      expect(entry.isSymbolicLink()).toBe(false);
      return entry.isDirectory()
        ? [{ directory: file }, ...tree(path.join(dir, entry.name), file + '/')]
        : [
            {
              file,
              sha256: digest(fs.readFileSync(path.join(dir, entry.name))),
              byteLength: fs.statSync(path.join(dir, entry.name)).size,
            },
          ];
    });
}
function stringsIn(value) {
  if (typeof value === 'string') return [value];
  return value && typeof value === 'object' ? Object.values(value).flatMap(stringsIn) : [];
}
function invoke(cli, argv, temporary) {
  return spawnSync(process.execPath, [cli, ...argv], {
    cwd: repository,
    encoding: 'utf8',
    timeout: 20000,
    maxBuffer: 32768,
    windowsHide: true,
    env: { ...process.env, TEMP: temporary, TMP: temporary, NODE_DISABLE_COMPILE_CACHE: '1' },
  });
}
afterEach(() => {
  for (const dir of directories.splice(0)) {
    expect(path.dirname(dir)).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(dir)).toMatch(/^resource-replay-integration-/);
    expect(fs.lstatSync(dir).isSymbolicLink()).toBe(false);
    fs.rmSync(dir, { recursive: true });
  }
});

describe('actual supervised bundle followed by deterministic offline replay', () => {
  it('replays one shortest fixed-child capture twice with deterministic reports and unchanged evidence', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'resource-replay-integration-'));
    directories.push(base);
    const input = path.join(base, 'input');
    const sourcesBefore = sourceFiles.map((file) => fileRecord(file, repository));
    const acquired = invoke(
      supervisorCli,
      Object.entries({
        '--run-id': 'replay-integration',
        '--duration-ms': '1000',
        '--max-acquisition-us': '10000',
        '--max-cpu-uncertainty-us': '20000',
        '--wall-limit-ms': '10000',
        '--confirm-ms': '1000',
        '--out': input,
      }).flat(),
      base,
    );
    expect(acquired.error).toBeUndefined();
    expect(acquired.signal).toBeNull();
    expect([0, 3]).toContain(acquired.status);
    const bytes = Object.fromEntries(
      roster.map((file) => [file, fs.readFileSync(path.join(input, file))]),
    );
    const values = Object.fromEntries(roster.map((file) => [file, JSON.parse(bytes[file])]));
    const parentFinal = values['supervision-final.json'],
      childPlan = values['capture/session-plan.json'];
    const raw = values['capture/raw-samples.json'],
      derived = values['capture/bracketed-intervals.json'];
    const childFinal = values['capture/session-final.json'];
    const before = tree(input),
      outputBytes = [];
    const historicalEvaluator = childPlan.sources.files.find(
      (file) => file.file === 'bench/lib/bracketed-resource-intervals.js',
    );
    const currentEvaluator = fileRecord('bench/lib/bracketed-resource-intervals.js', repository);
    for (const index of [1, 2]) {
      const out = path.join(base, `replay-${index}`);
      const result = invoke(replayCli, ['--input', input, '--out', out], base);
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status).toBe(acquired.status);
      expect(result.stdout).toBe(
        acquired.status === 0 ? 'resource-session-replay: consistent\n' : '',
      );
      expect(result.stderr).toBe(
        acquired.status === 0 ? '' : 'resource-session-replay: incomplete\n',
      );
      expect(fs.readdirSync(out)).toEqual(['resource-replay.json']);
      const reportBytes = fs.readFileSync(path.join(out, 'resource-replay.json'));
      expect(reportBytes.length).toBeLessThanOrEqual(65536);
      outputBytes.push(reportBytes);
      const report = JSON.parse(reportBytes);
      expect(report).toMatchObject({
        version: 'resource-session-replay/1',
        scope: 'offline-supervised-resource-bundle',
        runId: 'replay-integration',
        classification: acquired.status === 0 ? 'consistent-for-conditional-replay' : 'incomplete',
        finalPublication: 'not-self-attested',
        parentFinalPublication: 'unknown',
        childFinalPublication: 'unknown',
        sourceAuthenticated: false,
        measurementAccepted: false,
        w8Accepted: false,
      });
      expect(report.reportedChildPublicationSupport).toBe(
        acquired.status === 0 ? 'supported-by-reported-lifecycle' : 'not-supported',
      );
      expect(report.input).toEqual({
        files: roster.map((file) => ({
          file,
          sha256: digest(bytes[file]),
          byteLength: bytes[file].length,
          closed: true,
        })),
        missing: [],
        bytes: Object.values(bytes).reduce((total, value) => total + value.length, 0),
      });
      expect(report.historical).toEqual({
        parentState: parentFinal.state,
        childState: childFinal.state,
        executionMode: 'real-child',
        readingMode: 'own-process',
        sourceAlignment: 'match',
      });
      expect(report.replay).toEqual({
        state: 'recomputed',
        basis: 'stored-derived-embedded',
        storedDerivedCompared: true,
        entireStoredResultEqual: true,
      });
      expect(report.acquisition).toMatchObject({
        basis: 'raw-artifact',
        complete: raw.complete,
        plannedPoints: 1,
        observedPoints: raw.samples.length,
        missedPoints: raw.missed.length,
        unattemptedPoints: raw.unattempted?.count ?? 0,
        stopReason: raw.stopReason,
        populationComplete: null,
        osBirthTime: null,
      });
      expect(report.acquisition.readingFailures).toEqual(
        raw.samples.map((sample, index) => ({
          sample: index,
          cpuReason: sample.cpu.reason,
          rssReason: sample.rss.reason,
        })),
      );
      expect(report.exclusions).toEqual({
        cpu: [],
        memory: derived.memory.map((sample) => ({
          sample: sample.sample,
          reason: sample.reason,
        })),
        closingScheduledPoint: false,
      });
      const inventory = report.current.sources.before;
      expect(report.current.sources).toEqual({
        state: 'unchanged',
        before: inventory,
        after: inventory,
      });
      expect(inventory).toMatchObject({
        basis: 'repository-disk-bytes-at-endpoint',
        nodeVersion: process.version,
        loadedCodeAuthenticated: false,
      });
      expect(inventory.files).toEqual(currentSources.map((file) => fileRecord(file, repository)));
      expect(report.current.evaluator).toEqual({
        ...currentEvaluator,
        nodeVersion: process.version,
        historicalComparison:
          historicalEvaluator.sha256 === currentEvaluator.sha256 ? 'match' : 'different',
        loadedCodeAuthenticated: false,
      });
      expect(tree(input)).toEqual(before);
      expect(sourceFiles.map((file) => fileRecord(file, repository))).toEqual(sourcesBefore);
      const strings = stringsIn(report);
      for (const value of strings) {
        expect(path.posix.isAbsolute(value)).toBe(false);
        expect(path.win32.isAbsolute(value)).toBe(false);
      }
      const published = strings.join('\n') + result.stdout + result.stderr;
      for (const privatePath of [base, input, out, repository, os.homedir()])
        expect(published).not.toContain(privatePath);
      for (const field of ['pid', 'hostname', 'argv', 'cwd', 'env', 'command', 'executable'])
        expect(reportBytes.toString()).not.toContain(`"${field}":`);
    }
    expect(outputBytes[1]).toEqual(outputBytes[0]);
    expect(digest(outputBytes[1])).toBe(digest(outputBytes[0]));
    expect(raw).toMatchObject({
      readingMode: 'own-process',
      scope: 'calling-node-process',
      identity: { osBirthTime: null, reason: 'not-observed' },
      population: { complete: null, reason: 'not-collected' },
    });
    expect(derived.intervals).toEqual([]);
    expect(derived.boundaries).toMatchObject({
      plannedEndUs: 1000000,
      closingScheduledPoint: false,
      reason: 'end-exclusive-schedule',
    });
  }, 65000);
});
