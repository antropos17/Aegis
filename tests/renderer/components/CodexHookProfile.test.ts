import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import CodexHookProfile from '../../../frontend/observatory/components/CodexHookProfile.svelte';
import type { Host } from '../../../frontend/observatory/runtime/host';
import { language } from '../../../frontend/observatory/runtime/i18n';

function reply(code: string, overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    code,
    available: true,
    canInstall: false,
    canRemove: false,
    canOpen: false,
    ...overrides,
  };
}
const installButton = () =>
  screen.getByRole('button', { name: 'Choose Codex policy and review install' });
const removeButton = () => screen.getByRole('button', { name: 'Review Codex hook removal' });
const launchButton = () => screen.getByRole('button', { name: 'Review Codex terminal command' });
const openButton = () => screen.getByRole('button', { name: 'Open profile folder' });
const refreshButton = () => screen.getByRole('button', { name: 'Refresh setup status' });
const unknownOutcome =
  'The outcome of a previous profile change is unknown. Refresh can restore current controls but cannot confirm that change.';
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

it('uses fixed path-free setup, launch and removal operations and states the coverage limits', async () => {
  const review = vi
    .fn()
    .mockResolvedValueOnce(reply('IDLE', { canInstall: true }))
    .mockResolvedValueOnce(reply('INSTALLED', { canRemove: true, canOpen: true }))
    .mockResolvedValueOnce(reply('LAUNCH_READY', { canRemove: true, canOpen: true }))
    .mockResolvedValueOnce(reply('REMOVED', { canInstall: true }));
  render(CodexHookProfile, { host: { reviewCodexHookProfile: review } as Host });
  await screen.findByText('Setup has not been reviewed.');
  expect(screen.getByText(/write_stdin is not checked again/)).toHaveTextContent(
    'blocking are not verified',
  );
  expect(screen.getByText(/Review and trust the hook manually/)).toHaveTextContent(
    'AEGIS does not change trust',
  );
  expect(screen.getByText(/Codex cannot honor ask/)).toHaveTextContent('converts ask to deny');
  await fireEvent.click(
    screen.getByRole('button', { name: 'Choose Codex policy and review install' }),
  );
  await screen.findByText(
    'Separate Codex hook profile configured. Provider behavior is not verified.',
  );
  await fireEvent.click(screen.getByRole('button', { name: 'Review Codex terminal command' }));
  await screen.findByText('Reviewed terminal command copied. Run it from the exact policy folder.');
  await fireEvent.click(screen.getByRole('button', { name: 'Review Codex hook removal' }));
  await screen.findByText('The reviewed hook was removed from the separate profile.');
  expect(review.mock.calls).toEqual([['status'], ['install'], ['prepare-launch'], ['remove']]);
});

it('does not expose arbitrary backend output and keeps preview inert', async () => {
  const review = vi.fn().mockResolvedValue({
    ...reply('PRIVATE_CODE', { canInstall: true, canOpen: true }),
    detail: 'PRIVATE_PATH',
  });
  const first = render(CodexHookProfile, { host: { reviewCodexHookProfile: review } as Host });
  expect(await screen.findByRole('alert')).toHaveTextContent('Profile review could not complete.');
  expect(screen.queryByText('PRIVATE_PATH')).toBeNull();
  first.unmount();
  review.mockClear();
  render(CodexHookProfile, { host: { reviewCodexHookProfile: review } as Host, preview: true });
  expect(
    screen.getByRole('button', { name: 'Choose Codex policy and review install' }),
  ).toBeDisabled();
  expect(review).not.toHaveBeenCalled();
});

it('translates the selected executable guidance and dynamic unsupported-path result', async () => {
  language.set('pt');
  try {
    const review = vi.fn().mockResolvedValue(reply('UNSUPPORTED_PATH'));
    const view = render(CodexHookProfile, { host: { reviewCodexHookProfile: review } as Host });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Um caminho selecionado não pode ser representado com segurança',
    );
    expect(screen.getByText(/Selecione o codex.exe nativo durante a revisão/)).toBeTruthy();
    view.unmount();
  } finally {
    language.set('en');
  }
});

