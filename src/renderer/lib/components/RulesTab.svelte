<script>
  import ProtectionPresets from './ProtectionPresets.svelte';
  import PermissionsGrid from './PermissionsGrid.svelte';
  import AgentDatabaseCrud from './AgentDatabaseCrud.svelte';

  let subTab = $state('permissions');
  let activePreset = $state('balanced');
  let permissions = $state({});
  let loaded = $state(false);

  // One-time IPC load on mount
  if (window.aegis) {
    window.aegis
      .getAllPermissions()
      .then((all) => {
        if (all) permissions = all;
        loaded = true;
      })
      .catch(() => {
        loaded = true;
      });
  } else {
    loaded = true;
  }

  function handlePresetApply(presetName, config) {
    for (const agent of Object.keys(permissions)) {
      for (const [cat, state] of Object.entries(config)) {
        if (!permissions[agent]) permissions[agent] = {};
        permissions[agent][cat] = state;
      }
    }
    if (window.aegis) window.aegis.saveAgentPermissions(permissions);
  }

  async function resetDefaults() {
    if (!window.aegis) return;
    try {
      const result = await window.aegis.resetPermissionsToDefaults();
      if (result?.permissions) permissions = result.permissions;
      activePreset = 'balanced';
    } catch (_) {
      /* silent */
    }
  }
</script>

<div class="rules-tab">
  <div class="sub-toggle">
    <button
      class="sub-btn"
      class:active={subTab === 'permissions'}
      onclick={() => {
        subTab = 'permissions';
      }}>Permissions</button
    >
    <button
      class="sub-btn"
      class:active={subTab === 'database'}
      onclick={() => {
        subTab = 'database';
      }}>Agent Database</button
    >
  </div>

  {#if subTab === 'permissions'}
    <div class="rules-section">
      <h3 class="section-title">Protection Level</h3>
      <ProtectionPresets bind:activePreset onApply={handlePresetApply} />
    </div>

    <div class="section-separator"></div>

    <div class="rules-section">
      <div class="section-header">
        <h3 class="section-title">Agent Permissions</h3>
        <button class="reset-btn" onclick={resetDefaults}>Reset defaults</button>
      </div>
      {#if loaded}
        <PermissionsGrid bind:permissions />
      {/if}
    </div>
  {:else}
    <AgentDatabaseCrud />
  {/if}
</div>

<style>
  .rules-tab {
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 20px;
  }

  .sub-toggle {
    display: flex;
    gap: 4px;
    padding: 3px;
    align-self: flex-start;
    background: var(--md-sys-color-surface-container-low);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: var(--glass-border);
    border-radius: var(--md-sys-shape-corner-full);
  }

  .sub-btn {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 600;
    padding: 6px 16px;
    border: none;
    border-radius: var(--md-sys-shape-corner-full);
    background: transparent;
    color: var(--md-sys-color-on-surface-variant);
    cursor: pointer;
    transition: all 0.3s var(--ease-glass);
  }

  .sub-btn:hover {
    color: var(--md-sys-color-on-surface);
    background: rgba(255, 255, 255, 0.04);
  }

  .sub-btn.active {
    background: var(--md-sys-color-primary);
    color: var(--md-sys-color-on-primary);
    box-shadow: 0 2px 12px rgba(122, 138, 158, 0.3);
  }

  .rules-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .section-separator {
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.06), transparent);
    margin: 10px 0;
  }
  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .section-title {
    font: var(--md-sys-typescale-headline-medium);
    color: var(--md-sys-color-on-surface);
    margin: 0;
  }

  .reset-btn {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 600;
    padding: 6px 14px;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: var(--md-sys-shape-corner-full);
    color: var(--md-sys-color-on-surface-variant);
    cursor: pointer;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    transition: all 0.3s var(--ease-glass);
  }

  .reset-btn:hover {
    background: rgba(255, 255, 255, 0.04);
    color: var(--md-sys-color-on-surface);
    border-color: rgba(255, 255, 255, 0.15);
  }
</style>
