<script>
  import Radar from './Radar.svelte';
  import AgentPanel from './AgentPanel.svelte';
  import Timeline from './Timeline.svelte';
  import FeedFilters from './FeedFilters.svelte';
  import ActivityFeed from './ActivityFeed.svelte';

  let agentFilter = $state('all');
  let severityFilter = $state('all');
  let typeFilter = $state('all');
</script>

<div class="shield-layout">
  <div class="radar-area">
    <Radar />
  </div>
  <div class="agents-area">
    <AgentPanel />
  </div>
  <div class="timeline-area">
    <Timeline />
  </div>
  <div class="feed-area">
    <FeedFilters bind:agentFilter bind:severityFilter bind:typeFilter />
    <ActivityFeed {agentFilter} {severityFilter} {typeFilter} />
  </div>
</div>

<style>
  .shield-layout {
    display: grid;
    grid-template-columns: var(--aegis-size-panel-col) minmax(0, 1fr) var(--aegis-size-panel-col);
    grid-template-rows: auto auto 1fr;
    gap: var(--aegis-space-8);
    height: 100%;
    padding: var(--aegis-space-5);
    overflow: hidden;
  }

  .radar-area {
    grid-column: 2;
    grid-row: 1;
    max-height: 380px;
    overflow: hidden;
    display: flex;
    align-items: flex-start;
    justify-content: center;
  }

  .agents-area {
    grid-column: 3;
    grid-row: 1;
    overflow-y: auto;
    min-height: 0;
    max-height: 380px;
  }

  .timeline-area {
    grid-column: 1 / -1;
    grid-row: 2;
    min-width: 0;
    padding: var(--aegis-space-1) var(--aegis-space-3);
  }

  .feed-area {
    grid-column: 1 / -1;
    grid-row: 3;
    overflow-y: auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--aegis-space-7);
    padding: var(--aegis-space-1) var(--aegis-space-3);
  }

  @media (max-width: 960px) {
    .shield-layout {
      grid-template-columns: 1fr;
      grid-template-rows: 380px auto auto 1fr;
    }

    .radar-area {
      grid-column: 1;
    }

    .agents-area {
      grid-column: 1;
      grid-row: 2;
      max-height: 200px;
    }

    .timeline-area {
      grid-column: 1;
      grid-row: 3;
    }

    .feed-area {
      grid-column: 1;
      grid-row: 4;
    }
  }
</style>
