<script lang="ts">
  import { t } from '../runtime/i18n';
  import { observationStatusLabel } from '../runtime/observation-status';

  import { onMount, untrack } from 'svelte';
  import { instances, record, type Telemetry, type RecordData } from '../runtime/host';
  import { radarGroups } from '../runtime/radar';
  import { scopeStatistics } from '../runtime/statistics-scope';
  import type { AgentScope } from '../runtime/agent-scope';
  import {
    createStatisticsHistory,
    observeStatistics,
    type StatisticsSample,
  } from '../runtime/statistics-history';
  import {
    statisticsMetrics,
    statisticsTabs,
    type StatsSection,
  } from '../runtime/statistics-metrics';
  import SectionNavigation from './SectionNavigation.svelte';
  import StatsChart from './StatsChart.svelte';
  import StatsSensors from './StatsSensors.svelte';
  import StatsTokens from './StatsTokens.svelte';
  import ResourceUsage from './ResourceUsage.svelte';
  import Agents from './Agents.svelte';
  let {
    telemetry,
    inspect,
    sectionRequest,
    scopeRequest,
    scope,
    changeScope,
    paused = false,
  }: {
    telemetry: Telemetry;
    inspect: (_title: string, _row: RecordData) => void;
    sectionRequest?: { id: string; revision: number };
    scopeRequest?: { agent: string; revision: number };
    scope?: AgentScope;
    changeScope?: (_scope: AgentScope) => void;
    paused?: boolean;
  } = $props();
  let section = $state<StatsSection>('overview');
  let selected = $state<Record<StatsSection, string>>({
    overview: 'cpu',
    processes: 'memory',
    activity: 'connections',
    tokens: 'tokens',
    sensors: 'ownCpu',
  });
  let localAgent = $state('');
  let localInstanceId = $state('');
  let agent = $derived(scope?.agent ?? localAgent);
  let instanceId = $derived(scope?.instanceId ?? localInstanceId);
  let allNow = $state(Date.now());
  let scopedNow = $state(Date.now());
  let historyPeriod = $state(60000);
  let processesVisited = $state(false);
  let allHistory = createStatisticsHistory();
  let scopedHistory = createStatisticsHistory();
  let allSamples = $state.raw<StatisticsSample[]>([]);
  let scopedSamples = $state.raw<StatisticsSample[]>([]);
  let historyKey = '';
  let lastRequest = -1;
  let lastScopeRequest = -1;
  let groups = $derived(radarGroups(instances(telemetry)));
  let members = $derived(telemetry.agents.filter((row) => row.agent === agent));
  let scoped = $derived(scopeStatistics(telemetry, { agent, instanceId }));
  let sensorView = $derived(section === 'sensors');
  let now = $derived(sensorView || !agent ? allNow : scopedNow);
  let samples = $derived(sensorView || !agent ? allSamples : scopedSamples);
  let metrics = $derived(
    statisticsMetrics.filter(
      (metric) =>
        metric.sections.includes(section) &&
        (!agent || !['fileRate', 'sensitiveRate'].includes(metric.id)),
    ),
  );
  let coverage = $derived(
    scoped.agents.filter(
      (row) =>
        row.instanceId &&
        scoped.resources.some(
          (reading) =>
            reading.instanceId === row.instanceId &&
            typeof reading.cpu === 'number' &&
            typeof reading.memMb === 'number',
        ),
    ).length,
  );
  let health = $derived(record(telemetry.stats.appHealth));
  $effect(() => {
    if (section === 'processes') processesVisited = true;
  });
  onMount(() => {
    const timer = setInterval(() => {
      if (!paused && !telemetry.stale) allNow = Date.now();
      if (!paused && !scoped.stale) scopedNow = Date.now();
    }, 1000);
    return () => clearInterval(timer);
  });
  $effect(() => {
    const current = paused ? { ...telemetry, stale: true } : telemetry;
    const filtered = paused ? { ...scoped, stale: true } : scoped;
    const key = JSON.stringify([agent, instanceId]);
    const interruption = paused ? Date.now() : undefined;
    untrack(() => {
      allHistory = observeStatistics(allHistory, current, interruption);
      allSamples = allHistory.samples;
      if (key !== historyKey) {
        scopedHistory = createStatisticsHistory();
        historyKey = key;
      }
      scopedHistory = observeStatistics(scopedHistory, filtered, interruption);
      scopedSamples = scopedHistory.samples;
    });
  });
  $effect(() => {
    const request = sectionRequest;
    if (request && request.revision !== lastRequest) {
      lastRequest = request.revision;
      if (statisticsTabs.some((tab) => tab.id === request.id)) section = request.id as StatsSection;
    }
    const requestScope = scopeRequest;
    if (!scope && requestScope && requestScope.revision !== lastScopeRequest) {
      lastScopeRequest = requestScope.revision;
      localAgent = requestScope.agent;
      localInstanceId = '';
      section = 'overview';
    }
  });
