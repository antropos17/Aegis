<script>
  import { theme, setTheme, uiScale, setUiScale } from '../stores/theme.js';

  let { open = $bindable(false) } = $props();

  // Appearance
  let localTheme = $state($theme);
  let localScale = $state($uiScale);

  // Settings
  let scanInterval = $state(10);
  let notifications = $state(true);
  let apiKey = $state('');
  let customPatterns = $state('');
  let showKey = $state(false);
  let loaded = $state(false);
  let testResult = $state('');

  $effect(() => {
    if (open) {
      localTheme = $theme;
      localScale = $uiScale;
      testResult = '';
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
    // Save appearance
    setTheme(localTheme);
    setUiScale(localScale);

    // Save all settings
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

  async function testNotify() {
    testResult = '';
    if (!window.aegis?.testNotification) {
      testResult = 'Not available';
      return;
    }
    const r = await window.aegis.testNotification();
    testResult = r.success ? 'Sent' : r.error || 'Failed';
  }

  let scalePercent = $derived(Math.round(localScale * 100));
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

      <!-- ── Appearance ── -->
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
            />
            Dark
          </label>
          <label class="radio-label">
            <input
              type="radio"
              name="theme"
              value="light"
              checked={localTheme === 'light'}
              onchange={onThemeChange}
            />
            Light
          </label>
          <label class="radio-label">
            <input
              type="radio"
              name="theme"
              value="dark-hc"
              checked={localTheme === 'dark-hc'}
              onchange={onThemeChange}
            />
            Dark HC
          </label>
          <label class="radio-label">
            <input
              type="radio"
              name="theme"
              value="light-hc"
              checked={localTheme === 'light-hc'}
              onchange={onThemeChange}
            />
            Light HC
          </label>
        </div>
      </div>

      <div class="option-group">
        <label class="option-label" for="ui-scale-slider"
          >Interface Scale <span class="scale-value">{scalePercent}%</span></label
        >
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
        <div class="scale-labels">
          <span>80%</span>
          <span>100%</span>
          <span>150%</span>
        </div>
      </div>

      <!-- ── Monitoring ── -->
      <div class="section-label">Monitoring</div>

      <div class="option-group">
        <span class="option-label">Scan Interval</span>
        <div class="range-row">
          <input type="range" min="3" max="60" step="1" bind:value={scanInterval} />
          <span class="range-val">{scanInterval}s</span>
        </div>
      </div>

      <div class="option-group row">
        <span class="option-label">Notifications</span>
        <div class="notif-row">
          <button
            class="toggle"
            class:toggle-on={notifications}
            aria-label="Toggle notifications"
            onclick={() => {
              notifications = !notifications;
            }}
          >
            <span class="toggle-knob"></span>
          </button>
          <button class="btn btn-small" onclick={testNotify}>Test</button>
          {#if testResult}
            <span class="test-result">{testResult}</span>
          {/if}
        </div>
      </div>

      <!-- ── AI Analysis ── -->
      <div class="section-label">AI Analysis</div>

      <div class="option-group">
        <span class="option-label">Anthropic API Key</span>
        <div class="key-row">
          {#if showKey}
            <input type="text" bind:value={apiKey} placeholder="sk-ant-..." class="key-input" />
          {:else}
            <input type="password" bind:value={apiKey} placeholder="sk-ant-..." class="key-input" />
          {/if}
          <button
            class="btn btn-small"
            onclick={() => {
              showKey = !showKey;
            }}
          >
            {showKey ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      <div class="option-group">
        <span class="option-label">Custom Sensitive Patterns</span>
        <span class="field-hint">One regex per line</span>
        <textarea
          rows="3"
          bind:value={customPatterns}
          placeholder="e.g. \.secret$&#10;passwords\.txt"
        ></textarea>
      </div>

      <!-- ── Config ── -->
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

  .option-group.row {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }

  .option-label {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 600;
    color: var(--md-sys-color-on-surface-variant);
  }

  .field-hint {
    font: var(--md-sys-typescale-label-medium);
    color: var(--md-sys-color-on-surface-variant);
    opacity: 0.6;
    font-size: calc(10px * var(--aegis-ui-scale));
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

  /* Range row for scan interval */
  .range-row {
    display: flex;
    align-items: center;
    gap: var(--aegis-space-5);
  }
  .range-row input[type='range'] {
    flex: 1;
    accent-color: var(--md-sys-color-primary);
  }
  .range-val {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 600;
    font-family: 'DM Mono', monospace;
    color: var(--md-sys-color-on-surface);
    min-width: 32px;
    text-align: right;
  }

  /* Toggle switch */
  .toggle {
    position: relative;
    width: 40px;
    height: 22px;
    padding: 0;
    cursor: pointer;
    background: var(--md-sys-color-surface-container);
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-sys-shape-corner-full);
    transition: background var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
    flex-shrink: 0;
  }
  .toggle-on {
    background: var(--md-sys-color-primary-container);
    border-color: var(--md-sys-color-primary);
  }
  .toggle-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--md-sys-color-on-surface-variant);
    transition: all var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
  }
  .toggle-on .toggle-knob {
    left: 20px;
    background: var(--md-sys-color-primary);
  }

  .notif-row {
    display: flex;
    align-items: center;
    gap: var(--aegis-space-4);
  }

  .test-result {
    font: var(--md-sys-typescale-label-medium);
    font-family: 'DM Mono', monospace;
    color: var(--md-sys-color-primary);
  }

  /* Key input */
  .key-row {
    display: flex;
    gap: var(--aegis-space-4);
  }
  .key-input,
  textarea {
    font: var(--md-sys-typescale-body-medium);
    font-family: 'DM Mono', monospace;
    font-size: calc(12px * var(--aegis-ui-scale));
    padding: var(--aegis-space-4) var(--aegis-space-5);
    background: var(--md-sys-color-surface-container);
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-sys-shape-corner-small);
    color: var(--md-sys-color-on-surface);
    outline: none;
  }
  .key-input {
    flex: 1;
  }
  textarea {
    resize: vertical;
    width: 100%;
    box-sizing: border-box;
  }
  .key-input:focus,
  textarea:focus {
    border-color: var(--md-sys-color-primary);
  }

  /* Config row */
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

  .btn-small {
    padding: var(--aegis-space-3) var(--aegis-space-6);
    border-radius: var(--md-sys-shape-corner-small);
    background: var(--md-sys-color-surface-container);
    border: 1px solid var(--md-sys-color-outline);
    color: var(--md-sys-color-on-surface-variant);
  }
  .btn-small:hover {
    color: var(--md-sys-color-on-surface);
    background: var(--md-sys-color-surface-container-high);
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
