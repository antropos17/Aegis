import { expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/svelte';
import App from '../../../frontend/observatory/App.svelte';

// Mounting the full Observatory under full-suite coverage can exceed Vitest's 5s default on CI.
it('shows live audit overflow and pending writes on every workspace without a healthy false alarm', async () => {
  const listeners = {};
  const health = { state: 'HEALTHY', populationReliable: true };
  const host = {
    getStats: async () => ({
      appHealth: health,
      auditDelivery: { droppedEntries: 0, bufferDepth: 1, writeFailed: false },
    }),
    getResourceUsage: async () => ({}),
    getFalsePositives: async () => [],
    getSettings: async () => ({}),
    getAppVersion: async () => 'test',
    getAuditStats: async () => ({}),
    getAuditEntriesBefore: async () => [],
  };
  for (const name of [
    'onScanBatch',
    'onStatsUpdate',
    'onFileAccess',
    'onNetworkUpdate',
    'onScanStatus',
    'onAgentResourceUsage',
    'onTokenCosts',
  ]) {
    host[name] = (callback) => {
      listeners[name] = callback;
      return () => delete listeners[name];
    };
  }

  render(App, { host });
  expect(
    await screen.findByRole('button', {
      name: /Audit delivery.*0 lost this session.*1 pending write/,
    }),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Audit records lost from the buffer/)).toBeNull();

  await act(() =>
    listeners.onStatsUpdate({
      appHealth: health,
      auditDelivery: { droppedEntries: 0, bufferDepth: 1, writeFailed: true },
    }),
  );
  expect(screen.getByRole('alert')).toHaveTextContent('The last audit write failed');
  expect(screen.queryByText(/Audit records lost from the buffer/)).toBeNull();

  await act(() =>
    listeners.onStatsUpdate({
      appHealth: health,
      auditDelivery: { droppedEntries: 2, bufferDepth: 3, writeFailed: true },
    }),
  );
  expect(
    screen.getByRole('button', { name: /Audit delivery.*2 lost this session.*3 pending write/ }),
  ).toHaveTextContent('Last write failed');
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Audit records lost from the buffer in this session: 2.',
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Records still pending disk write: 3.');

  await fireEvent.click(
    screen.getByRole('button', { name: /Audit delivery.*2 lost this session/ }),
  );
  expect(await screen.findByRole('region', { name: 'Delivery', exact: true })).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('Audit records lost from the buffer');

  await act(() =>
    listeners.onStatsUpdate({
      appHealth: health,
      auditDelivery: { droppedEntries: 2, bufferDepth: 0, writeFailed: false },
    }),
  );
  expect(
    screen.getByRole('button', { name: /Audit delivery.*2 lost this session.*0 pending write/ }),
  ).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Audit records lost from the buffer');
  expect(screen.getByRole('alert')).not.toHaveTextContent('last audit write failed');
}, 15_000);
