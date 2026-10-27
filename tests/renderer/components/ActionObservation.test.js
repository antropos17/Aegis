import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import ActionObservation from '../../../frontend/observatory/components/ActionObservation.svelte';
import { parseRouteObservation } from '../../../frontend/observatory/runtime/action-observation';
const lease = '12345678-1234-4234-8234-123456789012';
const observed = {
  state: 'observed',
  reason: null,
  lastObservedAt: '2026-09-19T00:00:00.000Z',
  snapshot: {
    schemaVersion: 1,
    connectionId: '12345678-1234-1234-1234-123456789012',
    sequence: 1,
    route: 'mcp-stdio',
    state: 'observed',
    selection: 'single-action',
    client: { name: 'claude-code', version: '2.1.263' },
    selectedActionCount: 1,
    actionAttempts: 2,
    selectionRejected: 0,
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
  const localSecurityReview = vi.fn(async () => ({ success: true, observation: current, lease }));
  render(ActionObservation, { host: { localSecurityReview } });
  const choose = screen.getByRole('button', { name: 'Choose observation endpoint' });
  await fireEvent.click(choose);
  await waitFor(() =>
    expect(screen.getByRole('status', { name: 'Route observation status' })).toHaveTextContent(
      'Observed',
    ),
  );
  expect(choose).toBeDisabled();
  expect(screen.getByText('Client label · self-reported')).toBeInTheDocument();
  expect(screen.getByText('claude-code · 2.1.263')).toBeInTheDocument();
  expect(screen.getByText('Single action')).toBeVisible();
  expect(screen.getByText('Selected-action MCP stdio')).toBeVisible();
  expect(screen.getByText('Action attempts')).toBeVisible();
  current = { ...observed, state: 'coverage-lost', reason: 'connection-closed' };
  await waitFor(
    () =>
      expect(screen.getByRole('status', { name: 'Route observation status' })).toHaveTextContent(
        'Coverage lost',
      ),
    {
      timeout: 2500,
    },
  );
  expect(screen.getByText('2 / 2')).toBeInTheDocument();
  expect(screen.queryByText('Blocking verified')).not.toBeInTheDocument();
  expect(choose).toBeEnabled();
  expect(localSecurityReview.mock.calls.map(([request]) => request)).toEqual([
    { action: 'observe-route' },
    { action: 'route-observation', lease },
  ]);
});
it('marks host failure as lost evidence and stops polling', async () => {
  const localSecurityReview = vi
    .fn()
    .mockResolvedValueOnce({ success: true, observation: observed, lease })
    .mockRejectedValue(new Error('PRIVATE'));
  render(ActionObservation, { host: { localSecurityReview } });
  await fireEvent.click(screen.getByRole('button', { name: 'Choose observation endpoint' }));
  await waitFor(
    () =>
      expect(screen.getByRole('status', { name: 'Route observation status' })).toHaveTextContent(
        'Coverage lost',
      ),
    {
      timeout: 2500,
    },
  );
  expect(screen.queryByText('PRIVATE')).not.toBeInTheDocument();
  expect(localSecurityReview).toHaveBeenCalledTimes(2);
});

