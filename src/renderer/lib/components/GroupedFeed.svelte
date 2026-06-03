<script>
  import { SvelteSet } from 'svelte/reactivity';
  import { events, network } from '../stores/ipc.js';
  import { enrichedAgents } from '../stores/risk.js';
  import { t } from '../i18n/index.js';
  import GroupedFeedItem from './GroupedFeedItem.svelte';
  import {
    formatTime,
    buildUnifiedEvents,
    filterEvents,
    groupByAgent,
  } from '../utils/grouped-feed-utils';

  let { active = true, agentFilter = 'all', severityFilter = 'all', typeFilter = 'all' } = $props();
  let expandedGroups = new SvelteSet();
  let expandedEvent = $state(null);

  /**
   * Max events rendered per sub-list before a "show more" toggle. Without this,
   * a single agent can absorb the whole 200-event cap and an expanded group
   * renders up to ~200 items x ~5 nodes = ~1000 DOM nodes (perf-audit P4).
   */
  const SUB_CAP = 50;
  /** Keys (`${group.name}-${sub.label}`) of sub-lists the user expanded fully. */
  let expandedSubs = new SvelteSet();

  function toggleSub(key) {
    expandedSubs.has(key) ? expandedSubs.delete(key) : expandedSubs.add(key);
  }

  /** @type {any[][]} */
  let cachedEvents = $state([]);
  /** @type {any[]} */
  let cachedNetwork = $state([]);
  /** @type {any[]} */
  let cachedAgents = $state([]);

  $effect(() => {
    if (!active) return;
    cachedEvents = $events;
  });

  $effect(() => {
    if (!active) return;
    cachedNetwork = $network;
  });

  $effect(() => {
    if (!active) return;
    cachedAgents = $enrichedAgents;
  });

  let unified = $derived(buildUnifiedEvents(cachedEvents, cachedNetwork));
  let filtered = $derived(filterEvents(unified, agentFilter, severityFilter, typeFilter));
  let groups = $derived(groupByAgent(filtered, cachedAgents));

  function toggleGroup(name) {
    expandedGroups.has(name) ? expandedGroups.delete(name) : expandedGroups.add(name);
  }

  function toggleEvent(key) {
    expandedEvent = expandedEvent === key ? null : key;
  }
</script>

