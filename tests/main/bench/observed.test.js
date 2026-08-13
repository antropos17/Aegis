/**
 * @file tests/main/bench/observed.test.js
 * @description `observed.js` is the bench's oracle over the product's audit log,
 *   and an oracle that agrees only with itself proves nothing. So the first
 *   describe block below pins the chain re-implementation against BYTES AEGIS
 *   actually wrote — four consecutive records lifted verbatim out of a real
 *   arm-A run, with the hashes the product computed. Everything after it may use
 *   synthetic chains, because by then the hash function is the one under proof
 *   rather than the thing being assumed (memory-bank/ai-mistakes.md #21).
 *
 *   The rest is about the refusals: a broken chain, a documented loss inside the
 *   window and an empty observation set each fail the run instead of quietly
 *   shortening it.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import observed from '../../../bench/lib/observed.js';

/**
 * Four consecutive records from `aegis-audit-2026-08-13.json`, written by AEGIS
 * 0.11.0-alpha during a real S1 run, verbatim including the hashes it computed.
 * seq 23 is only here to supply the previous hash that 24 chains from.
 * @type {ReadonlyArray<Object>}
 */
const PRODUCT_RECORDS = Object.freeze([
  {
    schemaVersion: 1,
    timestamp: '2026-08-13T09:31:06.794Z',
    type: 'network-connection',
    agent: 'Claude Code',
    pid: 40784,
    instanceId: '40784:1786606452193',
    action: 'Established',
    path: '160.79.104.10:443',
    severity: 'normal',
    riskScore: 0,
    attribution: { status: 'confirmed', evidence: ['os-tcp-owner-pid'] },
    details: { domain: '', flagged: false },
    seq: 23,
    hash: 'a03207224ae4fb65878f0eb4a64812ca4cf5f9371294bbd4652ae75ee741b45f',
  },
  {
    schemaVersion: 1,
    timestamp: '2026-08-13T09:31:11.599Z',
    type: 'file-access',
    agent: '',
    pid: null,
    instanceId: null,
    action: 'created',
    path: 'X:\\Future\\ESCAPE\\AEGIS\\bench\\runs\\2026-08-13T09-31-10Z-S1-agent-lifecycle-A\\manifest.json',
    severity: 'normal',
    riskScore: 0,
    attribution: { status: 'unattributed', evidence: ['no-owner-match'] },
    details: null,
    seq: 24,
    hash: '533e1972b46688e7131d7a7cb1fde4fa32550f6ad36fb4dbc02a68d83c207cb2',
  },
  {
    schemaVersion: 1,
    timestamp: '2026-08-13T09:31:11.606Z',
    type: 'file-access',
    agent: '',
    pid: null,
    instanceId: null,
    action: 'created',
    path: 'X:\\Future\\ESCAPE\\AEGIS\\bench\\runs\\2026-08-13T09-31-10Z-S1-agent-lifecycle-A\\stage\\claude.exe',
    severity: 'normal',
    riskScore: 0,
    attribution: { status: 'unattributed', evidence: ['no-owner-match'] },
    details: null,
    seq: 25,
    hash: 'f178604fe029c69609b75e666658072becad0763ba79b34a18ec55c3649207ad',
  },
  {
    schemaVersion: 1,
    timestamp: '2026-08-13T09:31:34.477Z',
    type: 'agent-enter',
    agent: 'Claude Code',
    pid: 35280,
    instanceId: '35280:1786613471663',
    action: 'started',
    path: '',
    severity: 'normal',
    riskScore: 0,
    attribution: null,
    details: { startTime: 1786613494477 },
    seq: 26,
    hash: '74fdf70bf09f694c7f7241bf1e95ca5bc3b4fc08cd9daf7ae6861ed256ec19c8',
  },
]);

/** The `agent-exit` from the same run, seq 38. @type {Object} */
const PRODUCT_EXIT = Object.freeze({
  schemaVersion: 1,
  timestamp: '2026-08-13T09:32:24.633Z',
  type: 'agent-exit',
  agent: 'Claude Code',
  pid: 35280,
  instanceId: '35280:1786613471663',
  action: 'exited',
  path: '',
  severity: 'normal',
  riskScore: 0,
  attribution: null,
  details: null,
  seq: 38,
  hash: '3cd17c9be9dbe56bd1649b81c4c91e645b31c687845f8f18f9197aeff564c32b',
});

