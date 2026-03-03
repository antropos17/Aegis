<script>
  import { computeRing, getStrokeWidth, getTrackWidth } from '../utils/risk-ring-utils';

  /**
   * @type {{ score?: number, size?: number, showLabel?: boolean }}
   */
  let { score = 0, size = 200, showLabel = true } = $props();

  /* ── Derived geometry (recomputes only when score/size change) ── */
  let ring = $derived(computeRing(score, size));
  let strokeW = $derived(getStrokeWidth(size));
  let trackW = $derived(getTrackWidth(size));
  let radius = $derived((size - strokeW) / 2);
  let center = $derived(size / 2);

  /* ── Font sizes scale with ring size ── */
  let scoreFontSize = $derived(Math.round(size * 0.28));
  let labelFontSize = $derived(Math.round(size * 0.1));
</script>

<div
  class="risk-ring"
  class:is-danger={ring.isDanger}
  style="width:{size}px;height:{size}px"
  role="meter"
  aria-valuenow={ring.clamped}
  aria-valuemin={0}
  aria-valuemax={100}
  aria-label="System risk: {ring.clamped}%"
>
  <svg viewBox="0 0 {size} {size}" width={size} height={size} class="ring-svg">
    <!-- Glow filter -->
    <defs>
      <filter id="ring-glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>

    <!-- Rotated group: start arc at 12 o'clock -->
    <g transform="rotate(-90 {center} {center})">
      <!-- Background track -->
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="var(--fancy-border)"
        stroke-width={trackW}
        class="ring-track"
      />

      <!-- Filled arc -->
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={ring.risk.color}
        stroke-width={strokeW}
        stroke-linecap="round"
        stroke-dasharray={ring.circumference}
        stroke-dashoffset={ring.dashOffset}
        filter="url(#ring-glow)"
        class="ring-arc"
      />
    </g>
  </svg>

  <!-- Center text overlay -->
  <div class="ring-center">
    <span class="ring-score" style="font-size:{scoreFontSize}px;color:{ring.risk.color}">
      {ring.clamped}
    </span>
    {#if showLabel}
      <span class="ring-label" style="font-size:{labelFontSize}px">
        {ring.risk.label}
      </span>
    {/if}
  </div>
</div>

<style>
  .risk-ring {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    /* Responsive: never overflow parent */
    max-width: 100%;
    max-height: 100%;
    aspect-ratio: 1;
  }

  .ring-svg {
    display: block;
    max-width: 100%;
    max-height: 100%;
    overflow: visible;
  }

  /* ── Track ── */
  .ring-track {
    opacity: 0.5;
  }

  /* ── Animated arc transition ── */
  .ring-arc {
    transition:
      stroke-dashoffset 800ms var(--fancy-ease),
      stroke 400ms var(--fancy-ease);
    will-change: stroke-dashoffset;
  }

  /* ── Center overlay ── */
  .ring-center {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    gap: 2px;
  }

  .ring-score {
    font-family: var(--fancy-font-mono);
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.02em;
    transition: color 400ms var(--fancy-ease);
  }

  .ring-label {
    font-family: var(--fancy-font-body);
    font-weight: 600;
    color: var(--fancy-text-2);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    line-height: 1;
  }

  /* ── Danger pulse (GPU-only: transform scale) ── */
  @keyframes risk-pulse {
    0%,
    100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.03);
    }
  }

  .is-danger {
    animation: risk-pulse 2s var(--fancy-ease) infinite;
    will-change: transform;
  }
</style>