it.each([
  { code: 'PRIVATE_CODE' },
  { code: undefined },
  { code: null },
  { code: 4 },
  { available: undefined },
  { canInstall: 'yes' },
  { canRemove: null },
  { canOpen: 1 },
])(
  'rejects unknown or malformed status without enabling controls or exposing private content %#',
  async (change) => {
    const review = vi.fn().mockResolvedValue({
      ...reply('IDLE', { canInstall: true, canOpen: true }),
      ...change,
      detail: 'PRIVATE_PATH',
    });
    const view = render(CodexHookProfile, { host: { reviewCodexHookProfile: review } as Host });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Profile review could not complete.',
    );
    expect(installButton()).toBeDisabled();
    expect(removeButton()).toBeDisabled();
    expect(launchButton()).toBeDisabled();
    expect(openButton()).toBeDisabled();
    expect(view.container.textContent).not.toContain('PRIVATE');
  },
);

it('blocks contradictory retained-unknown capabilities while preserving folder access', async () => {
  const review = vi
    .fn()
    .mockResolvedValue(
      reply('RETAINED_UNKNOWN', { canInstall: true, canRemove: true, canOpen: true }),
    );
  render(CodexHookProfile, { host: { reviewCodexHookProfile: review } as Host });
  expect(
    await screen.findByText(
      'An uncertain native result is retained. Profile changes and launch review remain unavailable.',
    ),
  ).toHaveAttribute('role', 'alert');
  expect(installButton()).toBeDisabled();
  expect(removeButton()).toBeDisabled();
  expect(launchButton()).toBeDisabled();
  expect(openButton()).toBeEnabled();
});

it('allows opening an existing folder while assets are unavailable but does not offer launch', async () => {
  const review = vi
    .fn()
    .mockResolvedValue(reply('UNAVAILABLE', { available: false, canOpen: true }));
  render(CodexHookProfile, { host: { reviewCodexHookProfile: review } as Host });
  expect(await screen.findByRole('alert')).toHaveTextContent('unavailable');
  expect(openButton()).toBeEnabled();
  expect(installButton()).toBeDisabled();
  expect(removeButton()).toBeDisabled();
  expect(launchButton()).toBeDisabled();
});

it.each(['install', 'remove'] as const)(
  'retains a lost %s outcome after status refresh recovers capabilities',
  async (action) => {
    const review = vi
      .fn()
      .mockResolvedValueOnce(reply('IDLE', { canInstall: true, canRemove: true, canOpen: true }))
      .mockRejectedValueOnce(Error('PRIVATE_ERROR'))
      .mockResolvedValueOnce(reply('INSTALLED', { canRemove: true, canOpen: true }));
    const view = render(CodexHookProfile, { host: { reviewCodexHookProfile: review } as Host });
    await screen.findByText('Setup has not been reviewed.');
    await fireEvent.click(action === 'install' ? installButton() : removeButton());
    expect(await screen.findByText(unknownOutcome)).toHaveAttribute('role', 'alert');
    expect(launchButton()).toBeDisabled();
    await fireEvent.click(refreshButton());
    expect(
      await screen.findByText(
        'Last verified setup result was installation; the current profile has not been rechecked.',
      ),
    ).toBeVisible();
    expect(screen.getByText(unknownOutcome)).toBeVisible();
    expect(launchButton()).toBeEnabled();
    expect(view.container.textContent).not.toContain('PRIVATE_ERROR');
    expect(review.mock.calls).toEqual([['status'], [action], ['status']]);
  },
);

it('suppresses stale host A responses after A to B to A and uses the newest status', async () => {
  const old = deferred();
  const latest = deferred();
  const a = vi
    .fn()
    .mockImplementationOnce(() => old.promise)
    .mockImplementationOnce(() => latest.promise);
  const b = vi.fn().mockResolvedValue(reply('IDLE', { canInstall: true }));
  const hostA = { reviewCodexHookProfile: a } as Host;
  const hostB = { reviewCodexHookProfile: b } as Host;
  const { rerender } = render(CodexHookProfile, { host: hostA });
  await waitFor(() => expect(a).toHaveBeenCalledTimes(1));
  await rerender({ host: hostB });
  await screen.findByText('Setup has not been reviewed.');
  await rerender({ host: hostA });
  await waitFor(() => expect(a).toHaveBeenCalledTimes(2));
  old.resolve(reply('INSTALLED', { canRemove: true, canOpen: true }));
  await Promise.resolve();
  expect(launchButton()).toBeDisabled();
  latest.resolve(reply('IDLE', { canInstall: true }));
  await waitFor(() => expect(installButton()).toBeEnabled());
  expect(launchButton()).toBeDisabled();
});

