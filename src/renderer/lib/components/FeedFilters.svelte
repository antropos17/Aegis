<script>
  import { enrichedAgents } from '../stores/risk.js';

  let {
    agentFilter = $bindable('all'),
    severityFilter = $bindable('all'),
    typeFilter = $bindable('all'),
  } = $props();

  const severities = ['all', 'critical', 'high', 'medium', 'low'];
  const types = ['all', 'file', 'network'];
</script>

<div class="filters-bar">
  <select class="agent-select" bind:value={agentFilter}>
    <option value="all">All agents</option>
    {#each $enrichedAgents as agent (agent.pid)}
      <option value={agent.name}>{agent.name}</option>
    {/each}
  </select>

  <div class="pill-group">
    <span class="pill-label">Severity</span>
    {#each severities as sev}
      <button
        class="pill sev-{sev}"
        class:active={severityFilter === sev}
        onclick={() => (severityFilter = sev)}
      >{sev}</button>
    {/each}
  </div>

  <div class="pill-group">
    <span class="pill-label">Type</span>
    {#each types as type}
      <button
        class="pill"
        class:active={typeFilter === type}
        onclick={() => (typeFilter = type)}
      >{type}</button>
    {/each}
  </div>
</div>

<style>
  .filters-bar {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 10px 14px;
    background: var(--md-sys-color-surface-container);
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-sys-shape-corner-medium);
    flex-wrap: wrap;
  }

  .agent-select {
    font: var(--md-sys-typescale-body-medium);
    background: var(--md-sys-color-surface-container-high);
    color: var(--md-sys-color-on-surface);
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-sys-shape-corner-small);
    padding: 5px 10px;
    cursor: pointer;
    min-width: 120px;
  }

  .agent-select:focus {
    outline: 1px solid var(--md-sys-color-primary);
    outline-offset: -1px;
  }

  .pill-group {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .pill-label {
    font: var(--md-sys-typescale-label-medium);
    color: var(--md-sys-color-on-surface-variant);
    margin-right: 4px;
  }

  .pill {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 600;
    padding: 4px 10px;
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-sys-shape-corner-full);
    background: transparent;
    color: var(--md-sys-color-on-surface-variant);
    cursor: pointer;
    text-transform: capitalize;
    transition:
      background var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard),
      color var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard),
      border-color var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
  }

  .pill:hover {
    background: var(--md-sys-color-surface-container-high);
    color: var(--md-sys-color-on-surface);
  }

  .pill.active {
    background: var(--md-sys-color-primary-container);
    color: var(--md-sys-color-on-surface);
    border-color: var(--md-sys-color-primary);
  }

  .pill.active.sev-critical {
    background: color-mix(in srgb, var(--md-sys-color-error) 25%, transparent);
    border-color: var(--md-sys-color-error);
  }

  .pill.active.sev-high {
    background: color-mix(in srgb, var(--md-sys-color-secondary) 25%, transparent);
    border-color: var(--md-sys-color-secondary);
  }

  .pill.active.sev-medium {
    background: color-mix(in srgb, var(--md-sys-color-primary) 25%, transparent);
    border-color: var(--md-sys-color-primary);
  }

  .pill.active.sev-low {
    background: color-mix(in srgb, var(--md-sys-color-on-surface-variant) 20%, transparent);
    border-color: var(--md-sys-color-on-surface-variant);
  }
</style>
