import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const runner = require('../../../bench/run');
const actor = require('../../../bench/lib/actor');
const childProcess = require('node:child_process');
const { buildCorpusResults, writeCorpusResults } = require('../../../bench/lib/corpus-results');
const root = path.resolve(import.meta.dirname, '../../..');
const directories = [];
const artifactNames = [
  'manifest.json',
  'steps.json',
  'expected.ndjson',
  'fixture-outcomes.json',
  'file-read-outcomes.json',
];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (dir, file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
const directory = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-integrity-'));
  directories.push(dir);
  return dir;
};
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true });
});

let serial = 0;
function producerManifest(options) {
  const file = require.resolve('../../../bench/lib/manifest'),
    previous = require.cache[file],
    exec = vi.spyOn(childProcess, 'execFileSync').mockImplementation(() => {
      throw new Error('fixture-subprocess-refused');
    });
  try {
    delete require.cache[file];
    return require(file).collect(options);
  } finally {
    if (previous) require.cache[file] = previous;
    else delete require.cache[file];
    exec.mockRestore();
  }
}
async function recorded(id = 'S3-ordinary-fixture', configure = () => {}) {
  const scenario = runner.prepareScenario(id, 'C'),
    now = new Date(Date.UTC(2024, 1, 29, 12, 34, serial++)),
    startedAt = now.toISOString(),
    runId = runner.buildRunId(now, id, 'C'),
    dir = directory();
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify(producerManifest({ runId, scenario: id, arm: 'C', startedAt })),
  );
  configure();
  const outcome = await actor.execute(scenario, { runDir: dir, runId });
  runner.writeScenarioArtifacts({ dir, runId, scenario, arm: 'C', outcome });
  return { dir, runId, scenario, startedAt, outcome };
}
const rawArtifacts = (dir) =>
  artifactNames
    .filter((file) => fs.existsSync(path.join(dir, file)))
    .map((artifact) => {
      const bytes = fs.readFileSync(path.join(dir, artifact));
      return { artifact, bytes: bytes.length, sha256: hash(bytes) };
    });

