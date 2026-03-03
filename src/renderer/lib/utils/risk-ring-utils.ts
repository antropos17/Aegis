/**
 * risk-ring-utils.ts — SVG ring gauge geometry for RiskRing component [F4.1]
 * Pure math, no DOM. Reuses getRiskInfo() from trust-badge-utils.ts.
 */

import { getRiskInfo, clampScore } from './trust-badge-utils';
import type { RiskInfo } from './trust-badge-utils';

/** Computed ring properties for SVG rendering */
export interface RingGeometry {
  /** Circle circumference in px */
  circumference: number;
  /** stroke-dashoffset for the filled arc */
  dashOffset: number;
  /** Risk info (level, label, color, glowColor) */
  risk: RiskInfo;
  /** Clamped score 0–100 */
  clamped: number;
  /** Whether score is in danger zone (pulse trigger) */
  isDanger: boolean;
}

/** Default ring stroke width ratio (relative to size) */
const STROKE_RATIO = 0.08;
/** Track stroke width ratio */
const TRACK_RATIO = 0.04;

/**
 * Compute SVG ring geometry from score and size.
 *
 * @param score - Risk score 0–100
 * @param size - Outer diameter in px
 * @returns All values needed to render the ring
 */
export function computeRing(score: number, size: number): RingGeometry {
  const clamped = clampScore(score);
  const risk = getRiskInfo(score);
  const radius = (size - size * STROKE_RATIO) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clamped / 100);

  return {
    circumference,
    dashOffset,
    risk,
    clamped,
    isDanger: clamped >= 66,
  };
}

/**
 * Get the stroke width for the main arc.
 *
 * @param size - Ring outer diameter in px
 * @returns Stroke width in px
 */
export function getStrokeWidth(size: number): number {
  return Math.max(4, Math.round(size * STROKE_RATIO));
}

/**
 * Get the stroke width for the background track.
 *
 * @param size - Ring outer diameter in px
 * @returns Track stroke width in px
 */
export function getTrackWidth(size: number): number {
  return Math.max(2, Math.round(size * TRACK_RATIO));
}
