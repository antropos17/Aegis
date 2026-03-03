/**
 * trust-badge-utils.ts — Risk level computation for TrustBadge component [F2.2]
 * Pure functions, no DOM dependency. Used by TrustBadge.svelte.
 */

/** Risk level categories */
export type RiskLevel = 'low' | 'medium' | 'high';

/** Badge size presets in pixels */
export type BadgeSize = 'sm' | 'md' | 'lg';

/** Result of risk level computation */
export interface RiskInfo {
  level: RiskLevel;
  label: string;
  color: string;
  glowColor: string;
}

/** Badge dimension presets (width × height in px) */
const SIZE_MAP: Record<BadgeSize, number> = {
  sm: 20,
  md: 28,
  lg: 36,
};

/**
 * Clamp a score to the valid 0–100 range.
 *
 * @param score - Raw score value
 * @returns Score clamped to [0, 100]
 */
export function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Determine risk level, label, and CSS color token for a given score.
 * - Low risk:    0–34  → green  (--fancy-accent)
 * - Medium risk: 35–65 → amber  (--fancy-warning)
 * - High risk:   66–100 → red   (--fancy-danger)
 *
 * @param score - Risk score 0–100
 * @returns Risk info with level, label, color variable, and glow color
 */
export function getRiskInfo(score: number): RiskInfo {
  const clamped = clampScore(score);

  if (clamped >= 66) {
    return {
      level: 'high',
      label: 'High Risk',
      color: 'var(--fancy-danger)',
      glowColor: 'rgba(255, 51, 102, 0.4)',
    };
  }

  if (clamped >= 35) {
    return {
      level: 'medium',
      label: 'Medium',
      color: 'var(--fancy-warning)',
      glowColor: 'rgba(255, 136, 0, 0.4)',
    };
  }

  return {
    level: 'low',
    label: 'Low Risk',
    color: 'var(--fancy-accent)',
    glowColor: 'rgba(0, 255, 136, 0.4)',
  };
}

/**
 * Get badge dimension in pixels for a given size preset.
 *
 * @param size - Badge size key
 * @returns Diameter in pixels
 */
export function getBadgeDimension(size: BadgeSize): number {
  return SIZE_MAP[size];
}
