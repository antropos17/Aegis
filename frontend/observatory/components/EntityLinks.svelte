<script lang="ts">
  import { record, type Telemetry, type RecordData } from '../runtime/host';
  let {
    row,
    telemetry,
    navigate,
  }: {
    row: RecordData;
    telemetry: Telemetry;
    navigate: (title: string, row: RecordData) => Promise<void>;
  } = $props();
  let related = $derived(
    telemetry.events.filter((e) => row.instanceId && e.instanceId === row.instanceId).slice(-30),
  );
  let siblings = $derived(
    telemetry.agents.filter(
      (agent) =>
        agent.applicationGroup && agent.applicationGroup.id === record(row.applicationGroup).id,
    ),
  );
  let path = $derived(
    typeof row.file === 'string' ? row.file : typeof row.cwd === 'string' ? row.cwd : '',
  );
  let parent = $derived(
    path.replaceAll('\\', '/').replace(/\/$/, '').split('/').slice(0, -1).join('/'),
  );
</script>

{#if parent && parent !== path}<button
    class="text-link"
    onclick={() => navigate('Parent folder', { cwd: parent, source: 'Parent of observed path' })}
    >Parent folder · {parent}</button
  >{/if}
{#if row.process && row.instanceId}
  {#if siblings.length > 1}<h3>Observed process group</h3>
    {#each siblings as agent (agent.instanceId)}<button
        class="related"
        onclick={() =>
          navigate(`${agent.agent} · PID ${agent.pid}`, agent as unknown as RecordData)}
        >{agent.agent} · PID {agent.pid} · {agent.instanceId}</button
      >{/each}{/if}
  <h3>Related file observations · latest 30</h3>
  {#each related as event (event)}<button
      class="related"
      onclick={() => navigate('File observation', event as unknown as RecordData)}
      >{event.action} · {event.file}</button
    >{:else}<p class="muted">No retained file observations for this instance.</p>{/each}
{/if}
{#if row.file && row.instanceId}{@const agent = telemetry.agents.find(
    (a) => a.instanceId === row.instanceId,
  )}{#if agent}<button
      class="text-link"
      onclick={() => navigate(agent.agent, agent as unknown as RecordData)}
      >Open exact agent instance</button
    >{/if}{/if}
{#if Array.isArray(row.observations)}<h3>Interval observations</h3>
  {#each row.observations as observation, index (index)}{@const event = record(observation)}<button
      class="related"
      onclick={() => navigate('File observation', event)}
      >{String(event.agent || 'Unattributed')} · {String(event.file ?? '')}</button
    >{/each}{/if}

<style>
  h3 {
    margin: 16px 0 8px;
  }
  .related {
    display: block;
    width: 100%;
    text-align: left;
    padding: 8px;
    border: 1px solid var(--border);
    background: var(--panel);
    color: var(--ink);
    overflow-wrap: anywhere;
  }
  .related:hover {
    background: var(--hover);
  }
</style>
