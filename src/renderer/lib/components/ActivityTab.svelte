<script>
  import FeedFilters from './FeedFilters.svelte';
  import ActivityFeed from './ActivityFeed.svelte';
  import NetworkPanel from './NetworkPanel.svelte';

  let view = $state('feed');
  let agentFilter = $state('all');
  let severityFilter = $state('all');
  let typeFilter = $state('all');
</script>

<div class="activity-tab">
  <div class="view-toggle">
    <button
      class="toggle-pill"
      class:active={view === 'feed'}
      onclick={() => (view = 'feed')}
    >Feed</button>
    <button
      class="toggle-pill"
      class:active={view === 'network'}
      onclick={() => (view = 'network')}
    >Network</button>
  </div>

  {#if view === 'feed'}
    <FeedFilters bind:agentFilter bind:severityFilter bind:typeFilter />
    <ActivityFeed {agentFilter} {severityFilter} {typeFilter} />
  {:else}
    <NetworkPanel />
  {/if}
</div>

<style>
  .activity-tab {
    display: flex;
    flex-direction: column;
    gap: 12px;
    height: 100%;
    min-height: 0;
  }

  .view-toggle {
    display: flex;
    gap: 4px;
    padding: 3px;
    background: var(--md-sys-color-surface-container);
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-sys-shape-corner-full);
    width: fit-content;
  }

  .toggle-pill {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 600;
    padding: 5px 16px;
    border: none;
    border-radius: var(--md-sys-shape-corner-full);
    background: transparent;
    color: var(--md-sys-color-on-surface-variant);
    cursor: pointer;
    transition: all var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
  }

  .toggle-pill:hover {
    color: var(--md-sys-color-on-surface);
  }

  .toggle-pill.active {
    background: var(--md-sys-color-primary-container);
    color: var(--md-sys-color-on-surface);
  }
</style>
