// Synthetic caller-defined CSV fixtures; no installed Procmon produced these.
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { importCsv } = require('../../../bench/lib/oracles/procmon.js');
const { LIMITS } = require('../../../bench/lib/oracles/procmon-csv.js');
const headers = ['Time of Day', 'Process Name', 'PID', 'Operation', 'Path', 'Result', 'Detail'];
const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
const sourcePath = 'C:\\Users\\private\\secret,canary.txt';
const makeCsv = (rows, columns = headers) =>
  Buffer.from(
    '\uFEFF' + [columns, ...rows].map((row) => row.map(quote).join(',')).join('\r\n') + '\r\n',
  );
const row = (overrides = {}) =>
  Object.values({
    time: '12:00:01.1234567',
    name: 'private-agent.exe',
    pid: '42',
    operation: 'ReadFile',
    path: sourcePath,
    result: 'SUCCESS',
    detail: 'Offset: 0, Length: 1,024, note: "secret"\r\nprivate prompt',
    ...overrides,
  });
function receipt(csv, overrides = {}) {
  return Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      profile: { id: 'procmon-csv-read-v1', columns: headers, timestampFormat: 'HH:mm:ss.fffffff' },
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
        machine: 'fixture-host',
        os: 'fixture-windows',
        agentVersions: 'synthetic-agent-v1',
        sensorMode: 'fixture',
        method: 'offline-import',
        procmonVersion: { value: null, unavailable: 'synthetic-fixture' },
        configSha256: { value: null, unavailable: 'synthetic-fixture' },
      },
      pathMappings: [{ sourcePath, fixtureId: 'canary-1' }],
      loss: null,
      completeness: null,
      ...overrides,
    }),
  );
}

