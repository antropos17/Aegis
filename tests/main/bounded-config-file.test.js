import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import configFile from '../../src/main/bounded-config-file.js';

const { readBoundedConfigFile, readBoundedArchiveFile, MAX_CONFIG_BYTES } = configFile;
let directory;
let filename;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-settings-file-'));
  filename = path.join(directory, 'settings.json');
});

afterEach(() => {
  vi.restoreAllMocks();
  expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));
  fs.rmSync(directory, { recursive: true, force: true });
});

describe('bounded configuration file reads', () => {
  it('reads the complete selected regular file', () => {
    const source = JSON.stringify({ darkMode: true, anthropicApiKey: 'private-fixture' });
    fs.writeFileSync(filename, source);
    expect(readBoundedConfigFile(filename)).toBe(source);
  });

  it('refuses an oversized file before reading its content', () => {
    fs.writeFileSync(filename, 'x');
    fs.truncateSync(filename, MAX_CONFIG_BYTES + 1);
    const read = vi.spyOn(fs, 'readSync');
    expect(() => readBoundedConfigFile(filename)).toThrow('config-file-unavailable');
    expect(read).not.toHaveBeenCalled();
  });

  it('refuses a file that grows while its handle is being read', () => {
    fs.writeFileSync(filename, '{}');
    const original = fs.readSync.bind(fs);
    vi.spyOn(fs, 'readSync').mockImplementationOnce((...args) => {
      const count = original(...args);
      fs.appendFileSync(filename, 'x');
      return count;
    });
    expect(() => readBoundedConfigFile(filename)).toThrow('config-file-unavailable');
  });

  it('uses the archive-compatible read path and enforces its size', () => {
    fs.writeFileSync(filename, 'trusted rule');
    const read = vi.spyOn(fs, 'readFileSync');
    expect(readBoundedArchiveFile(filename)).toBe('trusted rule');
    expect(read).toHaveBeenCalledWith(filename);

    fs.truncateSync(filename, MAX_CONFIG_BYTES + 1);
    read.mockClear();
    expect(() => readBoundedArchiveFile(filename)).toThrow('config-file-unavailable');
    expect(read).not.toHaveBeenCalled();
  });
});