it('suppresses a late response across preview A to B to A and refreshes the reconnected host', async () => {
  const old = deferred();
  const review = vi
    .fn()
    .mockImplementationOnce(() => old.promise)
    .mockResolvedValueOnce(reply('IDLE', { canInstall: true }));
  const host = { reviewCodexHookProfile: review } as Host;
  const { rerender } = render(CodexHookProfile, { host, preview: false });
  await waitFor(() => expect(review).toHaveBeenCalledTimes(1));
  await rerender({ host, preview: true });
  expect(installButton()).toBeDisabled();
  await rerender({ host, preview: false });
  await waitFor(() => expect(installButton()).toBeEnabled());
  old.resolve(reply('INSTALLED', { canRemove: true, canOpen: true }));
  await Promise.resolve();
  expect(launchButton()).toBeDisabled();
  expect(review.mock.calls).toEqual([['status'], ['status']]);
});

it('blocks overlapping writes and launch after a host change until a post-settlement status', async () => {
  const pending = deferred();
  const overlappingStatus = deferred();
  const first = vi
    .fn()
    .mockResolvedValueOnce(reply('IDLE', { canInstall: true }))
    .mockImplementationOnce(() => pending.promise);
  const second = vi
    .fn()
    .mockImplementationOnce(() => overlappingStatus.promise)
    .mockResolvedValue(reply('IDLE', { canInstall: true, canRemove: true, canOpen: true }));
  const { rerender } = render(CodexHookProfile, {
    host: { reviewCodexHookProfile: first } as Host,
  });
  await screen.findByText('Setup has not been reviewed.');
  await fireEvent.click(installButton());
  expect(refreshButton()).toBeDisabled();
  await rerender({ host: { reviewCodexHookProfile: second } as Host });
  await waitFor(() => expect(second).toHaveBeenCalledTimes(1));
  expect(screen.getByText(unknownOutcome)).toBeVisible();
  expect(installButton()).toBeDisabled();
  expect(removeButton()).toBeDisabled();
  expect(launchButton()).toBeDisabled();
  pending.resolve(reply('INSTALLED', { canRemove: true, canOpen: true }));
  overlappingStatus.resolve(reply('IDLE', { canInstall: true, canRemove: true, canOpen: true }));
  await Promise.resolve();
  expect(installButton()).toBeDisabled();
  expect(removeButton()).toBeDisabled();
  expect(launchButton()).toBeDisabled();
  await waitFor(() => expect(refreshButton()).toBeEnabled());
  await fireEvent.click(refreshButton());
  await waitFor(() => expect(installButton()).toBeEnabled());
  expect(removeButton()).toBeEnabled();
  expect(launchButton()).toBeEnabled();
  expect(screen.getByText(unknownOutcome)).toBeVisible();
});

it('checks a newly available host and ignores a response after unmount and remount', async () => {
  const old = deferred();
  const oldReview = vi.fn().mockImplementation(() => old.promise);
  const { rerender, unmount } = render(CodexHookProfile, { host: null });
  expect(refreshButton()).toBeDisabled();
  await rerender({ host: { reviewCodexHookProfile: oldReview } as Host });
  await waitFor(() => expect(oldReview).toHaveBeenCalledTimes(1));
  unmount();
  const current = vi.fn().mockResolvedValue(reply('IDLE', { canInstall: true }));
  render(CodexHookProfile, { host: { reviewCodexHookProfile: current } as Host });
  await waitFor(() => expect(installButton()).toBeEnabled());
  old.resolve(reply('INSTALLED', { canRemove: true, canOpen: true }));
  await Promise.resolve();
  expect(launchButton()).toBeDisabled();
  expect(installButton()).toBeEnabled();
});

it.each([
  { success: false, error: 'PRIVATE_ERROR' },
  { ...reply('INSTALLED', { canRemove: true, canOpen: true }), canOpen: 'PRIVATE_PATH' },
])('retains uncertainty when an install response is unsuccessful or malformed %#', async (lost) => {
  const review = vi
    .fn()
    .mockResolvedValueOnce(reply('IDLE', { canInstall: true }))
    .mockResolvedValueOnce(lost)
    .mockResolvedValueOnce(reply('REMOVED', { canInstall: true }));
  const view = render(CodexHookProfile, { host: { reviewCodexHookProfile: review } as Host });
  await screen.findByText('Setup has not been reviewed.');
  await fireEvent.click(installButton());
  expect(await screen.findByText(unknownOutcome)).toBeVisible();
  await fireEvent.click(refreshButton());
  expect(
    await screen.findByText(
      'Last verified setup result was removal; the current profile has not been rechecked.',
    ),
  ).toBeVisible();
  expect(installButton()).toBeEnabled();
  expect(screen.getByText(unknownOutcome)).toBeVisible();
  expect(view.container.textContent).not.toContain('PRIVATE');
});

