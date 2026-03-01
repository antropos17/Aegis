<script>
  import FeedFilters from './FeedFilters.svelte';
  import ActivityFeed from './ActivityFeed.svelte';
  import GroupedFeed from './GroupedFeed.svelte';
  import NetworkPanel from './NetworkPanel.svelte';
  import { t } from '../i18n/index.js';

  let view = $state('feed');
  let agentFilter = $state('all');
  let severityFilter = $state('all');
  let typeFilter = $state('all');
  let groupByAgent = $state(true);
</script>

<div class="activity-tab">
  <div class="view-toggle">
    <button class="toggle-pill" class:active={view === 'feed'} onclick={() => (view = 'feed')}
      >{$t('activity.tabs.feed')}</button
    >
    <button class="toggle-pill" class:active={view === 'network'} onclick={() => (view = 'network')}
      >{$t('activity.tabs.network')}</button
    >
  </div>

  {#if view === 'feed'}
    <FeedFilters bind:agentFilter bind:severityFilter bind:typeFilter bind:groupByAgent />
    {#if groupByAgent}
      <GroupedFeed {agentFilter} {severityFilter} {typeFilter} />
    {:else}
      <ActivityFeed {agentFilter} {severityFilter} {typeFilter} />
    {/if}
  {:else}
    <NetworkPanel />
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
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
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
    background: rgba(255, 255, 255, 0.04);
  }

  .toggle-pill.active {
    background: var(--md-sys-color-primary);
    color: var(--md-sys-color-on-primary);
    box-shadow: 0 2px 12px rgba(122, 138, 158, 0.3);
  }
</style>
