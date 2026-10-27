import { expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import GeminiHookProfile from '../../../frontend/observatory/components/GeminiHookProfile.svelte';
import type { Host } from '../../../frontend/observatory/runtime/host';

it('reviews separate setup and removal using fixed path-free actions', async () => {
  const review = vi
    .fn()
    .mockResolvedValueOnce({ success: true, code: 'IDLE', canInstall: true })
    .mockResolvedValueOnce({ success: true, code: 'INSTALLED', canRemove: true, canOpen: true })
    .mockResolvedValueOnce({ success: true, code: 'REMOVED', canInstall: true });
  render(GeminiHookProfile, { host: { reviewGeminiHookProfile: review } as Host });
  await screen.findByText('Setup has not been reviewed.');
  await fireEvent.click(
    screen.getByRole('button', { name: 'Choose Gemini policy and review install' }),
  );
  await screen.findByText('Separate Gemini profile configured. Provider behavior is not verified.');
  await fireEvent.click(screen.getByRole('button', { name: 'Review Gemini hook removal' }));
  await screen.findByText('The reviewed hook was removed from the separate profile.');
  expect(review.mock.calls).toEqual([['status'], ['install'], ['remove']]);
  expect(screen.getByText(/Unmatched requests receive no AEGIS decision/)).toBeInTheDocument();
});

it('discards unknown backend text and keeps preview inert', async () => {
  const review = vi.fn().mockResolvedValue({ success: true, code: 'SECRET', detail: 'PRIVATE' });
  const view = render(GeminiHookProfile, { host: { reviewGeminiHookProfile: review } as Host });
  expect(await screen.findByRole('alert')).toHaveTextContent('Profile review could not complete.');
  expect(screen.queryByText('PRIVATE')).toBeNull();
  view.unmount();
  review.mockClear();
  render(GeminiHookProfile, { host: { reviewGeminiHookProfile: review } as Host, preview: true });
  expect(
    screen.getByRole('button', { name: 'Choose Gemini policy and review install' }),
  ).toBeDisabled();
  expect(review).not.toHaveBeenCalled();
});
