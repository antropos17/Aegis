import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';

describe('logger', () => {
  let logger;
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-logger-test-'));
    vi.resetModules();
    const require = createRequire(import.meta.url);
    logger = require('../../src/main/logger');
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

  it('cleanOldLogs() deletes files > 30 days, keeps recent', () => {
    logger.init({ userDataPath: tmpDir });
    const logDir = path.join(tmpDir, 'logs');

    const oldDate = new Date(Date.now() - 60 * 86400000);
    const oldStr = `${oldDate.getFullYear()}-${String(oldDate.getMonth() + 1).padStart(2, '0')}-${String(oldDate.getDate()).padStart(2, '0')}`;
    const oldFile = path.join(logDir, `aegis-${oldStr}.log`);
    fs.writeFileSync(oldFile, '{"test":"old"}\n');

    const recentDate = new Date(Date.now() - 86400000);
    const recentStr = `${recentDate.getFullYear()}-${String(recentDate.getMonth() + 1).padStart(2, '0')}-${String(recentDate.getDate()).padStart(2, '0')}`;
    const recentFile = path.join(logDir, `aegis-${recentStr}.log`);
    fs.writeFileSync(recentFile, '{"test":"recent"}\n');

    logger.shutdown();
    vi.resetModules();
    const require2 = createRequire(import.meta.url);
    logger = require2('../../src/main/logger');
    logger.init({ userDataPath: tmpDir });

    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(recentFile)).toBe(true);
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
