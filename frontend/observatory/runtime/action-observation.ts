export type RouteObservation = {
  state:
    'connecting' | 'awaiting-client' | 'observed' | 'coverage-lost' | 'unavailable' | 'stopped';
  reason: string | null;
  lastObservedAt: string | null;
  snapshot: {
    schemaVersion: 1;
    connectionId: string;
    sequence: number;
    route: 'mcp-stdio' | 'mcp-review';
    state: 'awaiting-client' | 'observed' | 'coverage-lost';
    selection: 'single-action' | 'catalog' | 'selected-file-delete';
    client: { name: string; version: string | null } | null;
    selectedActionCount: number;
    actionAttempts: number;
    selectionRejected: number;
    ownerInvocations: number;
    ownerSettled: number;
    ownerFailures: number;
    cancellationRequests: number;
  } | null;
};
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (value: unknown, keys: string[]): value is Record<string, unknown> =>
  object(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
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
    !exact(value, ['state', 'reason', 'lastObservedAt', 'snapshot']) ||
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
      !exact(s, [
        'schemaVersion',
        'connectionId',
        'sequence',
        'route',
        'state',
        'client',
        'selection',
        'selectedActionCount',
        'actionAttempts',
        'selectionRejected',
        'ownerInvocations',
        'ownerSettled',
        'ownerFailures',
        'cancellationRequests',
      ]) ||
      s.schemaVersion !== 1 ||
      typeof s.connectionId !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(s.connectionId) ||
      typeof s.sequence !== 'number' ||
      !Number.isSafeInteger(s.sequence) ||
      s.sequence < 1 ||
      s.sequence > 1000 ||
      !['mcp-stdio', 'mcp-review'].includes(String(s.route)) ||
      !['awaiting-client', 'observed', 'coverage-lost'].includes(String(s.state)) ||
      !['single-action', 'catalog', 'selected-file-delete'].includes(String(s.selection)) ||
      (s.selection === 'selected-file-delete' && s.route !== 'mcp-review')
    )
      return null;
    if (
      s.client !== null &&
      (!exact(s.client, ['name', 'version']) ||
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
        'selectionRejected',
        'ownerInvocations',
        'ownerSettled',
        'ownerFailures',
        'cancellationRequests',
      ].every(
        (key) =>
          typeof s[key] === 'number' &&
          Number.isInteger(s[key]) &&
          s[key] >= 0 &&
          s[key] <= (key === 'selectedActionCount' ? (s.selection === 'catalog' ? 8 : 1) : 16),
      )
    )
      return null;
    if (
      (s.state === 'observed' && (!s.client || Number(s.selectedActionCount) < 1)) ||
      Number(s.ownerSettled) > Number(s.ownerInvocations) ||
      Number(s.ownerInvocations) + Number(s.selectionRejected) > Number(s.actionAttempts) ||
      Number(s.ownerFailures) > Number(s.ownerSettled) ||
      Number(s.cancellationRequests) > Number(s.actionAttempts)
    )
      return null;
  }
  if (value.state === 'observed' && (!object(s) || !s.client || !value.lastObservedAt)) return null;
  return value as RouteObservation;
}
