<div class="demo-banner" role="status" aria-live="polite">
  <span class="demo-badge">DEMO</span>
  <span class="demo-text">
    Monitoring <strong>106</strong> AI agents across <strong>11</strong> categories
    <span class="demo-sep">&middot;</span>
    Simulated scenario data
  </span>
  <a
    class="demo-link"
    href="https://github.com/anthropos17/Aegis"
    target="_blank"
    rel="noopener noreferrer"
  >
    &#9733; Star on GitHub &rarr;
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
    font-family: var(--fancy-font-mono);
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

  .demo-text strong {
    font-weight: 700;
    color: var(--md-sys-color-on-tertiary-container);
  }

  .demo-sep {
    margin: 0 var(--aegis-space-2);
    opacity: 0.5;
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