it.each(['WRITE_UNCERTAIN', 'READBACK_FAILED', 'RETAINED_UNKNOWN'])(
  'keeps %s latched across malformed replies, a positive refresh and a host switch',
  async (code) => {
    const first = vi
      .fn()
      .mockResolvedValueOnce({
        ...reply(code, { canInstall: true, canRemove: true, canOpen: true }),
        available: 'bad',
      })
      .mockResolvedValueOnce(reply('IDLE', { canInstall: true, canRemove: true, canOpen: true }));
    const second = vi
      .fn()
      .mockResolvedValue(reply('IDLE', { canInstall: true, canRemove: true, canOpen: true }));
    const { rerender } = render(CodexHookProfile, {
      host: { reviewCodexHookProfile: first } as Host,
    });
    await screen.findByText('Profile review could not complete. Retained files are preserved.');
    await fireEvent.click(refreshButton());
    await screen.findByText('Setup has not been reviewed.');
    expect(installButton()).toBeDisabled();
    expect(removeButton()).toBeDisabled();
    expect(launchButton()).toBeDisabled();
    await rerender({ host: { reviewCodexHookProfile: second } as Host });
    await waitFor(() => expect(second).toHaveBeenCalledTimes(1));
    await screen.findByText('Setup has not been reviewed.');
    expect(installButton()).toBeDisabled();
    expect(removeButton()).toBeDisabled();
    expect(launchButton()).toBeDisabled();
  },
);

it.each([
  [
    'INSTALLED',
    'Last verified setup result was installation; the current profile has not been rechecked.',
  ],
  [
    'REMOVED',
    'Last verified setup result was removal; the current profile has not been rechecked.',
  ],
])('labels %s returned by open-profile as historical', async (code, message) => {
  const review = vi
    .fn()
    .mockResolvedValueOnce(reply('IDLE', { canOpen: true }))
    .mockResolvedValueOnce(reply(code, { canOpen: true }));
  render(CodexHookProfile, { host: { reviewCodexHookProfile: review } as Host });
  await screen.findByText('Setup has not been reviewed.');
  await fireEvent.click(openButton());
  expect(await screen.findByText(message)).toBeVisible();
  expect(review.mock.calls).toEqual([['status'], ['open-profile']]);
});

it.each([
  ['install', 'REMOVED'],
  ['remove', 'INSTALLED'],
] as const)(
  'treats %s with contradictory %s result as an unknown mutation outcome',
  async (action, code) => {
    const review = vi
      .fn()
      .mockResolvedValueOnce(reply('IDLE', { canInstall: true, canRemove: true, canOpen: true }))
      .mockResolvedValueOnce(reply(code, { canInstall: true, canRemove: true, canOpen: true }));
    render(CodexHookProfile, { host: { reviewCodexHookProfile: review } as Host });
    await screen.findByText('Setup has not been reviewed.');
    await fireEvent.click(action === 'install' ? installButton() : removeButton());
    expect(await screen.findByText(unknownOutcome)).toBeVisible();
    expect(installButton()).toBeDisabled();
    expect(removeButton()).toBeDisabled();
    expect(launchButton()).toBeDisabled();
  },
);

it('keeps mutations blocked through preview changes until settlement and a fresh status', async () => {
  const pending = deferred();
  const review = vi
    .fn()
    .mockResolvedValueOnce(reply('IDLE', { canInstall: true }))
    .mockImplementationOnce(() => pending.promise)
    .mockResolvedValue(reply('IDLE', { canInstall: true, canRemove: true, canOpen: true }));
  const host = { reviewCodexHookProfile: review } as Host;
  const { rerender } = render(CodexHookProfile, { host, preview: false });
  await screen.findByText('Setup has not been reviewed.');
  await fireEvent.click(installButton());
  await rerender({ host, preview: true });
  await rerender({ host, preview: false });
  expect(installButton()).toBeDisabled();
  expect(removeButton()).toBeDisabled();
  expect(launchButton()).toBeDisabled();
  pending.resolve(reply('INSTALLED', { canRemove: true, canOpen: true }));
  await waitFor(() => expect(refreshButton()).toBeEnabled());
  expect(installButton()).toBeDisabled();
  await fireEvent.click(refreshButton());
  await waitFor(() => expect(installButton()).toBeEnabled());
  expect(screen.getByText(unknownOutcome)).toBeVisible();
});

