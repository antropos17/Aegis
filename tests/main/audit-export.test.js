import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('complete audit exports', () => {
  let audit;
  let root;
  const file = (day) => path.join(audit.getLogDir(), `aegis-audit-${day}.json`);
  const write = (day, contents) => fs.writeFileSync(file(day), contents);

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-export-'));
    vi.resetModules();
    audit = (await import('../../src/main/audit-logger.js')).default;
    audit.init({ userDataPath: root, loadSqlite: () => null });
    await audit._awaitIndexForTest();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await audit._awaitIndexForTest();
    audit.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('exports an empty initialized journal', () => {
    expect(audit.exportAll()).toEqual([]);
  });

  it('rejects a missing log directory instead of exporting an empty history', () => {
    fs.rmdirSync(audit.getLogDir());
    expect(() => audit.exportAll()).toThrow('Audit export incomplete');
  });

  it('rejects a read failure after an earlier file succeeded, then recovers', () => {
    write('2026-09-06', '{"type":"first"}\n');
    write('2026-09-07', '{"type":"second"}\n');
    write('2026-09-08', '{"type":"third"}\n');
    const read = fs.readFileSync;
    const spy = vi.spyOn(fs, 'readFileSync').mockImplementation((p, ...args) => {
      if (p === file('2026-09-07'))
        throw Object.assign(new Error('private-fixture-path'), { code: 'EACCES' });
      return read(p, ...args);
    });
    expect(() => audit.exportAll()).toThrow('Audit export incomplete');
    expect(() => audit.exportAll()).not.toThrow('private-fixture-path');
    spy.mockRestore();
    expect(audit.exportAll().map((entry) => entry.type)).toEqual(['first', 'second', 'third']);
  });

  it('rejects malformed records without changing their source or hiding them from the failure', () => {
    const contents = '{"type":"first"}\nnot-json-private-fixture\n{"type":"last"}\n';
    write('2026-09-07', contents);
    expect(() => audit.exportAll()).toThrow('Audit export incomplete');
    expect(() => audit.exportAll()).not.toThrow('not-json-private-fixture');
    expect(fs.readFileSync(file('2026-09-07'), 'utf8')).toBe(contents);
  });

  it('preserves raw legacy records, loss markers and unknown fields across files', () => {
    const rows = [
      { type: 'file-access', details: { pid: 7 }, unknownField: 'keep' },
      { schemaVersion: 1, type: 'buffer-overflow-drop', droppedCount: 2, seq: 0, hash: 'raw' },
    ];
    write('2026-09-06', JSON.stringify(rows[0]) + '\r\n\r\n');
    write('2026-09-07', JSON.stringify(rows[1]));
    expect(audit.exportAll()).toEqual(rows);
  });

  it.each([10, 0])(
    'rejects failed flushes with buffer cap %i and succeeds after recovery',
    (cap) => {
      audit.shutdown();
      audit.init({ userDataPath: root, bufferCap: cap, loadSqlite: () => null });
      const append = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {
        throw Object.assign(new Error('fixture disk full'), { code: 'ENOSPC' });
      });
      audit.log('file-access', { agent: 'fixture' });
      expect(() => audit.exportAll()).toThrow('Audit export incomplete');
      append.mockRestore();
      const rows = audit.exportAll();
      expect(rows.map((entry) => entry.type)).toEqual([
        cap === 0 ? 'buffer-overflow-drop' : 'file-access',
      ]);
      const dayFile = fs.readdirSync(audit.getLogDir()).find((name) => name.endsWith('.json'));
      expect(audit.verifyChain(path.join(audit.getLogDir(), dayFile)).valid).toBe(true);
    },
  );
});
