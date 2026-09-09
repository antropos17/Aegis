<script lang="ts">
  import type { Snippet } from 'svelte';
  let {
    action,
    children,
    disabled = false,
  }: { action: () => Promise<unknown>; children: Snippet; disabled?: boolean } = $props();
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
  <button class="button" disabled={disabled || pending} onclick={run}
    >{#if pending}Working…{:else}{@render children()}{/if}</button
  >
  {#if error}<span role="alert" class="error">{error}</span>{:else if done}<span
      role="status"
      class="muted">Completed</span
    >{/if}
</div>

<style>
  .action-control {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .error {
    color: var(--red);
    max-width: 36ch;
    overflow-wrap: anywhere;
  }
</style>
