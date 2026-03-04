<script>
  import { enrichedAgents } from '../stores/risk.js';
  import { t } from '../i18n/index.js';

  let {
    active = true,
    agentFilter = $bindable('all'),
    severityFilter = $bindable('all'),
    typeFilter = $bindable('all'),
    groupByAgent = $bindable(true),
  } = $props();

  /** @type {any[]} */
  let cachedAgents = $state([]);

  $effect(() => {
    if (!active) return;
    cachedAgents = $enrichedAgents;
  });

  /** Unique agent names for dropdown (deduped from enrichedAgents) */
  let uniqueNames = $derived([...new Set(cachedAgents.map((a) => a.name))].sort());

  const severities = [
    { value: 'all', key: 'activity.filters.severity_all' },
    { value: 'critical', key: 'activity.filters.severity_critical' },
    { value: 'high', key: 'activity.filters.severity_high' },
    { value: 'medium', key: 'activity.filters.severity_medium' },
    { value: 'low', key: 'activity.filters.severity_low' },
  ];
  const types = [
    { value: 'all', key: 'activity.filters.type_all' },
    { value: 'file', key: 'activity.filters.type_file' },
    { value: 'network', key: 'activity.filters.type_network' },
  ];
</script>

<div class="filters-bar">
  <div class="filter-section">
    <button
      class="pill group-toggle"
      class:active={groupByAgent}
      onclick={() => (groupByAgent = !groupByAgent)}>{$t('activity.filters.group_by_agent')}</button
    >

    <select class="agent-select" bind:value={agentFilter}>
      <option value="all">{$t('activity.filters.all_agents')}</option>
      {#each uniqueNames as name (name)}
        <option value={name}>{name}</option>
      {/each}
    </select>
  </div>

  <span class="divider"></span>

  <div class="filter-section">
    <span class="pill-label">{$t('activity.filters.severity')}</span>
    <div class="pill-group">
      {#each severities as sev (sev.value)}
        <button
          class="pill sev-{sev.value}"
          class:active={severityFilter === sev.value}
          onclick={() => (severityFilter = sev.value)}>{$t(sev.key)}</button
        >
      {/each}
    </div>
  </div>

  <span class="divider"></span>

  <div class="filter-section">
    <span class="pill-label">{$t('activity.filters.type')}</span>
    <div class="pill-group">
      {#each types as type (type.value)}
        <button
          class="pill"
          class:active={typeFilter === type.value}
          onclick={() => (typeFilter = type.value)}>{$t(type.key)}</button
        >
      {/each}
    </div>
  </div>
</div>

<style>
  .filters-bar {
    display: flex;
    align-items: center;
    gap: var(--aegis-space-6);
    padding: var(--aegis-space-6) var(--aegis-space-8);
    background: var(--md-sys-color-surface-container-low-opaque);
    border: var(--aegis-card-border);
    box-shadow:
      0 2px 8px rgba(0, 0, 0, 0.12),
      var(--glass-highlight);
    border-radius: var(--md-sys-shape-corner-medium);
    flex-wrap: wrap;
  }

  .filter-section {
    display: flex;
    align-items: center;
    gap: var(--aegis-space-4);
  }

  .divider {
    width: 1px;
    height: var(--aegis-space-9);
    background: var(--md-sys-color-outline-variant);
    flex-shrink: 0;
  }

  .agent-select {
    font: var(--md-sys-typescale-body-medium);
    background: var(--md-sys-color-surface-container-high);
    color: var(--md-sys-color-on-surface);
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-sys-shape-corner-small);
    padding: var(--aegis-space-3) var(--aegis-space-6);
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
    gap: var(--aegis-space-3);
    flex-wrap: wrap;
  }

  .pill-label {
    font: var(--md-sys-typescale-label-large);
    color: var(--md-sys-color-on-surface-variant);
    white-space: nowrap;
  }

  .pill {
    font: var(--md-sys-typescale-label-large);
    font-weight: 600;
    padding: var(--aegis-space-3) var(--aegis-space-6);
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-sys-shape-corner-full);
    background: transparent;
    color: var(--md-sys-color-on-surface-variant);
    cursor: pointer;
    text-transform: capitalize;
    white-space: nowrap;
    transition:
      background 0.2s var(--ease-glass),
      color 0.2s var(--ease-glass),
      border-color 0.2s var(--ease-glass),
      transform 0.15s var(--ease-glass);
  }

  .pill:hover {
    background: var(--md-sys-color-outline-variant);
    color: var(--md-sys-color-on-surface);
    border-color: var(--aegis-border-hover);
  }

  .pill:active {
    transform: scale(0.96);
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
