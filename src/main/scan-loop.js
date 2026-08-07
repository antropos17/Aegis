/**
 * @file scan-loop.js
 * @description Periodic scan intervals, staggered startup, and event dedup
 *   for process, file-handle, and network scanning. Extracted from main.js.
 * @since v0.3.0
 */
'use strict';

const sessionTracker = require('./session-tracker');
const ideExtensionDetector = require('./ide-extension-detector');
const wslDetector = require('./wsl-detector');
const resourceMonitor = require('./resource-monitor');
const tokenTracker = require('./token-tracker');
const { collectTokenCosts } = require('./token-cost-collector');
const blocklist = require('./blocklist');
const { EVIDENCE, makeAttribution } = require('./attribution');
const { identify } = require('./process-identity');

let scanInterval = null;
let fileScanInterval = null;
let netInterval = null;
let hotReadInterval = null;
/**
 * Fast hot read-detect cadence (win32 RM only): ~10s, vs the 30s full file scan.
 * Shrinks the read-blind window on the crown-jewel secret dirs (HOT_DIRS). 10s is
 * the safe `-TypeDefinition` cadence (no precompiled-DLL spawn optimization).
 * @type {number}
 */
const HOT_READ_INTERVAL_MS = 10000;
/** @type {Object} Injected dependencies */
let deps = {};
/** @type {{ollama: {running: boolean, models: string[]}, lmstudio: {running: boolean, models: string[]}}} */
let latestLocalModels = {
  ollama: { running: false, models: [] },
  lmstudio: { running: false, models: [] },
};
// Event dedup — same agent + same file within 30s → suppress, track count
const eventDedupMap = new Map();
let activeScanCount = 0;
let _lastTriggeredNetScan = 0;
// C-02: reentrancy guard — block overlapping doProcessScan runs so a slow scan
// can't be clobbered by the next interval tick (last-writer-wins on the snapshot).
let processScanRunning = false;

/** @param {boolean} entering — true when scan starts, false when ends @since v0.4.0 */
function updateScanStatus(entering) {
  activeScanCount += entering ? 1 : -1;
  if (deps.sendToRenderer) {
    deps.sendToRenderer('scan-status', { scanning: activeScanCount > 0 });
  }
}

/**
 * Dedup file events: same agent + same file within 30s → suppress.
 * @param {Object} ev @returns {Object|null} @since v0.3.0
 */
function dedupFileEvent(ev) {
  const key = `${ev.agent}|${ev.file}`;
  const now = Date.now();
  const prev = eventDedupMap.get(key);
  if (prev && now - prev.lastSent < 30000) {
    prev.count++;
    return null;
  }
  ev.repeatCount = prev ? prev.count : 1;
  eventDedupMap.set(key, { lastSent: now, count: 1 });
  if (eventDedupMap.size > 500) {
    for (const [k, v] of eventDedupMap) {
      if (now - v.lastSent > 60000) eventDedupMap.delete(k);
    }
  }
  if (eventDedupMap.size > 1000) eventDedupMap.clear();
  return ev;
}

/** @param {Object} ev @since v0.3.0 */
function logAuditForFile(ev) {
  const type =
    ev.reason && ev.reason.startsWith('AI agent config') ? 'config-access' : 'file-access';
  deps.audit.log(type, {
    agent: ev.agent,
    pid: ev.pid ?? null,
    // Carried from the event, never re-derived: null means the event itself has no
    // key (unattributed, or an owner that was never stamped).
    instanceId: ev.instanceId ?? null,
    action: ev.action,
    path: ev.file,
    severity: ev.sensitive ? 'sensitive' : 'normal',
    // The FULL {status, evidence[]} at top level. v0 put only the derived status string
    // in `details` and lost the evidence array, on the belief that a changed field set
    // would break the hash chain. It does not: verifyChain rebuilds each record's
    // preimage from that record's own fields, so v0 and v1 lines coexist in one file.
    attribution: ev.attribution ?? null,
  });
}

