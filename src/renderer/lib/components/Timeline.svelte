<script>
  /**
   * @file Timeline.svelte
   * @description Horizontal event timeline with zoom, scroll, and history loading.
   *   Canvas rendering in TimelineCanvas, scrub bar in TimelineControls.
   * @since v0.1.0
   */
  import { events, network, focusedAgentPid } from '../stores/ipc.js';
  import TimelineCanvas from './TimelineCanvas.svelte';
  import TimelineControls from './TimelineControls.svelte';

  const SVG_H = 36;
  const MID = 14;
  const TICK_TOP = 24;
  const TICK_H = 8;
  const PX_PER_UNIT = 120;
  const PAD = 20;
  const MIN_TICK_PX = 64;
  const ZOOM_LEVELS = [
    { ms: 3600000 },
    { ms: 1800000 },
    { ms: 600000 },
    { ms: 300000 },
    { ms: 60000 },
    { ms: 30000 },
    { ms: 10000 },
  ];
  const NICE_INTERVALS = [
    5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 900000, 1800000, 3600000, 7200000,
  ];
  const HISTORY_BATCH = 25;

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
    return `${hh}:${mm}:${String(d.getSeconds()).padStart(2, '0')}`;
  }

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
      !following &&
      !historyExhausted &&
      !loadingHistory &&
      thumbOffset >= 0 &&
      thumbOffset <= 2
    ) {
      loadOlderHistory();
    }
  });

  $effect(() => {
    void allEvents.length;
    void maxScroll;
    if (following) scrollLeft = maxScroll;
  });

  function tsToX(ts) {
    const usable = totalWidth - PAD * 2;
    return PAD + ((ts - displayMinT) / displayRange) * usable;
  }

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
      if (isFirst) {
        isFirst = false;
        continue;
      }
      result.push({ x: tsToX(t), label: formatTick(t, subMinute) });
    }
    return result;
  });

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
    const estHeight = 24;
    const margin = 12;
    tooltipFixedX =
      e.clientX + margin + estWidth > window.innerWidth
        ? e.clientX - margin - estWidth
        : e.clientX + margin;
    tooltipFixedY = e.clientY - estHeight - 8 < 0 ? e.clientY + margin : e.clientY - estHeight - 8;
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

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="timeline-wrap" onwheel={handleWheel} bind:clientWidth={viewportWidth}>
  <TimelineCanvas
    {viewportWidth}
    svgH={SVG_H}
    {viewBox}
    {clampedScroll}
    pad={PAD}
    mid={MID}
    tickTop={TICK_TOP}
    tickH={TICK_H}
    {ticks}
    {dots}
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
</style>
