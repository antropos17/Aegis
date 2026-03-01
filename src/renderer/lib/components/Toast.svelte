<script>
  import { toasts, removeToast } from '../stores/toast.js';

  const ICONS = {
    success: '\u2713',
    warning: '\u26A0',
    error: '\u2716',
  };
</script>

<div class="toast-stack" aria-live="polite" aria-relevant="additions removals">
  {#each $toasts as toast (toast.id)}
    <div class="toast toast-{toast.type}" role="alert">
      <span class="toast-icon">{ICONS[toast.type] ?? ''}</span>
      <span class="toast-msg">{toast.message}</span>
      <button
        class="toast-close"
        aria-label="Dismiss notification"
        onclick={() => removeToast(toast.id)}
      >&times;</button>
    </div>
  {/each}
</div>

<style>
  .toast-stack {
    position: fixed;
    bottom: calc(var(--aegis-size-footer) + var(--aegis-space-8));
    right: var(--aegis-space-9);
    display: flex;
    flex-direction: column-reverse;
    gap: var(--aegis-space-4);
    z-index: 9000;
    pointer-events: none;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: var(--aegis-space-4);
    padding: var(--aegis-space-5) var(--aegis-space-8);
    border-radius: var(--md-sys-shape-corner-medium);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    box-shadow: var(--glass-shadow);
    border: var(--glass-border);
    font: var(--md-sys-typescale-body-medium);
    color: var(--md-sys-color-on-surface);
    pointer-events: auto;
    min-width: 280px;
    max-width: 420px;
    animation: toastIn var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing-standard);
  }

  .toast-success {
    background: rgba(56, 161, 105, 0.18);
    border-left: 3px solid #38A169;
  }
  .toast-warning {
    background: rgba(237, 137, 54, 0.18);
    border-left: 3px solid #ED8936;
  }
  .toast-error {
    background: rgba(229, 62, 62, 0.18);
    border-left: 3px solid #E53E3E;
  }

  .toast-icon {
    flex-shrink: 0;
    font-size: calc(14px * var(--aegis-ui-scale, 1));
  }
  .toast-success .toast-icon { color: #38A169; }
  .toast-warning .toast-icon { color: #ED8936; }
  .toast-error .toast-icon { color: #E53E3E; }

  .toast-msg {
    flex: 1;
    min-width: 0;
    word-break: break-word;
  }

  .toast-close {
    flex-shrink: 0;
    background: none;
    border: none;
    color: var(--md-sys-color-on-surface-variant);
    cursor: pointer;
    font-size: calc(16px * var(--aegis-ui-scale, 1));
    padding: 0 var(--aegis-space-2);
    line-height: 1;
    opacity: 0.6;
    transition: opacity var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
  }
  .toast-close:hover { opacity: 1; }

  @keyframes toastIn {
    from {
      opacity: 0;
      transform: translateX(40px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .toast {
      animation: none;
    }
  }
</style>
