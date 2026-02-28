import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import Module from 'module';
import fs from 'fs';
import path from 'path';
import os from 'os';

const require = createRequire(import.meta.url);

// Mock electron via Module._load interception
const mockShowSaveDialog = vi.fn();
const mockOpenPath = vi.fn();
const mockGetPath = vi.fn(() => os.tmpdir());

const fakeElectron = {
  dialog: { showSaveDialog: mockShowSaveDialog },
  shell: { openPath: mockOpenPath },
  app: { getPath: mockGetPath },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return fakeElectron;
  return originalLoad.apply(this, arguments);
};

describe('exports', () => {
  let exporter;
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-exports-test-'));
    mockShowSaveDialog.mockReset();
    mockOpenPath.mockReset();
    mockGetPath.mockReset().mockReturnValue(tmpDir);

    const modPath = require.resolve('../../src/main/exports.js');
    delete require.cache[modPath];
    exporter = require('../../src/main/exports.js');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function initExporter(overrides = {}) {
    const state = {
      activityLog: overrides.activityLog || [],
      getLatestNetConnections: () => overrides.netConns || [],
      monitoringStarted: overrides.monitoringStarted || Date.now() - 60000,
      getMainWindow: () => overrides.mainWindow || {},
      getStats: () => overrides.stats || {
        totalFiles: 10,
        totalSensitive: 2,
        peakAgents: 3,
        uniqueAgents: ['Claude', 'Copilot'],
        uptimeMs: 60000,
      },
    };
    exporter.init(state);
    return state;
  }

  describe('csvEscape', () => {
    it('exports CSV with comma-containing values properly escaped', async () => {
      const filePath = path.join(tmpDir, 'test.csv');
      initExporter({
        activityLog: [
          {
            timestamp: 1700000000000,
            agent: 'Claude, the AI',
            pid: 100,
            file: '/home/user/file.js',
            sensitive: false,
            reason: null,
            action: 'read',
          },
        ],
        netConns: [],
      });

      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath });
      await exporter.exportCsv();

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('"Claude, the AI"');
    });

    it('exports CSV with quote-containing values properly escaped', async () => {
      const filePath = path.join(tmpDir, 'test.csv');
      initExporter({
        activityLog: [
          {
            timestamp: 1700000000000,
            agent: 'Agent "X"',
            pid: 100,
            file: '/tmp/test.js',
            sensitive: true,
            reason: 'test',
            action: 'write',
          },
        ],
        netConns: [],
      });

      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath });
      await exporter.exportCsv();

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('"Agent ""X"""');
    });
  });

  describe('exportLog', () => {
    it('returns success:false when dialog is canceled', async () => {
      initExporter();
      mockShowSaveDialog.mockResolvedValue({ canceled: true });

      const result = await exporter.exportLog();
      expect(result.success).toBe(false);
    });

    it('writes valid JSON file with correct structure', async () => {
      const filePath = path.join(tmpDir, 'log.json');
      const started = Date.now() - 120000;
      initExporter({
        activityLog: [
          { timestamp: Date.now(), agent: 'Claude', pid: 100, file: '/a.js', sensitive: false, reason: null, action: 'read' },
          { timestamp: Date.now(), agent: 'Claude', pid: 100, file: '/b.js', sensitive: true, reason: 'SSH', action: 'read' },
        ],
        monitoringStarted: started,
        stats: { totalFiles: 2, totalSensitive: 1, peakAgents: 1, uniqueAgents: ['Claude'], uptimeMs: 120000 },
      });

      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath });
      const result = await exporter.exportLog();

      expect(result.success).toBe(true);
      expect(result.path).toBe(filePath);
      expect(result.eventCount).toBe(2);

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(data.exportedAt).toBeDefined();
      expect(data.monitoringStarted).toBeDefined();
      expect(data.uptimeSeconds).toBe(120);
      expect(data.summary.totalFiles).toBe(2);
      expect(data.summary.sensitiveFiles).toBe(1);
      expect(data.events).toHaveLength(2);
      expect(data.events[0].agent).toBe('Claude');
      expect(data.events[0].action).toBe('read');
    });

    it('defaults action to "accessed" when missing', async () => {
      const filePath = path.join(tmpDir, 'log.json');
      initExporter({
        activityLog: [
          { timestamp: Date.now(), agent: 'Claude', pid: 100, file: '/a.js', sensitive: false },
        ],
      });

      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath });
      await exporter.exportLog();

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(data.events[0].action).toBe('accessed');
    });
  });

  describe('exportCsv', () => {
    it('returns success:false when dialog is canceled', async () => {
      initExporter();
      mockShowSaveDialog.mockResolvedValue({ canceled: true });

      const result = await exporter.exportCsv();
      expect(result.success).toBe(false);
    });

    it('writes CSV with header row and data rows', async () => {
      const filePath = path.join(tmpDir, 'log.csv');
      initExporter({
        activityLog: [
          { timestamp: 1700000000000, agent: 'Claude', pid: 100, file: '/a.js', sensitive: false, action: 'read' },
          { timestamp: 1700000001000, agent: 'Claude', pid: 100, file: '/b.js', sensitive: true, action: 'write' },
        ],
        netConns: [],
      });

      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath });
      const result = await exporter.exportCsv();

      expect(result.success).toBe(true);
      expect(result.eventCount).toBe(2);

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      expect(lines[0]).toBe('Timestamp,Agent Name,Action Type,Target,Sensitive');
      expect(lines[1]).toContain('Claude');
      expect(lines[1]).toContain('read');
      expect(lines[1]).toContain('no');
      expect(lines[2]).toContain('write');
      expect(lines[2]).toContain('yes');
    });

    it('includes network connections in CSV', async () => {
      const filePath = path.join(tmpDir, 'log.csv');
      initExporter({
        activityLog: [],
        netConns: [
          { agent: 'Claude', remoteIp: '1.2.3.4', remotePort: 443, flagged: true },
        ],
      });

      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath });
      const result = await exporter.exportCsv();

      expect(result.success).toBe(true);
      expect(result.eventCount).toBe(1);

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('network');
      expect(content).toContain('1.2.3.4:443');
      expect(content).toContain('yes');
    });

    it('handles empty activity log and no net connections', async () => {
      const filePath = path.join(tmpDir, 'log.csv');
      initExporter({ activityLog: [], netConns: [] });

      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath });
      const result = await exporter.exportCsv();

      expect(result.success).toBe(true);
      expect(result.eventCount).toBe(0);

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content.trim()).toBe('Timestamp,Agent Name,Action Type,Target,Sensitive');
    });
  });

  describe('generateReport', () => {
    it('generates HTML report and returns path', async () => {
      initExporter({
        activityLog: [
          { timestamp: Date.now(), agent: 'Claude', sensitive: true, file: '/ssh/key', reason: 'SSH key', action: 'read' },
        ],
        netConns: [
          { agent: 'Claude', remoteIp: '1.2.3.4', remotePort: 443, domain: 'api.com', flagged: false, state: 'ESTAB' },
        ],
        stats: { totalFiles: 1, totalSensitive: 1, peakAgents: 1, uniqueAgents: ['Claude'], uptimeMs: 5000 },
      });

      const result = await exporter.generateReport();

      expect(result.success).toBe(true);
      expect(result.path).toContain('aegis-report-');
      expect(fs.existsSync(result.path)).toBe(true);

      const html = fs.readFileSync(result.path, 'utf-8');
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('AEGIS REPORT');
      expect(html).toContain('Claude');
      expect(html).toContain('SSH key');
      expect(html).toContain('1.2.3.4');
      expect(mockOpenPath).toHaveBeenCalledWith(result.path);
    });

    it('shows "No file activity" when activity log is empty', async () => {
      initExporter({
        activityLog: [],
        netConns: [],
        stats: { totalFiles: 0, totalSensitive: 0, peakAgents: 0, uniqueAgents: [], uptimeMs: 1000 },
      });

      const result = await exporter.generateReport();
      const html = fs.readFileSync(result.path, 'utf-8');
      expect(html).toContain('No file activity recorded');
    });

    it('HTML-escapes agent names to prevent XSS', async () => {
      initExporter({
        activityLog: [
          { timestamp: Date.now(), agent: '<script>alert(1)</script>', sensitive: false, file: '/f', action: 'r' },
        ],
        netConns: [],
        stats: { totalFiles: 1, totalSensitive: 0, peakAgents: 1, uniqueAgents: ['test'], uptimeMs: 1000 },
      });

      const result = await exporter.generateReport();
      const html = fs.readFileSync(result.path, 'utf-8');
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;script&gt;');
    });
  });

  describe('formatUptimeReport (tested through generateReport)', () => {
    it('formats hours, minutes, seconds correctly', async () => {
      initExporter({
        activityLog: [],
        netConns: [],
        stats: {
          totalFiles: 0,
          totalSensitive: 0,
          peakAgents: 0,
          uniqueAgents: [],
          uptimeMs: 3723000,
        },
      });

      const result = await exporter.generateReport();
      const html = fs.readFileSync(result.path, 'utf-8');
      expect(html).toContain('1h 2m 3s');
    });
  });
});
