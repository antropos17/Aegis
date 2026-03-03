<script>
  import { t } from '../i18n/index.js';
  import { TRANSITION_DURATION_MS } from '../utils/tab-transitions.js';

  let { activeTab = $bindable('shield') } = $props();

  let tabs = $derived([
    { id: 'shield', label: $t('tabs.shield') },
    { id: 'activity', label: $t('tabs.activity') },
    { id: 'rules', label: $t('tabs.rules') },
    { id: 'reports', label: $t('tabs.reports') },
    { id: 'stats', label: $t('tabs.stats') },
  ]);

  /** @type {HTMLDivElement | undefined} */
  let barEl = $state(undefined);

  /** Indicator position & size */
  let indicatorX = $state(0);
  let indicatorW = $state(0);
  let hasAnimated = $state(false);

  $effect(() => {
    // Re-run when activeTab changes
    const _tab = activeTab;
    if (!barEl) return;
    const btn = /** @type {HTMLElement | null} */ (barEl.querySelector(`#tab-${_tab}`));
    if (!btn) return;
    indicatorX = btn.offsetLeft;
    indicatorW = btn.offsetWidth;
    // Enable transitions only after first measurement
    if (!hasAnimated) {
      requestAnimationFrame(() => {
        hasAnimated = true;
      });
    }
  });
</script>

<div
  class="tab-bar"
  role="tablist"
  aria-label="Main navigation"
  bind:this={barEl}
  style:--ind-x="{indicatorX}px"
  style:--ind-w="{indicatorW}px"
  style:--ind-dur="{TRANSITION_DURATION_MS}ms"
>
  <div class="tab-indicator" class:animated={hasAnimated} aria-hidden="true"></div>

  {#each tabs as tab, i (tab.id)}
    <button
      id="tab-{tab.id}"
      class="tab-pill"
      class:active={activeTab === tab.id}
      role="tab"
      aria-selected={activeTab === tab.id}
      aria-controls="tabpanel-{tab.id}"
      aria-keyshortcuts={String(i + 1)}
      onclick={() => (activeTab = tab.id)}
    >
      {tab.label}
    </button>
  {/each}
</div>

<style>
  .tab-bar {
    display: flex;
    gap: var(--aegis-space-3);
    padding: var(--aegis-space-3);
    background: var(--md-sys-color-surface-container-low);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: var(--glass-border);
    border-radius: var(--md-sys-shape-corner-medium);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
    width: fit-content;
    position: relative;
  }

  .tab-indicator {
    position: absolute;
    top: var(--aegis-space-3);
    left: 0;
    height: calc(100% - var(--aegis-space-3) * 2);
    width: var(--ind-w);
    transform: translateX(var(--ind-x));
    background: var(--md-sys-color-primary);
    border-radius: var(--md-sys-shape-corner-small);
    box-shadow: 0 2px 12px rgba(122, 138, 158, 0.3);
    pointer-events: none;
    will-change: transform, width;
  }

  .tab-indicator.animated {
    transition:
      transform var(--ind-dur) var(--ease-glass),
      width var(--ind-dur) var(--ease-glass);
  }

  .tab-pill {
    position: relative;
    z-index: 1;
    padding: var(--aegis-space-4) var(--aegis-space-9);
    border: none;
    border-radius: var(--md-sys-shape-corner-small);
    background: transparent;
    color: var(--md-sys-color-on-surface-variant);
    font-family: inherit;
    font-size: calc(0.875rem * var(--aegis-ui-scale));
    font-weight: 500;
    cursor: pointer;
    transition:
      color var(--ind-dur, 220ms) var(--ease-glass),
      font-weight var(--ind-dur, 220ms) var(--ease-glass);
  }

  .tab-pill:hover {
    color: var(--md-sys-color-on-surface);
  }

  .tab-pill.active {
    color: var(--md-sys-color-on-primary);
    font-weight: 600;
  }
</style>
