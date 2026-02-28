import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';

describe('audit-logger', () => {
  let auditLogger;
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-audit-test-'));
    vi.resetModules();
    const require = createRequire(import.meta.url);
    auditLogger = require('../../src/main/audit-logger');
  });

  afterEach(() => {
    auditLogger.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('init() creates audit-logs dir', () => {
    const auditDir = path.join(tmpDir, 'audit-logs');
    auditLogger.init({ userDataPath: tmpDir });
    expect(fs.existsSync(auditDir)).toBe(true);
  });

  it('log() creates structured entry with all fields', () => {
    auditLogger.init({ userDataPath: tmpDir });
    auditLogger.log('file-access', {
      agent: 'Claude',
      action: 'read',
      path: '/test/file.js',
      severity: 'high',
      riskScore: 42,
    });
    auditLogger.flush();

    const auditDir = path.join(tmpDir, 'audit-logs');
    const files = fs.readdirSync(auditDir).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(1);
    const content = fs.readFileSync(path.join(auditDir, files[0]), 'utf-8');
    const entry = JSON.parse(content.trim().split('\n')[0]);
    expect(entry).toMatchObject({
      type: 'file-access',
      agent: 'Claude',
      action: 'read',
      path: '/test/file.js',
      severity: 'high',
      riskScore: 42,
    });
    expect(entry.timestamp).toBeDefined();
  });

  it('buffered writes accumulate until flush', () => {
    auditLogger.init({ userDataPath: tmpDir });
    auditLogger.log('test', { agent: 'A' });
    auditLogger.log('test', { agent: 'B' });

    const auditDir = path.join(tmpDir, 'audit-logs');
    const filesBefore = fs.readdirSync(auditDir).filter((f) => f.endsWith('.json'));
    expect(filesBefore).toHaveLength(0);

    auditLogger.flush();
    const filesAfter = fs.readdirSync(auditDir).filter((f) => f.endsWith('.json'));
    expect(filesAfter).toHaveLength(1);
    const content = fs.readFileSync(path.join(auditDir, filesAfter[0]), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
  });

  it('auto-flush at threshold', () => {
    auditLogger.init({ userDataPath: tmpDir });
    for (let i = 0; i < 50; i++) {
      auditLogger.log('test', { agent: `A${i}` });
    }
    const auditDir = path.join(tmpDir, 'audit-logs');
    const files = fs.readdirSync(auditDir).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(1);
    const content = fs.readFileSync(path.join(auditDir, files[0]), 'utf-8');
    expect(content.trim().split('\n')).toHaveLength(50);
  });

  it('getStats() returns correct stats', () => {
    auditLogger.init({ userDataPath: tmpDir });
    auditLogger.log('test', { agent: 'A' });
    auditLogger.log('test', { agent: 'B' });
    auditLogger.flush();
    auditLogger.log('test', { agent: 'C' });

    const stats = auditLogger.getStats();
    expect(stats.totalEntries).toBe(3);
    expect(stats.totalSize).toBeGreaterThan(0);
    expect(stats.firstEntry).toBeDefined();
    expect(stats.lastEntry).toBeDefined();
  });

  it('exportAll() reads all audit files', () => {
    auditLogger.init({ userDataPath: tmpDir });
    auditLogger.log('t1', { agent: 'A' });
    auditLogger.log('t2', { agent: 'B' });

    const all = auditLogger.exportAll();
    expect(all).toHaveLength(2);
    expect(all[0].type).toBe('t1');
    expect(all[1].type).toBe('t2');
  });

  it('cleanOldLogs() removes old files', () => {
    auditLogger.init({ userDataPath: tmpDir });
    const auditDir = path.join(tmpDir, 'audit-logs');

    const oldDate = new Date(Date.now() - 60 * 86400000);
    const oldStr = `${oldDate.getFullYear()}-${String(oldDate.getMonth() + 1).padStart(2, '0')}-${String(oldDate.getDate()).padStart(2, '0')}`;
    const oldFile = path.join(auditDir, `aegis-audit-${oldStr}.json`);
    fs.writeFileSync(oldFile, '{"test":"old"}\n');

    const recentDate = new Date(Date.now() - 86400000);
    const recentStr = `${recentDate.getFullYear()}-${String(recentDate.getMonth() + 1).padStart(2, '0')}-${String(recentDate.getDate()).padStart(2, '0')}`;
    const recentFile = path.join(auditDir, `aegis-audit-${recentStr}.json`);
    fs.writeFileSync(recentFile, '{"test":"recent"}\n');

    auditLogger.shutdown();
    vi.resetModules();
    const require2 = createRequire(import.meta.url);
    auditLogger = require2('../../src/main/audit-logger');
    auditLogger.init({ userDataPath: tmpDir });

    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(recentFile)).toBe(true);
  });

  it('shutdown() flushes and stops timer', () => {
    auditLogger.init({ userDataPath: tmpDir });
    auditLogger.log('test', { agent: 'shutdown-test' });
    auditLogger.shutdown();

    const auditDir = path.join(tmpDir, 'audit-logs');
    const files = fs.readdirSync(auditDir).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(1);
    const content = fs.readFileSync(path.join(auditDir, files[0]), 'utf-8');
    expect(content).toContain('shutdown-test');
  });

  it('onFlushError callback fires on write failure', () => {
    const errorCb = vi.fn();
    auditLogger.init({ userDataPath: tmpDir, onFlushError: errorCb });

    const auditDir = path.join(tmpDir, 'audit-logs');
    fs.rmSync(auditDir, { recursive: true, force: true });

    auditLogger.log('test', { agent: 'err' });
    auditLogger.flush();
    expect(errorCb).toHaveBeenCalledTimes(1);
    expect(errorCb.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});