/** The `file-access` deletion of the staged binary, seq 30. @type {Object} */
const PRODUCT_DELETION = Object.freeze({
  schemaVersion: 1,
  timestamp: '2026-08-13T09:31:46.825Z',
  type: 'file-access',
  agent: '',
  pid: null,
  instanceId: null,
  action: 'deleted',
  path: 'X:\\Future\\ESCAPE\\AEGIS\\bench\\runs\\2026-08-13T09-31-10Z-S1-agent-lifecycle-A\\stage\\claude.exe',
  severity: 'normal',
  riskScore: 0,
  attribution: { status: 'unattributed', evidence: ['no-owner-match'] },
  details: null,
  seq: 30,
  hash: '8448f151946b32f7e1b2a05ec71efa6d261f439b8c5d0a09f7aa87f94fee2ec2',
});

/** @type {string} A scratch directory, one per test. */
let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-observed-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/**
 * One audit record without seq/hash — the shape `audit-logger.log()` builds.
 * @param {Object} [overrides]
 * @returns {Object}
 */
function entry(overrides = {}) {
  return {
    schemaVersion: 1,
    timestamp: '2026-08-13T09:31:11.606Z',
    type: 'file-access',
    agent: '',
    pid: null,
    instanceId: null,
    action: 'created',
    path: 'X:\\runs\\r\\stage\\claude.exe',
    severity: 'normal',
    riskScore: 0,
    attribution: null,
    details: null,
    ...overrides,
  };
}

/**
 * Write a daily audit file whose chain is genuinely correct, using the hash
 * function the first describe block pins against product output.
 * @param {string} dir - Directory to create the file in.
 * @param {Object[]} entries - Records WITHOUT seq/hash.
 * @param {string} [day]
 * @returns {string} Path of the file written.
 */
function writeChain(dir, entries, day = '2026-08-13') {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `aegis-audit-${day}.json`);
  let prev = observed.GENESIS;
  const lines = entries.map((e, i) => {
    const hash = observed.computeHash(prev, e);
    prev = hash;
    return JSON.stringify({ ...e, seq: i, hash });
  });
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
  return file;
}

/**
 * A profile directory with an audit trail in it.
 * @param {Object[]} entries
 * @returns {string} The profile directory.
 */
function writeProfile(entries) {
  const profile = path.join(tmp, 'profile');
  writeChain(path.join(profile, observed.AUDIT_DIRNAME), entries);
  return profile;
}

describe('bench observed — the chain re-implementation against product bytes', () => {
  it('re-derives the hashes AEGIS itself wrote, link by link', () => {
    for (let i = 1; i < PRODUCT_RECORDS.length; i++) {
      const record = { ...PRODUCT_RECORDS[i] };
      const prevHash = PRODUCT_RECORDS[i - 1].hash;
      delete record.seq;
      delete record.hash;
      expect(observed.computeHash(prevHash, record)).toBe(PRODUCT_RECORDS[i].hash);
    }
  });

  it('does not re-derive a product hash from the wrong predecessor', () => {
    const record = { ...PRODUCT_RECORDS[2] };
    delete record.seq;
    delete record.hash;
    expect(observed.computeHash(PRODUCT_RECORDS[0].hash, record)).not.toBe(PRODUCT_RECORDS[2].hash);
  });

  it('canonicalizes by content, not by key insertion order', () => {
    const written = observed.canonical({ b: 1, a: [2, { d: 4, c: 3 }] });
    const read = observed.canonical({ a: [2, { c: 3, d: 4 }], b: 1 });
    expect(written).toBe(read);
    // Array order is content, not insertion order, and must NOT be normalized away.
    expect(observed.canonical([1, 2])).not.toBe(observed.canonical([2, 1]));
  });
});

describe('bench observed — reading a chain', () => {
  it('returns every record, stamped with the file it came from', () => {
    const file = writeChain(tmp, [entry(), entry({ action: 'deleted' })]);
    const { records, truncatedTail } = observed.readChain(file);
    expect(records).toHaveLength(2);
    expect(records[0].seq).toBe(0);
    expect(records[1].auditFile).toBe('aegis-audit-2026-08-13.json');
    expect(truncatedTail).toBeNull();
  });

  it('refuses a record whose hash does not recompute', () => {
    const file = writeChain(tmp, [entry(), entry({ action: 'deleted' })]);
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    const tampered = JSON.parse(lines[0]);
    tampered.path = 'X:\\runs\\r\\stage\\something-else.exe';
    lines[0] = JSON.stringify(tampered);
    fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
    expect(() => observed.readChain(file)).toThrow(observed.ObservedError);
    expect(() => observed.readChain(file)).toThrow(/does not recompute/);
  });

  it('refuses a chain whose seq is not its line number', () => {
    const file = writeChain(tmp, [entry(), entry(), entry()]);
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    fs.writeFileSync(file, `${lines[0]}\n${lines[2]}\n`, 'utf8');
    expect(() => observed.readChain(file)).toThrow(/carries seq 2/);
  });

  it('refuses an interior line that does not parse', () => {
    const file = writeChain(tmp, [entry(), entry(), entry()]);
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    lines[1] = '{"schemaVersion":1,"timesta';
    fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
    expect(() => observed.readChain(file)).toThrow(/line 1 does not parse/);
  });

  it('drops a torn LAST line and says it did, instead of failing the run', () => {
    const file = writeChain(tmp, [entry(), entry({ action: 'deleted' })]);
    fs.appendFileSync(file, '{"schemaVersion":1,"timestamp":"2026-08-13T09:3', 'utf8');
    const { records, truncatedTail } = observed.readChain(file);
    expect(records).toHaveLength(2);
    expect(truncatedTail).toMatch(/torn write/);
    expect(truncatedTail).toMatch(/may be missing/);
  });
});

