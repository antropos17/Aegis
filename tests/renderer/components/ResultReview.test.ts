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

it('keeps page two and focus when an inactive filter reset receives keyboard activation', async () => {
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
  await fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
  const clear = screen.getByRole('button', { name: 'Clear filters' });
  expect(clear).toHaveAttribute('aria-disabled', 'true');
  clear.focus();
  await fireEvent.keyDown(clear, { key: 'Enter', code: 'Enter' });
  // jsdom has no native keyboard default; dispatch its keyboard-origin click explicitly.
  await fireEvent.click(clear, { detail: 0 });
  await fireEvent.keyUp(clear, { key: 'Enter', code: 'Enter' });
  expect(screen.getByText('2 / 2')).toBeVisible();
  expect(screen.getByRole('checkbox', { name: /file-20.txt/ })).toBeVisible();
  expect(clear).toHaveFocus();
});

it('rejects a retained refresh for a different comparison and preserves the local draft', async () => {
  const result = previewResultReview();
  const call = vi
    .fn()
    .mockResolvedValueOnce({ success: true, result })
    .mockResolvedValueOnce({
      success: true,
      result: { ...result, id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
    });
  render(ResultReview, { host: bridge(call) });
  await start();
  const deletion = await screen.findByRole('checkbox', { name: /obsolete.txt/ });
  await fireEvent.click(deletion);
  await fireEvent.click(screen.getByLabelText('I explicitly reviewed the selected deletions.'));
  await fireEvent.click(screen.getByRole('button', { name: 'Refresh retained comparison' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Previous results are retained.');
  expect(deletion).toBeChecked();
  expect(screen.getByLabelText('I explicitly reviewed the selected deletions.')).toBeChecked();
});

it('clears a local deletion draft when a refreshed comparison changes revision', async () => {
  const result = previewResultReview();
  const call = vi
    .fn()
    .mockResolvedValueOnce({ success: true, result })
    .mockResolvedValueOnce({
      success: true,
      result: { ...result, revision: 1 },
    });
  render(ResultReview, { host: bridge(call) });
  await start();
  const deletion = await screen.findByRole('checkbox', { name: /obsolete.txt/ });
  await fireEvent.click(deletion);
  await fireEvent.click(screen.getByLabelText('I explicitly reviewed the selected deletions.'));
  await fireEvent.click(screen.getByRole('button', { name: 'Refresh retained comparison' }));
  await waitFor(() => expect(deletion).not.toBeChecked());
  expect(screen.queryByLabelText('I explicitly reviewed the selected deletions.')).toBeNull();
});

it('filters without losing hidden selections and offers a clear reset for an empty search', async () => {
  render(ResultReview, {
    host: bridge(vi.fn().mockResolvedValue({ success: true, result: previewResultReview() })),
  });
  await start();
  await fireEvent.click(await screen.findByRole('checkbox', { name: /obsolete.txt/ }));
  await fireEvent.input(screen.getByRole('searchbox', { name: 'Find a changed file' }), {
    target: { value: 'README' },
  });
  expect(screen.queryByRole('checkbox', { name: /obsolete.txt/ })).toBeNull();
  expect(screen.getByRole('checkbox', { name: /README.md/ })).toBeVisible();
  expect(screen.getByText(/1 selected · 1 outside the current filter/)).toBeVisible();
  expect(screen.getByLabelText('I explicitly reviewed the selected deletions.')).toBeVisible();
  await fireEvent.input(screen.getByRole('searchbox', { name: 'Find a changed file' }), {
    target: { value: 'missing' },
  });
  expect(screen.getByText('No changes match these filters.')).toBeVisible();
  const clearFilters = screen.getByRole('button', { name: 'Clear filters' });
  clearFilters.focus();
  await fireEvent.click(clearFilters);
  expect(clearFilters).toHaveFocus();
  expect(clearFilters).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByRole('checkbox', { name: /obsolete.txt/ })).toBeChecked();
  await fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
  expect(screen.getByRole('checkbox', { name: /obsolete.txt/ })).not.toBeChecked();
});

it('clears only confirmed retained bytes, sends no native path and restores focus to import', async () => {
  const result = previewResultReview();
  const call = vi
    .fn()
    .mockResolvedValueOnce({ success: true, result })
    .mockResolvedValueOnce({ success: true, cleared: true, id: result.id });
  render(ResultReview, { host: bridge(call) });
  await start();
  const clear = await screen.findByRole('button', { name: 'Clear retained comparison' });
  clear.focus();
  await fireEvent.click(clear);
  expect(call).toHaveBeenLastCalledWith({ action: 'clear-result', id: result.id });
  expect(await screen.findByText('No imported comparison yet.')).toBeVisible();
  expect(screen.queryByRole('checkbox', { name: /obsolete.txt/ })).toBeNull();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Choose result and compare' })).toHaveFocus(),
  );
});

it.each([
  { success: false, error: 'result-review-expired' },
  { success: true, cleared: true, id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
  { success: true, id: previewResultReview().id },
])('retains comparison and draft after an unconfirmed clear (%j)', async (reply) => {
  const call = vi
    .fn()
    .mockResolvedValueOnce({ success: true, result: previewResultReview() })
    .mockResolvedValueOnce(reply);
  render(ResultReview, { host: bridge(call) });
  await start();
  const deletion = await screen.findByRole('checkbox', { name: /obsolete.txt/ });
  await fireEvent.click(deletion);
  await fireEvent.click(screen.getByRole('button', { name: 'Clear retained comparison' }));
  expect(deletion).toBeChecked();
  expect(screen.getByRole('alert')).not.toBeEmptyDOMElement();
});

it('preserves inspection and selection through an identical retained refresh', async () => {
  const result = previewResultReview();
  const call = vi.fn().mockResolvedValue({ success: true, result: structuredClone(result) });
  render(ResultReview, { host: bridge(call) });
  await start();
  const deletion = await screen.findByRole('checkbox', { name: /obsolete.txt/ });
  await fireEvent.click(deletion);
  await fireEvent.click(screen.getByLabelText('I explicitly reviewed the selected deletions.'));
  await fireEvent.input(screen.getByRole('searchbox', { name: 'Find a changed file' }), {
    target: { value: 'obsolete' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Refresh retained comparison' }));
  expect(deletion).toBeChecked();
  expect(screen.getByLabelText('I explicitly reviewed the selected deletions.')).toBeChecked();
  expect(screen.getByRole('searchbox', { name: 'Find a changed file' })).toHaveValue('obsolete');
});

it('labels expired desktop metadata without dropping displayed bytes or hiding expiry on later failures', async () => {
  const result = previewResultReview();
  const call = vi
    .fn()
    .mockResolvedValueOnce({ success: true, result })
    .mockResolvedValueOnce({ success: false, error: 'result-review-expired' })
    .mockResolvedValueOnce({ success: false, error: 'review-busy' })
    .mockResolvedValueOnce({ success: false, cancelled: true })
    .mockResolvedValueOnce({ success: true, result });
  render(ResultReview, { host: bridge(call) });
  await start();
  await fireEvent.click(await screen.findByRole('button', { name: 'Refresh retained comparison' }));
  expect(
    await screen.findByText('Display retained · desktop comparison unavailable'),
  ).toBeVisible();
  expect(screen.getByRole('checkbox', { name: /README.md/ })).toBeVisible();
  await fireEvent.click(screen.getByRole('button', { name: 'Refresh retained comparison' }));
  expect(screen.getByText('Display retained · desktop comparison unavailable')).toBeVisible();
  await start();
  expect(screen.getByText('Display retained · desktop comparison unavailable')).toBeVisible();
  await start();
  expect(await screen.findByText('Retained for this window · unreviewed')).toBeVisible();
});
