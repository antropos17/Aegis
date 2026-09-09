<script lang="ts">
  import { measured, record, type RecordData, type Telemetry } from '../runtime/host';
  import AgentLogo from './AgentLogo.svelte';
  import Icon from './Icon.svelte';
  let { row, telemetry }: { row: RecordData; telemetry: Telemetry } = $props();
  let name = $derived(String(row.name ?? row.displayName ?? row.agent ?? 'Observation'));
  let resources = $derived(
    typeof row.instanceId === 'string'
      ? telemetry.resources.find((r) => r.instanceId === row.instanceId)
      : undefined,
  );
  const metric = (value: unknown, unit = '') =>
    measured(value) === null ? 'Unavailable' : `${Number(value).toFixed(1)}${unit}`;
</script>

{#if row.process || row.displayName}
  <div class="entity-heading">
    <AgentLogo {name} id={String(row.id ?? '')} size={36} />
    <div>
      <h2>{name}</h2>
      <small>{String(row.vendor ?? row.process ?? '')}{row.pid ? ` · PID ${row.pid}` : ''}</small>
    </div>
  </div>
  {#if row.description}<p class="description">{String(row.description)}</p>{/if}
  <div class="entity-metrics">
    <div>
      <small>Exposure risk</small><strong
        >{String(row.riskScore ?? row.riskProfile ?? 'Unavailable')}{row.riskScore !== undefined
          ? '/100'
          : ''}</strong
      >
    </div>
    <div>
      <small>{row.process ? 'CPU' : 'Category'}</small><strong
        >{row.process ? metric(resources?.cpu, '%') : String(row.category ?? 'Unavailable')}</strong
      >
    </div>
    <div>
      <small>{row.process ? 'Memory' : 'Source'}</small><strong
        >{row.process ? metric(resources?.memMb, ' MB') : row.custom ? 'Custom' : 'Bundled'}</strong
      >
    </div>
  </div>
  {#if row.process}<dl>
      <dt>Behaviour anomaly</dt>
      <dd>{String(row.anomalyScore ?? 'Unavailable')}/100</dd>
      <dt>Working directory</dt>
      <dd>{String(row.cwd ?? 'Unavailable')}</dd>
      <dt>Instance</dt>
      <dd>{String(row.instanceId ?? 'Identity unavailable')}</dd>
    </dl>{/if}
{:else if row.file || row.remoteIp || row.domain}
  <div class="entity-heading">
    <Icon name={row.file ? 'file' : 'network'} />
    <div>
      <h2>{row.file ? 'File observation' : 'Network observation'}</h2>
      <small>{String(row.source ?? 'Source unavailable')}</small>
    </div>
  </div>
  <dl>
    <dt>Resource</dt>
    <dd>{String(row.file ?? row.domain ?? row.remoteIp)}</dd>
    <dt>Agent</dt>
    <dd>{String(row.agent ?? 'Unattributed')}</dd>
    <dt>Time</dt>
    <dd>{row.timestamp ? new Date(Number(row.timestamp)).toLocaleString() : 'Unavailable'}</dd>
    <dt>Attribution</dt>
    <dd>{String(record(row.attribution).status ?? 'Unavailable')}</dd>
  </dl>
{/if}

<style>
  .entity-heading {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
  }
  .entity-heading h2 {
    font-size: 18px;
  }
  .entity-heading small {
    display: block;
    color: var(--muted);
    margin-top: 4px;
  }
  .entity-metrics {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
    border-block: 1px solid var(--border);
    padding-block: 16px;
    margin-bottom: 16px;
  }
  .entity-metrics small,
  .entity-metrics strong {
    display: block;
    overflow-wrap: anywhere;
  }
  .entity-metrics small {
    color: var(--muted);
  }
  .entity-metrics strong {
    font-size: 16px;
    margin-top: 6px;
  }
  .description {
    color: var(--muted);
    margin-bottom: 16px;
  }
  dl {
    display: grid;
    grid-template-columns: 120px minmax(0, 1fr);
    gap: 10px 16px;
    font-size: 12px;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  @media (max-width: 650px) {
    dl {
      grid-template-columns: 1fr;
    }
  }
</style>
