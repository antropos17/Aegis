<script lang="ts">
  import Icon from './Icon.svelte';
  import ResourceIcon from './ResourceIcon.svelte';
  import { resourceVisual } from '../runtime/resource-visual';
  import { t } from '../runtime/i18n';

  import { instances, measured, record, type RecordData, type Telemetry } from '../runtime/host';
  import type { SignatureConflict } from '../runtime/catalog';
  import { radarGroups, groupResource, displayMeasure } from '../runtime/radar';
  import { detailActivity, detailKind } from '../runtime/detail-model';
  import { evidenceFields, fieldValue, selectFields } from '../runtime/detail-fields';
  import {
    describeObservation,
    observationTime,
    canonicalObservationPath,
  } from '../../../src/shared/observation-display.js';
  import Metadata from './Metadata.svelte';
  import ObservationIdentity from './ObservationIdentity.svelte';
  import SequenceEvidence from './SequenceEvidence.svelte';
  let {
    row,
    telemetry,
    section = 'overview',
    changeSection,
  }: {
    row: RecordData;
    telemetry: Telemetry;
    section?: string;
    changeSection?: (_section: string) => void;
  } = $props();
  let kind = $derived(detailKind(row));
  let recognition = $derived(record(row.recognition));
  let signatureConflicts = $derived(
    Array.isArray(recognition.shadowed) ? (recognition.shadowed as SignatureConflict[]) : [],
  );
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
  function catalogMetadata(value: RecordData): RecordData {
    const { riskProfile, ...rest } = value;
    return riskProfile === undefined ? rest : { ...rest, 'Catalog risk profile': riskProfile };
  }
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
        Resources: new Set(
          activity
            .map((entry) => canonicalObservationPath(describeObservation(entry).path))
            .filter(Boolean),
        ).size,
        firstSeen: times.length ? Math.min(...times) : null,
        lastSeen: times.length ? Math.max(...times) : null,
      };
    if (kind === 'catalog')
      return selectFields(catalogMetadata(row), [
        'vendor',
        'category',
        'Catalog risk profile',
        'defaultTrust',
      ]);
    if (kind === 'resource')
      return {
        timestamp: observationTime(row.timestamp) || null,
        [info.kind === 'Network' ? 'State' : 'Action']: row.action || row.state || 'Not recorded',
        ...(row.sensitive || row.severity === 'sensitive' ? { Sensitivity: 'Sensitive' } : {}),
        ...(info.kind === 'Network'
          ? {
              'Endpoint verification': fieldValue(row.verdict, 'verdict'),
              'Verification evidence': fieldValue(row.verdictReason, 'verdictReason'),
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
        : kind === 'catalog'
          ? catalogMetadata(row)
          : row,
  );
</script>

{#if kind === 'catalog' && section !== 'signatures'}<p class="entity-note">
    {$t('Catalog risk profile is saved metadata. It does not describe current behavior or safety.')}
  </p>{/if}
{#if kind === 'catalog' && recognition.skippedById}<p class="entity-note">
    {$t(
      'This custom ID is already used by an earlier catalog entry, so its signatures are not used for detection.',
    )}
  </p>{/if}
{#if kind === 'catalog' && signatureConflicts.length}
  <section class="detail-section catalog-recognition">
    <h3>{$t('Signature ownership')}</h3>
    <ul>
      {#each signatureConflicts as conflict (conflict.signature.toLowerCase())}
        <li>
          {$t('{signature} is first owned by {owner}', {
            signature: conflict.signature,
            owner: conflict.firstOwner,
          })}
        </li>
      {/each}
    </ul>
    <p class="entity-note">
      {$t('This is catalog order only; it does not verify a running process.')}
    </p>
  </section>
{/if}
{#if section === 'attributes'}
  <section class="detail-section">
    <h3>{kind === 'resource' ? $t('Recorded evidence') : $t('Attributes')}</h3>
    <Metadata value={attributes} />
  </section>
{:else if section === 'signatures'}
  <section class="detail-section">
    <h3>{$t('Recognition patterns')}</h3>
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
  {#if row.type === 'sequence-detection'}<SequenceEvidence {row} />{/if}
  {#if kind === 'group' || kind === 'process'}<section class="detail-section">
      <p class="entity-note">
        {kind === 'group'
          ? $t(
              'An agent can run several worker processes. This overview combines their usage and shows the highest process risk.',
            )
          : $t('This is one worker process. Its activity is linked by its recorded identity.')}
      </p>
      {#if changeSection}<button class="button" onclick={() => changeSection?.('risk')}
          ><Icon name="shield" />{$t('Why this score')}</button
        >{/if}
    </section>{/if}
  {#if kind === 'resource'}<section class="detail-section resource-summary">
      <div class="section-heading">
        <h3 class="resource-heading"><ResourceIcon {row} compact />{$t('Resource')}</h3>
        <span class="badge">{$t(resourceVisual(row).label)}</span>
      </div>
      <div class="resource-path">
        <span>{$t('Full path / address')}</span><code>{info.path}</code>
      </div>
      <div class="resource-owner">
        <span>{$t('Agent / context')}</span><ObservationIdentity
          {row}
          agents={instances(telemetry) as unknown as RecordData[]}
        />
      </div>
      <p class="entity-note">{info.explanation}</p>
    </section>{/if}
  {#if kind === 'catalog' && row.description}<p class="detail-description">
      {String(row.description)}
    </p>{/if}
  <section class="detail-section">
    <h3>
      {kind === 'resource'
        ? $t('Observation')
        : kind === 'records'
          ? $t('Observation summary')
          : $t('Overview')}
    </h3>
    <Metadata value={overview} />
  </section>
{/if}

<style>
  .catalog-recognition ul {
    margin: var(--space-2) 0;
    padding-inline-start: var(--space-5);
    overflow-wrap: anywhere;
  }
  .resource-heading {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
</style>
