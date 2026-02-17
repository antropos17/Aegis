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
    window.aegis.getAllPermissions().then(all => {
      if (all) permissions = all;
      loaded = true;
    }).catch(() => { loaded = true; });
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
    } catch (_) { /* silent */ }
  }
</script>

<div class="rules-tab">
  <div class="sub-toggle">
    <button class="sub-btn" class:active={subTab === 'permissions'}
      onclick={() => { subTab = 'permissions'; }}>Permissions</button>
    <button class="sub-btn" class:active={subTab === 'database'}
      onclick={() => { subTab = 'database'; }}>Agent Database</button>
  </div>

  {#if subTab === 'permissions'}
    <div class="rules-section">
      <h3 class="section-title">Protection Level</h3>
      <ProtectionPresets bind:activePreset onApply={handlePresetApply} />
    </div>

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
  .rules-tab { display: flex; flex-direction: column; gap: 20px; padding: 20px; }

  .sub-toggle {
    display: flex; gap: 4px; padding: 3px; align-self: flex-start;
    background: var(--md-sys-color-surface-container);
    border-radius: var(--md-sys-shape-corner-full);
  }

  .sub-btn {
    font: var(--md-sys-typescale-label-medium); font-weight: 600;
    padding: 6px 16px; border: none;
    border-radius: var(--md-sys-shape-corner-full);
    background: transparent; color: var(--md-sys-color-on-surface-variant); cursor: pointer;
    transition: all var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
  }

  .sub-btn:hover { color: var(--md-sys-color-on-surface); }

  .sub-btn.active {
    background: var(--md-sys-color-primary-container);
    color: var(--md-sys-color-on-surface);
  }

  .rules-section { display: flex; flex-direction: column; gap: 10px; }
  .section-header { display: flex; align-items: center; justify-content: space-between; }

  .section-title {
    font: var(--md-sys-typescale-headline-medium);
    color: var(--md-sys-color-on-surface); margin: 0;
  }

  .reset-btn {
    font: var(--md-sys-typescale-label-medium); font-weight: 600;
    padding: 6px 14px; background: transparent;
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-sys-shape-corner-full);
    color: var(--md-sys-color-on-surface-variant); cursor: pointer;
    transition: all var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
  }

  .reset-btn:hover {
    background: var(--md-sys-color-surface-container-high);
    color: var(--md-sys-color-on-surface);
    border-color: var(--md-sys-color-on-surface-variant);
  }
</style>
