<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { Telemetry } from '../runtime/host';
  import type { AgentScope } from '../runtime/agent-scope';
  import { scopeStatistics } from '../runtime/statistics-scope';
  import {
    createStatisticsHistory,
    observeStatistics,
    type StatisticsSample,
  } from '../runtime/statistics-history';
  import { statisticsMetrics } from '../runtime/statistics-metrics';
  import StatsChart from './StatsChart.svelte';
  let {
    telemetry,
    scope,
    paused = false,
  }: { telemetry: Telemetry; scope: AgentScope; paused?: boolean } = $props();
  let history = createStatisticsHistory();
  let samples = $state<StatisticsSample[]>([]);
  let key = '';
  let selected = $state('cpu');
  let now = $state(Date.now());
  let scoped = $derived(scopeStatistics(telemetry, scope));
  const metrics = statisticsMetrics.filter((metric) =>
    ['cpu', 'memory', 'tokens'].includes(metric.id),
  );
  $effect(() => {
    const nextKey = JSON.stringify(scope);
    const state = paused ? { ...scoped, stale: true } : scoped;
    const at = paused ? Date.now() : undefined;
    untrack(() => {
      if (key !== nextKey) {
        key = nextKey;
        history = createStatisticsHistory();
      }
      history = observeStatistics(history, state, at);
      samples = history.samples;
    });
  });
  onMount(() => {
    const timer = setInterval(() => {
      if (!paused && !scoped.stale) now = Date.now();
    }, 1000);
    return () => clearInterval(timer);
  });
</script>

<div class="agent-performance">
  <StatsChart {samples} {metrics} {now} {paused} bind:selected stale={scoped.stale || paused} />
  <p>History starts with this selection. A gap means the source has not supplied a measurement.</p>
</div>

<style>
  .agent-performance {
    min-width: 0;
  }
  p {
    color: var(--muted);
    font-size: calc(11px * var(--ui-scale));
    margin: 8px 0 0;
    line-height: 1.45;
  }
</style>
