<script>
  /**
   * @file TimelineCanvas.svelte
   * @description SVG timeline — severity lanes, agent connection lines,
   *   clustered dots with strokes, tick labels. All data via props.
   * @since v0.3.0
   */

  let {
    viewportWidth,
    svgH,
    viewBox,
    clampedScroll,
    lanePositions,
    tickTop,
    tickH,
    ticks,
    dots,
    links = [],
    onDotEnter,
    onDotMove,
    onDotLeave,
    onDotClick,
  } = $props();
</script>

<div class="timeline-viewport" id="timeline-viewport">
  <svg width={viewportWidth} height={svgH} {viewBox}>
    <!-- lane guide lines -->
    <line
      x1={clampedScroll}
      y1={lanePositions.crit}
      x2={clampedScroll + viewportWidth}
      y2={lanePositions.crit}
      class="lane-line"
    />
    <line
      x1={clampedScroll}
      y1={lanePositions.high}
      x2={clampedScroll + viewportWidth}
      y2={lanePositions.high}
      class="lane-line"
    />
    <line
      x1={clampedScroll}
      y1={lanePositions.med}
      x2={clampedScroll + viewportWidth}
      y2={lanePositions.med}
      class="lane-line"
    />
    <line
      x1={clampedScroll}
      y1={lanePositions.low}
      x2={clampedScroll + viewportWidth}
      y2={lanePositions.low}
      class="lane-line"
    />

    <!-- agent connection lines (behind dots) -->
    {#each links as link, i (i)}
      <line
        x1={link.x1}
        y1={link.y1}
        x2={link.x2}
        y2={link.y2}
        stroke={link.color}
        stroke-width="1.5"
        stroke-dasharray="4 3"
        class="agent-link"
      />
    {/each}

    <!-- ticks -->
    {#each ticks as t (t.x)}
      <line x1={t.x} y1={tickTop} x2={t.x} y2={tickTop + tickH} class="tick-line" />
      <text x={t.x} y={svgH - 4} text-anchor="middle" class="tick-label">{t.label}</text>
    {/each}

    <!-- clustered dots -->
    {#each dots as dot (dot.idx)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <g
        class="dot-group"
        onmouseenter={(e) => onDotEnter(e, dot)}
        onmousemove={(e) => onDotMove(e)}
        onmouseleave={onDotLeave}
        onclick={(e) => onDotClick(e, dot)}
      >
        <!-- invisible hit area -->
        <circle cx={dot.x} cy={dot.y} r={12} fill="transparent" />
        <!-- glow for clusters -->
        {#if dot.count > 2}
          <circle
            cx={dot.x}
            cy={dot.y}
            r={Math.min(10, 5 + Math.log2(dot.count)) + 3}
            fill={dot.color}
            opacity="0.12"
          />
        {/if}
        <!-- main dot -->
        <circle
          cx={dot.x}
          cy={dot.y}
          r={dot.count > 1 ? Math.min(9, 4.5 + Math.log2(dot.count)) : 4.5}
          fill={dot.color}
          stroke="var(--md-sys-color-surface-container-low)"
          stroke-width="1.5"
          class="dot"
        />
        <!-- cluster count text -->
        {#if dot.count > 1}
          <text x={dot.x} y={dot.y + 3.5} text-anchor="middle" class="cluster-label"
            >{dot.count > 99 ? '99+' : dot.count}</text
          >
        {/if}
      </g>
    {/each}
  </svg>
</div>

<style>
  .timeline-viewport {
    width: 100%;
    height: var(--aegis-size-timeline);
    overflow: hidden;
    -webkit-mask-image: linear-gradient(
      to right,
      transparent,
      black 20px,
      black calc(100% - 20px),
      transparent
    );
    mask-image: linear-gradient(
      to right,
      transparent,
      black 20px,
      black calc(100% - 20px),
      transparent
    );
  }
  svg {
    display: block;
  }
  .lane-line {
    stroke: var(--md-sys-color-on-surface-variant);
    stroke-width: 1;
    opacity: 0.07;
  }
  .agent-link {
    opacity: 0.25;
    transition: opacity 150ms ease;
  }
  .tick-line {
    stroke: var(--md-sys-color-on-surface-variant);
    stroke-width: 1;
    opacity: 0.2;
  }
  .tick-label {
    fill: var(--md-sys-color-on-surface-variant);
    opacity: 0.5;
    font-family: 'DM Mono', monospace;
    font-size: calc(10px * var(--aegis-ui-scale, 1));
    font-weight: 500;
  }
  .dot-group {
    cursor: pointer;
  }
  .dot {
    transition: filter 100ms ease;
  }
  .dot-group:hover .dot {
    filter: brightness(1.4) drop-shadow(0 0 3px currentColor);
  }
  .cluster-label {
    fill: var(--md-sys-color-surface);
    font-family: 'DM Mono', monospace;
    font-size: calc(8px * var(--aegis-ui-scale, 1));
    font-weight: 700;
    pointer-events: none;
  }
</style>
