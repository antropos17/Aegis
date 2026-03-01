<script>
  let { activeTab = $bindable('shield') } = $props();

  const tabs = [
    { id: 'shield', label: 'Shield' },
    { id: 'activity', label: 'Activity' },
    { id: 'rules', label: 'Rules' },
    { id: 'reports', label: 'Reports' },
  ];
</script>

<nav class="tab-bar" role="tablist" aria-label="Main navigation">
  {#each tabs as tab, i (tab.id)}
    <button
      id="tab-{tab.id}"
      class="tab-pill"
      class:active={activeTab === tab.id}
      role="tab"
      aria-selected={activeTab === tab.id}
      aria-controls="tabpanel-{tab.id}"
      aria-keyshortcuts={String(i + 1)}
      onclick={() => (activeTab = tab.id)}
    >
      {tab.label}
    </button>
  {/each}
</nav>

<style>
  .tab-bar {
    display: flex;
    gap: var(--aegis-space-3);
    padding: var(--aegis-space-3);
    background: var(--md-sys-color-surface-container-low);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: var(--glass-border);
    border-radius: var(--md-sys-shape-corner-medium);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
    width: fit-content;
  }

  .tab-pill {
    padding: var(--aegis-space-4) var(--aegis-space-9);
    border: none;
    border-radius: var(--md-sys-shape-corner-small);
    background: transparent;
    color: var(--md-sys-color-on-surface-variant);
    font-family: inherit;
    font-size: calc(0.875rem * var(--aegis-ui-scale));
    font-weight: 500;
    cursor: pointer;
    transition: all 0.3s var(--ease-glass);
  }

  .tab-pill:hover {
    color: var(--md-sys-color-on-surface);
    background: rgba(255, 255, 255, 0.04);
  }

  .tab-pill.active {
    background: var(--md-sys-color-primary);
    color: var(--md-sys-color-on-primary);
    font-weight: 600;
    box-shadow: 0 2px 12px rgba(122, 138, 158, 0.3);
  }
</style>
