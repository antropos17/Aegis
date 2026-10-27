import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import Catalog from '../../../frontend/observatory/components/Catalog.svelte';

it.each(['success', 'failure'] as const)(
  'keeps the catalog editor open during a pending save and handles %s',
  async (outcome) => {
    let finish!: (value: { success: boolean }) => void;
    let fail!: (reason: Error) => void;
    const pending = new Promise<{ success: boolean }>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    const host = {
      getAgentDatabase: vi.fn(async () => ({ agents: [] })),
      getCustomAgents: vi.fn(async () => [
        { id: 'agent', displayName: 'Original agent', names: ['agent.exe'] },
      ]),
      saveCustomAgents: vi.fn(() => pending),
    };
    render(Catalog, { host, inspect: vi.fn() });
    await screen.findByText('Original agent');
    await fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit custom agent' });
    await fireEvent.input(within(dialog).getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Changed agent' },
    });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Save agent' }));
    await waitFor(() => expect(host.saveCustomAgents).toHaveBeenCalledTimes(1));

    await fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(dialog).toBeVisible();
    expect(dialog).toHaveAttribute('aria-busy', 'true');
    expect(within(dialog).getByText('Saving catalog changes…')).toHaveAttribute('role', 'status');
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Close dialog' }));
    expect(dialog).toBeVisible();
    const cancel = new Event('cancel', { cancelable: true });
    await fireEvent(dialog, cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(dialog).toBeVisible();

    if (outcome === 'success') {
      finish({ success: true });
      await waitFor(() => expect(dialog.isConnected).toBe(false));
    } else {
      fail(new Error('Save rejected'));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Save rejected');
      expect(dialog).toBeVisible();
      expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue('Changed agent');
      await fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(dialog.isConnected).toBe(false));
    }
    expect(host.saveCustomAgents).toHaveBeenCalledTimes(1);
  },
);

it('keeps the editor open through readback and reports a failed refresh after a confirmed save', async () => {
  let failReadback!: (reason: Error) => void;
  const readback = new Promise<{ agents: never[] }>((_, reject) => {
    failReadback = reject;
  });
  const host = {
    getAgentDatabase: vi.fn().mockResolvedValueOnce({ agents: [] }).mockReturnValueOnce(readback),
    getCustomAgents: vi.fn(async () => [
      { id: 'agent', displayName: 'Original agent', names: ['agent.exe'] },
    ]),
    saveCustomAgents: vi.fn(async () => ({ success: true })),
  };
  render(Catalog, { host, inspect: vi.fn() });
  await screen.findByText('Original agent');
  await fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  const dialog = screen.getByRole('dialog', { name: 'Edit custom agent' });
  await fireEvent.click(within(dialog).getByRole('button', { name: 'Save agent' }));
  await waitFor(() => expect(host.getAgentDatabase).toHaveBeenCalledTimes(2));
  expect(dialog).toHaveAttribute('aria-busy', 'true');
  await fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(dialog).toBeVisible();
  failReadback(new Error('Refresh unavailable'));
  await waitFor(() => expect(dialog.isConnected).toBe(false));
  expect(
    screen.getByText(
      'Catalog changes saved. Could not refresh the current catalog. Retry loading.',
    ),
  ).toBeVisible();
  expect(screen.getByRole('button', { name: 'Retry loading' })).toBeVisible();
  expect(host.saveCustomAgents).toHaveBeenCalledTimes(1);
});
