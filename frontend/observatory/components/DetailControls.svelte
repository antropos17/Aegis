<script lang="ts">
  import {
    actionTarget,
    confirmed,
    invoke,
    type Host,
    type RecordData,
    type Telemetry,
  } from '../runtime/host';
  import Action from './Action.svelte';
  import Watchlist from './Watchlist.svelte';
  let { row, host, telemetry }: { row: RecordData; host: Host | null; telemetry: Telemetry } =
    $props();
  let stopId = $state<string | null>(null);
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
{#key row.agent ?? row.name}<Watchlist {host} agent={String(row.agent ?? row.name ?? '')} />{/key}
