<script lang="ts">
  import { tick } from 'svelte';
  import { transitionSurface } from '../runtime/motion';
  import { confirmed, invoke, type Host, type RecordData, type Telemetry } from '../runtime/host';
  import { detailKind, detailTitle, detailCaption, detailTabs } from '../runtime/detail-model';
  import {
    acknowledgedAgents,
    toggleAcknowledged,
  } from '../../../src/renderer/lib/stores/acknowledged';
  import Action from './Action.svelte';
  import EntityLinks from './EntityLinks.svelte';
  import Icon from './Icon.svelte';
  import DetailSummary from './DetailSummary.svelte';
  import RiskExplanation from './RiskExplanation.svelte';
  import DetailControls from './DetailControls.svelte';
  import SectionTabs from './SectionTabs.svelte';
  let {
    host,
    telemetry,
    request,
    close,
    refreshFalsePositives,
    openAgent,
  }: {
    host: Host | null;
    telemetry: Telemetry;
    request: { title: string; row: RecordData } | null;
    close: () => void;
    refreshFalsePositives: () => Promise<void>;
    openAgent?: (_title: string, _row: RecordData) => void;
  } = $props();
  interface Visit {
    title: string;
    row: RecordData;
    tab: string;
    scroll: Record<string, number>;
    focus: Record<string, string | null>;
    query: Record<string, string>;
    limit: Record<string, number>;
  }
  let dialog: HTMLDialogElement;
  let body: HTMLDivElement;
  let history = $state<Visit[]>([]);
  let index = $state(0);
  let current = $derived(history[index]);
  let tabs = $derived(current ? detailTabs(current.row, telemetry) : []);
  let returnFocus: HTMLElement | null = null;
  let previousRequest: typeof request = null;
  let navigationRevision = 0;
  function visit(title: string, row: RecordData): Visit {
    const sections = detailTabs(row, telemetry);
    return {
      title,
      row,
      tab: sections.some((section) => section.id === row.detailSection)
        ? String(row.detailSection)
        : detailKind(row) === 'records'
          ? 'records'
          : 'overview',
      scroll: {},
      focus: {},
      query: Object.fromEntries(sections.map((s) => [s.id, ''])),
      limit: Object.fromEntries(sections.map((s) => [s.id, s.id === 'records' ? 20 : 12])),
    };
  }
  $effect(() => {
    if (request && request !== previousRequest) {
      previousRequest = request;
      const ticket = ++navigationRevision;
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      history = [visit(request.title, request.row)];
      index = 0;
      if (!dialog.open) dialog.showModal();
      void tick().then(() => {
        if (ticket !== navigationRevision || !dialog.open) return;
        body.scrollTop = 0;
        document.getElementById('modal-title')?.focus({ preventScroll: true });
      });
    } else if (!request) {
      previousRequest = null;
      navigationRevision++;
      if (dialog?.open) dialog.close();
    }
  });
  function remember() {
    if (!current) return;
    current.scroll[current.tab] = body.scrollTop;
    current.focus[current.tab] =
      document.activeElement instanceof HTMLElement
        ? (document.activeElement.dataset.detailFocus ?? null)
        : null;
  }
  async function restore(focus = false) {
    await tick();
    body.scrollTop = current?.scroll[current.tab] ?? 0;
    if (focus) {
      const key = current?.focus[current.tab];
      const target = [...body.querySelectorAll<HTMLElement>('[data-detail-focus]')].find(
        (node) => node.dataset.detailFocus === key,
      );
      (target ?? body).focus({ preventScroll: true });
    }
  }
  async function changeTab(tab: string) {
    if (!current || !tabs.some((section) => section.id === tab)) return;
    const focusPanel = body.contains(document.activeElement);
    remember();
    current.tab = tab;
    await restore();
    if (focusPanel && current.tab === tab) {
      document.getElementById('detail-panel-' + tab)?.focus({ preventScroll: true });
    }
  }
  async function navigate(title: string, row: RecordData) {
    if (openAgent && ['group', 'process'].includes(detailKind(row))) {
      navigationRevision++;
      returnFocus = null;
      close();
      openAgent(title, row);
      return;
    }
    remember();
    const ticket = ++navigationRevision;
    await transitionSurface('detail', async () => {
      if (ticket !== navigationRevision) return;
      history = [...history.slice(0, index + 1), visit(title, row)];
      index++;
      await restore(true);
    });
  }
  async function move(delta: number) {
    const next = index + delta;
    if (next < 0 || next >= history.length) return;
    remember();
    const ticket = ++navigationRevision;
    await transitionSurface(
      'detail',
      async () => {
        if (ticket !== navigationRevision) return;
        index = next;
        await restore(true);
      },
      delta,
    );
  }
  function finish() {
    close();
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }
</script>

