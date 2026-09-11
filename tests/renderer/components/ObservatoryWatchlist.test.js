import { expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import Watchlist from '../../../frontend/observatory/components/Watchlist.svelte';
const row = (signature, pid = null) => ({ signature, pid, reason: '', addedAt: 1 });
function bridge(initial = []) {
  let entries = initial;
  const host = {
    getAgentDatabase: async () => ({
      agents: [{ id: 'claude-code', displayName: 'Claude Code', names: ['claude.exe'] }],
    }),
    blocklistList: vi.fn(async () => structuredClone(entries)),
    blocklistAdd: vi.fn(async () => {
      const entry = row('claude-code');
      entries = [...entries, entry];
      return { success: true, entry };
    }),
    blocklistRemove: vi.fn(async (target) => {
      const before = entries.length;
      entries = entries.filter((r) => r.signature !== target.signature || r.pid !== target.pid);
      return { success: true, removed: entries.length !== before };
    }),
  };
  return host;
}
async function start(host = bridge()) {
  const mounted = render(Watchlist, { host, agent: 'Claude Code' });
  await screen.findByText('Watchlist is up to date.');
  return mounted;
}
it('loads automatically and keeps one add/remove control with persistent result feedback', async () => {
  const host = bridge();
  await start(host);
  const button = screen.getByRole('button', { name: 'Watch agent', exact: true });
  button.focus();
  await fireEvent.click(button);
  await screen.findByText('Claude Code added to the watchlist.');
  expect(screen.getByRole('button', { name: 'Remove agent' })).toBe(button);
  expect(button).toHaveFocus();
  await fireEvent.click(button);
  await screen.findByText('Claude Code · all processes removed from the watchlist.');
  expect(screen.getByRole('button', { name: 'Watch agent', exact: true })).toBe(button);
  expect(button).toHaveFocus();
  expect(host.blocklistRemove).toHaveBeenCalledWith({ signature: 'claude-code', pid: null });
});
it('combines repeated entries but preserves exact PID scopes and canonical aliases', async () => {
  const host = bridge([
    row('claude-code'),
    row('claude-code'),
    row('claude-code', 42),
    row('claude-code', 43),
    row('codex'),
    row('codex'),
  ]);
  const mounted = await start(host);
  expect(screen.queryByRole('button', { name: 'Watch agent', exact: true })).toBeNull();
  await fireEvent.click(screen.getByText('Other watchlist entries (3)'));
  const codex = screen.getByRole('button', { name: 'Remove codex · all processes' });
  codex.focus();
  await fireEvent.click(codex);
  await screen.findByText('codex · all processes removed from the watchlist.');
  expect(mounted.container.querySelectorAll('li')).toHaveLength(2);
  expect(screen.getByRole('button', { name: 'Remove agent' })).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Remove Claude Code · PID 42' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Remove Claude Code · PID 43' })).toBeInTheDocument();
});
it('shows pending work and prevents overlapping commands or reloads', async () => {
  const host = bridge();
  let release;
  host.blocklistAdd.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await start(host);
  const button = screen.getByRole('button', { name: 'Watch agent', exact: true });
  await fireEvent.click(button);
  await fireEvent.click(button);
  await fireEvent.click(screen.getByRole('button', { name: 'Reload watchlist' }));
  expect(host.blocklistAdd).toHaveBeenCalledOnce();
  expect(host.blocklistList).toHaveBeenCalledOnce();
  expect(screen.getByRole('status')).toHaveTextContent('Adding Claude Code…');
  expect(button).toHaveAttribute('aria-disabled', 'true');
  release({ success: false, error: 'Disk unavailable' });
  await screen.findByText('Change not saved. Disk unavailable');
  expect(button).toHaveAttribute('aria-disabled', 'false');
});
it('distinguishes a saved change from failed readback and requires reloading before another mutation', async () => {
  const host = bridge();
  await start(host);
  host.blocklistList.mockRejectedValueOnce(new Error('Read unavailable'));
  await fireEvent.click(screen.getByRole('button', { name: 'Watch agent', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Change saved, but the list could not be refreshed',
  );
  const button = screen.getByRole('button', { name: 'Watch agent', exact: true });
  await fireEvent.click(button);
  expect(host.blocklistAdd).toHaveBeenCalledOnce();
  await fireEvent.click(screen.getByRole('button', { name: 'Reload watchlist' }));
  await screen.findByRole('button', { name: 'Remove agent' });
  expect(screen.queryByRole('alert')).toBeNull();
});
it('shows a load failure instead of an empty list and allows a nonmutating retry', async () => {
  const host = bridge();
  host.blocklistList.mockResolvedValueOnce({ error: 'Unavailable' });
  render(Watchlist, { host, agent: 'Claude Code' });
  await screen.findByRole('alert');
  await fireEvent.click(screen.getByRole('button', { name: 'Watch agent', exact: true }));
  expect(host.blocklistAdd).not.toHaveBeenCalled();
  await fireEvent.click(screen.getByRole('button', { name: 'Reload watchlist' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Watch agent', exact: true })).toHaveAttribute(
      'aria-disabled',
      'false',
    ),
  );
});
