import { expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import Radar from '../../../frontend/observatory/components/Radar.svelte';
import RadarResourceExplorer from '../../../frontend/observatory/components/RadarResourceExplorer.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';

const agents = ['Alpha', 'Beta', 'Delta', 'Gamma', 'Zeta'].map((agent, i) => ({
  agent,
  pid: i + 1,
  process: 'agent.exe',
  instanceId: `test:${i}:live`,
  instanceIdSource: 'os',
}));
const events = Array.from({ length: 7 }, (_, i) => ({
  file: `X:/project/file-${i}.ts`,
  instanceId: i < 6 ? 'test:0:live' : 'test:4:live',
  timestamp: i,
  attribution: { status: 'confirmed' },
}));
const state = (overrides = {}) => ({
  ...emptyTelemetry(),
  ready: true,
  stale: false,
  agents,
  events,
  networkAt: 1,
  ...overrides,
});
const layer = (name) =>
  fireEvent.click(
    within(screen.getByLabelText('Radar layer')).getByRole('button', { name, exact: true }),
  );

it('shows resources from every radar page, searches owners and preserves pagination across scans', async () => {
  const telemetry = state();
  const mounted = render(Radar, { telemetry, selected: null, inspect: vi.fn() });
  await layer('Files');
  expect(screen.getByRole('button', { name: 'Inspect X:/project/file-6.ts' })).toBeInTheDocument();
  await fireEvent.click(screen.getByLabelText('Next radar resources'));
  expect(screen.getByRole('button', { name: 'Inspect X:/project/file-0.ts' })).toBeInTheDocument();
  expect(screen.getByLabelText('Next radar resources')).toHaveAttribute('aria-disabled', 'true');
  await mounted.rerender({ telemetry: { ...telemetry, agents: structuredClone(agents) } });
  expect(screen.getByRole('button', { name: 'Inspect X:/project/file-0.ts' })).toBeInTheDocument();
  await fireEvent.input(screen.getByLabelText('Search radar files'), { target: { value: 'Zeta' } });
  expect(screen.getByRole('button', { name: 'Inspect X:/project/file-6.ts' })).toBeInTheDocument();
  expect(mounted.container.querySelectorAll('.resource-choice')).toHaveLength(1);
});
it('focuses an agent locally and opens resource scope without navigating away', async () => {
  const openAgent = vi.fn();
  render(Radar, { telemetry: state(), selected: null, inspect: vi.fn(), openAgent });
  await fireEvent.click(screen.getByRole('button', { name: /Select Beta,/ }));
  expect(openAgent).not.toHaveBeenCalled();
  await fireEvent.click(screen.getByRole('button', { name: 'View files' }));
  expect(screen.getByLabelText('Resource agent')).toHaveValue('Beta');
  expect(screen.getByText('No matching observations')).toBeInTheDocument();
  await fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(screen.getByRole('button', { name: 'Inspect X:/project/file-6.ts' })).toBeInTheDocument();
  await layer('Radar');
  await fireEvent.click(screen.getByRole('button', { name: 'Open agent', exact: true }));
  expect(openAgent).toHaveBeenCalledOnce();
});
it('counts a shared file once and exposes separate evidence and all retained rows', async () => {
  const shared = [
    { ...events[0], file: 'X:/project/shared.ts' },
    { ...events[0], file: 'X:\\project\\shared.ts', timestamp: 2 },
    {
      ...events[0],
      file: 'X:/project/shared.ts',
      instanceId: 'test:1:live',
      attribution: { status: 'inferred' },
    },
  ];
  const inspect = vi.fn();
  const mounted = render(Radar, { telemetry: state({ events: shared }), selected: null, inspect });
  await layer('Files');
  expect(mounted.container.querySelectorAll('.resource-choice')).toHaveLength(1);
  await fireEvent.click(screen.getByRole('button', { name: 'Inspect X:/project/shared.ts' }));
  expect(screen.getByRole('heading', { name: 'Resource details' })).toHaveFocus();
  const relations = mounted.container.querySelectorAll('.relation');
  expect(relations).toHaveLength(2);
  expect(relations[0]).toHaveAttribute('data-evidence', 'confirmed');
  expect(relations[1]).toHaveAttribute('data-evidence', 'inferred');
  await fireEvent.click(within(relations[0]).getByRole('button', { name: 'View records' }));
  expect(inspect).toHaveBeenLastCalledWith('File observation', {
    observationGroup: 'shared.ts',
    observations: shared.slice(0, 2),
  });
  await fireEvent.click(screen.getByRole('button', { name: 'All resource records' }));
  expect(inspect).toHaveBeenLastCalledWith('File observation', {
    observationGroup: 'shared.ts',
    observations: shared,
  });
});
it('shows empty DNS, groups sockets and retains selection across layers', async () => {
  const network = [1000, 2000].map((localPort) => ({
    instanceId: 'test:0:live',
    domain: '',
    remoteIp: '192.0.2.8',
    remotePort: 443,
    localPort,
  }));
  const inspect = vi.fn();
  render(Radar, { telemetry: state({ network }), selected: null, inspect });
  await layer('Network');
  await fireEvent.click(screen.getByRole('button', { name: 'Inspect 192.0.2.8:443' }));
  expect(screen.getByText('Unverified destination')).toBeInTheDocument();
  await layer('Files');
  await layer('Network');
  expect(screen.getByRole('heading', { name: 'Resource details' })).toBeInTheDocument();
  await fireEvent.click(screen.getByRole('button', { name: 'All resource records' }));
  expect(inspect).toHaveBeenLastCalledWith('Network observation', {
    observationGroup: '192.0.2.8:443',
    observations: network,
  });
});
it('retains selected evidence but disables navigation when live identity changes during pause', async () => {
  const inspect = vi.fn();
  const telemetry = state({ events: [events[0]] });
  const mounted = render(RadarResourceExplorer, {
    telemetry,
    liveTelemetry: telemetry,
    layer: 'files',
    inspect,
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Inspect X:/project/file-0.ts' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Inspect process' }));
  expect(inspect).toHaveBeenLastCalledWith(
    'Alpha',
    expect.objectContaining({ instanceId: 'test:0:live', detailSection: 'processes' }),
  );
  await mounted.rerender({
    liveTelemetry: state({ agents: [{ ...agents[0], instanceId: 'test:0:new' }] }),
  });
  expect(screen.getByRole('button', { name: 'Inspect process' })).toBeDisabled();
  await mounted.rerender({ telemetry: state({ events: [] }) });
  expect(screen.getByText(/No longer in the current data/)).toBeInTheDocument();
  await fireEvent.click(screen.getByRole('button', { name: 'View records' }));
  expect(inspect).toHaveBeenLastCalledWith('File observation', events[0]);
});
it('draws no ownership link for path context and distinguishes waiting from an empty network scan', async () => {
  const mounted = render(RadarResourceExplorer, {
    telemetry: state({ networkAt: null }),
    layer: 'network',
    inspect: vi.fn(),
  });
  expect(screen.getByText('Waiting for a reliable scan')).toBeInTheDocument();
  mounted.unmount();
  const view = render(RadarResourceExplorer, {
    telemetry: state({
      events: [{ file: 'X:/.codex/config.toml', attribution: { status: 'unattributed' } }],
    }),
    layer: 'files',
    inspect: vi.fn(),
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Inspect X:/.codex/config.toml' }));
  expect(view.container.querySelector('.relationship-line')).toHaveClass('unlinked');
  expect(screen.getByRole('button', { name: 'Inspect process' })).toBeDisabled();
  await fireEvent.input(screen.getByLabelText('Search radar files'), {
    target: { value: 'missing' },
  });
  expect(
    screen.getByText('The selected resource is outside the current filters.'),
  ).toBeInTheDocument();
});

it('keeps the selected relationship page during live updates to a shared resource', async () => {
  const shared = agents.map((owner) => ({
    ...events[0],
    instanceId: owner.instanceId,
    agent: owner.agent,
  }));
  const telemetry = state({ events: shared });
  const mounted = render(RadarResourceExplorer, { telemetry, layer: 'files', inspect: vi.fn() });
  await fireEvent.click(screen.getByRole('button', { name: 'Inspect X:/project/file-0.ts' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Next relationships' }));
  expect(
    within(screen.getByLabelText('Resource relationships')).getByText('Zeta'),
  ).toBeInTheDocument();
  await mounted.rerender({
    telemetry: { ...telemetry, events: [...shared, { ...shared[0], timestamp: 100 }] },
  });
  expect(
    within(screen.getByLabelText('Resource relationships')).getByText('Zeta'),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Next relationships' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
});
