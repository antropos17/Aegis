import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Integration mutations must replace the module audit-logger requires natively.
const require_ = createRequire(import.meta.url);
const index = require_('../../src/main/audit-index.js');
const hashchain = require_('../../src/main/audit-hashchain.js');
const dateStr = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('audit index history and fallback', () => {
  let audit;
  let root;
  let today;
  const cursor = () => new Date(Date.now() + 86400000).toISOString();
  const logDir = () => path.join(root, 'audit-logs');
  const dayFile = (day) => path.join(logDir(), `aegis-audit-${day}.json`);
  const writeDay = (day, rows) => {
    fs.mkdirSync(logDir(), { recursive: true });
    fs.writeFileSync(
      dayFile(day),
      rows.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n',
    );
  };
  const open = async (opts = {}) => {
    audit.init({ userDataPath: root, ...opts });
    await audit._awaitIndexForTest();
  };
  const jsonl = (...args) => {
    const spy = vi.spyOn(index, 'isReady').mockReturnValue(false);
    try {
      return audit.getEntriesBefore(...args);
    } finally {
      spy.mockRestore();
    }
  };
  const event = (timestamp, type = 'file-access', extra = {}) => ({
    timestamp,
    type,
    agent: 'fixture',
    ...extra,
  });

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-index-read-'));
    today = dateStr(new Date());
    vi.resetModules();
    audit = (await import('../../src/main/audit-logger.js')).default;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    await audit._awaitIndexForTest();
    audit.shutdown();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it('serves the real log/flush history through SQL with JSONL parity across dates, cursors and filters', async () => {
    const now = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now - 86400000);
    await open();
    const timestamps = [];
    for (let i = 0; i < 300; i++) {
      vi.setSystemTime(now - (i < 150 ? 86400000 : 0) + (i % 150) * 1000);
      timestamps.push(new Date().toISOString());
      audit.log(i % 3 ? 'file-access' : 'agent-enter', { agent: 'fixture', path: `/fixture/${i}` });
      if (i === 149) audit.flush();
    }
    audit.flush();
    const query = vi.spyOn(index, 'queryBefore');
    for (const before of [timestamps[50], timestamps[160], cursor()]) {
      for (const limit of [1, 25, 500]) {
        for (const types of [undefined, ['file-access'], ['agent-enter'], ['absent']]) {
          const expected = jsonl(before, limit, types);
          const reads = vi.spyOn(fs, 'openSync');
          expect(audit.getEntriesBefore(before, limit, types)).toEqual(expected);
          expect(reads).not.toHaveBeenCalled();
          reads.mockRestore();
        }
      }
    }
    expect(query).toHaveBeenCalledTimes(36);
    for (const file of fs.readdirSync(logDir()))
      expect(hashchain.verifyChain(path.join(logDir(), file)).valid).toBe(true);
  });

  it('normalizes v0, skips malformed lines and markers, and preserves the raw export', async () => {
    const rows = [
      event(`${today}T08:00:00.000Z`, 'file-access', {
        details: { pid: 42, attribution: 'confirmed' },
      }),
      'malformed',
      event(`${today}T09:00:00.000Z`, 'buffer-overflow-drop', { droppedCount: 3 }),
      event(`${today}T10:00:00.000Z`, 'config-access', {
        schemaVersion: 1,
        pid: 7,
        attribution: null,
      }),
      { timestamp: `${today}T11:00:00.000Z` },
      event(`${today}T12:00:00.000Z`, ''),
      { type: 'file-access' },
    ];
    writeDay(today, rows);
    await open();
    for (const types of [undefined, ['buffer-overflow-drop'], [''], [null], [], 'file-access']) {
      expect(audit.getEntriesBefore(cursor(), 500, types)).toEqual(jsonl(cursor(), 500, types));
    }
    expect(audit.getEntriesBefore(cursor(), 500)[0].attribution).toEqual({
      status: 'confirmed',
      evidence: null,
    });
    expect(audit.exportAll()).toEqual(rows.filter((r) => typeof r !== 'string'));
  });

  it('binds type values and shares validation and limits with the JSONL reader', async () => {
    const injection = "x') OR 1=1 --";
    writeDay(today, [event(`${today}T10:00:00.000Z`, injection), event(`${today}T11:00:00.000Z`)]);
    await open();
    for (const types of [
      [injection],
      [null, 'file-access'],
      ['x'.repeat(65)],
      [...Array(16).fill('absent'), 'file-access'],
    ]) {
      for (const limit of [0, -1, 1.8, NaN, Infinity, '2']) {
        expect(audit.getEntriesBefore(cursor(), limit, types)).toEqual(
          jsonl(cursor(), limit, types),
        );
      }
    }
    const query = vi.spyOn(index, 'queryBefore');
    for (const before of [null, 4, '', 'invalid'])
      expect(audit.getEntriesBefore(before)).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('includes a pre-midnight record flushed into the next daily file and excludes the cursor itself', async () => {
    const prior = new Date(Date.now() - 86400000);
    const d = dateStr(prior);
    writeDay(d, [event(`${d}T22:00:00.000Z`)]);
    writeDay(today, [event(`${d}T23:59:58.000Z`), event(`${today}T00:00:02.000Z`)]);
    await open();
    const before = `${d}T23:59:59.000Z`;
    expect(audit.getEntriesBefore(before, 1)).toEqual(jsonl(before, 1));
    expect(audit.getEntriesBefore(before, 1)[0].timestamp).toBe(`${d}T23:59:58.000Z`);
    expect(audit.getEntriesBefore(`${d}T23:59:58.000Z`, 1)[0].timestamp).toBe(`${d}T22:00:00.000Z`);
  });

  it('orders clock-step records by timestamp, with file and line ordinal as tie breakers', async () => {
    writeDay(today, [
      event(`${today}T12:00:00.000Z`, 'file-access', { action: 'first' }),
      event(`${today}T11:00:00.000Z`),
      event(`${today}T12:00:00.000Z`, 'file-access', { action: 'last' }),
    ]);
    await open();
    expect(audit.getEntriesBefore(cursor(), 2).map((r) => r.action)).toEqual(['first', 'last']);
    expect(audit.getEntriesBefore(cursor(), 1)[0].action).toBe('last');
  });

  it.each(['unavailable', 'building', 'failed', 'closed'])(
    'falls back in the same call while %s',
    async (state) => {
      writeDay(today, [
        event(`${today}T10:00:00.000Z`),
        event(`${today}T11:00:00.000Z`, 'agent-enter'),
      ]);
      await open(state === 'unavailable' ? { loadSqlite: () => null } : {});
      const expected = jsonl(cursor(), 25, ['file-access']);
      if (state === 'closed') index.close();
      else if (state !== 'unavailable') index.setState(state, new Error('fixture failure'));
      const query = vi.spyOn(index, 'queryBefore');
      expect(audit.getEntriesBefore(cursor(), 25, ['file-access'])).toEqual(expected);
      expect(query).not.toHaveBeenCalled();
    },
  );

  it('falls back on an actual SQL error and marks the index failed', async () => {
    writeDay(today, [event(`${today}T10:00:00.000Z`)]);
    await open();
    const expected = jsonl(cursor(), 25);
    index._dbForTest().exec('DROP TABLE audit_events');
    expect(audit.getEntriesBefore(cursor(), 25)).toEqual(expected);
    expect(index.isReady()).toBe(false);
    expect(index.status().state).toBe('failed');
    expect(audit.getEntriesBefore(cursor(), 25)).toEqual(expected);
  });

  it.each(['missing', 'corrupt'])(
    'reads JSONL while a %s index is being opened and rebuilt',
    async (kind) => {
      writeDay(today, [event(`${today}T10:00:00.000Z`)]);
      if (kind === 'corrupt') {
        fs.mkdirSync(path.join(root, 'audit-index'));
        fs.writeFileSync(path.join(root, 'audit-index', 'audit-index.sqlite'), 'not a database');
      }
      audit.init({ userDataPath: root });
      const query = vi.spyOn(index, 'queryBefore');
      expect(audit.getEntriesBefore(cursor(), 25)[0].agent).toBe('fixture');
      expect(query).not.toHaveBeenCalled();
      await audit._awaitIndexForTest();
      expect(index.isReady()).toBe(true);
      expect(audit.getEntriesBefore(cursor(), 25)).toEqual(jsonl(cursor(), 25));
      expect(query).toHaveBeenCalledTimes(1);
    },
  );

  it('does not serve a stale ready index when the post-write stat fails', async () => {
    await open();
    audit.log('file-access', { agent: 'just-written' });
    const stat = fs.statSync;
    const spy = vi.spyOn(fs, 'statSync').mockImplementation((...args) => {
      if (String(args[0]) === dayFile(today)) throw new Error('fixture stat failure');
      return stat(...args);
    });
    const result = audit.getEntriesBefore(cursor(), 25);
    spy.mockRestore();
    expect(result[0].agent).toBe('just-written');
    expect(index.isReady()).toBe(false);
  });

  it('falls back without exposing raw record contents when indexed raw JSON is damaged', async () => {
    writeDay(today, [event(`${today}T10:00:00.000Z`)]);
    await open();
    index
      ._dbForTest()
      .prepare('UPDATE audit_events SET raw = ?')
      .run('SECRET-FIXTURE-invalid-json');
    expect(audit.getEntriesBefore(cursor(), 25)).toEqual(jsonl(cursor(), 25));
    expect(index.status().lastError).not.toContain('SECRET-FIXTURE');
  });

  it('flushes buffered entries before the indexed read and falls back during a continuity rebuild', async () => {
    await open();
    audit.log('file-access', { agent: 'buffered' });
    expect(audit.getEntriesBefore(cursor(), 25)[0].agent).toBe('buffered');
    fs.appendFileSync(
      dayFile(today),
      JSON.stringify(event(new Date().toISOString(), 'file-access', { agent: 'external' })) + '\n',
    );
    audit.log('file-access', { agent: 'next' });
    const result = audit.getEntriesBefore(cursor(), 25);
    expect(result.map((r) => r.agent)).toContain('external');
    expect(index.isReady()).toBe(false);
    await audit._awaitIndexForTest();
    expect(index.isReady()).toBe(true);
    expect(audit.getEntriesBefore(cursor(), 25)).toEqual(jsonl(cursor(), 25));
  });
});