describe('bench observed — finding the audit trail', () => {
  it('returns nothing when the profile has no audit directory', () => {
    expect(observed.listAuditFiles(path.join(tmp, 'nowhere'))).toEqual([]);
  });

  it('takes only daily audit files, oldest first', () => {
    const dir = path.join(tmp, 'profile', observed.AUDIT_DIRNAME);
    fs.mkdirSync(dir, { recursive: true });
    for (const name of [
      'aegis-audit-2026-08-14.json',
      'aegis-audit-2026-08-13.json',
      'settings.json',
      'aegis-2026-08-13.log',
    ]) {
      fs.writeFileSync(path.join(dir, name), '', 'utf8');
    }
    expect(observed.listAuditFiles(path.join(tmp, 'profile')).map((f) => path.basename(f))).toEqual(
      ['aegis-audit-2026-08-13.json', 'aegis-audit-2026-08-14.json'],
    );
  });

  it('fails the run when the sensor persisted nothing at all', () => {
    expect(() =>
      observed.capture({
        profileDir: path.join(tmp, 'profile'),
        scenario: 'S1-agent-lifecycle',
        windowStart: '2026-08-13T09:31:11.000Z',
        windowEnd: '2026-08-13T09:33:00.000Z',
      }),
    ).toThrow(/no audit file under/);
  });
});

describe('bench observed — mapping product records onto the catalogue subset', () => {
  /**
   * @param {Object} record
   * @returns {Object|null}
   */
  const map = (record) => observed.toEcs(record, 'S1-agent-lifecycle');

  it('maps a file creation, deriving name and directory from the observed path', () => {
    const line = map(PRODUCT_RECORDS[2]);
    expect(line['@timestamp']).toBe('2026-08-13T09:31:11.606Z');
    expect(line.event).toEqual({
      kind: 'event',
      category: ['file'],
      type: ['creation'],
      action: 'file-created',
    });
    expect(line.file).toEqual({
      path: 'X:\\Future\\ESCAPE\\AEGIS\\bench\\runs\\2026-08-13T09-31-10Z-S1-agent-lifecycle-A\\stage\\claude.exe',
      name: 'claude.exe',
      directory:
        'X:\\Future\\ESCAPE\\AEGIS\\bench\\runs\\2026-08-13T09-31-10Z-S1-agent-lifecycle-A\\stage',
    });
    // The product knows no owner for a watcher event, so no pid is written —
    // absent, never null (the B2.2 convention).
    expect(line.process).toBeUndefined();
    expect(line.bench.scenario).toBe('S1-agent-lifecycle');
    expect(line.bench.source).toBe('aegis-audit');
    expect(line.bench.auditSeq).toBe(25);
    expect(line.bench.auditType).toBe('file-access');
    expect(line.bench.attribution).toEqual({
      status: 'unattributed',
      evidence: ['no-owner-match'],
    });
    // No owner was resolved, so no display name and no instance key are claimed.
    expect(line.bench.agent).toBeUndefined();
    expect(line.bench.instanceId).toBeUndefined();
  });

  it('maps a file deletion', () => {
    const line = map(PRODUCT_DELETION);
    expect(line.event.type).toEqual(['deletion']);
    expect(line.event.action).toBe('file-deleted');
    expect(line.file.name).toBe('claude.exe');
  });

  it('maps agent-enter onto process.start, with pid as the only join key', () => {
    const line = map(PRODUCT_RECORDS[3]);
    expect(line.event).toEqual({
      kind: 'event',
      category: ['process'],
      type: ['start'],
      action: 'process-started',
    });
    expect(line.process).toEqual({ pid: 35280 });
    // The audit persists the display name, not the image name, so process.name
    // and process.executable stay out rather than being filled with something a
    // join would read as an image name.
    expect(line.process.name).toBeUndefined();
    expect(line.process.executable).toBeUndefined();
    expect(line.bench.agent).toBe('Claude Code');
    expect(line.bench.instanceId).toBe('35280:1786613471663');
  });

  it('maps agent-exit onto process.end, and invents no exit code', () => {
    const line = map(PRODUCT_EXIT);
    expect(line.event.type).toEqual(['end']);
    expect(line.event.action).toBe('process-ended');
    expect(line.process).toEqual({ pid: 35280 });
    expect(line.process.exit_code).toBeUndefined();
    expect(line.bench.terminationSignal).toBeUndefined();
  });

  it('maps config-access the same way it maps file-access', () => {
    const line = map(
      entry({ type: 'config-access', action: 'deleted', path: '/home/a/.claude/x' }),
    );
    expect(line.event.category).toEqual(['file']);
    expect(line.event.type).toEqual(['deletion']);
    expect(line.file).toEqual({
      path: '/home/a/.claude/x',
      name: 'x',
      directory: '/home/a/.claude',
    });
  });

  it('has no shape for a network connection', () => {
    expect(map(PRODUCT_RECORDS[0])).toBeNull();
  });

  it('has no shape for a modified or accessed file', () => {
    expect(map(entry({ action: 'modified' }))).toBeNull();
    expect(map(entry({ action: 'accessed' }))).toBeNull();
  });

  it('writes no pid for a synthetic, process-less agent', () => {
    const line = map(entry({ type: 'agent-enter', action: 'started', pid: 0, path: '' }));
    expect(line.process).toBeUndefined();
  });

  it('refuses to build a file line with no path to name it by', () => {
    expect(map(entry({ path: '' }))).toBeNull();
  });

  it('splits a path by the separator the record used, not by the host platform', () => {
    expect(observed.splitPath('X:\\a\\b\\c.exe')).toEqual({ name: 'c.exe', directory: 'X:\\a\\b' });
    expect(observed.splitPath('/home/a/b.txt')).toEqual({ name: 'b.txt', directory: '/home/a' });
  });
});

