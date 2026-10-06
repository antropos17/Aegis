import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import App from '../../../frontend/observatory/App.svelte';
import Catalog from '../../../frontend/observatory/components/Catalog.svelte';
import WorkspaceCommands from '../../../frontend/observatory/components/WorkspaceCommands.svelte';
import { createPreviewHost } from '../../../frontend/observatory/demo/host';
import type { RecordData } from '../../../frontend/observatory/runtime/host';

afterEach(() => localStorage.clear());

const entries = [
  { id: 'guide', label: 'Start here', caption: 'Observe', keywords: 'guide', target: 'guide' },
  {
    id: 'overview',
    label: 'Monitoring',
    caption: 'Observe',
    keywords: 'radar',
    target: 'overview',
  },
];

it('keeps command options out of Tab navigation while arrows choose the announced destination', async () => {
  const choose = vi.fn();
  render(WorkspaceCommands, { open: true, close: vi.fn(), entries, choose });
  const input = screen.getByRole('combobox');
  await waitFor(() => expect(input).toHaveFocus());
  expect(screen.getAllByRole('option').every((option) => option.tabIndex === -1)).toBe(true);
  expect(screen.getByRole('listbox').tabIndex).toBe(-1);
  // jsdom has no layout; real scrolling is checked in the browser suite.
  screen.getAllByRole('option').forEach((option) => (option.scrollIntoView = vi.fn()));
  await fireEvent.keyDown(input, { key: 'ArrowDown' });
  const selected = screen.getByRole('option', { selected: true });
  expect(selected).toHaveTextContent('Monitoring');
  expect(input).toHaveAttribute('aria-activedescendant', selected.id);
  expect(input).toHaveFocus();
  await fireEvent.keyDown(input, { key: 'Enter' });
  expect(choose).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'overview', target: 'overview' }),
  );
});

it('announces empty command results and restores search after clearing the query', async () => {
  render(WorkspaceCommands, { open: true, close: vi.fn(), entries, choose: vi.fn() });
  const input = screen.getByRole('combobox');
  await fireEvent.input(input, { target: { value: 'no-match-ux' } });
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('No matching destination.'),
  );
  expect(input).toHaveFocus();
  expect(input).not.toHaveAttribute('aria-activedescendant');
  await fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(input).toHaveValue('');
  expect(input).toHaveFocus();
  expect(screen.getAllByRole('option')).toHaveLength(2);
});

it('lets users disable single-key shortcuts without disabling Commands or button navigation', async () => {
  render(App, { host: createPreviewHost(), preview: true });
  const navigation = screen.getByRole('navigation', { name: 'Main navigation' });
  await fireEvent.click(within(navigation).getByRole('button', { name: 'Settings' }));
  await fireEvent.click(screen.getByRole('tab', { name: 'Data & help' }));
  const option = screen.getByRole('checkbox', { name: 'Single-key shortcuts' });
  expect(option).toBeChecked();
  await fireEvent.click(option);
  await fireEvent.click(within(navigation).getByRole('button', { name: 'Monitoring' }));
  await fireEvent.keyDown(window, { key: 's' });
  expect(screen.getByRole('heading', { name: 'Monitoring', level: 1 })).toBeInTheDocument();
  const theme = document.documentElement.dataset.theme;
  await fireEvent.keyDown(window, { key: 't' });
  expect(document.documentElement.dataset.theme).toBe(theme);
  await fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  expect(await screen.findByRole('combobox', { name: 'Find a workspace or action' })).toHaveFocus();
});

function catalogHost() {
  let custom: RecordData[] = [
    {
      id: 'ux-fixture',
      displayName: 'UX fixture',
      names: ['ux-fixture.exe'],
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
  return host;
}

it('does not delete a custom agent when confirmation is cancelled', async () => {
  const host = catalogHost();
  await screen.findByText('UX fixture');
  const trigger = screen.getByRole('button', { name: 'Delete' });
  trigger.focus();
  await fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: 'Delete custom agent?' });
  expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
  await fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(host.saveCustomAgents).not.toHaveBeenCalled();
  expect(trigger).toHaveFocus();
  expect(screen.getByText('UX fixture')).toBeInTheDocument();
});

it('keeps a rejected deletion in the catalog and lets the same confirmation retry', async () => {
  const host = catalogHost();
  host.saveCustomAgents.mockResolvedValueOnce({ success: false });
  await screen.findByText('UX fixture');
  await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  const dialog = await screen.findByRole('dialog', { name: 'Delete custom agent?' });
  await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete agent' }));
  expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
  expect(screen.getByText('UX fixture')).toBeInTheDocument();
  await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete agent' }));
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Delete custom agent?' })).not.toBeInTheDocument(),
  );
  expect(screen.getByText('Custom agent UX fixture removed.')).toHaveAttribute('role', 'status');
  await waitFor(() =>
    expect(screen.getByRole('searchbox', { name: 'Search catalog' })).toHaveFocus(),
  );
  expect(host.saveCustomAgents).toHaveBeenCalledTimes(2);
});

it('preserves a confirmed deletion when its subsequent catalog refresh fails', async () => {
  const host = catalogHost();
  await screen.findByText('UX fixture');
  host.getAgentDatabase.mockRejectedValueOnce(new Error('Readback unavailable'));
  await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  const dialog = await screen.findByRole('dialog', { name: 'Delete custom agent?' });
  await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete agent' }));
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Delete custom agent?' })).not.toBeInTheDocument(),
  );
  expect(screen.queryByText('UX fixture')).not.toBeInTheDocument();
  expect(screen.getByText('Custom agent UX fixture removed.')).toHaveAttribute('role', 'status');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retry loading' })).toBeEnabled());
  expect(host.saveCustomAgents).toHaveBeenCalledTimes(1);
});
