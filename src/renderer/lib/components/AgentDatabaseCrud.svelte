<script>
  import AgentDatabase from './AgentDatabase.svelte';

  let agents = $state([]);
  let customAgents = $state([]);
  let modalMode = $state(null); // null | 'add' | 'edit' | 'delete'
  let editTarget = $state(null);
  let form = $state({ displayName: '', processName: '', category: 'coding-assistant', description: '', riskProfile: 'low' });

  // ── Load agents from IPC ──
  if (window.aegis) {
    Promise.all([window.aegis.getAgentDatabase(), window.aegis.getCustomAgents()])
      .then(([db, custom]) => {
        agents = db?.agents || db || [];
        customAgents = custom || [];
      }).catch(() => {});
  }

  let allAgents = $derived([
    ...agents,
    ...customAgents.map(a => ({ ...a, _custom: true }))
  ]);

  function openAdd() {
    form = { displayName: '', processName: '', category: 'coding-assistant', description: '', riskProfile: 'low' };
    editTarget = null; modalMode = 'add';
  }

  function openEdit(agent) {
    form = {
      displayName: agent.displayName, processName: agent.names?.[0] || '',
      category: agent.category, description: agent.description || '',
      riskProfile: agent.riskProfile || 'low',
    };
    editTarget = agent; modalMode = 'edit';
  }

  function openDelete(agent) { editTarget = agent; modalMode = 'delete'; }

  function saveForm() {
    if (!form.displayName.trim()) return;
    if (modalMode === 'add') {
      customAgents = [...customAgents, {
        id: 'custom-' + Date.now(), displayName: form.displayName.trim(),
        names: [form.processName.trim() || form.displayName.trim().toLowerCase()],
        category: form.category, description: form.description.trim(),
        riskProfile: form.riskProfile, vendor: 'Custom', icon: '\uD83D\uDD27',
        color: '#888', defaultTrust: 50, knownDomains: [], knownPorts: [],
        configPaths: [], parentEditors: [], website: '',
      }];
    } else if (modalMode === 'edit' && editTarget) {
      customAgents = customAgents.map(a => a.id !== editTarget.id ? a : {
        ...a, displayName: form.displayName.trim(),
        names: [form.processName.trim() || a.names[0]],
        category: form.category, description: form.description.trim(),
        riskProfile: form.riskProfile,
      });
    }
    saveCustom(); modalMode = null;
  }

  function doDelete() {
    if (editTarget) customAgents = customAgents.filter(a => a.id !== editTarget.id);
    saveCustom(); modalMode = null;
  }

  async function saveCustom() {
    if (window.aegis) try { await window.aegis.saveCustomAgents(customAgents); } catch (_) { /* silent */ }
  }

  async function handleImport() {
    if (!window.aegis) return;
    try {
      const r = await window.aegis.importAgentDatabase();
      if (r?.agents) agents = r.agents;
    } catch (_) { /* silent */ }
  }

  async function handleExport() {
    if (window.aegis) try { await window.aegis.exportAgentDatabase(); } catch (_) { /* silent */ }
  }

  const CATEGORIES = [
    ['coding-assistant','Coding Assistant'], ['ai-ide','AI IDE'], ['cli-tool','CLI Tool'],
    ['autonomous-agent','Autonomous'], ['desktop-agent','Desktop'], ['browser-agent','Browser'],
    ['agent-framework','Framework'], ['security-devops','Security'], ['ide-extension','IDE Extension'],
  ];
</script>

<div class="crud-wrap">
  <div class="crud-bar">
    <button class="crud-btn primary" onclick={openAdd}>+ Add Agent</button>
    <div class="crud-right">
      <button class="crud-btn" onclick={handleImport}>Import</button>
      <button class="crud-btn" onclick={handleExport}>Export</button>
    </div>
  </div>

  <AgentDatabase agents={allAgents} onedit={openEdit} ondelete={openDelete} />
</div>

{#if modalMode}
  <div class="overlay" role="button" tabindex="-1"
    onclick={() => { modalMode = null; }}
    onkeydown={(e) => { if (e.key === 'Escape') modalMode = null; }}>
    <div class="modal" role="dialog" tabindex="-1"
      onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
      {#if modalMode === 'delete'}
        <h3 class="modal-title">Delete Agent</h3>
        <p class="modal-text">Remove "{editTarget?.displayName}"? This cannot be undone.</p>
        <div class="modal-actions">
          <button class="crud-btn" onclick={() => { modalMode = null; }}>Cancel</button>
          <button class="crud-btn danger" onclick={doDelete}>Delete</button>
        </div>
      {:else}
        <h3 class="modal-title">{modalMode === 'add' ? 'Add Custom Agent' : 'Edit Agent'}</h3>
        <div class="modal-form">
          <label class="field"><span>Name</span>
            <input type="text" bind:value={form.displayName} placeholder="Agent name" /></label>
          <label class="field"><span>Process Name</span>
            <input type="text" bind:value={form.processName} placeholder="e.g. agent.exe" /></label>
          <label class="field"><span>Category</span>
            <select bind:value={form.category}>
              {#each CATEGORIES as [val, label] (val)}
                <option value={val}>{label}</option>
              {/each}
            </select></label>
          <label class="field"><span>Risk Level</span>
            <select bind:value={form.riskProfile}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select></label>
          <label class="field"><span>Description</span>
            <input type="text" bind:value={form.description} placeholder="Short description" /></label>
        </div>
        <div class="modal-actions">
          <button class="crud-btn" onclick={() => { modalMode = null; }}>Cancel</button>
          <button class="crud-btn primary" onclick={saveForm}>{modalMode === 'add' ? 'Add' : 'Save'}</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .crud-wrap { display: flex; flex-direction: column; gap: 12px; }
  .crud-bar { display: flex; justify-content: space-between; align-items: center; }
  .crud-right { display: flex; gap: 8px; }
  .crud-btn {
    font: var(--md-sys-typescale-label-medium); font-weight: 600;
    padding: 7px 14px; background: var(--md-sys-color-surface-container);
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-sys-shape-corner-small);
    color: var(--md-sys-color-on-surface-variant); cursor: pointer;
    transition: all var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
  }
  .crud-btn:hover { background: var(--md-sys-color-surface-container-high); color: var(--md-sys-color-on-surface); }
  .crud-btn.primary { background: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-surface); border-color: var(--md-sys-color-primary); }
  .crud-btn.danger { background: var(--md-sys-color-error); color: var(--md-sys-color-on-error); border-color: var(--md-sys-color-error); }
  .overlay {
    position: fixed; inset: 0; z-index: 100;
    background: var(--md-sys-color-scrim);
    display: flex; align-items: center; justify-content: center;
  }
  .modal {
    background: var(--md-sys-color-surface-container-high);
    border-radius: var(--md-sys-shape-corner-large);
    padding: 24px; min-width: 360px; max-width: 460px;
  }
  .modal-title { font: var(--md-sys-typescale-headline-medium); color: var(--md-sys-color-on-surface); margin: 0 0 16px; }
  .modal-text { font: var(--md-sys-typescale-body-medium); color: var(--md-sys-color-on-surface-variant); margin: 0 0 20px; }
  .modal-form { display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field span { font: var(--md-sys-typescale-label-medium); color: var(--md-sys-color-on-surface-variant); }
  .field input, .field select {
    font: var(--md-sys-typescale-body-medium); padding: 8px 10px;
    background: var(--md-sys-color-surface-container);
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-sys-shape-corner-small);
    color: var(--md-sys-color-on-surface); outline: none;
  }
  .field input:focus, .field select:focus { border-color: var(--md-sys-color-primary); }
  .modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
