import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import CodexHookProfile from '../../../frontend/observatory/components/CodexHookProfile.svelte';
import type { Host } from '../../../frontend/observatory/runtime/host';
import { language } from '../../../frontend/observatory/runtime/i18n';

it('uses fixed path-free setup, launch and removal operations and states the coverage limits', async () => {
  const review = vi
    .fn()
    .mockResolvedValueOnce({ success: true, code: 'IDLE', canInstall: true })
    .mockResolvedValueOnce({ success: true, code: 'INSTALLED', canRemove: true, canOpen: true })
    .mockResolvedValueOnce({ success: true, code: 'LAUNCH_READY', canRemove: true, canOpen: true })
    .mockResolvedValueOnce({ success: true, code: 'REMOVED', canInstall: true });
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
  const review = vi
    .fn()
    .mockResolvedValue({ success: true, code: 'PRIVATE_CODE', detail: 'PRIVATE_PATH' });
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
    const review = vi.fn().mockResolvedValue({ success: true, code: 'UNSUPPORTED_PATH' });
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
