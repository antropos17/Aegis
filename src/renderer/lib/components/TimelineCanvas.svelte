<script>
  /**
   * @file TimelineCanvas.svelte
   * @description SVG timeline rendering — baseline track, ticks, and event dots.
   *   Extracted from Timeline.svelte. Receives all data via props.
   * @since v0.3.0
   */

  let {
    viewportWidth,
    svgH,
    viewBox,
    clampedScroll,
    pad,
    mid,
    tickTop,
    tickH,
    ticks,
    dots,
    onDotEnter,
    onDotMove,
    onDotLeave,
    onDotClick,
  } = $props();
</script>

<div class="timeline-viewport" id="timeline-viewport">
  <svg width={viewportWidth} height={svgH} {viewBox}>
    <!-- baseline track -->
    <line
      x1={clampedScroll + pad}
      y1={mid}
      x2={clampedScroll + viewportWidth - pad}
      y2={mid}
      class="baseline"
    />

    <!-- ticks -->
    {#each ticks as t (t.x)}
      <line x1={t.x} y1={tickTop} x2={t.x} y2={tickTop + tickH} class="tick-line" />
      <text x={t.x} y={tickTop + tickH + 1} text-anchor="middle" class="tick-label"
        >{t.label}</text
      >
    {/each}

    <!-- dots -->
    {#each dots as dot (dot.idx)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <circle
        cx={dot.x}
        cy={mid}
        r={4}
        fill={dot.color}
        opacity="0.85"
        class="dot"
        onmouseenter={(e) => onDotEnter(e, dot)}
        onmousemove={(e) => onDotMove(e)}
        onmouseleave={onDotLeave}
        onclick={(e) => onDotClick(e, dot)}
      />
    {/each}
  </svg>
</div>

<style>
  .timeline-viewport {
    width: 100%;
    height: var(--aegis-size-timeline);
    overflow: hidden;
    -webkit-mask-image: linear-gradient(
      to right, transparent, black 28px, black calc(100% - 28px), transparent
    );
    mask-image: linear-gradient(
      to right, transparent, black 28px, black calc(100% - 28px), transparent
    );
  }
  svg { display: block; }
  .baseline {
    stroke: var(--md-sys-color-on-surface-variant);
    stroke-width: 1;
    opacity: 0.2;
  }
  .tick-line {
    stroke: var(--md-sys-color-on-surface-variant);
    stroke-width: 1;
    opacity: 0.3;
  }
  .tick-label {
    fill: var(--md-sys-color-on-surface-variant);
    opacity: 0.5;
    font-family: 'DM Mono', monospace;
    font-size: calc(9px * var(--aegis-ui-scale, 1));
    font-weight: var(--md-sys-typescale-label-medium-weight, 500);
  }
  .dot {
    cursor: pointer;
    transition: opacity var(--md-sys-motion-duration-short, 100ms)
      var(--md-sys-motion-easing-standard, ease);
  }
  .dot:hover {
    opacity: 1;
    filter: brightness(1.3);
  }
</style>
