<script>
  /**
   * @file VisTimeline.svelte
   * @description Interactive timeline using vis-timeline library.
   *   Groups = agents, Items = file/network/anomaly events.
   *   Real-time updates via DataSet.add().
   * @since v0.4.0
   */
  import { onMount } from 'svelte';
  import { events, network, agents } from '../stores/ipc.js';
  import {
    fileEventsToTimeline,
    networkEventsToTimeline,
    buildVisGroups,
    buildVisItems,
    VIS_TIMELINE_OPTIONS,
  } from '../utils/vis-timeline-utils.ts';
  import TimelineLegend from './TimelineLegend.svelte';
  import { buildSummary } from '../utils/timeline-utils.ts';

  /** @type {{ active?: boolean }} */
  let { active = true } = $props();

  let containerEl = $state();
  /** @type {any} */
  let timeline = $state(null);
  /** @type {any} */
  let itemsDataSet = $state(null);
  /** @type {any} */
  let groupsDataSet = $state(null);
  /** @type {any} */
  let selectedEvent = $state(null);

  /** Track last processed event count to only add new ones */
  let lastFileCount = 0;
  let lastNetCount = 0;

  /** Summary for legend (reuses existing buildSummary) */
  /** @type {import('../utils/vis-timeline-utils.ts').TimelineEvent[]} */
  let allEvents = $state([]);
  let summary = $derived(
    buildSummary(
      allEvents.map((e) => ({
        _type: e.eventType === 'network' ? 'network' : 'file',
        flagged: e.flagged,
        sensitive: e.flagged && e.eventType === 'file',
        _denied: false,
        action: e.label,
      })),
    ),
  );

  onMount(async () => {
    if (!containerEl) return;

    const [{ DataSet }, { Timeline }] = await Promise.all([
      import('vis-data'),
      import('vis-timeline/peer'),
    ]);

    await import('vis-timeline/styles/vis-timeline-graph2d.css');

    const items = new DataSet([]);
    const groups = new DataSet([]);

    const tl = new Timeline(containerEl, items, groups, {
      ...VIS_TIMELINE_OPTIONS,
    });

    tl.on('select', (props) => {
      if (props.items.length > 0) {
        selectedEvent = items.get(props.items[0]);
      } else {
        selectedEvent = null;
      }
    });

    itemsDataSet = items;
    groupsDataSet = groups;
    timeline = tl;

    return () => {
      if (timeline) {
        timeline.destroy();
        timeline = null;
      }
    };
  });

  /** Sync groups when agents change */
  $effect(() => {
    if (!active || !groupsDataSet) return;
    const agentList = $agents;
    const newGroups = buildVisGroups(agentList);
    const currentIds = new Set(groupsDataSet.getIds());
    const newIds = new Set(newGroups.map((g) => g.id));

    for (const g of newGroups) {
      if (!currentIds.has(g.id)) {
        groupsDataSet.add(g);
      }
    }
    for (const id of currentIds) {
      if (!newIds.has(id)) {
        groupsDataSet.remove(id);
      }
    }
  });

  /** Add new file events incrementally */
  $effect(() => {
    if (!active || !itemsDataSet) return;
    const fileEvs = $events.flat();
    if (fileEvs.length <= lastFileCount) return;

    const newEvs = fileEvs.slice(lastFileCount);
    lastFileCount = fileEvs.length;

    const timelineEvs = fileEventsToTimeline(newEvs);
    allEvents = [...allEvents, ...timelineEvs].slice(-500);

    const items = buildVisItems(timelineEvs);
    for (const item of items) {
      itemsDataSet.add(item);
    }

    if (timeline) {
      timeline.moveTo(new Date());
    }
  });

  /** Add new network events incrementally */
  $effect(() => {
    if (!active || !itemsDataSet) return;
    const netEvs = $network;
    if (netEvs.length <= lastNetCount) return;

    const newEvs = netEvs.slice(lastNetCount);
    lastNetCount = netEvs.length;

    const timelineEvs = networkEventsToTimeline(newEvs);
    allEvents = [...allEvents, ...timelineEvs].slice(-500);

    const items = buildVisItems(timelineEvs);
    for (const item of items) {
      itemsDataSet.add(item);
    }
  });

  /** Dismiss detail panel */
  function dismissDetail() {
    selectedEvent = null;
    if (timeline) timeline.setSelection([]);
  }
</script>

