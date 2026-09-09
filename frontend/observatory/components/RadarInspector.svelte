<script lang="ts">
  import { record, type Telemetry, type RecordData } from '../runtime/host';
  import {
    groupResource,
    groupRecord,
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
  let processOptions = $state(false);
  let previousGroup: string | undefined;
  $effect(() => {
    if (group?.key !== previousGroup) {
      previousGroup = group?.key;
      processOptions = false;
    }
  });
  let ids = $derived(new Set(group?.members.map((a) => a.instanceId).filter(Boolean)));
  let events = $derived(telemetry.events.filter((e) => e.instanceId && ids.has(e.instanceId)));
  let latest = $derived([...events].sort((a, b) => b.timestamp - a.timestamp)[0]);
  function openGroup() {
    if (group) inspect(group.name, groupRecord(group));
  }
  function openProcess() {
    if (chosen) inspect(chosen.name, chosen as unknown as RecordData);
  }
</script>

<aside class="panel inspector" id="inspector">
  <div class="inspector-title">
    <h2><Icon name="agents" />Agent details</h2>
    <span class="detail-status"
      >{group ? (telemetry.stale ? 'Last snapshot' : 'Selected') : 'No selection'}</span
    >
  </div>
  {#if group}
    <div class="agent-identity">
      <AgentLogo id={group.key} name={group.name} size={32} />
      <div>
        <button class="entity-link" onclick={openGroup}>{group.name}</button><small
          >{group.members.length}
          {group.members.length === 1 ? 'process' : 'processes'} combined</small
        >
      </div>
    </div>
    <section class="inspector-block" aria-label="Agent risk">
      <div class="inspector-risk">
        <div>
          <span>Highest process risk</span><span class={`badge ${riskBand(group.risk)}`}
            >{riskBand(group.risk)}</span
          >
        </div>
        <span class={`risk-value ${riskBand(group.risk)}`}>{group.risk}<small>/100</small></span>
      </div>
      <div class="risk-track">
        <i
          style={`transform:scaleX(${group.risk / 100});background:var(--${group.risk < 35 ? 'green' : group.risk < 66 ? 'amber' : 'red'})`}
        ></i>
      </div>
    </section>
    <section class="inspector-block" aria-label="Combined agent usage">
      <h3>Combined usage</h3>
      <div class="inspector-metrics">
        <div>
          <strong>{displayMeasure(groupResource(group, telemetry, 'cpu'), '%')}</strong><span
            >CPU</span
          >
        </div>
        <div>
          <strong>{displayMeasure(groupResource(group, telemetry, 'memMb'))}</strong><span
            >RAM, MB</span
          >
        </div>
        <div><strong>{events.length}</strong><span>events</span></div>
      </div>
    </section>
    <section class="inspector-block" aria-label="Recent agent activity">
      <h3>Latest activity</h3>
      {#if latest}<div class="finding" class:ordinary={!latest.sensitive}>
          <div>
            <Icon name="file" /><span>{latest.sensitive ? 'Needs review' : 'File event'}</span><time
              >{new Date(latest.timestamp).toLocaleTimeString()}</time
            >
          </div>
          <button
            class="entity-link"
            onclick={() => inspect('File observation', latest as unknown as RecordData)}
            >{latest.file.split(/[/\\]/).pop()}</button
          >
          <p>{latest.action ?? 'File change observed.'}</p>
          {#if record(latest.attribution).status !== 'confirmed'}<small>Indirect attribution</small
            >{/if}
        </div>{:else}<p class="entity-note">No retained file events for this agent.</p>{/if}
    </section>
    <button class="button inspector-open" onclick={openGroup}
      >Open agent<Icon name="chevron" /></button
    >
    <details class="process-options" bind:open={processOptions}>
      <summary>Individual processes <span>{group.members.length}</span></summary>
      <label class="instance-picker"
        ><span>Choose a process</span><select aria-label="Selected process" bind:value={selected}>
          {#each group.members.filter((a) => a.instanceId) as a (a.instanceId)}<option
              value={a.instanceId}
              >PID {a.pid}{a.projectName ? ' · ' + a.projectName : ''} · risk {a.riskScore}</option
            >{/each}
        </select></label
      >
      <button class="button" onclick={openProcess} disabled={!chosen}>Process</button>
    </details>
  {:else}
    <div class="radar-no-selection">
      <Icon name="radar" />
      <h3>Choose an agent</h3>
      <p>Select a marker or a row in the agent list. Its risk, usage and activity appear here.</p>
    </div>
  {/if}
</aside>
