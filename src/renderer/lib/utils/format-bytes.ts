/**
 * format-bytes.ts — Human-readable byte formatting utility
 * Pure function, no DOM dependency. Used by AuditLog.svelte.
 *
 * @module format-bytes
 * @since v0.8.0-alpha
 */

// ═══ CONSTANTS ═══

const UNITS: readonly string[] = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
const KILO = 1024;

// ═══ PUBLIC API ═══

/**
 * Format a byte count into a human-readable string with appropriate unit.
 *
 * @param bytes - Number of bytes (non-negative integer expected)
 * @returns Formatted string like "1.5 MB" or "0 B"
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes === 0) return '0 B';

  let unitIndex = 0;
  let value = bytes;

  while (value >= KILO && unitIndex < UNITS.length - 1) {
    value /= KILO;
    unitIndex++;
  }

  // Whole numbers for bytes, one decimal for larger units
  if (unitIndex === 0) return `${Math.floor(value)} ${UNITS[unitIndex]}`;
  return `${value.toFixed(1)} ${UNITS[unitIndex]}`;
}
