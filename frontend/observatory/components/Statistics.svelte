<script lang="ts">
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
  import SectionTabs from './SectionTabs.svelte';
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
  let processView = $state('comparison');
  const processViews = [
    { id: 'comparison', label: 'Comparison' },
    { id: 'table', label: 'Table' },
  ];
  let allHistory = createStatisticsHistory();
  let scopedHistory = createStatisticsHistory();
  let allSamples = $state<StatisticsSample[]>([]);
  let scopedSamples = $state<StatisticsSample[]>([]);
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
  {#if !scope}<div class="statistics-scope">
      <label
        >Agent
        <select
          aria-label="Statistics agent"
          bind:value={localAgent}
          disabled={sensorView}
          onchange={(event) => {
            localInstanceId = '';
            changeScope?.({ agent: event.currentTarget.value, instanceId: '' });
          }}
        >
          <option value="">All agents</option>
          {#each groups as group (group.key)}<option value={group.key}>{group.name}</option>{/each}
          {#if agent && !groups.some((group) => group.key === agent)}
            <option value={agent}>{agent} · no longer observed</option>
          {/if}
        </select>
      </label>
      <label
        >Process
        <select
          aria-label="Statistics process"
          bind:value={localInstanceId}
          onchange={(event) =>
            changeScope?.({ agent: localAgent, instanceId: event.currentTarget.value })}
          disabled={sensorView || !agent}
        >
          <option value="">All processes</option>
          {#each members.filter((row) => row.instanceId) as row (row.instanceId)}
            <option value={row.instanceId}
              >PID {row.pid}{row.projectName ? ' · ' + row.projectName : ''}</option
            >
          {/each}
          {#if instanceId && !members.some((row) => row.instanceId === instanceId)}
            <option value={instanceId}>Selected process · no longer observed</option>
          {/if}
        </select>
      </label>
      <span class="scope-caption"
        >{sensorView
          ? 'AEGIS health · independent of agent selection'
          : agent
            ? 'History starts with this selection.'
            : 'Combined measurements of observed agents'}</span
      >
    </div>{/if}
  <div class="stats-navigation">
    <SectionTabs
      tabs={statisticsTabs}
      selected={section}
      change={(id) => {
        section = id as StatsSection;
      }}
      prefix="statistics"
      label="Statistics sections"
    />
  </div>
  <div class="coverage-line">
    <span
      >{sensorView
        ? 'AEGIS main process · ' + String(health.state || 'Starting').toLowerCase()
        : agent && !scoped.agents.length
          ? 'Selection no longer observed · last measurements retained'
          : section === 'tokens'
            ? 'Supported agent logs · measured coverage'
            : section === 'activity'
              ? 'Observed connections and risk'
              : coverage + ' / ' + scoped.agents.length + ' process resource samples'}</span
    >
    <span class="live-state"
      >{paused ? 'View paused · ' : telemetry.stale ? 'Last observation · ' : ''}{samples.length} source
      updates · up to 5 minutes</span
    >
  </div>
  {#each statisticsTabs as tab (tab.id)}
    <div
      id={'statistics-panel-' + tab.id}
      role="tabpanel"
      aria-labelledby={'statistics-tab-' + tab.id}
      hidden={section !== tab.id}
    >
      {#if section === tab.id}
        {#if section !== 'processes'}
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
        {/if}
        {#if section === 'processes'}
          <div class="process-view-selector">
            <SectionTabs
              tabs={processViews}
              selected={processView}
              change={(id) => {
                processView = id;
              }}
              prefix="statistics-process"
              label="Process comparison view"
            />
          </div>
          <div
            role="tabpanel"
            id="statistics-process-panel-comparison"
            aria-labelledby="statistics-process-tab-comparison"
            hidden={processView !== 'comparison'}
          >
            <ResourceUsage telemetry={scoped} {inspect} />
          </div>
          <div
            role="tabpanel"
            id="statistics-process-panel-table"
            aria-labelledby="statistics-process-tab-table"
            hidden={processView !== 'table'}
          >
            <Agents telemetry={scoped} {inspect} />
          </div>
        {:else if section === 'activity'}
          <p class="scope-note">
            {agent
              ? 'Only connections with an exact selected process identity are included. Per-agent cumulative file counters are unavailable, so file rates are not shown.'
              : 'Connections are counts, not bandwidth. File rates use delivered global counters.'}
          </p>
        {:else if section === 'tokens'}
          <div class="supporting-content"><StatsTokens telemetry={scoped} {inspect} /></div>
        {:else if section === 'sensors'}
          <div class="supporting-content"><StatsSensors {telemetry} /></div>
        {/if}
      {/if}
    </div>
  {/each}
</div>

<style>
  .statistics-workspace {
    min-width: 0;
  }
  .statistics-scope {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 12px;
    margin-bottom: 12px;
  }
  .statistics-scope label {
    display: grid;
    gap: 6px;
    min-width: 0;
    flex: 1 1 160px;
    color: var(--muted);
    font-size: 11px;
  }
  .statistics-scope select {
    width: 100%;
    min-width: 0;
    min-height: 36px;
  }
  .scope-caption {
    flex: 1 1 180px;
    min-height: 32px;
    color: var(--muted);
    font-size: 11px;
    line-height: 1.5;
  }
  .stats-navigation {
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--panel);
    overflow: hidden;
    margin-bottom: 12px;
  }
  .stats-navigation :global(.section-tabs) {
    border: 0;
    padding: 0 10px;
  }
  .coverage-line {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px;
    min-height: 16px;
    margin-bottom: 10px;
    color: var(--muted);
    font-size: 10px;
  }
  .supporting-content {
    margin-top: 18px;
  }
  .process-view-selector {
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--panel);
    overflow: hidden;
    margin-bottom: 12px;
  }
  .process-view-selector :global(.section-tabs) {
    border: 0;
  }
  .scope-note {
    color: var(--muted);
    font-size: 11px;
    line-height: 1.7;
    margin: 12px 0 0;
  }
</style>
