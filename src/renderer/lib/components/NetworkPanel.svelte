<script>
  import { network } from '../stores/ipc.js';
  import { enrichedAgents } from '../stores/risk.js';

  let agentFilter = $state('all');
  let classFilter = $state('all');
  let sortBy = $state('agent');

  const CLS_LIST = ['all', 'safe', 'unknown', 'flagged'];

  function classify(conn) {
    if (!conn.flagged) return 'safe';
    return conn.domain ? 'unknown' : 'flagged';
  }

  function classColor(cls) {
    if (cls === 'safe') return 'var(--md-sys-color-tertiary)';
    if (cls === 'unknown') return 'var(--md-sys-color-secondary)';
    return 'var(--md-sys-color-error)';
  }

  let sorted = $derived.by(() => {
    let result = $network;
    if (agentFilter !== 'all') result = result.filter((c) => c.agent === agentFilter);
    if (classFilter !== 'all') result = result.filter((c) => classify(c) === classFilter);
    const copy = [...result];
    if (sortBy === 'agent') copy.sort((a, b) => a.agent.localeCompare(b.agent));
    else if (sortBy === 'domain')
      copy.sort((a, b) => (a.domain || a.remoteIp).localeCompare(b.domain || b.remoteIp));
    else if (sortBy === 'class') copy.sort((a, b) => classify(a).localeCompare(classify(b)));
    return copy;
  });

  let counts = $derived.by(() => {
    const c = { all: $network.length, safe: 0, unknown: 0, flagged: 0 };
    for (const conn of $network) c[classify(conn)]++;
    return c;
  });
</script>

<div class="net-filters">
  <select class="agent-select" bind:value={agentFilter}>
    <option value="all">All agents</option>
    {#each $enrichedAgents as agent (agent.pid)}
      <option value={agent.name}>{agent.name}</option>
    {/each}
  </select>

  <div class="pill-group">
    <span class="pill-label">Class</span>
    {#each CLS_LIST as cls (cls)}
      <button
        class="pill cls-{cls}"
        class:active={classFilter === cls}
        onclick={() => (classFilter = cls)}>{cls}{cls !== 'all' ? ` (${counts[cls]})` : ''}</button
      >
    {/each}
  </div>

  <div class="pill-group">
    <span class="pill-label">Sort</span>
    <select class="sort-select" bind:value={sortBy}>
      <option value="agent">Agent</option>
      <option value="domain">Domain</option>
      <option value="class">Classification</option>
    </select>
  </div>
</div>

<div class="net-scroll">
  {#if sorted.length === 0}
    <div class="net-empty">No network connections detected</div>
  {:else}
    {#each sorted as conn, i (`${conn.pid}-${conn.remoteIp}-${conn.remotePort}-${i}`)}
      {@const cls = classify(conn)}
      <div class="net-row">
        <span class="net-agent">{conn.agent}</span>
        <span class="net-endpoint" title={`${conn.remoteIp}:${conn.remotePort}`}>
          {conn.domain || conn.remoteIp}
        </span>
        <span class="net-port">{conn.remotePort}</span>
        <span class="net-state">{conn.state}</span>
        <span class="net-badge" style:background={classColor(cls)}>{cls}</span>
      </div>
    {/each}
  {/if}
</div>

<style>
  .net-filters {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 10px 14px;
    flex-wrap: wrap;
    background: var(--md-sys-color-surface-container-low);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: var(--glass-border);
    box-shadow: var(--glass-shadow), var(--glass-highlight);
    border-radius: var(--md-sys-shape-corner-medium);
  }
  .agent-select,
  .sort-select {
    font: var(--md-sys-typescale-body-medium);
    background: var(--md-sys-color-surface-container-high);
    color: var(--md-sys-color-on-surface);
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-sys-shape-corner-small);
    padding: 5px 10px;
    cursor: pointer;
  }
  .agent-select {
    min-width: 120px;
  }
  .agent-select:focus,
  .sort-select:focus {
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
  .pill.active.cls-safe {
    background: color-mix(in srgb, var(--md-sys-color-tertiary) 25%, transparent);
    border-color: var(--md-sys-color-tertiary);
  }
  .pill.active.cls-unknown {
    background: color-mix(in srgb, var(--md-sys-color-secondary) 25%, transparent);
    border-color: var(--md-sys-color-secondary);
  }
  .pill.active.cls-flagged {
    background: color-mix(in srgb, var(--md-sys-color-error) 25%, transparent);
    border-color: var(--md-sys-color-error);
  }
  .net-scroll {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }
  .net-empty {
    padding: 40px 20px;
    text-align: center;
    font: var(--md-sys-typescale-body-medium);
    color: var(--md-sys-color-on-surface-variant);
  }
  .net-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    font-size: 11px;
    transition: background 0.15s ease;
  }
  .net-row:nth-child(odd) {
    background: rgba(255, 255, 255, 0.01);
  }
  .net-row:hover {
    background: rgba(255, 255, 255, 0.04);
  }
  .net-agent {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 600;
    color: var(--md-sys-color-on-surface);
    flex-shrink: 0;
    width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .net-endpoint {
    font: var(--md-sys-typescale-body-medium);
    font-family: 'DM Mono', monospace;
    color: var(--md-sys-color-on-surface);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .net-port {
    font: var(--md-sys-typescale-label-medium);
    font-family: 'DM Mono', monospace;
    color: var(--md-sys-color-on-surface-variant);
    flex-shrink: 0;
    width: 48px;
    text-align: right;
  }
  .net-state {
    font: var(--md-sys-typescale-label-medium);
    color: var(--md-sys-color-on-surface-variant);
    flex-shrink: 0;
    width: 72px;
    text-transform: lowercase;
  }
  .net-badge {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 700;
    font-size: 10px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    padding: 2px 8px;
    border-radius: var(--md-sys-shape-corner-full);
    color: var(--md-sys-color-surface);
    flex-shrink: 0;
  }
</style>
