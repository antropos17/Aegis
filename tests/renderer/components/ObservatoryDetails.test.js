import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import Details from '../../../frontend/observatory/components/Details.svelte';
import Metadata from '../../../frontend/observatory/components/Metadata.svelte';
import Catalog from '../../../frontend/observatory/components/Catalog.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';
const agent = (pid) => ({
  agent: 'Codex',
  process: 'agent.exe',
  pid,
  instanceId: pid + ':live',
  instanceIdSource: 'os',
  cwd: 'X:/project-' + pid,
});
const state = (agents) => ({ ...emptyTelemetry(), ready: true, stale: false, agents });
const props = (row, telemetry) => ({
  row,
  host: {},
  telemetry,
  request: { title: 'Codex', row },
  close: vi.fn(),
  refreshFalsePositives: vi.fn(),
});

it('renders named fields and lists without raw JSON, retaining zero and false and excluding nested secrets', () => {
  const { container } = render(Metadata, {
    value: {
      cpu: 0,
      estimated: false,
      inputTokens: null,
      names: ['codex.exe', 'node.exe'],
      sensor: {
        state: 'HEALTHY',
        accessToken: 'private-token',
        nested: [{ password: 'private-password', source: '<img src=x>' }],
      },
    },
  });
  expect(screen.getByText('CPU')).toBeInTheDocument();
  expect(screen.getByText('0')).toBeInTheDocument();
  expect(screen.getByText('No')).toBeInTheDocument();
  expect(screen.getByText('Unavailable')).toBeInTheDocument();
  expect(screen.getByText('codex.exe')).toBeInTheDocument();
  expect(container.querySelector('img, pre')).toBeNull();
  expect(container.textContent).not.toMatch(/private-token|private-password|[{][\s"]|[[][{\s"]/);
  expect(container.textContent).toContain('<img src=x>');
});

it('restores the selected section, process search, pagination, scroll and focus after returning', async () => {
  const agents = Array.from({ length: 26 }, (_, i) => agent(i + 1));
  const { container } = render(
    Details,
    props({ agentGroupKey: 'Codex', name: 'Codex' }, state(agents)),
  );
  await fireEvent.click(await screen.findByRole('tab', { name: /Processes/ }));
  await fireEvent.input(screen.getByLabelText('Find a process'), {
    target: { value: 'agent.exe' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Show 12 more processes' }));
  const body = container.querySelector('#modal-body');
  body.scrollTop = 88;
  const target = screen.getByRole('button', { name: 'Open process PID 23' });
  target.focus();
  await fireEvent.click(target);
  await fireEvent.click(await screen.findByRole('tab', { name: 'Attributes', exact: true }));
  expect(screen.getByText('23:live')).toBeInTheDocument();
  await fireEvent.click(screen.getByRole('button', { name: 'Back', exact: true }));
  await waitFor(() =>
    expect(screen.getByRole('tab', { name: /Processes/ })).toHaveAttribute('aria-selected', 'true'),
  );
  expect(screen.getByLabelText('Find a process')).toHaveValue('agent.exe');
  expect(screen.getAllByRole('button', { name: /^Open process PID / })).toHaveLength(24);
  expect(body.scrollTop).toBe(88);
  expect(screen.getByRole('button', { name: 'Open process PID 23' })).toHaveFocus();
});

it('supports keyboard tabs with one active panel and does not mix process controls into the overview', async () => {
  render(Details, props(agent(42), state([agent(42)])));
  const overview = await screen.findByRole('tab', { name: 'Overview', exact: true });
  expect(screen.queryByRole('button', { name: 'Suspend', exact: true })).toBeNull();
  overview.focus();
  await fireEvent.keyDown(overview, { key: 'End' });
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Controls' })).toHaveFocus());
  expect(screen.getByRole('button', { name: 'Suspend', exact: true })).toBeEnabled();
  expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
  await fireEvent.keyDown(screen.getByRole('tab', { name: 'Controls' }), { key: 'Home' });
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Overview' })).toHaveFocus());
  expect(screen.queryByRole('button', { name: 'Suspend', exact: true })).toBeNull();
});

it('keeps catalog edits across tabs and reveals the missing required field', async () => {
  const host = {
    getAgentDatabase: vi.fn(async () => ({ agents: [] })),
    getCustomAgents: vi.fn(async () => []),
    saveCustomAgents: vi.fn(async () => ({ success: true })),
  };
  render(Catalog, { host, inspect: vi.fn() });
  await fireEvent.click(screen.getByRole('button', { name: 'Add agent' }));
  const dialog = screen.getByRole('dialog');
  await fireEvent.input(within(dialog).getByLabelText('Name'), { target: { value: 'My agent' } });
  await fireEvent.click(within(dialog).getByRole('button', { name: 'Save agent' }));
  await waitFor(() =>
    expect(within(dialog).getByRole('tab', { name: 'Recognition' })).toHaveAttribute(
      'aria-selected',
      'true',
    ),
  );
  expect(host.saveCustomAgents).not.toHaveBeenCalled();
  await fireEvent.input(within(dialog).getByLabelText('Process name'), {
    target: { value: 'agent.exe' },
  });
  await fireEvent.click(within(dialog).getByRole('tab', { name: 'General' }));
  expect(within(dialog).getByLabelText('Name')).toHaveValue('My agent');
  await fireEvent.click(within(dialog).getByRole('button', { name: 'Save agent' }));
  await waitFor(() => expect(host.saveCustomAgents).toHaveBeenCalledTimes(1));
  expect(host.saveCustomAgents.mock.calls[0][0][0]).toMatchObject({
    displayName: 'My agent',
    names: ['agent.exe'],
  });
});
