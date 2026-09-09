<script lang="ts">
  import { instances, record, type Telemetry, type RecordData } from '../runtime/host';
  import { radarGroups } from '../runtime/radar';
  import Icon from './Icon.svelte';
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
    telemetry.events
      .filter((e) => !!row.instanceId && e.instanceId === row.instanceId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 30),
  );
  let siblings = $derived(
    row.agentGroupKey
      ? (radarGroups(instances(telemetry)).find((g) => g.key === row.agentGroupKey)?.members ?? [])
      : instances(telemetry).filter((a) => row.process && a.name === String(row.name ?? row.agent)),
  );
  let path = $derived(
    typeof row.file === 'string' ? row.file : typeof row.cwd === 'string' ? row.cwd : '',
  );
  let parent = $derived(
    path.replaceAll('\\', '/').replace(/\/$/, '').split('/').slice(0, -1).join('/'),
  );
</script>

{#if row.process || row.agentGroupKey}
  <h3>
    {row.agentGroupKey ? 'Processes' : 'Process instances'}
    <span class="muted">{siblings.length}</span>
  </h3>
  {#each siblings as a (a.instanceId ?? a)}<div class="process-row">
      <div>
        <button
          class="entity-link"
          onclick={() => navigate(a.name + ' · PID ' + a.pid, a as unknown as RecordData)}
          ><Icon name="cpu" />PID {a.pid}</button
        ><small>{a.process}</small>{#if a.cwd}<small class="process-project" title={a.cwd}
            >{a.cwd}</small
          >{/if}
      </div>
      <button
        class="text-button"
        onclick={() => navigate(a.name + ' · PID ' + a.pid, a as unknown as RecordData)}
        >Open<Icon name="chevron" /></button
      >
    </div>{/each}
{/if}
{#if row.process}
  <h3 class="section-title">Recent events</h3>
  {#each related.slice(0, 4) as e (e)}<button
      class="recent-event"
      onclick={() => navigate('File observation', e as unknown as RecordData)}
      ><Icon name="file" />
      <div>
        <strong>{e.file.split(/[/\\]/).pop()}</strong><small
          >{new Date(e.timestamp).toLocaleTimeString()} · {e.action}</small
        >
      </div></button
    >{:else}<p class="entity-note">No retained file observations for this instance.</p>{/each}
  {#if related.length > 4}<button
      class="text-button"
      onclick={() => navigate('Recent file observations', { observations: related })}
      >View all {related.length} retained events<Icon name="chevron" /></button
    >{/if}
{/if}
{#if parent && parent !== path}<div class="entity-parent">
    <button
      class="entity-link"
      onclick={() => navigate('Parent folder', { cwd: parent, source: 'Parent of observed path' })}
      ><Icon name="folder" />Parent folder · {parent}</button
    >
  </div>{/if}
{#if (row.file || row.remoteIp) && row.instanceId}{@const agent = instances(telemetry).find(
    (a) => a.instanceId === row.instanceId,
  )}{#if agent}<button
      class="entity-link"
      onclick={() => navigate(agent.name, agent as unknown as RecordData)}
      ><Icon name="cpu" />Open exact agent instance</button
    >{/if}{/if}
{#if Array.isArray(row.observations)}<div class="interval-events">
    {#each row.observations as value, i (i)}{@const e = record(value)}<button
        class="recent-event interval-event"
        onclick={() => navigate('File observation', e)}
        ><time>{e.timestamp ? new Date(Number(e.timestamp)).toLocaleTimeString() : '—'}</time>
        <div>
          <strong>{String(e.file ?? e.domain ?? 'Observation')}</strong><small
            >{String(e.agent ?? 'Unattributed')}</small
          >
        </div></button
      >{:else}<p class="entity-note">No events recorded during this interval.</p>{/each}
  </div>{/if}

<style>
  .section-title {
    margin-top: 24px;
  }
  .process-row small {
    display: block;
    color: var(--muted);
  }
  .process-row > div {
    min-width: 0;
  }
  .process-project {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 220px;
  }
  .entity-parent {
    margin-top: 16px;
  }
  .entity-link {
    overflow-wrap: anywhere;
    text-align: left;
  }
</style>
