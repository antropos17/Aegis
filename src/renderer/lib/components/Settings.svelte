<script>
  let { open = $bindable(false) } = $props();

  let scanInterval = $state(10);
  let notifications = $state(true);
  let apiKey = $state('');
  let customPatterns = $state('');
  let showKey = $state(false);
  let loaded = $state(false);

  $effect(() => {
    if (!open || loaded || !window.aegis) return;
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
  });

  function close() {
    open = false;
    loaded = false;
    showKey = false;
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') close();
  }

  async function save() {
    if (!window.aegis) return;
    const patterns = customPatterns
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const current = await window.aegis.getSettings();
    await window.aegis.saveSettings({
      ...current,
      scanIntervalSec: scanInterval,
      notificationsEnabled: notifications,
      anthropicApiKey: apiKey.trim(),
      customSensitivePatterns: patterns,
    });
    close();
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="overlay"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    onclick={close}
    onkeydown={handleKeydown}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
      <h3 class="modal-title">Settings</h3>
      <div class="fields">
        <label class="field">
          <span class="field-label">Scan interval</span>
          <div class="range-row">
            <input type="range" min="3" max="60" step="1" bind:value={scanInterval} />
            <span class="range-val">{scanInterval}s</span>
          </div>
        </label>
        <label class="field">
          <span class="field-label">Notifications</span>
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
        </label>
        <label class="field">
          <span class="field-label">Anthropic API key</span>
          <div class="key-row">
            {#if showKey}
              <input type="text" bind:value={apiKey} placeholder="sk-ant-..." class="key-input" />
            {:else}
              <input
                type="password"
                bind:value={apiKey}
                placeholder="sk-ant-..."
                class="key-input"
              />
            {/if}
            <button
              class="toggle-vis"
              onclick={() => {
                showKey = !showKey;
              }}
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>
        <label class="field">
          <span class="field-label">Custom sensitive patterns</span>
          <span class="field-hint">One regex per line</span>
          <textarea
            rows="4"
            bind:value={customPatterns}
            placeholder="e.g. \.secret$&#10;passwords\.txt"
          ></textarea>
        </label>
      </div>
      <div class="config-actions">
        <button class="btn" onclick={() => window.aegis?.exportConfig()}>Export Config</button>
        <button
          class="btn"
          onclick={async () => {
            const r = await window.aegis?.importConfig();
            if (r?.success) {
              loaded = false;
            }
          }}>Import Config</button
        >
      </div>
      <div class="modal-actions">
        <button class="btn" onclick={close}>Cancel</button>
        <button class="btn primary" onclick={save}>Save</button>
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
    animation: fade-in var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing-standard);
  }
  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }
  .modal {
    background: var(--md-sys-color-surface-container-high);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: var(--glass-border);
    box-shadow: var(--glass-shadow), var(--glass-highlight);
    border-radius: var(--md-sys-shape-corner-large);
    padding: 24px;
    min-width: 380px;
    max-width: 460px;
    width: 90vw;
    animation: scale-in var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing-standard);
  }
  @keyframes scale-in {
    from {
      opacity: 0;
      transform: scale(0.96) translateY(8px);
    }
  }
  .modal-title {
    font: var(--md-sys-typescale-headline-medium);
    color: var(--md-sys-color-on-surface);
    margin: 0 0 20px;
  }
  .fields {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-bottom: 24px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .field-label {
    font: var(--md-sys-typescale-label-medium);
    color: var(--md-sys-color-on-surface-variant);
  }
  .field-hint {
    font: var(--md-sys-typescale-label-medium);
    color: var(--md-sys-color-on-surface-variant);
    opacity: 0.6;
    font-size: 10px;
  }

  .range-row {
    display: flex;
    align-items: center;
    gap: 10px;
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
    align-self: flex-start;
    background: var(--md-sys-color-surface-container);
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-sys-shape-corner-full);
    transition: background var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
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

  .key-row {
    display: flex;
    gap: 8px;
  }
  .key-input,
  textarea {
    font: var(--md-sys-typescale-body-medium);
    font-family: 'DM Mono', monospace;
    font-size: 12px;
    padding: 8px 10px;
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
  }
  .key-input:focus,
  textarea:focus {
    border-color: var(--md-sys-color-primary);
  }
  .toggle-vis {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 600;
    padding: 6px 10px;
    cursor: pointer;
    background: var(--md-sys-color-surface-container);
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-sys-shape-corner-small);
    color: var(--md-sys-color-on-surface-variant);
  }
  .toggle-vis:hover {
    color: var(--md-sys-color-on-surface);
  }

  .config-actions {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
    border-top: 1px solid var(--md-sys-color-outline-variant);
    padding-top: 16px;
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .btn {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 600;
    padding: 8px 16px;
    cursor: pointer;
    background: var(--md-sys-color-surface-container);
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-sys-shape-corner-small);
    color: var(--md-sys-color-on-surface-variant);
    transition: all var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
  }
  .btn:hover {
    background: var(--md-sys-color-surface-container-high);
    color: var(--md-sys-color-on-surface);
  }
  .btn:active {
    transform: scale(0.97);
  }
  .btn.primary {
    background: var(--md-sys-color-primary-container);
    color: var(--md-sys-color-on-surface);
    border-color: var(--md-sys-color-primary);
  }
  .btn.primary:hover {
    background: color-mix(in srgb, var(--md-sys-color-primary-container) 80%, white);
  }
</style>