it.each(['reject', 'malformed', 'timeout'])(
  'keeps the exact lease stoppable after a %s polling failure',
  async (failure) => {
    const localSecurityReview = vi.fn(({ action, lease: requested }) => {
      if (action === 'observe-route') return Promise.resolve({ success: true, observation: observed, lease });
      if (action === 'route-observation') {
        if (failure === 'reject') return Promise.reject(new Error('PRIVATE_POLL_CANARY'));
        if (failure === 'malformed') return Promise.resolve({ success: true, observation: { private: 'PRIVATE_POLL_CANARY' } });
        return new Promise(() => {});
      }
      if (action === 'stop-observing-route') {
        expect(requested).toBe(lease);
        return Promise.resolve({ success: true, observation: { ...observed, state: 'stopped', reason: 'observer-stopped' } });
      }
      throw new Error('unexpected request');
    });
    const component = render(ActionObservation, { host: { localSecurityReview } });
    await fireEvent.click(screen.getByRole('button', { name: 'Choose observation endpoint' }));
    await waitFor(() => expect(screen.getByRole('status', { name: 'Route observation status' })).toHaveTextContent('Coverage lost'), { timeout: 6000 });
    expect(screen.getByText('2 / 2')).toBeVisible();
    expect(screen.getByText('The agent or action may still be running. Stopping observation does not stop it.')).toBeVisible();
    expect(screen.queryByText('PRIVATE_POLL_CANARY')).toBeNull();
    const stop = screen.getByRole('button', { name: 'Stop observing' });
    expect(stop).toBeEnabled();
    stop.focus();
    expect(stop).toHaveFocus();
    await fireEvent.click(stop);
    await waitFor(() => expect(screen.getByRole('status', { name: 'Route observation status' })).toHaveTextContent('Observation stopped'));
    expect(localSecurityReview).toHaveBeenLastCalledWith({ action: 'stop-observing-route', lease });
    expect(screen.getByText('2 / 2')).toBeVisible();
    expect(screen.getByText('Only this observation connection stopped. No agent or action was stopped.')).toBeVisible();
    component.unmount();
    expect(localSecurityReview.mock.calls.filter(([request]) => request.action === 'stop-observing-route')).toHaveLength(1);
  },
  8000,
);

it.each(['stopped', 'coverage-lost', 'unavailable'])(
  'accepts a matching stop when the backend returns a valid %s state',
  async (state) => {
    const terminal = { ...observed, state, reason: state === 'stopped' ? 'observer-stopped' : 'connection-closed' };
    const localSecurityReview = vi.fn(async ({ action }) => action === 'observe-route'
      ? { success: true, observation: observed, lease }
      : action === 'route-observation'
        ? { success: true, observation: { ...observed, state: 'coverage-lost', reason: 'connection-closed' } }
        : { success: true, observation: terminal });
    const component = render(ActionObservation, { host: { localSecurityReview } });
    await fireEvent.click(screen.getByRole('button', { name: 'Choose observation endpoint' }));
    await waitFor(() => expect(screen.getByRole('status', { name: 'Route observation status' })).toHaveTextContent('Coverage lost'), { timeout: 2500 });
    await fireEvent.click(screen.getByRole('button', { name: 'Stop observing' }));
    await waitFor(() => expect(screen.getByRole('status', { name: 'Route observation status' })).toHaveTextContent('Observation stopped'));
    expect(localSecurityReview).toHaveBeenLastCalledWith({ action: 'stop-observing-route', lease });
    expect(screen.getByText('2 / 2')).toBeVisible();
    component.unmount();
    expect(localSecurityReview.mock.calls.filter(([request]) => request.action === 'stop-observing-route')).toHaveLength(1);
  },
);

