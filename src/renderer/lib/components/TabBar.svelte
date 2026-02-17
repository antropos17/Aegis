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
  {#each tabs as tab}
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
    background: var(--bg, #0c0c0e);
    border-radius: 12px;
    width: fit-content;
  }

  .tab-pill {
    padding: 8px 20px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--text, #e8e6e2);
    font-family: inherit;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s, color 0.2s;
    opacity: 0.6;
  }

  .tab-pill:hover {
    opacity: 0.85;
    background: var(--surface-1, #141416);
  }

  .tab-pill.active {
    background: var(--accent, #7a8a9e);
    color: var(--bg, #0c0c0e);
    opacity: 1;
    font-weight: 600;
  }
</style>
