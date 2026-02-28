<script>
  /**
   * @file SettingsAppearance.svelte
   * @description Theme toggle + UI scale slider for Settings panel.
   *   Extracted from OptionsPanel.svelte.
   * @since v0.3.0
   */
  let {
    localTheme = $bindable('dark'),
    localScale = $bindable(1),
    onThemeChange,
    onScaleInput,
  } = $props();

  let scalePercent = $derived(Math.round(localScale * 100));
</script>

<div class="section-label">Appearance</div>

<div class="option-group">
  <span class="option-label">Theme</span>
  <div class="theme-toggle">
    <label class="radio-label">
      <input
        type="radio"
        name="theme"
        value="dark"
        checked={localTheme === 'dark'}
        onchange={onThemeChange}
      /> Dark
    </label>
    <label class="radio-label">
      <input
        type="radio"
        name="theme"
        value="light"
        checked={localTheme === 'light'}
        onchange={onThemeChange}
      /> Light
    </label>
    <label class="radio-label">
      <input
        type="radio"
        name="theme"
        value="dark-hc"
        checked={localTheme === 'dark-hc'}
        onchange={onThemeChange}
      /> Dark HC
    </label>
    <label class="radio-label">
      <input
        type="radio"
        name="theme"
        value="light-hc"
        checked={localTheme === 'light-hc'}
        onchange={onThemeChange}
      /> Light HC
    </label>
  </div>
</div>

<div class="option-group">
  <label class="option-label" for="ui-scale-slider">
    Interface Scale <span class="scale-value">{scalePercent}%</span>
  </label>
  <input
    id="ui-scale-slider"
    type="range"
    min="0.8"
    max="1.5"
    step="0.1"
    value={localScale}
    oninput={onScaleInput}
    class="scale-slider"
  />
  <div class="scale-labels"><span>80%</span><span>100%</span><span>150%</span></div>
</div>

<style>
  .section-label {
    font: var(--md-sys-typescale-label-large);
    color: var(--md-sys-color-primary);
    text-transform: uppercase;
    letter-spacing: 0.8px;
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
    padding-bottom: var(--aegis-space-2);
    margin-top: var(--aegis-space-2);
  }
  .option-group {
    display: flex;
    flex-direction: column;
    gap: var(--aegis-space-3);
  }
  .option-label {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 600;
    color: var(--md-sys-color-on-surface-variant);
  }
  .scale-value {
    font-family: 'DM Mono', monospace;
    color: var(--md-sys-color-primary);
    font-weight: 700;
  }
  .theme-toggle {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--aegis-space-4) var(--aegis-space-8);
  }
  .radio-label {
    font: var(--md-sys-typescale-body-medium);
    color: var(--md-sys-color-on-surface);
    display: flex;
    align-items: center;
    gap: var(--aegis-space-3);
    cursor: pointer;
  }
  .radio-label input[type='radio'] {
    accent-color: var(--md-sys-color-primary);
  }
  .scale-slider {
    width: 100%;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--md-sys-color-surface-container-highest);
    border-radius: 2px;
    outline: none;
    cursor: pointer;
  }
  .scale-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--md-sys-color-primary);
    cursor: pointer;
  }
  .scale-labels {
    display: flex;
    justify-content: space-between;
    font: var(--md-sys-typescale-label-medium);
    color: var(--md-sys-color-on-surface-variant);
    opacity: 0.6;
  }
</style>