describe('bench observed — the run window', () => {
  /** @type {Object[]} */
  const spread = [
    entry({ timestamp: '2026-08-13T09:30:00.000Z', path: 'X:\\before.txt' }),
    entry({ timestamp: '2026-08-13T09:31:11.606Z', path: 'X:\\inside.txt' }),
    entry({ timestamp: '2026-08-13T09:33:00.000Z', path: 'X:\\after.txt' }),
  ];

  it('keeps only what the sensor recorded between the first step and the stop', () => {
    const { events, skipped } = observed.select({
      records: spread,
      scenario: 'S1',
      windowStart: '2026-08-13T09:31:00.000Z',
      windowEnd: '2026-08-13T09:32:00.000Z',
    });
    expect(events).toHaveLength(1);
    expect(events[0].file.path).toBe('X:\\inside.txt');
    expect(skipped.outOfWindow).toBe(2);
  });

  it('admits a record inside epsilon of an edge and rejects one outside it', () => {
    const edge = [
      entry({ timestamp: '2026-08-13T09:30:59.900Z', path: 'X:\\just-before.txt' }),
      entry({ timestamp: '2026-08-13T09:30:59.500Z', path: 'X:\\well-before.txt' }),
    ];
    const { events } = observed.select({
      records: edge,
      scenario: 'S1',
      windowStart: '2026-08-13T09:31:00.000Z',
      windowEnd: '2026-08-13T09:32:00.000Z',
      epsilonMs: 250,
    });
    expect(events.map((e) => e.file.path)).toEqual(['X:\\just-before.txt']);
  });

  it('counts what it could not shape instead of dropping it silently', () => {
    const { events, skipped } = observed.select({
      records: [
        entry({ action: 'modified' }),
        entry({ action: 'modified' }),
        entry({ type: 'network-connection', action: 'Established' }),
        entry({ timestamp: '2026-08-13T09:31:11.606Z' }),
      ],
      scenario: 'S1',
      windowStart: '2026-08-13T09:31:00.000Z',
      windowEnd: '2026-08-13T09:32:00.000Z',
    });
    expect(events).toHaveLength(1);
    expect(skipped.byShapelessType).toEqual({
      'file-access/modified': 2,
      'network-connection/Established': 1,
    });
  });

  it('counts a record whose timestamp is not an instant', () => {
    const { skipped } = observed.select({
      records: [entry({ timestamp: 'not-a-time' })],
      scenario: 'S1',
      windowStart: '2026-08-13T09:31:00.000Z',
      windowEnd: '2026-08-13T09:32:00.000Z',
    });
    expect(skipped.unparsableTimestamp).toBe(1);
  });
});

