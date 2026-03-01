/**
 * @file scan-loop.js
 * @description Periodic scan intervals, staggered startup, and event dedup
 *   for process, file-handle, and network scanning. Extracted from main.js.
 * @since v0.3.0
 */
'use strict';

const { detectOllamaModels, detectLMStudioModels } = require('./llm-runtime-detector');

let scanInterval = null;
let fileScanInterval = null;
let netInterval = null;
/** @type {Object} Injected dependencies */
let deps = {};
/** @type {{ollama: {running: boolean, models: string[]}, lmstudio: {running: boolean, models: string[]}}} */
let latestLocalModels = {
  ollama: { running: false, models: [] },
  lmstudio: { running: false, models: [] },
};
// Event dedup — same agent + same file within 30s → suppress, track count
const eventDedupMap = new Map();

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
}

function doNetworkScan() {
  const { network, baselines, audit, logger, getLatestAgents, sendToRenderer } = deps;
  const agents = getLatestAgents();
  if (network.isNetworkScanRunning() || agents.length === 0) return;
  network.setNetworkScanRunning(true);
  network
    .scanNetworkConnections(agents)
    .then((connections) => {
      deps.setLatestNetConnections(connections);
      for (const conn of connections) {
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
    })
    .catch((err) => logger.error('main', 'Network scan failed', { error: err.message }))
    .finally(() => network.setNetworkScanRunning(false));
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
    getPreviousPids,
    setPreviousPids,
  } = deps;
  try {
    const result = await scanner.scanProcesses();
    setAgents(result.agents);
    const agents = result.agents;
    const curPids = new Map();
    for (const a of agents) curPids.set(a.pid, a.agent);
    const prevPids = getPreviousPids();
    for (const [pid, name] of curPids) {
      if (!prevPids.has(pid))
        audit.log('agent-enter', {
          agent: name,
          action: 'started',
          path: '',
          severity: 'normal',
          extra: { pid },
        });
    }
    for (const [pid, name] of prevPids) {
      if (!curPids.has(pid))
        audit.log('agent-exit', {
          agent: name,
          action: 'exited',
          path: '',
          severity: 'normal',
          extra: { pid },
        });
    }
    setPreviousPids(curPids);
    watcher.pruneKnownHandles(agents);
    await procUtil.enrichWithParentChains(agents);
    procUtil.annotateHostApps(agents);
    await procUtil.annotateWorkingDirs(agents);
    sendToRenderer('scan-results', agents);
    sendToRenderer('stats-update', getStats());
    sendToRenderer('resource-usage', getResourceUsage());
    tray.updateTrayIcon();
    const deviations = anomaly.checkDeviations();
    if (deviations.length > 0) {
      sendToRenderer('baseline-warnings', deviations);
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
    sendToRenderer('anomaly-scores', scores);
    if (result.changed) doNetworkScan();
    await enrichWithLocalModels(agents);
  } catch (err) {
    logger.error('main', 'Process scan failed', { error: err.message });
  }
}

/**
 * Probe Ollama/LM Studio APIs and enrich matching agents with localModels.
 * If runtime is responding but no matching agent in list, inject a synthetic agent.
 * @param {Array} agents @since v0.4.0
 */
async function enrichWithLocalModels(agents) {
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
  const { watcher, tray, logger, sendToRenderer, getStats, getLatestAgents } = deps;
  const agents = getLatestAgents();
  if (agents.length === 0) return;
  try {
    const rawEvents = await watcher.scanAllFileHandles(agents);
    const events = rawEvents.map(dedupFileEvent).filter(Boolean);
    if (events.length > 0) {
      sendToRenderer('file-access', events);
      tray.notifySensitive(events.filter((e) => e.sensitive && e.category === 'ai'));
      for (const ev of events) logAuditForFile(ev);
    }
    sendToRenderer('stats-update', getStats());
    tray.updateTrayIcon();
  } catch (err) {
    logger.error('main', 'File handle scan failed', { error: err.message });
  }
}

/** @param {number} intervalMs @since v0.3.0 */
function startScanIntervals(intervalMs) {
  const ms = intervalMs || 10000;
  scanInterval = setInterval(doProcessScan, ms);
  netInterval = setInterval(doNetworkScan, 30000);
  fileScanInterval = setInterval(doFileScan, Math.max(ms * 3, 30000));
}

/** @param {number} intervalMs @param {boolean} paused @since v0.3.0 */
function staggeredStartup(intervalMs, paused) {
  setTimeout(() => doProcessScan(), 3000);
  setTimeout(() => doFileScan(), 5000);
  setTimeout(() => {
    doNetworkScan();
    if (!paused) startScanIntervals(intervalMs);
  }, 8000);
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
