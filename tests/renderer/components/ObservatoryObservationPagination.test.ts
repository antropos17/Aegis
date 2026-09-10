import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import ObservationTable from '../../../frontend/observatory/components/ObservationTable.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';

const rows = Array.from({ length: 65 }, (_, index) => ({
  file: '/fixture/file-' + index + '.txt',
  timestamp: 1000 + index,
  action: 'read',
}));

it('keeps pagination focus through full, final and first pages, and ignores unavailable directions', async () => {
  render(ObservationTable, {
    rows,
    telemetry: { ...emptyTelemetry(), ready: true },
    inspect: vi.fn(),
  });
  const pages = within(screen.getByRole('navigation', { name: 'Observation pages' }));
  const next = pages.getByRole('button', { name: 'Next' });
  const previous = pages.getByRole('button', { name: 'Previous' });
  const table = screen.getByRole('table');
  expect(within(table).getAllByRole('row')).toHaveLength(31);
  next.focus();
  await fireEvent.click(next);
  expect(next).toHaveFocus();
  expect(screen.getByRole('navigation')).toHaveTextContent('31\u201360 of 65');
  await fireEvent.click(next);
  expect(next).toHaveFocus();
  expect(next).toHaveAttribute('aria-disabled', 'true');
  expect(within(table).getAllByRole('row')).toHaveLength(6);
  await fireEvent.click(next);
  expect(screen.getByRole('navigation')).toHaveTextContent('61\u201365 of 65');
  previous.focus();
  await fireEvent.click(previous);
  await fireEvent.click(previous);
  expect(previous).toHaveFocus();
  expect(previous).toHaveAttribute('aria-disabled', 'true');
  await fireEvent.click(previous);
  expect(screen.getByRole('navigation')).toHaveTextContent('1\u201330 of 65');
});

it('resets to the first page when filters change and handles an empty result', async () => {
  const props = {
    rows,
    telemetry: { ...emptyTelemetry(), ready: true },
    inspect: vi.fn(),
    resetKey: 'all',
  };
  const { rerender } = render(ObservationTable, props);
  await fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await rerender({ ...props, rows: [], resetKey: 'empty' });
  expect(screen.getByRole('navigation')).toHaveTextContent('0\u20130 of 0');
  expect(screen.getByText('No records match these filters.')).toBeVisible();
  for (const name of ['Previous', 'Next']) {
    const button = screen.getByRole('button', { name });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await fireEvent.click(button);
  }
  await rerender({ ...props, resetKey: 'restored' });
  expect(screen.getByRole('navigation')).toHaveTextContent('1\u201330 of 65');
});
