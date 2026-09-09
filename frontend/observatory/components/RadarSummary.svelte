<script lang="ts">
  import type { RecordData, Telemetry } from '../runtime/host';
  import {
    groupActivity,
    groupResource,
    groupRecord,
    displayMeasure,
    type RadarGroup,
  } from '../runtime/radar';
  import AgentLogo from './AgentLogo.svelte';
  import Icon from './Icon.svelte';
  let {
    group,
    telemetry,
    end,
    maximum,
    selected,
    select,
    inspect,
  }: {
    group: RadarGroup;
    telemetry: Telemetry;
    end: number;
    maximum: number;
    selected: string | null;
    select: (g: RadarGroup) => void;
    inspect: (title: string, row: RecordData) => void;
  } = $props();
  let bins = $derived(groupActivity(group, telemetry, end));
  let chosen = $derived(group.members.find((a) => a.instanceId === selected));
</script>

<section class="radar-agent-card">
  <button
    class="radar-agent-title"
    aria-pressed={!!chosen}
    title={`Select ${group.name}`}
    onclick={() => select(group)}
  >
    <AgentLogo id={group.key} name={group.name} size={20} /><span>{group.name}</span><span
      class="risk-value">{group.risk}<small>/100</small></span
    >
  </button>
  <div class="radar-agent-metrics">
    <span>CPU <b>{displayMeasure(groupResource(group, telemetry, 'cpu'), '%')}</b></span><span
      >RAM <b>{displayMeasure(groupResource(group, telemetry, 'memMb'), ' MB')}</b></span
    >
  </div>
  <button
    class="radar-mini-chart"
    aria-label={`Recent activity for ${group.name}`}
    onclick={() =>
      inspect(group.name + ' activity', {
        observations: bins.flatMap((b) => b.events),
        from: new Date(end - 300000).toISOString(),
        to: new Date(end).toISOString(),
      })}
  >
    <svg viewBox="0 0 120 24" preserveAspectRatio="none" aria-hidden="true"
      >{#each bins as bin, i (i)}<rect
          x={i * 12}
          y="0"
          width="8"
          height="24"
          rx="1"
          style={`transform:scaleY(${bin.events.length / maximum})`}
        />{/each}</svg
    >
    <span
      ><span>{bins.reduce((sum, b) => sum + b.events.length, 0)} events · 5 min</span><Icon
        name="chevron"
      /></span
    >
  </button>
  <div class="radar-agent-foot">
    <button class="entity-link" onclick={() => inspect(group.name, groupRecord(group))}
      ><Icon name="cpu" />{group.members.length}
      {group.members.length === 1 ? 'process' : 'processes'}<Icon name="chevron" /></button
    >
  </div>
</section>
