import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import adapter from '../../src/main/token-adapters/claude-code.js';
import { createLedger } from '../../src/main/token-dedup-ledger.js';

const directories = [];
const startedAt = 1790856000000;
const usage = (id, input = 1) =>
  JSON.stringify({
    type: 'assistant',
    message: {
      id,
      model: 'claude-sonnet-4-6',
      content: 'PRIVATE-PROMPT-CANARY',
      usage: { input_tokens: input, output_tokens: 2 },
    },
  }) + '\n';

function fixture(maxBytes = 128 * 1024 * 1024) {
  adapter._resetForTest();
  let clock = 1000;
  adapter._setNowForTest(() => clock);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-dedup-test-'));
  directories.push(dir);
  const file = path.join(dir, 'index.sqlite');
  const home = path.join(dir, 'PRIVATE-HOME-CANARY');
  const cwd = path.join(home, 'workspace');
  const project = path.join(home, '.claude', 'projects', adapter._encodeCwd(cwd));
  const files = new Map();
  const register = (pid, sid) => {
    files.set(
      path.join(home, '.claude', 'sessions', `${pid}.json`),
      JSON.stringify({ sessionId: sid, cwd, startedAt }),
    );
    return path.join(project, `${sid}.jsonl`);
  };
  const transcript = register(7, 'PRIVATE-SESSION-CANARY');
  const subDir = path.join(project, 'PRIVATE-SESSION-CANARY', 'subagents');
  const sub = path.join(subDir, 'agent-private.jsonl');
  const warnings = vi.fn();
  adapter._setHomedirForTest(() => home);
  adapter._setLoggerForTest({ warn: warnings });
  adapter._setLedgerFactoryForTest(() => createLedger({ file, maxBytes }));
  adapter._setFsForTest({
    existsSync: (target) => files.has(target) || (target === subDir && files.has(sub)),
    statSync: (target) => ({ size: Buffer.byteLength(files.get(target)) }),
    readRange: (target, start, length) =>
      Buffer.from(files.get(target)).subarray(start, start + length),
    readdirSync: () => ['agent-private.jsonl'],
  });
  const read = () => adapter.readUsage([{ pid: 7, startTime: startedAt }]);
  const advanceRetry = () => {
    clock += 30000;
  };
  return { file, dir, files, transcript, sub, read, warnings, register, advanceRetry };
}

afterEach(() => {
  adapter._resetForTest();
  for (const dir of directories.splice(0)) {
    // Only exact files created by these tests; no recursive temp-directory cleanup.
    for (const name of [
      'index.sqlite',
      'index.sqlite-journal',
      'index.sqlite.ownership',
      'index.sqlite.ownership.next',
      'foreign.sqlite',
      'link.sqlite',
    ]) {
      const target = path.join(dir, name);
      if (fs.existsSync(target)) fs.unlinkSync(target);
    }
    fs.rmdirSync(dir);
  }
});

it('keeps exact shared main/subagent dedup without writing identifiers or content to disk', async () => {
  const f = fixture();
  f.files.set(f.transcript, usage('PRIVATE-ID-CANARY', 11));
  f.files.set(f.sub, usage('PRIVATE-ID-CANARY', 11) + usage('sub-new', 7));
  expect((await f.read()).reduce((sum, d) => sum + d.inputTokens, 0)).toBe(18);
  f.files.set(f.sub, usage('PRIVATE-ID-CANARY', 11)); // Truncate/rewind subagent.
  expect(await f.read()).toEqual([]);
  f.files.set(f.sub, usage('PRIVATE-ID-CANARY', 11) + usage('after-rewrite', 3));
  expect(await f.read()).toMatchObject([{ inputTokens: 3, estimated: false }]);
  const bytes = fs.readFileSync(f.file);
  const journal = fs.readFileSync(f.file + '-journal');
  const witness = fs.readFileSync(f.file + '.ownership');
  for (const secret of [
    'PRIVATE-ID-CANARY',
    'PRIVATE-SESSION-CANARY',
    'PRIVATE-HOME-CANARY',
    'PRIVATE-PROMPT-CANARY',
    'claude-sonnet-4-6',
    'agent-private.jsonl',
  ]) {
    for (const artifact of [bytes, journal, witness])
      expect(artifact.includes(Buffer.from(secret))).toBe(false);
    expect(JSON.stringify(f.warnings.mock.calls)).not.toContain(secret);
  }
  adapter._resetForTest();
  expect(fs.readFileSync(f.file)).toEqual(bytes);
  expect(new Set(fs.readdirSync(f.dir))).toEqual(
    new Set(['index.sqlite', 'index.sqlite-journal', 'index.sqlite.ownership']),
  );
  expect(fs.statSync(f.file + '-journal').size).toBe(0);
  expect(witness.length).toBeLessThanOrEqual(1024);
  const reopened = createLedger({ file: f.file });
  try {
    expect(reopened.getAggregate()).toMatchObject({ inputTokens: 21, outputTokens: 6 });
    expect(
      reopened.withSession('PRIVATE-SESSION-CANARY', (state) =>
        state.seenIds.has('PRIVATE-ID-CANARY'),
      ),
    ).toBe(true);
    reopened.commit();
  } finally {
    reopened.close();
  }
});

