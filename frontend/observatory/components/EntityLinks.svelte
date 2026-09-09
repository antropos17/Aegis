<script lang="ts">
  import { instances, type Telemetry, type RecordData } from '../runtime/host';
  import { detailActivity, detailMembers } from '../runtime/detail-model';
  import {
    groupObservations,
    describeObservation,
  } from '../../../src/shared/observation-display.js';
  import Icon from './Icon.svelte';
  import ObservationHistory from './ObservationHistory.svelte';
  import ObservationResource from './ObservationResource.svelte';
  let {
    row,
    telemetry,
    navigate,
    section = 'related',
    query = $bindable(''),
    limit = $bindable(12),
  }: {
    row: RecordData;
    telemetry: Telemetry;
    navigate: (_title: string, _row: RecordData) => Promise<void>;
    section?: string;
    query?: string;
    limit?: number;
  } = $props();
  let members = $derived(detailMembers(row, telemetry));
  let filtered = $derived(
    members.filter((a) =>
      [a.pid, a.process, a.cwd].join(' ').toLowerCase().includes(query.toLowerCase()),
    ),
  );
  let activity = $derived(detailActivity(row, telemetry));
  let groups = $derived(groupObservations(activity));
  let path = $derived(String(row.file || row.path || row.cwd || ''));
  let isNetwork = $derived(describeObservation(row).kind === 'Network');
  let parent = $derived(
    !isNetwork
      ? path.replaceAll('\\', '/').replace(/\/$/, '').split('/').slice(0, -1).join('/')
      : '',
  );
  let agent = $derived(
    describeObservation(row, instances(telemetry) as unknown as RecordData[]).actor
      ? instances(telemetry).find((a) => a.instanceId && a.instanceId === row.instanceId)
      : undefined,
  );
</script>

{#if section === 'processes'}
  <section class="detail-section">
    <div class="section-heading">
      <h3>Individual processes</h3>
      <span class="badge">{members.length}</span>
    </div>
    <label class="detail-search"
      ><Icon name="search" /><input
        aria-label="Find a process"
        type="search"
        placeholder="PID, process or project"
        bind:value={query}
      /></label
    >
    <div class="detail-card-grid">
      {#each filtered.slice(0, limit) as a (a.instanceId ?? a)}
        <button
          class="process-row detail-card"
          data-detail-focus={'process-' + (a.instanceId ?? a.pid)}
          aria-label={'Open process PID ' + a.pid}
          onclick={() => navigate(a.name + ' · PID ' + a.pid, a as unknown as RecordData)}
        >
          <div class="detail-card-heading">
            <strong>PID {a.pid}</strong><span class="badge">{a.riskScore}/100 risk</span>
          </div>
          <span>{a.process}</span><small title={a.cwd}
            >{a.cwd || 'Working directory not recorded'}</small
          >
          <span class="detail-card-link">Open process<Icon name="chevron" /></span>
        </button>
      {:else}<p class="entity-note">No processes match this view.</p>{/each}
    </div>
    {#if filtered.length > limit}<button class="button detail-load" onclick={() => (limit += 12)}
        >Show 12 more processes</button
      >{/if}
  </section>
{:else if section === 'activity'}
  <section class="detail-section">
    <div class="section-heading">
      <h3>Files and connections</h3>
      <span class="badge">{activity.length} observations</span>
    </div>
    <div class="detail-card-grid">
      {#each groups.slice(0, limit) as group (group.key)}
        <button
          class="detail-card activity-card"
          data-detail-focus={'activity-' + group.key}
          onclick={() =>
            navigate(
              group.label,
              group.rows.length > 1
                ? { observations: group.rows, observationGroup: group.label }
                : group.latest,
            )}
        >
          <ObservationResource row={group.latest} />
          <div class="detail-card-heading">
            <span>{String(group.latest.action || group.latest.state || 'Observed')}</span><span
              class="badge">{group.rows.length} records</span
            >
          </div>
          <small
            >{group.last ? new Date(group.last).toLocaleTimeString() : 'Current snapshot'}</small
          >
        </button>
      {:else}<p class="entity-note">No retained activity for this exact process scope.</p>{/each}
    </div>
    {#if groups.length > limit}<button class="button detail-load" onclick={() => (limit += 12)}
        >Show 12 more resources</button
      >{/if}
  </section>
{:else if section === 'records'}
  <section class="detail-section">
    <ObservationHistory rows={activity} {navigate} bind:limit />
  </section>
{:else}
  <section class="detail-section">
    <h3>Related resources</h3>
    <div class="detail-card-grid">
      {#if parent && parent !== path}<button
          class="detail-card"
          data-detail-focus="parent-folder"
          onclick={() =>
            navigate('Parent folder', { cwd: parent, source: 'Parent of observed path' })}
        >
          <div class="detail-card-heading">
            <Icon name="folder" /><strong>Parent folder</strong>
          </div>
          <small>{parent}</small>
        </button>{/if}
      {#if agent}<button
          class="detail-card"
          data-detail-focus="exact-process"
          onclick={() => navigate(agent.name, agent as unknown as RecordData)}
        >
          <div class="detail-card-heading"><Icon name="cpu" /><strong>{agent.name}</strong></div>
          <span>PID {agent.pid}</span>
          <small>Exact recorded process identity</small>
        </button>{/if}
    </div>
    {#if !parent && !agent}<p class="entity-note">No related process or folder recorded.</p>{/if}
  </section>
{/if}
