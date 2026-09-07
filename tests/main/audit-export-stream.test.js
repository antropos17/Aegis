import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { inflateRawSync } from 'zlib';
import { writeAuditExport } from '../../src/main/audit-export-stream.js';
import { createZip } from '../../src/main/zip-writer.js';

describe('streamed audit exports', () => {
  let root;
  let destination;
  const files = () =>
    fs
      .readdirSync(root)
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => {
        const filePath = path.join(root, name);
        const stat = fs.statSync(filePath);
        return { path: filePath, size: stat.size, dev: stat.dev, ino: stat.ino };
      });
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-stream-'));
    destination = path.join(root, 'export.json');
    fs.writeFileSync(destination, 'previous export');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const write = (text) => fs.writeFileSync(path.join(root, 'audit.jsonl'), text);
  const noTemporaryFiles = () =>
    expect(fs.readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([]);

  it('exports bounded source ranges and preserves raw records and unicode', async () => {
    const rows = [
      { type: 'file-access', path: 'проект/文件' },
      { type: 'buffer-overflow-drop', droppedCount: 3 },
    ];
    write(rows.map(JSON.stringify).join('\r\n'));
    const snapshot = files();
    fs.appendFileSync(snapshot[0].path, '\n{"type":"later"}\n');
    expect(await writeAuditExport({ filePath: destination, files: snapshot })).toMatchObject({
      success: true,
      count: 2,
    });
    expect(JSON.parse(fs.readFileSync(destination, 'utf8'))).toEqual(rows);
    noTemporaryFiles();
  });

  it.each(['malformed', 'oversize', 'missing', 'truncated'])(
    'preserves the destination and cleans up after %s input',
    async (mode) => {
      write(
        mode === 'malformed'
          ? '{"valid":1}\nbroken-secret'
          : mode === 'oversize'
            ? JSON.stringify({ text: 'x'.repeat(1024 * 1024) })
            : '{"valid":1}\n',
      );
      const snapshot = files();
      if (mode === 'missing') fs.unlinkSync(snapshot[0].path);
      if (mode === 'truncated') fs.truncateSync(snapshot[0].path, 0);
      await expect(writeAuditExport({ filePath: destination, files: snapshot })).rejects.toThrow(
        'Audit export incomplete',
      );
      expect(fs.readFileSync(destination, 'utf8')).toBe('previous export');
      noTemporaryFiles();
      write('{"recovered":true}\n');
      await expect(
        writeAuditExport({ filePath: destination, files: files() }),
      ).resolves.toMatchObject({ count: 1 });
    },
  );

  it('rejects replacing a source journal file', async () => {
    write('{"keep":true}\n');
    const snapshot = files();
    await expect(writeAuditExport({ filePath: snapshot[0].path, files: snapshot })).rejects.toThrow(
      'source journal',
    );
    expect(fs.readFileSync(snapshot[0].path, 'utf8')).toBe('{"keep":true}\n');
  });

  it('preserves the old destination if atomic replacement fails', async () => {
    write('{"valid":1}\n');
    vi.spyOn(fs.promises, 'rename').mockRejectedValue(
      Object.assign(new Error('fixture'), { code: 'EACCES' }),
    );
    await expect(writeAuditExport({ filePath: destination, files: files() })).rejects.toThrow(
      'Audit export incomplete',
    );
    expect(fs.readFileSync(destination, 'utf8')).toBe('previous export');
    noTemporaryFiles();
  });

  it('creates a ZIP with valid central directory, sizes, CRCs and all three entries', async () => {
    write('{"type":"first"}\n');
    await writeAuditExport({
      filePath: destination,
      files: files(),
      zip: true,
      extraEntries: [
        { name: 'activity-log.json', data: [{ action: 'fixture' }] },
        { name: 'config.json', data: { enabled: true } },
      ],
    });
    const zip = fs.readFileSync(destination);
    const end = zip.length - 22;
    expect(zip.readUInt32LE(end)).toBe(0x06054b50);
    expect(zip.readUInt16LE(end + 10)).toBe(3);
    let offset = zip.readUInt32LE(end + 16);
    const decoded = {};
    for (let i = 0; i < 3; i++) {
      expect(zip.readUInt32LE(offset)).toBe(0x02014b50);
      const nameLength = zip.readUInt16LE(offset + 28);
      const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
      const local = zip.readUInt32LE(offset + 42);
      const size = zip.readUInt32LE(offset + 20);
      const begin = local + 30 + zip.readUInt16LE(local + 26);
      const data = inflateRawSync(zip.subarray(begin, begin + size));
      expect(data.length).toBe(zip.readUInt32LE(offset + 24));
      expect(createZip([{ name, data }]).readUInt32LE(14)).toBe(zip.readUInt32LE(offset + 16));
      expect(zip.readUInt32LE(begin + size)).toBe(0x08074b50);
      decoded[name] = JSON.parse(data);
      offset += 46 + nameLength;
    }
    expect(offset).toBe(end);
    expect(decoded).toEqual({
      'audit-log.json': [{ type: 'first' }],
      'activity-log.json': [{ action: 'fixture' }],
      'config.json': { enabled: true },
    });
  });

  it('yields while exporting a large journal and rejects overlapping exports', async () => {
    write((JSON.stringify({ text: 'x'.repeat(200) }) + '\n').repeat(15000));
    let turns = 0;
    const timer = setInterval(() => turns++, 1);
    try {
      const running = writeAuditExport({ filePath: destination, files: files(), zip: true });
      await expect(writeAuditExport({ filePath: destination, files: files() })).rejects.toThrow(
        'already running',
      );
      await running;
      expect(turns).toBeGreaterThan(2);
    } finally {
      clearInterval(timer);
    }
    noTemporaryFiles();
  });
});