it('preserves an unresolved mutation when remounting with the same host', async () => {
  const pending = deferred();
  const review = vi
    .fn()
    .mockResolvedValueOnce(reply('IDLE', { canInstall: true }))
    .mockImplementationOnce(() => pending.promise)
    .mockResolvedValue(reply('IDLE', { canInstall: true, canRemove: true, canOpen: true }));
  const host = { reviewCodexHookProfile: review } as Host;
  const first = render(CodexHookProfile, { host });
  await screen.findByText('Setup has not been reviewed.');
  await fireEvent.click(installButton());
  first.unmount();
  render(CodexHookProfile, { host });
  expect(installButton()).toBeDisabled();
  expect(removeButton()).toBeDisabled();
  expect(launchButton()).toBeDisabled();
  pending.resolve(reply('INSTALLED', { canRemove: true, canOpen: true }));
  await waitFor(() => expect(refreshButton()).toBeEnabled());
  expect(installButton()).toBeDisabled();
  await fireEvent.click(refreshButton());
  await waitFor(() => expect(installButton()).toBeEnabled());
  expect(screen.getByText(unknownOutcome)).toBeVisible();
});

it('retains native uncertainty on remount using the same host despite a positive status', async () => {
  const review = vi
    .fn()
    .mockResolvedValueOnce(reply('RETAINED_UNKNOWN', { canOpen: true }))
    .mockResolvedValueOnce(reply('IDLE', { canInstall: true, canRemove: true, canOpen: true }));
  const host = { reviewCodexHookProfile: review } as Host;
  const first = render(CodexHookProfile, { host });
  await screen.findByText(
    'An uncertain native result is retained. Profile changes and launch review remain unavailable.',
  );
  first.unmount();
  render(CodexHookProfile, { host });
  await screen.findByText('Setup has not been reviewed.');
  expect(
    screen.getByText(
      'An uncertain native result is retained. Profile changes and launch review remain unavailable.',
    ),
  ).toBeVisible();
  expect(installButton()).toBeDisabled();
  expect(removeButton()).toBeDisabled();
  expect(launchButton()).toBeDisabled();
});

it('invalidates each mounted component after another component removes the shared profile', async () => {
  const removal = deferred();
  const review = vi
    .fn()
    .mockResolvedValueOnce(reply('INSTALLED', { canRemove: true, canOpen: true }))
    .mockResolvedValueOnce(reply('INSTALLED', { canRemove: true, canOpen: true }))
    .mockImplementationOnce(() => removal.promise)
    .mockResolvedValueOnce(reply('REMOVED', { canInstall: true, canOpen: true }))
    .mockResolvedValueOnce(reply('REMOVED', { canInstall: true, canOpen: true }));
  const host = { reviewCodexHookProfile: review } as Host;
  const a = render(CodexHookProfile, { host });
  const b = render(CodexHookProfile, { host });
  const first = within(a.container);
  const second = within(b.container);
  const firstOpen = () => first.getByRole('button', { name: 'Open profile folder' });
  const firstLaunch = () => first.getByRole('button', { name: 'Review Codex terminal command' });
  await waitFor(() => expect(firstLaunch()).toBeEnabled());
  expect(firstOpen()).toBeEnabled();
  await waitFor(() =>
    expect(second.getByRole('button', { name: 'Review Codex hook removal' })).toBeEnabled(),
  );
  await fireEvent.click(second.getByRole('button', { name: 'Review Codex hook removal' }));
  expect(firstLaunch()).toBeDisabled();
  removal.resolve(reply('REMOVED', { canInstall: true }));
  await waitFor(() =>
    expect(
      second.getByText('The reviewed hook was removed from the separate profile.'),
    ).toBeVisible(),
  );
  expect(firstOpen()).toBeDisabled();
  expect(firstLaunch()).toBeDisabled();
  await fireEvent.click(second.getByRole('button', { name: 'Refresh setup status' }));
  await waitFor(() =>
    expect(second.getByRole('button', { name: 'Review Codex terminal command' })).toBeEnabled(),
  );
  expect(firstOpen()).toBeDisabled();
  expect(firstLaunch()).toBeDisabled();
  await fireEvent.click(first.getByRole('button', { name: 'Refresh setup status' }));
  await waitFor(() => expect(firstOpen()).toBeEnabled());
  expect(firstLaunch()).toBeEnabled();
  expect(review.mock.calls).toEqual([['status'], ['status'], ['remove'], ['status'], ['status']]);
});

