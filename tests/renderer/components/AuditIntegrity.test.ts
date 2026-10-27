import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import AuditIntegrity from '../../../frontend/observatory/components/AuditIntegrity.svelte';

it('checks only a selected day and describes the limited result', async () => {
  const check = vi.fn().mockResolvedValue({ status: 'consistent' });
  render(AuditIntegrity, { host: { reviewAuditIntegrity: check } });
  const date = screen.getByLabelText('Audit date');
  const button = screen.getByRole('button', { name: 'Check local chain' });
  expect(button).toBeDisabled();
  expect(screen.getByText(/does not prove completeness or external authenticity/)).toBeVisible();
  await fireEvent.input(date, { target: { value: '2026-10-27' } });
  await fireEvent.click(button);
  expect(await screen.findByText('Local chain consistent at check time.')).toBeVisible();
  expect(check).toHaveBeenCalledExactlyOnceWith('2026-10-27');
});

it('does not attach an old response to a changed date and reports unavailable without leaking errors', async () => {
  let resolve!: (value: unknown) => void;
  const check = vi
    .fn()
    .mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    )
    .mockRejectedValueOnce(Error('private path'));
  render(AuditIntegrity, { host: { reviewAuditIntegrity: check } });
  const date = screen.getByLabelText('Audit date');
  const button = screen.getByRole('button', { name: 'Check local chain' });
  await fireEvent.input(date, { target: { value: '2026-10-27' } });
  await fireEvent.click(button);
  expect(button).toBeDisabled();
  await fireEvent.input(date, { target: { value: '2026-10-26' } });
  resolve({ status: 'consistent' });
  await waitFor(() => expect(button).toBeEnabled());
  expect(screen.queryByText('Local chain consistent at check time.')).not.toBeInTheDocument();
  await fireEvent.click(button);
  expect(await screen.findByText(/Local chain check unavailable/)).toBeVisible();
  expect(screen.queryByText(/private path/)).not.toBeInTheDocument();
});

it('distinguishes inconsistent from unavailable', async () => {
  render(AuditIntegrity, {
    host: { reviewAuditIntegrity: vi.fn().mockResolvedValue({ status: 'inconsistent' }) },
  });
  await fireEvent.input(screen.getByLabelText('Audit date'), { target: { value: '2026-10-27' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Check local chain' }));
  expect(await screen.findByText('Local chain inconsistent. The cause is unknown.')).toBeVisible();
});
