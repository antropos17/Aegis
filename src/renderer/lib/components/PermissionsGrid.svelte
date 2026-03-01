<script>
  import { enrichedAgents } from '../stores/risk.js';
  import { t } from '../i18n/index.js';

  /** @type {{ permissions: Record<string, Record<string, string>> }} */
  let { permissions = $bindable({}) } = $props();

  const CATEGORIES = [
    {
      id: 'filesystem',
      labelKey: 'rules.permissions.categories.file_access',
      descKey: 'rules.permissions.categories.file_access_desc',
    },
    {
      id: 'sensitive',
      labelKey: 'rules.permissions.categories.credential_access',
      descKey: 'rules.permissions.categories.credential_access_desc',
    },
    {
      id: 'network',
      labelKey: 'rules.permissions.categories.network',
      descKey: 'rules.permissions.categories.network_desc',
    },
    {
      id: 'terminal',
      labelKey: 'rules.permissions.categories.process_spawn',
      descKey: 'rules.permissions.categories.process_spawn_desc',
    },
    {
      id: 'clipboard',
      labelKey: 'rules.permissions.categories.config_write',
      descKey: 'rules.permissions.categories.config_write_desc',
    },
    {
      id: 'screen',
      labelKey: 'rules.permissions.categories.system_mod',
      descKey: 'rules.permissions.categories.system_mod_desc',
    },
  ];

  const STATES = ['allow', 'monitor', 'block'];
  const STATE_LABELS = { allow: 'A', monitor: 'M', block: 'B' };

  let selectedKey = $state('__global__');

  /** Derive unique instance entries from enriched agents, keyed by cwd/project */
  let instanceList = $derived.by(() => {
    const seen = new Set();
    const running = [];
    const savedDefaults = [];

    // Running instances
    for (const a of $enrichedAgents) {
      const iKey = a.instanceKey;
      if (seen.has(iKey)) continue;
      seen.add(iKey);

      let label;
      if (a.projectName) {
        label = `${a.name} \u2014 ${a.projectName}`;
      } else if (a.parentEditor) {
        label = `${a.name} (via ${a.parentEditor})`;
      } else {
        label = `${a.name} (standalone)`;
      }

      running.push({
        key: iKey,
        label,
        agentName: a.name,
        parentEditor: a.parentEditor || null,
        cwd: a.cwd || null,
      });
    }

    // Saved defaults from persisted permissions keys not already in running
    for (const key of Object.keys(permissions)) {
      if (seen.has(key)) continue;
      seen.add(key);
      savedDefaults.push({
        key,
        label: key.includes('::') ? key : `${key} (default)`,
        agentName: key.split('::')[0],
        parentEditor: null,
        cwd: key.includes('::') ? key.split('::')[1] : null,
      });
    }

    return { running, savedDefaults };
  });

  /** Whether the selected key has instance-level overrides saved */
  let hasOverride = $derived(
    selectedKey !== '__global__' && selectedKey.includes('::') && !!permissions[selectedKey],
  );

  let currentPerms = $derived.by(() => {
    if (selectedKey === '__global__') return null;
    return permissions[selectedKey] || {};
  });

  function getState(catId) {
    if (!currentPerms) return 'monitor';
    return currentPerms[catId] || 'monitor';
  }

  function setState(catId, newState) {
    if (selectedKey === '__global__') return;

    const allEntries = [...instanceList.running, ...instanceList.savedDefaults];
    const entry = allEntries.find((e) => e.key === selectedKey);
    if (!entry) return;

    if (!permissions[selectedKey]) {
      permissions[selectedKey] = {};
      for (const cat of CATEGORIES) permissions[selectedKey][cat.id] = 'monitor';
    }
    permissions[selectedKey][catId] = newState;
    save(entry);
  }

  async function save(entry) {
    if (!window.aegis) return;
    try {
      if (entry && (entry.cwd || entry.parentEditor)) {
        await window.aegis.saveInstancePermissions({
          agentName: entry.agentName,
          parentEditor: entry.parentEditor,
          cwd: entry.cwd,
          permissions: permissions[selectedKey],
        });
      } else {
        await window.aegis.saveAgentPermissions(permissions);
      }
    } catch (_) {
      /* silent */
    }
  }

  function stateColor(s) {
    if (s === 'allow') return 'var(--md-sys-color-tertiary)';
    if (s === 'monitor') return 'var(--md-sys-color-primary)';
    return 'var(--md-sys-color-error)';
  }
</script>