it('collects 1000 unique messages within 64 KiB and keeps exact dedup after rewinding', async () => {
  const f = fixture(64 * 1024);
  const records = Array.from({ length: 1000 }, (_, i) => usage(`capacity-${i}`)).join('');
  f.files.set(f.transcript, records);
  expect(await f.read()).toHaveLength(1000);
  expect(fs.statSync(f.file).size).toBeLessThanOrEqual(64 * 1024);
  expect(adapter.getCollectionStatus().state).toBe('ready');
  f.files.set(f.transcript, usage('capacity-0'));
  expect(await f.read()).toEqual([]);
  f.files.set(f.sub, records);
  expect(await f.read()).toEqual([]);
});

it('rejects a cap below the schema size before creating a file', () => {
  const f = fixture();
  expect(() => createLedger({ file: f.file, maxBytes: 16 * 1024 })).toThrow(
    'dedup-cache-limit-invalid',
  );
  expect(fs.existsSync(f.file)).toBe(false);
});

it('fits the 20 KiB minimum cap and isolates identical IDs across sessions after rollback', () => {
  const f = fixture();
  const ledger = createLedger({ file: f.file, maxBytes: 20 * 1024 });
  const collect = (session) =>
    ledger.withSession(session, (state) => {
      const seen = state.seenIds.has('shared-id');
      state.seenIds.add('shared-id');
      return seen;
    });
  try {
    expect(collect('rolled-back')).toBe(false);
    ledger.rollback();
    expect(collect('first')).toBe(false);
    ledger.commit();
    expect(collect('second')).toBe(false);
    ledger.commit();
    expect(collect('first')).toBe(true);
    ledger.commit();
    expect(collect('second')).toBe(true);
    ledger.commit();
    expect(fs.statSync(f.file).size).toBeLessThanOrEqual(20 * 1024);
  } finally {
    ledger.close();
  }
});

it('commits only a complete smaller main/subagent retry at the disk cap, then resumes without duplicates', async () => {
  const f = fixture(64 * 1024);
  f.files.set(f.transcript, usage('original', 11));
  expect(await f.read()).toMatchObject([{ inputTokens: 11 }]);
  f.files.set(f.transcript, usage('original', 11) + usage('main-new', 5));
  f.files.set(f.sub, Array.from({ length: 2000 }, (_, i) => usage(`large-${i}`)).join(''));
  const committed = await f.read();
  expect(committed[0]).toMatchObject({ inputTokens: 5 });
  expect(committed.length).toBeGreaterThan(1);
  expect(committed.length).toBeLessThan(2001);
  expect(committed.slice(1).every((delta) => delta.inputTokens === 1)).toBe(true);
  const inspect = new DatabaseSync(f.file, { readOnly: true });
  try {
    expect(inspect.prepare('SELECT count(*) AS n FROM messages').get().n).toBe(
      1 + committed.length,
    );
    expect(inspect.prepare('SELECT offset FROM sessions').get().offset).toBe(
      Buffer.byteLength(f.files.get(f.transcript)),
    );
    const acceptedSubagentBytes = Array.from({ length: committed.length - 1 }, (_, i) =>
      Buffer.byteLength(usage(`large-${i}`)),
    ).reduce((sum, bytes) => sum + bytes, 0);
    expect(inspect.prepare('SELECT offset FROM tails').get().offset).toBe(acceptedSubagentBytes);
  } finally {
    inspect.close();
  }
  expect(adapter.getCollectionStatus()).toEqual({
    state: 'storage-paused',
    reason: 'capacity',
    retryAt: 31000,
  });
  expect(fs.statSync(f.file).size).toBeLessThanOrEqual(64 * 1024);
  expect(await f.read()).toEqual([]);
  expect(f.warnings).toHaveBeenCalledOnce();
  expect(f.warnings.mock.calls[0][2]).toEqual({ error: 'dedup-batch-not-committed' });
  // Replay accepted IDs and a suffix ID from the failed transaction after rotation.
  f.files.set(
    f.sub,
    usage('original', 11) + usage('large-0') + usage('large-1999') + usage('sub-new', 7),
  );
  f.advanceRetry();
  expect((await f.read()).map((d) => d.inputTokens)).toEqual([1, 7]);
  expect(adapter.getCollectionStatus().state).toBe('ready');
  expect(await f.read()).toEqual([]);
});

