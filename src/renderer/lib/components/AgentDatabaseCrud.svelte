<script>
  import AgentDatabase from './AgentDatabase.svelte';
  import AgentFormModal from './AgentFormModal.svelte';
  import { t } from '../i18n/index.js';
  import {
    createEmptyForm,
    formFromAgent,
    buildCustomAgent,
    applyFormToAgent,
  } from '../utils/agent-crud-utils.ts';

  let agents = $state([]);
  let customAgents = $state([]);
  let modalMode = $state(null); // null | 'add' | 'edit' | 'delete'
  let editTarget = $state(null);
  let form = $state(createEmptyForm());

  // ── Load agents from IPC (or static JSON in demo mode) ──
  if (window.aegis) {
    Promise.all([window.aegis.getAgentDatabase(), window.aegis.getCustomAgents()])
      .then(([db, custom]) => {
        agents = db?.agents || db || [];
        customAgents = custom || [];
      })
      .catch(() => {});
  } else {
    import('../../../shared/agent-database.json').then((mod) => {
      agents = mod.default?.agents || mod.agents || [];
    });
  }

  let allAgents = $derived([...agents, ...customAgents.map((a) => ({ ...a, _custom: true }))]);

  function openAdd() {
    form = createEmptyForm();
    editTarget = null;
    modalMode = 'add';
  }

  function openEdit(agent) {
    form = formFromAgent(agent);
    editTarget = agent;
    modalMode = 'edit';
  }

  function openDelete(agent) {
    editTarget = agent;
    modalMode = 'delete';
  }

  function saveForm() {
    if (!form.displayName.trim()) return;
    if (modalMode === 'add') {
      customAgents = [...customAgents, buildCustomAgent(form)];
    } else if (modalMode === 'edit' && editTarget) {
      customAgents = customAgents.map((a) =>
        a.id !== editTarget.id ? a : applyFormToAgent(a, form),
      );
    }
    saveCustom();
    modalMode = null;
  }

  function doDelete() {
    if (editTarget) customAgents = customAgents.filter((a) => a.id !== editTarget.id);
    saveCustom();
    modalMode = null;
  }

  async function saveCustom() {
    if (window.aegis)
      try {
        await window.aegis.saveCustomAgents(customAgents);
      } catch (_) {
        /* silent */
      }
  }

  async function handleImport() {
    if (!window.aegis) return;
    try {
      const r = await window.aegis.importAgentDatabase();
      if (r?.agents) agents = r.agents;
    } catch (_) {
      /* silent */
    }
  }

  async function handleExport() {
    if (window.aegis)
      try {
        await window.aegis.exportAgentDatabase();
      } catch (_) {
        /* silent */
      }
  }

  function openSuggestAgent() {
    const url = 'https://github.com/antropos17/Aegis/issues/new?template=03-new-agent.yml';
    if (window.aegis?.openExternalUrl) {
      window.aegis.openExternalUrl(url);
    }
  }
</script>

<div class="crud-wrap">
  <div class="crud-bar">
    <button class="crud-btn primary" onclick={openAdd}>{$t('rules.database.add_agent')}</button>
    <div class="crud-right">
      <button class="crud-btn" onclick={handleImport}>{$t('rules.database.import')}</button>
      <button class="crud-btn" onclick={handleExport}>{$t('rules.database.export')}</button>
      <button class="crud-btn suggest" onclick={openSuggestAgent}>Suggest new agent</button>
    </div>
  </div>

  <AgentDatabase agents={allAgents} onedit={openEdit} ondelete={openDelete} />
</div>

{#if modalMode}
  <AgentFormModal
    mode={modalMode}
    {form}
    agentName={editTarget?.displayName ?? ''}
    onclose={() => {
      modalMode = null;
    }}
    onsave={saveForm}
    ondelete={doDelete}
  />
{/if}

<style>
  .crud-wrap {
    display: flex;
    flex-direction: column;
    gap: var(--aegis-space-6);
  }
  .crud-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .crud-right {
    display: flex;
    gap: var(--aegis-space-4);
  }
  .crud-btn {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 600;
    padding: calc(7px * var(--aegis-ui-scale)) var(--aegis-space-7);
    background: var(--md-sys-color-surface-container);
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-sys-shape-corner-small);
    color: var(--md-sys-color-on-surface-variant);
    cursor: pointer;
    transition: all 0.3s var(--ease-glass);
  }
  .crud-btn:hover {
    background: var(--md-sys-color-outline-variant);
    color: var(--md-sys-color-on-surface);
    border-color: var(--aegis-border-hover);
  }
  .crud-btn.primary {
    background: var(--md-sys-color-primary-container);
    color: var(--md-sys-color-on-surface);
    border-color: var(--md-sys-color-primary);
  }
  .crud-btn.suggest {
    background: var(--md-sys-color-tertiary-container);
    color: var(--md-sys-color-on-surface);
    border-color: var(--md-sys-color-tertiary);
  }
</style>
