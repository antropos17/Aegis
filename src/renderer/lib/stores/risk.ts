import { derived } from 'svelte/store';
import { agents, events, anomaliesByInstance, network, falsePositives } from './ipc.js';
import { enrichAgents } from '../utils/enrich-agents';

/** Existing exposure model, shared with Observatory. */
export const enrichedAgents = derived(
  [agents, events, anomaliesByInstance, network, falsePositives],
  (values) => enrichAgents(...values),
);
