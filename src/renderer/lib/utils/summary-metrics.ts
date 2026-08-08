/**
 * @file summary-metrics.ts — Pure metric helpers for SummaryCards
 * @module renderer/utils/summary-metrics
 * @description Keeps Total Agents / Avg Risk Score free of wrong-field and
 *   anomaly/risk mix-ups (CORRECTNESS F-W02 / F-W01), Events/min free of
 *   hidden Date.now() (F-W03), the sensitive card free of a "files"
 *   mislabel on retained event counts (F-W06), and monitoring duration free of
 *   "System Uptime" / stale uptimeMs freezes (F-W07).
 * @since 0.10.0
 */

/** Rolling window for "Events / min" (count of events in the last minute). */
export const EVENTS_PER_MIN_WINDOW_MS = 60_000;

/**
 * SummaryCards label for `stats.totalSensitive`.
 *
 * Matches tray / HTML export product language ("sensitive alerts"). The value is
 * retained sensitive **activity-log events**, not distinct file paths.
 */
export const SENSITIVE_SUMMARY_LABEL = 'Sensitive Alerts';

/**
 * SummaryCards label for elapsed time since `scanner.monitoringStarted`.
 *
 * Matches HTML export language ("MONITORING DURATION"). Not OS uptime, not
 * Electron process.uptime, not Footer "UP" (renderer mount clock).
 */
export const MONITORING_DURATION_LABEL = 'Monitoring Duration';

/**
 * Count distinct agents for the "Total Agents" card.
 *
 * Prefers enriched `name` (risk store), then raw DetectedAgent `agent`.
 * Never counts `undefined` as a unique agent (historical F-W02 collapse).
 *
 * @param agents - Raw or enriched agent list
 * @returns Distinct non-empty display-name count
 */
export function countUniqueAgents(
  agents: ReadonlyArray<{ readonly name?: string; readonly agent?: string }>,
): number {
  if (!Array.isArray(agents) || agents.length === 0) return 0;
  const keys = new Set<string>();
  for (const a of agents) {
    const key =
      typeof a?.name === 'string' && a.name.length > 0
        ? a.name
        : typeof a?.agent === 'string' && a.agent.length > 0
          ? a.agent
          : null;
    if (key !== null) keys.add(key);
  }
  return keys.size;
}

/**
 * Arithmetic mean of authoritative riskScore values (0–100 scale), rounded.
 * Ignores non-finite values. Empty list → 0 (never NaN).
 *
 * Must NOT receive anomaly scores — those are a different domain (F-W01).
 *
 * @param agents - Objects carrying riskScore (typically EnrichedAgent)
 * @returns Rounded mean risk, or 0
 */
export function averageRiskScore(agents: ReadonlyArray<{ readonly riskScore?: number }>): number {
  if (!Array.isArray(agents) || agents.length === 0) return 0;
  const scores: number[] = [];
  for (const a of agents) {
    const s = a?.riskScore;
    if (typeof s === 'number' && Number.isFinite(s)) scores.push(s);
  }
  if (scores.length === 0) return 0;
  return Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length);
}

/**
 * Count of valid events whose timestamp falls in the rolling window
 * `[now - windowMs, now]` (inclusive on both ends).
 *
 * Pure: no internal `Date.now()`. Future timestamps (`ts > now`) are excluded so
 * clock skew cannot inflate the rate. Nested arrays (legacy event batches) are
 * flattened one level.
 *
 * @param events - Event list (possibly nested once)
 * @param now - Wall-clock ms (caller supplies reactive clock)
 * @param windowMs - Window length; default 60_000
 * @returns Non-negative integer count (never NaN)
 * @since 0.10.0
 */
export function eventsPerMinute(
  events: ReadonlyArray<unknown>,
  now: number,
  windowMs: number = EVENTS_PER_MIN_WINDOW_MS,
): number {
  if (!Array.isArray(events) || events.length === 0) return 0;
  if (!Number.isFinite(now) || !Number.isFinite(windowMs) || windowMs < 0) return 0;
  const cutoff = now - windowMs;
  let count = 0;
  for (const item of events) {
    if (Array.isArray(item)) {
      for (const inner of item) {
        if (isEventInWindow(inner, now, cutoff)) count += 1;
      }
      continue;
    }
    if (isEventInWindow(item, now, cutoff)) count += 1;
  }
  return count;
}

/**
 * @param ev - Candidate event
 * @param now - Window end (inclusive)
 * @param cutoff - Window start (inclusive)
 * @returns Whether the event contributes to Events/min
 */
function isEventInWindow(ev: unknown, now: number, cutoff: number): boolean {
  if (ev === null || typeof ev !== 'object') return false;
  const ts = (ev as { timestamp?: unknown }).timestamp;
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return false;
  if (ts > now) return false;
  return ts >= cutoff;
}

/**
 * Normalize `stats.totalSensitive` for the SummaryCards sensitive card.
 *
 * Authoritative unit (main `onActivityPush` / `onActivityEvict`): count of
 * sensitive events **currently retained** in the main activity log (cap 10_000;
 * may shrink under OOM trim). Each sensitive access increments once — the same
 * path twice is two alerts. Not distinct files, not session-all-time after
 * eviction, not filesystem existence.
 *
 * @param totalSensitive - Raw `stats.totalSensitive` (or unknown)
 * @returns Non-negative integer count (never NaN)
 * @since 0.10.0
 */
export function sensitiveAlertCount(totalSensitive: unknown): number {
  if (typeof totalSensitive !== 'number' || !Number.isFinite(totalSensitive)) return 0;
  if (totalSensitive <= 0) return 0;
  return Math.trunc(totalSensitive);
}

/**
 * Elapsed ms since monitoring session start (`stats.monitoringStarted`).
 *
 * Pure: no internal `Date.now()`. Caller supplies reactive wall clock so the
 * display advances without a fresh stats push (F-W07). Missing / non-finite /
 * future start → 0.
 *
 * @param monitoringStarted - Epoch ms when scanner monitoring began
 * @param now - Wall-clock ms
 * @returns Non-negative elapsed ms (truncated)
 * @since 0.10.0
 */
export function monitoringElapsedMs(monitoringStarted: unknown, now: number): number {
  if (typeof monitoringStarted !== 'number' || !Number.isFinite(monitoringStarted)) return 0;
  if (!Number.isFinite(now)) return 0;
  const elapsed = now - monitoringStarted;
  if (elapsed <= 0) return 0;
  return Math.trunc(elapsed);
}

/**
 * Format monitoring session age as `HH:MM:SS` for SummaryCards.
 *
 * @param monitoringStarted - Epoch ms when scanner monitoring began
 * @param now - Wall-clock ms
 * @returns Zero-padded duration string
 * @since 0.10.0
 */
export function formatMonitoringDuration(monitoringStarted: unknown, now: number): string {
  const ms = monitoringElapsedMs(monitoringStarted, now);
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
