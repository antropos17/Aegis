<script lang="ts">
  import { t } from '../runtime/i18n';

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
  let matchingGroups = $derived(
    groups.filter((group) =>
      group.rows.some((entry) => {
        const info = describeObservation(entry);
        return [info.path, info.resource, info.label, entry.pid, entry.action, entry.state]
          .join(' ')
          .toLowerCase()
          .includes(query.toLowerCase());
      }),
    ),
  );
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
      <h3>{$t('Individual processes')}</h3>
      <span class="badge">{members.length}</span>
    </div>
    <label class="detail-search"
      ><Icon name="search" /><input
        aria-label={$t('Find a process')}
        type="search"
        placeholder={$t('PID, process or project')}
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
            <strong class="process-identity"><Icon name="cpu" />{$t('PID')} {a.pid}</strong><span
              class="badge">{a.riskScore}{$t('/100 risk')}</span
            >
          </div>
          <span>{a.process}</span><small class="process-location" title={a.cwd}
            >{#if a.cwd}<Icon name="folder" />{/if}<span
              >{a.cwd || $t('Working directory not recorded')}</span
            ></small
          >
          <span class="detail-card-link">{$t('Open process')}<Icon name="chevron" /></span>
        </button>
      {:else}<p class="entity-note">{$t('No processes match this view.')}</p>{/each}
    </div>
    {#if filtered.length > limit}<button class="button detail-load" onclick={() => (limit += 12)}
        >{$t('Show')} {Math.min(12, filtered.length - limit)} {$t('more processes')}</button
      >{/if}
  </section>
{:else if section === 'activity'}
  <section class="detail-section">
    <div class="section-heading">
      <h3>{$t('Files and connections')}</h3>
      <span class="badge">{activity.length} {$t('observations')}</span>
    </div>
    <label class="detail-search"
      ><Icon name="search" /><input
        aria-label={$t('Find activity')}
        type="search"
        placeholder={$t('Resource, address, action or PID')}
        bind:value={query}
      /></label
    >
    <p class="entity-note">
      {matchingGroups.length}
      {$t('resources ·')}
      {activity.length}
      {$t('observations retained')}
    </p>
    <div class="detail-card-grid">
      {#each matchingGroups.slice(0, limit) as group (group.key)}
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
              class="badge">{group.rows.length} {$t('records')}</span
            >
          </div>
          <small
            >{group.last
              ? new Date(group.last).toLocaleTimeString()
              : $t('Current snapshot')}</small
          >
        </button>
      {:else}<p class="entity-note">
          {activity.length
            ? $t('No resources match this search.')
            : $t('No retained activity for this exact process scope.')}
        </p>{/each}
    </div>
    {#if matchingGroups.length > limit}<button
        class="button detail-load"
        onclick={() => (limit += 12)}
        >{$t('Show')} {Math.min(12, matchingGroups.length - limit)} {$t('more resources')}</button
      >{/if}
  </section>
{:else if section === 'records'}
  <section class="detail-section">
    <ObservationHistory rows={activity} {navigate} bind:limit bind:query />
  </section>
{:else}
  <section class="detail-section">
    <h3>{$t('Related resources')}</h3>
    <div class="detail-card-grid">
      {#if parent && parent !== path}<button
          class="detail-card"
          data-detail-focus="parent-folder"
          onclick={() =>
            navigate('Parent folder', { cwd: parent, source: 'Parent of observed path' })}
        >
          <div class="detail-card-heading">
            <Icon name="folder" /><strong>{$t('Parent folder')}</strong>
          </div>
          <small>{parent}</small>
        </button>{/if}
      {#if agent}<button
          class="detail-card"
          data-detail-focus="exact-process"
          onclick={() => navigate(agent.name, agent as unknown as RecordData)}
        >
          <div class="detail-card-heading"><Icon name="cpu" /><strong>{agent.name}</strong></div>
          <span>{$t('PID')} {agent.pid}</span>
          <small>{$t('Exact recorded process identity')}</small>
        </button>{/if}
    </div>
    {#if !parent && !agent}<p class="entity-note">
        {$t('No related process or folder recorded.')}
      </p>{/if}
  </section>
{/if}

<style>
  .process-identity,
  .process-location {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .process-location {
    align-items: start;
  }
</style>
