/**
 * @file path-utils.ts
 * @description Path display utilities for the renderer.
 * @since v0.10.0
 */

import { skillFromPath } from '../../../shared/skill-path.js';

/**
 * Name the skill and its observed file, including events from older producers.
 * The caller keeps the full original path for reveal/copy and owner attribution.
 * @param filePath - Observed file path
 * @param action - Holding observations may identify only a directory group
 * @returns Skill label or the ordinary shortened path
 * @since 0.15.0
 */
export function fileActivityLabel(filePath: string | undefined, action?: string): string {
  if (action === 'holding') return shortenPath(filePath);
  const skill = skillFromPath(filePath);
  return skill
    ? `Skill: ${skill.name}${skill.relativePath ? ` · ${skill.relativePath}` : ''}`
    : shortenPath(filePath);
}

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
