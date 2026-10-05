import type { PlotGeometry, PlotPoint } from './statistics-plot';
import { motionAllowed } from './motion';

export interface LivePlotFrame {
  geometry: PlotGeometry;
  maximum: number;
}
export interface LivePlotTarget extends LivePlotFrame {
  key: string;
  stepped: boolean;
}

/** Assemble separate source segments without joining missing observations.
 * @param segments Display coordinates @param stepped Discrete series
 * @returns SVG lines and the original measured point metadata @since 0.18.1
 */
export function livePlotGeometry(segments: PlotPoint[][], stepped = false): PlotGeometry {
  return {
    segments,
    points: segments.flat(),
    paths: segments.map((segment) =>
      segment
        .map((point, i) => {
          const x = point.x.toFixed(2),
            y = point.y.toFixed(2);
          return i ? (stepped ? ` H ${x} V ${y}` : ` L ${x} ${y}`) : `M ${x} ${y}`;
        })
        .join(''),
    ),
  };
}

/** Ease display coordinates only; measured values, timestamps and gaps stay exact.
 * @param before Previous displayed frame @param target Delivered target @param progress Elapsed fraction
 * @returns Display frame; an expanding scale snaps outward to retain spikes @since 0.18.1
 */
export function interpolateLivePlot(
  before: LivePlotFrame,
  target: LivePlotTarget,
  progress: number,
): LivePlotFrame {
  if (progress >= 1 || target.stepped) return target;
  const p = 1 - (1 - Math.max(0, progress)) ** 3;
  const maximum =
    target.maximum >= before.maximum
      ? target.maximum
      : before.maximum + (target.maximum - before.maximum) * p;
  const previous = new Map(before.geometry.points.map((point) => [point.at, point]));
  const segments = target.geometry.segments.map((segment) =>
    segment.map((point, i) => {
      const old = previous.get(point.at);
      // A new endpoint can grow from its preceding measured point, never across a gap.
      const origin = old ?? (i ? previous.get(segment[i - 1].at) : undefined);
      const y = 160 - Math.min(1, point.value / Math.max(1e-12, maximum)) * 160;
      return {
        ...point,
        x: origin ? origin.x + (point.x - origin.x) * p : point.x,
        y: !old && origin ? origin.y + (y - origin.y) * p : y,
      };
    }),
  );
  return { maximum, geometry: livePlotGeometry(segments) };
}

/** Animate short deliveries and go idle between them; finish immediately on a hold.
 * @param paint Display callback @param request Frame scheduler @param cancel Frame cancellation
 * @returns Update, finish and disposal methods @since 0.18.1
 */
export function createLivePlotMotion(
  paint: (frame: LivePlotFrame) => void,
  request: typeof requestAnimationFrame = requestAnimationFrame,
  cancel: typeof cancelAnimationFrame = cancelAnimationFrame,
): {
  update: (target: LivePlotTarget, animate: boolean) => void;
  finish: () => void;
  destroy: () => void;
} {
  let pending: number | undefined;
  let target: LivePlotTarget | undefined;
  let displayed: LivePlotFrame | undefined;
  const stop = (): void => {
    if (pending !== undefined) cancel(pending);
    pending = undefined;
  };
  const show = (frame: LivePlotFrame): void => {
    displayed = frame;
    paint(frame);
  };
  return {
    update(next, animate): void {
      if (
        target?.key === next.key &&
        target.maximum === next.maximum &&
        target.stepped === next.stepped &&
        target.geometry.paths.length === next.geometry.paths.length &&
        target.geometry.paths.every((path, i) => path === next.geometry.paths[i]) &&
        target.geometry.points.length === next.geometry.points.length &&
        target.geometry.points.every(
          (point, i) =>
            point.at === next.geometry.points[i].at &&
            point.value === next.geometry.points[i].value,
        )
      ) {
        target = next;
        if (!animate && pending !== undefined) {
          stop();
          show(next);
        }
        return;
      }
      stop();
      const before = displayed,
        previous = target;
      target = next;
      const priorTimes = new Set(before?.geometry.points.map((point) => point.at));
      if (
        !animate ||
        !before ||
        previous?.key !== next.key ||
        next.stepped ||
        next.geometry.points.length < 2 ||
        !next.geometry.points.some((point) => priorTimes.has(point.at))
      ) {
        show(next);
        return;
      }
      let began: number | undefined;
      const frame = (at: number): void => {
        pending = undefined;
        began ??= at;
        const progress = Math.min(1, (at - began) / 240);
        show(interpolateLivePlot(before, next, progress));
        if (progress < 1) pending = request(frame);
      };
      pending = request(frame);
    },
    finish(): void {
      stop();
      if (target) show(target);
    },
    destroy: stop,
  };
}

/** Track both motion preferences and actual visibility, including hidden agent tabs.
 * @param node Chart surface @param change Effective motion callback @returns Cleanup @since 0.18.1
 */
export function observeLivePlotMotion(
  node: HTMLElement,
  change: (allowed: boolean) => void,
): () => void {
  let visible = false;
  const sync = (): void => change(visible && motionAllowed());
  const media =
    typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const preference = new MutationObserver(sync);
  preference.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-motion', 'class'],
  });
  const visibility =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
          visible = entries.some((entry) => entry.isIntersecting);
          sync();
        })
      : null;
  visibility?.observe(node);
  media?.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  sync();
  return () => {
    visibility?.disconnect();
    preference.disconnect();
    media?.removeEventListener('change', sync);
    document.removeEventListener('visibilitychange', sync);
  };
}
