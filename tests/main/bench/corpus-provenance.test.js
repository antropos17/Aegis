import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { buildCorpusResults } = require('../../../bench/lib/corpus-results');
const { renderCorpusTable } = require('../../../bench/lib/corpus-table');
const producer = require('../../../bench/lib/scenario-provenance');
const runner = require('../../../bench/run');
const actor = require('../../../bench/lib/actor');
const childProcess = require('node:child_process');
const scenarioId = 'S3-ordinary-fixture';
const scenarioFile = path.resolve('bench/scenarios', scenarioId, 'scenario.json');
const directories = [];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
let serial = 0;
function directory() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-provenance-'));
  directories.push(dir);
  return dir;
}
function collect(opts) {
  const file = require.resolve('../../../bench/lib/manifest'),
    previous = require.cache[file];
  const exec = vi.spyOn(childProcess, 'execFileSync').mockImplementation(() => {
    throw new Error('private-probe-sentinel');
  });
  try {
    delete require.cache[file];
    return require(file).collect(opts);
  } finally {
    if (previous) require.cache[file] = previous;
    else delete require.cache[file];
    exec.mockRestore();
  }
}
function writeManifest(item) {
  fs.writeFileSync(path.join(item.dir, 'manifest.json'), JSON.stringify(item.manifest));
}
function sample({ bytes = fs.readFileSync(scenarioFile), state = 'pending' } = {}) {
  const dir = directory(),
    source = path.join(dir, 'owned-definition.json');
  fs.writeFileSync(source, bytes);
  const scenario = producer.load(source);
  actor.validateScenario(scenario);
  actor.validateSteps(scenario);
  producer.seal(scenario);
  const runId = `provenance-${serial++}`;
  const manifest = collect({
    runId,
    scenario: scenarioId,
    arm: 'C',
    startedAt: '2026-10-24T00:00:00.000Z',
    preparedScenario: scenario,
  });
  if (state === 'changed') fs.appendFileSync(source, '\r\n');
  if (state === 'unavailable') fs.unlinkSync(source);
  if (state !== 'pending') manifest.scenarioProvenance = producer.finish(scenario);
  const item = { dir, source, bytes, scenario, runId, manifest };
  writeManifest(item);
  return item;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of directories.splice(0)) {
    expect(path.dirname(dir)).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(dir)).toMatch(/^corpus-provenance-/);
    expect(fs.lstatSync(dir).isSymbolicLink()).toBe(false);
    fs.rmSync(dir, { recursive: true });
  }
});