it('emits nothing when commit is blocked and retries the uncommitted IDs exactly once', async () => {
  const f = fixture();
  f.files.set(f.transcript, usage('original', 11));
  expect(await f.read()).toMatchObject([{ inputTokens: 11 }]);
  const reader = new DatabaseSync(f.file, { readOnly: true });
  try {
    reader.exec('BEGIN');
    reader.prepare('SELECT * FROM sessions').all(); // Hold a real SQLite shared lock.
    f.files.set(f.transcript, usage('original', 11) + usage('retry-after-commit', 7));
    expect(await f.read()).toEqual([]);
    reader.exec('ROLLBACK');
    f.advanceRetry();
    expect(await f.read()).toMatchObject([{ inputTokens: 7 }]);
    expect(await f.read()).toEqual([]);
  } finally {
    reader.close();
  }
});

it('keeps an unreadable process from suppressing healthy processes in the same batch', async () => {
  const f = fixture();
  const broken = f.register(8, 'broken');
  f.files.set(f.transcript, usage('healthy', 11));
  f.files.set(broken, usage('broken', 7));
  adapter._setFsForTest({
    statSync: (target) => {
      if (target === broken) throw Error('PRIVATE-READ-ERROR');
      return { size: Buffer.byteLength(f.files.get(target)) };
    },
  });
  const processes = [
    { pid: 8, startTime: startedAt },
    { pid: 7, startTime: startedAt },
  ];
  expect(await adapter.readUsage(processes)).toMatchObject([{ pid: 7, inputTokens: 11 }]);
  expect(await adapter.readUsage(processes)).toEqual([]);
  expect(JSON.stringify(f.warnings.mock.calls)).not.toContain('PRIVATE-READ-ERROR');
});

it('preserves foreign files and hard links instead of clearing an unowned cache path', () => {
  const f = fixture();
  fs.writeFileSync(f.file, 'FOREIGN-USER-FILE');
  expect(() => createLedger({ file: f.file })).toThrow('dedup-cache-not-owned');
  expect(fs.readFileSync(f.file, 'utf8')).toBe('FOREIGN-USER-FILE');
  const linked = path.join(f.dir, 'link.sqlite');
  fs.linkSync(f.file, linked);
  expect(() => createLedger({ file: linked })).toThrow('dedup-cache-not-owned');
  expect(fs.readFileSync(f.file, 'utf8')).toBe('FOREIGN-USER-FILE');
});

it('postpones unavailable-index usage without warning growth or an unsafe in-memory fallback', async () => {
  const f = fixture();
  fs.writeFileSync(f.file, 'FOREIGN-USER-FILE');
  f.files.set(f.transcript, usage('original', 11));
  expect(await f.read()).toEqual([]);
  expect(await f.read()).toEqual([]);
  expect(f.warnings).toHaveBeenCalledOnce();
  expect(fs.readFileSync(f.file, 'utf8')).toBe('FOREIGN-USER-FILE');
  fs.unlinkSync(f.file); // Remove this test's exact foreign-file fixture.
  f.advanceRetry();
  expect(await f.read()).toMatchObject([{ inputTokens: 11, estimated: false }]);
  expect(await f.read()).toEqual([]);
});

it('preserves a legacy marked cache without the durable ownership version', () => {
  const f = fixture();
  const stale = new DatabaseSync(f.file);
  stale.exec('PRAGMA application_id=1095059284; CREATE TABLE old_run (value);');
  stale.close();
  const bytes = fs.readFileSync(f.file);
  expect(() => createLedger({ file: f.file })).toThrow('dedup-witness-missing');
  expect(fs.readFileSync(f.file)).toEqual(bytes);
  const observer = new DatabaseSync(f.file, { readOnly: true });
  try {
    expect(
      observer.prepare("SELECT name FROM sqlite_schema WHERE name='old_run'").get(),
    ).toMatchObject({ name: 'old_run' });
  } finally {
    observer.close();
  }
});