function stopScanIntervals() {
  for (const t of startupTimers) clearTimeout(t);
  startupTimers = [];
  if (warmupTimer) {
    clearTimeout(warmupTimer);
    warmupTimer = null;
  }
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
  if (fileScanInterval) {
    clearInterval(fileScanInterval);
    fileScanInterval = null;
  }
  if (netInterval) {
    clearInterval(netInterval);
    netInterval = null;
  }
  if (hotReadInterval) {
    clearInterval(hotReadInterval);
    hotReadInterval = null;
  }
}

function doNetworkScan() {
  const { network, baselines, audit, logger, getLatestAgents, sendToRenderer } = deps;
  const agents = getLatestAgents();
  if (network.isNetworkScanRunning() || agents.length === 0) return;
  network.setNetworkScanRunning(true);
  const t0 = performance.now();
  network
    .scanNetworkConnections(agents)
    .then((connections) => {
      deps.setLatestNetConnections(connections);
      for (const conn of connections) {
        if (conn.httpUnencrypted) {
          logger.warn(
            'network',
            'Unencrypted HTTP connection detected: ' + (conn.domain || conn.remoteIp),
          );
        }
        baselines.recordNetworkEndpoint(conn.agent, conn.remoteIp, conn.remotePort);
        audit.log('network-connection', {
          agent: conn.agent,
          pid: conn.pid ?? null,
          // Carried from the connection, never re-resolved from its pid: null means the
          // socket matched no agent in that scan.
          instanceId: conn.instanceId ?? null,
          action: conn.state,
          path: `${conn.remoteIp}:${conn.remotePort}`,
          severity: conn.flagged ? 'high' : 'normal',
          // The owner came from the OS connection table and was matched inside this same
          // call, so it is `confirmed` — the same strength as a handle-scan pid. An
          // unmatched connection keeps no agent and says so.
          attribution: makeAttribution([
            conn.agent ? EVIDENCE.OS_TCP_OWNER_PID : EVIDENCE.NO_OWNER_MATCH,
          ]),
          extra: { domain: conn.domain, flagged: conn.flagged },
        });
      }
      sendToRenderer('network-update', connections);
      logger.debug('scan', 'network', {
        ms: Math.round(performance.now() - t0),
        connections: connections.length,
      });
    })
    .catch((err) => {
      logger.error('main', 'Network scan failed', { error: err.message });
    })
    .finally(() => {
      network.setNetworkScanRunning(false);
    });
}

/**
 * Append synthetic agents that have no Windows process and so are invisible to
 * the process scanner: editor-extension agents (Kilo Code, Cline) and WSL-inner
 * agents (grok, opencode). Reads each detector's throttled cache synchronously —
 * the dir/WSL scans run in the background, never blocking this batch. Dedups by
 * agent name so a real process (if any) already in the list wins.
 *
 * These entries are appended AFTER `enrichWithParentChains` — the process
 * scanner's only `instanceId` stamp — so they are stamped here instead, which is
 * what makes "every agent in scan-batch carries an instanceId" true.
 *
 * The identity is derived from the DISPLAY name, with `process` deliberately
 * withheld from `identify()`. For these detectors `process` is not the agent: the
 * IDE detector emits the editor host exe (`code.exe` for BOTH Kilo Code and
 * Cline) and the WSL detector emits the interpreter (`node` for several agents),
 * so keying on it would collapse two distinct pid-0 agents onto one synthetic
 * key — the exact collision the synthetic space exists to prevent. The display
 * name IS the identity here, and it is what both detectors already dedup on.
 * @param {Array} agents @returns {void} @since v0.11.0-alpha
 */
function injectDetectedExternalAgents(agents) {
  const external = [
    ...ideExtensionDetector.getCachedExtensionAgents(),
    ...wslDetector.getCachedWslAgents(),
  ];
  for (const ext of external) {
    if (agents.some((a) => a.agent === ext.agent)) continue;
    const identity = identify({ pid: ext.pid, agent: ext.agent });
    ext.instanceId = identity.instanceId;
    ext.instanceIdSource = identity.instanceIdSource;
    agents.push(ext);
  }
}

