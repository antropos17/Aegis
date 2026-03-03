<script>
  /**
   * @file TimelineTab.svelte
   * @description Full-page wrapper for VisTimeline on its own tab.
   * @since v0.5.0
   */
  import VisTimeline from './VisTimeline.svelte';

  /** @type {{ active?: boolean }} */
  let { active = true } = $props();
</script>

<div class="timeline-tab">
  <VisTimeline {active} />
</div>

<style>
  .timeline-tab {
    height: 100%;
    padding: var(--aegis-space-5);
    overflow-y: auto;
  }
</style>
