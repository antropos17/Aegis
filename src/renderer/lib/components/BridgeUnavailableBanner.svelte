<!--
  Shown when a production build runs without the Electron preload bridge: no scan is
  running and no data will arrive. Before this existed, that state silently started the
  browser demo engine, so a dashboard full of fabricated agents looked exactly like a
  live one. The banner is the explicit alternative — it states that nothing is being
  monitored rather than inventing something to display.
-->
<div class="bridge-unavailable" role="alert" aria-live="assertive">
  <span class="bu-badge">NO DATA</span>
  <span class="bu-text">
    <strong>Monitoring is not running.</strong> The desktop bridge did not load, so no processes, files
    or connections are being scanned. Nothing below is simulated — the panels are empty because there
    is no data, not because your machine is quiet.
  </span>
</div>

<style>
  .bridge-unavailable {
    display: flex;
    align-items: center;
    gap: var(--aegis-space-5);
    margin: 0 var(--aegis-space-9);
    padding: var(--aegis-space-4) var(--aegis-space-6);
    border: 1px solid color-mix(in srgb, var(--md-sys-color-error) 40%, transparent);
    border-radius: var(--md-sys-shape-corner-medium);
    background: var(--md-sys-color-error-container);
    flex-shrink: 0;
  }

  .bu-badge {
    font-family: var(--fancy-font-mono);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: var(--md-sys-color-error);
    border: 1px solid color-mix(in srgb, var(--md-sys-color-error) 50%, transparent);
    padding: 2px var(--aegis-space-4);
    border-radius: var(--md-sys-shape-corner-small);
    flex-shrink: 0;
  }

  .bu-text {
    font: var(--md-sys-typescale-body-small);
    color: var(--md-sys-color-on-surface);
  }

  .bu-text strong {
    font-weight: 700;
    color: var(--md-sys-color-error);
  }
</style>
