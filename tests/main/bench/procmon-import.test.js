// Synthetic CSV only: these are offline CLI contract tests.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { importCsv } = require('../../../bench/lib/oracles/procmon.js');
const { HEADERS } = require('../../../bench/lib/oracles/procmon-csv.js');
const root = path.resolve(import.meta.dirname, '../../..');
const directories = [];
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true });
});
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'procmon-import-'));
  directories.push(directory);
  const csv = Buffer.from(
    HEADERS.join(',') +
      '\n12:00:01.0000000,private.exe,42,ReadFile,C:\\private.txt,SUCCESS,Length: 1\n',
  );
  const receipt = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      profile: { id: 'procmon-csv-read-v1', columns: HEADERS, timestampFormat: 'HH:mm:ss.fffffff' },
      runId: 'run-1',
      scenario: 'S-read',
      arm: 'A',
      captureId: 'capture-1',
      evidenceLabel: 'synthetic',
      csvSha256: crypto.createHash('sha256').update(csv).digest('hex'),
      timestampBasis: { date: '2026-10-24', utcOffset: '+00:00' },
      window: { start: '2026-10-24T12:00:00.000Z', end: '2026-10-24T12:10:00.000Z' },
      provenance: {
        commit: 'a'.repeat(40),
        machine: 'fixture',
        os: 'fixture',
        agentVersions: 'synthetic',
        sensorMode: 'fixture',
        method: 'offline-import',
        procmonVersion: { value: null, unavailable: 'synthetic' },
        configSha256: { value: null, unavailable: 'synthetic' },
      },
      pathMappings: [{ sourcePath: 'C:\\private.txt', fixtureId: 'canary-1' }],
      loss: null,
      completeness: null,
    }),
  );
  const csvFile = path.join(directory, 'input.csv'),
    receiptFile = path.join(directory, 'receipt.json'),
    outputFile = path.join(directory, 'staging.json');
  fs.writeFileSync(csvFile, csv);
  fs.writeFileSync(receiptFile, receipt);
  return { csv, receipt, csvFile, receiptFile, outputFile, directory };
}
function invoke(args) {
  return spawnSync(process.execPath, ['bench/procmon-import.cjs', ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 8192,
  });
}
const argumentsFor = (item) => [
  '--csv',
  item.csvFile,
  '--receipt',
  item.receiptFile,
  '--out',
  item.outputFile,
];

describe('offline Procmon CLI', () => {
  it('writes exactly one deterministic bounded staging JSON object', () => {
    const item = fixture();
    const result = invoke(argumentsFor(item));
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('Procmon offline staging written; not admitted to scoring.\n');
    expect(fs.readFileSync(item.outputFile, 'utf8')).toBe(
      JSON.stringify(importCsv(item.csv, item.receipt)) + '\n',
    );
  });
  it('refuses an existing output and preserves its bytes', () => {
    const item = fixture();
    fs.writeFileSync(item.outputFile, 'preserved receipt\n');
    const result = invoke(argumentsFor(item));
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('Procmon import refused: EEXIST\n');
    expect(fs.readFileSync(item.outputFile, 'utf8')).toBe('preserved receipt\n');
  });
  it('refuses malformed private input without copying parser snippets to diagnostics', () => {
    const item = fixture();
    fs.writeFileSync(item.receiptFile, '{"private prompt": secret');
    const result = invoke(argumentsFor(item));
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('Procmon import refused: Malformed JSON\n');
    expect(fs.existsSync(item.outputFile)).toBe(false);
  });
  it('refuses an oversized input without creating output', () => {
    const item = fixture();
    fs.writeFileSync(item.csvFile, Buffer.alloc(1048577, 32));
    const result = invoke(argumentsFor(item));
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Input byte limit/);
    expect(fs.existsSync(item.outputFile)).toBe(false);
  });
  it('refuses oracle NDJSON naming and duplicate/unknown arguments', () => {
    const item = fixture();
    for (const args of [
      [],
      ['--csv', item.csvFile, '--csv', item.csvFile, '--out', item.outputFile],
      ['--csv', item.csvFile, '--unknown', item.receiptFile, '--out', item.outputFile],
      [
        '--csv',
        item.csvFile,
        '--receipt',
        item.receiptFile,
        '--out',
        path.join(item.directory, 'oracle-procmon.ndjson'),
      ],
    ]) {
      expect(invoke(args).status).toBe(1);
      expect(fs.existsSync(item.outputFile)).toBe(false);
    }
  });
});
