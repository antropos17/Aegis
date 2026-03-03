<script>
  /**
   * @file GraphTab.svelte
   * @description Full-page wrapper for AgentGraph on its own tab.
   * @since v0.5.0
   */
  import AgentGraph from './AgentGraph.svelte';

  /** @type {{ active?: boolean }} */
  let { active = true } = $props();
</script>

<div class="graph-tab">
  <AgentGraph {active} />
</div>

<style>
  .graph-tab {
    height: 100%;
    padding: var(--aegis-space-5);
    overflow-y: auto;
  }
</style>
