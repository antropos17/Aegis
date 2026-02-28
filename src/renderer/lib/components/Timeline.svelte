<script>
  import { events, network, focusedAgentPid } from '../stores/ipc.js';

  const DOT_R = 4;
  const SVG_H = 36;
  const MID = 14;
  const TICK_TOP = 24;
  const TICK_H = 8;
  const PX_PER_UNIT = 120;
  const PAD = 20;
  const MIN_TICK_PX = 64;

  const ZOOM_LEVELS = [
    { ms: 3600000 }, // 1h per 120px
    { ms: 1800000 }, // 30min
    { ms: 600000 }, // 10min
    { ms: 300000 }, // 5min
    { ms: 60000 }, // 1min
    { ms: 30000 }, // 30s
    { ms: 10000 }, // 10s (default — most zoomed in)
  ];

  const NICE_INTERVALS = [
    5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 900000, 1800000, 3600000, 7200000,
  ];

  function getSeverity(ev) {
    if (ev._type === 'network') return ev.flagged ? 'high' : 'low';
    if (ev._denied) return 'critical';
    if (ev.sensitive) return 'high';
    if (ev.action === 'deleted') return 'medium';
    return 'low';
  }

  function sevColor(sev) {
    if (sev === 'critical') return 'var(--md-sys-color-error)';
    if (sev === 'high') return 'var(--md-sys-color-secondary)';
    if (sev === 'medium') return 'var(--md-sys-color-primary)';
    return 'var(--md-sys-color-on-surface-variant)';
  }

  function formatTime(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  }

  function formatTick(ts, subMinute) {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    if (!subMinute) return `${hh}:${mm}`;
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  let viewportWidth = $state(600);
  let zoomIndex = $state(6);
  let scrollLeft = $state(0);
  let dragging = $state(false);
  let thumbHover = $state(false);
  let following = $state(true);

  // Load persisted zoom from settings
  if (window.aegis) {
    window.aegis.getSettings().then((s) => {
      if (
        typeof s.timelineZoom === 'number' &&
        s.timelineZoom >= 0 &&
        s.timelineZoom < ZOOM_LEVELS.length
      ) {
        zoomIndex = s.timelineZoom;
      }
    });
  }

  // ═══ HISTORICAL AUDIT ENTRIES (lazy-loaded on scroll-back) ═══
  let historicalEvents = $state([]);
  let loadingHistory = $state(false);
  let historyExhausted = $state(false);
  let pendingScrollAdjust = $state(false);
  let prevMinT = $state(0);
  const HISTORY_BATCH = 25;

  function auditToTimelineEvent(entry) {
    const ts = new Date(entry.timestamp).getTime();
    if (entry.type === 'network-connection') {
      return {
        agent: entry.agent,
        timestamp: ts,
        _type: 'network',
        flagged: entry.severity === 'high',
        _historical: true,
      };
    }
    return {
      agent: entry.agent,
      timestamp: ts,
      action: entry.action,
      file: entry.path,
      sensitive: entry.severity === 'sensitive',
      _denied: entry.type === 'permission-deny',
      _type: 'file',
      _historical: true,
    };
  }

  async function loadOlderHistory() {
    if (loadingHistory || historyExhausted || !window.aegis?.getAuditEntriesBefore) return;
    loadingHistory = true;
    // Snapshot current timeline origin so we can compensate after load
    prevMinT = minT;
    try {
      const oldest =
        historicalEvents.length > 0
          ? new Date(historicalEvents[0].timestamp).toISOString()
          : allLiveEvents.length > 0
            ? new Date(allLiveEvents[0].timestamp).toISOString()
            : new Date().toISOString();
      const entries = await window.aegis.getAuditEntriesBefore(oldest, HISTORY_BATCH);
      if (entries.length === 0) {
        historyExhausted = true;
      } else {
        const mapped = entries
          .filter((e) =>
            ['file-access', 'config-access', 'network-connection', 'permission-deny'].includes(
              e.type,
            ),
          )
          .map(auditToTimelineEvent);
        if (mapped.length === 0) {
          historyExhausted = true;
        } else {
          pendingScrollAdjust = true;
          historicalEvents = [...mapped, ...historicalEvents];
        }
      }
    } catch (_) {}
    loadingHistory = false;
  }

  // Tooltip
  let tooltipVisible = $state(false);
  let tooltipFixedX = $state(0);
  let tooltipFixedY = $state(0);
  let tooltipText = $state('');

  let allLiveEvents = $derived.by(() => {
    const fileEvs = $events.flat().map((ev) => ({ ...ev, _type: 'file' }));
    const netEvs = $network.map((conn) => ({
      agent: conn.agent || 'Unknown',
      timestamp: conn.timestamp || Date.now(),
      _type: 'network',
      flagged: !!conn.flagged,
    }));
    return [...fileEvs, ...netEvs].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  });

  let allEvents = $derived.by(() => {
    // Merge historical (from audit log) with live events, dedup by timestamp+agent
    const seen = new Set();
    const merged = [];
    for (const ev of [...historicalEvents, ...allLiveEvents]) {
      const key = `${ev.timestamp}|${ev.agent}|${ev._type}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(ev);
      }
    }
    merged.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    return merged.slice(-500);
  });

  // Snap to nearest 10s boundary DOWN for a clean starting point
  let rawMinT = $derived(allEvents.length > 0 ? allEvents[0].timestamp || 0 : Date.now());
  let minT = $derived(Math.floor(rawMinT / 10000) * 10000);
  let maxT = $derived(
    allEvents.length > 0 ? allEvents[allEvents.length - 1].timestamp || 0 : Date.now(),
  );
  let eventRange = $derived(maxT - minT || 1);

  let msPerUnit = $derived(ZOOM_LEVELS[zoomIndex].ms);

  // How many ms the viewport represents at this zoom
  let viewportMs = $derived((viewportWidth / PX_PER_UNIT) * msPerUnit);
  // The full virtual canvas width in ms — at least the viewport, or the event span
  let displayRange = $derived(Math.max(eventRange, viewportMs));
  // Time origin at left edge (snapped)
  let displayMinT = $derived(minT);

  // Virtual total width (in px coords) — all positioning happens in this space
  let totalWidth = $derived(Math.max(viewportWidth, (displayRange / msPerUnit) * PX_PER_UNIT));
  let maxScroll = $derived(Math.max(0, totalWidth - viewportWidth));

  // Adaptive tick interval
  let tickInterval = $derived.by(() => {
    const pxPerMs = (totalWidth - PAD * 2) / displayRange;
    for (const interval of NICE_INTERVALS) {
      if (interval * pxPerMs >= MIN_TICK_PX) return interval;
    }
    return NICE_INTERVALS[NICE_INTERVALS.length - 1];
  });

  let clampedScroll = $derived(Math.min(scrollLeft, maxScroll));
  $effect(() => {
    if (scrollLeft > maxScroll) scrollLeft = maxScroll;
  });

  // After history loads, shift scrollLeft to keep the viewport on the same time range
  $effect(() => {
    if (pendingScrollAdjust && prevMinT > 0 && minT < prevMinT) {
      const shiftMs = prevMinT - minT;
      const shiftPx = (shiftMs / displayRange) * (totalWidth - PAD * 2);
      scrollLeft = clampedScroll + shiftPx;
      pendingScrollAdjust = false;
    }
  });

  // Load next batch when thumb is at the left edge
  $effect(() => {
    if (
      !following &&
      !historyExhausted &&
      !loadingHistory &&
      thumbOffset >= 0 &&
      thumbOffset <= 2
    ) {
      loadOlderHistory();
    }
  });

  // Auto-scroll to latest when following
  $effect(() => {
    // Re-run whenever events change or maxScroll changes
    void allEvents.length;
    void maxScroll;
    if (following) {
      scrollLeft = maxScroll;
    }
  });

  // Map timestamp → virtual x
  function tsToX(ts) {
    const usable = totalWidth - PAD * 2;
    return PAD + ((ts - displayMinT) / displayRange) * usable;
  }

  // viewBox pans through the virtual space — SVG element stays at viewportWidth
  let viewBox = $derived(`${clampedScroll} 0 ${viewportWidth} ${SVG_H}`);

  let dots = $derived.by(() => {
    if (allEvents.length === 0) return [];
    return allEvents.map((ev, idx) => {
      const sev = getSeverity(ev);
      return {
        x: tsToX(ev.timestamp || 0),
        color: sevColor(sev),
        agent: ev.agent || 'Unknown',
        pid: ev.pid || null,
        time: formatTime(ev.timestamp),
        idx,
      };
    });
  });

  let ticks = $derived.by(() => {
    const subMinute = tickInterval < 60000;
    const result = [];
    const tickEnd = displayMinT + displayRange;
    const firstTick = Math.ceil(displayMinT / tickInterval) * tickInterval;
    let isFirst = true;
    for (let t = firstTick; t <= tickEnd; t += tickInterval) {
      // Skip the very first tick — it sits at the left edge and gets cut off
      if (isFirst) {
        isFirst = false;
        continue;
      }
      result.push({ x: tsToX(t), label: formatTick(t, subMinute) });
    }
    return result;
  });

  // Scrub bar — all sizes relative to viewportWidth (the actual container width)
  let thumbRatio = $derived(totalWidth > 0 ? viewportWidth / totalWidth : 1);
  let scrubPad = 12; // 6px margin each side on the track
  let trackWidth = $derived(viewportWidth - scrubPad);
  let thumbWidth = $derived(Math.min(120, Math.max(30, thumbRatio * trackWidth)));
  let trackUsable = $derived(trackWidth - thumbWidth);

  // thumbOffset is the source of truth for thumb position (always draggable)
  let thumbOffset = $state(-1); // -1 = uninitialized, will sync to right edge
  // Sync thumbOffset from scrollLeft when there's scroll room and not dragging
  $effect(() => {
    if (!dragging) {
      if (following) {
        thumbOffset = trackUsable;
      } else if (maxScroll > 0) {
        thumbOffset = maxScroll > 0 ? (clampedScroll / maxScroll) * trackUsable : trackUsable;
      }
    }
  });
  let thumbX = $derived(
    thumbOffset < 0 ? trackUsable : Math.max(0, Math.min(trackUsable, thumbOffset)),
  );

  function handleWheel(e) {
    e.preventDefault();
    let changed = false;
    if (e.deltaY < 0 && zoomIndex < ZOOM_LEVELS.length - 1) {
      zoomIndex++;
      changed = true;
    } else if (e.deltaY > 0 && zoomIndex > 0) {
      zoomIndex--;
      changed = true;
    }
    if (changed && window.aegis) {
      window.aegis.getSettings().then((s) => {
        window.aegis.saveSettings({ ...s, timelineZoom: zoomIndex });
      });
    }
  }

  // Dot hover/click — detect edge collision and flip tooltip side
  function positionTooltip(e) {
    const text = tooltipText;
    // Estimate tooltip width: ~7px per char + 16px padding
    const estWidth = text.length * 7 + 16;
    const estHeight = 24;
    const margin = 12;

    // Flip horizontally if tooltip would go past right edge
    if (e.clientX + margin + estWidth > window.innerWidth) {
      tooltipFixedX = e.clientX - margin - estWidth;
    } else {
      tooltipFixedX = e.clientX + margin;
    }

    // Flip vertically if tooltip would go above top edge
    if (e.clientY - estHeight - 8 < 0) {
      tooltipFixedY = e.clientY + margin;
    } else {
      tooltipFixedY = e.clientY - estHeight - 8;
    }
  }

  function handleDotEnter(e, dot) {
    tooltipText = `${dot.time}  ${dot.agent}` + (dot.pid ? ` [${dot.pid}]` : '');
    tooltipVisible = true;
    positionTooltip(e);
  }

  function handleDotMove(e) {
    positionTooltip(e);
  }

  function handleDotLeave() {
    tooltipVisible = false;
  }

  function handleDotClick(e, dot) {
    e.stopPropagation();
    if (dot.pid) {
      focusedAgentPid.set(dot.pid);
    }
  }

  // Scrub drag
  let dragStartX = 0;
  let dragStartScroll = 0;

  let dragStartThumbOffset = 0;

  function handleThumbDown(e) {
    e.preventDefault();
    dragging = true;
    following = false;
    dragStartX = e.clientX;
    dragStartThumbOffset = thumbX;
    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('mouseup', handleDragEnd);
  }

  function handleDragMove(e) {
    if (!dragging) return;
    const dx = e.clientX - dragStartX;
    thumbOffset = Math.max(0, Math.min(trackUsable, dragStartThumbOffset + dx));
    // Drive scrollLeft from thumb position when there's scroll room
    if (maxScroll > 0 && trackUsable > 0) {
      scrollLeft = (thumbOffset / trackUsable) * maxScroll;
    }
  }

  function handleDragEnd() {
    dragging = false;
    // Re-enable following if thumb is at the right edge
    if (thumbOffset >= trackUsable - 2) following = true;
    // Trigger history load if thumb reached the left edge
    if (thumbOffset <= 2 && !historyExhausted && !loadingHistory) {
      loadOlderHistory();
    }
    window.removeEventListener('mousemove', handleDragMove);
    window.removeEventListener('mouseup', handleDragEnd);
  }

  function handleTrackClick(e) {
    if (dragging) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left - scrubPad / 2;
    const newOffset = Math.max(0, Math.min(trackUsable, clickX - thumbWidth / 2));
    following = false;
    thumbOffset = newOffset;
    if (maxScroll > 0 && trackUsable > 0) {
      scrollLeft = (thumbOffset / trackUsable) * maxScroll;
    }
    if (newOffset >= trackUsable - 2) following = true;
    if (newOffset <= 2 && !historyExhausted && !loadingHistory) {
      loadOlderHistory();
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="timeline-wrap" onwheel={handleWheel} bind:clientWidth={viewportWidth}>
  <div class="timeline-viewport" id="timeline-viewport">
    <svg width={viewportWidth} height={SVG_H} {viewBox}>
      <!-- baseline track -->
      <line
        x1={clampedScroll + PAD}
        y1={MID}
        x2={clampedScroll + viewportWidth - PAD}
        y2={MID}
        class="baseline"
      />

      <!-- ticks -->
      {#each ticks as t (t.x)}
        <line x1={t.x} y1={TICK_TOP} x2={t.x} y2={TICK_TOP + TICK_H} class="tick-line" />
        <text x={t.x} y={TICK_TOP + TICK_H + 1} text-anchor="middle" class="tick-label"
          >{t.label}</text
        >
      {/each}

      <!-- dots -->
      {#each dots as dot (dot.idx)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <circle
          cx={dot.x}
          cy={MID}
          r={DOT_R}
          fill={dot.color}
          opacity="0.85"
          class="dot"
          onmouseenter={(e) => handleDotEnter(e, dot)}
          onmousemove={(e) => handleDotMove(e)}
          onmouseleave={handleDotLeave}
          onclick={(e) => handleDotClick(e, dot)}
        />
      {/each}
    </svg>
  </div>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="scrub-track" onclick={handleTrackClick}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="scrub-thumb"
      class:hover={thumbHover}
      class:dragging
      style="width:{thumbWidth}px; left:{thumbX}px"
      onmousedown={handleThumbDown}
      onmouseenter={() => (thumbHover = true)}
      onmouseleave={() => (thumbHover = false)}
      role="scrollbar"
      aria-controls="timeline-viewport"
      aria-valuenow={clampedScroll}
      aria-valuemin={0}
      aria-valuemax={maxScroll}
      aria-orientation="horizontal"
      tabindex="0"
    >
      <div class="grip"><span></span><span></span><span></span></div>
    </div>
  </div>
</div>

<!-- Tooltip via fixed positioning -->
{#if tooltipVisible}
  <div class="timeline-tooltip" style="left:{tooltipFixedX}px; top:{tooltipFixedY}px">
    {tooltipText}
  </div>
{/if}

<style>
  .timeline-wrap {
    width: 100%;
    box-sizing: border-box;
    background: var(--md-sys-color-surface-container-low);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: var(--aegis-card-border);
    box-shadow:
      0 2px 8px rgba(0, 0, 0, 0.12),
      var(--glass-highlight);
    border-radius: var(--md-sys-shape-corner-small);
    padding: 3px 0;
    overflow: hidden;
  }

  .timeline-viewport {
    width: 100%;
    height: var(--aegis-size-timeline);
    overflow: hidden;
    -webkit-mask-image: linear-gradient(
      to right,
      transparent,
      black 28px,
      black calc(100% - 28px),
      transparent
    );
    mask-image: linear-gradient(
      to right,
      transparent,
      black 28px,
      black calc(100% - 28px),
      transparent
    );
  }

  svg {
    display: block;
  }

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

  .timeline-tooltip {
    position: fixed;
    pointer-events: none;
    white-space: nowrap;
    font: var(--md-sys-typescale-label-medium);
    font-family: 'DM Mono', monospace;
    color: var(--md-sys-color-on-surface);
    background: var(--md-sys-color-surface-container-high);
    border: var(--aegis-card-border);
    border-radius: var(--md-sys-shape-corner-small);
    padding: calc(3px * var(--aegis-ui-scale)) var(--aegis-space-4);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 9999;
  }

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

  /* Grip lines — 3 vertical bars */
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
