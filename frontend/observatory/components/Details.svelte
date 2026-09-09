<script lang="ts">
  import { tick } from 'svelte';
  import { transitionSurface } from '../runtime/motion';
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
  let canControl = $derived.by(() => {
    if (!current?.row.process || typeof current.row.instanceId !== 'string') return false;
    try {
      actionTarget(telemetry, current.row.instanceId);
      return true;
    } catch {
      return false;
    }
  });
  let stopId = $state<string | null>(null);
  let returnFocus: HTMLElement | null = null;
  let watch = $state<RecordData[]>([]);
  let previousRequest: typeof request = null;
  $effect(() => {
    if (request && request !== previousRequest) {
      previousRequest = request;
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      history = [{ ...request, scroll: 0, focus: null }];
      index = 0;
      stopId = null;
      if (!dialog.open) dialog.showModal();
      void tick().then(() =>
        document.getElementById('modal-title')?.focus({ preventScroll: true }),
      );
    } else if (!request) {
      previousRequest = null;
      if (dialog?.open) dialog.close();
    }
  });
  async function navigate(title: string, row: RecordData) {
    history[index].scroll = body.scrollTop;
    history[index].focus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    await transitionSurface('detail', async () => {
      history = [...history.slice(0, index + 1), { title, row, scroll: 0, focus: null }];
      index++;
      await restore();
    });
  }
  async function move(delta: number) {
    history[index].scroll = body.scrollTop;
    history[index].focus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    await transitionSurface(
      'detail',
      async () => {
        index += delta;
        await restore();
      },
      delta,
    );
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

<dialog
  id="modal"
  bind:this={dialog}
  onclose={finish}
  oncancel={() => close()}
  aria-labelledby="modal-title"
>
  <div class="modal-head">
    <div class="detail-navigation history-controls">
      <button
        class="history-arrow"
        aria-label="Back"
        disabled={index === 0}
        onclick={() => move(-1)}><Icon name="arrowLeft" /></button
      ><button
        class="history-arrow"
        aria-label="Forward"
        disabled={index >= history.length - 1}
        onclick={() => move(1)}><Icon name="chevron" /></button
      >
    </div>
    <div>
      <span class="muted" id="modal-caption"
        >{current?.row.agentGroupKey
          ? 'Agent overview'
          : current?.row.process
            ? 'Agent instance'
            : current?.row.displayName
              ? 'Agent catalog'
              : current?.row.observationGroup
                ? 'Grouped observations'
                : 'Recorded metadata'}</span
      >
      <h2 id="modal-title" tabindex="-1">{current?.title ?? 'Details'}</h2>
    </div>
    <button class="icon-button" aria-label="Close details" onclick={close}
      ><Icon name="close" /></button
    >
  </div>
  <div id="modal-body" tabindex="-1" bind:this={body}>
    {#if current}<div
        class:agent-detail-grid={!!current.row.process || !!current.row.agentGroupKey}
      >
        <div><DetailSummary row={current.row} {telemetry} /></div>
        <div><EntityLinks row={current.row} {telemetry} {navigate} /></div>
      </div>
      <details
        class="all-metadata"
        open={!current.row.process &&
          !current.row.agentGroupKey &&
          !current.row.displayName &&
          !current.row.file &&
          !current.row.remoteIp &&
          !current.row.domain &&
          !current.row.type &&
          !current.row.observations}
      >
        <summary>All observation metadata</summary><Metadata value={current.row} />
      </details>
      {#if current.row.process}<details>
          <summary>Alert watchlist</summary>
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
          <p class="muted">Watchlist entries raise alerts; they do not block execution.</p>
        </details>{/if}
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
  <div class="modal-actions">
    {#if current?.row.website}<Action
        action={async () => confirmed(await invoke(host, 'openExternalUrl', current.row.website))}
        ><Icon name="globe" />Website</Action
      >{/if}
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
      )}<Action disabled={!canControl} action={() => processAction('suspendProcess', id)}
        >Suspend</Action
      ><Action disabled={!canControl} action={() => processAction('resumeProcess', id)}
        >Resume</Action
      ><button class="button" disabled={!canControl} onclick={() => (stopId = id)}>Stop…</button
      ><Action
        action={async () => {
          confirmed(
            await invoke(host, 'blocklistAdd', {
              signature: current.row.agent ?? current.row.name,
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
  .confirm-stop {
    border: 1px solid var(--red);
    padding: 16px;
    border-radius: 8px;
    margin-top: 16px;
  }
</style>
