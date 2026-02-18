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
    grid-template-columns: 1fr 320px;
    grid-template-rows: auto 32px 1fr;
    gap: 10px;
    height: 100%;
    padding: 10px;
    overflow: hidden;
  }

  .radar-area {
    grid-column: 1;
    grid-row: 1;
    max-height: 380px;
    overflow: hidden;
    display: flex;
    align-items: flex-start;
  }

  .agents-area {
    grid-column: 2;
    grid-row: 1;
    overflow-y: auto;
    min-height: 0;
  }

  .timeline-area {
    grid-column: 1 / -1;
    grid-row: 2;
  }

  .feed-area {
    grid-column: 1 / -1;
    grid-row: 3;
    overflow-y: auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  @media (max-width: 768px) {
    .shield-layout {
      grid-template-columns: 1fr;
      grid-template-rows: auto auto 32px 1fr;
    }

    .agents-area {
      grid-column: 1;
      grid-row: 2;
      max-height: 240px;
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
