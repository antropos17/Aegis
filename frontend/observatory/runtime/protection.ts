import {
  describeObservation,
  canonicalObservationPath,
} from '../../../src/shared/observation-display.js';
import { record, type RecordData } from './host';
import { effectivePolicy } from './policy-targets';

export interface ProtectionActivity {
  key: string;
  kind: string;
  actor: string;
  action: string;
  target: string;
  resource: string;
  attribution: string;
  explanation: string;
  source: string;
  level: 'review' | 'unverified' | 'observed';
  reason: string;
  category: string;
  rows: RecordData[];
  latest: RecordData;
  time: number;
}

function describe(row: RecordData, network: boolean): Omit<ProtectionActivity, 'key' | 'rows'> {
  const evidence = describeObservation(row);
  const actions: Record<string, string> = {
    created: 'Created a file',
    modified: 'Changed a file',
    deleted: 'Deleted a file',
    accessed: 'Had an open file handle',
    holding: 'Held a file open',
  };
  let level: ProtectionActivity['level'] = 'observed';
  let reason = 'No risk flag on this observation. This does not establish that the action is safe.';
  if (row.sensitive === true) {
    level = 'review';
    reason =
      'Sensitive file: it may contain credentials or private configuration. Check whether this access was expected.';
  } else if (network && row.httpUnencrypted === true) {
    level = 'review';
    reason =
      'An unencrypted HTTP connection was observed. Check the destination before sending private data.';
  } else if (network && row.verdict === 'flagged') {
    level = 'review';
    reason =
      'The verified destination is outside the known endpoint list. This alone does not establish malicious activity.';
  } else if (network && row.verdict !== 'allowlisted') {
    level = 'unverified';
    reason = 'The destination identity could not be verified. Unknown does not mean dangerous.';
  } else if (network) {
    reason =
      'The destination matches a known endpoint list. This is not an access permission or a guarantee of safety.';
  }
  return {
    kind: network ? 'Network' : 'File',
    actor: evidence.actor || 'Agent not identified',
    action: network
      ? 'Connection observed'
      : (actions[String(row.action)] ?? 'File activity observed'),
    target: evidence.path || evidence.resource,
    resource: evidence.resource,
    attribution: evidence.attribution,
    explanation: evidence.explanation,
    source: evidence.source,
    level,
    reason,
    category: network ? 'network' : row.sensitive === true ? 'sensitive' : 'filesystem',
    latest: row,
    time: typeof row.timestamp === 'number' && Number.isFinite(row.timestamp) ? row.timestamp : 0,
  };
}

/** Group repeated observations without merging owners, actions or evidence. Resource-only updates reuse the result.
 * @returns Reader for immutable file and network deliveries @since 0.14.1
 */
export function createProtectionActivityReader() {
  let previousFiles: readonly RecordData[] | undefined;
  let previousNetwork: readonly RecordData[] | undefined;
  let result: ProtectionActivity[] = [];
  return (files: readonly RecordData[], network: readonly RecordData[]): ProtectionActivity[] => {
    if (files === previousFiles && network === previousNetwork) return result;
    const groups = new Map<string, ProtectionActivity>();
    for (const [rows, isNetwork] of [
      [files, false],
      [network, true],
    ] as const) {
      for (const row of rows) {
        const entry = describe(row, isNetwork);
        const key = JSON.stringify([
          entry.kind,
          row.instanceId ?? null,
          entry.actor,
          record(row.attribution),
          entry.attribution,
          entry.action,
          canonicalObservationPath(entry.target),
          entry.level,
          entry.reason,
          entry.source,
          row.reason ?? '',
          row.verdictReason ?? '',
        ]);
        const existing = groups.get(key);
        if (existing) {
          existing.rows.push(row);
          if (entry.time >= existing.time) Object.assign(existing, entry);
        } else groups.set(key, { ...entry, key, rows: [row] });
      }
    }
    const priority = { review: 0, unverified: 1, observed: 2 };
    result = [...groups.values()].sort(
      (a, b) => priority[a.level] - priority[b.level] || b.time - a.time,
    );
    previousFiles = files;
    previousNetwork = network;
    return result;
  };
}

interface PolicyInstance {
  instanceId: string | null;
  instanceKey: string;
  name: string;
  parentEditor?: string | null;
}

/** Resolve policy only through a unique recorded process lifetime, never through PID or a path guess.
 * @param activity Selected evidence @param agents Current population @param permissions Loaded preferences
 * @returns Current context and saved preference, or unavailable @since 0.14.1
 */
export function protectionPolicy<T extends PolicyInstance>(
  activity: ProtectionActivity,
  agents: T[],
  permissions: RecordData | null,
): { agent: T | null; label: string } {
  const row = activity.latest;
  const status = record(row.attribution).status;
  const matches =
    typeof row.instanceId === 'string' &&
    row.instanceId &&
    status !== 'unattributed' &&
    status !== 'ambiguous'
      ? agents.filter(
          (agent) => agent.instanceId === row.instanceId && agent.name === activity.actor,
        )
      : [];
  const agent = matches.length === 1 ? matches[0] : null;
  if (!agent) return { agent: null, label: 'Unavailable for this observation' };
  if (!permissions) return { agent, label: 'Preferences unavailable' };
  const value = effectivePolicy(agent.instanceKey, agents, permissions)[activity.category];
  const labels: Record<string, string> = {
    block: 'Block requested · not enforced',
    allow: 'Allow preferred · not enforced',
    monitor: 'Monitor preference',
  };
  return { agent, label: labels[String(value)] ?? 'No saved preference for this category' };
}
