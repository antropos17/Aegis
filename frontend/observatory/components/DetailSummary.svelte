<script lang="ts">
  import { instances, measured, record, type RecordData, type Telemetry } from '../runtime/host';
  import { radarGroups, groupResource, displayMeasure } from '../runtime/radar';
  import AgentLogo from './AgentLogo.svelte';
  import Icon from './Icon.svelte';
  import { networkAddress } from '../runtime/radar-resources';
  let { row, telemetry }: { row: RecordData; telemetry: Telemetry } = $props();
  let name = $derived(String(row.name ?? row.displayName ?? row.agent ?? 'Observation'));
  let group = $derived(radarGroups(instances(telemetry)).find((g) => g.key === row.agentGroupKey));
  let resources = $derived(
    typeof row.instanceId === 'string'
      ? telemetry.resources.find((r) => r.instanceId === row.instanceId)
      : undefined,
  );
  function metric(value: unknown, unit = '') {
    return telemetry.stale || measured(value) === null ? '—' : Number(value).toFixed(1) + unit;
  }
</script>

{#if row.agentGroupKey}
  <div class="agent-identity">
    <AgentLogo {name} id={String(row.agentGroupKey)} size={32} />
    <div>
      <strong>{name}</strong><small
        >{group
          ? `${group.members.length} observed processes`
          : 'Not in the latest snapshot'}</small
      >
    </div>
  </div>
  {#if group}
    <dl class="details-grid">
      <dt>Status</dt>
      <dd>{telemetry.stale ? 'Last reliable snapshot' : 'Active'}</dd>
      <dt>Highest process risk</dt>
      <dd><span class="risk-value">{group.risk}<small>/100</small></span></dd>
      <dt>Combined CPU</dt>
      <dd>{displayMeasure(groupResource(group, telemetry, 'cpu'), '%')}</dd>
      <dt>Combined RAM</dt>
      <dd>{displayMeasure(groupResource(group, telemetry, 'memMb'), ' MB')}</dd>
    </dl>
    <p class="entity-note">
      These processes belong to the same agent. Choose a process to see its own activity and
      controls.
    </p>
  {/if}
{:else if row.process}
  <div class="agent-identity">
    <AgentLogo {name} size={32} />
    <div>
      <strong>{name}</strong><small
        >{telemetry.stale ? 'Last snapshot' : 'Observed process'} · PID {String(row.pid)}</small
      >
    </div>
  </div>
  <dl class="details-grid">
    <dt>Risk</dt>
    <dd><span class="risk-value">{String(row.riskScore ?? '—')}<small>/100</small></span></dd>
    <dt>Working directory</dt>
    <dd><code>{String(row.cwd ?? 'Unavailable')}</code></dd>
    <dt>Parent editor</dt>
    <dd>{String(row.parentEditor ?? 'Unavailable')}</dd>
    <dt>Instance</dt>
    <dd><code>{String(row.instanceId ?? 'Identity unavailable')}</code></dd>
    <dt>CPU / RAM</dt>
    <dd>{metric(resources?.cpu, '%')} / {metric(resources?.memMb, ' MB')}</dd>
    <dt>Behaviour anomaly</dt>
    <dd>{String(row.anomalyScore ?? '—')}/100</dd>
  </dl>
{:else if row.displayName}
  <div class="agent-identity">
    <AgentLogo {name} id={String(row.id ?? '')} size={32} />
    <div><strong>{name}</strong><small>{String(row.vendor ?? 'Custom agent')}</small></div>
  </div>
  <p class="muted">{String(row.description ?? '')}</p>
  <dl class="details-grid">
    <dt>Category</dt>
    <dd>{String(row.category ?? '—')}</dd>
    <dt>Risk profile</dt>
    <dd><span class="badge">{String(row.riskProfile ?? '—')}</span></dd>
    <dt>Process signatures</dt>
    <dd>
      <div class="signature-links">
        {#each Array.isArray(row.names) ? row.names : [] as value, i (i)}<code>{String(value)}</code
          >{/each}
      </div>
    </dd>
    <dt>Known domains</dt>
    <dd>{Array.isArray(row.knownDomains) ? row.knownDomains.join(', ') : 'None recorded'}</dd>
    <dt>Configuration paths</dt>
    <dd>{Array.isArray(row.configPaths) ? row.configPaths.join(', ') : 'None recorded'}</dd>
  </dl>
{:else if row.file || row.remoteIp || row.domain}
  <div class="toolbar">
    <span class="badge">{row.file ? 'File observation' : 'Network connection'}</span
    >{#if row.sensitive}<span class="badge medium">Sensitive</span>{/if}
  </div>
  <dl class="details-grid">
    <dt>Time</dt>
    <dd>{row.timestamp ? new Date(Number(row.timestamp)).toLocaleString() : 'Unavailable'}</dd>
    <dt>Agent</dt>
    <dd>{String(row.agent ?? 'Unattributed')}</dd>
    <dt>{row.file ? 'Action' : 'State'}</dt>
    <dd>{String(row.action ?? row.state ?? 'Unknown')}</dd>
    <dt>Resource</dt>
    <dd>
      <code>{row.file ? String(row.file) : networkAddress(row) || 'Unavailable'}</code>
    </dd>
    {#if row.remotePort}<dt>Port</dt>
      <dd>{String(row.remotePort)}</dd>{/if}
    <dt>Attribution</dt>
    <dd>{String(record(row.attribution).status ?? 'Unknown')}</dd>
    <dt>Evidence</dt>
    <dd>
      {Array.isArray(record(row.attribution).evidence)
        ? (record(row.attribution).evidence as unknown[]).map(String).join(', ')
        : String(row.reason ?? 'No evidence supplied')}
    </dd>
    <dt>Source</dt>
    <dd>{String(row.source ?? 'Unknown')}</dd>
  </dl>
  <div class="notice">
    <Icon name={row.file ? 'file' : 'network'} />{row.file
      ? 'File contents are not displayed. This event contains metadata only.'
      : 'Address classification and agent risk are separate assessments.'}
  </div>
{:else if row.type || row.timestamp}
  <dl class="details-grid">
    {#each ['timestamp', 'type', 'agent', 'instanceId', 'detail', 'seq', 'hash'] as key (key)}{#if row[key] !== undefined}<dt
        >
          {key}
        </dt>
        <dd>{String(row[key])}</dd>{/if}{/each}
  </dl>
{:else if row.cwd}
  <dl class="details-grid">
    <dt>Folder</dt>
    <dd><code>{String(row.cwd)}</code></dd>
    <dt>Source</dt>
    <dd>{String(row.source ?? 'Observed metadata')}</dd>
  </dl>
{/if}

<style>
  dd {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .signature-links {
    display: flex;
    gap: 4px 10px;
    flex-wrap: wrap;
  }
</style>
