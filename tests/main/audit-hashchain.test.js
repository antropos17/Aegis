import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('audit-hashchain', () => {
  /** @type {string} */ let GENESIS;
  /** @type {(value: unknown) => string} */ let canonical;
  /** @type {(prevHash: string, event: object) => string} */ let computeHash;
  /** @type {(filePath: string) => {valid: boolean, brokenAtSeq: number|null, reason: string}} */
  let verifyChain;
  let tmpDir;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-hashchain-test-'));
    const mod = await import('../../src/main/audit-hashchain.js');
    ({ GENESIS, canonical, computeHash, verifyChain } = mod.default);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Build a valid on-disk chain using the real module functions, mirroring the
  // logger's persisted record shape ({ ...event, seq, hash }).
  function writeChain(filePath, events) {
    let prev = GENESIS;
    const lines = events.map((e, seq) => {
      const hash = computeHash(prev, e);
      prev = hash;
      return JSON.stringify({ ...e, seq, hash });
    });
    fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
  }

  function readLines(filePath) {
    return fs
      .readFileSync(filePath, 'utf-8')
      .split('\n')
      .filter((l) => l.trim().length > 0);
  }

  it('canonical() is insertion-order independent (recursively)', () => {
    expect(canonical({ a: 1, b: 2 })).toBe(canonical({ b: 2, a: 1 }));
    expect(canonical({ x: { p: 1, q: 2 } })).toBe(canonical({ x: { q: 2, p: 1 } }));
  });

  // #5.1 — the undefined-fix. An in-memory event carrying an undefined-valued
  // detail must hash IDENTICALLY to the form JSON.stringify writes to disk
  // (JSON drops undefined-valued keys), otherwise verify would falsely report
  // a tamper on a perfectly clean record.
  it('computeHash() treats undefined-valued keys the same as the JSON disk form', () => {
    const inMemory = { type: 't', details: { foo: undefined, bar: 1 } };
    const onDisk = { type: 't', details: { bar: 1 } };
    expect(computeHash(GENESIS, inMemory)).toBe(computeHash(GENESIS, onDisk));
  });

  it('verifyChain() returns valid for an untampered 3-event chain', () => {
    const fp = path.join(tmpDir, 'chain.json');
    writeChain(fp, [{ type: 'a' }, { type: 'b' }, { type: 'c' }]);
    expect(verifyChain(fp)).toEqual({ valid: true, brokenAtSeq: null, reason: 'ok' });
  });

  // #3 — TAMPER (the headline RED): edit an interior record's payload but keep
  // its stored seq + hash. The recomputed hash must no longer match.
  it('verifyChain() detects an in-place edit of an interior record', () => {
    const fp = path.join(tmpDir, 'chain.json');
    writeChain(fp, [
      { type: 'a', details: { v: 1 } },
      { type: 'b', details: { v: 2 } },
      { type: 'c', details: { v: 3 } },
    ]);

    const lines = readLines(fp);
    const forged = JSON.parse(lines[1]); // seq 1
    forged.details = { v: 999 };
    lines[1] = JSON.stringify(forged);
    fs.writeFileSync(fp, lines.join('\n') + '\n', 'utf-8');

    const result = verifyChain(fp);
    expect(result.valid).toBe(false);
    expect(result.brokenAtSeq).toBe(1);
  });

  it('verifyChain() detects deletion of an interior line', () => {
    const fp = path.join(tmpDir, 'chain.json');
    writeChain(fp, [{ type: 'a' }, { type: 'b' }, { type: 'c' }]);
    const lines = readLines(fp);
    lines.splice(1, 1); // remove seq 1
    fs.writeFileSync(fp, lines.join('\n') + '\n', 'utf-8');

    const result = verifyChain(fp);
    expect(result.valid).toBe(false);
    expect(typeof result.brokenAtSeq).toBe('number');
  });

  it('verifyChain() detects insertion of a line', () => {
    const fp = path.join(tmpDir, 'chain.json');
    writeChain(fp, [{ type: 'a' }, { type: 'b' }, { type: 'c' }]);
    const lines = readLines(fp);
    lines.splice(1, 0, lines[0]); // duplicate line 0 into position 1
    fs.writeFileSync(fp, lines.join('\n') + '\n', 'utf-8');

    expect(verifyChain(fp).valid).toBe(false);
  });

  // #8 — TRUNCATION is a documented KNOWN LIMITATION, not a bug: a valid prefix
  // of a chain is itself a valid chain, so per-file chaining cannot detect that
  // trailing records were dropped.
  it('verifyChain() does NOT detect truncation of trailing lines (known limitation)', () => {
    const fp = path.join(tmpDir, 'chain.json');
    writeChain(fp, [{ type: 'a' }, { type: 'b' }, { type: 'c' }]);
    const lines = readLines(fp);
    lines.pop(); // drop the last line (seq 2)
    fs.writeFileSync(fp, lines.join('\n') + '\n', 'utf-8');

    expect(verifyChain(fp).valid).toBe(true);
  });
});
