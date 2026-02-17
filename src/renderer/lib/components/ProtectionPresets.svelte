<script>
  /** @type {{ activePreset?: string, onApply?: (name: string, config: Record<string, string>) => void }} */
  let { activePreset = $bindable('balanced'), onApply } = $props();

  const PRESETS = [
    { id: 'paranoid',  label: 'Paranoid',  desc: 'Block all',
      config: { filesystem:'block', sensitive:'block', network:'block', terminal:'block', clipboard:'block', screen:'block' } },
    { id: 'strict',    label: 'Strict',    desc: 'Monitor sensitive',
      config: { filesystem:'monitor', sensitive:'block', network:'block', terminal:'block', clipboard:'monitor', screen:'monitor' } },
    { id: 'balanced',  label: 'Balanced',  desc: 'Default protection',
      config: { filesystem:'monitor', sensitive:'monitor', network:'monitor', terminal:'monitor', clipboard:'monitor', screen:'monitor' } },
    { id: 'developer', label: 'Developer', desc: 'Minimal alerts',
      config: { filesystem:'allow', sensitive:'monitor', network:'allow', terminal:'allow', clipboard:'allow', screen:'allow' } },
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
    background: var(--md-sys-color-surface-container);
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-sys-shape-corner-medium);
    cursor: pointer;
    transition: all var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
  }

  .preset-btn:hover {
    background: var(--md-sys-color-surface-container-high);
    border-color: var(--md-sys-color-on-surface-variant);
  }

  .preset-btn.active {
    background: var(--md-sys-color-primary-container);
    border-color: var(--md-sys-color-primary);
  }

  .preset-label {
    font: var(--md-sys-typescale-title-medium);
    color: var(--md-sys-color-on-surface);
  }

  .preset-btn.active .preset-label {
    color: var(--md-sys-color-primary);
  }

  .preset-desc {
    font: var(--md-sys-typescale-label-medium);
    color: var(--md-sys-color-on-surface-variant);
  }
</style>
