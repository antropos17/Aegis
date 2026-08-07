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
        attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] },
      });

      expect(auditLog).toHaveBeenCalledOnce();
      // Event Schema v1: the FULL attribution object is top-level. v0 kept only the
      // derived status string inside `extra`, losing the evidence array.
      expect(auditLog).toHaveBeenCalledWith('file-access', {
        agent: 'Cursor',
        pid: null,
        instanceId: null,
        action: 'read',
        path: '/home/user/.bashrc',
        severity: 'sensitive',
        attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] },
      });
    });

    it('records the unattributed status so an empty agent is not read as a legacy entry', () => {
      const auditLog = vi.fn();
      scanLoop.init({ audit: { log: auditLog } });

      scanLoop.logAuditForFile({
        agent: '',
        action: 'modified',
        file: '/home/user/.ssh/id_rsa',
        sensitive: true,
        reason: 'SSH keys/config',
        attribution: { status: 'unattributed', evidence: ['no-owner-match'] },
      });

      expect(auditLog).toHaveBeenCalledWith('file-access', {
        agent: '',
        pid: null,
        instanceId: null,
        action: 'modified',
        path: '/home/user/.ssh/id_rsa',
        severity: 'sensitive',
        attribution: { status: 'unattributed', evidence: ['no-owner-match'] },
      });
    });

    it('reports attribution null, not a fabricated status, for a pre-v0.11.0 event', () => {
      const auditLog = vi.fn();
      scanLoop.init({ audit: { log: auditLog } });

      scanLoop.logAuditForFile({
        agent: 'Cursor',
        action: 'read',
        file: '/home/user/.bashrc',
        sensitive: false,
        reason: '',
      });

      // `null` says the question is unanswered for this record. Substituting
      // 'unattributed' would assert a determination nobody made.
      expect(auditLog.mock.calls[0][1].attribution).toBeNull();
      expect(auditLog.mock.calls[0][1].extra).toBeUndefined();
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
        attribution: { status: 'inferred', evidence: ['self-config-path'] },
      });

      expect(auditLog).toHaveBeenCalledWith('config-access', {
        agent: 'Copilot',
        pid: null,
        instanceId: null,
        action: 'write',
        path: '/home/.copilot/config.json',
        severity: 'normal',
        attribution: { status: 'inferred', evidence: ['self-config-path'] },
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
        logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
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

  // ── external-agent injection (IDE-extension + WSL) ──

  describe('external-agent injection into scan-batch', () => {
    it('injects cached detector agents into the scan-batch payload before sending', async () => {
      const ide = require_('../../src/main/ide-extension-detector.js');
      const wsl = require_('../../src/main/wsl-detector.js');
      const origIde = ide.getCachedExtensionAgents;
      const origWsl = wsl.getCachedWslAgents;
      const synthetic = {
        agent: 'Kilo Code',
        process: 'code.exe',
        pid: 0,
        status: 'running',
        category: 'ai',
        parentEditor: 'VS Code',
        detectionMethod: 'ide-extension',
      };
      ide.getCachedExtensionAgents = () => [synthetic];
      wsl.getCachedWslAgents = () => [];
      try {
        const sendToRenderer = vi.fn();
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
          logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
          sendToRenderer,
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
        await vi.advanceTimersByTimeAsync(5000);

        const batchCall = sendToRenderer.mock.calls.find((c) => c[0] === 'scan-batch');
        expect(batchCall).toBeTruthy();
        const names = batchCall[1].agents.map((a) => a.agent);
        expect(names).toContain('Kilo Code');
      } finally {
        ide.getCachedExtensionAgents = origIde;
        wsl.getCachedWslAgents = origWsl;
      }
    });
  });

  // ── instanceId coverage across the WHOLE scan-batch payload ──

  describe('scan-batch instanceId invariant', () => {
    /**
     * Deps whose `enrichWithParentChains` stamps identity exactly as the real one
     * does — via the same `identify()` — so the test measures the INJECTION gap
     * and not a stub that hands out keys for free.
     * @param {Function} sendToRenderer
     * @param {boolean} changed - the scanner's changed-pid-set flag
     * @returns {Object}
     */
    function makeStampingDeps(sendToRenderer, changed = false) {
      const { identify } = require_('../../src/main/process-identity.js');
      return {
        scanner: {
          // A FRESH array per tick, which is what the real scanner returns — the
          // injected synthetics live only in the previous tick's array and must
          // never be carried back into the identity stamp. `mockResolvedValue`
          // would hand out one shared array and quietly model the opposite.
          scanProcesses: vi.fn().mockImplementation(async () => ({
            agents: [
              { agent: 'Claude Code', process: 'claude.exe', pid: 100, startTime: 1717000000000 },
              { agent: 'Cursor', process: 'cursor.exe', pid: 200, startTime: 1717000100000 },
            ],
            changed,
          })),
        },
        procUtil: {
          enrichWithParentChains: vi.fn(async (agents) => {
            for (const a of agents) {
              const id = identify(a);
              a.instanceId = id.instanceId;
              a.instanceIdSource = id.instanceIdSource;
            }
          }),
          annotateHostApps: vi.fn(),
          annotateWorkingDirs: vi.fn().mockResolvedValue(),
        },
        watcher: { pruneKnownHandles: vi.fn(), scanAllFileHandles: vi.fn().mockResolvedValue([]) },
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
        logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
        sendToRenderer,
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
    }

    /**
     * Run one full process scan with both synthetic detectors stubbed, and return
     * the `scan-batch` payload.
     * @param {Array} ideAgents
     * @param {Array} wslAgents
     * @param {boolean} [changed]
     * @returns {Promise<{batch: Object, deps: Object}>}
     */
    async function runScanWithSynthetics(ideAgents, wslAgents, changed = false) {
      const ide = require_('../../src/main/ide-extension-detector.js');
      const wsl = require_('../../src/main/wsl-detector.js');
      const origIde = ide.getCachedExtensionAgents;
      const origWsl = wsl.getCachedWslAgents;
      ide.getCachedExtensionAgents = () => ideAgents;
      wsl.getCachedWslAgents = () => wslAgents;
      try {
        const sendToRenderer = vi.fn();
        const mockDeps = makeStampingDeps(sendToRenderer, changed);
        scanLoop.init(mockDeps);
        // A helper may be called twice in one test (the across-ticks case); drop
        // the previous interval so each call runs exactly one scan.
        scanLoop.stopScanIntervals();
        scanLoop.startScanIntervals(5000);
        await vi.advanceTimersByTimeAsync(5000);
        const batchCall = sendToRenderer.mock.calls.find((c) => c[0] === 'scan-batch');
        expect(batchCall).toBeTruthy();
        return { batch: batchCall[1], deps: mockDeps };
      } finally {
        ide.getCachedExtensionAgents = origIde;
        wsl.getCachedWslAgents = origWsl;
      }
    }

    /**
     * Both IDE-extension agents carry the SAME `process` (the editor host exe) —
     * that is what the real detector emits, and the reason the synthetic key
     * cannot be derived from `process`. Same for the two WSL agents' interpreter.
     */
    const IDE_SYNTHETICS = [
      {
        agent: 'Kilo Code',
        process: 'code.exe',
        pid: 0,
        status: 'running',
        category: 'ai',
        parentEditor: 'VS Code',
        detectionMethod: 'ide-extension',
      },
      {
        agent: 'Cline',
        process: 'code.exe',
        pid: 0,
        status: 'running',
        category: 'ai',
        parentEditor: 'VS Code',
        detectionMethod: 'ide-extension',
      },
    ];
    const WSL_SYNTHETICS = [
      {
        agent: 'grok',
        process: 'node',
        pid: 0,
        status: 'running',
        category: 'ai',
        parentEditor: 'WSL',
        host: 'wsl',
        wslPid: 4211,
        detectionMethod: 'wsl-process',
      },
      {
        agent: 'opencode',
        process: 'node',
        pid: 0,
        status: 'running',
        category: 'ai',
        parentEditor: 'WSL',
        host: 'wsl',
        wslPid: 4318,
        detectionMethod: 'wsl-process',
      },
    ];

    it('every agent in the scan-batch payload carries a non-empty instanceId', async () => {
      const { batch } = await runScanWithSynthetics(
        IDE_SYNTHETICS.map((a) => ({ ...a })),
        WSL_SYNTHETICS.map((a) => ({ ...a })),
      );

      // The invariant is asserted over the WHOLE batch, and the count is pinned
      // first so a batch that lost its synthetics cannot pass vacuously
      // (memory-bank/ai-mistakes.md#21): 2 scanned + 2 IDE + 2 WSL.
      expect(batch.agents).toHaveLength(6);
      const missing = batch.agents
        .filter((a) => typeof a.instanceId !== 'string' || a.instanceId.length === 0)
        .map((a) => a.agent);
      expect(missing).toEqual([]);
      // And every source is one of the three declared value spaces.
      for (const a of batch.agents) {
        expect(['os', 'synthetic', 'unknown']).toContain(a.instanceIdSource);
      }
    });

    it('two distinct pid-0 agents sharing a process name get distinct instanceIds', async () => {
      const { batch } = await runScanWithSynthetics(
        IDE_SYNTHETICS.map((a) => ({ ...a })),
        WSL_SYNTHETICS.map((a) => ({ ...a })),
      );

      const byName = new Map(batch.agents.map((a) => [a.agent, a.instanceId]));
      // Keyed on `process` these would all collapse: 0:code.exe twice, 0:node twice.
      expect(byName.get('Kilo Code')).toBe('0:kilo-code');
      expect(byName.get('Cline')).toBe('0:cline');
      expect(byName.get('grok')).toBe('0:grok');
      expect(byName.get('opencode')).toBe('0:opencode');
      // No two agents in the batch share a key, synthetic or otherwise.
      const ids = batch.agents.map((a) => a.instanceId);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('the synthetic key is stable across ticks — a card does not churn', async () => {
      const first = await runScanWithSynthetics(
        IDE_SYNTHETICS.map((a) => ({ ...a })),
        [],
      );
      const second = await runScanWithSynthetics(
        IDE_SYNTHETICS.map((a) => ({ ...a })),
        [],
      );
      const idsOf = (b) =>
        b.agents.filter((a) => a.pid === 0).map((a) => `${a.agent}=${a.instanceId}`);
      // Pinned literally, so two ticks of `undefined` cannot satisfy "stable".
      expect(idsOf(first.batch)).toEqual(['Kilo Code=0:kilo-code', 'Cline=0:cline']);
      expect(idsOf(second.batch)).toEqual(idsOf(first.batch));
    });
  });

  // ── cwd annotation forceRefresh wiring ──

  describe('annotateWorkingDirs forceRefresh wiring', () => {
    /** @param {boolean} changed @returns {Promise<Object>} the procUtil mock after one scan */
    async function scanWithChanged(changed) {
      const mockDeps = {
        scanner: {
          scanProcesses: vi
            .fn()
            .mockResolvedValue({ agents: [{ agent: 'Cursor', pid: 300 }], changed }),
        },
        procUtil: {
          enrichWithParentChains: vi.fn().mockResolvedValue(),
          annotateHostApps: vi.fn(),
          annotateWorkingDirs: vi.fn().mockResolvedValue(),
        },
        watcher: { pruneKnownHandles: vi.fn(), scanAllFileHandles: vi.fn().mockResolvedValue([]) },
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
        logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
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
      await vi.advanceTimersByTimeAsync(5000);
      return mockDeps.procUtil;
    }

    it('passes forceRefresh true when the scanned pid set changed, mirroring the identity stamp', async () => {
      const procUtil = await scanWithChanged(true);
      expect(procUtil.annotateWorkingDirs).toHaveBeenCalledWith(expect.any(Array), {
        forceRefresh: true,
      });
      // The two calls agree — a tick that re-identifies must also re-read the cwd.
      expect(procUtil.enrichWithParentChains).toHaveBeenCalledWith(expect.any(Array), {
        forceRefresh: true,
      });
    });

    it('passes forceRefresh false on an unchanged pid set, so the cache still serves', async () => {
      const procUtil = await scanWithChanged(false);
      expect(procUtil.annotateWorkingDirs).toHaveBeenCalledWith(expect.any(Array), {
        forceRefresh: false,
      });
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

  // ── reentrancy guard (doProcessScan) ──

  describe('reentrancy guard (doProcessScan)', () => {
    it('does not start an overlapping process scan while a previous scan is in-flight', async () => {
      // First scanProcesses call hangs forever (pending) so scan N stays in-flight
      // across the next interval tick; any later call resolves normally.
      const firstScan = new Promise(() => {});
      let scanCalls = 0;
      const scanProcesses = vi.fn().mockImplementation(() => {
        scanCalls += 1;
        return scanCalls === 1 ? firstScan : Promise.resolve({ agents: [], changed: false });
      });
      const mockDeps = {
        scanner: { scanProcesses },
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
        logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
        sendToRenderer: vi.fn(),
        fileAccessBatcher: { push: vi.fn() },
        statsUpdateBatcher: { push: vi.fn() },
        getStats: vi.fn().mockReturnValue({}),
        getResourceUsage: vi.fn().mockReturnValue({}),
        getLatestAgents: vi.fn().mockReturnValue([]),
        setAgents: vi.fn(),
        setLatestNetConnections: vi.fn(),
      };
      scanLoop.init(mockDeps);
      scanLoop.startScanIntervals(5000);

      await vi.advanceTimersByTimeAsync(5000); // tick 1 → scan starts, hangs on firstScan
      await vi.advanceTimersByTimeAsync(5000); // tick 2 → fires while scan 1 is in-flight

      // Assert inside the in-flight window (firstScan is never resolved). A guarded
      // doProcessScan short-circuits the second tick → 1 call; the unguarded (buggy)
      // version runs both overlapping bodies → 2 calls.
      expect(scanProcesses).toHaveBeenCalledTimes(1);
    });
  });

  // ── timing instrumentation (logger.debug under module 'scan') ──

  describe('timing instrumentation', () => {
    /** @param {Object} [overrides] @returns {Object} fresh mock deps for a scan run */
    function makeDeps(overrides = {}) {
      return {
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
        logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
        sendToRenderer: vi.fn(),
        fileAccessBatcher: { push: vi.fn() },
        statsUpdateBatcher: { push: vi.fn() },
        getStats: vi.fn().mockReturnValue({}),
        getResourceUsage: vi.fn().mockReturnValue({}),
        getLatestAgents: vi.fn().mockReturnValue([]),
        setAgents: vi.fn(),
        setLatestNetConnections: vi.fn(),
        ...overrides,
      };
    }

    it('emits scan/process debug timing with the batched agent count', async () => {
      const deps = makeDeps({
        scanner: {
          scanProcesses: vi
            .fn()
            .mockResolvedValue({ agents: [{ agent: 'Cursor' }], changed: false }),
        },
      });
      scanLoop.init(deps);
      scanLoop.startScanIntervals(5000);
      await vi.advanceTimersByTimeAsync(5000);

      const call = deps.logger.debug.mock.calls.find((c) => c[0] === 'scan' && c[1] === 'process');
      expect(call).toBeTruthy();
      // Fake timers can freeze performance.now → assert shape + bounds, not an exact value
      expect(call[2]).toEqual({ ms: expect.any(Number), agents: expect.any(Number) });
      expect(call[2].ms).toBeGreaterThanOrEqual(0);
      // agents = the enriched batch count (process + injected external + local-model agents)
      expect(call[2].agents).toBeGreaterThanOrEqual(1);
    });

    it('emits scan/network debug timing with the connection count', async () => {
      const deps = makeDeps({
        getLatestAgents: vi.fn().mockReturnValue([{ agent: 'Cursor' }]),
        network: {
          isNetworkScanRunning: vi.fn().mockReturnValue(false),
          setNetworkScanRunning: vi.fn(),
          scanNetworkConnections: vi.fn().mockResolvedValue([
            {
              agent: 'Cursor',
              remoteIp: '1.2.3.4',
              remotePort: 443,
              state: 'ESTABLISHED',
              flagged: false,
            },
          ]),
        },
      });
      scanLoop.init(deps);
      scanLoop.doNetworkScan();
      await vi.advanceTimersByTimeAsync(0); // flush the scanNetworkConnections promise chain

      const call = deps.logger.debug.mock.calls.find((c) => c[0] === 'scan' && c[1] === 'network');
      expect(call).toBeTruthy();
      expect(call[2]).toEqual({ ms: expect.any(Number), connections: 1 });
      expect(call[2].ms).toBeGreaterThanOrEqual(0);
    });

    it('emits scan/file debug timing after a file-handle scan', async () => {
      const deps = makeDeps({ getLatestAgents: vi.fn().mockReturnValue([{ agent: 'Cursor' }]) });
      scanLoop.init(deps);
      // staggeredStartup(_, paused=true): doProcessScan @3s, doFileScan @8s, no warmup
      scanLoop.staggeredStartup(5000, true);
      await vi.advanceTimersByTimeAsync(8000);

      const call = deps.logger.debug.mock.calls.find((c) => c[0] === 'scan' && c[1] === 'file');
      expect(call).toBeTruthy();
      expect(call[2]).toEqual({ ms: expect.any(Number) });
      expect(call[2].ms).toBeGreaterThanOrEqual(0);
    });
  });
});
