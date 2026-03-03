/**
 * sparkline-utils.ts — SVG point computation for Sparkline component [F2.1]
 * Pure functions, no DOM dependency. Used by Sparkline.svelte.
 */

/**
 * Compute SVG polyline points string from a data array.
 * Maps values to viewBox coordinates with Y inverted (SVG Y=0 is top).
 *
 * @param data - Array of numeric values (minimum 2 for a line)
 * @param width - ViewBox width
 * @param height - ViewBox height
 * @param padding - Top/bottom padding to prevent stroke clipping
 * @returns Space-separated "x,y" pairs for SVG polyline/polygon
 */
export function computePoints(
  data: number[],
  width: number,
  height: number,
  padding: number,
): string {
  if (data.length < 2) return '';

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const usableHeight = height - padding * 2;

  return data
    .map((value, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = padding + usableHeight - ((value - min) / range) * usableHeight;
      return `${x},${y}`;
    })
    .join(' ');
}

/**
 * Compute area polygon points: line points + bottom-right + bottom-left.
 *
 * @param linePoints - Points string from computePoints()
 * @param width - ViewBox width
 * @param height - ViewBox height
 * @returns Space-separated polygon points for SVG fill area
 */
export function computeAreaPoints(linePoints: string, width: number, height: number): string {
  if (!linePoints) return '';
  return `${linePoints} ${width},${height} 0,${height}`;
}
