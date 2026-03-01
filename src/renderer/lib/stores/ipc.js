import { writable } from 'svelte/store';
import { startDemoMode } from './demo-data.js';

export const agents = writable([]);
export const events = writable([]);
export const stats = writable({});
export const network = writable([]);
export const anomalies = writable({});
export const resourceUsage = writable({});

/** PID of agent to highlight in AgentPanel (set by Timeline dot click) */
export const focusedAgentPid = writable(null);

/** True when running in a browser without Electron IPC. */
export const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true' || !window.aegis;

if (!isDemoMode) {
  window.aegis.onScanResults((data) => agents.set(data || []));
  window.aegis.onFileAccess((data) => {
    const batch = Array.isArray(data) ? data : [data];
    events.update((arr) => [...arr.slice(-499), ...batch]);
  });
  window.aegis.onStatsUpdate((data) => stats.set(data));
  window.aegis.onNetworkUpdate((data) => {
    const arr = Array.isArray(data) ? data : [];
    network.set(arr.length > 500 ? arr.slice(-500) : arr);
  });
  window.aegis.onAnomalyScores((data) => anomalies.set(data));
  window.aegis.onResourceUsage((data) => resourceUsage.set(data));

  // Fetch initial data
  window.aegis.getStats().then((data) => stats.set(data));
  window.aegis.getResourceUsage().then((data) => resourceUsage.set(data));
} else {
  const cleanupDemo = startDemoMode({ agents, events, stats, network, anomalies, resourceUsage });
  if (import.meta.hot) {
    import.meta.hot.dispose(() => cleanupDemo());
  }
}
