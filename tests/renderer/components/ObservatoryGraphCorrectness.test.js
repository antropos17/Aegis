import { it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import StatsChart from '../../../frontend/observatory/components/StatsChart.svelte';
import { statisticsMetrics } from '../../../frontend/observatory/runtime/statistics-metrics';

const metrics = statisticsMetrics.filter((m) => ['cpu', 'memory'].includes(m.id));
const samples = [
  { at: 1000, values: { cpu: 10 }, coverage: { cpu: { measured: 1, total: 2 } } },
  { at: 1010, values: { tokens: 1000 } },
  { at: 2000, values: { cpu: 20 } },
];
it('renders partial measured values and only its own source points in a real duration', async () => {
  const mounted = render(StatsChart, { samples, metrics, now: 3000 });
  expect(screen.getByRole('img')).toHaveAttribute(
    'aria-label',
    expect.stringContaining('2 measured samples; 60 seconds'),
  );
  expect(mounted.container.querySelector('.current')).toHaveTextContent('20 %');
  await fireEvent.input(screen.getByRole('slider'), { target: { value: '0' } });
  expect(mounted.container.querySelector('.current')).toHaveTextContent('10 %');
  expect(screen.getByText(/Measured subtotal/)).toHaveTextContent('1 / 2 processes');
  await fireEvent.change(screen.getByRole('combobox', { name: 'Performance history length' }), {
    target: { value: '300000' },
  });
  expect(screen.getByRole('img')).toHaveAttribute(
    'aria-label',
    expect.stringContaining('300 seconds'),
  );
});
it('holds an inspected observation on updates, then returns to Latest when it expires', async () => {
  const mounted = render(StatsChart, { samples, metrics, now: 3000 });
  await fireEvent.input(screen.getByRole('slider'), { target: { value: '0' } });
  const updated = [...samples, { at: 4000, values: { cpu: 30 } }];
  await mounted.rerender({ samples: updated, now: 5000 });
  expect(mounted.container.querySelector('.current')).toHaveTextContent('10 %');
  expect(screen.getByRole('button', { name: 'Latest' })).toHaveAttribute('aria-pressed', 'false');
  await mounted.rerender({ now: 63000 });
  expect(screen.getByRole('button', { name: 'Latest' })).toHaveAttribute('aria-pressed', 'true');
  expect(mounted.container.querySelector('.current')).toHaveTextContent('30 %');
});
it('preserves the displayed measured value at a pause boundary without joining its gap', async () => {
  const paused = [...samples, { at: 2500, values: { cpu: null }, boundary: true }];
  const mounted = render(StatsChart, {
    samples: paused,
    metrics,
    now: 3000,
    paused: true,
    stale: true,
  });
  expect(mounted.container.querySelector('.current')).toHaveTextContent('20 %');
  expect(screen.getByText(/^View held/)).toBeVisible();
  expect(mounted.container.querySelectorAll('.plot path')).toHaveLength(1);
  await mounted.rerender({ paused: false });
  expect(mounted.container.querySelector('.current')).toHaveTextContent('—');
});

it('distinguishes completed collections and mixed reading times from delivery time', () => {
  const collected = [
    {
      at: 5000,
      values: { cpu: 10 },
      coverage: { cpu: { measured: 2, total: 2 } },
      resourceCollection: { oldest: 1000, newest: 5000 },
    },
  ];
  const mounted = render(StatsChart, { samples: collected, metrics, now: 6000 });
  expect(screen.getByText(/^Latest collection/)).toBeVisible();
  expect(screen.getByText(/readings span/)).toHaveTextContent('readings span 4 s');
  expect(screen.getByText(/Cached replies add no points/)).toBeVisible();
  expect(mounted.container.querySelector('.current')).toHaveTextContent('10 %');
});
