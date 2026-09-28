import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createVmJournal, readVmJournal } from '../../scripts/qualification/vm-journal.mjs';
import { identity, key } from '../fixtures/vm-synthetic-backend.mjs';

describe('bounded developer recovery journal', () => {
  let root, filename, writer;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-vm-journal-'));
    filename = path.join(root, 'owned.jsonl');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    writer?.close();
    writer = undefined;
    for (const file of fs.readdirSync(root)) fs.unlinkSync(path.join(root, file));
    fs.rmdirSync(root);
  });

  it('fsyncs before returning and recovery never resumes even a released session', () => {
    const sync = vi.spyOn(fs, 'fsyncSync');
    writer = createVmJournal(filename, identity);
    for (const event of ['created', 'start-intent', 'ready', 'release-intent', 'released'])
      writer.append(event);
    expect(sync).toHaveBeenCalledTimes(5);
    writer.close();
    expect(readVmJournal(filename, identity)).toMatchObject({
      rows: 5,
      state: 'cleanup-unknown',
      launchAllowed: false,
    });
    expect(fs.readFileSync(filename, 'utf8')).not.toContain(key.toString('hex'));
    expect(() => createVmJournal(filename, identity)).toThrow();
  });

  it('handles short writes without producing a truncated successful record', () => {
    const original = fs.writeSync;
    vi.spyOn(fs, 'writeSync').mockImplementation((fd, buffer, offset, length) =>
      original(fd, buffer, offset, Math.min(length, 7)),
    );
    writer = createVmJournal(filename, identity);
    writer.append('created');
    writer.close();
    expect(readVmJournal(filename, identity).rows).toBe(1);
  });

  it('rejects a zero-byte write and refuses empty recovery', () => {
    writer = createVmJournal(filename, identity);
    vi.spyOn(fs, 'writeSync').mockReturnValue(0);
    expect(() => writer.append('created')).toThrow('vm-journal-unavailable');
    expect(() => writer.append('ready')).toThrow();
    writer.close();
    expect(() => readVmJournal(filename, identity)).toThrow();
  });

  it('makes a sync failure sticky and never appends a later success', () => {
    writer = createVmJournal(filename, identity);
    const sync = vi.spyOn(fs, 'fsyncSync').mockImplementationOnce(() => {
      throw new Error('disk');
    });
    expect(() => writer.append('created')).toThrow('vm-journal-unavailable');
    sync.mockRestore();
    expect(() => writer.append('ready')).toThrow();
    expect(fs.readFileSync(filename, 'utf8')).not.toContain('ready');
  });

  it('bounds growth and retains existing evidence on exhaustion', () => {
    writer = createVmJournal(filename, identity);
    let count = 0;
    for (; count < 1000; count++) {
      try {
        writer.append('cleanup-unknown');
      } catch {
        break;
      }
    }
    const size = fs.statSync(filename).size;
    expect(count).toBeGreaterThan(1);
    expect(count).toBeLessThanOrEqual(128);
    expect(size).toBeLessThanOrEqual(65536);
    expect(() => writer.append('stopped')).toThrow();
    expect(fs.statSync(filename).size).toBe(size);
    writer.close();
    expect(readVmJournal(filename, identity).rows).toBe(count);
  });

  it.each(['partial', 'changed', 'reordered', 'oversized', 'foreign', 'unknown-field'])(
    'refuses %s recovery data',
    (kind) => {
      writer = createVmJournal(filename, identity);
      writer.append('created');
      writer.append('start-intent');
      writer.close();
      let text = fs.readFileSync(filename, 'utf8');
      if (kind === 'partial') text = text.slice(0, -1);
      if (kind === 'changed') text = text.replace('start-intent', 'released');
      if (kind === 'reordered') text = text.trimEnd().split('\n').reverse().join('\n') + '\n';
      if (kind === 'oversized') text = 'x'.repeat(65537);
      if (kind === 'unknown-field')
        text = text.replace('"version":1', '"version":1,"command":"secret"');
      fs.writeFileSync(filename, text);
      const registration =
        kind === 'foreign'
          ? { ...identity, vmId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }
          : identity;
      expect(() => readVmJournal(filename, registration)).toThrow();
    },
  );
});
