import { expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import GeminiHookProfile from '../../../frontend/observatory/components/GeminiHookProfile.svelte';
import type { Host } from '../../../frontend/observatory/runtime/host';

it('reviews separate setup and removal using fixed path-free actions', async () => {
  const review = vi
    .fn()
    .mockResolvedValueOnce({
      success: true,
      code: 'IDLE',
      available: true,
      canInstall: true,
      canRemove: false,
      canOpen: false,
    })
    .mockResolvedValueOnce({
      success: true,
      code: 'INSTALLED',
      available: true,
      canInstall: true,
      canRemove: true,
      canOpen: true,
    })
    .mockResolvedValueOnce({
      success: true,
      code: 'REMOVED',
      available: true,
      canInstall: true,
      canRemove: false,
      canOpen: true,
    });
  render(GeminiHookProfile, { host: { reviewGeminiHookProfile: review } as Host });
  await screen.findByText(/Setup has not been reviewed\./);
  await fireEvent.click(
    screen.getByRole('button', { name: 'Choose Gemini policy and review install' }),
  );
  await screen.findByText(
    /Separate Gemini profile configured\. Provider behavior is not verified\./,
  );
  await fireEvent.click(screen.getByRole('button', { name: 'Review Gemini hook removal' }));
  await screen.findByText(/The reviewed hook was removed from the separate profile\./);
  expect(review.mock.calls).toEqual([['status'], ['install'], ['remove']]);
  expect(screen.getByText(/Unmatched requests receive no AEGIS decision/)).toBeInTheDocument();
});

const ready = {
  success: true,
  code: 'IDLE',
  available: true,
  canInstall: true,
  canRemove: true,
  canOpen: true,
};
const action = (name: string) => screen.getByRole('button', { name });
const install = () => action('Choose Gemini policy and review install');
const remove = () => action('Review Gemini hook removal');
const open = () => action('Open profile folder');
const refresh = () => action('Refresh setup status');

it.each([
  ['install', 'Choose Gemini policy and review install'],
  ['remove', 'Review Gemini hook removal'],
])(
  'disables previously available actions after %s rejects and restores them only after fresh status',
  async (operation, label) => {
    const review = vi
      .fn()
      .mockResolvedValueOnce(ready)
      .mockRejectedValueOnce(Error('PRIVATE_REJECTION'))
      .mockResolvedValueOnce(ready);
    render(GeminiHookProfile, { host: { reviewGeminiHookProfile: review } as Host });
    await screen.findByText(/Setup has not been reviewed\./);
    expect(install()).toBeEnabled();
    expect(remove()).toBeEnabled();
    await fireEvent.click(action(label));
    expect(await screen.findByRole('alert')).toHaveTextContent('Setup status is unavailable.');
    expect(install()).toBeDisabled();
    expect(remove()).toBeDisabled();
    expect(open()).toBeDisabled();
    expect(document.body.textContent).not.toContain('PRIVATE_REJECTION');
    await fireEvent.click(refresh());
    await waitFor(() => expect(install()).toBeEnabled());
    expect(remove()).toBeEnabled();
    expect(review.mock.calls).toEqual([['status'], [operation], ['status']]);
  },
);

it.each([
  [
    'failure',
    {
      success: false,
      code: 'IDLE',
      available: true,
      canInstall: true,
      canRemove: true,
      canOpen: true,
      error: 'PRIVATE_FAILURE',
    },
  ],
  ['malformed', null],
  ['unknown code', { ...ready, code: 'PRIVATE_UNKNOWN' }],
  [
    'missing availability',
    { success: true, code: 'IDLE', canInstall: true, canRemove: true, canOpen: true },
  ],
  [
    'missing install flag',
    { success: true, code: 'IDLE', available: true, canRemove: true, canOpen: true },
  ],
  [
    'missing remove flag',
    { success: true, code: 'IDLE', available: true, canInstall: true, canOpen: true },
  ],
  [
    'missing open flag',
    { success: true, code: 'IDLE', available: true, canInstall: true, canRemove: true },
  ],
  ['non-boolean flag', { ...ready, canInstall: 'true' }],
])('fails closed for %s status and hides untrusted detail', async (_kind, bad) => {
  const review = vi
    .fn()
    .mockResolvedValueOnce(ready)
    .mockResolvedValueOnce(bad)
    .mockResolvedValueOnce(ready);
  render(GeminiHookProfile, { host: { reviewGeminiHookProfile: review } as Host });
  await screen.findByText(/Setup has not been reviewed\./);
  await fireEvent.click(refresh());
  expect(await screen.findByRole('alert')).toHaveTextContent('Setup status is unavailable.');
  expect(install()).toBeDisabled();
  expect(remove()).toBeDisabled();
  expect(open()).toBeDisabled();
  expect(document.body.textContent).not.toContain('PRIVATE_');
  await fireEvent.click(refresh());
  await waitFor(() => expect(install()).toBeEnabled());
});

it('blocks new changes for uncertain retained state while preserving explicit recovery access', async () => {
  const retained = {
    ...ready,
    code: 'RETAINED_UNKNOWN',
    canInstall: false,
    canRemove: false,
    canOpen: true,
  };
  const review = vi
    .fn()
    .mockResolvedValueOnce(ready)
    .mockResolvedValueOnce(retained)
    .mockResolvedValueOnce(ready);
  render(GeminiHookProfile, { host: { reviewGeminiHookProfile: review } as Host });
  await screen.findByText(/Setup has not been reviewed\./);
  await fireEvent.click(install());
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The write or native helper shutdown is uncertain.',
  );
  expect(install()).toBeDisabled();
  expect(remove()).toBeDisabled();
  expect(open()).toBeEnabled();
  await fireEvent.click(refresh());
  await waitFor(() => expect(review).toHaveBeenCalledTimes(3));
  expect(install()).toBeDisabled();
  expect(remove()).toBeDisabled();
  expect(open()).toBeEnabled();
});

