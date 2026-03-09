/**
 * @file path-utils.ts
 * @description Path display utilities for the renderer.
 * @since v0.10.0
 */

/**
 * Shorten a file path for display by keeping the last N segments.
 * @param p         - The full file path (forward or back slashes)
 * @param maxLength - Skip shortening if path is already this short (default 50)
 * @param segments  - Number of trailing path segments to keep (default 3)
 * @returns Shortened path with ellipsis prefix, or original if short enough
 */
export function shortenPath(p: string | undefined, maxLength = 50, segments = 3): string {
  if (!p) return '';
  if (p.length <= maxLength) return p;
  const parts = p.replace(/\\/g, '/').split('/');
  if (parts.length <= segments) return p;
  return '\u2026/' + parts.slice(-segments).join('/');
}
