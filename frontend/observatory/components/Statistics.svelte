<script lang="ts">
  import { untrack } from 'svelte';
  import { instances, record, type Telemetry, type RecordData } from '../runtime/host';
  import { radarGroups, groupRecord, riskBand } from '../runtime/radar';
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
  import StatsDistribution from './StatsDistribution.svelte';
  import StatsSensors from './StatsSensors.svelte';
  import StatsRiskRadar from './StatsRiskRadar.svelte';
  import StatsTokens from './StatsTokens.svelte';
  import ResourceUsage from './ResourceUsage.svelte';
  import ActivityChart from './ActivityChart.svelte';
  import Agents from './Agents.svelte';
  let {
    telemetry,
    inspect,
    sectionRequest,
    paused = false,
  }: {
    telemetry: Telemetry;
    inspect: (_title: string, _row: RecordData) => void;
    sectionRequest?: { id: string; revision: number };
    paused?: boolean;
  } = $props();
  let section = $state<StatsSection>('overview');
  let selected = $state<Record<StatsSection, string>>({
    overview: 'cpu',
    processes: 'memory',
    activity: 'fileRate',
    tokens: 'tokens',
    sensors: 'ownCpu',
  });
  let history = createStatisticsHistory();
  let samples = $state<StatisticsSample[]>([]);
  let lastRequest = -1;
  let agents = $derived(instances(telemetry));
  let groups = $derived(radarGroups(agents));
  let metrics = $derived(statisticsMetrics.filter((metric) => metric.sections.includes(section)));
  let productRows = $derived(
    groups.map((group, i) => ({
      label: group.name,
      value: group.members.length,
      row: groupRecord(group),
      tone: ['var(--green)', 'var(--muted)', 'var(--amber)'][i % 3],
    })),
  );
  let riskRows = $derived(
    ['low', 'medium', 'high'].map((band, i) => ({
      label: band.charAt(0).toUpperCase() + band.slice(1) + ' risk',
      value: agents.filter((a) => riskBand(a.riskScore) === band).length,
      tone: ['var(--green)', 'var(--amber)', 'var(--red)'][i],
    })),
  );
  let endpointRows = $derived(
    ['allowlisted', 'unknown', 'flagged'].map((verdict, i) => ({
      label:
        verdict === 'unknown'
          ? 'Unverified endpoints'
          : verdict.charAt(0).toUpperCase() + verdict.slice(1),
      value: telemetry.network.filter((n) => (n.verdict || 'unknown') === verdict).length,
      tone: ['var(--green)', 'var(--muted)', 'var(--amber)'][i],
    })),
  );
  let coverage = $derived(
    telemetry.agents.filter(
      (agent) =>
        agent.instanceId &&
        telemetry.resources.some(
          (r) =>
            r.instanceId === agent.instanceId &&
            typeof r.cpu === 'number' &&
            typeof r.memMb === 'number',
        ),
    ).length,
  );
  let health = $derived(record(telemetry.stats.appHealth));
  $effect(() => {
    const current = telemetry;
    untrack(() => {
      const next = observeStatistics(history, current);
      if (next !== history) {
        history = next;
        samples = next.samples;
      }
    });
  });
  $effect(() => {
    const request = sectionRequest;
    if (request && request.revision !== lastRequest) {
      lastRequest = request.revision;
      if (statisticsTabs.some((tab) => tab.id === request.id)) section = request.id as StatsSection;
    }
  });
  function changeSection(id: string): void {
    section = id as StatsSection;
  }
</script>

