import { expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ClaudeHookProfile from '../../../frontend/observatory/components/ClaudeHookProfile.svelte';
import type { Host } from '../../../frontend/observatory/runtime/host';

it('connects install and separate removal to fixed desktop operations and confirmed outcomes', async () => {
  const review = vi
    .fn()
    .mockResolvedValueOnce({ success: true, code: 'READY', canInstall: true })
    .mockResolvedValueOnce({ success: true, code: 'INSTALLED', canRemove: true, canOpen: true })
    .mockResolvedValueOnce({ success: true, code: 'REMOVED', canInstall: true });
  render(ClaudeHookProfile, { host: { reviewClaudeHookProfile: review } as Host });
  await screen.findByText('Prepared setup files are available for native review.');
  await fireEvent.click(screen.getByRole('button', { name: 'Choose policy and review install' }));
  await screen.findByText('Separate profile configured. Blocking is not verified.');
  await fireEvent.click(screen.getByRole('button', { name: 'Review removal' }));
  await screen.findByText('The reviewed owned hook was removed.');
  expect(review.mock.calls).toEqual([['status'], ['install'], ['remove']]);
});

it('discards arbitrary reply text and presents an unrecognized outcome as a fixed failure', async () => {
  const review = vi.fn().mockResolvedValue({
    success: true,
    code: 'PRIVATE_CANARY',
    error: 'SECRET_PATH',
    detail: 'SECRET_CONFIG',
  });
  render(ClaudeHookProfile, { host: { reviewClaudeHookProfile: review } as Host });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Profile review could not complete. Retained files are preserved.',
  );
  for (const value of ['PRIVATE_CANARY', 'SECRET_PATH', 'SECRET_CONFIG'])
    expect(screen.queryByText(value)).toBeNull();
});

it('keeps the simulated preview inert even with a host capability', () => {
  const review = vi.fn();
  render(ClaudeHookProfile, { host: { reviewClaudeHookProfile: review } as Host, preview: true });
  expect(screen.getByRole('button', { name: 'Choose policy and review install' })).toBeDisabled();
  expect(review).not.toHaveBeenCalled();
});
