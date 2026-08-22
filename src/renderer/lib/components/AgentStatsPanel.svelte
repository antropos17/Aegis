<script>
  /**
   * @file AgentStatsPanel.svelte
   * @description Sortable agent statistics table — EDR-style dashboard view.
   * Replaces the vis-timeline tab with a compact, data-focused table.
   * @since v0.5.0
   */
  import { enrichedAgents } from '../stores/risk.js';
  import { focusedAgentInstanceId } from '../stores/ipc.js';
  import {
    toStatsRows,
    sortRows,
    formatRelativeTime,
    riskColor,
  } from '../utils/agent-stats-utils.ts';
  import { focusInstanceId } from '../utils/agent-selection.ts';
  import { tick, startTick } from '../stores/tick.ts';
  import { populationUnknown } from '../stores/app-health.js';
  import { t } from '../i18n/index.js';

  /** @type {{ active?: boolean }} */
  let { active = true } = $props();

  /** @type {import('../utils/agent-stats-utils.ts').SortColumn} */
  let sortColumn = $state('risk');
  /** @type {import('../utils/agent-stats-utils.ts').SortDirection} */
  let sortDir = $state('desc');

  let now = $derived.by(() => {
    $tick; // subscribe — re-derive each tick
    return Date.now();
  });
  let localAgents = $state([]);

  $effect(() => {
    if (!active) return;
    localAgents = $enrichedAgents;
  });

  $effect(() => {
    if (!active) return;
    return startTick();
  });

  let rows = $derived(sortRows(toStatsRows(localAgents, now), sortColumn, sortDir));

  /**
   * Toggle sort on a column header click.
   * @param {import('../utils/agent-stats-utils.ts').SortColumn} col
   */
  function toggleSort(col) {
    if (sortColumn === col) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortColumn = col;
      sortDir = col === 'agent' ? 'asc' : 'desc';
    }
  }

  /**
   * Get sort indicator arrow for column header.
   * @param {string} col
   * @returns {string}
   */
  function sortArrow(col) {
    if (sortColumn !== col) return '';
    return sortDir === 'asc' ? ' \u25B2' : ' \u25BC';
  }

  /**
   * Handle row click — focus the exact live instance in AgentPanel.
   * @param {{ instanceId?: string | null }} row
   */
  function handleRowClick(row) {
    const id = focusInstanceId(row);
    if (id === null) return;
    focusedAgentInstanceId.set(id);
  }
</script>

<div class="stats-panel">
  <table class="stats-table">
    <thead>
      <tr>
        <th class="col-agent" onclick={() => toggleSort('agent')}>
          {$t('stats.columns.agent')}{sortArrow('agent')}
        </th>
        <th class="col-status">{$t('stats.columns.status')}</th>
        <th class="col-risk" onclick={() => toggleSort('risk')}>
          {$t('stats.columns.risk')}{sortArrow('risk')}
        </th>
        <th class="col-files" onclick={() => toggleSort('files')}>
          {$t('stats.columns.file_activity')}{sortArrow('files')}
        </th>
        <th class="col-net" onclick={() => toggleSort('network')}>
          {$t('stats.columns.network')}{sortArrow('network')}
        </th>
        <th class="col-seen">{$t('stats.columns.last_seen')}</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as row (row.name)}
        <tr class="agent-row" onclick={() => handleRowClick(row)}>
          <td class="col-agent">
            <span class="agent-name">{row.name}</span>
          </td>
          <td class="col-status">
            <span class="status-dot active" aria-label={$t('stats.status_active')}></span>
            {$t('stats.status_active')}
          </td>
          <td class="col-risk">
            <div class="risk-cell">
              <span class="risk-value" style:color={riskColor(row.riskScore)}>
                {row.riskScore}
              </span>
              <div class="risk-bar">
                <div
                  class="risk-fill"
                  style:--progress={Math.min(row.riskScore, 100) / 100}
                  style:background={riskColor(row.riskScore)}
                ></div>
              </div>
            </div>
          </td>
          <td class="col-files">
            {$t('stats.events', { count: row.fileCount })}
          </td>
          <td class="col-net">
            {$t('stats.connections', { count: row.networkCount })}
          </td>
          <td class="col-seen">
            {formatRelativeTime(now - row.lastSeen)}
          </td>
        </tr>
      {:else}
        <tr>
          <td colspan="6" class="empty-state">
            {#if $populationUnknown}
              {$t('agents.population_unknown')}
            {:else}
              {$t('stats.no_agents')}
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .stats-panel {
    height: 100%;
    overflow-y: auto;
    padding: var(--aegis-space-5);
  }

  .stats-table {
    width: 100%;
    border-collapse: collapse;
    font-size: calc(0.8125rem * var(--aegis-ui-scale));
    font-family: var(--fancy-font-mono);
  }

  thead th {
    position: sticky;
    top: 0;
    background: var(--md-sys-color-surface-container-low);
    color: var(--md-sys-color-on-surface-variant);
    font-weight: 600;
    text-align: left;
    padding: var(--aegis-space-4) var(--aegis-space-5);
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
    font-size: calc(0.75rem * var(--aegis-ui-scale));
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  thead th.col-status {
    cursor: default;
  }

  thead th.col-seen {
    cursor: default;
  }

  .agent-row {
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .agent-row:hover {
    background: var(--md-sys-color-surface-container);
  }

  .agent-row td {
    padding: var(--aegis-space-4) var(--aegis-space-5);
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
    color: var(--md-sys-color-on-surface);
    white-space: nowrap;
  }

  .agent-name {
    font-weight: 500;
  }

  .status-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: var(--aegis-space-3);
    vertical-align: middle;
  }

  .status-dot.active {
    background: var(--md-sys-color-tertiary);
    box-shadow: 0 0 4px var(--md-sys-color-tertiary);
  }

  .col-status {
    color: var(--md-sys-color-on-surface-variant);
    font-size: calc(0.75rem * var(--aegis-ui-scale));
  }

  .risk-cell {
    display: flex;
    align-items: center;
    gap: var(--aegis-space-4);
    min-width: 100px;
  }

  .risk-value {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    min-width: 24px;
    text-align: right;
  }

  .risk-bar {
    flex: 1;
    height: 4px;
    background: var(--md-sys-color-outline-variant);
    border-radius: 2px;
    max-width: 80px;
  }

  .risk-fill {
    height: 100%;
    width: 100%;
    border-radius: 2px;
    transform: scaleX(var(--progress, 0));
    transform-origin: left;
    transition: transform 0.3s ease;
  }

  .col-files,
  .col-net,
  .col-seen {
    font-variant-numeric: tabular-nums;
    color: var(--md-sys-color-on-surface-variant);
  }

  .empty-state {
    text-align: center;
    color: var(--md-sys-color-on-surface-variant);
    padding: var(--aegis-space-11) 0;
    font-style: italic;
  }
</style>
