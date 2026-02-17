/**
 * @file timeline.js
 * @module timeline
 * @description Horizontal session timeline showing last 100 events as color-coded
 *   dots with hover tooltips. Connects to file-access and network events via app.js.
 * @since v0.2.0
 */

// ═══ SESSION TIMELINE ═══

const timelineStrip = document.getElementById('timeline-strip');
const timelineDots = document.getElementById('timeline-dots');
const timelineTooltip = document.getElementById('timeline-tooltip');

/** @type {Object[]} Last 100 timeline events */
const timelineEvents = [];
const TIMELINE_MAX = 100;

/**
 * Determine severity level for a timeline event.
 * @param {Object} ev - Event object.
 * @returns {string} Severity: 'critical', 'high', 'medium', or 'normal'.
 * @since v0.2.0
 */
function getTimelineSeverity(ev) {
  if (ev._type === 'anomaly') return 'critical';
  if (ev._type === 'network' && ev.flagged) return 'high';
  if (ev.sensitive) {
    if (ev.reason && ev.reason.startsWith('AI agent config')) return 'critical';
    return 'high';
  }
  if (ev._type === 'network') return 'medium';
  if (isConfigFile(ev.file || '')) return 'medium';
  return 'normal';
}

/**
 * Get the CSS class for a severity level.
 * @param {string} severity - Severity string.
 * @returns {string} CSS class suffix.
 * @since v0.2.0
 */
function getTimelineDotClass(severity) {
  const map = { critical: 'tl-critical', high: 'tl-high', medium: 'tl-medium', normal: 'tl-normal' };
  return map[severity] || 'tl-normal';
}

/**
 * Add file-access events to the timeline.
 * @param {Object[]} events - Array of file-access event objects.
 * @returns {void}
 * @since v0.2.0
 */
function addTimelineFileEvents(events) {
  for (const ev of events) {
    timelineEvents.push({ ...ev, _type: 'file', _time: ev.timestamp || Date.now() });
  }
  while (timelineEvents.length > TIMELINE_MAX) timelineEvents.shift();
  renderTimeline();
}

/**
 * Add network events to the timeline.
 * @param {Object[]} connections - Array of network connection objects.
 * @returns {void}
 * @since v0.2.0
 */
function addTimelineNetworkEvents(connections) {
  for (const c of connections) {
    if (c.flagged) {
      timelineEvents.push({
        agent: c.agent, file: `${c.remoteIp}:${c.remotePort}`, sensitive: false,
        reason: c.domain || 'unknown', _type: 'network', _time: Date.now(), flagged: c.flagged,
      });
    }
  }
  while (timelineEvents.length > TIMELINE_MAX) timelineEvents.shift();
  renderTimeline();
}

/**
 * Add an anomaly event to the timeline.
 * @param {Object} warning - Anomaly warning object.
 * @returns {void}
 * @since v0.2.0
 */
function addTimelineAnomalyEvent(warning) {
  timelineEvents.push({
    agent: warning.agent, file: warning.message, sensitive: true,
    reason: formatAnomalyReason(warning), _type: 'anomaly', _time: Date.now(),
  });
  while (timelineEvents.length > TIMELINE_MAX) timelineEvents.shift();
  renderTimeline();
}

/**
 * Render the timeline dots into the strip.
 * @returns {void}
 * @since v0.2.0
 */
function renderTimeline() {
  if (!timelineDots) return;
  timelineDots.innerHTML = '';
  for (let i = 0; i < timelineEvents.length; i++) {
    const ev = timelineEvents[i];
    const severity = getTimelineSeverity(ev);
    const dot = document.createElement('div');
    dot.className = `tl-dot ${getTimelineDotClass(severity)}`;
    if (severity === 'critical') dot.classList.add('tl-dot-lg');
    dot.dataset.idx = i;
    dot.addEventListener('mouseenter', (e) => showTimelineTooltip(e, ev));
    dot.addEventListener('mouseleave', hideTimelineTooltip);
    timelineDots.appendChild(dot);
  }
  // Auto-scroll to latest
  timelineStrip.scrollLeft = timelineStrip.scrollWidth;
}

/**
 * Show tooltip for a timeline dot.
 * @param {MouseEvent} e - Mouse event.
 * @param {Object} ev - Timeline event.
 * @returns {void}
 * @since v0.2.0
 */
function showTimelineTooltip(e, ev) {
  if (!timelineTooltip) return;
  const severity = getTimelineSeverity(ev);
  const time = new Date(ev._time);
  const timeStr = formatTime(time);
  const typeLabel = ev._type === 'network' ? 'NETWORK' : ev._type === 'anomaly' ? 'ANOMALY' : 'FILE';
  const filePath = shortenPath(ev.file || '');
  let html = `<div class="tl-tip-time">${timeStr}</div>`;
  html += `<div class="tl-tip-agent">${escapeHtml(ev.agent || 'unknown')}</div>`;
  html += `<div class="tl-tip-detail">${typeLabel}: ${escapeHtml(filePath)}</div>`;
  if (ev.reason) html += `<div class="tl-tip-severity tl-tip-${severity}">${escapeHtml(ev.reason)}</div>`;
  timelineTooltip.innerHTML = html;
  timelineTooltip.classList.add('visible');
  // Position near the dot
  const rect = e.target.getBoundingClientRect();
  const stripRect = timelineStrip.getBoundingClientRect();
  timelineTooltip.style.left = Math.min(rect.left - stripRect.left, stripRect.width - 180) + 'px';
  timelineTooltip.style.bottom = '42px';
}

/**
 * Hide the timeline tooltip.
 * @returns {void}
 * @since v0.2.0
 */
function hideTimelineTooltip() {
  if (timelineTooltip) timelineTooltip.classList.remove('visible');
}