it.each(['OPERATION_FAILED', 'INVALID_POLICY'])(
  'blocks writes for reported %s despite true flags and recovers on fresh status',
  async (code) => {
    const review = vi
      .fn()
      .mockResolvedValueOnce(ready)
      .mockResolvedValueOnce({ ...ready, code })
      .mockResolvedValueOnce(ready);
    render(GeminiHookProfile, { host: { reviewGeminiHookProfile: review } as Host });
    await screen.findByText(/Setup has not been reviewed\./);
    await fireEvent.click(install());
    await screen.findByRole('alert');
    expect(install()).toBeDisabled();
    expect(remove()).toBeDisabled();
    expect(open()).toBeEnabled();
    await fireEvent.click(refresh());
    await waitFor(() => expect(install()).toBeEnabled());
    expect(remove()).toBeEnabled();
  },
);

it.each([
  ['BUSY', true, true, true],
  ['UNAVAILABLE', false, false, false],
])(
  'keeps writes disabled and preserves confirmed open access for %s',
  async (code, available, canInstall, canRemove) => {
    const review = vi.fn().mockResolvedValue({
      success: true,
      code,
      available,
      canInstall,
      canRemove,
      canOpen: true,
    });
    render(GeminiHookProfile, { host: { reviewGeminiHookProfile: review } as Host });
    await waitFor(() => expect(open()).toBeEnabled());
    expect(install()).toBeDisabled();
    expect(remove()).toBeDisabled();
  },
);

