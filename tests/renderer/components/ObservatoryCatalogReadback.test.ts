import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import Catalog from '../../../frontend/observatory/components/Catalog.svelte';
import type { RecordData } from '../../../frontend/observatory/runtime/host';
import { catalogReadPopulations } from '../../../frontend/observatory/runtime/catalog-read-state';

const bundled = { id: 'bundled', displayName: 'Bundled fixture', names: ['bundled.exe'] };
const original = {
  id: 'original',
  displayName: 'Original custom',
  names: ['original.exe'],
  category: 'cli-tool',
};
const savedNotice = 'Catalog changes saved. Could not refresh the current catalog. Retry loading.';

it.each([
  [{ success: false, error: 'Denied read' }, []],
  [null, []],
  [{ agents: {} }, []],
  [{ agents: [bundled] }, { success: false, error: 'Denied read' }],
  [{ agents: [bundled] }, {}],
])(
  'keeps failed catalog populations unknown and recovers through a read-only retry: %j',
  async (database, user) => {
    const host = {
      getAgentDatabase: vi
        .fn()
        .mockResolvedValueOnce(database)
        .mockResolvedValue({ agents: [bundled] }),
      getCustomAgents: vi.fn().mockResolvedValueOnce(user).mockResolvedValue([original]),
      saveCustomAgents: vi.fn(),
    };
    render(Catalog, { host, inspect: vi.fn() });
    await screen.findByText('Catalog reply is invalid');
    expect(screen.getByRole('button', { name: 'Add agent' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
    expect(screen.queryByText('No agents in the catalog')).not.toBeInTheDocument();
    expect(screen.queryByText('0 bundled · 0 custom')).not.toBeInTheDocument();
    expect(screen.queryByText('Bundled fixture')).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
    await screen.findByText('Original custom');
    expect(screen.getByText('Bundled fixture')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add agent' })).toBeEnabled();
    expect(host.saveCustomAgents).not.toHaveBeenCalled();
  },
);

it.each([{ database: { agents: [] } }, { database: [] }])(
  'admits a genuinely empty catalog reply: %j',
  async ({ database }) => {
    render(Catalog, {
      host: { getAgentDatabase: async () => database, getCustomAgents: async () => [] },
      inspect: vi.fn(),
    });
    await screen.findByText('No agents in the catalog');
    expect(screen.getByRole('button', { name: 'Add agent' })).toBeEnabled();
    expect(screen.getByText('0 bundled · 0 custom')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  },
);

function catalogHost() {
  let custom: RecordData[] = [original];
  const host = {
    getAgentDatabase: vi.fn().mockResolvedValue({ agents: [bundled] }),
    getCustomAgents: vi.fn().mockImplementation(async () => custom),
    saveCustomAgents: vi.fn(async (next: RecordData[]) => {
      custom = next;
      return { success: true };
    }),
    importAgentDatabase: vi.fn(),
  };
  render(Catalog, { host, inspect: vi.fn() });
  return host;
}

it('retains a confirmed edit and closes its editor after failed readback without resending the write', async () => {
  const host = catalogHost();
  const row = (await screen.findByText('Original custom')).closest('tr')!;
  const trigger = within(row).getByRole('button', { name: 'Edit' });
  trigger.focus();
  await fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'Edit custom agent' });
  await fireEvent.input(within(dialog).getByLabelText('Name'), {
    target: { value: 'Confirmed custom' },
  });
  host.getAgentDatabase.mockRejectedValueOnce(new Error('Readback unavailable'));
  await fireEvent.click(within(dialog).getByRole('button', { name: 'Save agent' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(trigger).toHaveFocus();
  expect(screen.getByText('Confirmed custom')).toBeInTheDocument();
  expect(screen.getByText(savedNotice)).toHaveAttribute('role', 'status');
  expect(host.saveCustomAgents).toHaveBeenCalledExactlyOnceWith([
    expect.objectContaining({
      id: 'original',
      displayName: 'Confirmed custom',
      names: ['original.exe'],
    }),
  ]);
  await fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
  await waitFor(() => expect(screen.queryByText(savedNotice)).not.toBeInTheDocument());
  expect(screen.getByText('Confirmed custom')).toBeInTheDocument();
  expect(host.saveCustomAgents).toHaveBeenCalledTimes(1);
});

it.each([{ reply: { success: false } }, { reply: [null] }])(
  'adopts confirmed imports but rejects both readback populations together and preserves active filters: %j',
  async ({ reply }) => {
    const host = catalogHost();
    await screen.findByText('Original custom');
    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search catalog' }), {
      target: { value: 'Imported' },
    });
    await fireEvent.change(screen.getByRole('combobox', { name: 'Catalog category' }), {
      target: { value: 'cli-tool' },
    });
    const incoming = {
      id: 'imported',
      displayName: 'Imported custom',
      names: ['imported.exe'],
      category: 'cli-tool',
    };
    host.importAgentDatabase.mockResolvedValue({ success: true, agents: [bundled, incoming] });
    host.getAgentDatabase.mockResolvedValueOnce({
      agents: [{ ...bundled, displayName: 'Unaccepted bundled' }],
    });
    host.getCustomAgents.mockResolvedValueOnce(reply);
    await fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await screen.findByText(savedNotice);
    expect(screen.getByText('Imported custom')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search catalog' })).toHaveValue('Imported');
    expect(screen.getByRole('combobox', { name: 'Catalog category' })).toHaveValue('cli-tool');
    expect(host.saveCustomAgents).toHaveBeenCalledExactlyOnceWith([original, incoming]);
    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search catalog' }), {
      target: { value: '' },
    });
    await fireEvent.change(screen.getByRole('combobox', { name: 'Catalog category' }), {
      target: { value: '' },
    });
    expect(screen.getByText('Bundled fixture')).toBeInTheDocument();
    expect(screen.queryByText('Unaccepted bundled')).not.toBeInTheDocument();
    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search catalog' }), {
      target: { value: 'Imported' },
    });
    await fireEvent.change(screen.getByRole('combobox', { name: 'Catalog category' }), {
      target: { value: 'cli-tool' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
    await waitFor(() => expect(screen.queryByText(savedNotice)).not.toBeInTheDocument());
    expect(screen.getByRole('searchbox', { name: 'Search catalog' })).toHaveValue('Imported');
    expect(screen.getByRole('combobox', { name: 'Catalog category' })).toHaveValue('cli-tool');
    expect(host.importAgentDatabase).toHaveBeenCalledTimes(1);
    expect(host.saveCustomAgents).toHaveBeenCalledTimes(1);
  },
);

it.each([null, [], 'invalid', 4, true].map((member) => ({ member })))(
  'rejects malformed members in either catalog population atomically: %j',
  ({ member }) => {
    expect(() => catalogReadPopulations({ agents: [member] }, [original])).toThrow(
      'Catalog reply is invalid',
    );
    expect(() => catalogReadPopulations({ agents: [bundled] }, [member])).toThrow(
      'Catalog reply is invalid',
    );
  },
);

it('renders scanner-compatible legacy catalog ID collisions without rewriting entries or moving filtered focus', async () => {
  const custom = [
    { ...original, id: bundled.id, displayName: 'Bundled-ID legacy' },
    { ...original, displayName: 'First legacy' },
    { ...original, displayName: 'Second legacy', names: ['later.exe'] },
  ];
  expect(catalogReadPopulations({ agents: [bundled] }, custom)).toEqual({
    base: [bundled],
    custom,
  });
  const inspect = vi.fn();
  render(Catalog, {
    host: {
      getAgentDatabase: async () => ({ agents: [bundled] }),
      getCustomAgents: async () => custom,
    },
    inspect,
  });
  await screen.findByText('Second legacy');
  expect(screen.getByText('First legacy')).toBeInTheDocument();
  expect(screen.getByText('Bundled-ID legacy')).toBeInTheDocument();
  expect(screen.getByText('1 bundled · 3 custom')).toBeInTheDocument();
  const row = screen.getByText('Second legacy').closest('tr')!;
  const details = within(row).getByRole('button', { name: 'Details' });
  details.focus();
  await fireEvent.input(screen.getByRole('searchbox', { name: 'Search catalog' }), {
    target: { value: 'Second legacy' },
  });
  expect(details).toHaveFocus();
  await fireEvent.click(details);
  expect(inspect).toHaveBeenCalledExactlyOnceWith(
    'Second legacy',
    expect.objectContaining({
      id: original.id,
      names: ['later.exe'],
      recognition: expect.objectContaining({ skippedById: true }),
    }),
  );
});

it('prevents a deferred retry from racing a later catalog mutation', async () => {
  const host = catalogHost();
  await screen.findByText('Original custom');
  const incoming = { id: 'imported', displayName: 'Imported custom', names: ['imported.exe'] };
  host.importAgentDatabase.mockResolvedValue({ success: true, agents: [incoming] });
  host.getAgentDatabase.mockRejectedValueOnce(new Error('Refresh unavailable'));
  await fireEvent.click(screen.getByRole('button', { name: 'Import' }));
  await screen.findByText(savedNotice);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled());
  let resolve!: (value: RecordData) => void;
  const pending = new Promise<RecordData>((yes) => (resolve = yes));
  host.getAgentDatabase.mockReturnValueOnce(pending);
  await fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
  await waitFor(() => expect(host.getAgentDatabase).toHaveBeenCalledTimes(3));
  const imports = host.importAgentDatabase.mock.calls.length;
  const writes = host.saveCustomAgents.mock.calls.length;
  await fireEvent.click(screen.getByRole('button', { name: 'Import' }));
  expect(host.importAgentDatabase).toHaveBeenCalledTimes(imports);
  expect(host.saveCustomAgents).toHaveBeenCalledTimes(writes);
  expect(screen.getByRole('button', { name: 'Add agent' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  for (const button of screen.getAllByRole('button', { name: /^(Edit|Delete)$/ }))
    expect(button).toBeDisabled();
  resolve({ agents: [bundled] });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled());
  expect(screen.getByText('Imported custom')).toBeInTheDocument();
  expect(host.importAgentDatabase).toHaveBeenCalledTimes(imports);
  expect(host.saveCustomAgents).toHaveBeenCalledTimes(writes);
});

it('keeps an actual failed save retryable with the draft and existing identity intact', async () => {
  const host = catalogHost();
  const row = (await screen.findByText('Original custom')).closest('tr')!;
  await fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
  const dialog = screen.getByRole('dialog', { name: 'Edit custom agent' });
  await fireEvent.input(within(dialog).getByLabelText('Name'), {
    target: { value: 'Retained draft' },
  });
  host.saveCustomAgents.mockResolvedValueOnce({ success: false });
  await fireEvent.click(within(dialog).getByRole('button', { name: 'Save agent' }));
  await within(dialog).findByRole('alert');
  expect(within(dialog).getByLabelText('Name')).toHaveValue('Retained draft');
  expect(screen.getByText('Original custom')).toBeInTheDocument();
  expect(screen.queryByText(savedNotice)).not.toBeInTheDocument();
  expect(host.getAgentDatabase).toHaveBeenCalledTimes(1);
  await fireEvent.click(within(dialog).getByRole('button', { name: 'Save agent' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByText('Retained draft')).toBeInTheDocument();
  expect(host.saveCustomAgents.mock.calls[0][0]).toEqual(host.saveCustomAgents.mock.calls[1][0]);
});
