<script>
  import FeedFilters from './FeedFilters.svelte';
  import ActivityFeed from './ActivityFeed.svelte';
  import GroupedFeed from './GroupedFeed.svelte';
  import NetworkPanel from './NetworkPanel.svelte';
  import SkeletonLoader from './SkeletonLoader.svelte';
  import { events, network, firstScanDone, liveDataUnavailable } from '../stores/ipc.js';
  import { t } from '../i18n/index.js';

  /** @type {{ active?: boolean }} */
  let { active = true } = $props();

  let view = $state('feed');
  let agentFilter = $state('all');
  let severityFilter = $state('all');
  let typeFilter = $state('all');
  let groupByAgent = $state(true);

  // A completed quiet scan is ready too. Network data arrives independently of files.
  let dataReady = $derived(
    $firstScanDone ||
      $events.some((batch) => batch.length > 0) ||
      $network.length > 0 ||
      liveDataUnavailable,
  );
</script>

<div class="activity-tab">
  <div class="view-toggle">
    <button
      class="toggle-pill"
      class:active={view === 'feed'}
      aria-pressed={view === 'feed'}
      onclick={() => (view = 'feed')}>{$t('activity.tabs.feed')}</button
    >
    <button
      class="toggle-pill"
      class:active={view === 'network'}
      aria-pressed={view === 'network'}
      onclick={() => (view = 'network')}>{$t('activity.tabs.network')}</button
    >
  </div>

  {#if view === 'network'}
    <NetworkPanel {active} />
  {:else if !dataReady}
    <div class="activity-skeleton">
      <SkeletonLoader lines={1} style="card" />
      <SkeletonLoader lines={5} style="list" />
    </div>
  {:else}
    <FeedFilters {active} bind:agentFilter bind:severityFilter bind:typeFilter bind:groupByAgent />
    {#if groupByAgent}
      <GroupedFeed {active} {agentFilter} {severityFilter} {typeFilter} />
    {:else}
      <ActivityFeed {active} {agentFilter} {severityFilter} {typeFilter} />
    {/if}
  {/if}
</div>

<style>
  .activity-tab {
    display: flex;
    flex-direction: column;
    gap: var(--aegis-space-6);
    height: 100%;
    min-height: 0;
  }

  .view-toggle {
    display: flex;
    gap: var(--aegis-space-2);
    padding: calc(3px * var(--aegis-ui-scale));
    background: var(--md-sys-color-surface-container-low);
    border: var(--glass-border);
    border-radius: var(--md-sys-shape-corner-full);
    width: fit-content;
  }

  .toggle-pill {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 600;
    padding: var(--aegis-space-3) var(--aegis-space-8);
    border: none;
    border-radius: var(--md-sys-shape-corner-full);
    background: transparent;
    color: var(--md-sys-color-on-surface-variant);
    cursor: pointer;
    transition: all 0.3s var(--ease-glass);
  }

  .toggle-pill:hover {
    color: var(--md-sys-color-on-surface);
    background: var(--md-sys-color-outline-variant);
  }

  .toggle-pill.active {
    background: var(--md-sys-color-primary-container);
    color: var(--md-sys-color-on-surface);
    box-shadow: 0 2px 12px rgba(42, 58, 78, 0.4);
  }

  .activity-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--aegis-space-6);
    flex: 1;
    min-height: 0;
  }
</style>
