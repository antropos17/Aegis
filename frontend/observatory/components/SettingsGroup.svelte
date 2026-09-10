<script lang="ts">
  import type { Snippet } from 'svelte';
  let { title, description, children }: { title: string; description: string; children: Snippet } =
    $props();
</script>

<section class="settings-group" aria-label={title}>
  <header>
    <h2>{title}</h2>
    <p>{description}</p>
  </header>
  <div class="group-fields">{@render children()}</div>
</section>

<style>
  .settings-group {
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: var(--surface-radius);
    background: var(--panel);
  }
  header {
    padding: var(--panel-inset);
    border-bottom: 1px solid var(--border);
  }
  h2 {
    margin: 0;
    font-size: var(--text-section);
  }
  p {
    margin: var(--space-1) 0 0;
    color: var(--muted);
    font-size: var(--text-caption);
    line-height: 1.5;
  }
  .group-fields {
    padding: 0 var(--panel-inset);
  }
  .group-fields :global(.setting) {
    margin: 0;
    padding: var(--space-4) 0;
    gap: var(--space-4);
    align-items: center;
  }
  .group-fields :global(.setting + .setting) {
    border-top: 1px solid var(--border);
  }
  .group-fields :global(.setting > span:first-child) {
    flex: 1;
    min-width: 0;
    font-size: var(--text-body);
  }
  .group-fields :global(.setting small),
  .group-fields :global(.setting-stack small) {
    color: var(--muted);
    line-height: 1.5;
    font-size: var(--text-caption);
  }
  .group-fields :global(.setting > select) {
    width: 220px;
    max-width: 45%;
  }
  .group-fields :global(.setting-stack) {
    margin: var(--space-4) 0;
  }
  .group-fields :global(textarea) {
    resize: vertical;
    min-height: 90px;
    font-family: var(--mono);
  }
  .group-fields :global(.setting input[type='checkbox']) {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    accent-color: var(--accent);
  }
  .group-fields :global(.setting.range) {
    flex-wrap: wrap;
  }
  .group-fields :global(.setting.range input[type='range']) {
    flex: 1;
    min-width: 140px;
  }
  .group-fields :global(.setting.range input[type='number']) {
    flex: 0 0 100px;
    min-width: 0;
    width: 100px;
  }
  .group-fields :global(.setting output) {
    font-variant-numeric: tabular-nums;
    color: var(--ink);
  }
  .group-fields :global(.presets) {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: 0 0 var(--space-4);
  }
  .group-fields :global(.presets button[aria-pressed='true']) {
    background: var(--hover);
    border-color: var(--strong-border);
  }
  .group-fields :global(.toolbar) {
    margin: var(--space-3) 0 var(--space-4);
  }
  .group-fields :global(.muted) {
    font-size: var(--text-body);
    line-height: 1.5;
  }
</style>
