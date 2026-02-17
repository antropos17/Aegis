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
      onclick={() => activeTab = tab.id}
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
    background: var(--md-sys-color-surface);
    border-radius: var(--md-sys-shape-corner-medium);
    width: fit-content;
  }

  .tab-pill {
    padding: 8px 20px;
    border: none;
    border-radius: var(--md-sys-shape-corner-small);
    background: transparent;
    color: var(--md-sys-color-on-surface);
    font-family: inherit;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: background var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard),
      color var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
    opacity: 0.6;
  }

  .tab-pill:hover {
    opacity: 0.85;
    background: var(--md-sys-color-surface-container-low);
  }

  .tab-pill.active {
    background: var(--md-sys-color-primary);
    color: var(--md-sys-color-surface);
    opacity: 1;
    font-weight: 600;
  }
</style>
