<script>
  import FeedFilters from './FeedFilters.svelte';
  import ActivityFeed from './ActivityFeed.svelte';

  let agentFilter = $state('all');
  let severityFilter = $state('all');
  let typeFilter = $state('all');
</script>

<div class="activity-tab">
  <FeedFilters bind:agentFilter bind:severityFilter bind:typeFilter />
  <ActivityFeed {agentFilter} {severityFilter} {typeFilter} />
</div>

<style>
  .activity-tab {
    display: flex;
    flex-direction: column;
    gap: 12px;
    height: 100%;
    min-height: 0;
  }
</style>