async function doProcessScan() {
  const {
    scanner,
    procUtil,
    watcher,
    anomaly,
    audit,
    tray,
    logger,
    sendToRenderer,
    getStats,
    getResourceUsage,
    setAgents,
  } = deps;
  // Early-return BEFORE updateScanStatus(true): a blocked re-entrant call must not
  // bump activeScanCount, whose only decrement lives in the finally below.
  if (processScanRunning) return;
  processScanRunning = true;
  updateScanStatus(true);
  const t0 = performance.now();
  try {
    const result = await scanner.scanProcesses();
    setAgents(result.agents);
    const agents = result.agents;
    // Process IDENTITY first. This attaches the OS birth time and the derived
    // `instanceId`, which the session key is built from — so it MUST precede
    // reconcile, or every session would key on a degraded `"<pid>:u"` and a
    // recycled pid running the same executable would silently continue the dead
    // process's session. `forceRefresh` on a changed pid set keeps a pid that is
    // new to the scan from being identified out of a stale cache entry. No new
    // spawn: on win32 this is the same `cim-parent` fetch the tick already pays.
    await procUtil.enrichWithParentChains(agents, { forceRefresh: result.changed === true });
    // Eager-enter / lazy-exit session reconciliation: an agent seen in even ONE
    // scan logs session-start immediately, and a flickering or permission-denied
    // scan never spawns a duplicate session. See session-tracker.js.
    const { entered, exited } = sessionTracker.reconcile(agents, {
      reliable: result.reliable !== false,
    });
    for (const s of entered)
      audit.log('agent-enter', {
        agent: s.agent,
        // pid and instanceId are TOP-LEVEL in v1. They were in `extra` on the belief that
        // a changed field set would break the chain; it does not — each record's hash
        // covers only its own fields, so v0 files stay verifiable regardless.
        pid: s.pid,
        instanceId: s.instanceId,
        action: 'started',
        path: '',
        severity: 'normal',
        // No attribution: this event IS the scanner's own observation that a session
        // began. There is no owner to resolve — the agent is the event's subject, not an
        // inferred owner — so `null` means "question does not apply", NOT "owner unknown".
        attribution: null,
        extra: { startTime: s.firstSeen },
      });
    for (const s of exited)
      audit.log('agent-exit', {
        agent: s.agent,
        pid: s.pid,
        instanceId: s.instanceId,
        action: 'exited',
        path: '',
        severity: 'normal',
        // Same reasoning as agent-enter: the session tracker's own conclusion, no owner
        // resolution step to describe.
        attribution: null,
      });
    watcher.pruneKnownHandles(agents);
    procUtil.annotateHostApps(agents);
    // Same `forceRefresh` contract as the identity stamp at the top of this scan:
    // a pid new to the set must not be annotated out of a cached entry belonging
    // to the dead process that held that pid. `cwd` is the field the renderer's
    // instance key is built from and the one CWD_CONTAINMENT attribution matches
    // on, so a stale value there poisons both.
    await procUtil.annotateWorkingDirs(agents, { forceRefresh: result.changed === true });
    // Surface extension-only (Kilo/Cline) and WSL-inner (grok/opencode) agents
    // before the batch so the renderer sees them; cache-backed, non-blocking.
    injectDetectedExternalAgents(agents);
    tray.updateTrayIcon();
    const deviations = anomaly.checkDeviations();
    if (deviations.length > 0) {
      for (const d of deviations)
        audit.log('anomaly-alert', {
          agent: d.agent,
          // A deviation is computed from a named behavioural baseline, not from a live
          // process, so there is no pid or instanceId to record. Joining the name back to
          // a process to fill these in would fabricate an identity the detector never
          // observed.
          pid: null,
          instanceId: null,
          action: d.type,
          path: '',
          severity: 'high',
          // `d.agent` is an INPUT to the deviation check, not the output of an attribution
          // step. Stamping a status here would label a tautology.
          attribution: null,
          extra: { message: d.message, anomalyScore: d.anomalyScore },
        });
    }
    const scores = {};
    for (const a of agents) scores[a.agent] = anomaly.calculateAnomalyScore(a.agent).score;

    // Alert-only watchlist flag (synchronous): set agent.flagged so it rides the
    // scan-batch below. Advisory only — never stops or restricts any process (C-01:
    // isFlagged matches the scanned agent's OWN signature + pid).
    for (const a of agents) a.flagged = blocklist.isFlagged(a);

    // Single batched IPC — renderer updates all stores at once
    sendToRenderer('scan-batch', {
      agents,
      stats: getStats(),
      resourceUsage: getResourceUsage(),
      anomalyScores: scores,
    });

    // Token costs ride a separate channel. Pull any new measured per-PID token
    // deltas from the feed and fold them into the tracker, then emit the full
    // accumulated set. Runs inside this C-02-guarded scan (released only in the
    // finally below) and never throws. A tick with no self-logging agent yields
    // an honest empty array — the tracker never fabricates counts.
    await collectTokenCosts(agents);
    sendToRenderer('token-costs', tokenTracker.getAllCosts());

    // Per-PID CPU/RAM/GPU is fetched fire-and-forget AFTER the batch so its
    // spawn (~0.4–8s, 5s-cached) never delays getting agents on screen. The
    // result is pushed on its own `resource-usage` channel, keyed by pid (C-01).
    const resourcePids = agents.map((a) => a.pid).filter((p) => Number.isInteger(p) && p > 0);
    resourceMonitor
      .getResourcesForPids(resourcePids)
      .then((resourceMap) => sendToRenderer('resource-usage', [...resourceMap.values()]))
      .catch((err) => logger.error('main', 'Resource usage scan failed', { error: err.message }));

    if (result.changed && Date.now() - _lastTriggeredNetScan > 15000) {
      _lastTriggeredNetScan = Date.now();
      doNetworkScan();
    }
    await enrichWithLocalModels(agents);
    logger.debug('scan', 'process', {
      ms: Math.round(performance.now() - t0),
      agents: agents.length,
    });
  } catch (err) {
    logger.error('main', 'Process scan failed', { error: err.message });
  } finally {
    updateScanStatus(false);
    processScanRunning = false;
  }
}

