<script>
  import { enrichedAgents } from '../stores/risk.js';

  /** @type {{ permissions: Record<string, Record<string, string>> }} */
  let { permissions = $bindable({}) } = $props();

  const CATEGORIES = [
    { id: 'filesystem', label: 'File Access',          desc: 'Read/write files' },
    { id: 'sensitive',  label: 'Credential Access',    desc: '.env, SSH keys, secrets' },
    { id: 'network',    label: 'Network',              desc: 'Outbound connections' },
    { id: 'terminal',   label: 'Process Spawn',        desc: 'Shell command execution' },
    { id: 'clipboard',  label: 'Config Write',         desc: 'Read/write clipboard' },
    { id: 'screen',     label: 'System Modification',  desc: 'Screen capture access' },
  ];

  const STATES = ['allow', 'monitor', 'block'];
  const STATE_LABELS = { allow: 'A', monitor: 'M', block: 'B' };

  let selectedAgent = $state('__global__');

  let agentList = $derived(
    $enrichedAgents.map(a => a.name).filter((v, i, arr) => arr.indexOf(v) === i)
  );

  /** Get the permission map for the currently selected agent */
  let currentPerms = $derived.by(() => {
    if (selectedAgent === '__global__') return null;
    return permissions[selectedAgent] || {};
  });

  function getState(catId) {
    if (!currentPerms) return 'monitor';
    return currentPerms[catId] || 'monitor';
  }

  function setState(catId, newState) {
    if (selectedAgent === '__global__') return;
    if (!permissions[selectedAgent]) {
      permissions[selectedAgent] = {};
      for (const cat of CATEGORIES) permissions[selectedAgent][cat.id] = 'monitor';
    }
    permissions[selectedAgent][catId] = newState;
    save();
  }

  async function save() {
    if (!window.aegis) return;
    try {
      await window.aegis.saveAgentPermissions(permissions);
    } catch (_) { /* silent */ }
  }

  function stateColor(s) {
    if (s === 'allow') return 'var(--md-sys-color-tertiary)';
    if (s === 'monitor') return 'var(--md-sys-color-primary)';
    return 'var(--md-sys-color-error)';
  }
</script>

<div class="grid-wrapper">
  <div class="grid-header">
    <select class="agent-select" bind:value={selectedAgent}>
      <option value="__global__">Select an agent...</option>
      {#each agentList as name (name)}
        <option value={name}>{name}</option>
      {/each}
    </select>
  </div>

  {#if selectedAgent === '__global__'}
    <div class="grid-empty">Select an agent to configure permissions</div>
  {:else}
    <div class="grid-table">
      <div class="grid-row grid-row-header">
        <span class="grid-cell grid-cell-cat">Category</span>
        {#each STATES as s (s)}
          <span class="grid-cell grid-cell-state">{s}</span>
        {/each}
      </div>

      {#each CATEGORIES as cat (cat.id)}
        {@const active = getState(cat.id)}
        <div class="grid-row">
          <span class="grid-cell grid-cell-cat">
            <span class="cat-label">{cat.label}</span>
            <span class="cat-desc">{cat.desc}</span>
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
    box-shadow: var(--glass-shadow), var(--glass-highlight);
    border-radius: var(--md-sys-shape-corner-medium); overflow: hidden;
  }
  .grid-header { padding: 12px 14px; border-bottom: 1px solid var(--md-sys-color-outline); }
  .agent-select {
    font: var(--md-sys-typescale-body-medium); padding: 6px 10px;
    background: var(--md-sys-color-surface-container-high);
    color: var(--md-sys-color-on-surface);
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-sys-shape-corner-small);
    cursor: pointer; min-width: 200px;
  }
  .agent-select:focus { outline: 1px solid var(--md-sys-color-primary); outline-offset: -1px; }
  .grid-empty {
    padding: 40px 20px; text-align: center;
    font: var(--md-sys-typescale-body-medium); color: var(--md-sys-color-on-surface-variant);
  }
  .grid-table { display: flex; flex-direction: column; }
  .grid-row {
    display: flex; align-items: center;
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
  }
  .grid-row:last-child { border-bottom: none; }
  .grid-row-header { background: var(--md-sys-color-surface-container); }
  .grid-row-header .grid-cell {
    font: var(--md-sys-typescale-label-medium); font-weight: 600;
    color: var(--md-sys-color-on-surface-variant);
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  .grid-cell { padding: 8px 12px; }
  .grid-cell-cat { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .grid-row-header .grid-cell-cat { flex-direction: row; }
  .cat-label {
    font: var(--md-sys-typescale-body-medium); font-weight: 500;
    color: var(--md-sys-color-on-surface);
  }
  .cat-desc { font: var(--md-sys-typescale-label-medium); color: var(--md-sys-color-on-surface-variant); }
  .grid-cell-state { width: 80px; flex-shrink: 0; text-align: center; }
  .state-btn {
    font: var(--md-sys-typescale-label-medium); font-weight: 700;
    width: 36px; height: 28px;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: var(--md-sys-shape-corner-small);
    background: transparent; color: var(--md-sys-color-on-surface-variant); cursor: pointer;
    transition: all 0.3s var(--ease-glass);
  }
  .state-btn:hover {
    background: var(--md-sys-color-surface-container-highest);
    color: var(--md-sys-color-on-surface);
  }
  .state-btn.active {
    background: var(--btn-color); border-color: var(--btn-color);
    color: var(--md-sys-color-surface);
  }
</style>
