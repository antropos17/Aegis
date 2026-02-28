<script>
  /**
   * @file TimelineControls.svelte
   * @description Scrub bar with draggable thumb for timeline scrolling.
   *   Extracted from Timeline.svelte. Receives all data via props.
   * @since v0.3.0
   */

  let {
    thumbWidth,
    thumbX,
    trackUsable,
    scrubPad,
    maxScroll,
    onTrackClick,
    onThumbDown,
    dragging,
  } = $props();

  let thumbHover = $state(false);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="scrub-track" onclick={onTrackClick}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="scrub-thumb"
    class:hover={thumbHover}
    class:dragging
    style="width:{thumbWidth}px; left:{thumbX}px"
    onmousedown={onThumbDown}
    onmouseenter={() => (thumbHover = true)}
    onmouseleave={() => (thumbHover = false)}
    role="scrollbar"
    aria-controls="timeline-viewport"
    aria-valuenow={0}
    aria-valuemin={0}
    aria-valuemax={maxScroll}
    aria-orientation="horizontal"
    tabindex="0"
  >
    <div class="grip"><span></span><span></span><span></span></div>
  </div>
</div>

<style>
  .scrub-track {
    height: 4px;
    margin: 6px 6px 5px;
    background: var(--aegis-scrub-track);
    border-radius: 2px;
    position: relative;
    cursor: pointer;
  }
  .scrub-thumb {
    position: absolute;
    top: -5px;
    height: 14px;
    border-radius: 7px;
    background: var(--aegis-scrub-thumb);
    border: 1px solid var(--aegis-scrub-thumb-border);
    box-shadow: var(--aegis-scrub-thumb-shadow);
    transition:
      box-shadow 150ms ease,
      filter 150ms ease;
    cursor: grab;
  }
  .grip {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    gap: 2px;
    pointer-events: none;
  }
  .grip span {
    display: block;
    width: 1px;
    height: 6px;
    background: var(--aegis-scrub-grip);
    border-radius: 0.5px;
  }
  .scrub-thumb.hover,
  .scrub-thumb:focus-visible {
    filter: brightness(1.15);
    box-shadow:
      var(--aegis-scrub-thumb-shadow),
      0 0 0 1px var(--aegis-scrub-thumb-border);
  }
  .scrub-thumb.hover .grip span,
  .scrub-thumb:focus-visible .grip span {
    background: var(--md-sys-color-on-surface-variant);
  }
  .scrub-thumb.dragging {
    filter: brightness(1.2);
    cursor: grabbing;
    box-shadow:
      0 2px 6px rgba(0, 0, 0, 0.4),
      0 0 0 1px var(--aegis-scrub-thumb-border);
  }
</style>
