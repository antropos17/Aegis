import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import Reports from '../../../frontend/observatory/components/Reports.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';

it('jumps between audit tasks without rereading or losing mounted history filters', async () => {
  const host = {
    getAuditEntriesBefore: vi.fn(async () => [
      {
        eventId: 'retained-1',
        timestamp: '2026-10-06T07:00:00.000Z',
        type: 'file-access',
        file: 'X:/fixture/retained-observation.md',
        agent: 'Codex',
        action: 'read',
      },
    ]),
    getAuditStats: vi.fn(async () => {
      throw new Error('Delivery read unavailable');
    }),
  };
  render(Reports, {
    host,
    telemetry: { ...emptyTelemetry(), ready: true },
    audit: true,
    inspect: vi.fn(),
    navigate: vi.fn(),
  });
  await screen.findByText('1 audit entries loaded');
  const search = screen.getByRole('searchbox', { name: 'Search audit entries' });
  const grouping = screen.getByRole('combobox', { name: 'Audit grouping' });
  await fireEvent.input(search, { target: { value: 'retained-observation' } });
  await fireEvent.change(grouping, { target: { value: 'none' } });

  await fireEvent.click(screen.getByRole('button', { name: 'Check delivery counters' }));
  const deliveryTab = screen.getByRole('tab', { name: 'Delivery' });
  await waitFor(() => expect(deliveryTab).toHaveFocus());
  expect(deliveryTab).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('heading', { name: 'Audit history and delivery' })).toBeVisible();
  expect(screen.getByText('Delivery counters unavailable. Retry reading.')).toBeVisible();
  expect(screen.getByText('persisted entries').parentElement).toHaveTextContent('—');

  await fireEvent.click(screen.getByRole('button', { name: 'Review retained entries' }));
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Entries' })).toHaveFocus());
  expect(screen.getByRole('searchbox', { name: 'Search audit entries' })).toBe(search);
  expect(search).toHaveValue('retained-observation');
  expect(grouping).toHaveValue('none');
  expect(screen.getByText('X:/fixture/retained-observation.md')).toBeVisible();
  expect(screen.getByText(/1 of 1 loaded entries/)).toBeVisible();
  expect(host.getAuditEntriesBefore).toHaveBeenCalledTimes(1);
  expect(host.getAuditStats).toHaveBeenCalledTimes(1);
});

it('keeps focus in the next workspace if Audit is hidden before its deferred jump settles', async () => {
  const { container } = render(Reports, {
    host: {
      getAuditEntriesBefore: async () => [],
      getAuditStats: async () => ({}),
    },
    telemetry: { ...emptyTelemetry(), ready: true },
    audit: true,
    inspect: vi.fn(),
    navigate: vi.fn(),
  });
  await screen.findByText('0 audit entries loaded');
  const focusDelivery = vi.spyOn(screen.getByRole('tab', { name: 'Delivery' }), 'focus');
  const nextWorkspace = document.createElement('button');
  nextWorkspace.textContent = 'Next workspace';
  document.body.append(nextWorkspace);
  try {
    const navigation = fireEvent.click(
      screen.getByRole('button', { name: 'Check delivery counters' }),
    );
    container.hidden = true;
    nextWorkspace.focus();
    await navigation;
    await tick();
    expect(focusDelivery).not.toHaveBeenCalled();
    expect(nextWorkspace).toHaveFocus();
  } finally {
    nextWorkspace.remove();
  }
});
