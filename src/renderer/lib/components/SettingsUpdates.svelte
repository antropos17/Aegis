<script lang="ts">
  import { updateStatus, updateAction } from '../stores/updates';
  let { automaticUpdatesEnabled = $bindable(false) }: { automaticUpdatesEnabled?: boolean } =
    $props();
  const supported = $derived(
    $updateStatus.status !== 'unsupported' && !!window.aegis?.checkForUpdates,
  );
  const busy = $derived(['checking', 'downloading', 'installing'].includes($updateStatus.status));
</script>

<section aria-labelledby="updates-title" class="updates">
  <h3 id="updates-title">Updates</h3>
  <label class="consent">
    <input type="checkbox" bind:checked={automaticUpdatesEnabled} disabled={!supported} />
    Check and download updates automatically
  </label>
  <p class="hint">
    After you save, AEGIS can contact GitHub on startup and every six hours. Restarting to install
    always requires your confirmation.
  </p>
  {#if !supported}
    <p>Updates are available in the installed Windows x64 app.</p>
  {:else}
    <p role="status">
      {#if $updateStatus.status === 'checking'}Checking for updates…
      {:else if $updateStatus.status === 'up-to-date'}You’re up to date.
      {:else if $updateStatus.status === 'available'}Version {$updateStatus.version} is available.
      {:else if $updateStatus.status === 'downloading'}Downloading — {Math.round(
          $updateStatus.progress,
        )}%
      {:else if $updateStatus.status === 'ready'}Version {$updateStatus.version} is verified and ready.
      {:else if $updateStatus.status === 'installing'}Restarting to install…
      {:else if $updateStatus.status === 'error'}The update could not be completed or verified.
        Check your connection and try again.
      {:else}Check manually, or enable automatic checks above.{/if}
    </p>
    {#if $updateStatus.notes}
      <details>
        <summary>What’s new in {$updateStatus.version}</summary>
        <pre>{$updateStatus.notes}</pre>
      </details>
    {/if}
    <div class="actions">
      <button
        disabled={busy || $updateStatus.status === 'ready'}
        onclick={() => updateAction('check')}>Check for updates</button
      >
      {#if $updateStatus.status === 'available'}
        <button onclick={() => updateAction('download')}>Download update</button>
      {:else if $updateStatus.status === 'ready'}
        <button onclick={() => updateAction('install')}>Restart and install</button>
      {/if}
    </div>
  {/if}
</section>

<style>
  .updates {
    display: flex;
    flex-direction: column;
    gap: var(--aegis-space-3);
    border-top: var(--glass-border);
    padding-top: var(--aegis-space-5);
  }
  h3,
  p {
    margin: 0;
  }
  h3 {
    font-size: inherit;
  }
  .consent {
    display: flex;
    align-items: center;
    gap: var(--aegis-space-3);
  }
  .hint {
    color: var(--md-sys-color-on-surface-variant);
    font-size: var(--md-sys-typescale-body-small-size, 0.875rem);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--aegis-space-3);
  }
  button {
    font: inherit;
    color: var(--md-sys-color-on-surface);
    background: var(--md-sys-color-surface-container);
    border: var(--glass-border);
    border-radius: var(--md-sys-shape-corner-small);
    padding: var(--aegis-space-2) var(--aegis-space-4);
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  button:focus-visible,
  input:focus-visible,
  summary:focus-visible {
    outline: 2px solid var(--md-sys-color-primary);
    outline-offset: 2px;
  }
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font: inherit;
    max-height: 180px;
    overflow-y: auto;
  }
</style>
