import { writable } from 'svelte/store';
import { startDemoMode } from './demo-data.js';

export const agents = writable([]);
export const events = writable([]);
export const stats = writable({});
export const network = writable([]);
export const anomalies = writable({});
export const resourceUsage = writable({});
/** @type {import('svelte/store').Writable<Array<{agentName: string, pattern: string, timestamp: number}>>} */
export const falsePositives = writable([]);
/** @type {import('svelte/store').Writable<boolean>} */
export const scanActive = writable(false);

/** PID of agent to highlight in AgentPanel (set by Timeline dot click) */
export const focusedAgentPid = writable(null);

/** True when running in a browser without Electron IPC. */
export const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true' || !window.aegis;

if (!isDemoMode) {
  // Primary path: coalesce all store updates into a single microtask
  // so Svelte batches DOM repaints instead of 4 separate cascades.
  window.aegis.onScanBatch((data) => {
    queueMicrotask(() => {
      if (data.agents) agents.set(data.agents);
      if (data.stats) stats.set(data.stats);
      if (data.resourceUsage) resourceUsage.set(data.resourceUsage);
      if (data.anomalyScores) anomalies.set(data.anomalyScores);
    });
  });

  // Individual channels for non-batch sources (file watcher, network monitor)
  window.aegis.onFileAccess((data) => {
    const batch = Array.isArray(data) ? data : [data];
    events.update((arr) => [...arr.slice(-499), ...batch]);
  });
  window.aegis.onStatsUpdate((data) => stats.set(data));
  window.aegis.onNetworkUpdate((data) => {
    const arr = Array.isArray(data) ? data : [];
    network.set(arr.length > 500 ? arr.slice(-500) : arr);
  });
  window.aegis.onScanStatus((data) => scanActive.set(data?.scanning ?? false));

  // Fetch initial data
  window.aegis.getStats().then((data) => stats.set(data));
  window.aegis.getResourceUsage().then((data) => resourceUsage.set(data));
  window.aegis.getFalsePositives().then((data) => falsePositives.set(data || []));
} else {
  const cleanupDemo = startDemoMode({ agents, events, stats, network, anomalies, resourceUsage });
  if (import.meta.hot) {
    import.meta.hot.dispose(() => cleanupDemo());
  }
}
