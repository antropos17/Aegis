import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';

describe('scan-loop', () => {
  let scanLoop;
  const require_ = createRequire(import.meta.url);

  /**
   * Inert command runner for resource-monitor, installed for the WHOLE file.
   *
   * `doProcessScan` fires `resourceMonitor.getResourcesForPids` for every scanned
   * pid > 0, so EVERY test here that drives a scan reaches it — not just the
   * `agent-resource-usage` block that asserts on the result. Left unstubbed, that
   * is the real `execFile`: a live `powershell.exe` / `nvidia-smi` per scanning
   * test, in CI as much as locally.
   *
   * Those spawns settle on REAL time while the tests run on fake timers, so a
   * chain started in one test resumes during whichever test happens to be running
   * when the OS answers — and calls the exec THAT test installed. That is how a
   * backlog of earlier scans landed on `makeVaryingExec` below and drove its
   * sample counter past the value the test had just measured (`expected 5 to be
   * 1`). An already-resolved promise keeps every chain inside the test that
   * started it, and `_setExecForTest` is module-level state that `_resetForTest`
   * deliberately does NOT restore, so it is re-armed on both sides of each test.
   * @returns {Promise<string>}
   */
  const inertExec = () => Promise.resolve('');

  /** Reset resource-monitor's module state and re-arm the inert exec. */
  function isolateResourceMonitor() {
    const rm = require_('../../src/main/resource-monitor.js');
    rm._resetForTest();
    rm._setLoggerForTest({ warn: vi.fn() });
    rm._setExecForTest(inertExec);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    // Clear CJS cache so each test gets fresh module-level state
    const scanLoopPath = require_.resolve('../../src/main/scan-loop.js');
    delete require_.cache[scanLoopPath];
    // Also clear llm-runtime-detector (required inside enrichWithLocalModels)
    const llmPath = require_.resolve('../../src/main/llm-runtime-detector.js');
    delete require_.cache[llmPath];
    // resource-monitor survives that cache clear — it is required at scan-loop's
    // module scope and holds the exec, so it is isolated explicitly instead.
    isolateResourceMonitor();
    scanLoop = require_('../../src/main/scan-loop.js');
  });

  afterEach(async () => {
    scanLoop.stopScanIntervals();
    // Settle the fire-and-forget resource push INSIDE the test that started it,
    // while its own exec is still the installed one. Pending timers are not run;
    // this only drains microtasks, which is all an inert exec needs.
    await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers();
    isolateResourceMonitor();
  });

  /**
   * Fresh mock deps for one scan run — every collaborator `doProcessScan` reaches
   * for, stubbed inert. Each caller overrides only the collaborator its assertions
   * are about, so a new dependency in scan-loop is added here once instead of in
   * every block that drives a scan.
   * @param {Object} [overrides]
   * @returns {Object}
   */
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
      statsUpdateBatcher: { push: vi.fn(), pushLazy: vi.fn() },
      getStats: vi.fn().mockReturnValue({}),
      getResourceUsage: vi.fn().mockReturnValue({}),
      getLatestAgents: vi.fn().mockReturnValue([]),
      setAgents: vi.fn(),
      setLatestNetConnections: vi.fn(),
      getPreviousPids: vi.fn().mockReturnValue(new Map()),
      setPreviousPids: vi.fn(),
      ...overrides,
    };
  }

  // ── dedupFileEvent (F-E03: instanceId-scoped, not display-name) ──

  describe('dedupFileEvent', () => {
    it('passes through first event for a stamped instance', () => {
      const ev = { agent: 'Cursor', instanceId: '1:aaa', file: '/etc/passwd' };
      const result = scanLoop.dedupFileEvent(ev);
      expect(result).not.toBeNull();
      expect(result.agent).toBe('Cursor');
      expect(result.repeatCount).toBe(1);
    });

    it('A: same instance + same path within 30s is suppressed', () => {
      const ev1 = { agent: 'Cursor', instanceId: '1:aaa', file: '/etc/passwd' };
      scanLoop.dedupFileEvent(ev1);
      const ev2 = { agent: 'Cursor', instanceId: '1:aaa', file: '/etc/passwd' };
      const result = scanLoop.dedupFileEvent(ev2);
      expect(result).toBeNull();
    });

    it('passes through after 30 second window for the same instance', () => {
      const ev1 = { agent: 'Cursor', instanceId: '1:aaa', file: '/etc/passwd' };
      scanLoop.dedupFileEvent(ev1);
      vi.advanceTimersByTime(31000);
      const ev2 = { agent: 'Cursor', instanceId: '1:aaa', file: '/etc/passwd' };
      const result = scanLoop.dedupFileEvent(ev2);
      expect(result).not.toBeNull();
      expect(result.repeatCount).toBe(1);
    });

    it('B: same display name, different instanceIds, same path — both survive', () => {
      // Historical bug: key was `${ev.agent}|${ev.file}` → second Claude Code dropped.
      const ev1 = { agent: 'Claude Code', instanceId: '100:t1', file: '/home/user/.ssh/id_rsa' };
      const ev2 = { agent: 'Claude Code', instanceId: '200:t2', file: '/home/user/.ssh/id_rsa' };
      expect(scanLoop.dedupFileEvent(ev1)).not.toBeNull();
      expect(scanLoop.dedupFileEvent(ev2)).not.toBeNull();
    });

    it('C: recycled PID with new instanceId is not suppressed by the old lifetime', () => {
      // Same pid number can reappear; stamped instanceId differs → independent buckets.
      const oldLife = { agent: 'Cursor', pid: 42, instanceId: '42:startA', file: '/tmp/x' };
      const newLife = { agent: 'Cursor', pid: 42, instanceId: '42:startB', file: '/tmp/x' };
      expect(scanLoop.dedupFileEvent(oldLife)).not.toBeNull();
      expect(scanLoop.dedupFileEvent(newLife)).not.toBeNull();
    });

    it('D: unattributed events for the same path do not collapse into a null bucket', () => {
      // Historical bug: key was `''|path` for all unattributed → one observation
      // suppressed all later independent unattributed hits within 30s.
      const u1 = {
        agent: '',
        pid: null,
        instanceId: null,
        file: '/home/user/.aws/credentials',
        attribution: { status: 'unattributed', evidence: ['no-ai-agents-online'] },
      };
      const u2 = {
        agent: '',
        pid: null,
        instanceId: null,
        file: '/home/user/.aws/credentials',
        attribution: { status: 'unattributed', evidence: ['no-owner-match'] },
      };
      expect(scanLoop.dedupFileEvent(u1)).not.toBeNull();
      expect(scanLoop.dedupFileEvent(u2)).not.toBeNull();
      expect(u1.instanceId).toBeNull();
      expect(u2.instanceId).toBeNull();
    });

    it('D: empty-string instanceId is treated as unattributed (no shared bucket)', () => {
      const a = { agent: '', instanceId: '', file: '/tmp/secret' };
      const b = { agent: '', instanceId: '', file: '/tmp/secret' };
      expect(scanLoop.dedupFileEvent(a)).not.toBeNull();
      expect(scanLoop.dedupFileEvent(b)).not.toBeNull();
    });

    it('E: same instance, different paths remain independent', () => {
      const x = { agent: 'Cursor', instanceId: '1:aaa', file: '/path/x' };
      const y = { agent: 'Cursor', instanceId: '1:aaa', file: '/path/y' };
      expect(scanLoop.dedupFileEvent(x)).not.toBeNull();
      expect(scanLoop.dedupFileEvent(y)).not.toBeNull();
    });

    it('tracks repeat count across suppressed same-instance events', () => {
      scanLoop.dedupFileEvent({ agent: 'A', instanceId: 'id:A', file: 'x' });
      scanLoop.dedupFileEvent({ agent: 'A', instanceId: 'id:A', file: 'x' });
      scanLoop.dedupFileEvent({ agent: 'A', instanceId: 'id:A', file: 'x' });
      scanLoop.dedupFileEvent({ agent: 'A', instanceId: 'id:A', file: 'x' });
      vi.advanceTimersByTime(31000);
      const result = scanLoop.dedupFileEvent({ agent: 'A', instanceId: 'id:A', file: 'x' });
      expect(result).not.toBeNull();
      // count starts at 1 on first registration, then +1 per suppressed event
      expect(result.repeatCount).toBe(4);
    });

    it('cleans up stale entries beyond 500', () => {
      for (let i = 0; i < 501; i++) {
        scanLoop.dedupFileEvent({ agent: 'A', instanceId: 'id:A', file: `f${i}` });
      }
      vi.advanceTimersByTime(61000);
      const result = scanLoop.dedupFileEvent({ agent: 'A', instanceId: 'id:A', file: 'trigger' });
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
        statsUpdateBatcher: { push: vi.fn(), pushLazy: vi.fn() },
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
          statsUpdateBatcher: { push: vi.fn(), pushLazy: vi.fn() },
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
      return makeDeps({
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
        sendToRenderer,
      });
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

  // ── identity degradation freezes sessions instead of splitting them ──

  describe('identity degradation during a snapshot outage', () => {
    /**
     * The predicate itself, exercised on the REAL process-scanner.
     *
     * It lives here rather than in `process-scanner.test.js` because this is the
     * consumer that acts on it: nothing else in the codebase gates on identity
     * quality (`getIdentityQuality` is annotation by design), so the contract and
     * the only thing that reads it are asserted together.
     */
    describe('scanner.isIdentityDegraded()', () => {
      let scanner;
      let SENSOR_HEALTH_STATE;

      beforeEach(() => {
        scanner = require_('../../src/main/process-scanner.js');
        SENSOR_HEALTH_STATE = require_('../../src/main/sensor-health.js').SENSOR_HEALTH_STATE;
        scanner._resetForTest();
      });

      afterEach(() => {
        // Module-level overrides — restore, or a later test inherits this
        // platform's identity story.
        scanner._resetForTest();
      });

      /**
       * @param {boolean} providesStartTime
       * @param {string} snapshotState
       * @returns {boolean}
       */
      function degradedWith(providesStartTime, snapshotState) {
        scanner._setPlatformForTest({
          providesStartTime,
          getSnapshotHealth: () => ({ state: snapshotState }),
        });
        return scanner.isIdentityDegraded();
      }

      it('a birth-time platform whose observation FAILED is degraded', () => {
        expect(degradedWith(true, SENSOR_HEALTH_STATE.FAILED)).toBe(true);
      });

      it('a birth-time platform that has not observed yet is degraded', () => {
        expect(degradedWith(true, SENSOR_HEALTH_STATE.STARTING)).toBe(true);
      });

      it('a healthy observation is not degraded', () => {
        expect(degradedWith(true, SENSOR_HEALTH_STATE.HEALTHY)).toBe(false);
      });

      it('the CIM fallback is not degradation — the keys still form the same way', () => {
        expect(degradedWith(true, SENSOR_HEALTH_STATE.DEGRADED)).toBe(false);
      });

      it('linux/darwin are NEVER degraded, whatever the snapshot leaf says', () => {
        // `<pid>:u` is their steady state, not an outage. Reading their permanent
        // `identityQuality: 'unknown'` as degradation would freeze session tracking
        // on those platforms forever.
        expect(degradedWith(false, SENSOR_HEALTH_STATE.FAILED)).toBe(false);
        expect(degradedWith(false, SENSOR_HEALTH_STATE.STARTING)).toBe(false);
        expect(degradedWith(false, SENSOR_HEALTH_STATE.HEALTHY)).toBe(false);
      });
    });

    /**
     * Deps for a birth-time platform whose process map can be taken away.
     *
     * `enrichWithParentChains` is faithful to `_stampFromFreshBirthTimes`: the birth
     * time comes from THIS pass's map or is null, and `identify()` does the rest —
     * so an emptied map produces `<pid>:u` here for the same reason it does in
     * production. `isIdentityDegraded` answers off the same map, which is the
     * coupling process-snapshot.js publishes (an empty map is a failed observation).
     * @param {{map: Map<number, number>}} state - mutable, so a tick can take the
     *   observation away between two `advanceTimersByTimeAsync` calls.
     * @returns {Object}
     */
    function makeOutageDeps(state) {
      const { identify } = require_('../../src/main/process-identity.js');
      return makeDeps({
        scanner: {
          scanProcesses: vi.fn().mockImplementation(async () => ({
            agents: [
              { agent: 'Claude Code', process: 'claude.exe', pid: 100 },
              { agent: 'Cursor', process: 'cursor.exe', pid: 200 },
            ],
            changed: false,
            reliable: true,
          })),
          isIdentityDegraded: vi.fn(() => state.map.size === 0),
        },
        procUtil: {
          enrichWithParentChains: vi.fn(async (agents) => {
            for (const a of agents) {
              a.startTime = state.map.has(a.pid) ? state.map.get(a.pid) : null;
              const id = identify(a);
              a.instanceId = id.instanceId;
              a.instanceIdSource = id.instanceIdSource;
            }
          }),
          annotateHostApps: vi.fn(),
          annotateWorkingDirs: vi.fn().mockResolvedValue(),
        },
      });
    }

    /** The birth times the two agents keep for their whole life. */
    const LIVE_MAP = () =>
      new Map([
        [100, 1717000000000],
        [200, 1717000100000],
      ]);

    /**
     * @param {Object} deps
     * @param {string} type
     * @returns {Array<Object>} the audit payloads of one kind, in order.
     */
    function auditOf(deps, type) {
      return deps.audit.log.mock.calls.filter((c) => c[0] === type).map((c) => c[1]);
    }

    it('a snapshot outage emits no agent-exit and no duplicate agent-enter', async () => {
      // session-tracker holds module state that this file's cache clear does not
      // reach, so this block starts from an empty session set explicitly.
      require_('../../src/main/session-tracker.js')._resetForTest();

      const state = { map: LIVE_MAP() };
      const deps = makeOutageDeps(state);
      scanLoop.init(deps);
      scanLoop.stopScanIntervals();
      scanLoop.startScanIntervals(5000);

      await vi.advanceTimersByTimeAsync(5000); // tick 1 — both agents enter
      state.map = new Map(); // the provider falls over
      await vi.advanceTimersByTimeAsync(5000); // tick 2 — keys would flip to :u
      await vi.advanceTimersByTimeAsync(5000); // tick 3 — grace 2 would fire here
      state.map = LIVE_MAP(); // the provider comes back
      await vi.advanceTimersByTimeAsync(5000); // tick 4 — mirror pair would fire here

      const entered = auditOf(deps, 'agent-enter');
      expect(auditOf(deps, 'agent-exit')).toHaveLength(0);
      expect(entered).toHaveLength(2);
      expect(entered.map((e) => e.instanceId).sort()).toEqual([
        '100:1717000000000',
        '200:1717000100000',
      ]);
    });

    it('the scan-batch still carries the honest degraded key while frozen', async () => {
      // Freezing is about SESSION state. The batch is an observation and must keep
      // reporting what was actually observed — `<pid>:u`, not a remembered key.
      require_('../../src/main/session-tracker.js')._resetForTest();

      const state = { map: LIVE_MAP() };
      const deps = makeOutageDeps(state);
      scanLoop.init(deps);
      scanLoop.stopScanIntervals();
      scanLoop.startScanIntervals(5000);

      await vi.advanceTimersByTimeAsync(5000);
      state.map = new Map();
      await vi.advanceTimersByTimeAsync(5000);

      const batches = deps.sendToRenderer.mock.calls.filter((c) => c[0] === 'scan-batch');
      expect(batches).toHaveLength(2);
      expect(batches[1][1].agents.map((a) => a.instanceId)).toEqual(['100:u', '200:u']);
    });
  });

  // ── attachModels order + instanceId stamp (local LLM runtimes) ──

  describe('attachModels before scan-batch', () => {
    /**
     * Point llm-runtime-detector at fixed async results for this test, then restore.
     * @param {{ollama?: {running:boolean,models:string[]}, lmstudio?: {running:boolean,models:string[]}}} responses
     * @param {() => Promise<void>} body
     */
    async function withLlmDetectors(responses, body) {
      const llm = require_('../../src/main/llm-runtime-detector.js');
      const origO = llm.detectOllamaModels;
      const origL = llm.detectLMStudioModels;
      llm.detectOllamaModels = async () => responses.ollama || { running: false, models: [] };
      llm.detectLMStudioModels = async () => responses.lmstudio || { running: false, models: [] };
      try {
        await body();
      } finally {
        llm.detectOllamaModels = origO;
        llm.detectLMStudioModels = origL;
      }
    }

    it('includes a stamped Ollama synthetic in the scan-batch (not a post-send ghost)', async () => {
      await withLlmDetectors(
        { ollama: { running: true, models: ['llama3'] }, lmstudio: { running: false, models: [] } },
        async () => {
          const sendToRenderer = vi.fn();
          const deps = makeDeps({
            scanner: {
              scanProcesses: vi.fn().mockResolvedValue({
                agents: [
                  {
                    agent: 'Claude Code',
                    process: 'claude.exe',
                    pid: 100,
                    startTime: 1717000000000,
                    instanceId: '100:1717000000000',
                    instanceIdSource: 'os',
                  },
                ],
                changed: false,
              }),
            },
            sendToRenderer,
          });
          scanLoop.init(deps);
          scanLoop.startScanIntervals(5000);
          await vi.advanceTimersByTimeAsync(5000);

          const batchCall = sendToRenderer.mock.calls.find((c) => c[0] === 'scan-batch');
          expect(batchCall).toBeTruthy();
          const ollama = batchCall[1].agents.find((a) => a.agent === 'Ollama');
          expect(ollama).toBeTruthy();
          expect(ollama.localModels).toEqual(['llama3']);
          // Space 2 synthetic from display name (not process host, not name fabrication beyond identify).
          expect(ollama.instanceId).toBe('0:ollama');
          expect(ollama.instanceIdSource).toBe('synthetic');
          // Distinct from the real scanned agent — same-name cross-association cannot apply.
          expect(ollama.instanceId).not.toBe('100:1717000000000');
        },
      );
    });

    it('preserves an already-stamped instanceId when only attaching models', async () => {
      await withLlmDetectors({ ollama: { running: true, models: ['mistral'] } }, async () => {
        const stampedId = '4242:1717000999999';
        const sendToRenderer = vi.fn();
        const deps = makeDeps({
          scanner: {
            scanProcesses: vi.fn().mockResolvedValue({
              agents: [
                {
                  agent: 'Ollama',
                  process: 'ollama.exe',
                  pid: 4242,
                  startTime: 1717000999999,
                  instanceId: stampedId,
                  instanceIdSource: 'os',
                },
              ],
              changed: false,
            }),
          },
          // Parent-chain stub must NOT wipe the stamp (real path preserves it).
          procUtil: {
            enrichWithParentChains: vi.fn().mockResolvedValue(),
            annotateHostApps: vi.fn(),
            annotateWorkingDirs: vi.fn().mockResolvedValue(),
          },
          sendToRenderer,
        });
        scanLoop.init(deps);
        scanLoop.startScanIntervals(5000);
        await vi.advanceTimersByTimeAsync(5000);

        const batch = sendToRenderer.mock.calls.find((c) => c[0] === 'scan-batch')[1];
        const ollama = batch.agents.find((a) => a.agent === 'Ollama');
        expect(ollama.localModels).toEqual(['mistral']);
        // attachModels must not re-derive over an authoritative stamp (PID reuse / name traps).
        expect(ollama.instanceId).toBe(stampedId);
        expect(ollama.instanceIdSource).toBe('os');
      });
    });

    it('stamps two concurrent local runtimes distinctly by name, not pid', async () => {
      await withLlmDetectors(
        {
          ollama: { running: true, models: ['a'] },
          lmstudio: { running: true, models: ['b'] },
        },
        async () => {
          const sendToRenderer = vi.fn();
          scanLoop.init(
            makeDeps({
              scanner: {
                scanProcesses: vi.fn().mockResolvedValue({ agents: [], changed: false }),
              },
              sendToRenderer,
            }),
          );
          scanLoop.startScanIntervals(5000);
          await vi.advanceTimersByTimeAsync(5000);

          const agents = sendToRenderer.mock.calls.find((c) => c[0] === 'scan-batch')[1].agents;
          const ollama = agents.find((a) => a.agent === 'Ollama');
          const lm = agents.find((a) => a.agent === 'LM Studio');
          expect(ollama.instanceId).toBe('0:ollama');
          expect(lm.instanceId).toBe('0:lm-studio');
          expect(ollama.instanceId).not.toBe(lm.instanceId);
          // Both are pid 0 — pid alone would collide; identity is not the bare pid.
          expect(ollama.pid).toBe(0);
          expect(lm.pid).toBe(0);
        },
      );
    });

    it('does not invent identity from name when the runtime is not running', async () => {
      await withLlmDetectors(
        { ollama: { running: false, models: [] }, lmstudio: { running: false, models: [] } },
        async () => {
          const sendToRenderer = vi.fn();
          scanLoop.init(
            makeDeps({
              scanner: {
                scanProcesses: vi.fn().mockResolvedValue({ agents: [], changed: false }),
              },
              sendToRenderer,
            }),
          );
          scanLoop.startScanIntervals(5000);
          await vi.advanceTimersByTimeAsync(5000);

          const agents = sendToRenderer.mock.calls.find((c) => c[0] === 'scan-batch')[1].agents;
          expect(agents.find((a) => a.agent === 'Ollama')).toBeUndefined();
          expect(agents.find((a) => a.agent === 'LM Studio')).toBeUndefined();
        },
      );
    });
  });

  // ── cwd annotation forceRefresh wiring ──

  describe('annotateWorkingDirs forceRefresh wiring', () => {
    /** @param {boolean} changed @returns {Promise<Object>} the procUtil mock after one scan */
    async function scanWithChanged(changed) {
      const mockDeps = makeDeps({
        scanner: {
          scanProcesses: vi
            .fn()
            .mockResolvedValue({ agents: [{ agent: 'Cursor', pid: 300 }], changed }),
        },
      });
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
        statsUpdateBatcher: { push: vi.fn(), pushLazy: vi.fn() },
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

    it('B-S08: empty agents + unreliable process population logs process-unavailable skip', () => {
      const scanNet = vi.fn().mockResolvedValue([]);
      const noteSkip = vi.fn();
      const deps = makeDeps({
        getLatestAgents: vi.fn().mockReturnValue([]),
        scanner: {
          scanProcesses: vi.fn(),
          isProcessPopulationReliable: vi.fn().mockReturnValue(false),
          getProcessSensorHealth: vi.fn().mockReturnValue({ state: 'FAILED' }),
        },
        network: {
          isNetworkScanRunning: vi.fn().mockReturnValue(false),
          setNetworkScanRunning: vi.fn(),
          scanNetworkConnections: scanNet,
          noteNetworkSkip: noteSkip,
        },
      });
      scanLoop.init(deps);
      scanLoop.doNetworkScan();
      expect(scanNet).not.toHaveBeenCalled();
      const skip = deps.logger.debug.mock.calls.find(
        (c) => c[0] === 'scan' && c[1] === 'network-skip',
      );
      expect(skip).toBeTruthy();
      expect(skip[2].reason).toBe('process-observation-unavailable');
      expect(noteSkip).toHaveBeenCalledWith('process-observation-unavailable');
    });

    it('B-S08: empty agents + reliable process population logs confirmed-zero skip', () => {
      const scanNet = vi.fn().mockResolvedValue([]);
      const noteSkip = vi.fn();
      const deps = makeDeps({
        getLatestAgents: vi.fn().mockReturnValue([]),
        scanner: {
          scanProcesses: vi.fn(),
          isProcessPopulationReliable: vi.fn().mockReturnValue(true),
          getProcessSensorHealth: vi.fn().mockReturnValue({ state: 'HEALTHY' }),
        },
        network: {
          isNetworkScanRunning: vi.fn().mockReturnValue(false),
          setNetworkScanRunning: vi.fn(),
          scanNetworkConnections: scanNet,
          noteNetworkSkip: noteSkip,
        },
      });
      scanLoop.init(deps);
      scanLoop.doNetworkScan();
      expect(scanNet).not.toHaveBeenCalled();
      const skip = deps.logger.debug.mock.calls.find(
        (c) => c[0] === 'scan' && c[1] === 'network-skip',
      );
      expect(skip[2].reason).toBe('confirmed-zero-agents');
      expect(noteSkip).toHaveBeenCalledWith('confirmed-zero-agents');
    });

    it('B-S08: confirmed-zero and process-unavailable skip reasons stay distinct', () => {
      const noteSkip = vi.fn();
      const baseNet = {
        isNetworkScanRunning: vi.fn().mockReturnValue(false),
        setNetworkScanRunning: vi.fn(),
        scanNetworkConnections: vi.fn(),
        noteNetworkSkip: noteSkip,
      };
      const depsUnrel = makeDeps({
        getLatestAgents: vi.fn().mockReturnValue([]),
        scanner: {
          scanProcesses: vi.fn(),
          isProcessPopulationReliable: vi.fn().mockReturnValue(false),
        },
        network: baseNet,
      });
      scanLoop.init(depsUnrel);
      scanLoop.doNetworkScan();
      const depsRel = makeDeps({
        getLatestAgents: vi.fn().mockReturnValue([]),
        scanner: {
          scanProcesses: vi.fn(),
          isProcessPopulationReliable: vi.fn().mockReturnValue(true),
        },
        network: baseNet,
      });
      scanLoop.init(depsRel);
      scanLoop.doNetworkScan();
      expect(noteSkip.mock.calls.map((c) => c[0])).toEqual([
        'process-observation-unavailable',
        'confirmed-zero-agents',
      ]);
    });

    it('B-S02: hard process scan failure notes process health FAILED', async () => {
      const note = vi.fn();
      const deps = makeDeps({
        scanner: {
          scanProcesses: vi.fn().mockRejectedValue(new Error('spawn ENOENT')),
          noteProcessScanHardFailure: note,
        },
      });
      scanLoop.init(deps);
      // doProcessScan is not exported — drive via staggeredStartup first tick
      scanLoop.staggeredStartup(5000, true);
      await vi.advanceTimersByTimeAsync(3000);
      expect(note).toHaveBeenCalled();
      expect(note.mock.calls[0][0].message).toMatch(/ENOENT/);
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

  // ── C2: anomaly scores leave the main process per instance ──

  describe('anomaly scores in the scan batch', () => {
    // Two instances of ONE agent name, plus a keyless pid-0 synthetic.
    const A = '1000:1700000000000';
    const B = '2000:1700000009999';
    // The LOUD instance (B, score 45) is deliberately first: with it last, a
    // last-writer-wins bug would also produce 45 and the max assertion below would pass
    // for the wrong reason.
    const AGENTS = [
      { agent: 'Claude Code', pid: 2000, instanceId: B, category: 'ai' },
      { agent: 'Claude Code', pid: 1000, instanceId: A, category: 'ai' },
      { agent: 'Ollama', pid: 0, category: 'local-llm-runtime' },
    ];

    /** @returns {Promise<{batch: Object, deps: Object}>} */
    async function runScan() {
      const deps = makeDeps({
        scanner: {
          scanProcesses: vi
            .fn()
            .mockResolvedValue({ agents: AGENTS.map((a) => ({ ...a })), changed: false }),
        },
        anomaly: {
          checkDeviations: vi.fn().mockReturnValue([]),
          // Scores by INSTANCE key. A name reaching this stub would score 0, which is
          // what makes the assertions below able to tell the two keyings apart.
          calculateAnomalyScore: vi.fn((key) => ({
            score: key === A ? 10 : key === B ? 45 : 0,
          })),
        },
      });
      scanLoop.init(deps);
      scanLoop.startScanIntervals(5000);
      await vi.advanceTimersByTimeAsync(5000);
      const batchCall = deps.sendToRenderer.mock.calls.find((c) => c[0] === 'scan-batch');
      expect(batchCall).toBeTruthy();
      return { batch: batchCall[1], deps };
    }

    it('emits one anomaly score per instance, keyed on instanceId', async () => {
      const { batch, deps } = await runScan();
      expect(batch.anomalyScoresByInstance).toEqual({ [A]: 10, [B]: 45 });
      // The scorer is asked by key only — never by display name.
      const askedFor = deps.anomaly.calculateAnomalyScore.mock.calls.map((c) => c[0]);
      expect(askedFor).not.toContain('Claude Code');
      expect(askedFor).not.toContain('Ollama');
    });

    it('keeps the name-keyed map for the renderer, aggregated as max', async () => {
      const { batch } = await runScan();
      // 45, not 10 and not 55: the highest-risk instance represents the name on the
      // rolled-up card, and the per-instance values stay available above.
      expect(batch.anomalyScores['Claude Code']).toBe(45);
      // A keyless agent still gets its name entry at 0 — the key set is unchanged.
      expect(batch.anomalyScores['Ollama']).toBe(0);
    });

    it('a keyless agent gets no per-instance entry', async () => {
      const { batch } = await runScan();
      expect(Object.keys(batch.anomalyScoresByInstance).sort()).toEqual([A, B].sort());
    });

    it('records a network endpoint under the connection instance key, name second', async () => {
      const deps = makeDeps({
        getLatestAgents: vi.fn().mockReturnValue([{ agent: 'Claude Code' }]),
        network: {
          isNetworkScanRunning: vi.fn().mockReturnValue(false),
          setNetworkScanRunning: vi.fn(),
          scanNetworkConnections: vi.fn().mockResolvedValue([
            {
              agent: 'Claude Code',
              instanceId: A,
              remoteIp: '1.2.3.4',
              remotePort: 443,
              state: 'ESTABLISHED',
              flagged: false,
            },
            // Matched no agent: no name, no key. It is passed through as-is, and
            // baselines.js drops it rather than filing it under the empty name.
            {
              agent: '',
              instanceId: null,
              remoteIp: '9.9.9.9',
              remotePort: 80,
              state: 'ESTABLISHED',
              flagged: true,
            },
          ]),
        },
      });
      scanLoop.init(deps);
      scanLoop.doNetworkScan();
      await vi.advanceTimersByTimeAsync(0);

      expect(deps.baselines.recordNetworkEndpoint.mock.calls).toEqual([
        [A, 'Claude Code', '1.2.3.4', 443],
        [null, '', '9.9.9.9', 80],
      ]);
    });

    it('stamps the deviation instance key on the anomaly-alert audit entry', async () => {
      const deps = makeDeps({
        scanner: {
          scanProcesses: vi
            .fn()
            .mockResolvedValue({ agents: AGENTS.map((a) => ({ ...a })), changed: false }),
        },
        anomaly: {
          checkDeviations: vi.fn().mockReturnValue([
            {
              agent: 'Claude Code',
              instanceId: B,
              type: 'files',
              message: 'Claude Code normally accesses ~2 files, now 20',
              anomalyScore: 45,
            },
          ]),
          calculateAnomalyScore: vi.fn().mockReturnValue({ score: 0 }),
        },
      });
      scanLoop.init(deps);
      scanLoop.startScanIntervals(5000);
      await vi.advanceTimersByTimeAsync(5000);

      const alert = deps.audit.log.mock.calls.find((c) => c[0] === 'anomaly-alert');
      expect(alert).toBeTruthy();
      expect(alert[1].agent).toBe('Claude Code');
      expect(alert[1].instanceId).toBe(B);
      // Still no pid: the detector held a bucket, never a process object.
      expect(alert[1].pid).toBeNull();
    });
  });

  // ── per-agent resource push (`agent-resource-usage`) ──

  describe('agent-resource-usage push', () => {
    const MB = 1048576;

    /**
     * An exec whose CPU/RAM answer changes on every sampling call, so a figure in the
     * payload proves WHICH sample produced it — the only way a cached record and a
     * fresh one can be told apart. Sample n reports every pid at n MB. GPU absent.
     * @returns {Function}
     */
    function makeVaryingExec() {
      let sample = 0;
      return vi.fn((cmd) => {
        if (cmd === 'nvidia-smi') {
          return Promise.reject(Object.assign(new Error('not found'), { code: 'ENOENT' }));
        }
        if (cmd === 'powershell.exe') {
          sample++;
          return Promise.resolve(
            JSON.stringify(
              [100, 200, 300, 400].map((pid) => ({
                IDProcess: pid,
                PercentProcessorTime: sample,
                WorkingSet: sample * MB,
              })),
            ),
          );
        }
        if (cmd === 'ps') {
          sample++;
          return Promise.resolve(
            [100, 200, 300, 400].map((pid) => `${pid} ${sample}.0 ${sample * 1024}`).join('\n'),
          );
        }
        return Promise.resolve('');
      });
    }

    /**
     * scan-loop requires resource-monitor at module scope, and the CJS cache hands both
     * the same instance — so injecting here injects into the module under test. Returns
     * the module so the test can reset it.
     * @param {Function} exec
     * @returns {Object}
     */
    function stubResourceMonitor(exec) {
      const rm = require_('../../src/main/resource-monitor.js');
      rm._resetForTest();
      rm._setLoggerForTest({ warn: vi.fn() });
      rm._setExecForTest(exec);
      return rm;
    }

    /**
     * Deps whose enrich stamps identity through the real `identify()`, over a fresh
     * agent array per tick — `scanProcesses` is driven by the supplied factory so a
     * test can change what the SECOND tick sees.
     * @param {Function} sendToRenderer
     * @param {Function} agentsForTick - () => Array, called once per scan
     * @returns {Object}
     */
    function makeStampingDeps(sendToRenderer, agentsForTick) {
      const { identify } = require_('../../src/main/process-identity.js');
      return makeDeps({
        scanner: {
          scanProcesses: vi.fn().mockImplementation(async () => ({
            agents: agentsForTick(),
            changed: false,
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
        sendToRenderer,
      });
    }

    /** Every `agent-resource-usage` payload sent so far, oldest first. */
    function pushes(sendToRenderer) {
      return sendToRenderer.mock.calls
        .filter((c) => c[0] === 'agent-resource-usage')
        .map((c) => c[1]);
    }

    it('every emitted record carries the instanceId stamped on that same tick', async () => {
      stubResourceMonitor(makeVaryingExec());
      const sendToRenderer = vi.fn();
      const deps = makeStampingDeps(sendToRenderer, () => [
        { agent: 'Claude Code', process: 'claude.exe', pid: 100, startTime: 1717000000000 },
        { agent: 'Cursor', process: 'cursor.exe', pid: 200, startTime: 1717000100000 },
      ]);
      scanLoop.init(deps);
      scanLoop.startScanIntervals(1000);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(0); // let the fire-and-forget push settle

      const batch = sendToRenderer.mock.calls.find((c) => c[0] === 'scan-batch')[1];
      const [records] = pushes(sendToRenderer);
      expect(records).toBeTruthy();

      // The keys in the payload are the keys the very same batch carries — not
      // re-resolved, not name-matched.
      const batchKeys = new Map(
        batch.agents.filter((a) => a.pid > 0).map((a) => [a.pid, a.instanceId]),
      );
      expect(records.length).toBe(batchKeys.size);
      for (const r of records) {
        expect(r.instanceId).toBe(batchKeys.get(r.pid));
        expect(typeof r.instanceId).toBe('string');
      }
    });

    it('a recycled pid does not inherit the previous instance’s cached sample', async () => {
      stubResourceMonitor(makeVaryingExec());
      const sendToRenderer = vi.fn();
      let tick = 0;
      const deps = makeStampingDeps(sendToRenderer, () => {
        tick++;
        // Same pid, two lives: tick 2 is a DIFFERENT process wearing pid 100.
        return [
          {
            agent: 'Claude Code',
            process: 'claude.exe',
            pid: 100,
            startTime: tick === 1 ? 1717000000000 : 1717000999000,
          },
        ];
      });
      scanLoop.init(deps);
      // 1s apart, well inside the 5s resource TTL — so a pid-keyed cache WOULD hit.
      scanLoop.startScanIntervals(1000);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(0);

      const [first, second] = pushes(sendToRenderer);
      expect(first[0].instanceId).toBe('100:1717000000000');
      expect(second[0].instanceId).toBe('100:1717000999000');
      // Distinct measurements: the second life was sampled afresh (2 MB), not served
      // the first life's cached 1 MB.
      expect(first[0].memMb).toBe(1);
      expect(second[0].memMb).toBe(2);
    });

    it('unstamped agents ride along as separate null-key records, not one bucket', async () => {
      stubResourceMonitor(makeVaryingExec());
      const sendToRenderer = vi.fn();
      // Default deps: enrichWithParentChains is inert, so nothing is stamped — the
      // defensive case the payload shape has to survive.
      const deps = makeDeps({
        scanner: {
          scanProcesses: vi.fn().mockImplementation(async () => ({
            agents: [
              { agent: 'Claude Code', process: 'claude.exe', pid: 300 },
              { agent: 'Cursor', process: 'cursor.exe', pid: 400 },
            ],
            changed: false,
          })),
        },
        sendToRenderer,
      });
      scanLoop.init(deps);
      scanLoop.startScanIntervals(1000);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(0);

      const [records] = pushes(sendToRenderer);
      const unkeyed = records.filter((r) => r.instanceId === null);
      expect(unkeyed.map((r) => r.pid).sort()).toEqual([300, 400]);
      expect(unkeyed).toHaveLength(2); // two rows, each keeping its own pid
    });

    it('synthetic pid-0 agents are not sampled — the OS has nothing to answer for them', async () => {
      stubResourceMonitor(makeVaryingExec());
      const sendToRenderer = vi.fn();
      const deps = makeStampingDeps(sendToRenderer, () => [
        { agent: 'Claude Code', process: 'claude.exe', pid: 100, startTime: 1717000000000 },
        { agent: 'Kilo Code', process: 'code.exe', pid: 0 },
      ]);
      scanLoop.init(deps);
      scanLoop.startScanIntervals(1000);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(0);

      const [records] = pushes(sendToRenderer);
      expect(records.every((r) => r.pid > 0)).toBe(true);
      expect(records.some((r) => r.pid === 100)).toBe(true);
    });
  });

  // ── sequence-engine taps (docs/roadmap/sequence-rules.md §5) ──

  describe('sequence-engine taps', () => {
    /** A fake engine: the two calls the taps make, nothing else. */
    function makeEngine() {
      return { ingest: vi.fn(), sweep: vi.fn() };
    }

    /**
     * Two file events of one instance on ONE path: the first passes `dedupFileEvent`
     * and the second is dropped by the 30 s window — so a tap fed the RAW list would
     * call ingest twice and a tap fed the deduped list exactly once.
     * @returns {Array<Object>}
     */
    function twoEventsOnePath() {
      return [
        {
          agent: 'Claude Code',
          pid: 100,
          instanceId: '100:1717000000000',
          file: 'C:\\Users\\me\\passwords.txt',
          action: 'holding',
          sensitive: true,
          category: 'ai',
          attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] },
        },
        {
          agent: 'Claude Code',
          pid: 100,
          instanceId: '100:1717000000000',
          file: 'C:\\Users\\me\\passwords.txt',
          action: 'holding',
          sensitive: true,
          category: 'ai',
          attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] },
        },
      ];
    }

    it('tap 2: doFileScan ingests each event that passed dedup and none that dedup dropped', async () => {
      const sequenceEngine = makeEngine();
      const raw = twoEventsOnePath();
      const deps = makeDeps({
        getLatestAgents: vi.fn().mockReturnValue([{ agent: 'Claude Code' }]),
        watcher: {
          pruneKnownHandles: vi.fn(),
          scanAllFileHandles: vi.fn().mockResolvedValue(raw),
        },
        sequenceEngine,
      });
      scanLoop.init(deps);
      // staggeredStartup(_, paused=true): doProcessScan @3s, doFileScan @8s, no warmup
      scanLoop.staggeredStartup(5000, true);
      await vi.advanceTimersByTimeAsync(8000);

      expect(sequenceEngine.ingest).toHaveBeenCalledTimes(1);
      // The SAME record the audit call received — dedup stamps `repeatCount` on it.
      expect(sequenceEngine.ingest).toHaveBeenCalledWith(raw[0]);
      expect(sequenceEngine.ingest).not.toHaveBeenCalledWith(raw[1]);
      expect(deps.audit.log.mock.calls.filter((c) => c[0] === 'file-access')).toHaveLength(1);
    });

    it('tap 2: doHotReadScan ingests the deduped hot-read events through the same tap', async () => {
      const sequenceEngine = makeEngine();
      const raw = twoEventsOnePath();
      const deps = makeDeps({
        getLatestAgents: vi.fn().mockReturnValue([{ agent: 'Claude Code' }]),
        watcher: {
          pruneKnownHandles: vi.fn(),
          scanAllFileHandles: vi.fn().mockResolvedValue([]),
          scanHotFileHolders: vi.fn().mockResolvedValue(raw),
          isHotReadScanActive: vi.fn().mockReturnValue(true),
        },
        sequenceEngine,
      });
      scanLoop.init(deps);
      // The hot-read interval is 10 s and only exists when the watcher reports it
      // active; the process tick is pushed past it so the first hot read is the only
      // scan that has run.
      scanLoop.startScanIntervals(20000);
      await vi.advanceTimersByTimeAsync(10000);

      expect(deps.watcher.scanHotFileHolders).toHaveBeenCalledTimes(1);
      expect(sequenceEngine.ingest).toHaveBeenCalledTimes(1);
      expect(sequenceEngine.ingest).toHaveBeenCalledWith(raw[0]);
      expect(sequenceEngine.ingest).not.toHaveBeenCalledWith(raw[1]);
    });

    it('tap 3: doNetworkScan ingests every connection it records, keyless ones included', async () => {
      const sequenceEngine = makeEngine();
      const connections = [
        {
          agent: 'Claude Code',
          pid: 100,
          instanceId: '100:1717000000000',
          remoteIp: '1.2.3.4',
          remotePort: 443,
          state: 'ESTABLISHED',
          flagged: false,
        },
        // Matched no agent: the engine's own null policy skips and counts it — the
        // tap does not pre-filter (roadmap §4).
        {
          agent: '',
          pid: null,
          instanceId: null,
          remoteIp: '9.9.9.9',
          remotePort: 80,
          state: 'ESTABLISHED',
          flagged: true,
        },
      ];
      const deps = makeDeps({
        getLatestAgents: vi.fn().mockReturnValue([{ agent: 'Claude Code' }]),
        network: {
          isNetworkScanRunning: vi.fn().mockReturnValue(false),
          setNetworkScanRunning: vi.fn(),
          scanNetworkConnections: vi.fn().mockResolvedValue(connections),
        },
        sequenceEngine,
      });
      scanLoop.init(deps);
      scanLoop.doNetworkScan();
      await vi.advanceTimersByTimeAsync(0);

      expect(sequenceEngine.ingest.mock.calls.map((c) => c[0])).toEqual(connections);
      // Beside `recordNetworkEndpoint`: one ingest per endpoint recorded, same objects.
      expect(deps.baselines.recordNetworkEndpoint).toHaveBeenCalledTimes(2);
    });

    /**
     * Deps whose scanner returns a stamped agent on the ticks `present` says so, so
     * session-tracker reports an enter on the first tick and — after the exit grace —
     * an exit once the agent is gone.
     * @param {Object} sequenceEngine
     * @param {(tick: number) => boolean} present
     * @returns {Object}
     */
    function makeSessionDeps(sequenceEngine, present) {
      let tick = 0;
      return makeDeps({
        scanner: {
          scanProcesses: vi.fn().mockImplementation(async () => {
            tick++;
            return {
              agents: present(tick)
                ? [
                    {
                      agent: 'Claude Code',
                      process: 'claude.exe',
                      pid: 100,
                      startTime: 1717000000000,
                      instanceId: '100:1717000000000',
                      instanceIdSource: 'os',
                      category: 'ai',
                    },
                  ]
                : [],
              changed: false,
              reliable: true,
            };
          }),
        },
        sequenceEngine,
      });
    }

    it('tap 4: doProcessScan ingests the session record of an agent that entered', async () => {
      require_('../../src/main/session-tracker.js')._resetForTest();
      const sequenceEngine = makeEngine();
      const deps = makeSessionDeps(sequenceEngine, () => true);
      scanLoop.init(deps);
      scanLoop.startScanIntervals(5000);
      await vi.advanceTimersByTimeAsync(5000);

      const enter = deps.audit.log.mock.calls.find((c) => c[0] === 'agent-enter');
      expect(enter).toBeTruthy();
      expect(sequenceEngine.ingest).toHaveBeenCalledTimes(1);
      // What session-tracker returned, unchanged: `firstSeen` and NO `lastSeen`, which
      // is how the normalizer tells an enter from an exit.
      const [record] = sequenceEngine.ingest.mock.calls[0];
      expect(record).toEqual({
        pid: 100,
        instanceId: '100:1717000000000',
        agent: 'Claude Code',
        process: 'claude.exe',
        firstSeen: expect.any(Number),
      });
      expect(record).not.toHaveProperty('lastSeen');
      expect(record.firstSeen).toBe(enter[1].extra.startTime);
    });

    it('tap 4: doProcessScan ingests the session record of an agent that exited', async () => {
      const sessionTracker = require_('../../src/main/session-tracker.js');
      sessionTracker._resetForTest();
      const sequenceEngine = makeEngine();
      // Present on tick 1 only; the exit is reported after DEFAULT_EXIT_GRACE misses.
      const deps = makeSessionDeps(sequenceEngine, (tick) => tick === 1);
      scanLoop.init(deps);
      scanLoop.startScanIntervals(5000);
      for (let i = 0; i < 1 + sessionTracker.DEFAULT_EXIT_GRACE; i++) {
        await vi.advanceTimersByTimeAsync(5000);
      }

      const exit = deps.audit.log.mock.calls.find((c) => c[0] === 'agent-exit');
      expect(exit).toBeTruthy();
      // One enter, one exit — and the exit carrier carries `lastSeen`.
      expect(sequenceEngine.ingest).toHaveBeenCalledTimes(2);
      const [record] = sequenceEngine.ingest.mock.calls[1];
      expect(record).toEqual({
        pid: 100,
        instanceId: '100:1717000000000',
        agent: 'Claude Code',
        process: 'claude.exe',
        firstSeen: expect.any(Number),
        lastSeen: expect.any(Number),
      });
      expect(record.instanceId).toBe(exit[1].instanceId);
    });

    it('tap 5: sweep runs exactly once per process tick, after the scans', async () => {
      const sequenceEngine = makeEngine();
      const deps = makeDeps({ sequenceEngine });
      scanLoop.init(deps);
      scanLoop.startScanIntervals(5000);

      expect(sequenceEngine.sweep).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5000);
      expect(sequenceEngine.sweep).toHaveBeenCalledTimes(1);
      // The sweep follows the tick's session reconcile: the enter/exit taps have
      // already run when it fires.
      const sweepOrder = sequenceEngine.sweep.mock.invocationCallOrder[0];
      const scanOrder = deps.scanner.scanProcesses.mock.invocationCallOrder[0];
      expect(sweepOrder).toBeGreaterThan(scanOrder);
      await vi.advanceTimersByTimeAsync(5000);
      expect(sequenceEngine.sweep).toHaveBeenCalledTimes(2);
    });

    it('a scan without an injected engine still completes — the tap is a no-op', async () => {
      const deps = makeDeps({
        getLatestAgents: vi.fn().mockReturnValue([{ agent: 'Claude Code' }]),
        watcher: {
          pruneKnownHandles: vi.fn(),
          scanAllFileHandles: vi.fn().mockResolvedValue(twoEventsOnePath()),
        },
      });
      scanLoop.init(deps);
      scanLoop.staggeredStartup(5000, true);
      await vi.advanceTimersByTimeAsync(8000);

      expect(deps.logger.error).not.toHaveBeenCalled();
      expect(deps.audit.log.mock.calls.filter((c) => c[0] === 'file-access')).toHaveLength(1);
      expect(deps.sendToRenderer).toHaveBeenCalledWith('scan-batch', expect.any(Object));
    });
  });
});
