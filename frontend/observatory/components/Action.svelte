<script lang="ts">
  import { t } from '../runtime/i18n';

  import type { Snippet } from 'svelte';
  let {
    action,
    children,
    disabled = false,
  }: { action: () => Promise<unknown>; children: Snippet; disabled?: boolean } = $props();
  const feedbackId = $props.id();
  let pending = $state(false);
  let error = $state('');
  let done = $state(false);
  async function run() {
    if (pending) return;
    pending = true;
    error = '';
    done = false;
    try {
      await action();
      done = true;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      pending = false;
    }
  }
</script>

<div class="action-control">
  <button
    class="button"
    disabled={disabled || pending}
    aria-busy={pending}
    aria-describedby={pending || error || done ? feedbackId : undefined}
    onclick={run}>{@render children()}</button
  >
  <div class="action-feedback" id={feedbackId}>
    {#if error}<span role="alert" class="error">{error}</span>{:else}<span
        role="status"
        class="muted">{pending ? $t('Working…') : done ? $t('Completed') : ''}</span
      >{/if}
  </div>
</div>

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
</style>
