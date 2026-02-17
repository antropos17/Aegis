import { writable } from 'svelte/store';

export const agents = writable([]);
export const events = writable([]);
export const stats = writable({});
export const network = writable([]);
export const anomalies = writable({});

if (window.aegis) {
  window.aegis.onScanResults((data) => agents.set(data || []));
  window.aegis.onFileAccess((data) => events.update(arr => [...arr.slice(-499), data]));
  window.aegis.onStatsUpdate((data) => stats.set(data));
  window.aegis.onNetworkUpdate((data) => network.set(data));
  window.aegis.onAnomalyScores((data) => anomalies.set(data));
}
