<script>
  /** @type {{ agents?: any[], onedit?: (a: any) => void, ondelete?: (a: any) => void }} */
  let { agents = [], onedit, ondelete } = $props();

  let search = $state('');
  let activeCat = $state('all');
  let sortCol = $state('displayName');
  let sortDir = $state(1);

  const CAT_LABELS = {
    'coding-assistant': 'Coding',
    'ai-ide': 'AI IDE',
    'cli-tool': 'CLI',
    'autonomous-agent': 'Autonomous',
    'desktop-agent': 'Desktop',
    'browser-agent': 'Browser',
    'agent-framework': 'Framework',
    'security-devops': 'Security',
    'ide-extension': 'IDE Ext',
  };

  let categories = $derived(['all', ...new Set(agents.map((a) => a.category).filter(Boolean))]);

  let filtered = $derived.by(() => {
    let list = activeCat === 'all' ? agents : agents.filter((a) => a.category === activeCat);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (a) =>
          a.displayName?.toLowerCase().includes(q) ||
          a.vendor?.toLowerCase().includes(q) ||
          a.names?.some((n) => n.toLowerCase().includes(q)),
      );
    }
    return [...list].sort((a, b) => {
      const va = sortCol === 'names' ? (a.names?.[0] ?? '') : (a[sortCol] ?? '');
      const vb = sortCol === 'names' ? (b.names?.[0] ?? '') : (b[sortCol] ?? '');
      return (typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb))) * sortDir;
    });
  });

  function toggleSort(col) {
    if (sortCol === col) sortDir *= -1;
    else {
      sortCol = col;
      sortDir = 1;
    }
  }
</script>

