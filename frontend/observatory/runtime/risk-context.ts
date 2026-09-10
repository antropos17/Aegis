import { instances, measured, record, records, type RecordData, type Telemetry } from './host';
import { radarGroups, type ObservedInstance } from './radar';

const factors: Record<string, { label: string; detail: string }> = {
  sensitive: {
    label: 'Sensitive file activity',
    detail: 'Recorded activity involving files classified as sensitive.',
  },
  config: {
    label: 'Agent configuration',
    detail: 'Activity involving recognized agent configuration files.',
  },
  network: {
    label: 'Network connections',
    detail: 'The number of observed connections contributes to exposure.',
  },
  endpoints: {
    label: 'Destination checks',
    detail:
      'Some destinations are outside the allowlist or could not be identified. Review their context.',
  },
  files: {
    label: 'File activity',
    detail: 'The amount of recorded file activity contributes to exposure.',
  },
  credentials: {
    label: 'SSH / cloud credentials',
    detail: 'Recorded file activity classified as SSH or AWS related.',
  },
  http: {
    label: 'Plain HTTP connections',
    detail: 'Connections marked as unencrypted HTTP by the network sensor.',
  },
};
/** Describe the largest contribution already used by an assessed process.
 * @param agent Enriched process @returns Plain-language reason @since 0.14.1
 */
export function leadingRiskReason(agent: ObservedInstance | undefined): string {
  if (!agent) return 'Assessment unavailable';
  if (!agent.instanceId) return 'Activity cannot be linked to this process';
  const strongest = [...(agent.riskEvidence?.factors ?? [])].sort((a, b) => b.points - a.points)[0];
  return strongest && strongest.points > 0
    ? (factors[strongest.id]?.label ?? 'Recorded activity')
    : 'No scored activity';
}
/** Resolve current group evidence or a captured process assessment without joining by PID/name.
 * @param row Detail request @param state Telemetry @returns Assessment and readable contributions @since 0.14.1
 */
export function riskContext(row: RecordData, state: Telemetry) {
  const current = instances(state);
  const group = row.agentGroupKey
    ? radarGroups(current).find((g) => g.key === row.agentGroupKey)
    : undefined;
  const captured = !row.agentGroupKey && !!row.riskEvidence;
  const subject =
    (group?.members[0] as unknown as RecordData | undefined) ??
    (captured
      ? row
      : (current.find((a) => a.instanceId && a.instanceId === row.instanceId) as unknown as
          RecordData | undefined));
  const basis = record(subject?.riskEvidence);
  const contributions = records(basis.factors)
    .flatMap((factor) => {
      const description = factors[String(factor.id)];
      const points = measured(factor.points);
      return description && points !== null && points > 0
        ? [{ id: String(factor.id), ...description, points }]
        : [];
    })
    .sort((a, b) => b.points - a.points);
  return {
    subject,
    contributions,
    captured,
    score: measured(subject?.riskScore),
    available: !!subject?.riskEvidence,
    adjustment: measured(basis.adjustment) ?? 0,
    baseScore: measured(basis.baseScore),
    processCount: group?.members.length ?? (subject ? 1 : 0),
    unlinked: group
      ? group.members.filter((a) => !a.instanceId).length
      : subject && !subject.instanceId
        ? 1
        : 0,
    tied: group ? group.members.filter((a) => a.riskScore === group.risk).length : 1,
  };
}
