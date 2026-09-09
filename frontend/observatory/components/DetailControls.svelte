<script lang="ts">
  import {
    actionTarget,
    confirmed,
    invoke,
    records,
    type Host,
    type RecordData,
    type Telemetry,
  } from '../runtime/host';
  import Action from './Action.svelte';
  let { row, host, telemetry }: { row: RecordData; host: Host | null; telemetry: Telemetry } =
    $props();
  let stopId = $state<string | null>(null);
  let watch = $state<RecordData[]>([]);
  let watchLoaded = $state(false);
  let canControl = $derived.by(() => {
    if (!row.process || typeof row.instanceId !== 'string') return false;
    try {
      actionTarget(telemetry, row.instanceId);
      return true;
    } catch {
      return false;
    }
  });
  async function processAction(method: string, id: string) {
    const live = actionTarget(telemetry, id);
    confirmed(await invoke(host, method, { pid: live.pid, instanceId: live.instanceId }));
    stopId = null;
  }
  async function loadWatch() {
    watch = records(await invoke(host, 'blocklistList'));
    watchLoaded = true;
  }
</script>

<section class="detail-section">
  <div class="section-heading">
    <h3>Process controls</h3>
    <span class="badge">PID {String(row.pid ?? 'Unavailable')}</span>
  </div>
  <p class="entity-note">
    {canControl
      ? 'Actions apply to this process identity.'
      : 'Controls are unavailable until this identity is observed again.'}
  </p>
  <div class="control-grid">
    <Action
      disabled={!canControl}
      action={() => processAction('suspendProcess', String(row.instanceId))}>Suspend</Action
    >
    <Action
      disabled={!canControl}
      action={() => processAction('resumeProcess', String(row.instanceId))}>Resume</Action
    >
    <button
      class="button danger"
      disabled={!canControl}
      onclick={() => (stopId = String(row.instanceId))}>Stop…</button
    >
  </div>
  {#if stopId}<div class="confirm-stop" role="alert">
      <h3>Stop this process?</h3>
      <p>Unsaved work may be lost. The process identity is checked again before stopping.</p>
      <div class="toolbar">
        <Action action={() => processAction('killProcess', stopId!)}>Confirm stop</Action>
        <button class="button" onclick={() => (stopId = null)}>Cancel</button>
      </div>
    </div>{/if}
</section>
<section class="detail-section">
  <h3>Alert watchlist</h3>
  <p class="entity-note">Watchlist entries raise alerts; they do not block execution.</p>
  <div class="toolbar">
    <Action
      action={async () => {
        confirmed(
          await invoke(host, 'blocklistAdd', {
            signature: row.agent ?? row.name,
            reason: 'Added from instance details',
          }),
        );
        await loadWatch();
      }}>Watch agent</Action
    >
    <Action action={loadWatch}>Refresh watchlist</Action>
  </div>
  {#each watch as entry (entry)}<div class="watch-entry">
      <div>
        <strong>{String(entry.signature)}</strong><small
          >{entry.pid ? 'PID ' + entry.pid : 'All instances'}</small
        >
      </div>
      <Action
        action={async () => {
          confirmed(
            await invoke(host, 'blocklistRemove', { signature: entry.signature, pid: entry.pid }),
          );
          await loadWatch();
        }}>Remove</Action
      >
    </div>{:else}{#if watchLoaded}<p class="entity-note">The watchlist is empty.</p>{/if}{/each}
</section>
