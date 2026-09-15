'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { app } = require('electron');
const { createMetrics } = require('./metrics.cjs');
const { install } = require('./hooks.cjs');
const root = path.resolve(__dirname, '../..');
const output = process.env.AEGIS_CYCLE_OUTPUT;
const limits = require('./limits.cjs').limits(process.env.AEGIS_CYCLE_SECONDS);
if (!output || !path.isAbsolute(output) || fs.existsSync(path.join(output, 'profile'))) {
  throw new Error('A new absolute AEGIS_CYCLE_OUTPUT directory is required');
}
const relative = path.relative(root, output);
if (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  throw new Error('Output must be outside the repository');
const profile = path.join(output, 'profile');
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(
  path.join(profile, 'settings.json'),
  JSON.stringify({
    startMinimized: true,
    notificationsEnabled: false,
    automaticUpdatesEnabled: false,
  }),
);
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.setAppPath(root);
const origin = performance.now(),
  now = () => performance.now() - origin;
const metrics = createMetrics(now);
const state = { ticks: [], launches: {}, snapshotSources: {} };
install(root, metrics, state, now);
const lag = monitorEventLoopDelay({ resolution: 20 });
lag.enable();
const resources = [];
let previousCpu = process.cpuUsage(),
  previousTime = now();
let previousChildren = new Map();
function sample() {
  const atMs = now(),
    elapsed = atMs - previousTime;
  const cpu = process.cpuUsage(),
    memory = process.memoryUsage();
  const rows = app.isReady() ? app.getAppMetrics() : [];
  let electronCpuMs = 0,
    electronCpuAvailable = rows.length > 0,
    workingSetKiB = 0;
  const children = new Map();
  for (const row of rows) {
    const key = `${row.pid}:${row.creationTime}`,
      total = row.cpu.cumulativeCPUUsage;
    if (!Number.isFinite(total)) electronCpuAvailable = false;
    else {
      const previous = previousChildren.get(key);
      if (previous !== undefined) electronCpuMs += Math.max(0, total - previous) * 1000;
      children.set(key, total);
    }
    workingSetKiB += row.memory.workingSetSize;
  }
  resources.push({
    atMs,
    intervalMs: elapsed,
    mainCpuMs: (cpu.user + cpu.system - previousCpu.user - previousCpu.system) / 1000,
    mainRssMiB: memory.rss / 1048576,
    mainHeapMiB: memory.heapUsed / 1048576,
    electronCpuMs: electronCpuAvailable && previousChildren.size ? electronCpuMs : null,
    electronWorkingSetMiB: workingSetKiB / 1024,
    electronProcesses: rows.length,
    loopP99Ms: Number.isFinite(lag.percentile(99)) ? lag.percentile(99) / 1e6 : null,
    loopMaxMs: Number.isFinite(lag.max) ? lag.max / 1e6 : null,
    queues: queueSample(),
  });
  previousCpu = cpu;
  previousTime = atMs;
  previousChildren = children;
  lag.reset();
}
function write(complete) {
  fs.writeFileSync(
    path.join(output, 'report.json'),
    JSON.stringify(
      {
        schema: 1,
        kind: 'live-cycle-profile',
        complete,
        elapsedMs: now(),
        versions: { node: process.versions.node, electron: process.versions.electron },
        warmupMs: 90000,
        configuredDurationMs: limits.durationMs,
        settings: { minimized: true, scanIntervalSec: 10, etw: false },
        stages: metrics.snapshot(),
        ...state,
        resources,
      },
      null,
      2,
    ),
  );
}
// Only numeric counters are retained; never copy identities, events or paths.
function queueSample() {
  const main = require.cache[path.join(root, 'src/main/main.js')]?.exports;
  const audit = require.cache[path.join(root, 'src/main/audit-logger.js')]?.exports;
  const stats = main?.getStats?.(),
    a = audit?.getStats?.();
  const ipc = stats?.ipc?.fileAccess;
  return {
    activityEntries: stats?.totalFiles ?? null,
    ipcBuffered: ipc?.buffered ?? null,
    ipcHighWater: ipc?.highWater ?? null,
    ipcEvicted: ipc?.retainedEvicted ?? null,
    sequenceOpen: stats?.sequences?.openNow ?? null,
    sequencePeak: stats?.sequences?.peakOpen ?? null,
    auditBuffered: a?.bufferDepth ?? null,
    auditDropped: a?.droppedEntries ?? null,
    auditBytes: a?.totalSize ?? null,
  };
}
const timer = setInterval(sample, limits.sampleMs);
const checkpoint = setInterval(() => write(false), 30000);
const deadline = setTimeout(() => {
  clearInterval(timer);
  clearInterval(checkpoint);
  sample();
  lag.disable();
  write(true);
  app.quit();
}, limits.durationMs);
app.on('will-quit', () => {
  clearInterval(timer);
  clearInterval(checkpoint);
  clearTimeout(deadline);
  lag.disable();
});
require(path.join(root, 'src/main/main.js'));
