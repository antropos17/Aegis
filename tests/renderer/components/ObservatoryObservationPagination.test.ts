import { expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/svelte';
import ObservationTable from '../../../frontend/observatory/components/ObservationTable.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';

const rows = Array.from({ length: 65 }, (_, index) => ({
  file: '/fixture/file-' + index + '.txt',
  timestamp: 1000 + index,
  action: 'read',
}));

it('keeps incremental-load focus through full and final batches, and ignores the unavailable direction', async () => {
  const mounted = render(ObservationTable, {
    rows,
    telemetry: { ...emptyTelemetry(), ready: true },
    inspect: vi.fn(),
  });
  const next = within(
    mounted.container.querySelector('[data-feed-older]') as HTMLElement,
  ).getByRole('button', { name: 'Show older activity' });
  const table = within(mounted.container).getByRole('table') as HTMLTableElement;
  expect(table.tBodies[0].rows).toHaveLength(30);
  next.focus();
  await fireEvent.click(next);
  expect(next).toHaveFocus();
  expect(table.tBodies[0].rows).toHaveLength(60);
  await fireEvent.click(next);
  expect(next).toHaveFocus();
  expect(next).toHaveAttribute('aria-disabled', 'true');
  expect(table.tBodies[0].rows).toHaveLength(65);
  await fireEvent.click(next);
  expect(next).toHaveFocus();
  expect(table.tBodies[0].rows).toHaveLength(65);
});

it('resets the loaded batch when filters change and keeps the stable control for empty results', async () => {
  const props = {
    rows,
    telemetry: { ...emptyTelemetry(), ready: true },
    inspect: vi.fn(),
    resetKey: 'all',
  };
  const { rerender, container } = render(ObservationTable, props);
  const older = within(container.querySelector('[data-feed-older]') as HTMLElement).getByRole(
    'button',
    {
      name: 'Show older activity',
    },
  );
  const table = within(container).getByRole('table') as HTMLTableElement;
  await fireEvent.click(older);
  await act(() => older.focus());
  await rerender({ ...props, rows: [], resetKey: 'empty' });
  expect(screen.getByText('No records match these filters.')).toBeVisible();
  expect(older).toHaveFocus();
  expect(older).toHaveAttribute('aria-disabled', 'true');
  await fireEvent.click(older);
  await rerender({ ...props, resetKey: 'restored' });
  expect(table.tBodies[0].rows).toHaveLength(30);
  expect(older).toHaveFocus();
});