describe('producer-bound scenario provenance in corpus reports', () => {
  it('compares actual producer and actor artifacts with independently hashed current raw bytes', async () => {
    const item = sample({ state: 'unchanged' });
    const outcome = await actor.execute(item.scenario, { runDir: item.dir, runId: item.runId });
    runner.writeScenarioArtifacts({
      dir: item.dir,
      runId: item.runId,
      scenario: item.scenario,
      arm: 'C',
      outcome,
    });
    const report = buildCorpusResults([item.dir], '2026-10-24');
    expect(item.manifest.scenarioProvenance.loaded).toEqual({
      sha256: hash(item.bytes),
      byteLength: item.bytes.length,
    });
    expect(report.attempts[0]).toMatchObject({
      executedDefinitionMatch: 'match',
      artifactState: 'recorded',
      stepState: 'ok',
      scenarioProvenance: item.manifest.scenarioProvenance,
    });
    expect(report.inventory.find((row) => row.scenario === scenarioId)).toMatchObject({
      currentDefinitionSha256: hash(item.bytes),
      currentDefinitionBytes: item.bytes.length,
      currentStepCount: item.scenario.steps.length,
      executedDefinitionMatch: 'unverified',
    });
    expect(report).toMatchObject({
      sourceAuthenticated: false,
      measurementAccepted: false,
      w8Accepted: false,
      captureAssessment: 'not-assessed',
      oracleAdmission: 'not-performed',
      sensorScoring: 'not-performed',
    });
  });

  it('reports mismatch for whitespace-different loaded bytes with identical parsed meaning', () => {
    const current = fs.readFileSync(scenarioFile);
    const changedBytes = Buffer.concat([Buffer.from(' \r\n'), current, Buffer.from('\n')]);
    const item = sample({ bytes: changedBytes, state: 'unchanged' });
    expect(item.scenario).toEqual(JSON.parse(current));
    expect(item.manifest.scenarioProvenance.loaded).toEqual({
      sha256: hash(changedBytes),
      byteLength: changedBytes.length,
    });
    const report = buildCorpusResults([item.dir], '2026-10-24');
    expect(report.attempts[0]).toMatchObject({
      executedDefinitionMatch: 'mismatch',
      scenarioProvenance: { final: { state: 'unchanged' } },
    });
    expect(report.inventory.find((row) => row.scenario === scenarioId)).toMatchObject({
      currentDefinitionSha256: hash(current),
      currentDefinitionBytes: current.length,
    });
  });

  it('compares byte length as well as the recorded loaded hash', () => {
    const item = sample();
    item.manifest.scenarioProvenance = structuredClone(item.manifest.scenarioProvenance);
    item.manifest.scenarioProvenance.loaded.byteLength++;
    writeManifest(item);
    expect(buildCorpusResults([item.dir], '2026-10-24').attempts[0].executedDefinitionMatch).toBe(
      'mismatch',
    );
  });

  it.each(['pending', 'unchanged', 'changed', 'unavailable'])(
    'preserves the actual %s endpoint separately from loaded-definition match',
    (state) => {
      const item = sample({ state });
      const report = buildCorpusResults([item.dir], '2026-10-24'),
        row = report.attempts[0];
      expect(row).toMatchObject({
        executedDefinitionMatch: 'match',
        artifactState: 'incomplete',
        scenarioProvenance: item.manifest.scenarioProvenance,
      });
      expect(row.scenarioProvenance.final.state).toBe(state);
      if (state === 'pending' || state === 'unavailable')
        expect(row.scenarioProvenance.final).toEqual({ state, sha256: null, byteLength: null });
      else {
        const endpoint = fs.readFileSync(item.source);
        expect(row.scenarioProvenance.final).toEqual({
          state,
          sha256: hash(endpoint),
          byteLength: endpoint.length,
        });
      }
      expect(renderCorpusTable(report)).toContain(`match / ${state}`);
    },
  );

  it.each(['null', 'absent'])('keeps historical %s provenance unverified', (kind) => {
    const item = sample();
    if (kind === 'null')
      item.manifest.scenarioProvenance = collect({
        runId: item.runId,
        scenario: scenarioId,
        arm: 'C',
        startedAt: item.manifest.startedAt,
      }).scenarioProvenance;
    else delete item.manifest.scenarioProvenance;
    writeManifest(item);
    expect(buildCorpusResults([item.dir], '2026-10-24').attempts[0]).toMatchObject({
      executedDefinitionMatch: 'unverified',
      scenarioProvenance: null,
    });
  });

  it('keeps mixed attempts independent within one current inventory entry', () => {
    const matching = sample(),
      legacy = sample(),
      mismatching = sample({
        bytes: Buffer.concat([fs.readFileSync(scenarioFile), Buffer.from('\n')]),
      });
    delete legacy.manifest.scenarioProvenance;
    writeManifest(legacy);
    const report = buildCorpusResults([mismatching.dir, legacy.dir, matching.dir], '2026-10-24');
    expect(
      Object.fromEntries(report.attempts.map((row) => [row.runId, row.executedDefinitionMatch])),
    ).toEqual({
      [matching.runId]: 'match',
      [legacy.runId]: 'unverified',
      [mismatching.runId]: 'mismatch',
    });
    expect(report.inventory.find((row) => row.scenario === scenarioId)).toMatchObject({
      suppliedAttempts: 3,
      executedDefinitionMatch: 'unverified',
    });
  });

  it.each([
    ['unknown key', (p) => Object.assign(p, { privatePath: 'X:\\private\\definition.json' })],
    ['unknown version', (p) => Object.assign(p, { version: 2 })],
    ['missing loaded evidence', (p) => Reflect.deleteProperty(p, 'loaded')],
    ['loaded extra key', (p) => Object.assign(p.loaded, { path: 'private' })],
    ['uppercase hash', (p) => Object.assign(p.loaded, { sha256: 'A'.repeat(64) })],
    ['short hash', (p) => Object.assign(p.loaded, { sha256: 'a'.repeat(63) })],
    ['zero bytes', (p) => Object.assign(p.loaded, { byteLength: 0 })],
    ['excess bytes', (p) => Object.assign(p.loaded, { byteLength: 65537 })],
    ['fractional bytes', (p) => Object.assign(p.loaded, { byteLength: 1.5 })],
    ['string bytes', (p) => Object.assign(p.loaded, { byteLength: '961' })],
    ['final extra key', (p) => Object.assign(p.final, { reason: 'private' })],
    ['unknown state', (p) => Object.assign(p.final, { state: 'success' })],
    ['pending with hash', (p) => Object.assign(p.final, { sha256: p.loaded.sha256 })],
    ['pending with size', (p) => Object.assign(p.final, { byteLength: p.loaded.byteLength })],
    ['unavailable with hash', (p) => Object.assign(p.final, { state: 'unavailable', ...p.loaded })],
    ['unchanged with null endpoint', (p) => Object.assign(p.final, { state: 'unchanged' })],
    [
      'unchanged with different hash',
      (p) => Object.assign(p.final, { state: 'unchanged', ...p.loaded, sha256: '0'.repeat(64) }),
    ],
    [
      'unchanged with different size',
      (p) =>
        Object.assign(p.final, {
          state: 'unchanged',
          ...p.loaded,
          byteLength: p.loaded.byteLength + 1,
        }),
    ],
    [
      'changed with equal endpoints',
      (p) => Object.assign(p.final, { state: 'changed', ...p.loaded }),
    ],
    ['changed with null endpoint', (p) => Object.assign(p.final, { state: 'changed' })],
    ['source authentication claim', (p) => Object.assign(p, { sourceAuthenticated: true })],
    ['measurement acceptance claim', (p) => Object.assign(p, { measurementAccepted: true })],
  ])('refuses malformed or inconsistent provenance: %s', (_name, mutate) => {
    const item = sample();
    item.manifest.scenarioProvenance = structuredClone(item.manifest.scenarioProvenance);
    mutate(item.manifest.scenarioProvenance);
    writeManifest(item);
    expect(() => buildCorpusResults([item.dir], '2026-10-24')).toThrow(/^corpus-input-invalid$/);
  });

  it('projects only bounded evidence fields and preserves public acceptance limits', () => {
    const item = sample({ state: 'changed' });
    item.manifest.host.privateNote = 'private-host-sentinel';
    item.manifest.sensor.privatePath = item.source;
    item.manifest.privateText = 'private-raw-sentinel';
    writeManifest(item);
    const report = buildCorpusResults([item.dir], '2026-10-24'),
      row = report.attempts[0];
    expect(row.scenarioProvenance).toEqual(item.manifest.scenarioProvenance);
    expect(Object.keys(row.scenarioProvenance).sort()).toEqual([
      'final',
      'loaded',
      'measurementAccepted',
      'sourceAuthenticated',
      'version',
    ]);
    const publicText = JSON.stringify(report) + renderCorpusTable(report);
    for (const privateValue of [
      item.dir,
      item.source,
      scenarioFile,
      'private-host-sentinel',
      'private-raw-sentinel',
      'private-probe-sentinel',
    ])
      expect(publicText).not.toContain(privateValue);
    expect(row.scenarioProvenance).toMatchObject({
      sourceAuthenticated: false,
      measurementAccepted: false,
    });
    expect(report).toMatchObject({
      sourceAuthenticated: false,
      measurementAccepted: false,
      w8Accepted: false,
    });
  });
});
