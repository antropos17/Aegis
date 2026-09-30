<script lang="ts">
  import { tick, onDestroy, onMount } from 'svelte';
  import { t } from '../runtime/i18n';
  import {
    addToast,
    toasts,
    removeToast,
    clearAllToasts,
  } from '../../../src/renderer/lib/stores/toast';
  import { createAnomalyToastTracker } from '../../../src/renderer/lib/utils/anomaly-toast-tracker';
  import {
    alertBasename,
    alertControlTarget,
    createSensitiveAlertTracker,
    parseJournalAlerts,
    type SensitiveAlert,
  } from '../runtime/sensitive-alerts';
  import { confirmed, invoke, type Host, type RecordData, type Telemetry } from '../runtime/host';
  import SensitiveAlertCenter from './SensitiveAlertCenter.svelte';

  let {
    telemetry,
    host = null,
    onInspect,
  }: {
    telemetry: Telemetry;
    host?: Host | null;
    onInspect?: (_title: string, _row: RecordData) => void;
  } = $props();
  const anomalyTracker = createAnomalyToastTracker();
  const sensitiveTracker = createSensitiveAlertTracker();
  let alerts = $state.raw<SensitiveAlert[]>([]);
  let evicted = $state(0);
  let recent = $state.raw<SensitiveAlert[]>([]);
  let centerOpen = $state(false);
  let journalStatus = $state('ready');
  let reviewRevision = 0;
  let reviewPending = $state(false);
  let centerTrigger: HTMLButtonElement;
  const needsReview = $derived(alerts.filter((item) => !item.reviewed).length);

  $effect(() => {
    if (telemetry.stale) return;
    const scores: Record<string, number> = {};
    for (const agent of telemetry.agents) {
      const score = agent.instanceId ? (telemetry.anomalies[agent.instanceId] ?? 0) : 0;
      scores[agent.agent] = Math.max(scores[agent.agent] ?? 0, score);
    }
    for (const name of anomalyTracker.ingest(scores))
      addToast(`Anomaly: ${name} score ${scores[name]}`, 'warning');
  });
  $effect(() => {
    const delivery = sensitiveTracker.ingest(telemetry.events);
    alerts = delivery.items;
    evicted = delivery.evicted;
    if (delivery.fresh.length) recent = delivery.fresh;
  });
  $effect(() => {
    if (!recent.length) return;
    const shown = recent;
    const timer = setTimeout(() => {
      if (recent === shown) recent = [];
    }, 8000);
    return () => clearTimeout(timer);
  });
  onDestroy(clearAllToasts);
  onMount(() => {
    const style = document.documentElement.style;
    const properties = ['--observatory-alert-trigger-width', '--observatory-alert-trigger-height'];
    const previous = properties.map((property) => [
      property,
      style.getPropertyValue(property),
      style.getPropertyPriority(property),
    ]);
    let alive = true;
    const measureTrigger = () => {
      if (!alive) return;
      const box = centerTrigger.getBoundingClientRect();
      style.setProperty(properties[0], box.width + 'px');
      style.setProperty(properties[1], box.height + 'px');
    };
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measureTrigger);
    observer?.observe(centerTrigger);
    window.addEventListener('resize', measureTrigger);
    measureTrigger();
    return () => {
      alive = false;
      observer?.disconnect();
      window.removeEventListener('resize', measureTrigger);
      for (const [property, value, priority] of previous)
        if (value) style.setProperty(property, value, priority);
        else style.removeProperty(property);
    };
  });
  onMount(() => {
    if (!host?.listSensitiveAlerts) return;
    let alive = true;
    const seedReviewRevision = reviewRevision;
    invoke(host, 'listSensitiveAlerts')
      .then((value) => {
        if (!alive) return;
        const reply = confirmed(value);
        if (reviewRevision === seedReviewRevision)
          journalStatus = typeof reply.status === 'string' ? reply.status : 'ready';
        alerts = sensitiveTracker.mergeJournal(parseJournalAlerts(reply.items));
      })
      .catch(() => {
        if (alive) journalStatus = 'write-error';
      });
    return () => {
      alive = false;
    };
  });

  async function reviewAlert(id: string, reviewed: boolean): Promise<boolean> {
    if (reviewPending) return false;
    reviewPending = true;
    reviewRevision++;
    try {
      if (!host || id.startsWith('session-')) {
        alerts = sensitiveTracker.setReviewed(id, reviewed, false);
        return true;
      }
      const reply = confirmed(await invoke(host, 'setSensitiveAlertReviewed', id, reviewed));
      journalStatus = typeof reply.status === 'string' ? reply.status : 'ready';
      alerts = sensitiveTracker.setReviewed(id, reviewed, true);
      return true;
    } catch {
      journalStatus = 'write-error';
      return false;
    } finally {
      reviewPending = false;
    }
  }

  async function openCenter() {
    centerOpen = true;
    recent = [];
    await tick();
  }
  async function closeCenter() {
    centerOpen = false;
    await tick();
    centerTrigger?.focus({ preventScroll: true });
  }
  async function openEvidence(item: SensitiveAlert) {
    await closeCenter();
    onInspect?.(alertBasename(item.event.file), item.event as unknown as RecordData);
  }
  async function openProcessControls(item: SensitiveAlert) {
    const target = alertControlTarget(item.event, telemetry);
    if (!target || !onInspect) return;
    await closeCenter();
    onInspect(target.agent, { ...target, detailSection: 'process-controls' });
  }
