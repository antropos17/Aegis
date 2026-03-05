/**
 * @file format-bytes.ts - Utility for formatting byte sizes
 * @module shared/format-bytes
 */

/**
 * Formats bytes into a human-readable string
 * @param bytes - The number of bytes to format
 * @returns Formatted string (e.g., "1.5 MB", "500 B")
 */
export function formatBytes(bytes: number): string {
  if (bytes < 0) {
    return '0 B';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1048576) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1073741824) {
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }
  if (bytes < 1099511627776) {
    return `${(bytes / 1073741824).toFixed(1)} GB`;
  }
  return `${(bytes / 1099511627776).toFixed(1)} TB`;
}