describe('bench observed — refusals', () => {
  it('fails the run on a loss marker inside the window', () => {
    expect(() =>
      observed.select({
        records: [
          entry({
            timestamp: '2026-08-13T09:31:30.000Z',
            type: observed.DROP_MARKER_TYPE,
            action: '',
            path: '',
            details: { droppedCount: 12 },
          }),
        ],
        scenario: 'S1',
        windowStart: '2026-08-13T09:31:00.000Z',
        windowEnd: '2026-08-13T09:32:00.000Z',
      }),
    ).toThrow(/12 entries were evicted/);
  });

  it('only counts a loss marker that falls outside the window', () => {
    const { skipped } = observed.select({
      records: [
        entry({
          timestamp: '2026-08-13T09:20:00.000Z',
          type: observed.DROP_MARKER_TYPE,
          action: '',
          path: '',
          details: { droppedCount: 3 },
        }),
      ],
      scenario: 'S1',
      windowStart: '2026-08-13T09:31:00.000Z',
      windowEnd: '2026-08-13T09:32:00.000Z',
    });
    expect(skipped.dropMarkersOutsideWindow).toBe(1);
    expect(skipped.outOfWindow).toBe(0);
  });

  it('fails the run rather than writing an empty observation set', () => {
    const profile = writeProfile([entry({ timestamp: '2026-08-13T09:20:00.000Z' })]);
    let thrown;
    try {
      observed.capture({
        profileDir: profile,
        scenario: 'S1',
        windowStart: '2026-08-13T09:31:00.000Z',
        windowEnd: '2026-08-13T09:32:00.000Z',
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(observed.ObservedError);
    expect(thrown.stage).toBe('no-observations');
    expect(thrown.message).toMatch(/would read as "the sensor saw nothing"/);
  });

  it('fails the run when the window is not two instants', () => {
    expect(() =>
      observed.select({
        records: [entry()],
        scenario: 'S1',
        windowStart: null,
        windowEnd: '2026-08-13T09:32:00.000Z',
      }),
    ).toThrow(/is not two UTC instants/);
  });
});

describe('bench observed — the whole capture', () => {
  it('verifies, filters and maps in one pass, and names the file it read', () => {
    const profile = writeProfile([
      entry({ timestamp: '2026-08-13T09:30:00.000Z', path: 'X:\\before.txt' }),
      entry({ timestamp: '2026-08-13T09:31:11.606Z' }),
      entry({ timestamp: '2026-08-13T09:31:20.000Z', type: 'agent-enter', pid: 35280, path: '' }),
      entry({ timestamp: '2026-08-13T09:31:30.000Z', action: 'modified' }),
    ]);
    const captured = observed.capture({
      profileDir: profile,
      scenario: 'S1-agent-lifecycle',
      windowStart: '2026-08-13T09:31:00.000Z',
      windowEnd: '2026-08-13T09:32:00.000Z',
    });
    expect(captured.lines).toBe(4);
    expect(captured.files.map((f) => path.basename(f))).toEqual(['aegis-audit-2026-08-13.json']);
    expect(captured.truncatedTails).toEqual([]);
    expect(captured.events.map((e) => e.event.action)).toEqual(['file-created', 'process-started']);
    expect(captured.events[0].bench.auditFile).toBe('aegis-audit-2026-08-13.json');
    expect(captured.skipped.outOfWindow).toBe(1);
    expect(captured.skipped.byShapelessType).toEqual({ 'file-access/modified': 1 });
  });

  it('writes one NDJSON document per line', () => {
    const captured = observed.capture({
      profileDir: writeProfile([entry({ timestamp: '2026-08-13T09:31:11.606Z' })]),
      scenario: 'S1',
      windowStart: '2026-08-13T09:31:00.000Z',
      windowEnd: '2026-08-13T09:32:00.000Z',
    });
    const file = observed.write(tmp, captured.events);
    expect(path.basename(file)).toBe(observed.OBSERVED_FILENAME);
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).event.action).toBe('file-created');
  });

  it('writes the capture record, refusal and all', () => {
    const file = observed.writeMeta(tmp, { failure: { stage: 'chain-broken', reason: 'why' } });
    expect(path.basename(file)).toBe(observed.META_FILENAME);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).failure.stage).toBe('chain-broken');
  });
});