<dialog
  id="modal"
  class="detail-shell"
  bind:this={dialog}
  onclose={finish}
  oncancel={close}
  aria-labelledby="modal-title"
>
  <div class="modal-head">
    <div class="detail-navigation history-controls">
      <button
        class="history-arrow"
        aria-label="Back"
        disabled={index === 0}
        onclick={() => move(-1)}><Icon name="arrowLeft" /></button
      >
      <button
        class="history-arrow"
        aria-label="Forward"
        disabled={index >= history.length - 1}
        onclick={() => move(1)}><Icon name="chevron" /></button
      >
    </div>
    <div>
      <span class="muted" id="modal-caption"
        >{current ? detailCaption(current.row) : 'Details'}</span
      >
      <h2 id="modal-title" tabindex="-1">
        {current ? detailTitle(current.row, current.title) : 'Details'}
      </h2>
    </div>
    <button class="icon-button" aria-label="Close details" onclick={close}
      ><Icon name="close" /></button
    >
  </div>
  {#if current}<SectionTabs
      {tabs}
      selected={current.tab}
      change={changeTab}
      prefix="detail"
      label="Detail sections"
    />{/if}
  <div id="modal-body" tabindex="-1" bind:this={body}>
    {#if current}{#each tabs as tab (tab.id)}
        <div
          class="detail-tab-panel"
          role="tabpanel"
          id={'detail-panel-' + tab.id}
          aria-labelledby={'detail-tab-' + tab.id}
          tabindex="0"
          hidden={current.tab !== tab.id}
        >
          {#if current.tab === tab.id}
            {#if ['overview', 'attributes', 'signatures'].includes(tab.id)}<DetailSummary
                row={current.row}
                {telemetry}
                section={tab.id}
                changeSection={changeTab}
              />
            {:else if tab.id === 'risk'}<RiskExplanation row={current.row} {telemetry} {navigate} />
            {:else if tab.id === 'controls'}{#key current}<DetailControls
                  row={current.row}
                  {telemetry}
                  {host}
                />{/key}
            {:else}<EntityLinks
                row={current.row}
                {telemetry}
                {navigate}
                section={tab.id}
                bind:query={current.query[tab.id]}
                bind:limit={current.limit[tab.id]}
              />{/if}
          {/if}
        </div>
      {/each}{/if}
  </div>
  <div class="modal-actions">
    {#if current?.row.website}<Action
        action={async () => confirmed(await invoke(host, 'openExternalUrl', current.row.website))}
        ><Icon name="globe" />Website</Action
      >{/if}
    {#if current?.row.instanceId && current.row.process}<button
        class="button"
        aria-pressed={$acknowledgedAgents.has(String(current.row.instanceId))}
        onclick={() => toggleAcknowledged(String(current.row.instanceId))}
        >{$acknowledgedAgents.has(String(current.row.instanceId))
          ? 'Reviewed'
          : 'Mark reviewed'}</button
      >{/if}
    {#if current && (current.row.file || current.row.cwd || (current.row.path && current.row.type !== 'network-connection'))}<Action
        action={async () =>
          confirmed(
            await invoke(
              host,
              'revealInExplorer',
              current.row.file || current.row.cwd || current.row.path,
            ),
          )}>Show in folder</Action
      >{/if}
    {#if current?.row.file && current.row.agent}<Action
        action={async () => {
          confirmed(
            await invoke(host, 'addFalsePositive', {
              agentName: current.row.agent,
              pattern: String(current.row.file).replace(/[.*+?^\x24{}()|[\]\\]/g, '\\$&'),
              timestamp: Date.now(),
            }),
          );
          await refreshFalsePositives();
        }}>Mark false positive</Action
      >{/if}
    <button class="button" onclick={close}>Close</button>
  </div>
</dialog>
