<script>
  /** @type {{ activePreset?: string, onApply?: (name: string, config: Record<string, string>) => void }} */
  let { activePreset = $bindable('balanced'), onApply } = $props();

  const PRESETS = [
    {
      id: 'paranoid',
      label: 'Paranoid',
      desc: 'Block all agent file access',
      config: {
        filesystem: 'block',
        sensitive: 'block',
        network: 'block',
        terminal: 'block',
        clipboard: 'block',
        screen: 'block',
      },
    },
    {
      id: 'strict',
      label: 'Strict',
      desc: 'Monitor sensitive, block credentials',
      config: {
        filesystem: 'monitor',
        sensitive: 'block',
        network: 'block',
        terminal: 'block',
        clipboard: 'monitor',
        screen: 'monitor',
      },
    },
    {
      id: 'balanced',
      label: 'Balanced',
      desc: 'Monitor all, allow safe operations',
      config: {
        filesystem: 'monitor',
        sensitive: 'monitor',
        network: 'monitor',
        terminal: 'monitor',
        clipboard: 'monitor',
        screen: 'monitor',
      },
    },
    {
      id: 'developer',
      label: 'Developer',
      desc: 'Minimal restrictions',
      config: {
        filesystem: 'allow',
        sensitive: 'monitor',
        network: 'allow',
        terminal: 'allow',
        clipboard: 'allow',
        screen: 'allow',
      },
    },
  ];

  function select(preset) {
    activePreset = preset.id;
    onApply?.(preset.id, preset.config);
  }
</script>

<div class="presets-row">
  {#each PRESETS as preset (preset.id)}
    <button
      class="preset-btn"
      class:active={activePreset === preset.id}
      onclick={() => select(preset)}
    >
      <span class="preset-label">{preset.label}</span>
      <span class="preset-desc">{preset.desc}</span>
    </button>
  {/each}
</div>

<style>
  .presets-row {
    display: flex;
    gap: 8px;
  }

  .preset-btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 10px 8px;
    background: var(--md-sys-color-surface-container-low);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: var(--glass-border);
    box-shadow: var(--glass-shadow), var(--glass-highlight);
    border-radius: var(--md-sys-shape-corner-medium);
    cursor: pointer;
    transition: all 0.3s var(--ease-glass);
  }

  .preset-btn:hover {
    background: var(--md-sys-color-surface-container-high);
    border-color: rgba(255, 255, 255, 0.15);
  }

  .preset-btn.active {
    background: var(--md-sys-color-primary);
    border-color: var(--md-sys-color-primary);
    box-shadow: 0 2px 16px rgba(122, 138, 158, 0.3);
  }

  .preset-label {
    font: var(--md-sys-typescale-title-medium);
    color: var(--md-sys-color-on-surface);
  }

  .preset-btn.active .preset-label {
    color: var(--md-sys-color-surface);
  }

  .preset-desc {
    font: var(--md-sys-typescale-label-medium);
    font-size: 10px;
    color: var(--md-sys-color-on-surface-variant);
  }

  .preset-btn.active .preset-desc {
    color: rgba(255, 255, 255, 0.7);
  }
</style>
