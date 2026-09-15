'use strict';
const Module = require('node:module');
const path = require('node:path');
const cp = require('node:child_process');

const STAGES = {
  'process-scanner': ['scanProcesses'],
  'process-utils': ['enrichWithParentChains', 'annotateWorkingDirs', 'annotateHostApps'],
  'network-monitor': ['scanNetworkConnections'],
  'file-watcher': ['setupFileWatchers', 'scanAllFileHandles', 'scanHotFileHolders'],
  'resource-monitor': ['getResourcesForPids'],
  'token-cost-collector': ['collectTokenCosts'],
  'anomaly-detector': ['checkDeviations', 'calculateAnomalyScore'],
  'llm-runtime-detector': ['detectOllamaModels', 'detectLMStudioModels'],
  'ide-extension-detector': ['detectExtensionAgents'],
  'wsl-detector': ['detectWslAgents'],
  'platform/win32': ['getParentProcessMap', 'getProcessCwds', 'getRawTcpConnections'],
};

/** Observe production calls without changing their arguments or return values.
 * @param {string} root - Absolute repository root.
 * @param {Object} metrics - Numeric timing recorder.
 * @param {Object} state - Bounded tick and fixed-label launch counters.
 * @param {() => number} now - Elapsed milliseconds from launch.
 * @returns {void}
 * @since 0.15.0
 */
function install(root, metrics, state, now) {
  const targets = new Map(
    Object.entries(STAGES).map(([name, names]) => [
      path.join(root, 'src', 'main', `${name}.js`),
      names,
    ]),
  );
  const seenModules = new WeakSet(),
    seenChildren = new WeakSet();
  const load = Module._load;
  Module._load = function (request, parent, isMain) {
    const result = load.call(this, request, parent, isMain);
    if (!result || typeof result !== 'object' || seenModules.has(result)) return result;
    const resolved = Module._resolveFilename(request, parent);
    const names = targets.get(resolved);
    if (names) {
      seenModules.add(result);
      for (const name of names) result[name] = metrics.wrap(name, result[name]);
    }
    if (resolved === path.join(root, 'src/main/logger.js')) {
      seenModules.add(result);
      const debug = result.debug;
      result.debug = function (mod, message, meta) {
        if (mod === 'scan' && ['process', 'network', 'file', 'hot-read'].includes(message)) {
          if (state.ticks.length < 512)
            state.ticks.push({
              atMs: now(),
              kind: message,
              durationMs: Number.isFinite(meta?.ms) ? meta.ms : null,
              agents: Number.isFinite(meta?.agents) ? meta.agents : null,
            });
        }
        if (mod === 'perf' && message === 'snapshot' && typeof meta?.source === 'string') {
          // Values are a fixed provider enum; no process metadata is copied.
          const source = ['basic', 'class5', 'cim', 'none'].includes(meta.source)
            ? meta.source
            : 'other';
          state.snapshotSources[source] = (state.snapshotSources[source] || 0) + 1;
        }
        return debug.apply(this, arguments);
      };
    }
    return result;
  };
  // execFile's internal spawn is not the public spawn export. Dedup by child
  // object as well, so nested public calls cannot count a launch twice.
  for (const method of ['execFile', 'spawn']) {
    const original = cp[method];
    cp[method] = function (command, ...args) {
      const started = now();
      const base = path
        .basename(String(command))
        .toLowerCase()
        .replace(/\.exe$/, '');
      const category = [
        'powershell',
        'pwsh',
        'wsl',
        'tasklist',
        'nvidia-smi',
        'aegis-procsnap',
        'handle64',
        'handle',
        'where',
      ].includes(base)
        ? base
        : 'other';
      let child;
      const label = `child:${category}:${metrics.current()}`;
      try {
        child = original.call(this, command, ...args);
      } catch (error) {
        metrics.record(label, started, true);
        throw error;
      }
      if (!seenChildren.has(child)) {
        seenChildren.add(child);
        const phase = started < 90000 ? 'startup' : 'steady';
        const key = `${phase}:${label}`;
        state.launches[key] = (state.launches[key] || 0) + 1;
        let settled = false;
        const finish = (failed) => {
          if (settled) return;
          settled = true;
          metrics.record(label, started, failed);
        };
        child.once('error', () => finish(true));
        child.once('close', (code) => finish(code !== 0));
      }
      return child;
    };
  }
}
module.exports = { install };