<div class="grid-wrapper">
  <div class="grid-header">
    <select class="agent-select" bind:value={selectedKey}>
      <option value="__global__">{$t('rules.permissions.select_agent')}</option>
      {#if instanceList.running.length > 0}
        <optgroup label="Running Instances">
          {#each instanceList.running as entry (entry.key)}
            <option value={entry.key}>{entry.label}</option>
          {/each}
        </optgroup>
      {/if}
      {#if instanceList.savedDefaults.length > 0}
        <optgroup label="Saved Defaults">
          {#each instanceList.savedDefaults as entry (entry.key)}
            <option value={entry.key}>{entry.label}</option>
          {/each}
        </optgroup>
      {/if}
    </select>
    {#if hasOverride}
      <span class="override-badge">{$t('rules.permissions.overridden')}</span>
    {/if}
  </div>

  {#if selectedKey === '__global__'}
    <div class="grid-empty">{$t('rules.permissions.empty_state')}</div>
  {:else}
    <div class="grid-table">
      <div class="grid-row grid-row-header">
        <span class="grid-cell grid-cell-cat">{$t('rules.permissions.category')}</span>
        {#each STATES as s (s)}
          <span class="grid-cell grid-cell-state">{$t('rules.permissions.states.' + s)}</span>
        {/each}
      </div>

      {#each CATEGORIES as cat (cat.id)}
        {@const active = getState(cat.id)}
        <div class="grid-row">
          <span class="grid-cell grid-cell-cat">
            <span class="cat-label">{$t(cat.labelKey)}</span>
            <span class="cat-desc">{$t(cat.descKey)}</span>
          </span>
          {#each STATES as s (s)}
            <span class="grid-cell grid-cell-state">
              <button
                class="state-btn"
                class:active={active === s}
                style:--btn-color={stateColor(s)}
                onclick={() => setState(cat.id, s)}
              >
                {STATE_LABELS[s]}
              </button>
            </span>
          {/each}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .grid-wrapper {
    background: var(--md-sys-color-surface-container-low);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: var(--glass-border);
    box-shadow: var(--glass-shadow-card), var(--glass-highlight);
    border-radius: var(--md-sys-shape-corner-medium);
    overflow: hidden;
  }
  .grid-header {
    padding: var(--aegis-space-6) var(--aegis-space-7);
    border-bottom: 1px solid var(--md-sys-color-outline);
    display: flex;
    align-items: center;
    gap: var(--aegis-space-5);
  }
  .agent-select {
    font: var(--md-sys-typescale-body-medium);
    padding: var(--aegis-space-3) var(--aegis-space-5);
    background: var(--md-sys-color-surface-container-high);
    color: var(--md-sys-color-on-surface);
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-sys-shape-corner-small);
    cursor: pointer;
    min-width: 200px;
  }
  .agent-select:focus {
    outline: 1px solid var(--md-sys-color-primary);
    outline-offset: -1px;
  }
  .override-badge {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 600;
    color: var(--md-sys-color-primary);
    background: color-mix(in srgb, var(--md-sys-color-primary) 15%, transparent);
    padding: var(--aegis-space-1) var(--aegis-space-4);
    border-radius: var(--md-sys-shape-corner-full);
  }
  .grid-empty {
    padding: calc(40px * var(--aegis-ui-scale)) var(--aegis-space-9);
    text-align: center;
    font: var(--md-sys-typescale-body-medium);
    color: var(--md-sys-color-on-surface-variant);
  }
  .grid-table {
    display: flex;
    flex-direction: column;
  }
  .grid-row {
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
  }
  .grid-row:last-child {
    border-bottom: none;
  }
  .grid-row-header {
    background: var(--md-sys-color-surface-container);
  }
  .grid-row-header .grid-cell {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 600;
    color: var(--md-sys-color-on-surface-variant);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .grid-cell {
    padding: var(--aegis-space-4) var(--aegis-space-6);
  }
  .grid-cell-cat {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--aegis-space-1);
    min-width: 0;
  }
  .grid-row-header .grid-cell-cat {
    flex-direction: row;
  }
  .cat-label {
    font: var(--md-sys-typescale-body-medium);
    font-weight: 500;
    color: var(--md-sys-color-on-surface);
  }
  .cat-desc {
    font: var(--md-sys-typescale-label-medium);
    color: var(--md-sys-color-on-surface-variant);
  }
  .grid-cell-state {
    width: var(--aegis-col-state);
    flex-shrink: 0;
    text-align: center;
  }
  .state-btn {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 700;
    width: 36px;
    height: 28px;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: var(--md-sys-shape-corner-small);
    background: transparent;
    color: var(--md-sys-color-on-surface-variant);
    cursor: pointer;
    transition: all 0.3s var(--ease-glass);
  }
  .state-btn:hover {
    background: var(--md-sys-color-surface-container-highest);
    color: var(--md-sys-color-on-surface);
  }
  .state-btn.active {
    background: var(--btn-color);
    border-color: var(--btn-color);
    color: var(--md-sys-color-surface);
  }
</style>
