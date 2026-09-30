import { expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import ResultReview from '../../../frontend/observatory/components/ResultReview.svelte';
import { previewResultReview } from '../../../frontend/observatory/demo/result-review';
import { importedResultReview } from '../../../frontend/observatory/runtime/result-review';
import type { Host } from '../../../frontend/observatory/runtime/host';
const bridge = (call: ReturnType<typeof vi.fn>) => ({ localSecurityReview: call }) as Host;
const start = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Choose result and compare' }));

it('makes no mount request and shows absent capability without granting launch or export', () => {
  render(ResultReview, { host: null });
  expect(screen.getByRole('button', { name: 'Choose result and compare' })).toBeDisabled();
  expect(screen.getByText('No imported comparison yet.')).toBeVisible();
});

it('does not imply equal content from empty incomplete imported snapshots', async () => {
  const value = previewResultReview();
  const result = {
    ...value,
    comparison: {
      ...value.comparison,
      complete: false,
      originalState: 'incomplete-unknown',
      changes: [],
    },
  };
  render(ResultReview, { host: bridge(vi.fn().mockResolvedValue({ success: true, result })) });
  await start();
  expect(await screen.findByText('Incomplete snapshots · changes unknown')).toBeVisible();
  expect(screen.queryByText('No differing content in the imported snapshots.')).toBeNull();
  expect(screen.getByText('Changes cannot be determined from incomplete snapshots.')).toBeVisible();
});

it('sends only native selection options, retains uncertainty and renders captured HTML as text', async () => {
  const call = vi.fn().mockResolvedValue({ success: true, result: previewResultReview() });
  const { container } = render(ResultReview, { host: bridge(call) });
  expect(call).not.toHaveBeenCalled();
  await start();
  expect(call).toHaveBeenCalledExactlyOnceWith({ action: 'review-result' });
  expect(await screen.findByText('Stop unconfirmed')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Launch unavailable' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Project export unavailable' })).toBeDisabled();
  await fireEvent.click(screen.getAllByText('Inspect captured content')[0]);
  expect(container.querySelector('.previews script')).toBeNull();
  expect(container.querySelector('.previews')?.textContent).toContain('<script>example</script>');
  expect(container.querySelector('.previews')?.textContent).toContain('[U+001B] [U+202E]');
  expect(screen.getByText('Complete imported snapshots · originals unverified')).toBeVisible();
});

it('retains comparison and deletion draft after cancelled or failed native selection', async () => {
  const call = vi
    .fn()
    .mockResolvedValueOnce({ success: true, result: previewResultReview() })
    .mockResolvedValueOnce({ success: false, cancelled: true })
    .mockResolvedValueOnce({ success: false, error: 'PRIVATE_PATH' });
  render(ResultReview, { host: bridge(call) });
  await start();
  const checkbox = await screen.findByRole('checkbox', { name: /obsolete.txt/ });
  await fireEvent.click(checkbox);
  await fireEvent.click(screen.getByLabelText('I explicitly reviewed the selected deletions.'));
  await start();
  expect(await screen.findByText('Cancelled. Previous results are retained.')).toBeVisible();
  expect(checkbox).toBeChecked();
  expect(screen.getByLabelText('I explicitly reviewed the selected deletions.')).toBeChecked();
  await start();
  expect(await screen.findByRole('alert')).toHaveTextContent('Previous results are retained.');
  expect(screen.queryByText('PRIVATE_PATH')).toBeNull();
  expect(checkbox).toBeChecked();
});

it('uses only the retained opaque id for status and ignores completion after destruction', async () => {
  let finish: (value: unknown) => void = () => {};
  const call = vi
    .fn()
    .mockResolvedValueOnce({ success: true, result: previewResultReview() })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  const view = render(ResultReview, { host: bridge(call) });
  await start();
  await fireEvent.click(await screen.findByRole('button', { name: 'Refresh retained comparison' }));
  expect(call).toHaveBeenLastCalledWith({ action: 'result-status', id: previewResultReview().id });
  view.unmount();
  finish({ success: true, result: previewResultReview() });
  await waitFor(() => expect(screen.queryByText('README.md')).toBeNull());
});

it('rejects spoofed approval flags, terminal/bidi text, raw payload, and oversized preview metadata', () => {
  for (const alter of [
    (row: ReturnType<typeof previewResultReview>) => ({
      ...row,
      comparison: { ...row.comparison, launchAllowed: true },
    }),
    (row: ReturnType<typeof previewResultReview>) => ({
      ...row,
      comparison: { ...row.comparison, accepted: true },
    }),
    (row: ReturnType<typeof previewResultReview>) => ({
      ...row,
      comparison: {
        ...row.comparison,
        changes: [
          {
            ...row.comparison.changes[0],
            afterPreview: { state: 'text', text: '\u001b[31m\u202e' },
          },
        ],
      },
    }),
    (row: ReturnType<typeof previewResultReview>) => ({
      ...row,
      comparison: {
        ...row.comparison,
        changes: [{ ...row.comparison.changes[0], contentBase64: 'private' }],
      },
    }),
    (row: ReturnType<typeof previewResultReview>) => ({
      ...row,
      comparison: {
        ...row.comparison,
        changes: [
          { ...row.comparison.changes[0], afterPreview: { state: 'text', text: 'x'.repeat(2049) } },
        ],
      },
    }),
  ])
    expect(importedResultReview(alter(previewResultReview()))).toBeNull();
});

it('keeps keyboard focus at the pagination boundary and guards repeated activation', async () => {
  const result = previewResultReview();
  const item = result.comparison.changes[0];
  const large = {
    ...result,
    comparison: {
      ...result.comparison,
      changes: Array.from({ length: 21 }, (_, index) => ({
        ...item,
        id: index.toString(16).padStart(64, '0'),
        path: `file-${index}.txt`,
      })),
    },
  };
  render(ResultReview, {
    host: bridge(vi.fn().mockResolvedValue({ success: true, result: large })),
  });
  await start();
  const next = await screen.findByRole('button', { name: 'Next' });
  next.focus();
  await fireEvent.click(next);
  expect(next).toHaveFocus();
  expect(next).toHaveAttribute('aria-disabled', 'true');
  await fireEvent.click(next);
  expect(screen.getByText('2 / 2')).toBeVisible();
  expect(next).toHaveFocus();
});
