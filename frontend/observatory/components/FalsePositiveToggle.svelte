<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { t } from '../runtime/i18n';
  import type { Host } from '../runtime/host';
  import {
    changeExactException,
    ExceptionReadbackError,
    readExactException,
    type ExactExceptionStatus,
    type ExactExceptionTarget,
  } from '../runtime/false-positive-control';
  let {
    host,
    target,
    refreshFalsePositives,
    statusRevision = 0,
    visible = true,
  }: {
    host: Host | null;
    target: ExactExceptionTarget;
    refreshFalsePositives: () => Promise<void>;
    statusRevision?: number;
    visible?: boolean;
  } = $props();
  const feedbackId = $props.id();
  let saved = $state<ExactExceptionStatus | null>(null);
  let pending = $state(true);
  let error = $state('');
  let verified = $state(false);
  let mounted = $state(false);
  let alive = true;
  let active = false;
  let queued = false;
  let queuedRefresh = false;

  // Saved-state signals and a visible return request verification without
  // replacing this control or racing its current serialized write/readback.
  $effect(() => {
    statusRevision;
    if (mounted && visible) untrack(() => requestRead());
  });
  function requestRead(refresh = false) {
    if (!alive) return;
    queued = true;
    queuedRefresh ||= refresh;
    flushRead();
  }
  function flushRead() {
    if (!alive || !queued || active || !visible) return;
    const refresh = queuedRefresh;
    queued = false;
    queuedRefresh = false;
    void read(refresh);
  }
  async function read(refresh = false) {
    active = true;
    pending = true;
    error = '';
    try {
      const result = await readExactException(host, target);
      if (refresh) await refreshFalsePositives();
      if (alive) {
        saved = result;
        verified = true;
      }
    } catch (failure) {
      if (alive) {
        verified = false;
        error = failure instanceof Error ? failure.message : String(failure);
      }
    } finally {
      active = false;
      if (alive) {
        pending = false;
        flushRead();
      }
    }
  }
  onMount(() => {
    mounted = true;
    return () => {
      alive = false;
    };
  });
  async function toggle() {
    if (!host || pending || !verified || !saved) return;
    active = true;
    pending = true;
    error = '';
    try {
      const result = await changeExactException(host, target, !saved.muted, refreshFalsePositives);
      if (alive) saved = result;
    } catch (failure) {
      if (alive) {
        if (failure instanceof ExceptionReadbackError) verified = false;
        error = failure instanceof Error ? failure.message : String(failure);
      }
    } finally {
      active = false;
      if (alive) {
        pending = false;
        flushRead();
      }
    }
  }
</script>

<div class="false-positive-control">
  <button
    class="button"
    disabled={pending || !verified || target.pattern.length > 256}
    aria-busy={pending}
    aria-describedby={feedbackId}
    onclick={toggle}
  >
    {$t(verified && saved?.muted ? 'Re-enable alerts' : 'Mute false alarm')}
  </button>
  <div id={feedbackId} class="exception-feedback">
    <p class="muted">
      {$t(
        'Applies to all {value0} processes for this exact file. Excludes matching events from scoring and new notifications; evidence stays in Alerts and history.',
        { value0: target.agentName },
      )}
    </p>
    {#if pending}<p role="status" class="muted">{$t('Checking saved exception…')}</p>
    {:else if error}<p role="alert" class="error">{$t(error)}</p>
    {:else if target.pattern.length > 256}<p role="status" class="muted">
        {$t('This exact path exceeds the saved exception limit.')}
      </p>
    {:else if verified}<p role="status" class="muted">
        {$t(
          saved?.muted
            ? 'Exact file exception saved.'
            : saved?.excluded
              ? 'Another saved pattern still excludes this file.'
              : 'No saved pattern excludes this file.',
        )}
      </p>{/if}
  </div>
  {#if !pending && !verified}<button class="button" onclick={() => requestRead(true)}
      >{$t('Retry status')}</button
    >{/if}
</div>

<style>
  .false-positive-control {
    display: grid;
    gap: 6px;
    max-width: 440px;
  }
  .false-positive-control > button {
    justify-self: start;
  }
  .exception-feedback {
    min-width: 0;
    font-size: calc(10px * var(--ui-scale));
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .exception-feedback p {
    margin: 0;
  }
  .error {
    color: var(--red);
  }
</style>