/**
 * Probe Ollama/LM Studio APIs and enrich matching agents with localModels.
 * If runtime is responding but no matching agent in list, inject a synthetic agent.
 * @param {Array} agents @since v0.4.0
 */
async function enrichWithLocalModels(agents) {
  const { detectOllamaModels, detectLMStudioModels } = require('./llm-runtime-detector');
  const [ollama, lmstudio] = await Promise.all([detectOllamaModels(), detectLMStudioModels()]);
  latestLocalModels = { ollama, lmstudio };
  attachModels(agents, 'Ollama', ollama);
  attachModels(agents, 'LM Studio', lmstudio);
}

/** @param {Array} agents @param {string} name @param {{running:boolean,models:string[]}} info */
function attachModels(agents, name, info) {
  if (!info.running) return;
  const existing = agents.find((a) => a.agent === name);
  if (existing) {
    existing.localModels = info.models;
  } else {
    agents.push({
      agent: name,
      process: name.toLowerCase().replace(/\s/g, '-'),
      pid: 0,
      status: 'running',
      category: 'local-llm-runtime',
      localModels: info.models,
    });
  }
}

async function doFileScan() {
  const { watcher, tray, logger, getStats, getLatestAgents } = deps;
  const agents = getLatestAgents();
  if (agents.length === 0) return;
  const t0 = performance.now();
  updateScanStatus(true);
  try {
    const rawEvents = await watcher.scanAllFileHandles(agents);
    const events = rawEvents.map(dedupFileEvent).filter(Boolean);
    if (events.length > 0) {
      for (const ev of events) deps.fileAccessBatcher.push(ev);
      tray.notifySensitive(events.filter((e) => e.sensitive && e.category === 'ai'));
      for (const ev of events) logAuditForFile(ev);
    }
    deps.statsUpdateBatcher.push(getStats());
    tray.updateTrayIcon();
  } catch (err) {
    logger.error('main', 'File handle scan failed', { error: err.message });
  } finally {
    updateScanStatus(false);
    logger.debug('scan', 'file', { ms: Math.round(performance.now() - t0) });
  }
}

