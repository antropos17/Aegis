'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { LIMITS, invalid, digest, ordinaryDirectory, parse, read } = require('./corpus-input');
const { summarize } = require('./corpus-artifacts');
const { renderCorpusTable } = require('./corpus-table');
const SCENARIOS = Object.freeze([
  'S3-ordinary-fixture',
  'S4-outside-project',
  'S5-disposable-deletion',
  'S6-inert-persistence',
  'S7-owned-loopback-transfer',
  'S8-owned-file-read',
]);
const ARTIFACTS = Object.freeze({
  manifest: 'manifest.json',
  steps: 'steps.json',
  expected: 'expected.ndjson',
  loopback: 'fixture-outcomes.json',
  read: 'file-read-outcomes.json',
});
const MODULES = Object.freeze([
  'bench/corpus-results.cjs',
  'bench/lib/corpus-results.js',
  'bench/lib/corpus-table.js',
  'bench/lib/corpus-input.js',
  'bench/lib/corpus-artifacts.js',
  'bench/lib/corpus-provenance.js',
  'bench/lib/corpus-outcomes.js',
  'bench/lib/fixture-outcomes.js',
  'bench/lib/loopback-receiver.js',
  'bench/lib/file-read-outcomes.js',
  'bench/lib/file-read-identity.js',
]);
const ROOT = path.resolve(__dirname, '../..');
const lexical = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function date(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d\d-\d\d$/.test(value) &&
    Number.isFinite(Date.parse(value + 'T00:00:00.000Z')) &&
    new Date(value + 'T00:00:00.000Z').toISOString().slice(0, 10) === value
  );
}
function expected(bytes) {
  if (bytes === null) return null;
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (rows.length >= LIMITS.events) invalid();
    rows.push(parse(Buffer.from(line)));
  }
  return rows;
}
/**
 * Summarize explicit recorded synthetic corpus directories without executing captures.
 * @param {string[]} runDirs Explicit run directories.
 * @param {string} asOf Report label date.
 * @returns {object} Sanitized descriptive report.
 * @since unreleased
 */
function buildCorpusResults(runDirs, asOf) {
  try {
    if (!Array.isArray(runDirs) || !runDirs.length || runDirs.length > LIMITS.runs || !date(asOf))
      invalid();
    const budget = { bytes: 0 },
      seen = new Set(),
      attempts = [];
    for (const provided of runDirs) {
      const dir = ordinaryDirectory(provided),
        data = {},
        hashes = [];
      for (const [key, filename] of Object.entries(ARTIFACTS)) {
        const bytes = read(path.join(dir, filename), budget, key !== 'manifest');
        data[key] = key === 'expected' ? expected(bytes) : bytes === null ? null : parse(bytes);
        if (bytes !== null)
          hashes.push({ artifact: filename, bytes: bytes.length, sha256: digest(bytes) });
      }
      const row = summarize(data, SCENARIOS);
      if (seen.has(row.runId)) invalid();
      seen.add(row.runId);
      attempts.push({ ...row, artifacts: hashes });
    }
    attempts.sort(
      (a, b) =>
        lexical(a.scenario, b.scenario) || lexical(a.runId, b.runId) || lexical(a.arm, b.arm),
    );
    const inventory = SCENARIOS.map((scenario) => {
      const file = path.join(ROOT, 'bench', 'scenarios', scenario, 'scenario.json');
      ordinaryDirectory(path.dirname(file));
      const bytes = read(file, budget),
        definition = parse(bytes);
      if (
        definition.schemaVersion !== 1 ||
        definition.id !== scenario ||
        !Array.isArray(definition.steps) ||
        !definition.steps.length ||
        definition.steps.length > LIMITS.steps
      )
        invalid();
      const suppliedAttempts = attempts.filter((row) => row.scenario === scenario).length;
      return {
        scenario,
        currentDefinitionSha256: digest(bytes),
        currentDefinitionBytes: bytes.length,
        currentStepCount: definition.steps.length,
        suppliedAttempts,
        status: suppliedAttempts ? 'supplied' : 'pending',
        executedDefinitionMatch: 'unverified',
      };
    });
    for (const attempt of attempts) {
      const loaded = attempt.scenarioProvenance?.loaded;
      if (!loaded) continue;
      const current = inventory.find((row) => row.scenario === attempt.scenario);
      attempt.executedDefinitionMatch =
        loaded.sha256 === current.currentDefinitionSha256 &&
        loaded.byteLength === current.currentDefinitionBytes
          ? 'match'
          : 'mismatch';
    }
    const files = MODULES.map((file) => {
      const absolute = path.join(ROOT, file);
      ordinaryDirectory(path.dirname(absolute));
      return { file, sha256: digest(read(absolute, budget)) };
    });
    return {
      schema: 'corpus-results',
      schemaVersion: 1,
      scope: 'synthetic-corpus-results',
      asOf,
      reportImplementation: {
        algorithm: 'sha256',
        basis: 'repository-disk-bytes-read-during-report',
        files,
        nodeVersion: process.version,
      },
      captureAssessment: 'not-assessed',
      oracleAdmission: 'not-performed',
      sensorScoring: 'not-performed',
      attackMapping: 'not-performed',
      sourceAuthenticated: false,
      measurementAccepted: false,
      w8Accepted: false,
      artifactInputBytes: attempts.reduce(
        (total, row) => total + row.artifacts.reduce((n, item) => n + item.bytes, 0),
        0,
      ),
      inventory,
      attempts,
    };
  } catch {
    invalid();
  }
}
/**
 * Validate inputs before exclusively creating a fresh bounded JSON/Markdown bundle.
 * @param {string[]} runDirs Explicit input directories.
 * @param {string} asOf Report label date.
 * @param {string} outDir Fresh output directory.
 * @returns {object} Written sanitized report.
 * @since unreleased
 */
function writeCorpusResults(runDirs, asOf, outDir) {
  const report = buildCorpusResults(runDirs, asOf),
    json = JSON.stringify(report, null, 2) + '\n',
    markdown = renderCorpusTable(report);
  if (
    Buffer.byteLength(json) > LIMITS.outputBytes ||
    Buffer.byteLength(markdown) > LIMITS.outputBytes
  )
    invalid();
  let created = false;
  try {
    if (
      typeof outDir !== 'string' ||
      !outDir ||
      outDir.length > 1024 ||
      outDir.includes('\0') ||
      /^[/\\]{2}/.test(outDir)
    )
      throw new Error();
    const dir = path.resolve(outDir);
    if (path.basename(dir).includes(':') || dir === path.dirname(dir)) throw new Error();
    ordinaryDirectory(path.dirname(dir));
    fs.mkdirSync(dir);
    created = true;
    for (const [file, content] of [
      ['corpus-results.json', json],
      ['corpus-results.md', markdown],
    ]) {
      const fd = fs.openSync(
        path.join(dir, file),
        fs.constants.O_WRONLY |
          fs.constants.O_CREAT |
          fs.constants.O_EXCL |
          (fs.constants.O_NOFOLLOW || 0),
        0o600,
      );
      try {
        fs.writeFileSync(fd, content);
      } finally {
        fs.closeSync(fd);
      }
    }
    return report;
  } catch {
    throw new Error(created ? 'corpus-output-partial' : 'corpus-output-refused');
  }
}
module.exports = { buildCorpusResults, writeCorpusResults, LIMITS, SCENARIOS };
