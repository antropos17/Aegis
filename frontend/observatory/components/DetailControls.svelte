<script lang="ts">
  import { t } from '../runtime/i18n';
  import { tick } from 'svelte';

  import {
    actionTarget,
    confirmed,
    invoke,
    type Host,
    type RecordData,
    type Telemetry,
  } from '../runtime/host';
  import Icon from './Icon.svelte';
  import Watchlist from './Watchlist.svelte';
  let {
    row,
    host,
    telemetry,
    simple = false,
    compact = false,
  }: {
    row: RecordData;
    host: Host | null;
    telemetry: Telemetry;
    simple?: boolean;
    compact?: boolean;
  } = $props();
  type StopTarget = {
    id: string;
    generationWitness: string;
    generationWitnessSource: string;
  };
  let stopTarget = $state<StopTarget | null>(null);
  type ControlMethod = 'suspendProcess' | 'resumeProcess' | 'killProcess';
  type Feedback = {
    method: ControlMethod;
    state: 'pending' | 'success' | 'error';
    target?: StopTarget;
    text?: string;
  };
  let feedback = $state<Feedback | null>(null);
  let stopButton = $state<HTMLButtonElement>();
  let confirmation = $state<HTMLDivElement>();
  let suspendResultNode = $state<HTMLDivElement>();
  let resumeResultNode = $state<HTMLDivElement>();
  let stopResultNode = $state<HTMLDivElement>();
  let selectionVersion = 0;
  let requestVersion = 0;
  let selectionKey = '';
  const feedbackId = $props.id();
  $effect(() => {
    // A reply from a previous selection must not reappear after switching back.
    const nextKey = JSON.stringify([
      row.instanceId,
      row.generationWitness,
      row.generationWitnessSource,
    ]);
    if (nextKey === selectionKey) return;
    selectionKey = nextKey;
    selectionVersion += 1;
    requestVersion += 1;
    stopTarget = null;
    feedback = null;
  });
  let pending = $derived(feedback?.state === 'pending');
  let feedbackText = $derived.by(() => {
    if (!feedback) return '';
    if (feedback.state === 'pending') return $t('Working…');
    if (feedback.state === 'error') return feedback.text ?? '';
    return $t(
      feedback.method === 'killProcess'
        ? 'The stop request reported success. Its lasting effect was not verified.'
        : feedback.method === 'suspendProcess'
          ? 'The pause request reported success. Its lasting effect was not verified.'
          : 'The resume request reported success. Its lasting effect was not verified.',
    );
  });
  function matchesSelection(target: StopTarget) {
    if (row.instanceId !== target.id) return false;
    if (
      ('generationWitness' in row || 'generationWitnessSource' in row) &&
      (row.generationWitness !== target.generationWitness ||
        row.generationWitnessSource !== target.generationWitnessSource)
    )
      return false;
    const observed = telemetry.agents.find((agent) => agent.instanceId === target.id);
    return (
      !observed ||
      (observed.generationWitness === target.generationWitness &&
        observed.generationWitnessSource === target.generationWitnessSource)
    );
  }
  $effect(() => {
    if (feedback?.target && !matchesSelection(feedback.target)) {
      requestVersion += 1;
      feedback = null;
    }
  });
  function selectedTarget(id: string) {
    const live = actionTarget(telemetry, id);
    // Older detail requests may contain only an identity. Captured witness metadata,
    // when present, must match in both value and source; the millisecond key can collide.
    if (
      ('generationWitness' in row || 'generationWitnessSource' in row) &&
      (live.generationWitness !== row.generationWitness ||
        live.generationWitnessSource !== row.generationWitnessSource)
    ) {
      throw new Error(
        'This process instance is no longer reliably observed. Wait for a fresh scan.',
      );
    }
    return live;
  }
  let canControl = $derived.by(() => {
    if (!row.process || typeof row.instanceId !== 'string') return false;
    try {
      selectedTarget(row.instanceId);
      return true;
    } catch {
      return false;
    }
  });
  function prepareStop(id: string) {
    try {
      const live = selectedTarget(id);
      feedback = null;
      stopTarget = {
        id,
        generationWitness: live.generationWitness,
        generationWitnessSource: live.generationWitnessSource,
      };
    } catch {
      stopTarget = null;
    }
  }
  async function processAction(event: MouseEvent, method: ControlMethod, selected?: StopTarget) {
    if (pending) return;
    const button = event.currentTarget as HTMLButtonElement;
    const restoreFocus = document.activeElement === button;
    const version = selectionVersion;
    const request = ++requestVersion;
    const id = selected?.id ?? String(row.instanceId);
    let target = selected;
    let sent = false;
    feedback = { method, state: 'pending' };
    try {
      const live = selectedTarget(id);
      if (
        selected &&
        (live.generationWitness !== selected.generationWitness ||
          live.generationWitnessSource !== selected.generationWitnessSource)
      ) {
        throw new Error(
          'This process instance is no longer reliably observed. Wait for a fresh scan.',
        );
      }
      target = {
        id,
        generationWitness: live.generationWitness,
        generationWitnessSource: live.generationWitnessSource,
      };
      feedback = { method, state: 'pending', target };
      sent = true;
      confirmed(
        await invoke(host, method, {
          pid: live.pid,
          instanceId: live.instanceId,
          generationWitness: live.generationWitness,
          generationWitnessSource: live.generationWitnessSource,
        }),
      );
      if (version !== selectionVersion || request !== requestVersion) return;
      if (!matchesSelection(target)) {
        feedback = null;
        return;
      }
      feedback = { method, state: 'success', target };
      if (selected) stopTarget = null;
    } catch (error) {
      if (version !== selectionVersion || request !== requestVersion) return;
      feedback = {
        method,
        state: 'error',
        target: sent ? target : undefined,
        text: `${sent ? $t('The request was not confirmed; its effect is unknown.') : $t('The request was not sent.')} ${error instanceof Error ? error.message : String(error)}`,
      };
    } finally {
      await tick();
      if (
        restoreFocus &&
        version === selectionVersion &&
        request === requestVersion &&
        (document.activeElement === document.body ||
          (document.activeElement === button && button.disabled))
      ) {
        if (button.isConnected && !button.disabled) button.focus({ preventScroll: true });
        else if (stopButton && !stopButton.disabled) stopButton.focus({ preventScroll: true });
        else {
          const resultNode =
            method === 'suspendProcess'
              ? suspendResultNode
              : method === 'resumeProcess'
                ? resumeResultNode
                : stopResultNode;
          resultNode?.focus({ preventScroll: true });
        }
      }
    }
  }
  async function cancelStop() {
    const restoreFocus = confirmation?.contains(document.activeElement);
    stopTarget = null;
    await tick();
    if (restoreFocus && document.activeElement === document.body && !stopButton?.disabled)
      stopButton?.focus({ preventScroll: true });
  }