<div class="statistics-workspace">
  <section class="statistics-heading" aria-label="Statistics coverage">
    <div>
      <h2>Performance & observation</h2>
      <p>A focused view of your agents, their activity and AEGIS itself.</p>
    </div>
    <div class="live-state">
      <span class:stale={telemetry.stale || paused}></span>{paused
        ? 'View paused'
        : telemetry.stale
          ? 'Last reliable data'
          : telemetry.ready
            ? 'Live observations'
            : 'Waiting for data'}
    </div>
  </section>
  <div class="stats-navigation">
    <SectionTabs
      tabs={statisticsTabs}
      selected={section}
      change={changeSection}
      prefix="statistics"
      label="Statistics sections"
    />
  </div>
  {#each statisticsTabs as tab (tab.id)}
    <div
      id={'statistics-panel-' + tab.id}
      role="tabpanel"
      aria-labelledby={'statistics-tab-' + tab.id}
      hidden={section !== tab.id}
    >
      {#if section === tab.id}
        <div class="coverage-line">
          <span
            >{section === 'sensors'
              ? 'AEGIS main process · ' + String(health.state || 'Starting').toLowerCase()
              : section === 'tokens'
                ? 'Supported agent logs · complete totals only'
                : section === 'activity'
                  ? 'Observed activity · counts and rates'
                  : 'Agent processes · ' +
                    coverage +
                    ' / ' +
                    telemetry.agents.length +
                    ' resource samples'}</span
          >
          <span>{samples.length} / 120 samples · this window</span>
        </div>
        <StatsChart
          {samples}
          {metrics}
          bind:selected={selected[section]}
          stale={telemetry.stale || paused}
        />
        <div class="supporting-content">
          {#if section === 'overview'}
            <div class="distribution-grid">
              <StatsDistribution
                title="Process composition"
                subtitle="Grouped by agent · open a group to inspect"
                rows={productRows}
                {inspect}
              />
              <StatsRiskRadar {groups} {inspect} paused={telemetry.stale || paused} />
            </div>
            <p class="scope-note">
              Select a monitor to focus its graph. Processes contains agent comparisons; Activity
              contains observation timelines; Sensors shows collection health. System-wide CPU, GPU,
              disk and bandwidth measurements are not provided by the current sensors.
            </p>
          {:else if section === 'processes'}
            <ResourceUsage {telemetry} {inspect} />
            <Agents {telemetry} {inspect} />
          {:else if section === 'activity'}
            <ActivityChart events={telemetry.events} observedAt={telemetry.lastScan} {inspect} />
            <div class="distribution-grid">
              <StatsDistribution
                title="Connection identity"
                subtitle="Latest delivered endpoint classifications"
                rows={endpointRows}
              />
              <StatsDistribution
                title="Risk distribution"
                subtitle="Current process assessments"
                rows={riskRows}
              />
            </div>
            <p class="scope-note">
              Connection counts use the latest delivered snapshot. Rate charts show observations
              arriving over time; they do not measure file bytes or network bandwidth.
            </p>
          {:else if section === 'tokens'}
            <StatsTokens {telemetry} {inspect} />
          {:else if section === 'sensors'}
            <StatsSensors {telemetry} />
            <p class="scope-note">
              History is retained while you use another workspace. Pausing the view freezes its
              displayed samples; the monitoring backend continues. Graph gaps preserve unavailable
              measurements and collection interruptions.
            </p>
          {/if}
        </div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .statistics-workspace {
    min-width: 0;
  }
  .statistics-heading {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    margin-bottom: 18px;
  }
  h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 550;
    letter-spacing: -0.4px;
  }
  .statistics-heading p {
    color: var(--muted);
    font-size: 12px;
    margin: 6px 0 0;
    line-height: 1.5;
  }
  .live-state {
    display: flex;
    gap: 7px;
    align-items: center;
    font-size: 11px;
    color: var(--muted);
  }
  .live-state > span {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--green);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--green) 12%, transparent);
  }
  .live-state > span.stale {
    background: var(--muted);
    box-shadow: none;
  }
  .stats-navigation {
    position: sticky;
    top: var(--workspace-sticky-offset, 0px);
    z-index: 4;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--panel);
    overflow: hidden;
    margin-bottom: 16px;
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
    margin-bottom: 10px;
    color: var(--muted);
    font-size: 10px;
  }
  .supporting-content {
    display: grid;
    gap: 18px;
    margin-top: 18px;
  }
  .distribution-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px;
  }
  .scope-note {
    color: var(--muted);
    font-size: 11px;
    line-height: 1.7;
    margin: 0;
    padding: 0 2px;
  }
  @media (max-width: 850px) {
    .distribution-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