</script>

<div class="statistics-workspace">
  <div class="statistics-content">
    {#each statisticsTabs.filter((item) => item.id !== 'processes') as item (item.id)}
      {#if section === item.id}
        <section
          id={'statistics-panel-' + item.id}
          aria-label={$t(item.label)}
          class="statistics-section"
        >
          {#key sensorView ? 'sensors' : JSON.stringify([agent, instanceId])}
            <StatsChart
              {samples}
              {metrics}
              {now}
              {paused}
              bind:period={historyPeriod}
              bind:selected={selected[section]}
              stale={(sensorView ? telemetry.stale : scoped.stale) || paused}
            />
          {/key}
          {#if section === 'activity'}
            <p class="scope-note">
              {agent
                ? $t(
                    'Only connections with an exact selected process identity are included. Per-agent cumulative file counters are unavailable, so file rates are not shown.',
                  )
                : $t(
                    'Connections are counts, not bandwidth. File rates use delivered global counters.',
                  )}
            </p>
          {:else if section === 'tokens'}
            <div class="supporting-content"><StatsTokens telemetry={scoped} {inspect} /></div>
          {:else if section === 'sensors'}
            <div class="supporting-content"><StatsSensors {telemetry} /></div>
          {/if}
        </section>
      {/if}
    {/each}
    {#if processesVisited}
      <section
        id="statistics-panel-processes"
        aria-label={$t('Processes')}
        class="statistics-processes"
        hidden={section !== 'processes'}
      >
        <ResourceUsage telemetry={scoped} {inspect} />
        <section class="panel process-table" aria-label={$t('Table')}>
          <div class="panel-head"><h2>{$t('Processes')}</h2></div>
          <div class="process-table-content"><Agents telemetry={scoped} {inspect} /></div>
        </section>
      </section>
    {/if}
  </div>
  <aside class="statistics-context">
    <SectionNavigation
      tabs={statisticsTabs}
      selected={section}
      change={(value) => {
        section = value as StatsSection;
      }}
      prefix="statistics"
      label={$t('Statistics sections')}
      controls={false}
    />
    {#if !scope}
      <div class="statistics-scope">
        <label>
          {$t('Agent')}
          <select
            aria-label={$t('Statistics agent')}
            bind:value={localAgent}
            disabled={sensorView}
            onchange={(event) => {
              localInstanceId = '';
              changeScope?.({ agent: event.currentTarget.value, instanceId: '' });
            }}
          >
            <option value="">{$t('All agents')}</option>
            {#each groups as group (group.key)}<option value={group.key}>{group.name}</option
              >{/each}
            {#if agent && !groups.some((group) => group.key === agent)}
              <option value={agent}>{agent} {$t('· no longer observed')}</option>
            {/if}
          </select>
        </label>
        <label>
          {$t('Process')}
          <select
            aria-label={$t('Statistics process')}
            bind:value={localInstanceId}
            onchange={(event) =>
              changeScope?.({ agent: localAgent, instanceId: event.currentTarget.value })}
            disabled={sensorView || !agent}
          >
            <option value="">{$t('All processes')}</option>
            {#each members.filter((row) => row.instanceId) as row (row.instanceId)}
              <option value={row.instanceId}>
                {$t('PID')}
                {row.pid}{row.projectName ? ' · ' + row.projectName : ''}
              </option>
            {/each}
            {#if instanceId && !members.some((row) => row.instanceId === instanceId)}
              <option value={instanceId}>{$t('Selected process · no longer observed')}</option>
            {/if}
          </select>
        </label>
        <p class="scope-caption">
          {sensorView
            ? $t('AEGIS health · independent of agent selection')
            : agent
              ? $t('History starts with this selection.')
              : $t('Combined measurements of observed agents')}
        </p>
      </div>
    {/if}
    <div class="coverage-line">
      <strong>
        {sensorView
          ? $t('AEGIS main process') + ' · ' + $t(observationStatusLabel(health.state))
          : agent && !scoped.agents.length
            ? $t('Selection no longer observed · last measurements retained')
            : section === 'tokens'
              ? $t('Supported agent logs · measured coverage')
              : section === 'activity'
                ? $t('Observed connections and risk')
                : coverage + ' / ' + scoped.agents.length + ' process resource samples'}
      </strong>
      <span class="live-state">
        {paused
          ? $t('View paused · ')
          : telemetry.stale
            ? $t('Last observation · ')
            : ''}{samples.length}
        {$t('source updates · up to 5 minutes')}
      </span>
    </div>
  </aside>
</div>

<style>
  .statistics-workspace {
    min-width: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 200px;
    align-items: start;
    gap: var(--space-4);
  }
  .statistics-content {
    min-width: 0;
    container-type: inline-size;
  }
  .statistics-context {
    min-width: 0;
    position: sticky;
    top: var(--workspace-sticky-offset, 70px);
    display: grid;
    gap: var(--space-4);
    border: 1px solid var(--strong-border);
    border-radius: var(--surface-radius);
    background: var(--panel);
    padding: var(--space-3);
  }
  .statistics-scope {
    display: grid;
    gap: var(--space-3);
    border-top: 1px solid var(--border);
    padding-top: var(--space-3);
  }
  .statistics-scope label {
    display: grid;
    gap: 6px;
    min-width: 0;
    color: var(--muted);
    font-size: var(--text-caption);
  }
  .statistics-scope select {
    width: 100%;
    min-width: 0;
    min-height: 36px;
  }
  .scope-caption {
    margin: 0;
    color: var(--muted);
    font-size: var(--text-caption);
    line-height: 1.5;
  }
  .coverage-line {
    display: grid;
    gap: var(--space-2);
    border-top: 1px solid var(--border);
    padding-top: var(--space-3);
    color: var(--muted);
    font-size: var(--text-caption);
    line-height: 1.5;
  }
  .coverage-line strong {
    color: var(--ink);
    font-weight: 600;
  }
  .supporting-content,
  .statistics-processes {
    display: grid;
    gap: var(--space-4);
  }
  .supporting-content {
    margin-top: var(--space-4);
  }
  .statistics-processes[hidden] {
    display: none;
  }
  .process-table-content {
    padding: 0 var(--space-3) var(--space-3);
  }
  .scope-note {
    color: var(--muted);
    font-size: var(--text-caption);
    line-height: 1.7;
    margin: 12px 0 0;
  }
  @container (max-width: 720px) {
    .statistics-content :global(.monitor) {
      grid-template-columns: minmax(0, 1fr);
    }
    .statistics-content :global(.metric-rail) {
      flex-direction: row;
      overflow-x: auto;
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }
    .statistics-content :global(.metric-rail button) {
      flex: 0 0 142px;
      padding: 8px;
    }
    .statistics-content :global(.monitor-detail) {
      padding: var(--space-4);
    }
  }
  @media (max-width: 700px) {
    .statistics-workspace {
      grid-template-columns: minmax(0, 1fr);
    }
    .statistics-context {
      position: static;
      grid-row: 1;
    }
  }
</style>