describe('recorded corpus integrity and public projections', () => {
  it('propagates two valid label dates without replacing the fixed recorded start', async () => {
    const item = await recorded();
    for (const asOf of ['2024-02-29', '2030-12-31']) {
      const out = path.join(directory(), 'report'),
        report = writeCorpusResults([item.dir], asOf, out);
      expect(report.asOf).toBe(asOf);
      expect(report.attempts[0].recordedStartedAt).toBe(item.startedAt);
      expect(json(out, 'corpus-results.json')).toMatchObject({
        asOf,
        attempts: [{ recordedStartedAt: item.startedAt }],
      });
      expect(fs.readFileSync(path.join(out, 'corpus-results.md'), 'utf8')).toContain(asOf);
    }
  });

  it('hashes every consumed raw artifact and retains repeated attempts after whitespace changes', async () => {
    const items = [
      await recorded(),
      await recorded(),
      await recorded('S7-owned-loopback-transfer'),
      await recorded('S8-owned-file-read'),
    ];
    const dirs = items.map((item) => item.dir),
      before = buildCorpusResults(dirs, '2026-10-24');
    expect(before.attempts).toHaveLength(items.length);
    let inputBytes = 0;
    for (const item of items) {
      const expected = rawArtifacts(item.dir);
      expect(before.attempts.find((row) => row.runId === item.runId).artifacts).toEqual(expected);
      inputBytes += expected.reduce((total, row) => total + row.bytes, 0);
      for (const row of expected) fs.appendFileSync(path.join(item.dir, row.artifact), ' \n');
    }
    expect(before.artifactInputBytes).toBe(inputBytes);
    const after = buildCorpusResults(dirs, '2026-10-24');
    let changedBytes = 0;
    for (const item of items) {
      const expected = rawArtifacts(item.dir),
        original = before.attempts.find((row) => row.runId === item.runId);
      expect(after.attempts.find((row) => row.runId === item.runId).artifacts).toEqual(expected);
      expected.forEach((row, index) => {
        expect(row.sha256).not.toBe(original.artifacts[index].sha256);
        expect(row.bytes).toBe(original.artifacts[index].bytes + 2);
        changedBytes += row.bytes;
      });
    }
    expect(after.artifactInputBytes).toBe(changedBytes);
    for (const row of after.attempts) expect(row.executedDefinitionMatch).toBe('unverified');
    expect(after.attempts.map((row) => row.runId)).toEqual(before.attempts.map((row) => row.runId));
    expect(
      after.inventory.find((row) => row.scenario === items[0].scenario.id).suppliedAttempts,
    ).toBe(2);
  });

  it('identifies current definition bytes and counts without authenticating executed definitions', async () => {
    const item = await recorded(),
      report = buildCorpusResults([item.dir], '2026-10-24');
    for (const row of report.inventory) {
      const bytes = fs.readFileSync(
        path.join(root, 'bench/scenarios', row.scenario, 'scenario.json'),
      );
      expect(row.currentDefinitionSha256).toBe(hash(bytes));
      expect(row.currentStepCount).toBe(JSON.parse(bytes).steps.length);
      expect(row.executedDefinitionMatch).toBe('unverified');
    }
    const definition = json(path.join(root, 'bench/scenarios', item.scenario.id), 'scenario.json');
    expect(item.scenario.steps).toEqual(definition.steps);
    expect(report.attempts.every((row) => row.executedDefinitionMatch === 'unverified')).toBe(true);
  });

  it('keeps authentication and acceptance false beside perfect ignored scoring and ATT&CK claims', async () => {
    const item = await recorded('S8-owned-file-read'),
      perfect = {
        sourceAuthenticated: true,
        measurementAccepted: true,
        w8Accepted: true,
        recall: 1,
        precision: 1,
      };
    for (const file of ['metrics.json', 'attack-mapping.json', 'attack-coverage.json'])
      fs.writeFileSync(path.join(item.dir, file), JSON.stringify(perfect));
    for (const file of ['oracle-sysmon.ndjson', 'observed.ndjson', 'matched.ndjson'])
      fs.copyFileSync(path.join(item.dir, 'expected.ndjson'), path.join(item.dir, file));
    fs.writeFileSync(path.join(item.dir, 'attack-matrix.md'), 'All techniques covered: 100%\n');
    const report = buildCorpusResults([item.dir], '2026-10-24');
    expect(report).toMatchObject({
      sourceAuthenticated: false,
      measurementAccepted: false,
      w8Accepted: false,
      captureAssessment: 'not-assessed',
      oracleAdmission: 'not-performed',
      sensorScoring: 'not-performed',
      attackMapping: 'not-performed',
    });
    expect(report.attempts[0].artifacts.map((row) => row.artifact)).toEqual([
      'manifest.json',
      'steps.json',
      'expected.ndjson',
      'file-read-outcomes.json',
    ]);
  });

  it('projects the full confirmed owned S7 sender, receiver, payload hashes and cleanup', async () => {
    const item = await recorded('S7-owned-loopback-transfer'),
      original = json(item.dir, 'fixture-outcomes.json').outcomes[0],
      control = original.control,
      { version, runId, nonce, plannedDurationMs, ...receiver } = control.receiver,
      payload = Buffer.from(
        `AEGIS_PUBLIC_INERT_LOOPBACK_V1\n${item.runId}\n${original.nonce}\n`,
        'ascii',
      );
    expect(version).toBe('loopback-receiver/1');
    expect(runId).toBe(item.runId);
    expect(nonce).toBe(original.nonce);
    expect(plannedDurationMs).toBe(1000);
    expect(control.confirmed).toBe(true);
    expect(receiver).toMatchObject({
      expectedCount: 1,
      verifiedCount: 1,
      exact: true,
      expectedBytes: payload.length,
      expectedSha256: hash(payload),
      observedHashes: [hash(payload)],
      cleanup: { listenerClosed: true, socketsClosed: true, confirmed: true },
    });
    expect(buildCorpusResults([item.dir], '2026-10-24').attempts[0].loopback).toEqual({
      state: 'recorded',
      step: original.step,
      nonce: original.nonce,
      reason: null,
      sender: control.sender,
      receiver,
      combinedConfirmed: true,
    });
  });

  it('projects the complete S8 identity, actual canary digest, source binding and descriptor closure', async () => {
    const item = await recorded('S8-owned-file-read'),
      original = json(item.dir, 'file-read-outcomes.json').outcomes[0],
      { version, runId, scenario, ...facts } = original,
      bytes = Buffer.from('AEGIS_PUBLIC_INERT_FILE_READ_V1\n');
    expect(version).toBe('file-read-control/1');
    expect(runId).toBe(item.runId);
    expect(scenario).toBe(item.scenario.id);
    expect(original).toMatchObject({
      expectedBytes: bytes.length,
      readBytes: bytes.length,
      expectedSha256: hash(bytes),
      readSha256: hash(bytes),
      progressKnown: true,
      status: 'complete',
      reason: null,
      closure: { opened: true, closeAttempted: true, closed: true },
    });
    const identities = [
      'originalIdentitySha256',
      'preIdentitySha256',
      'postIdentitySha256',
      'namedIdentitySha256',
    ];
    for (const key of identities) expect(original[key]).toMatch(/^[a-f0-9]{64}$/);
    expect(new Set(identities.map((key) => original[key])).size).toBe(1);
    expect(buildCorpusResults([item.dir], '2026-10-24').attempts[0].read).toEqual({
      state: 'recorded',
      sourceBinding: 'recorded-source-checked',
      ...facts,
    });
  });

  it('distinguishes S8 empty outcomes from a missing outcome artifact without losing the attempt', async () => {
    const item = await recorded('S8-owned-file-read'),
      file = path.join(item.dir, 'file-read-outcomes.json'),
      original = json(item.dir, 'file-read-outcomes.json');
    original.outcomes = [];
    fs.writeFileSync(file, JSON.stringify(original));
    expect(buildCorpusResults([item.dir], '2026-10-24').attempts[0]).toMatchObject({
      runId: item.runId,
      artifactState: 'incomplete',
      missingArtifacts: [],
      read: { state: 'empty-incomplete' },
    });
    fs.unlinkSync(file);
    expect(buildCorpusResults([item.dir], '2026-10-24').attempts[0]).toMatchObject({
      runId: item.runId,
      artifactState: 'incomplete',
      missingArtifacts: ['file-read-outcomes.json'],
      read: { state: 'missing' },
    });
  });

  it('retains actual failed S8 read observations and distinguishes an actual skipped read', async () => {
    const failed = await recorded('S8-owned-file-read', () => {
      vi.spyOn(fs, 'readSync').mockImplementationOnce(() => {
        throw new Error('owned-read-failure');
      });
    });
    vi.restoreAllMocks();
    expect(failed.outcome.ok).toBe(false);
    expect(buildCorpusResults([failed.dir], '2026-10-24').attempts[0]).toMatchObject({
      artifactState: 'recorded',
      stepState: 'failed',
      read: {
        state: 'recorded',
        status: 'failed',
        reason: 'read-unavailable',
        closure: { closed: true },
      },
    });
    const skipped = await recorded('S8-owned-file-read', () => {
      vi.spyOn(fs, 'openSync').mockImplementationOnce(() => {
        throw new Error('owned-write-failure');
      });
    });
    vi.restoreAllMocks();
    expect(skipped.outcome.steps.map((step) => step.status)).toEqual(['failed', 'skipped']);
    expect(json(skipped.dir, 'file-read-outcomes.json').outcomes).toEqual([]);
    expect(buildCorpusResults([skipped.dir], '2026-10-24').attempts[0]).toMatchObject({
      runId: skipped.runId,
      artifactState: 'recorded',
      stepState: 'failed',
      steps: { failed: 1, skipped: 1 },
      expected: { count: 0 },
      read: { state: 'not-executed' },
    });
  });
});
