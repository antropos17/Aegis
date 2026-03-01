<div class="demo-banner" role="status" aria-live="polite">
  <span class="demo-badge">DEMO MODE</span>
  <span class="demo-text">Simulated data only. No real agents are being monitored.</span>
  <a
    class="demo-link"
    href="https://github.com/antropos17/Aegis"
    target="_blank"
    rel="noopener noreferrer"
  >
    Install AEGIS &rarr;
  </a>
</div>

<style>
  .demo-banner {
    position: fixed;
    bottom: var(--aegis-size-footer);
    left: 0;
    right: 0;
    z-index: 90;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--aegis-space-5);
    padding: var(--aegis-space-3) var(--aegis-space-9);
    background: var(--md-sys-color-tertiary-container);
    border-top: 1px solid color-mix(in srgb, var(--md-sys-color-tertiary) 30%, transparent);
    animation: bannerSlideIn 0.4s var(--md-sys-motion-easing-standard) both;
  }

  @media (prefers-reduced-motion: reduce) {
    .demo-banner {
      animation: none;
    }
  }

  @keyframes bannerSlideIn {
    from {
      opacity: 0;
      transform: translateY(100%);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .demo-badge {
    font-family: 'DM Mono', monospace;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    background: var(--md-sys-color-tertiary);
    color: var(--md-sys-color-on-tertiary);
    padding: 2px var(--aegis-space-4);
    border-radius: var(--md-sys-shape-corner-extra-small);
    flex-shrink: 0;
  }

  .demo-text {
    font: var(--md-sys-typescale-body-small);
    color: var(--md-sys-color-on-tertiary-container);
  }

  .demo-link {
    font: var(--md-sys-typescale-label-small);
    font-weight: 600;
    color: var(--md-sys-color-on-tertiary-container);
    text-decoration: underline;
    text-underline-offset: 2px;
    flex-shrink: 0;
    transition: opacity 0.2s;
  }

  .demo-link:hover {
    opacity: 0.75;
  }
</style>
