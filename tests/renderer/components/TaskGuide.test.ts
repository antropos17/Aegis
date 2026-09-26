import { expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import TaskGuide from '../../../frontend/observatory/components/TaskGuide.svelte';
import { setupGuideUrl } from '../../../frontend/observatory/runtime/task-guide';
import type { Host } from '../../../frontend/observatory/runtime/host';

it('opens the chosen workspace without performing a review or execution', async () => {
  const navigate = vi.fn();
  const host = { localSecurityReview: vi.fn(), openExternalUrl: vi.fn() };
  render(TaskGuide, { host: host as unknown as Host, navigate });
  await fireEvent.click(screen.getByRole('button', { name: /Check files before use/ }));
  expect(navigate).toHaveBeenCalledWith('local-security');
  await fireEvent.click(screen.getByRole('button', { name: /Check an action setup/ }));
  expect(navigate).toHaveBeenCalledWith('action-control');
  expect(host.localSecurityReview).not.toHaveBeenCalled();
  expect(host.openExternalUrl).not.toHaveBeenCalled();
});

it('requires confirmed host success and permits retry for fixed online guides', async () => {
  const openExternalUrl = vi
    .fn()
    .mockResolvedValueOnce({ success: false })
    .mockResolvedValueOnce({ success: true });
  render(TaskGuide, { host: { openExternalUrl } as unknown as Host, navigate: vi.fn() });
  await fireEvent.click(screen.getByText('Connect an agent to selected actions'));
  const button = screen.getByRole('button', { name: 'Open guide: Connect selected actions' });
  await fireEvent.click(button);
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Could not open the guide'),
  );
  await fireEvent.click(button);
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('Guide opened in your browser.'),
  );
  expect(openExternalUrl).toHaveBeenLastCalledWith(
    'https://github.com/antropos17/Aegis/blob/master/docs/ACTION-MCP-CONFIG.md',
  );
});

it('does not open external guides from the simulated preview', async () => {
  const openExternalUrl = vi.fn();
  render(TaskGuide, {
    host: { openExternalUrl } as unknown as Host,
    preview: true,
    navigate: vi.fn(),
  });
  await fireEvent.click(screen.getByText('Connect an agent to selected actions'));
  expect(
    screen.getByRole('button', { name: 'Open guide: Connect selected actions' }),
  ).toBeDisabled();
  expect(openExternalUrl).not.toHaveBeenCalled();
});

it('only opens the listed selected-file guide through the fixed documentation URL', async () => {
  const openExternalUrl = vi.fn().mockResolvedValue({ success: true });
  render(TaskGuide, { host: { openExternalUrl } as unknown as Host, navigate: vi.fn() });
  await fireEvent.click(screen.getByText('Connect an agent to selected actions'));
  await fireEvent.click(
    screen.getByRole('button', { name: 'Open guide: Delete one selected file' }),
  );
  expect(openExternalUrl).toHaveBeenCalledExactlyOnceWith(
    'https://github.com/antropos17/Aegis/blob/master/docs/ACTION-DELETE-FILE.md',
  );
  expect(setupGuideUrl('../unlisted.md')).toBeNull();
});