describe('Procmon offline staging', () => {
  it('refuses different valid source paths sharing one valid string fixture ID', () => {
    const csv = makeCsv([row()]);
    const pathMappings = [
      { sourcePath, fixtureId: 'canary-1' },
      { sourcePath: 'C:\\other.txt', fixtureId: 'canary-1' },
    ];
    expect(() => importCsv(csv, receipt(csv, { pathMappings }))).toThrow(/duplicate path mapping/i);
  });
  it('accepts the exact inclusive UTC window endpoints', () => {
    const csv = makeCsv([row({ time: '12:00:00.0000000' }), row({ time: '12:10:00.0000000' })]);
    const output = importCsv(csv, receipt(csv));
    expect(output.events.map((event) => event.timestamp)).toEqual([
      '2026-10-24T12:00:00.0000000Z',
      '2026-10-24T12:10:00.0000000Z',
    ]);
    expect(output.accounting.accepted).toBe(2);
    expect(output.accounting.outsideWindow).toBe(0);
  });
  it('accepts declared non-null version facts for unvalidated exports and refuses malformed config digests', () => {
    const csv = makeCsv([row()]);
    const facts = JSON.parse(receipt(csv).toString());
    facts.evidenceLabel = 'unvalidated-export';
    facts.provenance.procmonVersion = { value: '4.01' };
    facts.provenance.configSha256 = { value: 'a'.repeat(64) };
    const output = importCsv(csv, Buffer.from(JSON.stringify(facts)));
    expect(output.binding.evidenceLabel).toBe('unvalidated-export');
    expect(output.provenance.procmonVersion).toEqual({ value: '4.01' });
    expect(output.provenance.configSha256).toEqual({ value: 'a'.repeat(64) });
    expect(output.captureQualified).toBe(false);
    expect(output.exportProfileQualified).toBe(false);
    for (const value of ['A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64)]) {
      facts.provenance.configSha256 = { value };
      expect(() => importCsv(csv, Buffer.from(JSON.stringify(facts)))).toThrow(/version fact/i);
    }
  });
  it.each([
    ['outsideWindow', { time: '12:20:00.0000000', operation: 'WriteFile' }],
    ['unsupported', { operation: 'WriteFile', result: 'ACCESS DENIED' }],
    ['unsuccessful', { result: 'ACCESS DENIED', detail: 'Length: invalid' }],
    ['invalidLength', { detail: 'Length: invalid', path: 'C:\\unmapped.txt' }],
    ['zeroLength', { detail: 'Length: 0', path: 'C:\\unmapped.txt' }],
  ])(
    'accounts combined conditions only under %s according to precedence',
    (category, overrides) => {
      const csv = makeCsv([row(overrides)]);
      const output = importCsv(csv, receipt(csv));
      expect(output.events).toEqual([]);
      expect(output.accounting).toEqual({
        rows: 1,
        accepted: 0,
        unsupported: 0,
        unsuccessful: 0,
        zeroLength: 0,
        outsideWindow: 0,
        unmapped: 0,
        invalidLength: 0,
        [category]: 1,
      });
    },
  );
  it('emits explicit importer-owned qualification and scoring facts', () => {
    const csv = makeCsv([row()]);
    const output = importCsv(csv, receipt(csv));
    expect(output).toMatchObject({
      oracle: 'procmon',
      acquisition: 'offline-import',
      captureQualified: false,
      exportProfileQualified: false,
      catalogueConfirmed: false,
      sensorScored: false,
      admittedToScoring: false,
    });
    expect(Object.isFrozen(output)).toBe(true);
  });
  it('permits A/B oracle staging and refuses sensor-alone arm C', () => {
    const csv = makeCsv([row()]);
    expect(() => importCsv(csv, receipt(csv, { arm: 'C' }))).toThrow(/arm/i);
    for (const arm of ['A', 'B'])
      expect(importCsv(csv, receipt(csv, { arm })).binding.arm).toBe(arm);
  });
  it('limits evidence labels to synthetic or unvalidated-export', () => {
    const csv = makeCsv([row()]);
    expect(() => importCsv(csv, receipt(csv, { evidenceLabel: 'qualified' }))).toThrow(/evidence/i);
    for (const evidenceLabel of ['synthetic', 'unvalidated-export']) {
      expect(importCsv(csv, receipt(csv, { evidenceLabel })).binding.evidenceLabel).toBe(
        evidenceLabel,
      );
    }
  });
  it('refuses coerced fixture IDs, including distinct arrays on different paths', () => {
    const csv = makeCsv([row()]);
    const mappings = [
      [{ sourcePath, fixtureId: true }],
      [{ sourcePath, fixtureId: false }],
      [{ sourcePath, fixtureId: ['canary-1'] }],
      [{ sourcePath, fixtureId: [] }],
      [
        { sourcePath, fixtureId: ['canary-1'] },
        { sourcePath: 'C:\\other.txt', fixtureId: ['canary-1'] },
      ],
    ];
    for (const pathMappings of mappings) {
      expect(() => importCsv(csv, receipt(csv, { pathMappings }))).toThrow(/mapping/i);
    }
  });
  it('parses the declared quoted BOM/CRLF profile without retaining sensitive fields', () => {
    const csv = makeCsv([row()]);
    const output = importCsv(csv, receipt(csv));
    expect(output.events).toHaveLength(1);
    expect(output.events[0]).toMatchObject({
      operation: 'ReadFile',
      result: 'SUCCESS',
      pid: 42,
      fixtureId: 'canary-1',
      length: 1024,
      timestamp: '2026-10-24T12:00:01.1234567Z',
      row: 1,
    });
    expect(JSON.stringify(output)).not.toMatch(/private|prompt|secret|Offset:|agent\.exe/);
  });
  it('refuses receipts that do not bind these exact CSV bytes', () => {
    const csv = makeCsv([row()]);
    expect(() => importCsv(csv, receipt(csv, { csvSha256: '0'.repeat(64) }))).toThrow(/digest/i);
  });
  it('refuses duplicate JSON receipt properties, including escaped property aliases', () => {
    const csv = makeCsv([row()]);
    const original = receipt(csv).toString();
    const duplicate = original.replace(
      '"runId":"run-1"',
      '"runId":"other-run","run\\u0049d":"run-1"',
    );
    expect(() => importCsv(csv, Buffer.from(duplicate))).toThrow(/duplicate/i);
  });
  it('accounts for unsupported, failed, zero-length, out-of-window and unmapped rows', () => {
    const csv = makeCsv([
      row(),
      row({ operation: 'CreateFile' }),
      row({ operation: 'SetDispositionInformationFile' }),
      row({ operation: 'WriteFile' }),
      row({ operation: 'Process Create' }),
      row({ operation: 'Process Exit' }),
      row({ result: 'ACCESS DENIED' }),
      row({ detail: 'Length: 0' }),
      row({ time: '12:20:00.0000000' }),
      row({ path: 'C:\\other.txt' }),
      row({ detail: 'Length: 9007199254740992' }),
    ]);
    const output = importCsv(csv, receipt(csv));
    expect(output.events).toHaveLength(1);
    expect(output.accounting).toEqual({
      rows: 11,
      accepted: 1,
      unsupported: 5,
      unsuccessful: 1,
      zeroLength: 1,
      outsideWindow: 1,
      unmapped: 1,
      invalidLength: 1,
    });
    expect(output.loss).toBeNull();
    expect(output.completeness).toBeNull();
    expect(output.events[0].binding).toEqual(output.binding);
    expect(output.input.csvSha256).toBe(crypto.createHash('sha256').update(csv).digest('hex'));
    expect(output.events[0].path).toBe('fixture:canary-1');
  });
  it('does not accept a valid Length when another malformed Length makes Detail ambiguous', () => {
    const csv = makeCsv([row({ detail: 'Length: 1, Length: unknown' })]);
    expect(importCsv(csv, receipt(csv)).accounting.invalidLength).toBe(1);
  });
  it.each([
    ['duplicate header', makeCsv([row()], [...headers.slice(0, 6), 'PID'])],
    ['missing header', makeCsv([row()], headers.slice(0, 6))],
    ['extra header', makeCsv([row()], [...headers, 'Command Line'])],
    ['NUL', makeCsv([row({ name: 'bad\0value' })])],
    ['unclosed quote', Buffer.from(headers.map(quote).join(',') + '\n"unclosed')],
    ['quote in plain field', Buffer.from(headers.join(',') + '\n12"bad,foo,1,x,y,z,d')],
    ['text after closing quote', Buffer.from(headers.join(',') + '\n"time"bad,foo,1,x,y,z,d')],
    ['invalid UTF8', Buffer.from([0xc3, 0x28])],
  ])('refuses %s', (_label, csv) => {
    expect(() => importCsv(csv, receipt(csv))).toThrow();
  });
  it.each([
    ['CSV bytes', () => Buffer.alloc(LIMITS.csvBytes + 1, 32)],
    ['cell characters', () => makeCsv([row({ detail: 'x'.repeat(LIMITS.cellChars + 1) })])],
    [
      'rows',
      () => makeCsv(Array.from({ length: LIMITS.rows + 1 }, () => row({ detail: 'Length: 1' }))),
    ],
  ])('refuses oversized %s', (_label, create) => {
    const csv = create();
    expect(() => importCsv(csv, receipt(csv))).toThrow(/limit/i);
  });
  it('refuses oversized receipt before JSON parsing', () => {
    const csv = makeCsv([row()]);
    expect(() => importCsv(csv, Buffer.alloc(LIMITS.receiptBytes + 1, 32))).toThrow(/limit/i);
  });
  it('refuses bounded CSV whose expanded per-event receipt bindings exceed the staging limit', () => {
    const csv = makeCsv(Array.from({ length: LIMITS.rows }, () => row({ detail: 'Length: 1' })));
    expect(csv.length).toBeLessThan(LIMITS.csvBytes);
    expect(() => importCsv(csv, receipt(csv, { runId: 'r'.repeat(128) }))).toThrow(
      /Output byte limit/,
    );
  });
  it('accepts the uint32 PID endpoints', () => {
    const csv = makeCsv([row({ pid: '1' }), row({ pid: '4294967295' })]);
    expect(importCsv(csv, receipt(csv)).events.map((event) => event.pid)).toEqual([1, 4294967295]);
  });
  it.each(['4294967296', '9007199254740992', '-1', '0', '1.5', '1e3'])(
    'refuses unsafe PID %s',
    (pid) => {
      const csv = makeCsv([row({ pid })]);
      expect(() => importCsv(csv, receipt(csv))).toThrow(/PID/);
    },
  );
  it.each(['12:00:01', '12:00:01.123', '12:00:01 PM', '24:00:00.0000000', '12:60:00.0000000'])(
    'refuses ambiguous timestamp %s',
    (time) => {
      const csv = makeCsv([row({ time })]);
      expect(() => importCsv(csv, receipt(csv))).toThrow(/timestamp/i);
    },
  );
  it('uses the fixed offset and retains submillisecond window precision', () => {
    const csv = makeCsv([row({ time: '16:00:01.1234567' }), row({ time: '16:10:00.0000001' })]);
    const output = importCsv(
      csv,
      receipt(csv, { timestampBasis: { date: '2026-10-24', utcOffset: '+04:00' } }),
    );
    expect(output.events[0].timestamp).toBe('2026-10-24T12:00:01.1234567Z');
    expect(output.accounting.outsideWindow).toBe(1);
  });
  it.each([
    { schemaVersion: 2 },
    { arm: 'Z' },
    { captureId: '' },
    { unexpected: true },
    { profile: { id: 'automatic-locale-detection' } },
    { timestampBasis: { date: '2026-02-30', utcOffset: '+00:00' } },
    { timestampBasis: { date: '2026-10-24', utcOffset: '-00:00' } },
    { timestampBasis: { date: '2026-10-24', utcOffset: 'local' } },
    { window: { start: '2026-10-24T12:00:00Z', end: '2026-10-24T12:10:00.000Z' } },
    { window: { start: '2026-10-24T12:00:00.000Z', end: '2026-10-25T00:00:00.000Z' } },
    { window: { start: '2026-10-24T12:10:00.000Z', end: '2026-10-24T12:00:00.000Z' } },
    { loss: 0 },
    { completeness: true },
    { pathMappings: [] },
    { pathMappings: [{ sourcePath, fixtureId: '../secret' }] },
    {
      pathMappings: [
        { sourcePath, fixtureId: 'one' },
        { sourcePath, fixtureId: 'two' },
      ],
    },
    {
      pathMappings: Array.from({ length: LIMITS.mappings + 1 }, (_, i) => ({
        sourcePath: `C:\\${i}`,
        fixtureId: `f-${i}`,
      })),
    },
  ])('refuses malformed or unsupported receipt %#', (override) => {
    const csv = makeCsv([row()]);
    expect(() => importCsv(csv, receipt(csv, override))).toThrow();
  });
  it.each([
    'Length: -1',
    'Length: 1.5',
    'Length: 1,23',
    'Length: 9007199254740992',
    'Length: 1, Length: 2',
    'Offset: 0',
  ])('accounts for invalid Detail %s', (detail) => {
    const csv = makeCsv([row({ detail })]);
    const output = importCsv(csv, receipt(csv));
    expect(output.events).toEqual([]);
    expect(output.accounting.invalidLength).toBe(1);
  });
});

export { makeCsv, row, receipt, headers };
