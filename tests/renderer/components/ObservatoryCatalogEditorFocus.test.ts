import { expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import Catalog from '../../../frontend/observatory/components/Catalog.svelte';
import type { RecordData } from '../../../frontend/observatory/runtime/host';

it.each(['Edit', 'Add agent'])(
  'returns focus to the connected %s opener on cancel',
  async (action) => {
    const host = {
      getAgentDatabase: vi.fn(async () => ({ agents: [] })),
      getCustomAgents: vi.fn(async () => [
        { id: 'focus-fixture', displayName: 'Existing agent', names: ['fixture.exe'] },
      ]),
      saveCustomAgents: vi.fn(),
    };
    render(Catalog, { host, inspect: vi.fn() });
    await screen.findByText('Existing agent');
    const opener = screen.getByRole('button', {
      name: action === 'Edit' ? /^Edit$/ : /^Add agent$/,
    });
    await act(() => opener.focus());
    await fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', {
      name: action === 'Edit' ? 'Edit custom agent' : 'Add custom agent',
    });
    await fireEvent.click(within(dialog).getByRole('button', { name: /^Cancel$/ }));
    await waitFor(() => expect(dialog.isConnected).toBe(false));
    expect(opener).toHaveFocus();
    expect(host.saveCustomAgents).not.toHaveBeenCalled();
  },
);

it.each([false, true])(
  'restores catalog search after a filtered edit unless focus moved elsewhere (moved: %s)',
  async (movedFocus) => {
    let custom: RecordData[] = [
      {
        id: 'focus-fixture',
        displayName: 'Old unique label',
        names: ['fixture.exe'],
        category: 'coding-assistant',
        riskProfile: 'low',
      },
    ];
    const host = {
      getAgentDatabase: vi.fn(async () => ({ agents: [] })),
      getCustomAgents: vi.fn(async () => custom),
      saveCustomAgents: vi.fn(async (next: RecordData[]) => {
        custom = next;
        return { success: true };
      }),
    };
    render(Catalog, { host, inspect: vi.fn() });
    await screen.findByText('Old unique label');
    const search = screen.getByRole('searchbox', { name: 'Search catalog' });
    await fireEvent.input(search, { target: { value: 'Old unique label' } });
    const opener = screen.getByRole('button', { name: 'Edit' });
    await act(() => opener.focus());
    await fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Edit custom agent' });
    await fireEvent.input(within(dialog).getByRole('textbox', { name: 'Name' }), {
      target: { value: 'New unique label' },
    });
    let finishReadback!: () => void;
    const readback = new Promise<void>((resolve) => {
      finishReadback = resolve;
    });
    host.getAgentDatabase.mockImplementationOnce(async () => {
      await readback;
      return { agents: [] };
    });
    const save = within(dialog).getByRole('button', { name: 'Save agent' });
    await act(() => save.focus());
    await fireEvent.click(save);
    await waitFor(() => expect(opener.isConnected).toBe(false));
    expect(dialog.isConnected).toBe(true);
    const destination = screen.getByRole('combobox', { name: 'Catalog category' });
    if (movedFocus) await act(() => destination.focus());
    finishReadback();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Edit custom agent' })).toBeNull(),
    );
    expect(host.saveCustomAgents).toHaveBeenCalledTimes(1);
    expect(custom[0].displayName).toBe('New unique label');
    expect(opener.isConnected).toBe(false);
    expect(movedFocus ? destination : search).toHaveFocus();
  },
);
