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
const blocklist = require('./blocklist');

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
    action: ev.action,
    path: ev.file,
    severity: ev.sensitive ? 'sensitive' : 'normal',
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
          action: conn.state,
          path: `${conn.remoteIp}:${conn.remotePort}`,
          severity: conn.flagged ? 'high' : 'normal',
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
 * @param {Array} agents @returns {void} @since v0.11.0-alpha
 */
function injectDetectedExternalAgents(agents) {
  const external = [
    ...ideExtensionDetector.getCachedExtensionAgents(),
    ...wslDetector.getCachedWslAgents(),
  ];
  for (const ext of external) {
    if (!agents.some((a) => a.agent === ext.agent)) agents.push(ext);
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
    // Eager-enter / lazy-exit session reconciliation: an agent seen in even ONE
    // scan logs session-start immediately, and a flickering or permission-denied
    // scan never spawns a duplicate session. See session-tracker.js.
    const { entered, exited } = sessionTracker.reconcile(agents, {
      reliable: result.reliable !== false,
    });
    for (const s of entered)
      audit.log('agent-enter', {
        agent: s.agent,
        action: 'started',
        path: '',
        severity: 'normal',
        extra: { pid: s.pid, startTime: s.firstSeen },
      });
    for (const s of exited)
      audit.log('agent-exit', {
        agent: s.agent,
        action: 'exited',
        path: '',
        severity: 'normal',
        extra: { pid: s.pid },
      });
    watcher.pruneKnownHandles(agents);
    await procUtil.enrichWithParentChains(agents);
    procUtil.annotateHostApps(agents);
    await procUtil.annotateWorkingDirs(agents);
    // Surface extension-only (Kilo/Cline) and WSL-inner (grok/opencode) agents
    // before the batch so the renderer sees them; cache-backed, non-blocking.
    injectDetectedExternalAgents(agents);
    tray.updateTrayIcon();
    const deviations = anomaly.checkDeviations();
    if (deviations.length > 0) {
      for (const d of deviations)
        audit.log('anomaly-alert', {
          agent: d.agent,
          action: d.type,
          path: '',
          severity: 'high',
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

    // Token costs ride a separate channel. With no usage feed wired this is an
    // empty array (honest zero) — the tracker never fabricates counts.
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
