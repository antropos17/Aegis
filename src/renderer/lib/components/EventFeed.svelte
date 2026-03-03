<script>
  /**
   * @file EventFeed.svelte
   * @description Live terminal-style event stream — EDR activity monitor.
   * Replaces the D3 graph tab with a compact, filterable event feed.
   * @since v0.5.0
   */
  import { events, network, agents } from '../stores/ipc.js';
  import {
    fileEventsToFeed,
    networkToFeed,
    filterFeed,
    typeClass,
  } from '../utils/event-feed-utils.ts';

  /** @type {{ active?: boolean }} */
  let { active = true } = $props();

  let filterFile = $state(true);
  let filterNet = $state(true);
  let filterProc = $state(true);
  let filterAnomaly = $state(true);
  let agentFilter = $state('all');
  let autoScroll = $state(true);

  /** @type {HTMLDivElement | undefined} */
  let feedContainer = $state(undefined);

  let cachedEvents = $state([]);
  let cachedNetwork = $state([]);

  $effect(() => {
    if (!active) return;
    cachedEvents = $events;
  });

  $effect(() => {
    if (!active) return;
    cachedNetwork = $network;
  });

  let allEntries = $derived.by(() => {
    const fileEntries = fileEventsToFeed(cachedEvents.flat());
    const netEntries = networkToFeed(cachedNetwork);
    const merged = [...fileEntries, ...netEntries];
    merged.sort((a, b) => a.timestamp - b.timestamp);
    return merged.slice(-200);
  });

  let filteredEntries = $derived(
    filterFeed(allEntries, {
      file: filterFile,
      net: filterNet,
      proc: filterProc,
      anomaly: filterAnomaly,
      agent: agentFilter,
    }),
  );

  let agentNames = $derived([...new Set($agents.map((a) => a.agent))].sort());

  $effect(() => {
    void filteredEntries.length;
    if (autoScroll && feedContainer) {
      requestAnimationFrame(() => {
        if (feedContainer) {
          feedContainer.scrollTop = feedContainer.scrollHeight;
        }
      });
    }
  });

  /** @param {Event} e */
  function handleScroll(e) {
    const el = /** @type {HTMLDivElement} */ (e.target);
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    autoScroll = atBottom;
  }
</script>

<div class="event-feed">
  <div class="feed-toolbar">
    <div class="filter-checks">
      <label class="filter-check">
        <input type="checkbox" bind:checked={filterFile} />
        <span class="type-file">File</span>
      </label>
      <label class="filter-check">
        <input type="checkbox" bind:checked={filterNet} />
        <span class="type-net">Net</span>
      </label>
      <label class="filter-check">
        <input type="checkbox" bind:checked={filterProc} />
        <span class="type-proc">Proc</span>
      </label>
      <label class="filter-check">
        <input type="checkbox" bind:checked={filterAnomaly} />
        <span class="type-anomaly">Anomaly</span>
      </label>
    </div>

    <select class="agent-select" bind:value={agentFilter}>
      <option value="all">All agents</option>
      {#each agentNames as name (name)}
        <option value={name}>{name}</option>
      {/each}
    </select>

    {#if !autoScroll}
      <button
        class="scroll-btn"
        onclick={() => {
          autoScroll = true;
          if (feedContainer) feedContainer.scrollTop = feedContainer.scrollHeight;
        }}
      >
        Follow
      </button>
    {/if}
  </div>

  <div class="feed-lines" bind:this={feedContainer} onscroll={handleScroll}>
    {#each filteredEntries as entry (entry.id)}
      <div class="feed-line">
        <span class="feed-time">{entry.time}</span>
        <span class="feed-type {typeClass(entry.type)}">{entry.type}</span>
        <span class="feed-agent">{entry.agent}</span>
        <span class="feed-detail">{entry.detail}</span>
      </div>
    {:else}
      <div class="feed-empty">No events to display</div>
    {/each}
  </div>
</div>

<style>
  .event-feed {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--aegis-space-4);
    padding: var(--aegis-space-5);
  }

  .feed-toolbar {
    display: flex;
    align-items: center;
    gap: var(--aegis-space-6);
    flex-shrink: 0;
  }

  .filter-checks {
    display: flex;
    gap: var(--aegis-space-5);
  }

  .filter-check {
    display: flex;
    align-items: center;
    gap: var(--aegis-space-2);
    font-size: calc(0.75rem * var(--aegis-ui-scale));
    cursor: pointer;
    user-select: none;
  }

  .filter-check input {
    accent-color: var(--md-sys-color-primary);
  }

  .agent-select {
    padding: var(--aegis-space-2) var(--aegis-space-4);
    background: var(--md-sys-color-surface-container);
    color: var(--md-sys-color-on-surface);
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: var(--md-sys-shape-corner-small);
    font-size: calc(0.75rem * var(--aegis-ui-scale));
    font-family: inherit;
  }

  .scroll-btn {
    margin-left: auto;
    padding: var(--aegis-space-2) var(--aegis-space-5);
    background: var(--md-sys-color-primary);
    color: var(--md-sys-color-on-primary);
    border: none;
    border-radius: var(--md-sys-shape-corner-small);
    font-size: calc(0.75rem * var(--aegis-ui-scale));
    cursor: pointer;
    font-family: inherit;
  }

  .feed-lines {
    flex: 1;
    overflow-y: auto;
    background: var(--md-sys-color-surface-container-lowest);
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: var(--md-sys-shape-corner-small);
    padding: var(--aegis-space-3);
    font-family: 'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace;
    font-size: calc(0.75rem * var(--aegis-ui-scale));
    line-height: 1.6;
  }

  .feed-line {
    display: flex;
    gap: var(--aegis-space-4);
    padding: 1px var(--aegis-space-3);
    border-radius: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .feed-line:hover {
    background: var(--md-sys-color-surface-container);
  }

  .feed-time {
    color: var(--md-sys-color-on-surface-variant);
    flex-shrink: 0;
  }

  .feed-type {
    flex-shrink: 0;
    min-width: 56px;
    font-weight: 600;
    text-align: center;
  }

  .type-file {
    color: var(--md-sys-color-secondary);
  }

  .type-net {
    color: var(--md-sys-color-primary);
  }

  .type-proc {
    color: var(--md-sys-color-error);
  }

  .type-anomaly {
    color: var(--md-sys-color-tertiary);
  }

  .feed-agent {
    color: var(--md-sys-color-on-surface);
    font-weight: 500;
    flex-shrink: 0;
    min-width: 120px;
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .feed-detail {
    color: var(--md-sys-color-on-surface-variant);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .feed-empty {
    color: var(--md-sys-color-on-surface-variant);
    text-align: center;
    padding: var(--aegis-space-11) 0;
    font-style: italic;
    font-family: inherit;
  }
</style>
