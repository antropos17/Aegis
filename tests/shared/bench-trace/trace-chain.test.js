/**
 * @file tests/shared/bench-trace/trace-chain.test.js
 * @description The trace chain, and the four ways a damaged file must fail loudly
 *   instead of producing a shorter input nobody notices.
 *
 *   The asymmetry worth stating: `bench/lib/observed.js` tolerates an unparseable
 *   LAST line of an audit file, because a live process appends to it and a
 *   `taskkill /F` can land mid-write. A trace is written once, offline, from a
 *   recording that already finished — so the same damage means the file is broken,
 *   not that a writer was killed, and it is refused. A trace reader that inherited
 *   the audit reader's tolerance would silently drop the final observation of every
 *   trace it read.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, afterEach } from 'vitest';

import schema from '../../../bench/trace/schema.js';
import writer from '../../../bench/trace/writer.js';
import reader from '../../../bench/trace/reader.js';

import {
  makeEnv,
  makeRecords,
  traceTextWithLineReplaced,
  writeTraceDir,
} from './_make-trace.js';

/** @type {string[]} Directories to remove after each test. */
const created = [];

/** @param {Object} [opts] @returns {string} A trace directory, cleaned up afterwards. */
function tempTrace(opts) {
  const dir = writeTraceDir(opts);
  created.push(dir);
  return dir;
}

afterEach(() => {
  while (created.length > 0) {
    fs.rmSync(created.pop(), { recursive: true, force: true });
  }
});

describe('trace chain — a well-formed trace', () => {
  it('recomputes from TRACE_GENESIS, one link per line', () => {
    const records = makeRecords();
    let prev = schema.TRACE_GENESIS;
    for (const record of records) {
      expect(schema.recordHash(prev, record)).toBe(record.hash);
      prev = record.hash;
    }
    expect(records.map((r) => r.bench.seq)).toEqual([0, 1, 2, 3]);
  });

  it('reads back exactly what was written', () => {
    const records = makeRecords();
    const dir = tempTrace({ records });
    const { header, records: read } = reader.readTrace(dir, { env: makeEnv() });
    expect(header.traceSchemaVersion).toBe(schema.TRACE_SCHEMA_VERSION);
    expect(read).toEqual(records);
  });

  it('serializes to one line per record and a trailing newline', () => {
    const text = writer.serializeTrace(makeRecords());
    expect(text.endsWith('\n')).toBe(true);
    expect(text.trimEnd().split('\n')).toHaveLength(4);
    expect(text.includes('\n\n')).toBe(false);
  });

  it('refuses to overwrite a trace that is already on disk', () => {
    const dir = tempTrace();
    let err = null;
    try {
      writer.writeTrace(dir, {}, []);
    } catch (e) {
      err = e;
    }
    expect(err.name).toBe('TraceError');
    expect(err.message).toContain('never written twice');
  });
});

