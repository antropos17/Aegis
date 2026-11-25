import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import Module from 'module';
import fs from 'fs';
import path from 'path';
import os from 'os';

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
Module._load = function (request, _parent, _isMain) {
  if (request === 'electron') return fakeElectron;
  return originalLoad.apply(this, arguments);
};

afterAll(() => {
  Module._load = originalLoad;
});

describe('exports', () => {
  let exporter;
  let tmpDir;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-exports-test-'));
    mockShowSaveDialog.mockReset();
    mockOpenPath.mockReset();
    mockGetPath.mockReset().mockReturnValue(tmpDir);

    vi.resetModules();
    const mod = await import('../../src/main/exports.js');
    exporter = mod.default;
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
      getStats: () =>
        overrides.stats || {
          totalFiles: 10,
          totalSensitive: 2,
          aiSensitive: 1,
          uptimeMs: 60000,
          monitoringStarted: Date.now() - 60000,
          peakAgents: 3,
          currentAgents: 2,
          aiAgentCount: 2,
          otherAgentCount: 0,
          uniqueAgents: ['Claude', 'Copilot'],
        },
    };
    exporter.init(state);
    return state;
  }

  const EXPECTED_CSV_HEADER =
    'Timestamp,Agent Name,Action Type,Target,Sensitive,PID,Instance ID,Source,' +
    'Attribution,Attribution Evidence,Network Verdict,Network Verdict Reason';

  function parseCsv(content) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < content.length; i++) {
      const ch = content[i];
      if (inQuotes) {
        if (ch === '"' && content[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cell += ch;
        }
        continue;
      }
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(cell);
        cell = '';
      } else if (ch === '\n') {
        row.push(cell);
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
        cell = '';
      } else if (ch !== '\r') {
        cell += ch;
      }
    }
    if (inQuotes) throw new Error('Unterminated CSV quote');
    if (cell.length > 0 || row.length > 0) {
      row.push(cell);
      rows.push(row);
    }
    return rows;
  }

  it.each([
    ['exportLog', 'json'],
    ['exportCsv', 'csv'],
  ])(
    '%s skips the file write when the caller loses ownership during the dialog',
    async (method, ext) => {
      const filePath = path.join(tmpDir, `denied.${ext}`);
      initExporter();
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath });
      expect(await exporter[method](() => false)).toEqual({ success: false });
      expect(fs.existsSync(filePath)).toBe(false);
    },
  );

  describe('csvEscape', () => {
    it.each(['=1+1', '+SUM(1,2)', '-1+2', '@SUM(1)', '  =1+1', '\t=1+1', '\r=1+1'])(
      'exports formula-like text as a literal cell: %j',
      async (payload) => {
        const filePath = path.join(tmpDir, 'formula.csv');
        initExporter({
          activityLog: [
            { timestamp: 1700000000000, agent: 'Fixture', file: payload, action: 'read' },
          ],
        });
        mockShowSaveDialog.mockResolvedValue({ filePath });
        expect((await exporter.exportCsv()).success).toBe(true);
        const expected = "'" + payload;
        const escaped = /[",\r\n]/.test(expected)
          ? '"' + expected.replace(/"/g, '""') + '"'
          : expected;
        expect(fs.readFileSync(filePath, 'utf8')).toContain(',' + escaped + ',');
      },
    );

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
    it('preserves recorded process lifetimes and only allowlisted attribution evidence', async () => {
      const filePath = path.join(tmpDir, 'provenance.json');
      const hostile = 'fixture-secret-must-not-export';
      initExporter({
        activityLog: ['100:1700000000000', '100:1700000001000'].map((instanceId, index) => ({
          timestamp: 1700000000000 + index * 1000,
          agent: 'Fixture',
          pid: 100,
          instanceId,
          source: 'chokidar-write',
          file: '/fixture/example.js',
          sensitive: false,
          contents: hostile,
          apiKey: hostile,
          attribution: {
            status: 'confirmed',
            evidence: ['handle-scan-pid', 'self-config-path', hostile, { contents: hostile }],
            extra: { apiKey: hostile },
          },
        })),
      });
      mockShowSaveDialog.mockResolvedValue({ filePath });
      await exporter.exportLog();
      const serialized = fs.readFileSync(filePath, 'utf8');
      const { events } = JSON.parse(serialized);
      expect(events.map((event) => event.instanceId)).toEqual([
        '100:1700000000000',
        '100:1700000001000',
      ]);
      for (const event of events) {
        expect(event.pid).toBe(100);
        expect(event.source).toBe('chokidar-write');
        expect(event.attribution).toBe('confirmed');
        expect(event.attributionEvidence).toEqual(['handle-scan-pid', 'self-config-path']);
        expect(event).not.toHaveProperty('contents');
        expect(event).not.toHaveProperty('apiKey');
      }
      expect(serialized).not.toContain(hostile);
    });

    it('does not infer missing identity or serialize nested provenance values', async () => {
      const filePath = path.join(tmpDir, 'unknown-provenance.json');
      const hostile = 'fixture-nested-secret';
      initExporter({
        activityLog: [
          {
            timestamp: 1700000000000,
            agent: '',
            pid: null,
            instanceId: null,
            file: '/fixture/unowned.js',
            attribution: { status: 'unattributed', evidence: ['no-owner-match'] },
          },
          { timestamp: 1700000001000, agent: 'Fixture', pid: 100, file: '/fixture/legacy.js' },
          {
            timestamp: 1700000002000,
            agent: '',
            pid: null,
            file: '/fixture/malformed.js',
            instanceId: { contents: hostile },
            source: { apiKey: hostile },
            attribution: { status: 'unattributed', evidence: { contents: hostile } },
          },
          {
            timestamp: 1700000003000,
            agent: '',
            pid: null,
            file: '/fixture/unsafe-source.js',
            instanceId: 'x'.repeat(257),
            source: hostile,
          },
        ],
      });
      mockShowSaveDialog.mockResolvedValue({ filePath });
      await exporter.exportLog();
      const serialized = fs.readFileSync(filePath, 'utf8');
      const { events } = JSON.parse(serialized);
      expect(events[0].agent).toBe('');
      expect(events[0].attribution).toBe('unattributed');
      expect(events[0].attributionEvidence).toEqual(['no-owner-match']);
      expect(events[1].attribution).toBeNull();
      for (const event of events) {
        expect(event.instanceId).toBeNull();
        expect(event.source).toBeNull();
      }
      expect(events[1].attributionEvidence).toEqual([]);
      expect(events[2].attributionEvidence).toEqual([]);
      expect(serialized).not.toContain(hostile);
    });

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
          {
            timestamp: Date.now(),
            agent: 'Claude',
            pid: 100,
            file: '/a.js',
            sensitive: false,
            reason: null,
            action: 'read',
          },
          {
            timestamp: Date.now(),
            agent: 'Claude',
            pid: 100,
            file: '/b.js',
            sensitive: true,
            reason: 'SSH',
            action: 'read',
          },
        ],
        monitoringStarted: started,
        stats: {
          totalFiles: 2,
          totalSensitive: 1,
          aiSensitive: 0,
          uptimeMs: 120000,
          monitoringStarted: Date.now() - 120000,
          peakAgents: 1,
          currentAgents: 1,
          aiAgentCount: 1,
          otherAgentCount: 0,
          uniqueAgents: ['Claude'],
        },
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

    it('keeps the raw empty agent in JSON but exports the attribution status', async () => {
      // JSON is machine-readable: inventing a display name here would make a
      // downstream tool group real activity under an agent that does not exist.
      const filePath = path.join(tmpDir, 'log.json');
      initExporter({
        activityLog: [
          {
            timestamp: 1700000000000,
            agent: '',
            pid: null,
            file: '/home/user/.ssh/id_rsa',
            sensitive: true,
            reason: 'SSH keys/config',
            action: 'modified',
            attribution: { status: 'unattributed', evidence: ['no-owner-match'] },
          },
          {
            timestamp: 1700000001000,
            agent: 'Claude',
            pid: 100,
            file: '/a.js',
            sensitive: false,
            reason: '',
            action: 'read',
          },
        ],
      });

      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath });
      await exporter.exportLog();

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(data.events[0].agent).toBe('');
      expect(data.events[0].agent).not.toBe('Unknown source');
      expect(data.events[0].attribution).toBe('unattributed');
      // Pre-v0.11.0 shape: no attribution field → explicit null, not undefined.
      expect(data.events[1].attribution).toBeNull();
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
          {
            timestamp: 1700000000000,
            agent: 'Claude',
            pid: 100,
            file: '/a.js',
            sensitive: false,
            action: 'read',
          },
          {
            timestamp: 1700000001000,
            agent: 'Claude',
            pid: 100,
            file: '/b.js',
            sensitive: true,
            action: 'write',
          },
        ],
        netConns: [],
      });

      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath });
      const result = await exporter.exportCsv();

      expect(result.success).toBe(true);
      expect(result.eventCount).toBe(2);

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      expect(lines[0]).toBe(EXPECTED_CSV_HEADER);
      const parsed = parseCsv(content);
      expect(parsed).toHaveLength(3);
      expect(parsed[1].slice(0, 5)).toEqual([
        '2023-11-14T22:13:20.000Z',
        'Claude',
        'read',
        '/a.js',
        'no',
      ]);
      expect(parsed[2].slice(0, 5)).toEqual([
        '2023-11-14T22:13:21.000Z',
        'Claude',
        'write',
        '/b.js',
        'yes',
      ]);
    });

    it('writes "Unknown source" instead of a blank cell for an unattributed event', async () => {
      const filePath = path.join(tmpDir, 'log.csv');
      initExporter({
        activityLog: [
          {
            timestamp: 1700000000000,
            agent: '',
            pid: null,
            file: '/home/user/.ssh/id_rsa',
            sensitive: true,
            reason: 'SSH keys/config',
            action: 'modified',
            attribution: { status: 'unattributed', evidence: ['no-owner-match'] },
          },
        ],
        netConns: [],
      });

      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath });
      await exporter.exportCsv();

      const [, cells] = parseCsv(fs.readFileSync(filePath, 'utf-8'));
      expect(cells).toHaveLength(12);
      expect(cells[1]).toBe('Unknown source');
      expect(cells.slice(5)).toEqual(['', '', '', 'unattributed', 'no-owner-match', '', '']);
    });

    it('includes network connections in CSV', async () => {
      const filePath = path.join(tmpDir, 'log.csv');
      initExporter({
        activityLog: [],
        netConns: [{ agent: 'Claude', remoteIp: '1.2.3.4', remotePort: 443, flagged: true }],
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

    it('exports recorded TCP observation time unchanged in later CSV exports', async () => {
      const filePath = path.join(tmpDir, 'retained.csv');
      const row = {
        timestamp: 1700000001000,
        agent: 'Claude',
        remoteIp: '1.2.3.4',
        remotePort: 443,
        flagged: true,
      };
      initExporter({ netConns: [row] });
      mockShowSaveDialog.mockResolvedValue({ filePath });

      for (let attempt = 0; attempt < 2; attempt++) {
        expect((await exporter.exportCsv()).success).toBe(true);
        const line = fs
          .readFileSync(filePath, 'utf8')
          .split('\n')
          .find((l) => l.includes(',network,'));
        expect(line).toBe('2023-11-14T22:13:21.000Z,Claude,network,1.2.3.4:443,yes,,,,,,,');
        expect(row.timestamp).toBe(1700000001000);
      }
    });

    it.each([undefined, null, NaN, Infinity, '1700000001000', 8640000000000001])(
      'leaves missing or invalid TCP observation time blank (%s)',
      async (timestamp) => {
        const filePath = path.join(tmpDir, 'legacy.csv');
        initExporter({
          netConns: [{ timestamp, agent: 'Claude', remoteIp: '1.2.3.4', remotePort: 443 }],
        });
        mockShowSaveDialog.mockResolvedValue({ filePath });
        expect((await exporter.exportCsv()).success).toBe(true);
        const line = fs
          .readFileSync(filePath, 'utf8')
          .split('\n')
          .find((l) => l.includes(',network,'));
        expect(line).toBe(',Claude,network,1.2.3.4:443,no,,,,,,,');
      },
    );

    it('handles empty activity log and no net connections', async () => {
      const filePath = path.join(tmpDir, 'log.csv');
      initExporter({ activityLog: [], netConns: [] });

      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath });
      const result = await exporter.exportCsv();

      expect(result.success).toBe(true);
      expect(result.eventCount).toBe(0);

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content.trim()).toBe(EXPECTED_CSV_HEADER);
    });

    it('retains distinct instance lifetimes for one PID and synthetic pid 0 in CSV', async () => {
      const filePath = path.join(tmpDir, 'lifetimes.csv');
      initExporter({
        activityLog: [
          {
            timestamp: 1700000000000,
            agent: 'Claude',
            pid: 100,
            instanceId: '100:1700000000000',
            source: 'rm-hold',
            file: '/repo/one.txt',
            sensitive: false,
            action: 'holding',
            attribution: { status: 'confirmed', evidence: ['rm-holder-pid'] },
          },
          {
            timestamp: 1700000001000,
            agent: 'Claude',
            pid: 100,
            instanceId: '100:1700000001000',
            source: 'handle-scan',
            file: '/repo/two.txt',
            sensitive: false,
            action: 'accessed',
            attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] },
          },
          {
            timestamp: 1700000002000,
            agent: 'Kilo Code',
            pid: 0,
            instanceId: '0:kilo-code',
            source: 'chokidar-write',
            file: '/repo/.kilocode/config.json',
            sensitive: false,
            action: 'modified',
            attribution: { status: 'inferred', evidence: ['self-config-path'] },
          },
        ],
      });

      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath });
      expect((await exporter.exportCsv()).success).toBe(true);

      const rows = parseCsv(fs.readFileSync(filePath, 'utf8'));
      expect(rows).toHaveLength(4);
      expect(rows[1].slice(5)).toEqual([
        '100',
        '100:1700000000000',
        'rm-hold',
        'confirmed',
        'rm-holder-pid',
        '',
        '',
      ]);
      expect(rows[2].slice(5)).toEqual([
        '100',
        '100:1700000001000',
        'handle-scan',
        'confirmed',
        'handle-scan-pid',
        '',
        '',
      ]);
      expect(rows[3].slice(5)).toEqual([
        '0',
        '0:kilo-code',
        'chokidar-write',
        'inferred',
        'self-config-path',
        '',
        '',
      ]);
    });

    it('never reconstructs instanceId from PID or infers missing actors on absent attribution', async () => {
      const filePath = path.join(tmpDir, 'absent-provenance.csv');
      initExporter({
        activityLog: [
          {
            timestamp: 1700000000000,
            agent: 'Fixture',
            pid: 42,
            file: '/fixture/legacy.js',
            action: 'read',
          },
          {
            timestamp: 1700000001000,
            agent: '',
            pid: 42,
            instanceId: null,
            file: 'C:/Users/test/.codex/config.toml',
            sensitive: true,
            action: 'modified',
            attribution: { status: 'unattributed', evidence: ['no-owner-match'] },
          },
          {
            timestamp: 1700000002000,
            agent: '',
            pid: null,
            instanceId: null,
            file: '/fixture/unowned.js',
            action: 'accessed',
            attribution: { status: 'unattributed', evidence: ['population-unavailable'] },
          },
        ],
      });

      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath });
      expect((await exporter.exportCsv()).success).toBe(true);

      const rows = parseCsv(fs.readFileSync(filePath, 'utf8'));
      expect(rows).toHaveLength(4);
      expect(rows[1].slice(1)).toEqual([
        'Fixture',
        'read',
        '/fixture/legacy.js',
        'no',
        '42',
        '',
        '',
        '',
        '',
        '',
        '',
      ]);
      expect(rows[2].slice(1)).toEqual([
        'Codex resource (actor not recorded)',
        'modified',
        'C:/Users/test/.codex/config.toml',
        'yes',
        '42',
        '',
        '',
        'unattributed',
        'no-owner-match',
        '',
        '',
      ]);
      expect(rows[3].slice(1)).toEqual([
        'Unknown source',
        'accessed',
        '/fixture/unowned.js',
        'no',
        '',
        '',
        '',
        'unattributed',
        'population-unavailable',
        '',
        '',
      ]);
    });

    it('keeps allowlisted sources and joins filtered multi-code evidence in CSV', async () => {
      const filePath = path.join(tmpDir, 'evidence.csv');
      initExporter({
        activityLog: [
          {
            timestamp: 1700000000000,
            agent: 'Claude',
            pid: 88,
            instanceId: '88:1700000000000',
            source: 'watcher',
            file: '/home/user/.claude/settings.json',
            sensitive: false,
            action: 'holding',
            attribution: {
              status: 'confirmed',
              evidence: ['rm-holder-pid', 'self-config-path', 'unlisted-code'],
            },
          },
        ],
      });

      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath });
      expect((await exporter.exportCsv()).success).toBe(true);

      const [, cells] = parseCsv(fs.readFileSync(filePath, 'utf8'));
      expect(cells.slice(5)).toEqual([
        '88',
        '88:1700000000000',
        'watcher',
        'confirmed',
        'rm-holder-pid;self-config-path',
        '',
        '',
      ]);
    });

    it('exports all three network verdicts, all six verdict reasons, and network attribution', async () => {
      const filePath = path.join(tmpDir, 'network-verdicts.csv');
      initExporter({
        netConns: [
          {
            timestamp: 1700000000000,
            agent: 'Claude',
            pid: 101,
            instanceId: '101:1700000000000',
            remoteIp: '160.79.104.10',
            remotePort: 443,
            flagged: false,
            verdict: 'allowlisted',
            verdictReason: 'ip-allowlist',
            attribution: { status: 'confirmed', evidence: ['os-tcp-owner-pid'] },
          },
          {
            timestamp: 1700000001000,
            agent: 'Claude',
            pid: 101,
            instanceId: '101:1700000000000',
            remoteIp: '203.0.113.8',
            domain: 'api.anthropic.com',
            remotePort: 443,
            flagged: false,
            verdict: 'allowlisted',
            verdictReason: 'domain-allowlist',
            attribution: { status: 'confirmed', evidence: ['os-tcp-owner-pid'] },
          },
          {
            timestamp: 1700000002000,
            agent: 'Claude',
            pid: 101,
            instanceId: '101:1700000000000',
            remoteIp: '198.51.100.1',
            remotePort: 443,
            flagged: true,
            verdict: 'unknown',
            verdictReason: 'ptr-missing',
            attribution: { status: 'confirmed', evidence: ['os-tcp-owner-pid'] },
          },
          {
            timestamp: 1700000003000,
            agent: 'Claude',
            pid: 101,
            instanceId: '101:1700000000000',
            remoteIp: '198.51.100.2',
            remotePort: 443,
            flagged: true,
            verdict: 'unknown',
            verdictReason: 'ptr-unconfirmed',
            attribution: { status: 'confirmed', evidence: ['os-tcp-owner-pid'] },
          },
          {
            timestamp: 1700000004000,
            agent: 'Claude',
            pid: 101,
            instanceId: '101:1700000000000',
            remoteIp: '198.51.100.3',
            remotePort: 443,
            flagged: true,
            verdict: 'unknown',
            verdictReason: 'dns-timeout',
            attribution: { status: 'confirmed', evidence: ['os-tcp-owner-pid'] },
          },
          {
            timestamp: 1700000005000,
            agent: '',
            pid: 999,
            instanceId: null,
            remoteIp: '198.51.100.4',
            domain: 'exfil.example',
            remotePort: 8443,
            flagged: true,
            verdict: 'flagged',
            verdictReason: 'domain-not-allowlisted',
            attribution: { status: 'unattributed', evidence: ['no-owner-match'] },
          },
        ],
      });

      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath });
      expect((await exporter.exportCsv()).success).toBe(true);

      const rows = parseCsv(fs.readFileSync(filePath, 'utf8'));
      expect(rows).toHaveLength(7);
      expect(rows[1].slice(1)).toEqual([
        'Claude',
        'network',
        '160.79.104.10:443',
        'no',
        '101',
        '101:1700000000000',
        '',
        'confirmed',
        'os-tcp-owner-pid',
        'allowlisted',
        'ip-allowlist',
      ]);
      expect(rows[2].slice(4)).toEqual([
        'no',
        '101',
        '101:1700000000000',
        '',
        'confirmed',
        'os-tcp-owner-pid',
        'allowlisted',
        'domain-allowlist',
      ]);
      expect(rows[3].slice(10)).toEqual(['unknown', 'ptr-missing']);
      expect(rows[4].slice(10)).toEqual(['unknown', 'ptr-unconfirmed']);
      expect(rows[5].slice(10)).toEqual(['unknown', 'dns-timeout']);
      expect(rows[6].slice(1)).toEqual([
        'Unknown source',
        'network',
        'exfil.example:8443',
        'yes',
        '999',
        '',
        '',
        'unattributed',
        'no-owner-match',
        'flagged',
        'domain-not-allowlisted',
      ]);
    });

    it('never infers network verdicts from flagged on legacy rows', async () => {
      const filePath = path.join(tmpDir, 'legacy-verdicts.csv');
      initExporter({
        netConns: [
          { agent: 'Claude', remoteIp: '1.2.3.4', remotePort: 443, flagged: true },
          { agent: 'Claude', remoteIp: '1.2.3.5', remotePort: 443, flagged: false },
          { agent: 'Claude', remoteIp: '1.2.3.6', remotePort: 443, verdictReason: 'ip-allowlist' },
        ],
      });

      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath });
      expect((await exporter.exportCsv()).success).toBe(true);

      const rows = parseCsv(fs.readFileSync(filePath, 'utf8'));
      expect(rows).toHaveLength(4);
      expect(rows[1].slice(4)).toEqual(['yes', '', '', '', '', '', '', '']);
      expect(rows[2].slice(4)).toEqual(['no', '', '', '', '', '', '', '']);
      expect(rows[3].slice(4)).toEqual(['no', '', '', '', '', '', '', '']);
    });

    it('preserves local-socket details in Target alongside provenance and verdicts', async () => {
      const filePath = path.join(tmpDir, 'socket-verdicts.csv');
      initExporter({
        netConns: [52001, 52002].map((localPort) => ({
          timestamp: 1700000000000,
          agent: 'Codex',
          pid: 17,
          instanceId: '17:1700000000000',
          remoteIp: '192.0.2.1',
          remotePort: 443,
          localIp: '10.0.0.2',
          localPort,
          state: 'Established',
          flagged: false,
          verdict: 'allowlisted',
          verdictReason: 'ip-allowlist',
          attribution: { status: 'confirmed', evidence: ['os-tcp-owner-pid'] },
        })),
      });

      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath });
      expect((await exporter.exportCsv()).success).toBe(true);

      const rows = parseCsv(fs.readFileSync(filePath, 'utf8'));
      expect(rows).toHaveLength(3);
      expect(rows[1].slice(3)).toEqual([
        '192.0.2.1:443 · Local 10.0.0.2:52001 · PID 17 · Established',
        'no',
        '17',
        '17:1700000000000',
        '',
        'confirmed',
        'os-tcp-owner-pid',
        'allowlisted',
        'ip-allowlist',
      ]);
      expect(rows[2].slice(3)).toEqual([
        '192.0.2.1:443 · Local 10.0.0.2:52002 · PID 17 · Established',
        'no',
        '17',
        '17:1700000000000',
        '',
        'confirmed',
        'os-tcp-owner-pid',
        'allowlisted',
        'ip-allowlist',
      ]);
    });

    it('neutralizes formula prefixes and escapes commas, quotes, and multiline values', async () => {
      const filePath = path.join(tmpDir, 'escaping.csv');
      initExporter({
        activityLog: [
          {
            timestamp: 1700000000000,
            agent: 'Agent, "X"\n=SUM(1)',
            pid: 100,
            instanceId: '=100:formula,"id"\nline2',
            source: 'chokidar-write',
            file: '\n=1+1, "secret"',
            sensitive: true,
            action: 'modified',
            attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] },
          },
        ],
        netConns: [
          {
            timestamp: 1700000001000,
            agent: '@net, "agent"',
            pid: 17,
            instanceId: '+17:net',
            remoteIp: '1.2.3.4',
            remotePort: 443,
            localIp: '10.0.0.2',
            localPort: 52001,
            state: 'ESTAB\r\n+cmd',
            flagged: true,
            verdict: 'flagged',
            verdictReason: 'domain-not-allowlisted',
          },
        ],
      });

      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath });
      expect((await exporter.exportCsv()).success).toBe(true);

      const rows = parseCsv(fs.readFileSync(filePath, 'utf8'));
      expect(rows).toHaveLength(3);
      expect(rows[1]).toHaveLength(12);
      expect(rows[1][1]).toBe('Agent, "X"\n=SUM(1)');
      expect(rows[1][3]).toBe("'\n=1+1, \"secret\"");
      expect(rows[1][6]).toBe('\'=100:formula,"id"\nline2');
      expect(rows[2]).toHaveLength(12);
      expect(rows[2][1]).toBe('\'@net, "agent"');
      expect(rows[2][3]).toBe('1.2.3.4:443 · Local 10.0.0.2:52001 · PID 17 · ESTAB\r\n+cmd');
      expect(rows[2][6]).toBe("'+17:net");
    });

    it('drops arbitrary, nested, oversized, and canary fields from CSV across row kinds', async () => {
      const filePath = path.join(tmpDir, 'anti-leak.csv');
      const hostile = 'fixture-secret-must-not-export';
      initExporter({
        activityLog: [
          {
            timestamp: NaN,
            agent: 'Fixture',
            pid: -1,
            instanceId: { contents: hostile },
            source: hostile,
            file: '/fixture/clean.js',
            sensitive: false,
            reason: hostile,
            contents: hostile,
            apiKey: hostile,
            verdict: 'flagged',
            verdictReason: 'ip-allowlist',
            extra: { verdict: 'flagged', verdictReason: 'ip-allowlist', apiKey: hostile },
            details: { apiKey: hostile },
            attribution: {
              status: hostile,
              evidence: [hostile, { contents: hostile }],
              extra: { apiKey: hostile },
            },
          },
          {
            timestamp: 1700000000000,
            agent: 'Fixture',
            pid: 5,
            instanceId: hostile.padEnd(257, 'x'),
            source: { apiKey: hostile },
            file: '/fixture/oversized.js',
            sensitive: false,
            attribution: { status: 'inferred', evidence: { contents: hostile } },
          },
        ],
        netConns: [
          {
            timestamp: 1700000001000,
            agent: 'Fixture',
            pid: { toString: () => hostile },
            instanceId: { apiKey: hostile },
            source: 'chokidar-write',
            remoteIp: '1.2.3.4',
            remotePort: 443,
            localIp: { toString: () => hostile },
            localPort: hostile,
            state: { toString: () => hostile },
            flagged: false,
            verdict: hostile,
            verdictReason: hostile,
            contents: hostile,
            apiKey: hostile,
            extra: { verdict: 'flagged', apiKey: hostile },
            details: { apiKey: hostile },
            attribution: { status: hostile, evidence: [hostile] },
          },
        ],
      });

      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath });
      expect((await exporter.exportCsv()).success).toBe(true);

      const raw = fs.readFileSync(filePath, 'utf8');
      expect(raw).not.toContain(hostile);

      const rows = parseCsv(raw);
      expect(rows).toHaveLength(4);
      expect(rows[1]).toEqual([
        '',
        'Fixture',
        'accessed',
        '/fixture/clean.js',
        'no',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ]);
      expect(rows[2]).toEqual([
        '2023-11-14T22:13:20.000Z',
        'Fixture',
        'accessed',
        '/fixture/oversized.js',
        'no',
        '5',
        '',
        '',
        'inferred',
        '',
        '',
        '',
      ]);
      expect(rows[3]).toEqual([
        '2023-11-14T22:13:21.000Z',
        'Fixture',
        'network',
        '1.2.3.4:443',
        'no',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ]);
    });
  });

  describe.each([
    ['exportLog', 'json', 'Activity log export failed'],
    ['exportCsv', 'csv', 'CSV export failed'],
  ])('%s destination replacement', (method, ext, failure) => {
    const previous = 'previous export bytes';
    const realOpen = fs.promises.open;
    let destination;

    beforeEach(() => {
      destination = path.join(tmpDir, `existing.${ext}`);
      fs.writeFileSync(destination, previous);
      initExporter({
        activityLog: [
          {
            timestamp: Date.now(),
            agent: 'Claude',
            file: '/repo/first.txt',
            sensitive: false,
            action: 'read',
          },
          {
            timestamp: Date.now(),
            agent: 'Copilot',
            file: '/repo/second.txt',
            sensitive: true,
            action: 'write',
          },
        ],
      });
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: destination });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    /** Replace one method on the real temporary file handle. */
    function injectHandle(name, implementation) {
      vi.spyOn(fs.promises, 'open').mockImplementation(async (...args) => {
        const handle = await realOpen(...args);
        const original = handle[name].bind(handle);
        handle[name] = (...callArgs) => implementation(handle, original, callArgs);
        return handle;
      });
    }

    const destinationBytes = () => fs.readFileSync(destination, 'utf8');
    const directory = () => fs.readdirSync(tmpDir).sort();

    it('replaces the destination with every row and leaves no temporary file', async () => {
      const result = await exporter[method]();
      expect(result).toEqual({ success: true, path: destination, eventCount: 2 });
      expect(destinationBytes()).toContain('/repo/first.txt');
      expect(destinationBytes()).toContain('/repo/second.txt');
      expect(destinationBytes()).not.toContain(previous);
      expect(directory()).toEqual([path.basename(destination)]);
    });

    it('reports the exported rows even when the log grows while writing', async () => {
      const state = initExporter({ activityLog: [{ timestamp: Date.now(), file: '/repo/a' }] });
      injectHandle('sync', async (_handle, original) => {
        state.activityLog.push({ timestamp: Date.now(), file: '/repo/late' });
        return original();
      });
      expect(await exporter[method]()).toMatchObject({ success: true, eventCount: 1 });
      expect(destinationBytes()).not.toContain('/repo/late');
    });

    it.each([
      [
        'a partial write',
        () =>
          injectHandle('writeFile', async (handle) => {
            await handle.write('partial');
            throw new Error(`ENOSPC ${tmpDir}`);
          }),
      ],
      [
        'a failed flush',
        () =>
          injectHandle('sync', async () => {
            throw new Error(`EIO ${tmpDir}`);
          }),
      ],
      [
        'a failed close',
        () =>
          injectHandle('close', async (_handle, original) => {
            await original();
            throw new Error(`EIO ${tmpDir}`);
          }),
      ],
      [
        'a refused replacement',
        () => vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(new Error(`EPERM ${tmpDir}`)),
      ],
    ])('preserves the destination after %s', async (_label, inject) => {
      inject();
      const result = await exporter[method]();
      expect(result).toEqual({ success: false, error: failure });
      expect(destinationBytes()).toBe(previous);
      expect(directory()).toEqual([path.basename(destination)]);
    });

    it('never removes a temporary path it did not create', async () => {
      const taken = Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
      vi.spyOn(fs.promises, 'open').mockRejectedValueOnce(taken);
      const unlink = vi.spyOn(fs.promises, 'unlink');
      expect(await exporter[method]()).toEqual({ success: false, error: failure });
      expect(unlink).not.toHaveBeenCalled();
      expect(destinationBytes()).toBe(previous);
    });

    it('removes only the temporary file of the failed attempt', async () => {
      const neighbor = path.join(tmpDir, '.aegis-export-neighbor.tmp');
      fs.writeFileSync(neighbor, 'another attempt');
      vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(new Error('EPERM'));
      const unlink = vi.spyOn(fs.promises, 'unlink');
      await exporter[method]();
      expect(unlink).toHaveBeenCalledOnce();
      expect(unlink.mock.calls[0][0]).not.toBe(neighbor);
      expect(path.dirname(unlink.mock.calls[0][0])).toBe(tmpDir);
      expect(directory()).toEqual([path.basename(neighbor), path.basename(destination)].sort());
    });

    it('reports a refused cleanup explicitly without forcing removal', async () => {
      vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(new Error('EPERM'));
      const unlink = vi
        .spyOn(fs.promises, 'unlink')
        .mockRejectedValueOnce(Object.assign(new Error(`EPERM ${tmpDir}`), { code: 'EPERM' }));
      const chmod = vi.spyOn(fs.promises, 'chmod');
      const rm = vi.spyOn(fs.promises, 'rm');
      const result = await exporter[method]();
      expect(result).toEqual({
        success: false,
        error: failure + '; temporary file cleanup unconfirmed',
        cleanupIncomplete: true,
      });
      expect(JSON.stringify(result)).not.toContain(tmpDir);
      expect(unlink).toHaveBeenCalledOnce();
      expect(chmod).not.toHaveBeenCalled();
      expect(rm).not.toHaveBeenCalled();
      expect(destinationBytes()).toBe(previous);
    });

    it('keeps a refused cleanup explicit when ownership is lost', async () => {
      vi.spyOn(fs.promises, 'unlink').mockRejectedValueOnce(
        Object.assign(new Error('EPERM'), { code: 'EPERM' }),
      );
      let checks = 0;
      expect(await exporter[method](() => ++checks < 2)).toEqual({
        success: false,
        cleanupIncomplete: true,
      });
      expect(destinationBytes()).toBe(previous);
    });

    // Check 1 follows the save dialog; the remaining checks follow the temporary
    // file's creation, write, flush and close, the last just before the replacement.
    it.each([2, 3, 4, 5])(
      'stops without replacing when ownership is lost at check %i',
      async (lostAt) => {
        const rename = vi.spyOn(fs.promises, 'rename');
        let checks = 0;
        const result = await exporter[method](() => ++checks < lostAt);
        expect(result).toEqual({ success: false });
        expect(checks).toBe(lostAt);
        expect(rename).not.toHaveBeenCalled();
        expect(destinationBytes()).toBe(previous);
        expect(directory()).toEqual([path.basename(destination)]);
      },
    );

    it('keeps the replacement when the owner is lost after it was dispatched', async () => {
      let owned = true;
      const realRename = fs.promises.rename;
      vi.spyOn(fs.promises, 'rename').mockImplementationOnce(async (...args) => {
        owned = false;
        return realRename(...args);
      });
      expect(await exporter[method](() => owned)).toMatchObject({ success: true });
      expect(destinationBytes()).toContain('/repo/first.txt');
    });
  });

  describe('generateReport', () => {
    it('groups repeated skills and endpoints, preserves counts and excludes content fields', async () => {
      const event = {
        agent: '',
        instanceId: null,
        file: 'C:/Users/test/.codex/skills/review/SKILL.md',
        timestamp: Date.now(),
        action: 'modified',
        sensitive: true,
        reason: 'Skill metadata',
        attribution: { status: 'unattributed' },
        contents: 'PRIVATE_FILE_CONTENT',
        apiKey: 'PRIVATE_API_KEY',
      };
      initExporter({
        activityLog: [
          event,
          { ...event, timestamp: event.timestamp - 1000 },
          { ...event, file: 'C:/Users/test/.codex/skills/review/helper.js' },
        ],
        netConns: [
          { agent: 'Codex', remoteIp: '192.0.2.1', domain: '', remotePort: 443 },
          { agent: 'Codex', remoteIp: '192.0.2.1', domain: '', remotePort: 443 },
        ],
      });
      const result = await exporter.generateReport();
      const html = fs.readFileSync(result.path, 'utf8');
      expect((html.match(/class="resource-group"/g) || []).length).toBe(2);
      expect(html).toContain('Codex resource (actor not recorded)');
      expect(html).toContain('3 recorded observations');
      expect(html).toContain('2 recorded observations');
      expect(html).toContain('192.0.2.1:443');
      expect(html).not.toContain('PRIVATE_FILE_CONTENT');
      expect(html).not.toContain('PRIVATE_API_KEY');
      expect(html).not.toContain('#00e5ff');
      expect(html).not.toContain('v0.1.0');
      expect(event.agent).toBe('');
      expect(event.instanceId).toBeNull();
    });

    it('redacts a native viewer error containing the generated report path', async () => {
      initExporter();
      mockOpenPath.mockImplementationOnce(async (reportPath) => `Cannot open ${reportPath}`);
      const result = await exporter.generateReport();
      expect(result).toEqual({ success: false, error: 'Session report could not be opened' });
      expect(JSON.stringify(result)).not.toContain(tmpDir);
      expect(mockOpenPath).toHaveBeenCalledOnce();
    });

    it('redacts a rejected native viewer error containing the generated report path', async () => {
      initExporter();
      mockOpenPath.mockImplementationOnce(async (reportPath) => {
        throw new Error(`Cannot open ${reportPath}`);
      });
      const result = await exporter.generateReport();
      expect(result).toEqual({ success: false, error: 'Session report could not be opened' });
      expect(JSON.stringify(result)).not.toContain(tmpDir);
      expect(mockOpenPath).toHaveBeenCalledOnce();
    });
    it('generates HTML report and returns path', async () => {
      initExporter({
        activityLog: [
          {
            timestamp: Date.now(),
            agent: 'Claude',
            sensitive: true,
            file: '/ssh/key',
            reason: 'SSH key',
            action: 'read',
          },
        ],
        netConns: [
          {
            agent: 'Claude',
            remoteIp: '1.2.3.4',
            remotePort: 443,
            domain: 'api.com',
            flagged: false,
            state: 'ESTAB',
          },
        ],
        stats: {
          totalFiles: 1,
          totalSensitive: 1,
          aiSensitive: 1,
          uptimeMs: 5000,
          monitoringStarted: Date.now() - 5000,
          peakAgents: 1,
          currentAgents: 1,
          aiAgentCount: 1,
          otherAgentCount: 0,
          uniqueAgents: ['Claude'],
        },
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
        stats: {
          totalFiles: 0,
          totalSensitive: 0,
          aiSensitive: 0,
          uptimeMs: 1000,
          monitoringStarted: Date.now() - 1000,
          peakAgents: 0,
          currentAgents: 0,
          aiAgentCount: 0,
          otherAgentCount: 0,
          uniqueAgents: [],
        },
      });

      const result = await exporter.generateReport();
      const html = fs.readFileSync(result.path, 'utf-8');
      expect(html).toContain('No file activity recorded');
    });

    it('labels unattributed events in the HTML report, in both table and bar chart', async () => {
      initExporter({
        activityLog: [
          {
            timestamp: Date.now(),
            agent: '',
            pid: null,
            file: '/home/user/.ssh/id_rsa',
            sensitive: true,
            reason: 'SSH keys/config',
            action: 'modified',
            attribution: { status: 'unattributed', evidence: ['no-owner-match'] },
          },
        ],
        netConns: [],
      });

      const result = await exporter.generateReport();
      const html = fs.readFileSync(result.path, 'utf-8');
      // Sensitive-events table row.
      expect(html).toContain('Unknown source');
      // Per-agent bar chart must not render a blank label either.
      const chartLabels = [...html.matchAll(/class="source-label">([^<]*)<\/td>/g)].map(
        (m) => m[1],
      );
      expect(chartLabels).toContain('Unknown source');
      expect(chartLabels).not.toContain('');
    });

    it('HTML-escapes agent names to prevent XSS', async () => {
      initExporter({
        activityLog: [
          {
            timestamp: Date.now(),
            agent: '<script>alert(1)</script>',
            sensitive: false,
            file: '/f',
            action: 'r',
          },
        ],
        netConns: [],
        stats: {
          totalFiles: 1,
          totalSensitive: 0,
          aiSensitive: 0,
          uptimeMs: 1000,
          monitoringStarted: Date.now() - 1000,
          peakAgents: 1,
          currentAgents: 1,
          aiAgentCount: 1,
          otherAgentCount: 0,
          uniqueAgents: ['test'],
        },
      });

      const result = await exporter.generateReport();
      const html = fs.readFileSync(result.path, 'utf-8');
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;script&gt;');
    });
  });

  it('groups Windows paths while retaining mixed evidence and separate socket details', async () => {
    initExporter({
      activityLog: [
        {
          agent: 'Codex',
          file: 'C:/work/notes.txt',
          action: 'read',
          timestamp: 1000,
          attribution: { status: 'inferred' },
        },
        {
          agent: 'Codex',
          file: 'c:\\WORK\\NOTES.txt',
          action: 'modified',
          timestamp: 2000,
          sensitive: true,
          attribution: { status: 'confirmed' },
        },
      ],
      netConns: [52001, 52002].map((localPort) => ({
        agent: 'Codex',
        remoteIp: '192.0.2.1',
        remotePort: 443,
        localIp: '10.0.0.2',
        localPort,
        state: 'Established',
      })),
    });
    const result = await exporter.generateReport();
    const html = fs.readFileSync(result.path, 'utf8');
    expect(html.match(/class="resource-group"/g) || []).toHaveLength(2);
    expect(html).toContain('Sensitive');
    expect(html).toContain('Mixed attribution');
    expect(html).toContain('>read<');
    expect(html).toContain('>modified<');
    expect(html).toContain('Local 10.0.0.2:52001');
    expect(html).toContain('Local 10.0.0.2:52002');
  });

  it('keeps same-remote sockets distinguishable in the compatible CSV target column', async () => {
    const filePath = path.join(tmpDir, 'socket-evidence.csv');
    initExporter({
      netConns: [52001, 52002].map((localPort) => ({
        agent: 'Codex',
        pid: 17,
        remoteIp: '192.0.2.1',
        remotePort: 443,
        localIp: '10.0.0.2',
        localPort,
        state: 'Established',
      })),
    });
    mockShowSaveDialog.mockResolvedValue({ filePath });
    expect((await exporter.exportCsv()).success).toBe(true);
    const csv = fs.readFileSync(filePath, 'utf8');
    expect(csv).toContain('Local 10.0.0.2:52001 · PID 17 · Established');
    expect(csv).toContain('Local 10.0.0.2:52002 · PID 17 · Established');
  });

  describe('formatUptimeReport (tested through generateReport)', () => {
    it('formats hours, minutes, seconds correctly', async () => {
      initExporter({
        activityLog: [],
        netConns: [],
        stats: {
          totalFiles: 0,
          totalSensitive: 0,
          aiSensitive: 0,
          uptimeMs: 3723000,
          monitoringStarted: Date.now() - 3723000,
          peakAgents: 0,
          currentAgents: 0,
          aiAgentCount: 0,
          otherAgentCount: 0,
          uniqueAgents: [],
        },
      });

      const result = await exporter.generateReport();
      const html = fs.readFileSync(result.path, 'utf-8');
      expect(html).toContain('1h 2m 3s');
    });
  });
});
