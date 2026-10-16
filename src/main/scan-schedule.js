/** Timing shared by the scheduler and its reported observation cadence. */
const STARTUP_MS = Object.freeze({ process: 3000, files: 8000, polling: 12000 });
const WARMUP_MS = 60000;

/** Describe the longest planned gap, including both timer transitions.
 * The first population precedes polling startup; the final warmup interval can
 * be cleared before it fires, followed by one steady interval.
 * @param {number} targetMs Configured steady scan interval.
 * @returns {{intervalMs: number, maxGapMs: number}} Warmup scheduling bounds.
 * @since v0.19.2
 */
function warmupProcessSchedule(targetMs) {
  const intervalMs = targetMs * 3;
  return {
    intervalMs,
    maxGapMs: Math.max(STARTUP_MS.polling - STARTUP_MS.process + intervalMs, intervalMs + targetMs),
  };
}

module.exports = { STARTUP_MS, WARMUP_MS, warmupProcessSchedule };
