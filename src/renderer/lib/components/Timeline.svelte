<script>
  /**
   * @file Timeline.svelte
   * @description Horizontal event timeline container — zoom, scroll, severity lanes,
   *   dot clustering, summary counters, and history loading.
   *   Delegates rendering to TimelineCanvas, TimelineControls, TimelineLegend, TimelineTooltip.
   * @since v0.1.0
   */
  import { events, network, focusedAgentPid } from '../stores/ipc.js';
  import {
    SVG_H,
    LANE_CRIT,
    LANE_HIGH,
    LANE_MED,
    LANE_LOW,
    TICK_TOP,
    TICK_H,
    PX_PER_UNIT,
    PAD,
    MIN_TICK_PX,
    ZOOM_LEVELS,
    HISTORY_BATCH,
    AUDIT_EVENT_TYPES,
    pickTickInterval,
    auditToTimelineEvent,
    buildSummary,
    buildClusters,
    buildLinks,
    buildTicks,
  } from '../utils/timeline-utils.ts';
  import TimelineCanvas from './TimelineCanvas.svelte';
  import TimelineControls from './TimelineControls.svelte';
  import TimelineLegend from './TimelineLegend.svelte';
  import TimelineTooltip from './TimelineTooltip.svelte';

  /** @type {{ active?: boolean }} */
  let { active = true } = $props();

  /** @type {any[][]} */
  let cachedEvents = $state([]);
  /** @type {any[]} */
  let cachedNetwork = $state([]);

  $effect(() => {
    if (!active) return;
    cachedEvents = $events;
  });

  $effect(() => {
    if (!active) return;
    cachedNetwork = $network;
  });

  let viewportWidth = $state(600);
  let zoomIndex = $state(6);
  let scrollLeft = $state(0);
  let dragging = $state(false);
  let following = $state(true);

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

  // ═══ HISTORICAL AUDIT ENTRIES ═══
  let historicalEvents = $state([]);
  let loadingHistory = $state(false);
  let historyExhausted = $state(false);
  let pendingScrollAdjust = $state(false);
  let prevMinT = $state(0);

  async function loadOlderHistory() {
    if (loadingHistory || historyExhausted || !window.aegis?.getAuditEntriesBefore) return;
    loadingHistory = true;
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
          .filter((e) => AUDIT_EVENT_TYPES.includes(e.type))
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

  // ═══ TOOLTIP STATE ═══
  let tooltipVisible = $state(false);
  let tooltipFixedX = $state(0);
  let tooltipFixedY = $state(0);
  let tooltipText = $state('');

  // ═══ DERIVED DATA ═══
  let allLiveEvents = $derived.by(() => {
    const fileEvs = cachedEvents.flat().map((ev) => ({ ...ev, _type: 'file' }));
    const netEvs = cachedNetwork.map((conn) => ({
      agent: conn.agent || 'Unknown',
      timestamp: conn.timestamp || Date.now(),
      _type: 'network',
      flagged: !!conn.flagged,
    }));
    return [...fileEvs, ...netEvs].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  });

  let allEvents = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
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

  let summary = $derived(buildSummary(allEvents));

  let rawMinT = $derived(allEvents.length > 0 ? allEvents[0].timestamp || 0 : Date.now());
  let minT = $derived(Math.floor(rawMinT / 10000) * 10000);
  let maxT = $derived(
    allEvents.length > 0 ? allEvents[allEvents.length - 1].timestamp || 0 : Date.now(),
  );
  let eventRange = $derived(maxT - minT || 1);
  let msPerUnit = $derived(ZOOM_LEVELS[zoomIndex].ms);
  let viewportMs = $derived((viewportWidth / PX_PER_UNIT) * msPerUnit);
  let displayRange = $derived(Math.max(eventRange, viewportMs));
  let displayMinT = $derived(minT);
  let totalWidth = $derived(Math.max(viewportWidth, (displayRange / msPerUnit) * PX_PER_UNIT));
  let maxScroll = $derived(Math.max(0, totalWidth - viewportWidth));

  let tickInterval = $derived(pickTickInterval(totalWidth, displayRange));

  let clampedScroll = $derived(Math.min(scrollLeft, maxScroll));

  $effect(() => {
    if (pendingScrollAdjust && prevMinT > 0 && minT < prevMinT) {
      const shiftMs = prevMinT - minT;
      const shiftPx = (shiftMs / displayRange) * (totalWidth - PAD * 2);
      scrollLeft = clampedScroll + shiftPx;
      pendingScrollAdjust = false;
    }
  });

  $effect(() => {
    if (
      active &&
      !following &&
      !historyExhausted &&
      !loadingHistory &&
      thumbOffset >= 0 &&
      thumbOffset <= 2
    ) {
      loadOlderHistory();
    }
  });

  /** Keep scroll pinned to end while auto-following */
  let autoScrollTarget = $derived(following ? maxScroll : -1);
  $effect(() => {
    if (autoScrollTarget >= 0) scrollLeft = autoScrollTarget;
  });

  function tsToX(ts) {
    const usable = totalWidth - PAD * 2;
    return PAD + ((ts - displayMinT) / displayRange) * usable;
  }

  let viewBox = $derived(`${clampedScroll} 0 ${viewportWidth} ${SVG_H}`);

  // ═══ CLUSTERS, LINKS & TICKS ═══
  let clusters = $derived(buildClusters(allEvents, tsToX));
  let links = $derived(buildLinks(clusters));
  let ticks = $derived(buildTicks(displayMinT, displayRange, tickInterval, tsToX));

  // ═══ SCRUB BAR ═══
  let thumbRatio = $derived(totalWidth > 0 ? viewportWidth / totalWidth : 1);
  let scrubPad = 12;
  let trackWidth = $derived(viewportWidth - scrubPad);
  let thumbWidth = $derived(Math.min(120, Math.max(30, thumbRatio * trackWidth)));
  let trackUsable = $derived(trackWidth - thumbWidth);
  let thumbOffset = $state(-1);

  $effect(() => {
    if (!dragging) {
      if (following) {
        thumbOffset = trackUsable;
      } else if (maxScroll > 0) {
        thumbOffset = (clampedScroll / maxScroll) * trackUsable;
      }
    }
  });

  let thumbX = $derived(
    thumbOffset < 0 ? trackUsable : Math.max(0, Math.min(trackUsable, thumbOffset)),
  );

  // ═══ EVENT HANDLERS ═══
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

  function positionTooltip(e) {
    const estWidth = tooltipText.length * 7 + 16;
    const estHeight = 28;
    const margin = 12;
    tooltipFixedX =
      e.clientX + margin + estWidth > window.innerWidth
        ? e.clientX - margin - estWidth
        : e.clientX + margin;
    tooltipFixedY = e.clientY - estHeight - 8 < 0 ? e.clientY + margin : e.clientY - estHeight - 8;
  }
  function handleDotEnter(e, dot) {
    const countInfo = dot.count > 1 ? ` (${dot.count})` : '';
    tooltipText = `${dot.time}  ${dot.agent}${countInfo}` + (dot.pid ? ` [${dot.pid}]` : '');
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
    if (dot.pid) focusedAgentPid.set(dot.pid);
  }

  let dragStartX = 0;
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
    if (maxScroll > 0 && trackUsable > 0) scrollLeft = (thumbOffset / trackUsable) * maxScroll;
  }
  function handleDragEnd() {
    dragging = false;
    if (thumbOffset >= trackUsable - 2) following = true;
    if (thumbOffset <= 2 && !historyExhausted && !loadingHistory) loadOlderHistory();
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
    if (maxScroll > 0 && trackUsable > 0) scrollLeft = (thumbOffset / trackUsable) * maxScroll;
    if (newOffset >= trackUsable - 2) following = true;
    if (newOffset <= 2 && !historyExhausted && !loadingHistory) loadOlderHistory();
  }
</script>

<div class="timeline-wrap" onwheel={handleWheel} bind:clientWidth={viewportWidth}>
  <TimelineLegend {summary} />

  <TimelineCanvas
    {viewportWidth}
    svgH={SVG_H}
    {viewBox}
    {clampedScroll}
    lanePositions={{ crit: LANE_CRIT, high: LANE_HIGH, med: LANE_MED, low: LANE_LOW }}
    tickTop={TICK_TOP}
    tickH={TICK_H}
    {ticks}
    dots={clusters}
    {links}
    onDotEnter={handleDotEnter}
    onDotMove={handleDotMove}
    onDotLeave={handleDotLeave}
    onDotClick={handleDotClick}
  />
  <TimelineControls
    {thumbWidth}
    {thumbX}
    {trackUsable}
    {scrubPad}
    {maxScroll}
    onTrackClick={handleTrackClick}
    onThumbDown={handleThumbDown}
    {dragging}
  />
</div>

<TimelineTooltip visible={tooltipVisible} x={tooltipFixedX} y={tooltipFixedY} text={tooltipText} />

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
    border-radius: var(--md-sys-shape-corner-medium);
    padding: var(--aegis-space-3) 0;
    overflow: hidden;
  }
</style>