/**
 * Fast hot read-detect cycle (win32 RM only, ~10s): a faster RM poll over the
 * crown-jewel secret dirs (HOT_DIRS + ~/.env*) that shrinks the 30s read-blind
 * window. Events ride the SAME dedup→batch→audit→tray pipeline as doFileScan and
 * share knownHandles, so a hold caught here will not re-fire from the 30s scan.
 * Deliberately does NOT toggle updateScanStatus — a 10s background poll must not
 * flicker the global "scanning" indicator (process/file scans drive that). RM
 * catches a HOLD at the tick, never a transient open→read→close.
 * @since v0.11.0-alpha
 */
async function doHotReadScan() {
  const { watcher, tray, logger, getStats, getLatestAgents } = deps;
  const agents = getLatestAgents();
  if (agents.length === 0) return;
  const t0 = performance.now();
  try {
    const rawEvents = await watcher.scanHotFileHolders(agents);
    const events = rawEvents.map(dedupFileEvent).filter(Boolean);
    if (events.length > 0) {
      for (const ev of events) deps.fileAccessBatcher.push(ev);
      tray.notifySensitive(events.filter((e) => e.sensitive && e.category === 'ai'));
      for (const ev of events) logAuditForFile(ev);
      deps.statsUpdateBatcher.push(getStats());
      tray.updateTrayIcon();
    }
  } catch (err) {
    logger.error('main', 'Hot read scan failed', { error: err.message });
  } finally {
    logger.debug('scan', 'hot-read', { ms: Math.round(performance.now() - t0) });
  }
}

/** @param {number} intervalMs @since v0.3.0 */
function startScanIntervals(intervalMs) {
  const ms = intervalMs || 10000;
  scanInterval = setInterval(doProcessScan, ms);
  netInterval = setInterval(doNetworkScan, 30000);
  fileScanInterval = setInterval(doFileScan, Math.max(ms * 3, 30000));
  // Hot read-detect cycle: win32 + RM only. Not created on darwin/linux (no RM)
  // so we never run a pointless no-op timer. Started here (post-warmup) only —
  // never during startWarmup — to keep the heavy boot window quiet.
  if (deps.watcher && deps.watcher.isHotReadScanActive && deps.watcher.isHotReadScanActive()) {
    hotReadInterval = setInterval(doHotReadScan, HOT_READ_INTERVAL_MS);
  }
}

let warmupTimer = null;
/** @type {Array<ReturnType<typeof setTimeout>>} */
let startupTimers = [];

/** @param {number} targetMs @since v0.4.0 */
function startWarmup(targetMs) {
  const warmupMs = targetMs * 3;
  scanInterval = setInterval(doProcessScan, warmupMs);
  netInterval = setInterval(doNetworkScan, 60000);
  fileScanInterval = setInterval(doFileScan, 60000);
  warmupTimer = setTimeout(() => {
    clearInterval(scanInterval);
    clearInterval(netInterval);
    clearInterval(fileScanInterval);
    scanInterval = null;
    netInterval = null;
    fileScanInterval = null;
    startScanIntervals(targetMs);
  }, 60000);
}

/** @param {number} intervalMs @param {boolean} paused @since v0.3.0 */
function staggeredStartup(intervalMs, paused) {
  startupTimers.push(setTimeout(() => doProcessScan(), 3000));
  startupTimers.push(setTimeout(() => doFileScan(), 8000));
  startupTimers.push(
    setTimeout(() => {
      doNetworkScan();
      if (!paused) startWarmup(intervalMs);
    }, 12000),
  );
}

/** @param {Object} injected @since v0.3.0 */
function init(injected) {
  deps = injected;
}

/** @returns {{ollama: {running:boolean,models:string[]}, lmstudio: {running:boolean,models:string[]}}} */
function getLatestLocalModels() {
  return latestLocalModels;
}

module.exports = {
  init,
  startScanIntervals,
  stopScanIntervals,
  doNetworkScan,
  staggeredStartup,
  dedupFileEvent,
  logAuditForFile,
  getLatestLocalModels,
};
