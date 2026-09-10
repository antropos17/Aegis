import { expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import Details from '../../../frontend/observatory/components/Details.svelte';
import Monitoring from '../../../frontend/observatory/components/Monitoring.svelte';
import Agents from '../../../frontend/observatory/components/Agents.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';

const state = () => ({
  ...emptyTelemetry(),
  ready: true,
  stale: false,
  agents: [
    { agent: 'Codex', process: 'codex.exe', pid: 11, instanceId: 'a', instanceIdSource: 'os' },
    { agent: 'Codex', process: 'codex.exe', pid: 12, instanceId: 'b', instanceIdSource: 'os' },
  ],
  network: [{ instanceId: 'b', verdict: 'flagged' }],
});
const props = (telemetry, row) => ({
  telemetry,
  host: {},
  request: { title: 'Codex', row },
  close: vi.fn(),
  refreshFalsePositives: vi.fn(),
});

it('opens the highest risk explanation directly from Monitoring and the agent table', async () => {
  const inspect = vi.fn();
  const { unmount } = render(Monitoring, { telemetry: state(), selected: null, inspect });
  await fireEvent.click(screen.getByRole('button', { name: /Highest risk/ }));
  expect(inspect).toHaveBeenLastCalledWith('Codex', {
    agentGroupKey: 'Codex',
    name: 'Codex',
    detailSection: 'risk',
  });
  unmount();
  render(Agents, { telemetry: state(), inspect });
  await fireEvent.click(screen.getByRole('button', { name: 'Explain risk for Codex' }));
  expect(inspect).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Destination checks')).toBeVisible();
});

it('leads from a group explanation to the actual highest process and restores the explanation on Back', async () => {
  render(Details, props(state(), { agentGroupKey: 'Codex', name: 'Codex', detailSection: 'risk' }));
  const risk = await screen.findByRole('tab', { name: 'Risk explanation' });
  expect(risk).toHaveAttribute('aria-selected', 'true');
  expect(within(screen.getByRole('list')).getByText('Destination checks')).toBeVisible();
  await fireEvent.click(screen.getByRole('button', { name: 'View process PID 12' }));
  await screen.findByText('Agent instance');
  expect(screen.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await fireEvent.click(screen.getByRole('button', { name: 'Why this score' }));
  expect(screen.getByText('Assessment when opened')).toBeVisible();
  expect(screen.getByText(/Assessment for PID 12/)).toBeVisible();
  await fireEvent.click(screen.getByRole('button', { name: 'Back', exact: true }));
  await waitFor(() =>
    expect(screen.getByRole('tab', { name: 'Risk explanation' })).toHaveAttribute(
      'aria-selected',
      'true',
    ),
  );
  expect(screen.getByRole('button', { name: 'View process PID 12' })).toBeVisible();
});

it('shows limited coverage and stale data instead of treating zero as a safety guarantee', async () => {
  const telemetry = {
    ...state(),
    stale: true,
    agents: [{ agent: 'Codex', process: 'codex.exe', pid: 0, instanceId: null }],
  };
  render(
    Details,
    props(telemetry, { agentGroupKey: 'Codex', name: 'Codex', detailSection: 'risk' }),
  );
  const panel = await screen.findByRole('tabpanel');
  expect(within(panel).getByText('Last reliable snapshot')).toBeVisible();
  expect(panel).toHaveTextContent('limited coverage');
  expect(panel).toHaveTextContent('No contributing file or network activity');
});

it('ignores an invalid requested detail tab', async () => {
  render(Details, props(state(), { agentGroupKey: 'Codex', detailSection: 'controls' }));
  expect(await screen.findByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(screen.queryByRole('tab', { name: 'Controls', exact: true })).toBeNull();
});
