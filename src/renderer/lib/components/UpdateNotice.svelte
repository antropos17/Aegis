<script lang="ts">
  import { updateStatus } from '../stores/updates';
  let { onOpen }: { onOpen: () => void } = $props();
</script>

{#if ['available', 'downloading', 'ready'].includes($updateStatus.status)}
  <aside class="update-notice" aria-label="Application update">
    <span role="status">
      {#if $updateStatus.status === 'ready'}
        AEGIS {$updateStatus.version} is ready to install.
      {:else if $updateStatus.status === 'downloading'}
        Downloading AEGIS {$updateStatus.version} — {Math.round($updateStatus.progress)}%
      {:else}
        AEGIS {$updateStatus.version} is available.
      {/if}
    </span>
    <button onclick={onOpen}>Review update</button>
  </aside>
{/if}

<style>
  .update-notice {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--aegis-space-4);
    padding: var(--aegis-space-3);
    background: var(--md-sys-color-primary-container);
    color: var(--md-sys-color-on-surface);
  }
  button {
    font: inherit;
    color: inherit;
    background: transparent;
    border: 1px solid var(--md-sys-color-primary);
    border-radius: var(--md-sys-shape-corner-small);
    padding: var(--aegis-space-2) var(--aegis-space-4);
    cursor: pointer;
  }
  button:focus-visible {
    outline: 2px solid var(--md-sys-color-primary);
    outline-offset: 2px;
  }
</style>
