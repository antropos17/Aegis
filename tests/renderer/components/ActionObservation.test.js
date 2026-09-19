import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import ActionObservation from '../../../frontend/observatory/components/ActionObservation.svelte';
const observed = {
  state: 'observed',
  reason: null,
  lastObservedAt: '2026-09-19T00:00:00.000Z',
  snapshot: {
    connectionId: '12345678-1234-1234-1234-123456789012',
    route: 'mcp-stdio',
    selection: 'single-action',
    client: { name: 'claude-code', version: '2.1.263' },
    selectedActionCount: 1,
    actionAttempts: 2,
    ownerInvocations: 2,
    ownerSettled: 2,
    ownerFailures: 0,
    cancellationRequests: 0,
  },
};
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('labels self-reported identity, preserves last counters on loss, and never claims verified blocking', async () => {
  let current = structuredClone(observed);
  const localSecurityReview = vi.fn(async () => ({ success: true, observation: current }));
  render(ActionObservation, { host: { localSecurityReview } });
  const choose = screen.getByRole('button', { name: 'Choose observation endpoint' });
  await fireEvent.click(choose);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Observed'));
  expect(choose).toBeDisabled();
  expect(screen.getByText('Client label · self-reported')).toBeInTheDocument();
  expect(screen.getByText('claude-code · 2.1.263')).toBeInTheDocument();
  current = { ...observed, state: 'coverage-lost', reason: 'connection-closed' };
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Coverage lost'), {
    timeout: 2500,
  });
  expect(screen.getByText('2 / 2')).toBeInTheDocument();
  expect(screen.queryByText('Blocking verified')).not.toBeInTheDocument();
  expect(choose).toBeEnabled();
  expect(localSecurityReview.mock.calls.map(([request]) => request)).toEqual([
    { action: 'observe-route' },
    { action: 'route-observation' },
  ]);
});
it('marks host failure as lost evidence and stops polling', async () => {
  const localSecurityReview = vi
    .fn()
    .mockResolvedValueOnce({ success: true, observation: observed })
    .mockRejectedValue(new Error('PRIVATE'));
  render(ActionObservation, { host: { localSecurityReview } });
  await fireEvent.click(screen.getByRole('button', { name: 'Choose observation endpoint' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Coverage lost'), {
    timeout: 2500,
  });
  expect(screen.queryByText('PRIVATE')).not.toBeInTheDocument();
  expect(localSecurityReview).toHaveBeenCalledTimes(2);
});
it('stops observing without an execution request and excludes live attachment in preview', async () => {
  const localSecurityReview = vi.fn(async ({ action }) => ({
    success: true,
    observation:
      action === 'stop-observing-route'
        ? { ...observed, state: 'stopped', reason: 'observer-stopped' }
        : observed,
  }));
  const component = render(ActionObservation, { host: { localSecurityReview } });
  await fireEvent.click(screen.getByRole('button', { name: 'Choose observation endpoint' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop observing' })).toBeEnabled());
  await fireEvent.click(screen.getByRole('button', { name: 'Stop observing' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Observation stopped'));
  expect(localSecurityReview).toHaveBeenLastCalledWith({ action: 'stop-observing-route' });
  component.unmount();
  render(ActionObservation, { host: { localSecurityReview }, preview: true });
  expect(screen.getByRole('button', { name: 'Choose observation endpoint' })).toBeDisabled();
});
it('closes a late attachment after the component was destroyed', async () => {
  let finish;
  const localSecurityReview = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue({ success: true, observation: null });
  const component = render(ActionObservation, { host: { localSecurityReview } });
  await fireEvent.click(screen.getByRole('button', { name: 'Choose observation endpoint' }));
  component.unmount();
  finish({ success: true, observation: observed });
  await waitFor(() =>
    expect(localSecurityReview).toHaveBeenLastCalledWith({ action: 'stop-observing-route' }),
  );
});
