export type RouteObservation = {
  state:
    'connecting' | 'awaiting-client' | 'observed' | 'coverage-lost' | 'unavailable' | 'stopped';
  reason: string | null;
  lastObservedAt: string | null;
  snapshot: {
    connectionId: string;
    route: 'mcp-stdio' | 'mcp-review';
    selection: 'single-action' | 'catalog';
    client: { name: string; version: string | null } | null;
    selectedActionCount: number;
    actionAttempts: number;
    ownerInvocations: number;
    ownerSettled: number;
    ownerFailures: number;
    cancellationRequests: number;
  } | null;
};
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
export const observationLabels: Record<RouteObservation['state'], string> = {
  connecting: 'Connecting to observation endpoint',
  'awaiting-client': 'Waiting for MCP initialization',
  observed: 'Observed',
  'coverage-lost': 'Coverage lost',
  unavailable: 'Observation unavailable',
  stopped: 'Observation stopped',
};

/** Validate host observations before displaying state, metadata or counts.
 * @param value Host-only snapshot. @returns Validated projection or null. @since v0.15.1 */
export function parseRouteObservation(value: unknown): RouteObservation | null {
  if (
    !object(value) ||
    typeof value.state !== 'string' ||
    !Object.hasOwn(observationLabels, value.state) ||
    (value.lastObservedAt !== null &&
      (typeof value.lastObservedAt !== 'string' ||
        !Number.isFinite(Date.parse(value.lastObservedAt))))
  )
    return null;
  if (
    value.reason !== null &&
    ![
      'observer-stopped',
      'updates-expired',
      'observation-expired',
      'invalid-endpoint',
      'connection-closed',
      'invalid-update',
      'owner-closed',
      'observation-unavailable',
    ].includes(String(value.reason))
  )
    return null;
  const s = value.snapshot;
  if (s !== null) {
    if (
      !object(s) ||
      typeof s.connectionId !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(s.connectionId) ||
      !['mcp-stdio', 'mcp-review'].includes(String(s.route)) ||
      !['single-action', 'catalog'].includes(String(s.selection))
    )
      return null;
    if (
      s.client !== null &&
      (!object(s.client) ||
        !['claude-code', 'claude', 'codex', 'cursor', 'vscode', 'other'].includes(
          String(s.client.name),
        ) ||
        (s.client.version !== null &&
          (typeof s.client.version !== 'string' ||
            !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(s.client.version))))
    )
      return null;
    if (
      ![
        'selectedActionCount',
        'actionAttempts',
        'ownerInvocations',
        'ownerSettled',
        'ownerFailures',
        'cancellationRequests',
      ].every(
        (key) =>
          typeof s[key] === 'number' &&
          Number.isInteger(s[key]) &&
          s[key] >= 0 &&
          s[key] <= (key === 'selectedActionCount' ? 8 : 16),
      )
    )
      return null;
  }
  if (value.state === 'observed' && (!object(s) || !s.client || !value.lastObservedAt)) return null;
  return value as RouteObservation;
}