it('ignores an old pending response after the host changes', async () => {
  let finish!: (value: unknown) => void;
  const oldReview = vi.fn().mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const nextReview = vi.fn().mockResolvedValue(ready);
  const view = render(GeminiHookProfile, { host: { reviewGeminiHookProfile: oldReview } as Host });
  await waitFor(() => expect(oldReview).toHaveBeenCalledOnce());
  await view.rerender({ host: { reviewGeminiHookProfile: nextReview } as Host });
  finish(ready);
  await waitFor(() => expect(refresh()).toBeEnabled());
  expect(install()).toBeDisabled();
  expect(remove()).toBeDisabled();
  expect(nextReview).not.toHaveBeenCalled();
  await fireEvent.click(refresh());
  await waitFor(() => expect(install()).toBeEnabled());
  expect(nextReview.mock.calls).toEqual([['status']]);
});

it('retains mutation uncertainty when the host changes during an in-flight install', async () => {
  let finish!: (value: unknown) => void;
  const oldReview = vi
    .fn()
    .mockResolvedValueOnce(ready)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  const nextReview = vi.fn().mockResolvedValue(ready);
  const view = render(GeminiHookProfile, { host: { reviewGeminiHookProfile: oldReview } as Host });
  await screen.findByText(/Setup has not been reviewed\./);
  await fireEvent.click(install());
  expect(
    screen.getByText('The last operation may have taken effect. Review retained files.'),
  ).toBeInTheDocument();
  await view.rerender({ host: { reviewGeminiHookProfile: nextReview } as Host });
  finish({ ...ready, code: 'INSTALLED' });
  await waitFor(() => expect(refresh()).toBeEnabled());
  expect(
    screen.getByText('The last operation may have taken effect. Review retained files.'),
  ).toBeInTheDocument();
  expect(install()).toBeDisabled();
  await fireEvent.click(refresh());
  await waitFor(() => expect(install()).toBeEnabled());
  expect(
    screen.getByText('The last operation may have taken effect. Review retained files.'),
  ).toBeInTheDocument();
  expect(nextReview.mock.calls).toEqual([['status']]);
});

it('blocks overlapping actions while pending and ignores a completion after unmount', async () => {
  let finish!: (value: unknown) => void;
  const review = vi
    .fn()
    .mockResolvedValueOnce(ready)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  const old = render(GeminiHookProfile, { host: { reviewGeminiHookProfile: review } as Host });
  await screen.findByText(/Setup has not been reviewed\./);
  await fireEvent.click(install());
  expect(screen.getByRole('button', { name: 'Preparing native review…' })).toBeDisabled();
  expect(remove()).toBeDisabled();
  expect(refresh()).toBeDisabled();
  await fireEvent.click(remove());
  expect(review.mock.calls).toEqual([['status'], ['install']]);
  old.unmount();
  const next = vi.fn().mockResolvedValue({ ...ready, code: 'REMOVED' });
  render(GeminiHookProfile, { host: { reviewGeminiHookProfile: next } as Host });
  await screen.findByText(/The reviewed hook was removed from the separate profile\./);
  finish({ ...ready, code: 'INSTALLED', detail: 'PRIVATE_LATE' });
  await Promise.resolve();
  expect(
    screen.queryByText(/Separate Gemini profile configured\. Provider behavior is not verified\./),
  ).toBeNull();
  expect(document.body.textContent).not.toContain('PRIVATE_LATE');
});

it('discards unknown backend text and keeps preview inert', async () => {
  const review = vi.fn().mockResolvedValue({ success: true, code: 'SECRET', detail: 'PRIVATE' });
  const view = render(GeminiHookProfile, { host: { reviewGeminiHookProfile: review } as Host });
  expect(await screen.findByRole('alert')).toHaveTextContent('Setup status is unavailable.');
  expect(screen.queryByText('PRIVATE')).toBeNull();
  view.unmount();
  review.mockClear();
  render(GeminiHookProfile, { host: { reviewGeminiHookProfile: review } as Host, preview: true });
  expect(
    screen.getByRole('button', { name: 'Choose Gemini policy and review install' }),
  ).toBeDisabled();
  expect(review).not.toHaveBeenCalled();
});
