import { expect, it, vi } from 'vitest';
import { plotGeometry } from '../../frontend/observatory/runtime/statistics-plot';
import {
  createLivePlotMotion,
  interpolateLivePlot,
  type LivePlotTarget,
} from '../../frontend/observatory/runtime/live-plot';

function target(values: (number | null)[], key = 'cpu', maximum = 100): LivePlotTarget {
  return {
    key,
    maximum,
    stepped: key === 'tokens',
    geometry: plotGeometry(
      values.map((value, i) => ({ at: i * 1000, values: { [key]: value } })),
      key,
      0,
      6000,
      maximum,
      key === 'tokens',
    ),
  };
}
it('animates a contiguous endpoint without inventing measured values or bridging gaps', () => {
  const before = target([10, 20]);
  const next = target([10, 20, 70, null, 40, 50]);
  const frame = interpolateLivePlot(before, next, 0.2);
  expect(frame.geometry.paths).toHaveLength(2);
  expect(frame.geometry.points.map(({ at, value }) => ({ at, value }))).toEqual(
    next.geometry.points.map(({ at, value }) => ({ at, value })),
  );
  expect(frame.geometry.points[2].x).toBeGreaterThan(before.geometry.points[1].x);
  expect(frame.geometry.points[2].x).toBeLessThan(next.geometry.points[2].x);
  expect(frame.geometry.segments[1][0]).toEqual(next.geometry.segments[1][0]);
  expect(interpolateLivePlot(before, next, 1)).toBe(next);
});
it('retains discrete counter steps and expands the scale immediately for spikes', () => {
  const before = target([10, 20]);
  const spike = target([10, 20, 600], 'cpu', 1000);
  const frame = interpolateLivePlot(before, spike, 0);
  expect(frame.maximum).toBe(1000);
  expect(frame.geometry.points.every((point) => point.y >= 0 && point.y <= 160)).toBe(true);
  const counter = target([10, 20, 30], 'tokens');
  expect(interpolateLivePlot(before, counter, 0.2)).toBe(counter);
  expect(counter.geometry.paths[0]).toContain(' H ');
});
it('does not restart a delivery for unchanged measurements from another source', () => {
  const callbacks = new Map<number, FrameRequestCallback>();
  let id = 0;
  const request = vi.fn((callback: FrameRequestCallback) => {
    callbacks.set(++id, callback);
    return id;
  });
  const cancel = vi.fn((id: number) => {
    callbacks.delete(id);
  });
  const paint = vi.fn();
  const motion = createLivePlotMotion(paint, request, cancel);
  motion.update(target([10, 20]), true);
  motion.update(target([10, 20]), true);
  expect(request).not.toHaveBeenCalled();
  motion.update(target([10, 20, 30]), true);
  const pending = [...callbacks.keys()];
  motion.update(target([10, 20, 30]), true);
  expect([...callbacks.keys()]).toEqual(pending);
  expect(cancel).not.toHaveBeenCalled();
  motion.update(target([10, 20, 30]), false);
  expect(callbacks.size).toBe(0);
  expect(paint.mock.lastCall?.[0].geometry.points.at(-1)?.value).toBe(30);
  motion.update(target([10, 20, 30]), true);
  expect(callbacks.size).toBe(0);
  motion.destroy();
});
it('goes idle after a delivery and cancels pending motion on holds, new scopes and disposal', () => {
  const callbacks = new Map<number, FrameRequestCallback>();
  let sequence = 0;
  const request = vi.fn((callback: FrameRequestCallback) => {
    const id = ++sequence;
    callbacks.set(id, callback);
    return id;
  });
  const cancel = vi.fn((id: number) => {
    callbacks.delete(id);
  });
  const paint = vi.fn();
  const motion = createLivePlotMotion(paint, request, cancel);
  const advance = (at: number): void => {
    const entries = [...callbacks];
    callbacks.clear();
    for (const [, callback] of entries) callback(at);
  };
  motion.update(target([10, 20]), true);
  expect(callbacks.size).toBe(0);
  const next = target([10, 20, 40]);
  motion.update(next, true);
  advance(0);
  advance(120);
  advance(240);
  expect(callbacks.size).toBe(0);
  expect(paint).toHaveBeenLastCalledWith(next);
  motion.update(target([10, 20, 40, 60]), true);
  motion.finish();
  expect(callbacks.size).toBe(0);
  expect(paint.mock.lastCall?.[0].geometry.points.at(-1)?.value).toBe(60);
  motion.update(target([20, 30, 50], 'memory'), true);
  expect(callbacks.size).toBe(0);
  motion.update(target([20, 30, 50, 80], 'memory'), true);
  expect(callbacks.size).toBe(1);
  motion.destroy();
  expect(callbacks.size).toBe(0);
  motion.update(target([10, 20]), false);
  expect(callbacks.size).toBe(0);
});
