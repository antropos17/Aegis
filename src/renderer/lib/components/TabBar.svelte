<script>
  let { activeTab = $bindable('shield') } = $props();

  const tabs = [
    { id: 'shield', label: 'Shield' },
    { id: 'activity', label: 'Activity' },
    { id: 'rules', label: 'Rules' },
    { id: 'reports', label: 'Reports' },
  ];
</script>

<nav class="tab-bar">
  {#each tabs as tab (tab.id)}
    <button
      class="tab-pill"
      class:active={activeTab === tab.id}
      onclick={() => (activeTab = tab.id)}
    >
      {tab.label}
    </button>
  {/each}
</nav>

<style>
  .tab-bar {
    display: flex;
    gap: 6px;
    padding: 6px;
    background: var(--md-sys-color-surface-container-low);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: var(--glass-border);
    border-radius: var(--md-sys-shape-corner-medium);
    width: fit-content;
  }

  .tab-pill {
    padding: 8px 20px;
    border: none;
    border-radius: var(--md-sys-shape-corner-small);
    background: transparent;
    color: var(--md-sys-color-on-surface-variant);
    font-family: inherit;
    font-size: 0.875rem;
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
