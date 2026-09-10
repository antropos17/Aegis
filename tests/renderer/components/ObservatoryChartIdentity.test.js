import { it, expect } from 'vitest';
import { render, within, fireEvent } from '@testing-library/svelte';
import StatsChart from '../../../frontend/observatory/components/StatsChart.svelte';
import { statisticsMetrics } from '../../../frontend/observatory/runtime/statistics-metrics';

it('keeps inspection labels attached to their own mounted chart across metric changes', async () => {
  const metrics = statisticsMetrics.filter((metric) => ['cpu', 'memory'].includes(metric.id));
  const props = {
    samples: [
      { at: 1000, values: { cpu: 10, memory: 100 } },
      { at: 2000, values: { cpu: 20, memory: 200 } },
    ],
    metrics,
    now: 3000,
  };
  const first = render(StatsChart, props);
  const second = render(StatsChart, props);
  const firstSlider = within(first.container).getByRole('slider');
  const secondSlider = within(second.container).getByRole('slider');
  expect(firstSlider.id).not.toBe(secondSlider.id);
  expect(within(first.container).getByLabelText('Inspect')).toBe(firstSlider);
  expect(within(second.container).getByLabelText('Inspect')).toBe(secondSlider);
  first.container.hidden = true;
  expect(within(second.container).getByLabelText('Inspect')).toBe(secondSlider);
  await fireEvent.click(within(second.container).getByRole('button', { name: /memory/ }));
  expect(within(second.container).getByLabelText('Inspect')).toBe(secondSlider);
  expect(firstSlider.id).not.toBe(secondSlider.id);
});
