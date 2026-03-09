import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';

describe('scan-loop', () => {
  let scanLoop;
  const require_ = createRequire(import.meta.url);

  beforeEach(() => {
    vi.useFakeTimers();
    // Clear CJS cache so each test gets fresh module-level state
    const scanLoopPath = require_.resolve('../../src/main/scan-loop.js');
    delete require_.cache[scanLoopPath];
    // Also clear llm-runtime-detector (required inside enrichWithLocalModels)
    const llmPath = require_.resolve('../../src/main/llm-runtime-detector.js');
    delete require_.cache[llmPath];
    scanLoop = require_('../../src/main/scan-loop.js');
  });

  afterEach(() => {
    scanLoop.stopScanIntervals();
    vi.useRealTimers();
  });

  // ── dedupFileEvent ──

  describe('dedupFileEvent', () => {
    it('passes through first event for a key', () => {
      const ev = { agent: 'Cursor', file: '/etc/passwd' };
      const result = scanLoop.dedupFileEvent(ev);
      expect(result).not.toBeNull();
      expect(result.agent).toBe('Cursor');
      expect(result.repeatCount).toBe(1);
    });

    it('suppresses duplicate within 30 seconds', () => {
      const ev1 = { agent: 'Cursor', file: '/etc/passwd' };
      scanLoop.dedupFileEvent(ev1);
      // Same agent + file within 30s
      const ev2 = { agent: 'Cursor', file: '/etc/passwd' };
      const result = scanLoop.dedupFileEvent(ev2);
      expect(result).toBeNull();
    });

    it('passes through after 30 second window', () => {
      const ev1 = { agent: 'Cursor', file: '/etc/passwd' };
      scanLoop.dedupFileEvent(ev1);
      // Advance past 30s window
      vi.advanceTimersByTime(31000);
      const ev2 = { agent: 'Cursor', file: '/etc/passwd' };
      const result = scanLoop.dedupFileEvent(ev2);
      expect(result).not.toBeNull();
      expect(result.repeatCount).toBe(1);
    });

    it('allows different agents for the same file', () => {
      const ev1 = { agent: 'Cursor', file: '/etc/passwd' };
      const ev2 = { agent: 'Windsurf', file: '/etc/passwd' };
      expect(scanLoop.dedupFileEvent(ev1)).not.toBeNull();
      expect(scanLoop.dedupFileEvent(ev2)).not.toBeNull();
    });

    it('tracks repeat count across suppressed events', () => {
      scanLoop.dedupFileEvent({ agent: 'A', file: 'x' });
      // 3 suppressed duplicates
      scanLoop.dedupFileEvent({ agent: 'A', file: 'x' });
      scanLoop.dedupFileEvent({ agent: 'A', file: 'x' });
      scanLoop.dedupFileEvent({ agent: 'A', file: 'x' });
      vi.advanceTimersByTime(31000);
      const result = scanLoop.dedupFileEvent({ agent: 'A', file: 'x' });
      expect(result).not.toBeNull();
      // count starts at 1 on first registration, then +1 per suppressed event
      // 3 suppressed → count = 1 + 3 = 4
      expect(result.repeatCount).toBe(4);
    });

    it('cleans up stale entries beyond 500', () => {
      // Fill up 501 unique keys, all old
      for (let i = 0; i < 501; i++) {
        scanLoop.dedupFileEvent({ agent: 'A', file: `f${i}` });
      }
      // Advance time so all entries are > 60s old
      vi.advanceTimersByTime(61000);
      // This insertion triggers cleanup (size > 500)
      const result = scanLoop.dedupFileEvent({ agent: 'A', file: 'trigger' });
      expect(result).not.toBeNull();
    });
  });

  // ── logAuditForFile ──

  describe('logAuditForFile', () => {
    it('logs file-access for normal file events', () => {
      const auditLog = vi.fn();
      scanLoop.init({ audit: { log: auditLog } });

      scanLoop.logAuditForFile({
        agent: 'Cursor',
        action: 'read',
        file: '/home/user/.bashrc',
        sensitive: true,
        reason: 'dotfile',
      });

      expect(auditLog).toHaveBeenCalledOnce();
      expect(auditLog).toHaveBeenCalledWith('file-access', {
        agent: 'Cursor',
        action: 'read',
        path: '/home/user/.bashrc',
        severity: 'sensitive',
      });
    });

    it('logs config-access for AI agent config events', () => {
      const auditLog = vi.fn();
      scanLoop.init({ audit: { log: auditLog } });

      scanLoop.logAuditForFile({
        agent: 'Copilot',
        action: 'write',
        file: '/home/.copilot/config.json',
        sensitive: false,
        reason: 'AI agent config modification',
      });

      expect(auditLog).toHaveBeenCalledWith('config-access', {
        agent: 'Copilot',
        action: 'write',
        path: '/home/.copilot/config.json',
        severity: 'normal',
      });
    });
  });

  // ── startScanIntervals / stopScanIntervals ──

  describe('startScanIntervals / stopScanIntervals', () => {
    it('starts intervals that can be stopped', () => {
      // We need to init with mock deps that the interval callbacks use
      const mockDeps = {
        scanner: { scanProcesses: vi.fn().mockResolvedValue({ agents: [], changed: false }) },
        procUtil: {
          enrichWithParentChains: vi.fn().mockResolvedValue(),
          annotateHostApps: vi.fn(),
          annotateWorkingDirs: vi.fn().mockResolvedValue(),
        },
        watcher: {
          pruneKnownHandles: vi.fn(),
          scanAllFileHandles: vi.fn().mockResolvedValue([]),
        },
        network: {
          isNetworkScanRunning: vi.fn().mockReturnValue(false),
          setNetworkScanRunning: vi.fn(),
          scanNetworkConnections: vi.fn().mockResolvedValue([]),
        },
        baselines: { recordNetworkEndpoint: vi.fn() },
        anomaly: {
          checkDeviations: vi.fn().mockReturnValue([]),
          calculateAnomalyScore: vi.fn().mockReturnValue({ score: 0 }),
        },
        audit: { log: vi.fn() },
        tray: { updateTrayIcon: vi.fn(), notifySensitive: vi.fn() },
        logger: { error: vi.fn(), warn: vi.fn() },
        sendToRenderer: vi.fn(),
        fileAccessBatcher: { push: vi.fn() },
        statsUpdateBatcher: { push: vi.fn() },
        getStats: vi.fn().mockReturnValue({}),
        getResourceUsage: vi.fn().mockReturnValue({}),
        getLatestAgents: vi.fn().mockReturnValue([]),
        setAgents: vi.fn(),
        setLatestNetConnections: vi.fn(),
        getPreviousPids: vi.fn().mockReturnValue(new Map()),
        setPreviousPids: vi.fn(),
      };
      scanLoop.init(mockDeps);
      scanLoop.startScanIntervals(5000);

      // Process scan should fire at 5000ms
      vi.advanceTimersByTime(5000);
      expect(mockDeps.scanner.scanProcesses).toHaveBeenCalled();

      // Stop and verify no more calls
      scanLoop.stopScanIntervals();
      const callCount = mockDeps.scanner.scanProcesses.mock.calls.length;
      vi.advanceTimersByTime(10000);
      expect(mockDeps.scanner.scanProcesses.mock.calls.length).toBe(callCount);
    });
  });

  // ── getLatestLocalModels ──

  describe('getLatestLocalModels', () => {
    it('returns default empty models before any scan', () => {
      const models = scanLoop.getLatestLocalModels();
      expect(models.ollama).toEqual({ running: false, models: [] });
      expect(models.lmstudio).toEqual({ running: false, models: [] });
    });
  });
});