</script>

<section class="detail-section" class:compact aria-label={$t('Process controls')}>
  {#if !compact}<div class="section-heading">
      <h3 class="controls-heading"><Icon name="cpu" />{$t('Process controls')}</h3>
      <span class="badge">{$t('PID')} {String(row.pid ?? 'Unavailable')}</span>
    </div>{/if}
  <p class="entity-note">
    {canControl
      ? $t('Actions target only this process. Other processes and remote work can continue.')
      : $t('Controls are unavailable until this identity is observed again.')}
  </p>
  <div class="control-grid">
    <div class="action-control">
      <button
        class="button"
        disabled={!canControl || pending}
        aria-busy={pending && feedback?.method === 'suspendProcess'}
        aria-describedby={feedback?.method === 'suspendProcess'
          ? `${feedbackId}-suspend`
          : undefined}
        onclick={(event) => processAction(event, 'suspendProcess')}
        ><Icon name="pause" />{$t(simple ? 'Pause process' : 'Suspend')}</button
      >
      <div
        class="action-feedback"
        id={`${feedbackId}-suspend`}
        tabindex="-1"
        bind:this={suspendResultNode}
      >
        {#if feedback?.method === 'suspendProcess'}<span
            role={feedback.state === 'error' ? 'alert' : 'status'}
            class:error={feedback.state === 'error'}>{feedbackText}</span
          >{/if}
      </div>
    </div>
    <div class="action-control">
      <button
        class="button"
        disabled={!canControl || pending}
        aria-busy={pending && feedback?.method === 'resumeProcess'}
        aria-describedby={feedback?.method === 'resumeProcess' ? `${feedbackId}-resume` : undefined}
        onclick={(event) => processAction(event, 'resumeProcess')}
        ><Icon name="play" />{$t(simple ? 'Resume process' : 'Resume')}</button
      >
      <div
        class="action-feedback"
        id={`${feedbackId}-resume`}
        tabindex="-1"
        bind:this={resumeResultNode}
      >
        {#if feedback?.method === 'resumeProcess'}<span
            role={feedback.state === 'error' ? 'alert' : 'status'}
            class:error={feedback.state === 'error'}>{feedbackText}</span
          >{/if}
      </div>
    </div>
    <div class="action-control">
      <button
        bind:this={stopButton}
        class="button danger"
        disabled={!canControl || pending}
        aria-describedby={feedback?.method === 'killProcess' ? `${feedbackId}-stop` : undefined}
        onclick={() => prepareStop(String(row.instanceId))}
        ><Icon name="stop" />{$t('Stop…')}</button
      >
      <div
        class="action-feedback"
        id={`${feedbackId}-stop`}
        tabindex="-1"
        bind:this={stopResultNode}
      >
        {#if feedback?.method === 'killProcess'}<span
            role={feedback.state === 'error' ? 'alert' : 'status'}
            class:error={feedback.state === 'error'}>{feedbackText}</span
          >{/if}
      </div>
    </div>
  </div>
  {#if stopTarget}<div class="confirm-stop" role="alert" bind:this={confirmation}>
      <h3>{$t('Stop this process?')}</h3>
      <p>
        {$t('Unsaved work may be lost. The process identity is checked again before stopping.')}
      </p>
      <div class="toolbar">
        <button
          class="button"
          disabled={pending}
          aria-busy={pending && feedback?.method === 'killProcess'}
          aria-describedby={feedback?.method === 'killProcess' ? `${feedbackId}-stop` : undefined}
          onclick={(event) => processAction(event, 'killProcess', stopTarget!)}
          ><Icon name="stop" />{$t('Confirm stop')}</button
        >
        <button class="button" disabled={pending} onclick={cancelStop}>{$t('Cancel')}</button>
      </div>
    </div>{/if}
</section>
{#if !simple}{#key row.agent ?? row.name}<Watchlist
      {host}
      agent={String(row.agent ?? row.name ?? '')}
    />{/key}{/if}

<style>
  .action-control {
    display: inline-grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(1.5em, auto);
    align-items: start;
    row-gap: 3px;
    vertical-align: top;
    max-width: 100%;
  }
  .action-feedback {
    min-width: 0;
    font-size: calc(10px * var(--ui-scale));
    line-height: 1.5;
    min-height: 1.5em;
    contain: inline-size;
    overflow-wrap: anywhere;
  }
  .error {
    color: var(--red);
  }
  .control-grid {
    align-items: start;
  }
  .controls-heading {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .compact {
    padding: 0;
    border: 0;
    background: none;
    min-width: 0;
  }
  .compact .section-heading {
    margin-bottom: var(--space-1);
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .compact .controls-heading,
  .compact .entity-note {
    font-size: var(--text-caption);
  }
  .compact .entity-note {
    margin: var(--space-1) 0 var(--space-2);
  }
  .compact .control-grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .compact .confirm-stop {
    margin-top: var(--space-2);
  }
</style>
