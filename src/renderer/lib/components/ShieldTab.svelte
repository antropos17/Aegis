<script>
  import Radar from './Radar.svelte';
  import AgentPanel from './AgentPanel.svelte';
</script>

<div class="shield-tab">
  <div class="radar-col">
    <Radar />
  </div>
  <div class="agents-col">
    <AgentPanel />
  </div>
</div>

<style>
  .shield-tab {
    display: flex;
    gap: 16px;
    padding: 16px;
    height: 100%;
    min-height: 0;
  }

  .radar-col {
    flex: 0 0 60%;
    min-width: 0;
    display: flex;
    align-items: flex-start;
  }

  .agents-col {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
  }

  @media (max-width: 768px) {
    .shield-tab {
      flex-direction: column;
    }

    .radar-col {
      flex: none;
      width: 100%;
    }

    .agents-col {
      flex: 1;
      width: 100%;
    }
  }
</style>
