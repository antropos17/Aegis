/**
 * @file agent-graph-utils.ts
 * @description Data transformations for D3 force-directed agent graph.
 * @since v0.4.0
 */

import type {
  EnrichedAgent,
  FileEvent,
  NetworkConnection,
  TrustGrade,
} from '../../../shared/types';

/** Node in the agent graph */
export interface GraphNode {
  readonly id: string;
  readonly label: string;
  readonly riskScore: number;
  readonly trustGrade: TrustGrade;
  readonly category: string;
  readonly radius: number;
  readonly color: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  vx?: number;
  vy?: number;
}

/** Link between two agents sharing a resource */
export interface GraphLink {
  readonly source: string;
  readonly target: string;
  readonly type: 'file' | 'network';
  readonly resource: string;
  readonly weight: number;
}

/** Trust grade → color mapping using CSS custom properties */
const GRADE_COLORS: Record<TrustGrade, string> = {
  'A+': '#4a7a5a',
  A: '#5a8a6a',
  'B+': '#7a8a9e',
  B: '#9aafcc',
  C: '#c8a84e',
  D: '#c8907a',
  F: '#c87a7a',
};

/**
 * Calculate node radius from risk score (5–25 range)
 * @param riskScore - Agent risk score 0–100
 */
function riskToRadius(riskScore: number): number {
  return Math.max(5, Math.min(25, 5 + (riskScore / 100) * 20));
}

/**
 * Build graph nodes from enriched agents
 * @param agents - Enriched agent list from IPC
 */
export function buildGraphNodes(agents: EnrichedAgent[]): GraphNode[] {
  const seen = new Set<string>();
  const nodes: GraphNode[] = [];
  for (const a of agents) {
    const key = a.agent;
    if (seen.has(key)) continue;
    seen.add(key);
    nodes.push({
      id: key,
      label: a.name || a.agent,
      riskScore: a.riskScore,
      trustGrade: a.trustGrade,
      category: a.category,
      radius: riskToRadius(a.riskScore),
      color: GRADE_COLORS[a.trustGrade] || GRADE_COLORS['C'],
    });
  }
  return nodes;
}

/**
 * Build graph links from shared file access
 * @param events - File events grouped by agent
 * @param nodeIds - Set of valid node IDs
 */
export function buildFileLinks(events: FileEvent[], nodeIds: Set<string>): GraphLink[] {
  const fileAgents = new Map<string, Set<string>>();
  for (const ev of events) {
    if (!nodeIds.has(ev.agent)) continue;
    const agents = fileAgents.get(ev.file) || new Set();
    agents.add(ev.agent);
    fileAgents.set(ev.file, agents);
  }

  const linkMap = new Map<string, GraphLink>();
  for (const [file, agents] of fileAgents) {
    if (agents.size < 2) continue;
    const arr = [...agents].sort();
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const key = `file:${arr[i]}:${arr[j]}`;
        const existing = linkMap.get(key);
        if (existing) {
          linkMap.set(key, { ...existing, weight: existing.weight + 1 });
        } else {
          linkMap.set(key, {
            source: arr[i],
            target: arr[j],
            type: 'file',
            resource: file,
            weight: 1,
          });
        }
      }
    }
  }
  return [...linkMap.values()];
}

/**
 * Build graph links from shared network endpoints
 * @param conns - Network connections
 * @param nodeIds - Set of valid node IDs
 */
export function buildNetworkLinks(conns: NetworkConnection[], nodeIds: Set<string>): GraphLink[] {
  const endpointAgents = new Map<string, Set<string>>();
  for (const c of conns) {
    if (!c.agent || !nodeIds.has(c.agent)) continue;
    const endpoint = c.domain || c.remoteIp;
    const agents = endpointAgents.get(endpoint) || new Set();
    agents.add(c.agent);
    endpointAgents.set(endpoint, agents);
  }

  const linkMap = new Map<string, GraphLink>();
  for (const [endpoint, agents] of endpointAgents) {
    if (agents.size < 2) continue;
    const arr = [...agents].sort();
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const key = `net:${arr[i]}:${arr[j]}`;
        const existing = linkMap.get(key);
        if (existing) {
          linkMap.set(key, { ...existing, weight: existing.weight + 1 });
        } else {
          linkMap.set(key, {
            source: arr[i],
            target: arr[j],
            type: 'network',
            resource: endpoint,
            weight: 1,
          });
        }
      }
    }
  }
  return [...linkMap.values()];
}

/**
 * Build complete graph data from agents, events, and connections
 * @param agents - Enriched agents
 * @param fileEvents - File access events
 * @param networkConns - Network connections
 */
export function buildGraphData(
  agents: EnrichedAgent[],
  fileEvents: FileEvent[],
  networkConns: NetworkConnection[],
): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes = buildGraphNodes(agents);
  const nodeIds = new Set(nodes.map((n) => n.id));
  const fileLinks = buildFileLinks(fileEvents, nodeIds);
  const networkLinks = buildNetworkLinks(networkConns, nodeIds);
  return { nodes, links: [...fileLinks, ...networkLinks] };
}
