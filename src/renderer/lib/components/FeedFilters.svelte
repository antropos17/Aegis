<script>
  import { enrichedAgents } from '../stores/risk.js';

  let {
    agentFilter = $bindable('all'),
    severityFilter = $bindable('all'),
    typeFilter = $bindable('all'),
    groupByAgent = $bindable(true),
  } = $props();

  const severities = ['all', 'critical', 'high', 'medium', 'low'];
  const types = ['all', 'file', 'network'];
</script>

<div class="filters-bar">
  <button
    class="pill group-toggle"
    class:active={groupByAgent}
    onclick={() => (groupByAgent = !groupByAgent)}>Group by agent</button
  >

  <select class="agent-select" bind:value={agentFilter}>
    <option value="all">All agents</option>
    {#each $enrichedAgents as agent (agent.pid)}
      <option value={agent.name}>{agent.name}</option>
    {/each}
  </select>

  <div class="pill-group">
    <span class="pill-label">Severity</span>
    {#each severities as sev (sev)}
      <button
        class="pill sev-{sev}"
        class:active={severityFilter === sev}
        onclick={() => (severityFilter = sev)}>{sev}</button
      >
    {/each}
  </div>

  <div class="pill-group">
    <span class="pill-label">Type</span>
    {#each types as type (type)}
      <button class="pill" class:active={typeFilter === type} onclick={() => (typeFilter = type)}
        >{type}</button
      >
    {/each}
  </div>
</div>

<style>
  .filters-bar {
    display: flex;
    align-items: center;
    gap: var(--aegis-space-8);
    padding: var(--aegis-space-5) var(--aegis-space-7);
    background: var(--md-sys-color-surface-container-low);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: var(--aegis-card-border);
    box-shadow:
      0 2px 8px rgba(0, 0, 0, 0.12),
      var(--glass-highlight);
    border-radius: var(--md-sys-shape-corner-medium);
    flex-wrap: wrap;
  }

  .agent-select {
    font: var(--md-sys-typescale-body-medium);
    background: var(--md-sys-color-surface-container-high);
    color: var(--md-sys-color-on-surface);
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-sys-shape-corner-small);
    padding: var(--aegis-space-3) var(--aegis-space-5);
    cursor: pointer;
    min-width: var(--aegis-col-agent);
  }

  .agent-select:focus {
    outline: 1px solid var(--md-sys-color-primary);
    outline-offset: -1px;
  }

  .pill-group {
    display: flex;
    align-items: center;
    gap: var(--aegis-space-2);
  }

  .pill-label {
    font: var(--md-sys-typescale-label-medium);
    color: var(--md-sys-color-on-surface-variant);
    margin-right: var(--aegis-space-2);
  }

  .pill {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 600;
    padding: var(--aegis-space-2) var(--aegis-space-5);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: var(--md-sys-shape-corner-full);
    background: transparent;
    color: var(--md-sys-color-on-surface-variant);
    cursor: pointer;
    text-transform: capitalize;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    transition: all 0.3s var(--ease-glass);
  }

  .pill:hover {
    background: rgba(255, 255, 255, 0.04);
    color: var(--md-sys-color-on-surface);
    border-color: rgba(255, 255, 255, 0.15);
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

  .group-toggle {
    border-width: 1.5px;
  }

  .group-toggle.active {
    background: var(--md-sys-color-primary-container);
    color: var(--md-sys-color-on-surface);
    border-color: var(--md-sys-color-primary);
  }
</style>
