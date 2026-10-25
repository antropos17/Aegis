// Synthetic raw records: no audit daemon, host instrumentation or native evidence.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { importRaw } = require('../../../bench/lib/oracles/auditd');
const { LIMITS, parseRecords } = require('../../../bench/lib/oracles/auditd-records');
const line = (type, payload = '', id = '1750000000.123:42', node = null) =>
  `${node === null ? '' : `node=${node} `}type=${type} msg=audit(${id}):${payload ? ` ${payload}` : ''}\n`;
const stage = (...lines) => importRaw(Buffer.from(lines.join('')));

describe('bounded offline auditd compound-event framing', () => {
  it('assembles interleaved events by exact timestamp and serial, preserving input order', () => {
    const result = stage(
      line('SYSCALL', 'pid=41 success=yes'),
      line('SYSCALL', 'pid=42 success=no', '1750000000.123:43'),
      line('PATH', 'item=0 name="/private one"'),
      line('PROCTITLE', 'proctitle=736563726574', '1750000000.123:43'),
      line('CWD', 'cwd=2F70726976617465'),
      line('PROCTITLE', 'proctitle=736563726574'),
    );
    expect(result.accounting).toEqual({
      records: 6,
      events: 2,
      explicitlyTerminated: 2,
      withoutTerminal: 0,
      unsupportedRecordTypes: 0,
    });
    expect(result.events.map((event) => event.records.map((record) => record.line))).toEqual([
      [1, 3, 5, 6],
      [2, 4],
    ]);
    expect(JSON.stringify(result)).not.toMatch(/private|736563726574|success=yes|pid=41/);
    expect(result).toMatchObject({
      captureQualified: false,
      fieldsNormalized: false,
      catalogueConfirmed: false,
      sensorScored: false,
      admittedToScoring: false,
      loss: null,
      completeness: null,
    });
  });

  it('does not conflate timestamps or hosts, or invent process birth identity', () => {
    const result = stage(
      line('PATH', 'name=2F61'),
      line('PATH', 'name=2F62', '1750000000.124:42'),
      line('PATH', 'name=2F63', '1750000000.123:42', 'host-one'),
      line('PATH', 'name=2F64', '1750000000.123:42', 'host-two'),
    );
    expect(result.accounting.events).toBe(4);
    expect(result.events[0].nodeSha256).toBeNull();
    expect(result.events[2].nodeSha256).not.toBe(result.events[3].nodeSha256);
    expect(JSON.stringify(result)).not.toMatch(/instanceId|host-one|host-two/);
  });

  it('retains an unfinished event and unknown types without implying collection completeness', () => {
    const result = stage(line('SYSCALL', 'success=yes items=1'), line('9999', 'opaque=data'));
    expect(result.accounting).toMatchObject({
      explicitlyTerminated: 0,
      withoutTerminal: 1,
      unsupportedRecordTypes: 1,
    });
    expect(result.events[0].records.map((record) => record.type)).toEqual(['SYSCALL', '9999']);
    expect(result.completeness).toBeNull();
    expect(stage().accounting.events).toBe(0);
  });

  it('recognizes explicit EOE and optional EOE after PROCTITLE', () => {
    expect(stage(line('SYSCALL'), line('EOE')).events[0].terminal).toBe('EOE');
    expect(stage(line('SYSCALL'), line('PROCTITLE'), line('EOE')).events[0].terminal).toBe('EOE');
    expect(() => stage(line('EOE'), line('PATH'))).toThrow('after-terminal');
    expect(() => stage(line('PROCTITLE'), line('CWD'))).toThrow('after-terminal');
    expect(() => stage(line('EOE'), line('EOE'))).toThrow('after-terminal');
  });

  it('rejects duplicate records rather than silently inflating evidence', () => {
    expect(() => stage(line('PATH', 'item=0'), line('PATH', 'item=0'))).toThrow('duplicate-record');
    expect(stage(line('PATH', 'item=0'), line('PATH', 'item=1')).accounting.records).toBe(2);
  });

  it.each([
    '----\n',
    'type=PATH msg=audit(1750000000.12:1): name="a"\n',
    'type=PATH msg=audit(1750000000.123:01): name="a"\n',
    'type=PATH msg=audit(1750000000.123:1): name="a"\r\n',
    '\ufeff' + line('PATH'),
    line('PATH', 'private\tvalue'),
    line('PATH', 'private\0value'),
  ])('rejects malformed or interpreted raw framing without reflecting content', (raw) => {
    expect(() => importRaw(Buffer.from(raw))).toThrow(/^auditd-/);
  });

  it('refuses partial final records, invalid UTF-8, wrong input and oversized records', () => {
    expect(() => importRaw(Buffer.from(line('PATH').trimEnd()))).toThrow('unterminated-record');
    expect(() => importRaw(Buffer.from([0xff, 10]))).toThrow();
    expect(() => importRaw('private input')).toThrow('input-byte-limit');
    expect(() => importRaw(Buffer.alloc(LIMITS.bytes + 1))).toThrow('input-byte-limit');
    expect(() => stage(line('PATH', 'a'.repeat(LIMITS.lineBytes)))).toThrow('line-byte-limit');
    expect(() => importRaw(Buffer.from(line('PATH').repeat(LIMITS.lines + 1)))).toThrow(
      'record-limit',
    );
  });

  it('bounds compound events and distinct event accumulation before insertion', () => {
    expect(() =>
      stage(
        ...Array.from({ length: LIMITS.recordsPerEvent + 1 }, (_, i) => line('PATH', `item=${i}`)),
      ),
    ).toThrow('event-record-limit');
    expect(() =>
      stage(
        ...Array.from({ length: LIMITS.events + 1 }, (_, i) =>
          line('PATH', '', `1750000000.123:${i}`),
        ),
      ),
    ).toThrow('event-limit');
  });

  it('keeps quoted and hex field encodings opaque and deterministic', () => {
    const bytes = Buffer.from(line('CWD', 'cwd="/a b"') + line('PATH', 'name=2F612062'));
    expect(parseRecords(bytes).map((record) => record.payload)).toEqual([
      'cwd="/a b"',
      'name=2F612062',
    ]);
    expect(importRaw(bytes)).toEqual(importRaw(Buffer.from(bytes)));
    expect(importRaw(bytes).input.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
