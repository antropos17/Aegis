import { it, expect } from 'vitest';
import {
  metricObservations,
  plotGeometry,
  plotMaximum,
  plotX,
  nearestObservation,
} from '../../frontend/observatory/runtime/statistics-plot';

it('places measurements in a fixed real-time window despite unrelated arrivals', () => {
  const samples = [
    { at: 1000, values: { cpu: 10 } },
    { at: 1001, values: { tokens: 100 } },
    { at: 31000, values: { cpu: 20 } },
    { at: 61000, values: { cpu: 30 } },
  ];
  expect(metricObservations(samples, 'cpu', 1000, 61000)).toHaveLength(3);
  expect(plotGeometry(samples, 'cpu', 1000, 61000, 100).points.map((p) => p.x)).toEqual([
    0, 300, 600,
  ]);
  expect(plotX(31000, 1000, 61000)).toBe(300);
  expect(plotX(31000, 11000, 71000)).toBe(200);
});
it('draws isolated measurements and breaks only at explicit missing observations', () => {
  const samples = [
    { at: 0, values: { cpu: 10 } },
    { at: 10, values: { tokens: 20 } },
    { at: 20, values: { cpu: 20 } },
    { at: 30, values: { cpu: null } },
    { at: 40, values: { cpu: 30 } },
  ];
  const graph = plotGeometry(samples, 'cpu', 0, 60, 100);
  expect(graph.paths).toHaveLength(2);
  expect(graph.points).toHaveLength(3);
  expect(graph.paths[0]).toContain(' L ');
  expect(graph.paths[1]).toBe('M 400.00 112.00');
  expect(plotGeometry([{ at: 40, values: { cpu: 10 } }], 'cpu', 0, 60, 100).points).toHaveLength(1);
});
it('uses discrete steps for population counters and stable readable scales', () => {
  const graph = plotGeometry(
    [
      { at: 0, values: { processes: 2 } },
      { at: 10, values: { processes: 4 } },
    ],
    'processes',
    0,
    20,
    5,
    true,
  );
  expect(graph.paths).toEqual(['M 0.00 96.00 H 300.00 V 32.00']);
  expect(plotMaximum([null, NaN, Infinity])).toBe(1);
  expect(plotMaximum([21, 22, 24])).toBe(25);
  expect(plotMaximum([4, 7], 100)).toBe(100);
});
it('inspects an actual measured timestamp and excludes expired or future points', () => {
  const visible = metricObservations(
    [
      { at: 0, values: { cpu: 1 } },
      { at: 500, values: { cpu: 2 } },
      { at: 1000, values: { cpu: 3 } },
      { at: 2000, values: { cpu: 4 } },
    ],
    'cpu',
    100,
    1000,
  );
  expect(visible.map((s) => s.at)).toEqual([500, 1000]);
  expect(nearestObservation(visible, 890)?.at).toBe(1000);
  expect(nearestObservation([], 890)).toBeUndefined();
});
