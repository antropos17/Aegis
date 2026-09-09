import type { StatisticsSample } from './statistics-history';

export interface PlotPoint {
  at: number;
  value: number;
  x: number;
  y: number;
}
/** Read only measurements delivered by this metric's own source clock.
 * @param samples Sparse history @param key Metric @param start Window start @param end Window end
 * @returns Actual metric observations, including explicit gaps @since 0.14.1
 */
export function metricObservations(
  samples: StatisticsSample[],
  key: string,
  start: number,
  end: number,
): StatisticsSample[] {
  return samples.filter(
    (s) => Number.isFinite(s.at) && s.at >= start && s.at <= end && Object.hasOwn(s.values, key),
  );
}
/** Choose a readable, stable zero-based vertical scale.
 * @param values Measurements @param floor Fixed minimum scale @returns Axis upper bound @since 0.14.1
 */
export function plotMaximum(values: (number | null | undefined)[], floor = 0): number {
  const peak = Math.max(
    0,
    ...values.filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0),
  );
  if (floor >= peak && floor > 0) return floor;
  if (!peak) return 1;
  const power = 10 ** Math.floor(Math.log10(peak));
  return ([1, 2, 2.5, 5, 10].find((n) => n * power >= peak) ?? 10) * power;
}
/** Map an observed timestamp to a fixed duration, never to the number of arrivals.
 * @param at Timestamp @param start Window start @param end Window end @returns SVG x coordinate @since 0.14.1
 */
export function plotX(at: number, start: number, end: number): number {
  return Math.max(0, Math.min(600, ((at - start) / Math.max(1, end - start)) * 600));
}
/** Plot sparse source observations, retaining isolated points and explicit breaks.
 * @param samples Metric history @param key Metric @param start Window start @param end Window end
 * @param maximum Vertical maximum @param stepped Discrete state series
 * @returns Line segments and actual measured points @since 0.14.1
 */
export function plotGeometry(
  samples: StatisticsSample[],
  key: string,
  start: number,
  end: number,
  maximum: number,
  stepped = false,
): { paths: string[]; points: PlotPoint[] } {
  const paths: string[] = [],
    points: PlotPoint[] = [];
  let path = '';
  for (const sample of metricObservations(samples, key, start, end)) {
    const value = sample.values[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      if (path) paths.push(path);
      path = '';
      continue;
    }
    const x = plotX(sample.at, start, end),
      y = 160 - Math.min(1, value / Math.max(1e-12, maximum)) * 160;
    const xy = x.toFixed(2) + ' ' + y.toFixed(2);
    path += path ? (stepped ? ' H ' + x.toFixed(2) + ' V ' + y.toFixed(2) : ' L ' + xy) : 'M ' + xy;
    points.push({ at: sample.at, value, x, y });
  }
  if (path) paths.push(path);
  return { paths, points };
}
/** Resolve a cursor to the nearest actual observation, without inventing interpolation.
 * @param samples Metric observations @param at Cursor timestamp @returns Actual observation @since 0.14.1
 */
export function nearestObservation(
  samples: StatisticsSample[],
  at: number,
): StatisticsSample | undefined {
  return samples.reduce<StatisticsSample | undefined>(
    (best, s) => (!best || Math.abs(s.at - at) < Math.abs(best.at - at) ? s : best),
    undefined,
  );
}
