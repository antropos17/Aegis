import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('logger', () => {
  let logger;
  let tmpDir;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-logger-test-'));
    vi.resetModules();
    const mod = await import('../../src/main/logger.js');
    logger = mod.default;
  });

  afterEach(() => {
    logger.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('init() creates log dir', () => {
    const logDir = path.join(tmpDir, 'logs');
    logger.init({ userDataPath: tmpDir });
    expect(fs.existsSync(logDir)).toBe(true);
  });

  it('info/warn/error/debug buffer entries with correct structure', () => {
    logger.init({ userDataPath: tmpDir });
    logger.info('mod1', 'hello');
    logger.warn('mod2', 'warning', { key: 'val' });
    logger.error('mod3', 'error msg');
    logger.debug('mod4', 'debug msg');
    logger.flush();

    const logDir = path.join(tmpDir, 'logs');
    const files = fs.readdirSync(logDir).filter((f) => f.endsWith('.log'));
    expect(files.length).toBe(1);

    const content = fs.readFileSync(path.join(logDir, files[0]), 'utf-8');
    const lines = content.trim().split('\n').map(JSON.parse);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({ level: 'info', module: 'mod1', message: 'hello' });
    expect(lines[0].timestamp).toBeDefined();
    expect(lines[1]).toMatchObject({ level: 'warn', module: 'mod2', meta: { key: 'val' } });
    expect(lines[2]).toMatchObject({ level: 'error', module: 'mod3' });
    expect(lines[3]).toMatchObject({ level: 'debug', module: 'mod4' });
  });

  it('level filtering (minLevel=warn silences debug/info)', () => {
    logger.init({ userDataPath: tmpDir, minLevel: 'warn' });
    logger.debug('m', 'debug');
    logger.info('m', 'info');
    logger.warn('m', 'warn');
    logger.error('m', 'error');
    logger.flush();

    const logDir = path.join(tmpDir, 'logs');
    const files = fs.readdirSync(logDir).filter((f) => f.endsWith('.log'));
    expect(files.length).toBe(1);
    const lines = fs.readFileSync(path.join(logDir, files[0]), 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const parsed = lines.map(JSON.parse);
    expect(parsed[0].level).toBe('warn');
    expect(parsed[1].level).toBe('error');
  });

  it('flush() no-op when buffer empty', () => {
    logger.init({ userDataPath: tmpDir });
    logger.flush();
    const logDir = path.join(tmpDir, 'logs');
    const files = fs.readdirSync(logDir).filter((f) => f.endsWith('.log'));
    expect(files).toHaveLength(0);
  });

  it('does not copy a private write error into operational diagnostics', () => {
    logger.init({ userDataPath: tmpDir });
    logger.info('fixture', 'queued entry');
    const append = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {
      throw new Error('PRIVATE_LOG_PATH_CANARY');
    });
    const output = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      logger.flush();
      expect(output).toHaveBeenCalledWith('[logger] flush write failed');
      expect(JSON.stringify(output.mock.calls)).not.toContain('PRIVATE_LOG_PATH_CANARY');
    } finally {
      append.mockRestore();
      output.mockRestore();
    }
  });

  it('auto-flush at FLUSH_THRESHOLD (50)', () => {
    logger.init({ userDataPath: tmpDir });
    for (let i = 0; i < 50; i++) {
      logger.info('m', `msg-${i}`);
    }
    const logDir = path.join(tmpDir, 'logs');
    const files = fs.readdirSync(logDir).filter((f) => f.endsWith('.log'));
    expect(files.length).toBe(1);
    const content = fs.readFileSync(path.join(logDir, files[0]), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines.length).toBe(50);
  });

  it('getStats() returns correct counts (disk + buffer)', () => {
    logger.init({ userDataPath: tmpDir });
    logger.info('m', 'msg1');
    logger.info('m', 'msg2');
    logger.flush();
    logger.info('m', 'msg3');

    const stats = logger.getStats();
    expect(stats.todayEntries).toBe(3);
    expect(stats.totalFiles).toBe(1);
    expect(stats.logDir).toBe(path.join(tmpDir, 'logs'));
  });

  it('seeds an existing large daily log without reading the whole file synchronously', async () => {
    const logDir = path.join(tmpDir, 'logs');
    fs.mkdirSync(logDir);
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const todayPath = path.join(logDir, `aegis-${day}.log`);
    fs.writeFileSync(todayPath, '{"message":"existing entry"}\n'.repeat(50_000));
    const read = vi.spyOn(fs, 'readFileSync');

    try {
      logger.init({ userDataPath: tmpDir });
      expect(read.mock.calls.some(([file]) => file === todayPath)).toBe(false);
      await vi.waitFor(() => expect(logger.getStats().todayEntries).toBe(50_000), {
        timeout: 5000,
      });
    } finally {
      read.mockRestore();
    }
  });

  it('rotates closed daily files before they exceed the storage budget', () => {
    logger.init({ userDataPath: tmpDir });
    const payload = 'x'.repeat(50_000);
    for (let i = 0; i < 300; i++) logger.info('rotation', `${i}:${payload}`);
    logger.flush();

    const logDir = path.join(tmpDir, 'logs');
    const files = fs.readdirSync(logDir).filter((file) => file.endsWith('.log'));
    expect(files.length).toBeGreaterThan(1);
    expect(files.length).toBeLessThanOrEqual(4);
    expect(
      files.every((file) => fs.statSync(path.join(logDir, file)).size <= 2 * 1024 * 1024),
    ).toBe(true);
    const retained = logger.exportAll().map((entry) => Number(entry.message.split(':', 1)[0]));
    expect(retained).toContain(299);
    expect(retained).not.toContain(0);
    expect(retained).toEqual([...retained].sort((a, b) => a - b));
    expect(logger.getStats().todayEntries).toBe(300);
  });

  it('restores the durable daily count after rotation without opening log bodies', async () => {
    logger.init({ userDataPath: tmpDir });
    for (let i = 0; i < 300; i++) logger.info('rotation', `${i}:${'x'.repeat(50_000)}`);
    logger.shutdown();

    const read = vi.spyOn(fs, 'readFileSync');
    try {
      vi.resetModules();
      logger = (await import('../../src/main/logger.js')).default;
      logger.init({ userDataPath: tmpDir });
      expect(logger.getStats().todayEntries).toBe(300);
      expect(read.mock.calls.some(([file]) => String(file).endsWith('.log'))).toBe(false);
    } finally {
      read.mockRestore();
    }
  });

  it('omits an oversized entry without retaining its private content', () => {
    logger.init({ userDataPath: tmpDir });
    logger.info('fixture', 'private-canary-' + 'x'.repeat(200_000));
    logger.flush();
    const [entry] = logger.exportAll();
    expect(entry.message).toContain('omitted');
    expect(JSON.stringify(entry)).not.toContain('private-canary');
    const logName = fs.readdirSync(logger.getLogDir()).find((name) => name.endsWith('.log'));
    expect(fs.statSync(path.join(logger.getLogDir(), logName)).size).toBeLessThan(64 * 1024);
  });

  it('counts malformed non-empty legacy lines without loading them all at once', async () => {
    const logDir = path.join(tmpDir, 'logs');
    fs.mkdirSync(logDir);
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    fs.writeFileSync(path.join(logDir, `aegis-${day}.log`), '{"message":"ok"}\nnot-json\n\n');
    logger.init({ userDataPath: tmpDir });
    await vi.waitFor(() => expect(logger.getStats().todayEntries).toBe(2));
    expect(logger.exportAll()).toEqual([{ message: 'ok' }]);
  });

  it('does not count or export a log filename that points outside the log directory', () => {
    const logDir = path.join(tmpDir, 'logs');
    fs.mkdirSync(logDir);
    const outside = path.join(tmpDir, 'private.json');
    fs.writeFileSync(outside, '{"private":"canary"}\n');
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    fs.symlinkSync(outside, path.join(logDir, `aegis-${day}.log`), 'file');

    logger.init({ userDataPath: tmpDir });
    expect(logger.getStats().totalFiles).toBe(0);
    expect(logger.exportAll()).toEqual([]);
  });

  it('exportAll() reads and parses all log files', () => {
    logger.init({ userDataPath: tmpDir });
    logger.info('m', 'one');
    logger.warn('m', 'two');
    logger.flush();

    const all = logger.exportAll();
    expect(all).toHaveLength(2);
    expect(all[0].message).toBe('one');
    expect(all[1].message).toBe('two');
  });

  it('cleanOldLogs() deletes files > 30 days, keeps recent', async () => {
    logger.init({ userDataPath: tmpDir });
    const logDir = path.join(tmpDir, 'logs');

    const oldDate = new Date(Date.now() - 60 * 86400000);
    const oldStr = `${oldDate.getFullYear()}-${String(oldDate.getMonth() + 1).padStart(2, '0')}-${String(oldDate.getDate()).padStart(2, '0')}`;
    const oldFile = path.join(logDir, `aegis-${oldStr}.log`);
    fs.writeFileSync(oldFile, '{"test":"old"}\n');
    const oldRotation = path.join(logDir, `aegis-${oldStr}.1.log`);
    fs.writeFileSync(oldRotation, '{"test":"old rotation"}\n');
    const oldCount = path.join(logDir, `aegis-${oldStr}.count`);
    fs.writeFileSync(oldCount, '{"count":2,"bytes":42}');
    const backupFile = path.join(logDir, `aegis-${oldStr}.log.backup.log`);
    fs.writeFileSync(backupFile, '{"test":"backup"}\n');

    const recentDate = new Date(Date.now() - 86400000);
    const recentStr = `${recentDate.getFullYear()}-${String(recentDate.getMonth() + 1).padStart(2, '0')}-${String(recentDate.getDate()).padStart(2, '0')}`;
    const recentFile = path.join(logDir, `aegis-${recentStr}.log`);
    fs.writeFileSync(recentFile, '{"test":"recent"}\n');

    logger.shutdown();
    vi.resetModules();
    const mod2 = await import('../../src/main/logger.js');
    logger = mod2.default;
    logger.init({ userDataPath: tmpDir });
    await new Promise((r) => setImmediate(r));

    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(oldRotation)).toBe(false);
    expect(fs.existsSync(oldCount)).toBe(false);
    expect(fs.existsSync(recentFile)).toBe(true);
    expect(fs.existsSync(backupFile)).toBe(true);
    expect(logger.getStats()).toMatchObject({ totalFiles: 1, recordingSince: recentStr });
    expect(logger.exportAll()).toEqual([{ test: 'recent' }]);
  });

  it('shutdown() clears timer and flushes', () => {
    logger.init({ userDataPath: tmpDir });
    logger.info('m', 'before-shutdown');
    logger.shutdown();

    const logDir = path.join(tmpDir, 'logs');
    const files = fs.readdirSync(logDir).filter((f) => f.endsWith('.log'));
    expect(files.length).toBe(1);
    const content = fs.readFileSync(path.join(logDir, files[0]), 'utf-8');
    expect(content).toContain('before-shutdown');
  });

  it('dev mode writes to stderr', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    logger.init({ userDataPath: tmpDir, isDev: true });
    logger.info('test', 'dev message');
    expect(stderrSpy).toHaveBeenCalled();
    const output = stderrSpy.mock.calls[0][0];
    expect(output).toContain('dev message');
    expect(output).toContain('INFO');
    stderrSpy.mockRestore();
  });
});
