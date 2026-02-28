<script>
  /**
   * @file OptionsPanel.svelte
   * @description Settings modal overlay. Load/save logic lives here;
   *   sections in SettingsAppearance and SettingsMonitoring.
   * @since v0.1.0
   */
  import { theme, setTheme, uiScale, setUiScale } from '../stores/theme.js';
  import SettingsAppearance from './SettingsAppearance.svelte';
  import SettingsMonitoring from './SettingsMonitoring.svelte';

  let { open = $bindable(false) } = $props();

  let localTheme = $state($theme);
  let localScale = $state($uiScale);
  let scanInterval = $state(10);
  let notifications = $state(true);
  let apiKey = $state('');
  let customPatterns = $state('');
  let loaded = $state(false);

  $effect(() => {
    if (open) {
      localTheme = $theme;
      localScale = $uiScale;
      if (!loaded && window.aegis) {
        window.aegis
          .getSettings()
          .then((s) => {
            if (!s) return;
            scanInterval = s.scanIntervalSec ?? 10;
            notifications = s.notificationsEnabled ?? true;
            apiKey = s.anthropicApiKey ?? '';
            customPatterns = (s.customSensitivePatterns || []).join('\n');
            loaded = true;
          })
          .catch(() => {});
      }
    }
  });

  function onScaleInput(e) {
    localScale = parseFloat(e.target.value);
    document.documentElement.style.setProperty('--aegis-ui-scale', String(localScale));
  }
  function onThemeChange(e) {
    localTheme = e.target.value;
    document.documentElement.dataset.theme = localTheme;
  }

  async function handleSave() {
    setTheme(localTheme);
    setUiScale(localScale);
    if (window.aegis) {
      const patterns = customPatterns
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const current = await window.aegis.getSettings();
      await window.aegis.saveSettings({
        ...current,
        uiScale: localScale,
        scanIntervalSec: scanInterval,
        notificationsEnabled: notifications,
        anthropicApiKey: apiKey.trim(),
        customSensitivePatterns: patterns,
      });
    }
    loaded = false;
    open = false;
  }

  function handleCancel() {
    document.documentElement.dataset.theme = $theme;
    document.documentElement.style.setProperty('--aegis-ui-scale', String($uiScale));
    loaded = false;
    open = false;
  }
  function handleBackdrop(e) {
    if (e.target === e.currentTarget) handleCancel();
  }
  function handleKeydown(e) {
    if (e.key === 'Escape') handleCancel();
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="overlay"
    onclick={handleBackdrop}
    onkeydown={handleKeydown}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
  >
    <div class="panel" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
      <h2 class="panel-title">Settings</h2>

      <SettingsAppearance bind:localTheme bind:localScale {onThemeChange} {onScaleInput} />
      <SettingsMonitoring bind:scanInterval bind:notifications bind:apiKey bind:customPatterns />

      <div class="config-actions">
        <button class="btn" onclick={() => window.aegis?.exportConfig()}>Export Config</button>
        <button
          class="btn"
          onclick={async () => {
            const r = await window.aegis?.importConfig();
            if (r?.success) loaded = false;
          }}>Import Config</button
        >
      </div>

      <div class="panel-actions">
        <button class="btn btn-cancel" onclick={handleCancel}>Cancel</button>
        <button class="btn btn-save" onclick={handleSave}>Save</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: var(--md-sys-color-scrim);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fadeIn 150ms ease;
  }
  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  .panel {
    background: var(--md-sys-color-surface-container-high);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: var(--glass-border);
    box-shadow: var(--glass-shadow);
    border-radius: var(--md-sys-shape-corner-large);
    padding: var(--aegis-space-10);
    min-width: var(--aegis-size-modal-min);
    max-width: 460px;
    width: 90vw;
    max-height: 85vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--aegis-space-7);
    animation: scale-in var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing-standard);
  }
  @keyframes scale-in {
    from {
      opacity: 0;
      transform: scale(0.96) translateY(8px);
    }
  }
  .panel-title {
    font: var(--md-sys-typescale-headline-medium);
    color: var(--md-sys-color-on-surface);
    margin: 0;
  }
  .config-actions {
    display: flex;
    gap: var(--aegis-space-4);
    border-top: 1px solid var(--md-sys-color-outline-variant);
    padding-top: var(--aegis-space-6);
    margin-top: 2px;
  }
  .panel-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--aegis-space-4);
  }
  .btn {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 600;
    padding: var(--aegis-space-4) var(--aegis-space-9);
    border: none;
    border-radius: var(--md-sys-shape-corner-full);
    cursor: pointer;
    transition: all 0.3s var(--ease-glass);
  }
  .btn:hover {
    opacity: 0.85;
  }
  .btn:active {
    transform: scale(0.97);
  }
  .btn-cancel {
    background: transparent;
    border: 1px solid var(--md-sys-color-outline);
    color: var(--md-sys-color-on-surface-variant);
  }
  .btn-save {
    background: var(--md-sys-color-primary);
    color: var(--md-sys-color-on-primary);
  }
</style>