<div class="feed-scroll">
  {#if groups.length === 0}
    <div class="feed-empty">{$t('activity.feed.no_events')}</div>
  {:else}
    {#each groups as group (group.name)}
      {@const open = expandedGroups.has(group.name)}
      <button class="group-header" aria-expanded={open} onclick={() => toggleGroup(group.name)}>
        <span class="chevron">{open ? '\u25BE' : '\u25B8'}</span>
        <span class="group-name">{group.name}</span>
        <span class="group-count"
          >{group.count === 1
            ? $t('activity.groups.events_singular', { count: group.count })
            : $t('activity.groups.events_plural', { count: group.count })}</span
        >
        <span class="group-time">{formatTime(group.lastActivity)}</span>
        <span
          class="group-badge"
          class:sev-critical={group.severity === 'critical'}
          class:sev-high={group.severity === 'high'}
          class:sev-medium={group.severity === 'medium'}
          >{group.trustGrade} &middot; {group.riskScore}</span
        >
      </button>
      {#if open}
        <div class="group-body">
          {#each [{ label: $t('activity.groups.file_access'), evs: group.fileEvents }, { label: $t('activity.groups.config_access'), evs: group.configEvents }, { label: $t('activity.groups.network'), evs: group.networkEvents }] as sub (sub.label)}
            {#if sub.evs.length > 0}
              {@const subKey = `${group.name}-${sub.label}`}
              {@const showAll = expandedSubs.has(subKey)}
              {@const shown = showAll ? sub.evs : sub.evs.slice(0, SUB_CAP)}
              <div class="sub-label">{sub.label} ({sub.evs.length})</div>
              {#each shown as ev, i (`${ev.timestamp}-${i}`)}
                <GroupedFeedItem
                  {ev}
                  index={i}
                  groupKey={`${group.name}-${sub.label}-${i}`}
                  {expandedEvent}
                  onToggle={toggleEvent}
                />
              {/each}
              {#if sub.evs.length > SUB_CAP}
                <button class="show-more" onclick={() => toggleSub(subKey)}>
                  {showAll
                    ? $t('activity.groups.show_less')
                    : $t('activity.groups.show_more', { count: sub.evs.length - SUB_CAP })}
                </button>
              {/if}
            {/if}
          {/each}
        </div>
      {/if}
    {/each}
  {/if}
</div>

<style>
  .feed-scroll {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }
  .feed-empty {
    padding: calc(40px * var(--aegis-ui-scale)) var(--aegis-space-9);
    text-align: center;
    font: var(--md-sys-typescale-body-medium);
    color: var(--md-sys-color-on-surface-variant);
  }

  .group-header {
    display: flex;
    align-items: center;
    gap: var(--aegis-space-4);
    width: 100%;
    padding: var(--aegis-space-3) var(--aegis-space-6);
    background: var(--md-sys-color-surface-container-low);
    border: none;
    border-bottom: 1px solid var(--fancy-border);
    cursor: pointer;
    font-size: calc(12px * var(--aegis-ui-scale));
    font-family: var(--fancy-font-body);
    color: var(--md-sys-color-on-surface);
    text-align: left;
    transition: background var(--fancy-transition-micro) var(--fancy-ease);
  }
  .group-header:hover {
    background: var(--fancy-surface-hover);
  }
  .chevron {
    font-size: calc(10px * var(--aegis-ui-scale));
    width: 12px;
    color: var(--md-sys-color-on-surface-variant);
  }
  .group-name {
    font-weight: 700;
    flex-shrink: 0;
  }
  .group-count {
    font-family: var(--fancy-font-mono);
    color: var(--fancy-text-2);
    font-size: calc(10px * var(--aegis-ui-scale));
  }
  .group-time {
    font-family: var(--fancy-font-mono);
    color: var(--fancy-text-2);
    font-size: calc(10px * var(--aegis-ui-scale));
    margin-left: auto;
  }

  .group-badge {
    font-size: calc(9px * var(--aegis-ui-scale));
    font-weight: 700;
    font-family: var(--fancy-font-mono);
    padding: var(--aegis-space-1) var(--aegis-space-4);
    border-radius: var(--md-sys-shape-corner-full);
    flex-shrink: 0;
    background: rgba(122, 138, 158, 0.1);
    color: var(--fancy-text-2);
  }
  .group-badge.sev-critical {
    background: var(--fancy-danger-bg);
    color: var(--fancy-danger);
  }
  .group-badge.sev-high {
    background: var(--fancy-warning-bg);
    color: var(--fancy-warning);
  }
  .group-badge.sev-medium {
    background: var(--fancy-info-bg);
    color: var(--fancy-info);
  }

  .group-body {
    padding-left: var(--aegis-space-6);
    border-left: 2px solid var(--fancy-border);
    margin-left: var(--aegis-space-3);
  }
  .sub-label {
    font-size: calc(9px * var(--aegis-ui-scale));
    font-weight: 700;
    font-family: var(--fancy-font-mono);
    letter-spacing: 0.5px;
    color: var(--fancy-text-2);
    padding: var(--aegis-space-3) var(--aegis-space-6) var(--aegis-space-1);
    text-transform: uppercase;
  }

  .show-more {
    display: block;
    width: 100%;
    text-align: left;
    padding: var(--aegis-space-2) var(--aegis-space-6);
    background: none;
    border: none;
    cursor: pointer;
    font-size: calc(10px * var(--aegis-ui-scale));
    font-family: var(--fancy-font-mono);
    font-weight: 700;
    letter-spacing: 0.5px;
    color: var(--md-sys-color-primary);
    transition: color var(--fancy-transition-micro) var(--fancy-ease);
  }
  .show-more:hover {
    color: var(--md-sys-color-on-surface);
  }
</style>
