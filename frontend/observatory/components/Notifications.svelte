<script lang="ts">
  import { t } from '../runtime/i18n';

  import { onDestroy } from 'svelte';
  import {
    addToast,
    toasts,
    removeToast,
    clearAllToasts,
  } from '../../../src/renderer/lib/stores/toast';
  import { createAnomalyToastTracker } from '../../../src/renderer/lib/utils/anomaly-toast-tracker';
  import type { Telemetry } from '../runtime/host';
  let { telemetry }: { telemetry: Telemetry } = $props();
  const tracker = createAnomalyToastTracker();
  $effect(() => {
    if (telemetry.stale) return;
    const scores: Record<string, number> = {};
    for (const agent of telemetry.agents) {
      const score = agent.instanceId ? (telemetry.anomalies[agent.instanceId] ?? 0) : 0;
      scores[agent.agent] = Math.max(scores[agent.agent] ?? 0, score);
    }
    for (const name of tracker.ingest(scores))
      addToast(`Anomaly: ${name} score ${scores[name]}`, 'warning');
  });
  onDestroy(clearAllToasts);
</script>

<div class="notifications" aria-live="polite" aria-atomic="false">
  {#each $toasts as toast (toast.id)}<div class="notification">
      <p>{toast.message}</p>
      <button aria-label={$t('Dismiss notification')} onclick={() => removeToast(toast.id)}
        >×</button
      >
    </div>{/each}
</div>

<style>
  .notifications {
    position: fixed;
    z-index: 80;
    right: 20px;
    bottom: 45px;
    display: grid;
    gap: 8px;
    max-width: min(420px, 90vw);
  }
  .notification {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 12px 16px;
    border: 1px solid var(--amber);
    border-radius: 8px;
    background: var(--panel);
    box-shadow: var(--shadow);
  }
  .notification button {
    color: var(--ink);
    background: transparent;
    border: 0;
  }
</style>
