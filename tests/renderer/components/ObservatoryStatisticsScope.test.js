import { expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import Statistics from '../../../frontend/observatory/components/Statistics.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';
const state = () => ({
  ...emptyTelemetry(),
  ready: true,
  stale: false,
  lastScan: Date.now(),
  resourcesAt: Date.now(),
  agents: [
    { agent: 'Codex', pid: 1, instanceId: '1:new', process: 'codex' },
    { agent: 'Claude', pid: 2, instanceId: '2:new', process: 'claude' },
  ],
  resources: [
    { instanceId: '1:new', cpu: 10, memMb: 100 },
    { instanceId: '2:new', cpu: 70, memMb: 700 },
  ],
});
it('changes chart scope, preserves it across sections and does not select a recycled process', async () => {
  const telemetry = state();
  const { container, rerender } = render(Statistics, { telemetry, inspect: vi.fn() });
  const current = () => container.querySelector('.monitor-detail .current');
  await waitFor(() => expect(current()).toHaveTextContent('80'));
  await fireEvent.change(screen.getByLabelText('Statistics agent'), { target: { value: 'Codex' } });
  await waitFor(() => expect(current()).toHaveTextContent('10'));
  await fireEvent.change(screen.getByLabelText('Statistics process'), {
    target: { value: '1:new' },
  });
  await fireEvent.click(screen.getByRole('tab', { name: 'Tokens', exact: true }));
  expect(screen.getByLabelText('Statistics agent')).toHaveValue('Codex');
  expect(screen.getByLabelText('Statistics process')).toHaveValue('1:new');
  await fireEvent.click(screen.getByRole('tab', { name: 'Sensors', exact: true }));
  expect(screen.getByLabelText('Statistics agent')).toBeDisabled();
  await fireEvent.click(screen.getByRole('tab', { name: 'Performance', exact: true }));
  await rerender({
    telemetry: {
      ...telemetry,
      lastScan: Date.now() + 1000,
      agents: [{ ...telemetry.agents[0], instanceId: '1:replacement' }],
    },
  });
  expect(screen.getByLabelText('Statistics process')).toHaveValue('1:new');
  expect(screen.getByText(/Selection no longer observed/)).toBeInTheDocument();
  expect(current()).not.toHaveTextContent('80');
});
it('opens a requested agent directly and resets an earlier process selection', async () => {
  const { rerender } = render(Statistics, {
    telemetry: state(),
    inspect: vi.fn(),
    scopeRequest: { agent: 'Codex', revision: 1 },
  });
  expect(screen.getByLabelText('Statistics agent')).toHaveValue('Codex');
  await fireEvent.change(screen.getByLabelText('Statistics process'), {
    target: { value: '1:new' },
  });
  await rerender({ scopeRequest: { agent: 'Claude', revision: 2 } });
  expect(screen.getByLabelText('Statistics agent')).toHaveValue('Claude');
  expect(screen.getByLabelText('Statistics process')).toHaveValue('');
});
