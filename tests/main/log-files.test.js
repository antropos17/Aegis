/**
 * @file log-files.test.js
 * @description Direct boundary tests for src/main/log-files.js.
 *
 * Covers: corrupt/oversized .count files, negative/fractional/unsafe counts,
 * mismatched byte totals, MAX_ENTRY_BYTES UTF-8 byte counting, chronological
 * read order across rotations, retention cutoff boundaries, unrelated
 * filenames, symlink/directory safety, unlink-failure resilience, and
 * diagnostic path redaction.
 *
 * Happy-path log I/O is covered by tests/main/logger.test.js and is not
 * duplicated here.
 *
 * Targeted run:
 *   npx vitest run tests/main/log-files.test.js tests/main/logger.test.js
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import logFiles from '../../src/main/log-files.js';

const { MAX_ENTRY_BYTES, appendLines, cleanOldLogs, dateKey, listLogFiles, readCount, scanCount } =
  logFiles;

// Deterministic date helpers — use fixed past dates so retention tests
// never collide with "today" in CI.
const DAY_A = '2024-01-10';
const DAY_B = '2024-01-11';
const DAY_OLD = '2023-12-01'; // well before any retention cutoff in tests

function writeFile(dir, name, content) {
  fs.writeFileSync(path.join(dir, name), content, 'utf-8');
}

function logName(day, rotation = 0) {
  return rotation ? `aegis-${day}.${rotation}.log` : `aegis-${day}.log`;
}

function countName(day) {
  return `aegis-${day}.count`;
}

// ─── Setup ─────────────────────────────────────────────────────────────────

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-log-files-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── readCount: corrupt and oversized .count files ─────────────────────────

describe('readCount() — corrupt and oversized .count files', () => {
  it('returns null when the .count file is missing', () => {
    expect(readCount(tmpDir, DAY_A)).toBeNull();
  });

  it('returns null when the .count file is oversized (> 128 bytes)', () => {
    // Write a file whose size exceeds the 128-byte guard.
    const content = JSON.stringify({ count: 1, bytes: 0 }).padEnd(129, ' ');
    writeFile(tmpDir, countName(DAY_A), content);
    expect(readCount(tmpDir, DAY_A)).toBeNull();
  });

  it('returns null for syntactically corrupt JSON', () => {
    writeFile(tmpDir, countName(DAY_A), 'not-json');
    expect(readCount(tmpDir, DAY_A)).toBeNull();
  });

  it('returns null for a negative count', () => {
    writeFile(tmpDir, countName(DAY_A), JSON.stringify({ count: -1, bytes: 0 }));
    expect(readCount(tmpDir, DAY_A)).toBeNull();
  });

  it('returns null for a fractional count', () => {
    writeFile(tmpDir, countName(DAY_A), JSON.stringify({ count: 1.5, bytes: 0 }));
    expect(readCount(tmpDir, DAY_A)).toBeNull();
  });

  it('returns null for an unsafe-integer count', () => {
    writeFile(
      tmpDir,
      countName(DAY_A),
      JSON.stringify({ count: Number.MAX_SAFE_INTEGER + 1, bytes: 0 }),
    );
    expect(readCount(tmpDir, DAY_A)).toBeNull();
  });

  it('returns null when the stored bytes field does not match the actual log bytes', () => {
    // Write a log file so dayBytes > 0, but store a wrong bytes value.
    const logContent = 'line one\n';
    writeFile(tmpDir, logName(DAY_A), logContent);
    const actualBytes = Buffer.byteLength(logContent, 'utf-8');
    writeFile(
      tmpDir,
      countName(DAY_A),
      JSON.stringify({ count: 1, bytes: actualBytes + 99 }),
    );
    expect(readCount(tmpDir, DAY_A)).toBeNull();
  });

  it('returns the count when count is non-negative, safe integer and bytes match', () => {
    // No log files for DAY_A → dayBytes = 0.
    writeFile(tmpDir, countName(DAY_A), JSON.stringify({ count: 0, bytes: 0 }));
    expect(readCount(tmpDir, DAY_A)).toBe(0);
  });
});

// ─── appendLines: MAX_ENTRY_BYTES counts UTF-8 bytes plus the newline ────────

describe('appendLines() — MAX_ENTRY_BYTES boundary', () => {
  it('exports MAX_ENTRY_BYTES as 64 KiB', () => {
    expect(MAX_ENTRY_BYTES).toBe(64 * 1024);
  });

  it('accepts a line whose UTF-8 byte length is exactly MAX_ENTRY_BYTES - 1', () => {
    // ASCII: each char is 1 byte. MAX_ENTRY_BYTES - 1 bytes + 1 newline = MAX_ENTRY_BYTES total.
    const line = 'a'.repeat(MAX_ENTRY_BYTES - 1);
    expect(() => appendLines(tmpDir, DAY_A, [line])).not.toThrow();
  });

  it('rejects a line whose UTF-8 byte length is exactly MAX_ENTRY_BYTES', () => {
    // MAX_ENTRY_BYTES bytes + 1 newline > MAX_ENTRY_BYTES.
    const line = 'a'.repeat(MAX_ENTRY_BYTES);
    expect(() => appendLines(tmpDir, DAY_A, [line])).toThrow('Unbounded operational log entry');
  });

  it('counts multi-byte UTF-8 characters correctly', () => {
    // U+00A3 POUND SIGN is 2 UTF-8 bytes.
    // A string of (MAX_ENTRY_BYTES / 2) pound signs = MAX_ENTRY_BYTES bytes → rejected.
    const halfMax = MAX_ENTRY_BYTES / 2;
    const line = '£'.repeat(halfMax);
    expect(Buffer.byteLength(line, 'utf-8')).toBe(MAX_ENTRY_BYTES);
    expect(() => appendLines(tmpDir, DAY_A, [line])).toThrow('Unbounded operational log entry');
  });

  it('accepts a multi-byte line whose byte length is MAX_ENTRY_BYTES - 1', () => {
    // (MAX_ENTRY_BYTES / 2) - 1 pound signs = MAX_ENTRY_BYTES - 2 bytes; add one ASCII char.
    const halfMax = MAX_ENTRY_BYTES / 2;
    const line = '£'.repeat(halfMax - 1) + 'a'; // MAX_ENTRY_BYTES - 1 bytes
    expect(Buffer.byteLength(line, 'utf-8')).toBe(MAX_ENTRY_BYTES - 1);
    expect(() => appendLines(tmpDir, DAY_A, [line])).not.toThrow();
  });
});

// ─── listLogFiles / scanCount: chronological order across rotations ─────────

describe('listLogFiles() and scanCount() — chronological order across rotations', () => {
  it('listLogFiles returns files sorted by date asc, rotation desc within each date', () => {
    // Create files out of order; verify canonical order from listLogFiles.
    writeFile(tmpDir, logName(DAY_A, 1), 'r1\n');
    writeFile(tmpDir, logName(DAY_A, 0), 'r0\n');
    writeFile(tmpDir, logName(DAY_A, 2), 'r2\n');
    writeFile(tmpDir, logName(DAY_B, 0), 'b0\n');

    const files = listLogFiles(tmpDir);
    // Within DAY_A: rotation 2 (oldest), then 1, then 0 (newest).
    // DAY_A files all precede DAY_B files.
    const names = files.map((f) => f);
    expect(names).toEqual([
      logName(DAY_A, 2),
      logName(DAY_A, 1),
      logName(DAY_A, 0),
      logName(DAY_B, 0),
    ]);
  });

  it('scanCount sums lines across all rotations for a given day in chronological order', async () => {
    writeFile(tmpDir, logName(DAY_A, 2), 'line1\nline2\n');
    writeFile(tmpDir, logName(DAY_A, 1), 'line3\n');
    writeFile(tmpDir, logName(DAY_A, 0), 'line4\nline5\nline6\n');
    writeFile(tmpDir, logName(DAY_B, 0), 'other-day\n'); // must not be counted for DAY_A

    const count = await scanCount(tmpDir, DAY_A);
    expect(count).toBe(6);
  });

  it('scanCount skips empty lines and blank-only lines', async () => {
    writeFile(tmpDir, logName(DAY_A), 'valid\n\n   \nvalid\n');
    const count = await scanCount(tmpDir, DAY_A);
    expect(count).toBe(2);
  });
});

// ─── cleanOldLogs: retention cutoff boundaries ────────────────────────────

describe('cleanOldLogs() — retention boundaries', () => {
  it('keeps a file dated exactly at the cutoff date', () => {
    // Use a 30-day retention. The cutoff is 30 days ago.
    // A file dated exactly at the cutoff must be kept (match[1] >= cutoff).
    const cutoffDate = new Date(Date.now() - 30 * 86400000);
    const cutoffDay = dateKey(cutoffDate);
    writeFile(tmpDir, logName(cutoffDay), '{"keep":"me"}\n');
    cleanOldLogs(tmpDir, 30);
    expect(fs.existsSync(path.join(tmpDir, logName(cutoffDay)))).toBe(true);
  });

  it('deletes a file dated one day before the cutoff', () => {
    const oneDayBefore = new Date(Date.now() - 31 * 86400000);
    const beforeDay = dateKey(oneDayBefore);
    writeFile(tmpDir, logName(beforeDay), '{"delete":"me"}\n');
    cleanOldLogs(tmpDir, 30);
    expect(fs.existsSync(path.join(tmpDir, logName(beforeDay)))).toBe(false);
  });

  it('does not touch files with names that do not match log or count patterns', () => {
    // Unrelated filenames must be ignored.
    const unrelated = 'unrelated-aegis-2020-01-01.txt';
    writeFile(tmpDir, unrelated, 'safe\n');
    cleanOldLogs(tmpDir, 30);
    expect(fs.existsSync(path.join(tmpDir, unrelated))).toBe(true);
  });

  it('deletes both the log file and its .count file for an old day', () => {
    writeFile(tmpDir, logName(DAY_OLD), 'old\n');
    writeFile(tmpDir, countName(DAY_OLD), JSON.stringify({ count: 1, bytes: 4 }));
    cleanOldLogs(tmpDir, 1); // 1-day retention: DAY_OLD is far past
    expect(fs.existsSync(path.join(tmpDir, logName(DAY_OLD)))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, countName(DAY_OLD)))).toBe(false);
  });
});

// ─── Symlinks and directories with matching names ────────────────────────

describe('listLogFiles() and cleanOldLogs() — symlink and directory safety', () => {
  it('listLogFiles excludes a symlink whose name matches the log pattern', () => {
    // Write an external file the symlink points to.
    const external = path.join(tmpDir, 'external.log');
    fs.writeFileSync(external, 'external\n', 'utf-8');
    // Create a symlink with a matching log name.
    const symlinkPath = path.join(tmpDir, logName(DAY_A));
    fs.symlinkSync(external, symlinkPath, 'file');

    const files = listLogFiles(tmpDir);
    expect(files).not.toContain(logName(DAY_A));
    // The external file must be untouched.
    expect(fs.readFileSync(external, 'utf-8')).toBe('external\n');
  });

  it('cleanOldLogs does not unlink the symlink target when a matching symlink is old', () => {
    // An old symlink with a matching name must not cause the target to be deleted.
    const external = path.join(tmpDir, 'external.log');
    fs.writeFileSync(external, 'external\n', 'utf-8');
    const symlinkPath = path.join(tmpDir, logName(DAY_OLD));
    fs.symlinkSync(external, symlinkPath, 'file');

    cleanOldLogs(tmpDir, 1);
    // The external file must be untouched.
    expect(fs.readFileSync(external, 'utf-8')).toBe('external\n');
  });

  it('listLogFiles excludes a directory whose name matches the log pattern', () => {
    const dirPath = path.join(tmpDir, logName(DAY_A));
    fs.mkdirSync(dirPath);

    const files = listLogFiles(tmpDir);
    expect(files).not.toContain(logName(DAY_A));
  });

  it('cleanOldLogs does not delete a directory with a matching old name', () => {
    const dirPath = path.join(tmpDir, logName(DAY_OLD));
    fs.mkdirSync(dirPath);
    // Put a file inside the directory to verify it is not removed.
    writeFile(dirPath, 'inside.txt', 'safe\n');

    cleanOldLogs(tmpDir, 1);
    // The directory must survive.
    expect(fs.statSync(dirPath).isDirectory()).toBe(true);
  });
});

// ─── cleanOldLogs: unlink failure resilience ─────────────────────────────

describe('cleanOldLogs() — unlink failure resilience', () => {
  it('continues to clean the next eligible file when one unlink throws', () => {
    // Two old files. The first unlink throws; the second must still succeed.
    const file1 = path.join(tmpDir, logName(DAY_OLD, 1));
    const file2 = path.join(tmpDir, logName(DAY_OLD, 2));
    writeFile(tmpDir, logName(DAY_OLD, 1), 'one\n');
    writeFile(tmpDir, logName(DAY_OLD, 2), 'two\n');

    let callCount = 0;
    const realUnlink = fs.unlinkSync.bind(fs);
    vi.spyOn(fs, 'unlinkSync').mockImplementation((p) => {
      callCount++;
      if (callCount === 1) throw Object.assign(Error('/PRIVATE_PATH/aegis.log'), { code: 'EPERM' });
      realUnlink(p);
    });

    expect(() => cleanOldLogs(tmpDir, 1)).not.toThrow();
    vi.restoreAllMocks();

    // One of the two files was deleted; the other survived the injected error.
    const both = [fs.existsSync(file1), fs.existsSync(file2)];
    expect(both.filter(Boolean)).toHaveLength(1);
  });
});

// ─── cleanOldLogs: diagnostics exclude private path ──────────────────────

describe('cleanOldLogs() — diagnostic path redaction', () => {
  it('does not echo the private path from an injected exception to console.error', () => {
    writeFile(tmpDir, logName(DAY_OLD), 'old\n');

    const PRIVATE_PATH_CANARY = '/SECRET/PRIVATE_PATH_CANARY/aegis-old.log';
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {
      throw Object.assign(Error(PRIVATE_PATH_CANARY), { code: 'EPERM' });
    });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    cleanOldLogs(tmpDir, 1);

    const allArgs = consoleErrorSpy.mock.calls.flat().join('\n');
    expect(allArgs).not.toContain(PRIVATE_PATH_CANARY);
    // A diagnostic message was still emitted (confirming the error was noticed).
    expect(consoleErrorSpy).toHaveBeenCalled();

    vi.restoreAllMocks();
  });
});