it.each(['install', 'remove'] as const)(
  'treats %s returning IDLE as an unknown outcome requiring fresh status',
  async (action) => {
    const review = vi
      .fn()
      .mockResolvedValueOnce(reply('IDLE', { canInstall: true, canRemove: true, canOpen: true }))
      .mockResolvedValueOnce(reply('IDLE', { canInstall: true, canRemove: true, canOpen: true }))
      .mockResolvedValueOnce(reply('IDLE', { canInstall: true, canRemove: true, canOpen: true }));
    render(CodexHookProfile, { host: { reviewCodexHookProfile: review } as Host });
    await screen.findByText('Setup has not been reviewed.');
    await fireEvent.click(action === 'install' ? installButton() : removeButton());
    expect(await screen.findByText(unknownOutcome)).toBeVisible();
    expect(installButton()).toBeDisabled();
    expect(removeButton()).toBeDisabled();
    expect(launchButton()).toBeDisabled();
    await fireEvent.click(refreshButton());
    await waitFor(() => expect(installButton()).toBeEnabled());
    expect(screen.getByText(unknownOutcome)).toBeVisible();
  },
);

it('latches a retained code even when the host response is unsuccessful', async () => {
  const review = vi
    .fn()
    .mockResolvedValueOnce({
      ...reply('RETAINED_UNKNOWN', { canOpen: true }),
      success: false,
      error: 'PRIVATE_ERROR',
    })
    .mockResolvedValueOnce(reply('IDLE', { canInstall: true, canRemove: true, canOpen: true }));
  const view = render(CodexHookProfile, { host: { reviewCodexHookProfile: review } as Host });
  await screen.findByText(
    'An uncertain native result is retained. Profile changes and launch review remain unavailable.',
  );
  await fireEvent.click(refreshButton());
  await screen.findByText('Setup has not been reviewed.');
  expect(installButton()).toBeDisabled();
  expect(removeButton()).toBeDisabled();
  expect(launchButton()).toBeDisabled();
  expect(view.container.textContent).not.toContain('PRIVATE_ERROR');
});

it.each([
  [
    'Choose Codex policy and review install',
    'INSTALLED',
    'Separate Codex hook profile configured. Provider behavior is not verified.',
  ],
  [
    'Review Codex hook removal',
    'REMOVED',
    'The reviewed hook was removed from the separate profile.',
  ],
  [
    'Review Codex terminal command',
    'LAUNCH_READY',
    'Reviewed terminal command copied. Run it from the exact policy folder.',
  ],
] as const)(
  'does not leave stale %s success feedback after a second panel changes the profile',
  async (button, code, message) => {
    const removal = deferred();
    const ready = reply('IDLE', { canInstall: true, canRemove: true, canOpen: true });
    const review = vi
      .fn()
      .mockResolvedValueOnce(ready)
      .mockResolvedValueOnce(ready)
      .mockResolvedValueOnce({
        ...reply(code, { canInstall: true, canRemove: true, canOpen: true }),
        detail: 'PRIVATE_PATH',
      })
      .mockResolvedValueOnce(ready)
      .mockImplementationOnce(() => removal.promise);
    const host = { reviewCodexHookProfile: review } as Host;
    const a = render(CodexHookProfile, { host });
    const b = render(CodexHookProfile, { host });
    const first = within(a.container);
    const second = within(b.container);
    await waitFor(() => expect(first.getByRole('button', { name: button })).toBeEnabled());
    await fireEvent.click(first.getByRole('button', { name: button }));
    expect(await first.findByText(message)).toBeVisible();
    await fireEvent.click(second.getByRole('button', { name: 'Refresh setup status' }));
    await waitFor(() =>
      expect(second.getByRole('button', { name: 'Review Codex hook removal' })).toBeEnabled(),
    );
    await fireEvent.click(second.getByRole('button', { name: 'Review Codex hook removal' }));
    expect(
      first.getByText(
        'A previous profile operation is still running or has just finished. Refresh setup status again.',
      ),
    ).toBeVisible();
    removal.resolve(reply('REMOVED', { canInstall: true }));
    await waitFor(() =>
      expect(
        second.getByText('The reviewed hook was removed from the separate profile.'),
      ).toBeVisible(),
    );
    expect(first.queryByText(message)).toBeNull();
    expect(a.container.textContent).not.toContain('PRIVATE_PATH');
  },
);