<div class="vis-timeline-wrap">
  <TimelineLegend {summary} />

  <div class="vis-timeline-container" bind:this={containerEl}></div>

  {#if selectedEvent}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="event-detail" onclick={dismissDetail}>
      <span class="detail-type {selectedEvent.className}">
        {selectedEvent._eventType}
      </span>
      <span class="detail-text">{selectedEvent.title}</span>
      <span class="detail-time">
        {selectedEvent.start.toLocaleTimeString()}
      </span>
    </div>
  {/if}
</div>

<style>
  .vis-timeline-wrap {
    width: 100%;
    box-sizing: border-box;
    background: var(--md-sys-color-surface-container-low);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: var(--aegis-card-border);
    box-shadow:
      0 2px 8px rgba(0, 0, 0, 0.12),
      var(--glass-highlight);
    border-radius: var(--md-sys-shape-corner-medium);
    padding: var(--aegis-space-3) 0;
    overflow: hidden;
  }

  .vis-timeline-container {
    width: 100%;
    min-height: 280px;
  }

  /* vis-timeline dark theme overrides */
  .vis-timeline-container :global(.vis-timeline) {
    border: none;
    background: transparent;
    font-family: 'DM Sans', sans-serif;
  }

  .vis-timeline-container :global(.vis-panel.vis-bottom),
  .vis-timeline-container :global(.vis-panel.vis-center),
  .vis-timeline-container :global(.vis-panel.vis-left),
  .vis-timeline-container :global(.vis-panel.vis-right),
  .vis-timeline-container :global(.vis-panel.vis-top) {
    border-color: var(--md-sys-color-outline);
  }

  .vis-timeline-container :global(.vis-time-axis .vis-text) {
    color: var(--md-sys-color-on-surface-variant);
    font-family: 'DM Mono', monospace;
    font-size: calc(10px * var(--aegis-ui-scale, 1));
  }

  .vis-timeline-container :global(.vis-time-axis .vis-grid.vis-minor) {
    border-color: var(--md-sys-color-outline-variant);
  }

  .vis-timeline-container :global(.vis-time-axis .vis-grid.vis-major) {
    border-color: var(--md-sys-color-outline);
  }

  .vis-timeline-container :global(.vis-labelset .vis-label) {
    color: var(--md-sys-color-on-surface);
    font: var(--md-sys-typescale-label-medium);
    border-bottom-color: var(--md-sys-color-outline-variant);
  }

  .vis-timeline-container :global(.vis-foreground .vis-group) {
    border-bottom-color: var(--md-sys-color-outline-variant);
  }

  .vis-timeline-container :global(.vis-current-time) {
    background-color: var(--md-sys-color-primary);
    opacity: 0.6;
  }

  /* Item type colors */
  .vis-timeline-container :global(.vis-item.vis-item-file) {
    background-color: var(--md-sys-color-secondary);
    border-color: var(--md-sys-color-secondary);
    color: var(--md-sys-color-on-error);
  }

  .vis-timeline-container :global(.vis-item.vis-item-network) {
    background-color: var(--md-sys-color-primary);
    border-color: var(--md-sys-color-primary);
    color: var(--md-sys-color-on-primary);
  }

  .vis-timeline-container :global(.vis-item.vis-item-process) {
    background-color: var(--md-sys-color-error);
    border-color: var(--md-sys-color-error);
    color: var(--md-sys-color-on-error);
  }

  .vis-timeline-container :global(.vis-item.vis-item-anomaly) {
    background-color: #c8907a;
    border-color: #c8907a;
    color: var(--md-sys-color-on-error);
  }

  .vis-timeline-container :global(.vis-item.vis-item-flagged) {
    box-shadow: 0 0 6px rgba(200, 122, 122, 0.5);
  }

  .vis-timeline-container :global(.vis-item.vis-selected) {
    box-shadow: 0 0 8px var(--md-sys-color-primary);
  }

  .vis-timeline-container :global(.vis-item .vis-item-content) {
    font: var(--md-sys-typescale-label-medium);
    font-family: 'DM Mono', monospace;
    padding: 2px 6px;
  }

  /* Detail panel */
  .event-detail {
    display: flex;
    align-items: center;
    gap: var(--aegis-space-4);
    padding: var(--aegis-space-3) var(--aegis-space-6);
    background: var(--md-sys-color-surface-container);
    border-top: 1px solid var(--md-sys-color-outline);
    cursor: pointer;
    font: var(--md-sys-typescale-label-medium);
  }

  .detail-type {
    font-family: 'DM Mono', monospace;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: var(--md-sys-shape-corner-small);
    text-transform: uppercase;
    font-size: calc(9px * var(--aegis-ui-scale, 1));
  }

  .detail-text {
    color: var(--md-sys-color-on-surface);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .detail-time {
    color: var(--md-sys-color-on-surface-variant);
    font-family: 'DM Mono', monospace;
    opacity: 0.7;
  }
</style>
