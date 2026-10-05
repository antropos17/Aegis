import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import StatsChart from '../../../frontend/observatory/components/StatsChart.svelte';
import { statisticsMetrics } from '../../../frontend/observatory/runtime/statistics-metrics';
import { observeLivePlotMotion } from '../../../frontend/observatory/runtime/live-plot';

const metrics = statisticsMetrics.filter((metric) => ['cpu', 'memory'].includes(metric.id));
const samples = [
  { at: 1000, values: { cpu: 20 } },
  { at: 2000, values: { cpu: 30 } },
];
afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.motion;
});

it('uses exact endpoint values and actual-point inspection while hiding live badges at a gap', async () => {
  const view = render(StatsChart, { samples, metrics, now: 3000 });
  expect(view.container.querySelector('.endpoint-value')).toHaveTextContent('30 %');
  expect(view.container.querySelector('.readout .state')).toHaveTextContent('Live');
  expect(view.container.querySelector('.cursor')).toBeNull();
  await fireEvent.input(screen.getByRole('slider'), { target: { value: '0' } });
  expect(view.container.querySelector('.plot-tooltip')).toHaveTextContent('20 %');
  expect(view.container.querySelector('.current')).toHaveTextContent('20 %');
  await fireEvent.click(screen.getByRole('button', { name: 'Latest' }));
  await view.rerender({ samples: [...samples, { at: 2500, values: { cpu: null } }] });
  expect(view.container.querySelector('.endpoint-value')).toBeNull();
  expect(view.container.querySelector('.current')).toHaveTextContent('—');
  expect(view.container.querySelector('.readout .state')).toHaveTextContent('No measurement');
  await fireEvent.click(screen.getByRole('button', { name: /Measured agent memory/ }));
  expect(view.container.querySelector('.plot-empty')).toHaveTextContent('No measurements');
});
it('shows a held exact measurement at pause, with accessible interval controls retaining focus', async () => {
  const view = render(StatsChart, { samples, metrics, now: 3000, paused: true, stale: true });
  expect(view.container.querySelector('.readout .state')).toHaveTextContent('Paused');
  const five = screen.getByRole('button', { name: '5 min' });
  five.focus();
  await fireEvent.click(five);
  expect(five).toHaveAttribute('aria-pressed', 'true');
  expect(five).toHaveFocus();
  expect(screen.getByRole('img')).toHaveAttribute(
    'aria-label',
    expect.stringContaining('300 seconds'),
  );
  expect(view.container.querySelector('.current')).toHaveTextContent('30 %');
});
it('labels a retained reading outside the displayed interval as held', () => {
  const view = render(StatsChart, { samples, metrics, now: 63000 });
  expect(view.container.querySelector('.current')).toHaveTextContent('30 %');
  expect(view.container.querySelector('.readout .state')).toHaveTextContent('Held');
  expect(view.container.querySelector('.endpoint-value')).toBeNull();
  expect(view.container.querySelector('.plot-empty')).toHaveTextContent('No measurements');
});
it('stops motion for system and app preferences, hidden surfaces and document visibility', async () => {
  let intersect: IntersectionObserverCallback | undefined;
  const disconnect = vi.fn();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const media = new EventTarget() as EventTarget & { matches: boolean };
  media.matches = false;
  vi.stubGlobal('matchMedia', () => media);
  const node = document.createElement('div');
  const change = vi.fn();
  const stop = observeLivePlotMotion(node, change);
  const show = (isIntersecting: boolean): void => {
    intersect?.([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver);
  };
  show(true);
  expect(change).toHaveBeenLastCalledWith(true);
  document.documentElement.dataset.motion = 'reduce';
  await Promise.resolve();
  expect(change).toHaveBeenLastCalledWith(false);
  delete document.documentElement.dataset.motion;
  await Promise.resolve();
  expect(change).toHaveBeenLastCalledWith(true);
  media.matches = true;
  media.dispatchEvent(new Event('change'));
  expect(change).toHaveBeenLastCalledWith(false);
  media.matches = false;
  show(false);
  expect(change).toHaveBeenLastCalledWith(false);
  show(true);
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  expect(change).toHaveBeenLastCalledWith(false);
  stop();
  expect(disconnect).toHaveBeenCalledOnce();
  const count = change.mock.calls.length;
  media.dispatchEvent(new Event('change'));
  document.dispatchEvent(new Event('visibilitychange'));
  expect(change).toHaveBeenCalledTimes(count);
  visibility.mockRestore();
});
