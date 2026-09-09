<script lang="ts">
  import { measured, record, type Telemetry, type RecordData } from '../runtime/host';
  import {
    displayMeasure,
    riskBand,
    type RadarGroup,
    type ObservedInstance,
  } from '../runtime/radar';
  import AgentLogo from './AgentLogo.svelte';
  import Icon from './Icon.svelte';
  let {
    chosen,
    group,
    telemetry,
    selected = $bindable(null),
    inspect,
  }: {
    chosen: ObservedInstance | undefined;
    group: RadarGroup | undefined;
    telemetry: Telemetry;
    selected: string | null;
    inspect: (title: string, row: RecordData) => void;
  } = $props();
  let events = $derived(
    chosen?.instanceId ? telemetry.events.filter((e) => e.instanceId === chosen.instanceId) : [],
  );
  let latest = $derived([...events].sort((a, b) => b.timestamp - a.timestamp)[0]);
  function resource(key: string) {
    return telemetry.stale || !chosen?.instanceId
      ? null
      : measured(telemetry.resources.find((r) => r.instanceId === chosen?.instanceId)?.[key]);
  }
  function open() {
    if (chosen) inspect(chosen.name, chosen as unknown as RecordData);
  }
</script>

<aside class="panel inspector" id="inspector">
  <div class="inspector-title">
    <span>Selected instance</span>{#if chosen}<button
        aria-label="Open selected instance"
        onclick={open}><Icon name="chevron" /></button
      >{/if}
  </div>
  {#if chosen}
    <div class="agent-identity">
      <AgentLogo id={chosen.agent} name={chosen.name} size={32} />
      <div>
        <button class="entity-link" onclick={open}>{chosen.name}</button><small class="mono"
          >PID {chosen.pid}</small
        >
      </div>
    </div>
    {#if group && group.members.length > 1}<label class="instance-picker"
        ><span>Process · {group.members.length} observed</span><select
          aria-label="Selected process"
          bind:value={selected}
          >{#each group.members.filter((a) => a.instanceId) as a (a.instanceId)}<option
              value={a.instanceId}
              >PID {a.pid} · {a.projectName ?? a.process} · risk {a.riskScore}</option
            >{/each}</select
        ></label
      >{/if}
    <div class="inspector-risk">
      <div>
        <span>Risk</span><span class={`badge ${riskBand(chosen.riskScore)}`}
          >{riskBand(chosen.riskScore)}</span
        >
      </div>
      <span class={`risk-value ${riskBand(chosen.riskScore)}`}
        >{chosen.riskScore}<small>/100</small></span
      >
    </div>
    <div class="risk-track">
      <i
        style={`transform:scaleX(${chosen.riskScore / 100});background:var(--${chosen.riskScore < 35 ? 'green' : chosen.riskScore < 66 ? 'amber' : 'red'})`}
      ></i>
    </div>
    <div class="inspector-metrics">
      <div><strong>{displayMeasure(resource('cpu'), '%')}</strong><span>CPU</span></div>
      <div><strong>{displayMeasure(resource('memMb'))}</strong><span>RAM, MB</span></div>
      <div><strong>{events.length}</strong><span>events</span></div>
    </div>
    {#if latest}<div class="finding" class:ordinary={!latest.sensitive}>
        <div>
          <Icon name="file" /><span>{latest.sensitive ? 'Needs review' : 'Latest action'}</span
          ><time>{new Date(latest.timestamp).toLocaleTimeString()}</time>
        </div>
        <button
          class="entity-link"
          onclick={() => inspect('File observation', latest as unknown as RecordData)}
          >{latest.file.split(/[/\\]/).pop()}</button
        >
        <p>{latest.action ?? 'File change observed.'}</p>
      </div>
      <div class="attribution-line">
        <Icon name="link" /><span
          >{record(latest.attribution).status === 'confirmed'
            ? 'Process instance confirmed.'
            : 'Indirect attribution. A specific process action is unconfirmed.'}</span
        >
      </div>{:else}<p class="entity-note">No retained file observations for this instance.</p>{/if}
    <div class="toolbar">
      {#if latest}<button
          class="button"
          onclick={() => inspect('File observation', latest as unknown as RecordData)}
          >Review</button
        >{/if}<button class="button" onclick={open}>Process</button>
    </div>
    <div class="inspector-secondary"><span>Behaviour anomaly: {chosen.anomalyScore}/100</span></div>
    <p class="entity-note">{chosen.projectName ?? chosen.cwd ?? 'Working directory unavailable'}</p>
  {:else}
    <div class="radar-no-selection">
      <Icon name="radar" />
      <h3>No agent selected</h3>
      <p>Select a marker or an agent card to inspect its process.</p>
    </div>
    <div class="inspector-metrics">
      <div>
        <strong>{telemetry.ready ? telemetry.agents.length : '—'}</strong><span
          >active processes</span
        >
      </div>
      <div><strong>{telemetry.network.length}</strong><span>connections</span></div>
    </div>
    <p class="entity-note">Click empty radar space or press Escape to clear a selection.</p>
  {/if}
</aside>

<style>
  .instance-picker {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: calc(11px * var(--ui-scale));
    margin-bottom: 12px;
  }
  .instance-picker select {
    width: 100%;
    padding: 6px;
  }
  .badge {
    text-transform: capitalize;
  }
</style>