describe('trace chain — damage is refused, never absorbed', () => {
  it('refuses an interior line that does not parse', () => {
    const records = makeRecords();
    const lines = records.map((r) => JSON.stringify(r));
    lines[1] = '{"bench":';
    const dir = tempTrace({ records, traceText: lines.join('\n') + '\n' });
    let err = null;
    try {
      reader.readTrace(dir, { env: makeEnv() });
    } catch (e) {
      err = e;
    }
    expect(err.reason).toBe(schema.REFUSAL.CHAIN_BROKEN);
    expect(err.message).toContain('line 1');
  });

  it('refuses a torn TRAILING line, unlike the audit reader', () => {
    const records = makeRecords();
    const text = writer.serializeTrace(records).trimEnd();
    const torn = text.slice(0, text.length - 12) + '\n';
    const dir = tempTrace({ records, traceText: torn });
    let err = null;
    try {
      reader.readTrace(dir, { env: makeEnv() });
    } catch (e) {
      err = e;
    }
    expect(err.reason).toBe(schema.REFUSAL.CHAIN_BROKEN);
    expect(err.message).toContain('does not parse');
  });

  it('refuses a seq that is not its line number', () => {
    const records = makeRecords();
    const moved = { ...records[2], bench: { ...records[2].bench, seq: 9 } };
    const dir = tempTrace({
      records,
      traceText: traceTextWithLineReplaced(records, 2, moved),
    });
    let err = null;
    try {
      reader.readTrace(dir, { env: makeEnv() });
    } catch (e) {
      err = e;
    }
    expect(err.reason).toBe(schema.REFUSAL.CHAIN_BROKEN);
    expect(err.message).toContain('bench.seq 9');
  });

  it('refuses an edit that leaves the record well-formed', () => {
    // The point of a chain: a plausible-looking substitution is still refused, because
    // the hash covers the record's content and not merely its shape.
    const records = makeRecords();
    const edited = {
      ...records[1],
      file: { ...records[1].file, path: 'X:\\dev\\project\\AEGIS\\.env.local' },
    };
    const dir = tempTrace({
      records,
      traceText: traceTextWithLineReplaced(records, 1, edited),
    });
    let err = null;
    try {
      reader.readTrace(dir, { env: makeEnv() });
    } catch (e) {
      err = e;
    }
    expect(err.reason).toBe(schema.REFUSAL.CHAIN_BROKEN);
    expect(err.message).toContain('does not recompute');
  });

  it('refuses a deleted interior line rather than reading a shorter trace', () => {
    const records = makeRecords();
    const lines = records.map((r) => JSON.stringify(r));
    lines.splice(1, 1);
    const dir = tempTrace({ records, traceText: lines.join('\n') + '\n' });
    let err = null;
    try {
      reader.readTrace(dir, { env: makeEnv() });
    } catch (e) {
      err = e;
    }
    expect(err.reason).toBe(schema.REFUSAL.CHAIN_BROKEN);
  });

  it('refuses an empty trace instead of calling it a recording that saw nothing', () => {
    const dir = tempTrace({ traceText: '' });
    let err = null;
    try {
      reader.readTrace(dir, { env: makeEnv() });
    } catch (e) {
      err = e;
    }
    expect(err.reason).toBe(schema.REFUSAL.EMPTY_TRACE);
  });

  it('refuses a chain built by a writer that skipped a sequence number', () => {
    const records = makeRecords();
    const unchained = records.map((r) => {
      const copy = { ...r };
      delete copy.hash;
      return copy;
    });
    unchained[2] = { ...unchained[2], bench: { ...unchained[2].bench, seq: 5 } };
    let err = null;
    try {
      writer.chainRecords(unchained);
    } catch (e) {
      err = e;
    }
    expect(err.reason).toBe(schema.REFUSAL.CHAIN_BROKEN);
  });
});

describe('trace chain — the files a trace is made of', () => {
  it('refuses a directory with no header', () => {
    const dir = tempTrace();
    fs.rmSync(path.join(dir, schema.HEADER_FILENAME));
    let err = null;
    try {
      reader.readTrace(dir, { env: makeEnv() });
    } catch (e) {
      err = e;
    }
    expect(err.reason).toBe(schema.REFUSAL.FILE_UNREADABLE);
  });

  it('refuses a directory with no records file', () => {
    const dir = tempTrace();
    fs.rmSync(path.join(dir, schema.TRACE_FILENAME));
    let err = null;
    try {
      reader.readTrace(dir, { env: makeEnv() });
    } catch (e) {
      err = e;
    }
    expect(err.reason).toBe(schema.REFUSAL.FILE_UNREADABLE);
  });

  it('refuses a header that does not parse', () => {
    const dir = tempTrace({ headerText: '{ "traceSchemaVersion": 1, ' });
    let err = null;
    try {
      reader.readTrace(dir, { env: makeEnv() });
    } catch (e) {
      err = e;
    }
    expect(err.reason).toBe(schema.REFUSAL.FILE_UNREADABLE);
    expect(err.message).toContain('does not parse');
  });
});
