<script lang="ts">
  import { tick } from 'svelte';
  import {
    actionTarget,
    confirmed,
    invoke,
    record,
    type Host,
    type RecordData,
    type Telemetry,
  } from '../runtime/host';
  import {
    acknowledgedAgents,
    toggleAcknowledged,
  } from '../../../src/renderer/lib/stores/acknowledged';
  import Action from './Action.svelte';
  import EntityLinks from './EntityLinks.svelte';
  import Metadata from './Metadata.svelte';
  import Icon from './Icon.svelte';
  import DetailSummary from './DetailSummary.svelte';
  let {
    host,
    telemetry,
    request,
    close,
    refreshFalsePositives,
  }: {
    host: Host | null;
    telemetry: Telemetry;
    request: { title: string; row: RecordData } | null;
    close: () => void;
    refreshFalsePositives: () => Promise<void>;
  } = $props();
  let dialog: HTMLDialogElement;
  let body: HTMLDivElement;
  let history = $state<
    { title: string; row: RecordData; scroll: number; focus: HTMLElement | null }[]
  >([]);
  let index = $state(0);
  let current = $derived(history[index]);
  let stopId = $state<string | null>(null);
  let returnFocus: HTMLElement | null = null;
  let watch = $state<RecordData[]>([]);
  $effect(() => {
    if (request) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      history = [{ ...request, scroll: 0, focus: null }];
      index = 0;
      stopId = null;
      dialog.showModal();
    } else if (dialog?.open) dialog.close();
  });
  async function navigate(title: string, row: RecordData) {
    history[index].scroll = body.scrollTop;
    history[index].focus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    history = [...history.slice(0, index + 1), { title, row, scroll: 0, focus: null }];
    index++;
    await restore();
  }
  async function move(delta: number) {
    history[index].scroll = body.scrollTop;
    history[index].focus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    index += delta;
    await restore();
  }
  async function restore() {
    stopId = null;
    await tick();
    body.scrollTop = history[index].scroll;
    const focus = history[index].focus;
    if (focus?.isConnected) focus.focus({ preventScroll: true });
    else body.focus({ preventScroll: true });
  }
  function finish() {
    close();
    returnFocus?.focus();
  }
  async function processAction(method: string, id: string) {
    const live = actionTarget(telemetry, id);
    confirmed(await invoke(host, method, { pid: live.pid, instanceId: live.instanceId }));
    stopId = null;
  }
  async function loadWatch() {
    const result = await invoke(host, 'blocklistList');
    watch = Array.isArray(result) ? result.map(record) : [];
  }
</script>

<dialog bind:this={dialog} onclose={finish} oncancel={() => close()} aria-labelledby="detail-title">
  <div class="detail-head">
    <div class="toolbar">
      <button class="icon-button" aria-label="Back" disabled={index === 0} onclick={() => move(-1)}
        >←</button
      ><button
        class="icon-button"
        aria-label="Forward"
        disabled={index >= history.length - 1}
        onclick={() => move(1)}>→</button
      >
    </div>
    <h2 id="detail-title">{current?.title ?? 'Details'}</h2>
    <button class="icon-button" aria-label="Close details" onclick={close}
      ><Icon name="close" /></button
    >
  </div>
  <div class="detail-body" tabindex="-1" bind:this={body}>
    {#if current}<DetailSummary row={current.row} {telemetry} />
      <EntityLinks row={current.row} {telemetry} {navigate} />
      <details
        class="all-metadata"
        open={!current.row.process &&
          !current.row.displayName &&
          !current.row.file &&
          !current.row.remoteIp &&
          !current.row.domain}
      >
        <summary>All observation metadata</summary><Metadata value={current.row} />
      </details>
      {#if current.row.process}<h3>Alert watchlist</h3>
        <Action action={loadWatch}>Refresh watchlist</Action>{#each watch as entry (entry)}<div
            class="toolbar"
          >
            <span>{String(entry.signature)} · {String(entry.pid ?? 'all instances')}</span><Action
              action={async () => {
                confirmed(
                  await invoke(host, 'blocklistRemove', {
                    signature: entry.signature,
                    pid: entry.pid,
                  }),
                );
                await loadWatch();
              }}>Remove</Action
            >
          </div>{/each}
        <p class="muted">Watchlist entries raise alerts; they do not block execution.</p>{/if}
      {#if stopId}<div class="confirm-stop" role="alert">
          <h3>Stop this process?</h3>
          <p>
            Unsaved work in this process may be lost. The selected identity will be checked again
            before dispatch.
          </p>
          <Action action={() => processAction('killProcess', stopId!)}>Confirm stop</Action><button
            class="button"
            onclick={() => (stopId = null)}>Cancel</button
          >
        </div>{/if}
    {/if}
  </div>
  <div class="detail-footer">
    {#if current?.row.instanceId}<button
        class="button"
        aria-pressed={$acknowledgedAgents.has(String(current.row.instanceId))}
        onclick={() => toggleAcknowledged(String(current.row.instanceId))}
        >{$acknowledgedAgents.has(String(current.row.instanceId))
          ? 'Reviewed'
          : 'Mark reviewed'}</button
      >{/if}
    {#if current?.row.process && current.row.instanceId}{@const id = String(
        current.row.instanceId,
      )}<Action
        disabled={telemetry.stale || current.row.instanceIdSource !== 'os'}
        action={() => processAction('suspendProcess', id)}>Suspend</Action
      ><Action
        disabled={telemetry.stale || current.row.instanceIdSource !== 'os'}
        action={() => processAction('resumeProcess', id)}>Resume</Action
      ><button
        class="button"
        disabled={telemetry.stale || current.row.instanceIdSource !== 'os'}
        onclick={() => (stopId = id)}>Stop…</button
      ><Action
        action={async () => {
          confirmed(
            await invoke(host, 'blocklistAdd', {
              signature: current.row.agent,
              reason: 'Added from instance details',
            }),
          );
          await loadWatch();
        }}>Watch agent</Action
      >{/if}
    {#if current?.row.file || current?.row.cwd}<Action
        action={async () =>
          confirmed(await invoke(host, 'revealInExplorer', current.row.file ?? current.row.cwd))}
        >Show in folder</Action
      >{/if}
    {#if current?.row.file && current.row.agent}<Action
        action={async () => {
          confirmed(
            await invoke(host, 'addFalsePositive', {
              agentName: current.row.agent,
              pattern: String(current.row.file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
              timestamp: Date.now(),
            }),
          );
          await refreshFalsePositives();
        }}>Mark false positive</Action
      >{/if}
  </div>
</dialog>

<style>
  .all-metadata {
    border-top: 1px solid var(--border);
    margin: 16px 0;
    padding-top: 12px;
  }
  summary {
    cursor: pointer;
    color: var(--muted);
    font-size: 12px;
  }
  dialog {
    padding: 0;
    width: min(920px, calc(100vw - 32px));
    max-height: calc(100dvh - 32px);
    color: var(--ink);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
  }
  dialog[open] {
    display: flex;
    flex-direction: column;
  }
  .detail-head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .detail-head h2 {
    flex: 1;
    margin: 0;
    font-size: 17px;
    overflow-wrap: anywhere;
  }
  .detail-body {
    overflow: auto;
    padding: 16px;
    min-height: 0;
  }
  .detail-footer {
    flex-shrink: 0;
    padding: 12px 16px;
    border-top: 1px solid var(--border);
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .confirm-stop {
    border: 1px solid var(--red);
    padding: 16px;
    border-radius: 8px;
    margin-top: 16px;
  }
</style>
