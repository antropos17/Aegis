<script lang="ts">
  import { t } from '../runtime/i18n';

  import {
    actionTarget,
    confirmed,
    invoke,
    type Host,
    type RecordData,
    type Telemetry,
  } from '../runtime/host';
  import Action from './Action.svelte';
  import Icon from './Icon.svelte';
  import Watchlist from './Watchlist.svelte';
  let { row, host, telemetry }: { row: RecordData; host: Host | null; telemetry: Telemetry } =
    $props();
  type StopTarget = {
    id: string;
    generationWitness: string;
    generationWitnessSource: string;
  };
  let stopTarget = $state<StopTarget | null>(null);
  let canControl = $derived.by(() => {
    if (!row.process || typeof row.instanceId !== 'string') return false;
    try {
      actionTarget(telemetry, row.instanceId);
      return true;
    } catch {
      return false;
    }
  });
  function prepareStop(id: string) {
    try {
      const live = actionTarget(telemetry, id);
      stopTarget = {
        id,
        generationWitness: live.generationWitness,
        generationWitnessSource: live.generationWitnessSource,
      };
    } catch {
      stopTarget = null;
    }
  }
  async function processAction(method: string, id: string, selected?: StopTarget) {
    const live = actionTarget(telemetry, id);
    if (
      selected &&
      (live.generationWitness !== selected.generationWitness ||
        live.generationWitnessSource !== selected.generationWitnessSource)
    ) {
      throw new Error(
        'This process instance is no longer reliably observed. Wait for a fresh scan.',
      );
    }
    confirmed(
      await invoke(host, method, {
        pid: live.pid,
        instanceId: live.instanceId,
        generationWitness: live.generationWitness,
        generationWitnessSource: live.generationWitnessSource,
      }),
    );
    stopTarget = null;
  }
</script>

<section class="detail-section">
  <div class="section-heading">
    <h3 class="controls-heading"><Icon name="cpu" />{$t('Process controls')}</h3>
    <span class="badge">{$t('PID')} {String(row.pid ?? 'Unavailable')}</span>
  </div>
  <p class="entity-note">
    {canControl
      ? $t('Actions apply to this process identity.')
      : $t('Controls are unavailable until this identity is observed again.')}
  </p>
  <div class="control-grid">
    <Action
      disabled={!canControl}
      action={() => processAction('suspendProcess', String(row.instanceId))}
      ><Icon name="pause" />{$t('Suspend')}</Action
    >
    <Action
      disabled={!canControl}
      action={() => processAction('resumeProcess', String(row.instanceId))}
      ><Icon name="play" />{$t('Resume')}</Action
    >
    <button
      class="button danger"
      disabled={!canControl}
      onclick={() => prepareStop(String(row.instanceId))}><Icon name="stop" />{$t('Stop…')}</button
    >
  </div>
  {#if stopTarget}<div class="confirm-stop" role="alert">
      <h3>{$t('Stop this process?')}</h3>
      <p>
        {$t('Unsaved work may be lost. The process identity is checked again before stopping.')}
      </p>
      <div class="toolbar">
        <Action action={() => processAction('killProcess', stopTarget!.id, stopTarget!)}
          ><Icon name="stop" />{$t('Confirm stop')}</Action
        >
        <button class="button" onclick={() => (stopTarget = null)}>{$t('Cancel')}</button>
      </div>
    </div>{/if}
</section>
{#key row.agent ?? row.name}<Watchlist {host} agent={String(row.agent ?? row.name ?? '')} />{/key}

<style>
  .control-grid {
    align-items: start;
  }
  .controls-heading {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
</style>
