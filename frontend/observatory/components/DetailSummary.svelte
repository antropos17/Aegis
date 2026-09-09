<script lang="ts">
  import { instances, measured, type RecordData, type Telemetry } from '../runtime/host';
  import { radarGroups, groupResource, displayMeasure } from '../runtime/radar';
  import { detailActivity, detailKind } from '../runtime/detail-model';
  import { evidenceFields, selectFields } from '../runtime/detail-fields';
  import { describeObservation, observationTime } from '../../../src/shared/observation-display.js';
  import Metadata from './Metadata.svelte';
  import ObservationIdentity from './ObservationIdentity.svelte';
  let {
    row,
    telemetry,
    section = 'overview',
  }: { row: RecordData; telemetry: Telemetry; section?: string } = $props();
  let kind = $derived(detailKind(row));
  let info = $derived(describeObservation(row, instances(telemetry) as unknown as RecordData[]));
  let group = $derived(radarGroups(instances(telemetry)).find((g) => g.key === row.agentGroupKey));
  let usage = $derived(
    typeof row.instanceId === 'string'
      ? telemetry.resources.find((r) => r.instanceId === row.instanceId)
      : undefined,
  );
  let activity = $derived(detailActivity(row, telemetry));
  let times = $derived(activity.map((entry) => observationTime(entry.timestamp)).filter(Boolean));
  const score = (value: unknown) => (measured(value) === null ? '—' : String(value) + ' / 100');
  function metric(value: unknown, unit: string) {
    return telemetry.stale || measured(value) === null ? '—' : Number(value).toFixed(1) + unit;
  }
  let overview = $derived.by((): RecordData => {
    if (kind === 'group')
      return {
        Status: !group
          ? 'Not in the latest snapshot'
          : telemetry.stale
            ? 'Last reliable snapshot'
            : 'Active',
        Processes: group?.members.length ?? '—',
        'Highest process risk': group ? score(group.risk) : '—',
        'Combined CPU': group ? displayMeasure(groupResource(group, telemetry, 'cpu'), '%') : '—',
        'Combined RAM': group
          ? displayMeasure(groupResource(group, telemetry, 'memMb'), ' MB')
          : '—',
        'Retained activity': activity.length,
      };
    if (kind === 'process')
      return {
        Status: telemetry.stale
          ? 'Last reliable snapshot'
          : instances(telemetry).some((a) => a.instanceId === row.instanceId)
            ? 'Observed'
            : 'Not currently observed',
        pid: row.pid,
        Risk: score(row.riskScore),
        'Behaviour anomaly': score(row.anomalyScore),
        CPU: metric(usage?.cpu, '%'),
        RAM: metric(usage?.memMb, ' MB'),
        cwd: row.cwd,
      };
    if (kind === 'records')
      return {
        Records: activity.length,
        Resources: new Set(activity.map((entry) => describeObservation(entry).path).filter(Boolean))
          .size,
        firstSeen: times.length ? Math.min(...times) : null,
        lastSeen: times.length ? Math.max(...times) : null,
      };
    if (kind === 'catalog')
      return selectFields(row, ['vendor', 'category', 'riskProfile', 'defaultTrust']);
    if (kind === 'resource')
      return {
        timestamp: observationTime(row.timestamp) || null,
        [info.kind === 'Network' ? 'State' : 'Action']: row.action || row.state || 'Not recorded',
        ...(row.sensitive || row.severity === 'sensitive' ? { Sensitivity: 'Sensitive' } : {}),
        ...(row.verdict
          ? {
              'Endpoint verification':
                row.verdict === 'allowlisted'
                  ? 'Allowlisted'
                  : row.verdict === 'flagged'
                    ? 'Not allowlisted'
                    : 'Unverified',
            }
          : {}),
      };
    return selectFields(row, [
      'state',
      'status',
      'populationReliable',
      'identityDegraded',
      'timestamp',
      'at',
      'cpu',
      'action',
      'severity',
      'reason',
      'detail',
      'agent',
      'pid',
      'signature',
      'cwd',
      'source',
    ]);
  });
  let attributes = $derived(
    kind === 'process'
      ? selectFields(row, [
          'instanceId',
          'instanceIdSource',
          'process',
          'ppid',
          'parentEditor',
          'projectName',
          'firstSeen',
          'lastSeen',
          'startedAt',
          'source',
          'matchType',
          'confidence',
        ])
      : kind === 'resource'
        ? evidenceFields(row)
        : row,
  );
</script>

{#if section === 'attributes'}
  <section class="detail-section">
    <h3>{kind === 'resource' ? 'Recorded evidence' : 'Attributes'}</h3>
    <Metadata value={attributes} />
  </section>
{:else if section === 'signatures'}
  <section class="detail-section">
    <h3>Recognition patterns</h3>
    <Metadata
      value={selectFields(row, [
        'names',
        'knownDomains',
        'knownPorts',
        'configPaths',
        'parentEditors',
      ])}
    />
  </section>
{:else}
  {#if kind === 'resource'}<section class="detail-section resource-summary">
      <div class="section-heading">
        <h3>Resource</h3>
        <span class="badge">{info.kind}</span>
      </div>
      <div class="resource-path"><span>Full path / address</span><code>{info.path}</code></div>
      <div class="resource-owner">
        <span>Agent / context</span><ObservationIdentity
          {row}
          agents={instances(telemetry) as unknown as RecordData[]}
        />
      </div>
    </section>{/if}
  {#if kind === 'catalog' && row.description}<p class="detail-description">
      {String(row.description)}
    </p>{/if}
  <section class="detail-section">
    <h3>
      {kind === 'resource'
        ? 'Observation'
        : kind === 'records'
          ? 'Observation summary'
          : 'Overview'}
    </h3>
    <Metadata value={overview} />
  </section>
{/if}
