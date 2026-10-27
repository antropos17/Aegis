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
  await fireEvent.click(screen.getByRole('button', { name: 'Review AEGIS hook removal' }));
  await screen.findByText('The reviewed owned hook was removed.');
  expect(review.mock.calls).toEqual([['status'], ['install'], ['remove']]);
});

it('offers a fresh removal review after restart without sending paths, history or ownership claims', async () => {
  const review = vi
    .fn()
    .mockResolvedValueOnce({
      success: true,
      code: 'PROFILE_REVIEW_AVAILABLE',
      canRemove: false,
      canReviewExisting: true,
      canOpen: true,
    })
    .mockResolvedValueOnce({ success: true, code: 'OBSERVED_REMOVED', canInstall: true });
  render(ClaudeHookProfile, { host: { reviewClaudeHookProfile: review } as Host });
  await screen.findByText(
    'An existing separate profile is available for a fresh targeted removal review.',
  );
  await fireEvent.click(screen.getByRole('button', { name: 'Review AEGIS hook removal' }));
  await screen.findByText(
    'The recognized AEGIS hook was removed after a fresh review. Unrelated settings were preserved.',
  );
  expect(review.mock.calls).toEqual([['status'], ['remove']]);
  expect(screen.getByRole('button', { name: 'Choose policy and review install' })).toBeEnabled();
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

it('shows only fixed reported decisions and keeps sender, delivery and effect unverified', async () => {
  const review = vi.fn().mockResolvedValue({
    success: true,
    code: 'READY',
    canOpen: true,
    guardSession: {
      status: 'active',
      available: true,
      lossDetected: true,
      entries: [
        { decision: 'deny', reason: 'project-deny-sensitive', command: 'PRIVATE_COMMAND' },
        { decision: 'SECRET_DECISION', reason: 'generic' },
        { decision: 'allow', reason: 'project-deny-sensitive' },
      ],
      token: 'PRIVATE_TOKEN',
    },
  });
  render(ClaudeHookProfile, { host: { reviewClaudeHookProfile: review } as Host });
  await screen.findByText(
    'Session listening; delivery remains unknown. Refresh setup status to see recent reports.',
  );
  expect(screen.getByText('DENY: Declared sensitive filename · Effect unknown')).toBeVisible();
  expect(
    screen.getByText('Some reporting may have been lost or discarded; delivery remains unknown.'),
  ).toBeVisible();
  expect(screen.queryByText('PRIVATE_COMMAND')).toBeNull();
  expect(screen.queryByText('PRIVATE_TOKEN')).toBeNull();
  expect(screen.queryByText('SECRET_DECISION')).toBeNull();
  expect(screen.queryByText('ALLOW: Declared sensitive filename · Effect unknown')).toBeNull();
  expect(screen.getByRole('button', { name: 'Stop reporting' })).toBeEnabled();
});

it('explains the selected launch route and its unverified failure boundary', () => {
  render(ClaudeHookProfile, { host: null, preview: true });
  expect(screen.getByText(/copy the folder path from the Explorer address bar/)).toBeVisible();
  expect(screen.getByText(/Claude behavior when a hook is missing/)).toHaveTextContent(
    'has not been qualified',
  );
  expect(screen.getByText(/Other tools and launches without the profile/)).toBeVisible();
  expect(screen.getByText(/If Claude invokes the hook/)).toBeVisible();
  expect(screen.getByText(/claude --settings \$settings/)).toBeVisible();
  expect(screen.getByText('This direct route does not send decision reports to AEGIS.')).toBeVisible();
});