<div class="db-wrap">
  <input class="db-search" type="text" placeholder="Search agents..." bind:value={search} />

  <div class="db-pills">
    {#each categories as cat (cat)}
      <button
        class="pill"
        class:active={activeCat === cat}
        onclick={() => {
          activeCat = cat;
        }}
      >
        {cat === 'all' ? 'All' : CAT_LABELS[cat] || cat}
      </button>
    {/each}
  </div>

  <div class="db-scroll">
    <table class="db-table">
      <thead>
        <tr>
          {#each [['displayName', 'Name'], ['category', 'Category'], ['names', 'Detection'], ['riskProfile', 'Risk']] as [key, label] (key)}
            <th class:sorted={sortCol === key} onclick={() => toggleSort(key)}>
              {label}{#if sortCol === key}<span class="arrow"
                  >{sortDir === 1 ? '\u2191' : '\u2193'}</span
                >{/if}
            </th>
          {/each}
          {#if onedit || ondelete}<th class="th-act">Actions</th>{/if}
        </tr>
      </thead>
      <tbody>
        {#each filtered as agent (agent.id)}
          <tr>
            <td class="td-name"
              ><span class="icon">{agent.icon || '\u25CF'}</span>{agent.displayName}</td
            >
            <td>{CAT_LABELS[agent.category] || agent.category}</td>
            <td><code class="detect">{agent.names?.[0] || '\u2014'}</code></td>
            <td>
              <span
                class="risk"
                class:risk-high={agent.riskProfile === 'high'}
                class:risk-med={agent.riskProfile === 'medium'}
              >
                {agent.riskProfile || 'low'}
              </span>
            </td>
            {#if onedit || ondelete}
              <td class="td-act">
                {#if agent._custom}
                  {#if onedit}<button class="act-btn" onclick={() => onedit(agent)}>Edit</button
                    >{/if}
                  {#if ondelete}<button class="act-btn del" onclick={() => ondelete(agent)}
                      >Del</button
                    >{/if}
                {/if}
              </td>
            {/if}
          </tr>
        {:else}
          <tr><td colspan="5" class="td-empty">No agents found</td></tr>
        {/each}
      </tbody>
    </table>
  </div>

  <span class="db-count">{filtered.length} of {agents.length} agents</span>
</div>

<style>
  .db-wrap {
    display: flex;
    flex-direction: column;
    gap: var(--aegis-space-5);
  }
  .db-search {
    font: var(--md-sys-typescale-body-medium);
    padding: var(--aegis-space-4) var(--aegis-space-6);
    background: var(--md-sys-color-surface-container-low);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: var(--glass-border);
    border-radius: var(--md-sys-shape-corner-small);
    color: var(--md-sys-color-on-surface);
    outline: none;
    transition: border-color 0.2s ease;
  }
  .db-search:focus {
    border-color: var(--md-sys-color-primary);
  }
  .db-pills {
    display: flex;
    gap: var(--aegis-space-3);
    flex-wrap: wrap;
  }
  .pill {
    font: var(--md-sys-typescale-label-medium);
    padding: var(--aegis-space-2) var(--aegis-space-5);
    background: var(--md-sys-color-surface-container);
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-sys-shape-corner-full);
    color: var(--md-sys-color-on-surface-variant);
    cursor: pointer;
    transition: all var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
  }
  .pill:hover {
    background: var(--md-sys-color-surface-container-high);
  }
  .pill.active {
    background: var(--md-sys-color-primary-container);
    border-color: var(--md-sys-color-primary);
    color: var(--md-sys-color-on-surface);
  }
  .db-scroll {
    overflow: auto;
    max-height: calc(420px * var(--aegis-ui-scale));
    border: var(--glass-border);
    border-radius: var(--md-sys-shape-corner-medium);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    box-shadow: var(--glass-shadow-card);
  }
  .db-table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
  }
  .db-table thead {
    position: sticky;
    top: 0;
    z-index: 1;
  }
  .db-table th {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--md-sys-color-on-surface-variant);
    background: var(--md-sys-color-surface-container-high);
    padding: var(--aegis-space-4) var(--aegis-space-6);
    text-align: left;
    cursor: pointer;
    user-select: none;
    border-bottom: 1px solid var(--md-sys-color-outline);
  }
  .db-table th.sorted {
    color: var(--md-sys-color-primary);
  }
  .arrow {
    margin-left: 4px;
  }
  .th-act {
    cursor: default;
    width: 90px;
  }
  .db-table td {
    font: var(--md-sys-typescale-body-medium);
    padding: var(--aegis-space-3) var(--aegis-space-6);
    color: var(--md-sys-color-on-surface);
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
  }
  .db-table tbody tr:hover td {
    background: var(--md-sys-color-surface-container-low);
  }
  .td-name {
    font-weight: 500;
    white-space: nowrap;
  }
  .icon {
    margin-right: var(--aegis-space-3);
  }
  .detect {
    font-family: 'DM Mono', monospace;
    font-size: calc(11px * var(--aegis-ui-scale));
    background: var(--md-sys-color-surface-container-high);
    padding: var(--aegis-space-1) var(--aegis-space-3);
    border-radius: 4px;
  }
  .risk {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 600;
    text-transform: uppercase;
    color: var(--md-sys-color-tertiary);
  }
  .risk-high {
    color: var(--md-sys-color-error);
  }
  .risk-med {
    color: var(--md-sys-color-secondary);
  }
  .td-act {
    white-space: nowrap;
  }
  .act-btn {
    font: var(--md-sys-typescale-label-medium);
    padding: calc(3px * var(--aegis-ui-scale)) var(--aegis-space-4);
    background: transparent;
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-sys-shape-corner-small);
    color: var(--md-sys-color-primary);
    cursor: pointer;
    margin-right: var(--aegis-space-2);
  }
  .act-btn:hover {
    background: var(--md-sys-color-surface-container-high);
  }
  .act-btn.del {
    color: var(--md-sys-color-error);
  }
  .td-empty {
    text-align: center;
    padding: calc(30px * var(--aegis-ui-scale));
    color: var(--md-sys-color-on-surface-variant);
  }
  .db-count {
    font: var(--md-sys-typescale-label-medium);
    color: var(--md-sys-color-on-surface-variant);
    text-align: right;
  }
</style>
