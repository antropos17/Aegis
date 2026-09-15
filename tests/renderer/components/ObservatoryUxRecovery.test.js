import { expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import Catalog from '../../../frontend/observatory/components/Catalog.svelte';
import Settings from '../../../frontend/observatory/components/Settings.svelte';
import App from '../../../frontend/observatory/App.svelte';
import { createPreviewHost } from '../../../frontend/observatory/demo/host';

afterEach(() => localStorage.clear());

it('recovers a failed catalog read without presenting an empty catalog or accepting edits', async () => {
  let resolveRead;
  const host = {
    getAgentDatabase: vi
      .fn()
      .mockRejectedValueOnce(new Error('Temporary read failure'))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRead = resolve;
          }),
      ),
    getCustomAgents: async () => [],
  };
  render(Catalog, { host, inspect: vi.fn() });
  expect(await screen.findByRole('alert')).toHaveTextContent('Temporary read failure');
  expect(screen.queryByText('No agents in the catalog')).not.toBeInTheDocument();
  expect(screen.queryByText('0 bundled · 0 custom')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add agent' })).toBeDisabled();
  await fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
  expect(screen.getByRole('button', { name: 'Add agent' })).toBeDisabled();
  resolveRead({
    agents: [{ id: 'fixture', displayName: 'Recovered agent', names: ['fixture.exe'] }],
  });
  expect(await screen.findByText('Recovered agent')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add agent' })).toBeEnabled();
  expect(host.getAgentDatabase).toHaveBeenCalledTimes(2);
});

it('takes an invalid draft back to its field across settings sections without losing other changes', async () => {
  const host = {
    getSettings: async () => ({ uiScale: 1, scanIntervalSec: 10, darkMode: false }),
    getUpdateStatus: async () => ({}),
    saveSettings: vi.fn(async () => ({ success: true })),
  };
  render(Settings, { host, appearance: vi.fn(), navigate: vi.fn() });
  await screen.findByText('Settings saved');
  await fireEvent.click(screen.getByRole('tab', { name: 'Monitoring', exact: true }));
  await fireEvent.input(screen.getByLabelText('Additional exclusions'), {
    target: { value: 'X:/fixture' },
  });
  await fireEvent.input(screen.getByLabelText('Exact scan interval (seconds)'), {
    target: { value: '0' },
  });
  await fireEvent.click(screen.getByRole('tab', { name: 'Appearance', exact: true }));
  const alert = screen.getByRole('alert');
  expect(alert.closest('.settings-save')).not.toBeNull();
  await fireEvent.click(screen.getByRole('button', { name: 'Fix invalid setting' }));
  const field = screen.getByLabelText('Exact scan interval (seconds)');
  expect(field).toHaveFocus();
  expect(field).toHaveAttribute('aria-describedby', alert.id);
  expect(screen.getByLabelText('Additional exclusions')).toHaveValue('X:/fixture');
  expect(host.saveSettings).not.toHaveBeenCalled();
  await fireEvent.input(field, { target: { value: '10' } });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save settings' })).toBeEnabled();
});

it('focuses the opened agent heading once and leaves subsequent tab interaction alone', async () => {
  render(App, { host: createPreviewHost(), preview: true });
  const navigation = screen.getByRole('navigation', { name: 'Main navigation' });
  await fireEvent.click(within(navigation).getByRole('button', { name: 'Agents', exact: true }));
  const open = (await screen.findAllByRole('button', { name: 'Open', exact: true }))[0];
  open.focus();
  await fireEvent.click(open);
  const heading = await screen.findByRole('heading', { name: 'Agent overview', exact: true });
  await waitFor(() => expect(heading).toHaveFocus());
  const resources = within(screen.getByRole('tablist', { name: 'Agent sections' })).getByRole(
    'tab',
    { name: 'Resources', exact: true },
  );
  resources.focus();
  await fireEvent.click(resources);
  expect(resources).toHaveFocus();
});
