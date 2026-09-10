import { describeObservation } from '../../../src/shared/observation-display.js';
import { record, type RecordData, type Telemetry } from './host';

export interface AgentScope {
  agent: string;
  instanceId: string;
}

/** Whether a recorded identity can select one real process without PID-only fallback.
 * @param row Recorded process identity @returns True for a usable process scope
 * @since 0.14.1
 */
export function isScopedProcess(row: {
  pid?: unknown;
  instanceId?: unknown;
  instanceIdSource?: unknown;
}): boolean {
  return (
    typeof row.pid === 'number' &&
    Number.isInteger(row.pid) &&
    row.pid > 0 &&
    typeof row.instanceId === 'string' &&
    row.instanceId.trim().length > 0 &&
    !row.instanceId.endsWith(':u') &&
    !row.instanceId.startsWith('0:') &&
    row.instanceIdSource !== 'unknown' &&
    row.instanceIdSource !== 'synthetic'
  );
}

/** Select retained evidence without reconstructing ownership from a PID or path.
 * @param rows Retained observations @param telemetry Current population for exact-stamp joins
 * @param scope Product and optional process selection @returns Matching original records
 * @since 0.14.1
 */
export function scopeEvidence(
  rows: readonly RecordData[],
  telemetry: Telemetry,
  scope: AgentScope,
): RecordData[] {
  if (!scope.agent) return [...rows];
  const agents = telemetry.agents.filter(isScopedProcess) as unknown as RecordData[];
  if (
    scope.instanceId &&
    (scope.instanceId.endsWith(':u') ||
      scope.instanceId.startsWith('0:') ||
      telemetry.agents.some(
        (agent) => agent.instanceId === scope.instanceId && !isScopedProcess(agent),
      ))
  )
    return [];
  return rows.filter((row) => {
    if (
      row.selfAccess === true ||
      record(row.attribution).status === 'unattributed' ||
      row.attribution === 'unattributed'
    )
      return false;
    if (scope.instanceId)
      return (
        row.instanceId === scope.instanceId &&
        row.pid !== 0 &&
        row.instanceIdSource !== 'unknown' &&
        row.instanceIdSource !== 'synthetic'
      );
    return describeObservation(row, agents).actor === scope.agent;
  });
}