it.each(['reject', 'expired', 'malformed', 'timeout'])(
  'keeps stop explicitly unknown and retryable on %s',
  async (failure) => {
    let stopCalls = 0;
    const localSecurityReview = vi.fn(({ action, lease: requested }) => {
      if (action === 'observe-route') return Promise.resolve({ success: true, observation: observed, lease });
      if (action === 'route-observation') return Promise.resolve({ success: true, observation: observed });
      expect(requested).toBe(lease);
      stopCalls++;
      if (stopCalls > 1) return Promise.resolve({ success: true, observation: { ...observed, state: 'stopped', reason: 'observer-stopped' } });
      if (failure === 'reject') return Promise.reject(new Error('PRIVATE_STOP_CANARY'));
      if (failure === 'expired') return Promise.resolve({ success: false, error: 'observation-expired' });
      if (failure === 'malformed') return Promise.resolve({ success: true, observation: { private: 'PRIVATE_STOP_CANARY' } });
      return new Promise(() => {});
    });
    const component = render(ActionObservation, { host: { localSecurityReview } });
    await fireEvent.click(screen.getByRole('button', { name: 'Choose observation endpoint' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop observing' })).toBeEnabled());
    await fireEvent.click(screen.getByRole('button', { name: 'Stop observing' }));
    await waitFor(() => expect(screen.getByText('Observation stop status is unknown. You can retry stopping this observation connection.')).toBeVisible(), { timeout: 5000 });
    expect(screen.getByRole('button', { name: 'Stop observing' })).toBeEnabled();
    expect(screen.getByText('2 / 2')).toBeVisible();
    expect(screen.getByText('The agent or action may still be running. Stopping observation does not stop it.')).toBeVisible();
    expect(screen.queryByText('PRIVATE_STOP_CANARY')).toBeNull();
    expect(screen.queryByText('Observation stopped')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Stop observing' }));
    await waitFor(() => expect(screen.getByRole('status', { name: 'Route observation status' })).toHaveTextContent('Observation stopped'));
    expect(localSecurityReview.mock.calls.filter(([request]) => request.action === 'stop-observing-route').map(([request]) => request.lease)).toEqual([lease, lease]);
    component.unmount();
  },
  8000,
);

it('keeps repeated expired stop replies unknown and retries the same lease on unmount', async () => {
  const localSecurityReview = vi.fn(async ({ action }) => action === 'observe-route'
    ? { success: true, observation: observed, lease }
    : action === 'stop-observing-route'
      ? { success: false, error: 'observation-expired' }
      : { success: true, observation: observed });
  const component = render(ActionObservation, { host: { localSecurityReview } });
  await fireEvent.click(screen.getByRole('button', { name: 'Choose observation endpoint' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop observing' })).toBeEnabled());
  for (let attempt = 0; attempt < 2; attempt++) {
    await fireEvent.click(screen.getByRole('button', { name: 'Stop observing' }));
    await waitFor(() => expect(screen.getByText('Observation stop status is unknown. You can retry stopping this observation connection.')).toBeVisible());
    expect(screen.getByRole('button', { name: 'Stop observing' })).toBeEnabled();
    expect(screen.queryByText('Observation stopped')).toBeNull();
  }
  component.unmount();
  expect(localSecurityReview.mock.calls.filter(([request]) => request.action === 'stop-observing-route').map(([request]) => request.lease)).toEqual([lease, lease, lease]);
});

it('does not resurrect an observation when an expired poll resolves after a successful stop', async () => {
  let finishPoll;
  const localSecurityReview = vi.fn(({ action }) => {
    if (action === 'observe-route') return Promise.resolve({ success: true, observation: observed, lease });
    if (action === 'route-observation') return new Promise((resolve) => { finishPoll = resolve; });
    return Promise.resolve({ success: true, observation: { ...observed, state: 'stopped', reason: 'observer-stopped' } });
  });
  const component = render(ActionObservation, { host: { localSecurityReview } });
  await fireEvent.click(screen.getByRole('button', { name: 'Choose observation endpoint' }));
  await waitFor(() => expect(screen.getByRole('status', { name: 'Route observation status' })).toHaveTextContent('Coverage lost'), { timeout: 6000 });
  expect(finishPoll).toBeTypeOf('function');
  await fireEvent.click(screen.getByRole('button', { name: 'Stop observing' }));
  await waitFor(() => expect(screen.getByRole('status', { name: 'Route observation status' })).toHaveTextContent('Observation stopped'));
  finishPoll({ success: true, observation: observed });
  await Promise.resolve();
  expect(screen.getByRole('status', { name: 'Route observation status' })).toHaveTextContent('Observation stopped');
  expect(screen.queryByRole('button', { name: 'Stop observing' })).toBeNull();
  component.unmount();
  expect(localSecurityReview.mock.calls.filter(([request]) => request.action === 'stop-observing-route')).toHaveLength(1);
}, 8000);

it('keeps the replacement lease when an expired stop reply from the prior selection arrives late', async () => {
  const newerLease = 'abcdef12-1234-4234-8234-123456789012';
  let finishOldStop;
  let selections = 0;
  const localSecurityReview = vi.fn(({ action, lease: requested }) => {
    if (action === 'observe-route') return Promise.resolve({ success: true, observation: observed, lease: ++selections === 1 ? lease : newerLease });
    if (action === 'route-observation') return Promise.resolve({ success: true, observation: observed });
    if (requested === lease) return new Promise((resolve) => { finishOldStop = resolve; });
    return Promise.resolve({ success: true, observation: { ...observed, state: 'stopped', reason: 'observer-stopped' } });
  });
  const component = render(ActionObservation, { host: { localSecurityReview } });
  await fireEvent.click(screen.getByRole('button', { name: 'Choose observation endpoint' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop observing' })).toBeEnabled());
  await fireEvent.click(screen.getByRole('button', { name: 'Stop observing' }));
  await waitFor(() => expect(screen.getByText('Observation stop status is unknown. You can retry stopping this observation connection.')).toBeVisible(), { timeout: 5000 });
  await fireEvent.click(screen.getByRole('button', { name: 'Choose observation endpoint' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop observing' })).toBeEnabled());
  finishOldStop({ success: true, observation: { ...observed, state: 'stopped', reason: 'observer-stopped' } });
  await Promise.resolve();
  expect(screen.getByRole('status', { name: 'Route observation status' })).toHaveTextContent('Observed');
  component.unmount();
  expect(localSecurityReview).toHaveBeenLastCalledWith({ action: 'stop-observing-route', lease: newerLease });
}, 8000);
it('labels selected-file deletion and retains observed attempts without claiming unlink', async () => {
  const deletion = {
    ...observed,
    snapshot: {
      ...observed.snapshot,
      route: 'mcp-review',
      selection: 'selected-file-delete',
      actionAttempts: 1,
      ownerInvocations: 1,
      ownerSettled: 0,
    },
  };
  let current = deletion;
  const localSecurityReview = vi.fn(async () => ({ success: true, observation: current, lease }));
  render(ActionObservation, { host: { localSecurityReview } });
  await fireEvent.click(screen.getByRole('button', { name: 'Choose observation endpoint' }));
  await waitFor(() =>
    expect(screen.getByRole('status', { name: 'Route observation status' })).toHaveTextContent(
      'Observed',
    ),
  );
  expect(screen.getByText('Selected file deletion')).toBeVisible();
  expect(screen.getByText('Selected file operations')).toBeVisible();
  expect(screen.getByText('File deletion attempts')).toBeVisible();
  expect(screen.getByText('Deletion calls settled / started')).toBeVisible();
  expect(screen.getByText('0 / 1')).toBeVisible();
  await fireEvent.click(screen.getByText('Observation details'));
  expect(
    screen.getByText(/settled deletion call does not prove a file was unlinked/),
  ).toBeVisible();
  expect(screen.queryByText('Single action')).toBeNull();
  expect(screen.queryByText('Action attempts')).toBeNull();
  current = {
    ...deletion,
    state: 'coverage-lost',
    reason: 'connection-closed',
    snapshot: { ...deletion.snapshot, sequence: 2, ownerSettled: 1 },
  };
  await waitFor(
    () =>
      expect(screen.getByRole('status', { name: 'Route observation status' })).toHaveTextContent(
        'Coverage lost',
      ),
    {
      timeout: 2500,
    },
  );
  expect(screen.getByText('1 / 1')).toBeVisible();
  expect(screen.getByText('Selected file deletion')).toBeVisible();
  expect(screen.queryByText(/file was removed/)).toBeNull();
  expect(
    parseRouteObservation({ ...deletion, snapshot: { ...deletion.snapshot, path: 'PRIVATE' } }),
  ).toBeNull();
  expect(
    parseRouteObservation({
      ...deletion,
      snapshot: { ...deletion.snapshot, selection: 'selected-file' },
    }),
  ).toBeNull();
});
it('stops observing without an execution request and excludes live attachment in preview', async () => {
  const localSecurityReview = vi.fn(async ({ action }) => ({
    success: true,
    lease,
    observation:
      action === 'stop-observing-route'
        ? { ...observed, state: 'stopped', reason: 'observer-stopped' }
        : observed,
  }));
  const component = render(ActionObservation, { host: { localSecurityReview } });
  await fireEvent.click(screen.getByRole('button', { name: 'Choose observation endpoint' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop observing' })).toBeEnabled());
  await fireEvent.click(screen.getByRole('button', { name: 'Stop observing' }));
  await waitFor(() =>
    expect(screen.getByRole('status', { name: 'Route observation status' })).toHaveTextContent(
      'Observation stopped',
    ),
  );
  expect(localSecurityReview).toHaveBeenLastCalledWith({ action: 'stop-observing-route', lease });
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
  finish({ success: true, observation: observed, lease });
  await waitFor(() =>
    expect(localSecurityReview).toHaveBeenLastCalledWith({ action: 'stop-observing-route', lease }),
  );
});

it('uses only its own lease to clean up a late attachment after another view connects', async () => {
  let finishOld;
  const newerLease = 'abcdef12-1234-4234-8234-123456789012';
  let currentLease = null;
  const localSecurityReview = vi.fn(({ action, lease: requested }) => {
    if (action === 'observe-route' && !finishOld)
      return new Promise((resolve) => {
        finishOld = resolve;
      });
    if (action === 'observe-route') {
      currentLease = newerLease;
      return Promise.resolve({ success: true, observation: observed, lease: newerLease });
    }
    if (action === 'stop-observing-route' && requested === currentLease) currentLease = null;
    return Promise.resolve({ success: requested === currentLease, observation: observed });
  });
  const old = render(ActionObservation, { host: { localSecurityReview } });
  await fireEvent.click(screen.getByRole('button', { name: 'Choose observation endpoint' }));
  old.unmount();
  const newer = render(ActionObservation, { host: { localSecurityReview } });
  await fireEvent.click(screen.getByRole('button', { name: 'Choose observation endpoint' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop observing' })).toBeEnabled());
  finishOld({ success: true, observation: observed, lease });
  await waitFor(() =>
    expect(localSecurityReview).toHaveBeenCalledWith({ action: 'stop-observing-route', lease }),
  );
  expect(currentLease).toBe(newerLease);
  newer.unmount();
  expect(currentLease).toBeNull();
});

it('does not stop a newer connection when an earlier attached view is destroyed', async () => {
  const newerLease = 'abcdef12-1234-4234-8234-123456789012';
  let currentLease = lease;
  const localSecurityReview = vi.fn(async ({ action, lease: requested }) => {
    if (action === 'observe-route') return { success: true, observation: observed, lease };
    if (action === 'stop-observing-route' && requested === currentLease) currentLease = null;
    return { success: true, observation: observed };
  });
  const old = render(ActionObservation, { host: { localSecurityReview } });
  await fireEvent.click(screen.getByRole('button', { name: 'Choose observation endpoint' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop observing' })).toBeEnabled());
  currentLease = newerLease;
  old.unmount();
  expect(localSecurityReview).toHaveBeenCalledWith({ action: 'stop-observing-route', lease });
  expect(currentLease).toBe(newerLease);
});

it('keeps separately named live regions stable through a pending and cancelled endpoint request', async () => {
  let finish;
  const localSecurityReview = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(ActionObservation, { host: { localSecurityReview } });
  const state = screen.getByRole('status', { name: 'Route observation status' });
  const feedback = screen.getByRole('status', { name: 'Observation request status' });
  expect(state).toHaveTextContent('No route observation selected');
  expect(feedback.textContent.trim()).toBe('');
  expect(feedback).toHaveAttribute('aria-live', 'polite');
  expect(feedback).toHaveAttribute('aria-atomic', 'true');
  const choose = screen.getByRole('button', { name: 'Choose observation endpoint' });
  await fireEvent.click(choose);
  expect(feedback).toHaveTextContent(
    'Choose the observation endpoint, then wait for the local connection…',
  );
  expect(state).toHaveTextContent('No route observation selected');
  expect(choose).toBeDisabled();
  finish({ success: false, cancelled: true });
  await waitFor(() =>
    expect(feedback).toHaveTextContent('Cancelled. Previous observation details are retained.'),
  );
  expect(screen.getByRole('status', { name: 'Observation request status' })).toBe(feedback);
  expect(screen.getByRole('status', { name: 'Route observation status' })).toBe(state);
  expect(choose).toBeEnabled();
  expect(localSecurityReview).toHaveBeenCalledExactlyOnceWith({ action: 'observe-route' });
});