</script>

<button
  class="alert-trigger"
  bind:this={centerTrigger}
  aria-expanded={centerOpen}
  aria-label={$t('Sensitive activity review · {value0} need review', { value0: needsReview })}
  onclick={() => (centerOpen ? closeCenter() : openCenter())}
>
  {$t('Alerts')}
  {#if needsReview > 0}<span>{needsReview}</span>{/if}
</button>
{#if centerOpen}
  <SensitiveAlertCenter
    items={alerts}
    {evicted}
    {journalStatus}
    {reviewPending}
    onReview={reviewAlert}
    onInspect={onInspect ? openEvidence : undefined}
    canOpenProcess={(item) =>
      Boolean(item.live && onInspect && alertControlTarget(item.event, telemetry))}
    onOpenProcess={openProcessControls}
    onClose={closeCenter}
  />
{/if}
<div class="notifications" aria-live="polite" aria-atomic="false">
  {#if !centerOpen && recent.length}
    <div class="notification sensitive" role="status">
      <div>
        <strong>
          {recent.length === 1
            ? $t('Sensitive file observed: {value0}', {
                value0: alertBasename(recent[0].event.file),
              })
            : $t('{value0} sensitive file observations', { value0: recent.length })}
        </strong>
        <p>
          {recent.length === 1 &&
          recent[0].event.agent &&
          recent[0].event.attribution?.status === 'confirmed'
            ? $t('Observed owner: {value0}', { value0: recent[0].event.agent })
            : recent.length === 1 &&
                recent[0].event.agent &&
                recent[0].event.attribution?.status === 'inferred'
              ? $t('Possible source: {value0}', { value0: recent[0].event.agent })
              : $t('Source may be unverified; review the evidence.')}
        </p>
      </div>
      <button onclick={openCenter}>{$t('Review')}</button>
      <button aria-label={$t('Dismiss notification')} onclick={() => (recent = [])}>×</button>
    </div>
  {/if}
  {#each $toasts as toast (toast.id)}
    <div class="notification">
      <p>{toast.message}</p>
      <button aria-label={$t('Dismiss notification')} onclick={() => removeToast(toast.id)}
        >×</button
      >
    </div>
  {/each}
</div>

<style>
  .alert-trigger {
    position: fixed;
    z-index: 91;
    right: 20px;
    bottom: 12px;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--strong-border);
    border-radius: var(--control-radius);
    background: var(--panel);
    color: var(--ink);
    box-shadow: var(--shadow);
    cursor: pointer;
  }
  .alert-trigger span {
    min-width: 1.5em;
    border-radius: 999px;
    background: var(--amber);
    color: var(--panel);
    text-align: center;
    font-size: var(--text-caption);
  }
  .notifications {
    position: fixed;
    z-index: 80;
    right: 20px;
    bottom: calc(var(--observatory-footer-height, 0px) + 58px);
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
    border-radius: var(--control-radius);
    background: var(--panel);
    box-shadow: var(--shadow);
  }
  .notification.sensitive {
    border-color: var(--red);
  }
  .notification p {
    margin: var(--space-1) 0 0;
  }
  .notification button {
    color: var(--ink);
    background: transparent;
    border: 0;
    cursor: pointer;
  }
  .notification button:focus-visible,
  .alert-trigger:focus-visible {
    outline: 2px solid var(--selection-border);
  }
  @media (min-width: 800px) {
    .alert-trigger {
      bottom: max(
        6px,
        calc(
          (
              var(
                  --observatory-footer-height,
                  calc(var(--observatory-alert-trigger-height, 30px) + 24px)
                ) -
                var(--observatory-alert-trigger-height, 30px)
            ) /
            2
        )
      );
    }
  }
  @media (max-width: 600px) {
    .alert-trigger,
    .notifications {
      right: 10px;
    }
  }
</style>
