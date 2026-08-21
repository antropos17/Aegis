/**
 * @file tests/shared/bench-trace/_make-trace.js
 * @description Builders for the bench-trace suites.
 *
 *   The environment these produce is SYNTHETIC on purpose. A refusal suite that
 *   compared a header against the machine it happens to run on would pass for a
 *   different reason on every machine, and would go red on a rules edit that has
 *   nothing to do with the refusal being pinned. One suite observes the real tree,
 *   and it asserts shape and stability rather than values.
 *
 *   Not named `*.test.js`, so vitest does not collect it.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import schema from '../../../bench/trace/schema.js';
import writer from '../../../bench/trace/writer.js';

/** @type {number} An arbitrary but fixed instant every builder here starts from. */
export const CLOCK_EPOCH_MS = 1_755_766_432_000;

/**
 * A synthetic environment in the exact shape `schema.observeEnvironment` returns.
 * @param {Object} [overrides] - Shallow-merged over the result.
 * @returns {Object}
 */
export function makeEnv(overrides = {}) {
  return {
    platform: 'win32',
    pathSep: '\\',
    nodeVersion: 'v22.11.0',
    tz: { name: 'Etc/UTC', offsetMinutesAt: 0, offsetReadAtEpochMs: CLOCK_EPOCH_MS },
    digests: {
      algorithm: 'sha256',
      normalization: 'CRLF and lone CR are folded to LF before hashing',
      rules: {
        loadOrder: ['ai-config.yaml', 'secrets.yaml'],
        files: { 'ai-config.yaml': 'a'.repeat(64), 'secrets.yaml': 'b'.repeat(64) },
        schemaFile: 'c'.repeat(64),
        compiled: 'd'.repeat(64),
      },
      agentDatabase: { version: '2.1.0', lastUpdated: '2026-08-01', sha256: 'e'.repeat(64) },
      sources: {
        'src/main/attribution.js': 'f'.repeat(64),
        'src/shared/constants.js': '0'.repeat(64),
        'src/main/platform/win32.js': '1'.repeat(64),
      },
      evidenceCodes: [
        'rm-holder-pid',
        'handle-scan-pid',
        'os-tcp-owner-pid',
        'self-config-path',
        'cwd-containment',
        'no-owner-match',
        'no-ai-agents-online',
        'population-unavailable',
      ],
    },
    ...overrides,
  };
}

/** @returns {Object} Every scope key this version requires, answered as absent. */
export function makeScope() {
  return {
    processTicks: { value: null, unavailable: 'scan-loop.doProcessScan is not exported' },
    anomalyAlerts: { value: null, unavailable: 'out-of-scope-phase-1' },
    rmFullPath: { value: null, unavailable: 'the getSensitiveHolders injection is one-way' },
  };
}

/**
 * A header that {@link makeEnv}'s environment accepts.
 * @param {Object} [opts]
 * @param {Object} [opts.env] - The environment to agree with.
 * @param {string} [opts.id] - Trace id.
 * @param {Object} [opts.overrides] - Shallow-merged over the header.
 * @returns {Object}
 */
export function makeHeader(opts = {}) {
  const env = opts.env || makeEnv();
  return {
    ...writer.buildHeader({
      id: opts.id || 'T0-synthetic',
      clockEpochMs: CLOCK_EPOCH_MS,
      scope: makeScope(),
      env,
    }),
    ...(opts.overrides || {}),
  };
}

/**
 * One agent population entry, in the shape `population.set` declares.
 * @param {Object} [overrides]
 * @returns {Object}
 */
export function makeAgent(overrides = {}) {
  return {
    agent: 'Claude Code',
    pid: 4812,
    process: 'claude.exe',
    instanceId: '4812:1755766432000',
    cwd: 'X:\\dev\\project\\AEGIS',
    category: 'ai',
    parentEditor: null,
    ...overrides,
  };
}

/** @returns {{populationReliable: boolean, isOtherPanelExpanded: boolean}} */
export function makeAmbient(overrides = {}) {
  return { populationReliable: true, isOtherPanelExpanded: false, ...overrides };
}

/**
 * Build and chain a small, valid record list: a population snapshot, one filesystem
 * event, a clock advance, and a second filesystem event.
 * @param {Object} [opts]
 * @param {string} [opts.trace] - Trace id the records name.
 * @returns {Object[]} Chained records.
 */
export function makeRecords(opts = {}) {
  const trace = opts.trace || 'T0-synthetic';
  const unchained = [
    writer.buildRecord({
      trace,
      seq: 0,
      kind: 'population.set',
      epochMs: CLOCK_EPOCH_MS,
      input: { agents: [makeAgent()] },
    }),
    writer.buildRecord({
      trace,
      seq: 1,
      kind: 'fs.event',
      epochMs: CLOCK_EPOCH_MS + 10,
      input: { action: 'created', path: 'X:\\dev\\project\\AEGIS\\.env' },
      ambient: makeAmbient(),
    }),
    writer.buildRecord({
      trace,
      seq: 2,
      kind: 'clock.advance',
      epochMs: CLOCK_EPOCH_MS + 10,
      input: { toEpochMs: CLOCK_EPOCH_MS + 31_000 },
    }),
    writer.buildRecord({
      trace,
      seq: 3,
      kind: 'fs.event',
      epochMs: CLOCK_EPOCH_MS + 31_000,
      input: { action: 'deleted', path: 'X:\\dev\\project\\AEGIS\\.env' },
      ambient: makeAmbient({ populationReliable: false }),
    }),
  ];
  return writer.chainRecords(unchained);
}

/**
 * Write a trace directory WITHOUT going through `writer.writeTrace`, so a suite can
 * lay down deliberately damaged bytes that the writer would refuse to produce.
 * @param {Object} [opts]
 * @param {Object} [opts.header] - Header object; `makeHeader()` when absent.
 * @param {Object[]} [opts.records] - Chained records; `makeRecords()` when absent.
 * @param {string} [opts.traceText] - Raw `trace.ndjson` bytes, overriding `records`.
 * @param {string} [opts.headerText] - Raw `trace.header.json` bytes, overriding `header`.
 * @returns {string} The directory path. Caller removes it.
 */
export function writeTraceDir(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-trace-test-'));
  const header = opts.header || makeHeader();
  const records = opts.records || makeRecords();
  fs.writeFileSync(
    path.join(dir, schema.HEADER_FILENAME),
    opts.headerText !== undefined ? opts.headerText : writer.serializeHeader(header),
    'utf8',
  );
  fs.writeFileSync(
    path.join(dir, schema.TRACE_FILENAME),
    opts.traceText !== undefined ? opts.traceText : writer.serializeTrace(records),
    'utf8',
  );
  return dir;
}

/**
 * Replace one line of a serialized trace, leaving every other byte alone.
 * @param {Object[]} records - Chained records.
 * @param {number} index - 0-based line to replace.
 * @param {Object} replacement - The object to write in its place.
 * @returns {string} The new `trace.ndjson` bytes.
 */
export function traceTextWithLineReplaced(records, index, replacement) {
  const lines = records.map((r) => JSON.stringify(r));
  lines[index] = JSON.stringify(replacement);
  return lines.join('\n') + '\n';
}
