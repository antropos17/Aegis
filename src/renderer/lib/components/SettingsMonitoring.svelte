<script>
  /**
   * @file SettingsMonitoring.svelte
   * @description Scan interval, notifications, API key, and custom patterns
   *   for Settings panel. Extracted from OptionsPanel.svelte.
   * @since v0.3.0
   */
  import { t } from '../i18n/index.js';

  let {
    scanInterval = $bindable(10),
    notifications = $bindable(true),
    apiKey = $bindable(''),
    customPatterns = $bindable(''),
  } = $props();

  let showKey = $state(false);
  let testResult = $state('');

  async function testNotify() {
    testResult = '';
    if (!window.aegis?.testNotification) {
      testResult = $t('settings.monitoring.not_available');
      return;
    }
    const r = await window.aegis.testNotification();
    testResult = r.success
      ? $t('settings.monitoring.sent')
      : r.error || $t('settings.monitoring.failed');
  }
</script>

<!-- ── Monitoring ── -->
<div class="section-label">{$t('settings.monitoring.title')}</div>

<div class="option-group">
  <span class="option-label">{$t('settings.monitoring.scan_interval')}</span>
  <div class="range-row">
    <input type="range" min="3" max="60" step="1" bind:value={scanInterval} />
    <span class="range-val">{scanInterval}s</span>
  </div>
</div>

<div class="option-group row">
  <span class="option-label">{$t('settings.monitoring.notifications')}</span>
  <div class="notif-row">
    <button
      class="toggle"
      class:toggle-on={notifications}
      aria-label={$t('settings.monitoring.toggle_notifications')}
      onclick={() => {
        notifications = !notifications;
      }}
    >
      <span class="toggle-knob"></span>
    </button>
    <button class="btn btn-small" onclick={testNotify}>{$t('settings.monitoring.test')}</button>
    {#if testResult}<span class="test-result">{testResult}</span>{/if}
  </div>
</div>

<!-- ── AI Analysis ── -->
<div class="section-label">{$t('settings.monitoring.ai_analysis')}</div>

<div class="option-group">
  <span class="option-label">{$t('settings.monitoring.api_key')}</span>
  <div class="key-row">
    {#if showKey}
      <input
        type="text"
        bind:value={apiKey}
        placeholder={$t('settings.monitoring.api_key_placeholder')}
        class="key-input"
      />
    {:else}
      <input
        type="password"
        bind:value={apiKey}
        placeholder={$t('settings.monitoring.api_key_placeholder')}
        class="key-input"
      />
    {/if}
    <button
      class="btn btn-small"
      onclick={() => {
        showKey = !showKey;
      }}
    >
      {showKey ? $t('settings.monitoring.hide') : $t('settings.monitoring.show')}
    </button>
  </div>
</div>

<div class="option-group">
  <span class="option-label">{$t('settings.monitoring.custom_patterns')}</span>
  <span class="field-hint">{$t('settings.monitoring.patterns_hint')}</span>
  <textarea rows="3" bind:value={customPatterns} placeholder="e.g. \.secret$&#10;passwords\.txt"
  ></textarea>
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
</style>
