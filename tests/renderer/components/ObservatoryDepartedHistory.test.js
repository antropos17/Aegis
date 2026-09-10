import { afterEach, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { cleanup, fireEvent, render, within } from '@testing-library/svelte';
import AgentPerformance from '../../../frontend/observatory/components/AgentPerformance.svelte';
import Statistics from '../../../frontend/observatory/components/Statistics.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it.each([
  ['agent overview', AgentPerformance],
  ['statistics', Statistics],
])(
  'holds %s history after process exit while the global sensor stays healthy',
  async (_name, Component) => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(100000);
    const telemetry = {
      ...emptyTelemetry(),
      ready: true,
      stale: false,
      lastScan: Date.now(),
      statsAt: Date.now(),
      resourcesAt: Date.now(),
      ownAt: Date.now(),
      agents: [{ agent: 'Codex', process: 'codex', pid: 42, instanceId: '42:old' }],
      resources: [{ instanceId: '42:old', cpu: 10, memMb: 100 }],
      own: { memMB: 64 },
    };
    const mounted = render(Component, {
      telemetry,
      scope: { agent: 'Codex', instanceId: '42:old' },
      ...(Component === Statistics ? { inspect: vi.fn() } : {}),
    });
    await tick();
    const view = within(mounted.container);
    expect(view.getByRole('img')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('1 measured samples'),
    );
    await vi.advanceTimersByTimeAsync(1000);
    await tick();
    const departed = {
      ...telemetry,
      lastScan: Date.now(),
      statsAt: Date.now(),
      agents: [{ ...telemetry.agents[0], instanceId: '42:new' }],
    };
    await mounted.rerender({ telemetry: departed });
    const heldPoint = view.getByRole('img').querySelector('circle').getAttribute('cx');
    expect(view.getByText(/^View held/)).toBeVisible();
    await vi.advanceTimersByTimeAsync(65000);
    await tick();
    expect(view.getByRole('img')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('1 measured samples'),
    );
    expect(view.getByRole('img').querySelector('circle')).toHaveAttribute('cx', heldPoint);

    if (Component === Statistics) {
      await fireEvent.click(view.getByRole('tab', { name: 'Sensors', exact: true }));
      await mounted.rerender({ telemetry: { ...departed, ownAt: Date.now(), own: { memMB: 80 } } });
      await fireEvent.click(view.getByRole('button', { name: /AEGIS memory/ }));
      const livePoint = view.getByRole('img').querySelector('circle').getAttribute('cx');
      await vi.advanceTimersByTimeAsync(2000);
      await tick();
      expect(view.getByRole('img').querySelector('circle').getAttribute('cx')).not.toBe(livePoint);
      await fireEvent.click(view.getByRole('tab', { name: 'Performance', exact: true }));
      expect(view.getByRole('img')).toHaveAttribute(
        'aria-label',
        expect.stringContaining('1 measured samples'),
      );
      expect(view.getByRole('img').querySelector('circle')).toHaveAttribute('cx', heldPoint);
    }
  },
);
