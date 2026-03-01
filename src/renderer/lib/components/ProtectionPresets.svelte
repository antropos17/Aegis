<script>
  import { t } from '../i18n/index.js';

  /** @type {{ activePreset?: string, onApply?: (name: string, config: Record<string, string>) => void }} */
  let { activePreset = $bindable('balanced'), onApply } = $props();

  const PRESETS = [
    {
      id: 'paranoid',
      labelKey: 'rules.protection.paranoid',
      descKey: 'rules.protection.paranoid_desc',
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
      labelKey: 'rules.protection.strict',
      descKey: 'rules.protection.strict_desc',
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
      labelKey: 'rules.protection.balanced',
      descKey: 'rules.protection.balanced_desc',
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
      labelKey: 'rules.protection.developer',
      descKey: 'rules.protection.developer_desc',
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
      <span class="preset-label">{$t(preset.labelKey)}</span>
      <span class="preset-desc">{$t(preset.descKey)}</span>
    </button>
  {/each}
</div>

<style>
  .presets-row {
    display: flex;
    gap: var(--aegis-space-4);
  }

  .preset-btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--aegis-space-2);
    padding: var(--aegis-space-5) var(--aegis-space-4);
    background: var(--md-sys-color-surface-container-low);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: var(--glass-border);
    box-shadow: var(--glass-shadow-card), var(--glass-highlight);
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
    font-size: calc(10px * var(--aegis-ui-scale));
    color: var(--md-sys-color-on-surface-variant);
  }

  .preset-btn.active .preset-desc {
    color: rgba(255, 255, 255, 0.7);
  }
</style>
