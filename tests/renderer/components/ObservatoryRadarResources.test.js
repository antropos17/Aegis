import { expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import Radar from '../../../frontend/observatory/components/Radar.svelte';
import DetailSummary from '../../../frontend/observatory/components/DetailSummary.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';

const agents = ['Alpha', 'Beta', 'Delta', 'Gamma', 'Zeta'].map((agent, i) => ({
  agent,
  pid: i + 1,
  process: 'agent.exe',
  instanceId: `${i}:live`,
  instanceIdSource: 'os',
}));
const events = Array.from({ length: 7 }, (_, i) => ({
  file: `X:/project/file-${i}.ts`,
  instanceId: i < 6 ? '0:live' : '4:live',
  timestamp: i,
  attribution: { status: 'confirmed' },
}));

it('pages through every unique file, opens the recorded observation and resets scope across agent pages', async () => {
  const inspect = vi.fn();
  const mounted = render(Radar, {
    telemetry: { ...emptyTelemetry(), ready: true, stale: false, agents, events },
    selected: '0:live',
    inspect,
  });
  await fireEvent.click(
    within(screen.getByLabelText('Radar layer')).getByRole('button', {
      name: 'Files',
      exact: true,
    }),
  );
  expect(screen.getByText(/6 unique files/)).toBeInTheDocument();
  await fireEvent.click(
    within(mounted.container.querySelector('.radar-stage')).getByRole('button', {
      name: /file-5.ts/,
    }),
  );
  expect(inspect).toHaveBeenLastCalledWith('File observation', events[5]);
  await fireEvent.click(screen.getByLabelText('Next radar resources'));
  await fireEvent.click(screen.getByLabelText('Next radar resources'));
  expect(screen.getByRole('button', { name: /file-0.ts/ })).toBeInTheDocument();
  expect(screen.getByLabelText('Next radar resources')).toBeDisabled();
  await fireEvent.click(screen.getByLabelText('Next radar agents'));
  expect(screen.getByText('All agents on this page')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /file-6.ts/ })).toBeInTheDocument();
  expect(mounted.container.querySelectorAll('.radar-blip[aria-pressed="true"]')).toHaveLength(0);
});

it('explains an empty selected agent and allows showing other agents without losing the layer', async () => {
  render(Radar, {
    telemetry: { ...emptyTelemetry(), ready: true, stale: false, agents, events },
    selected: '1:live',
    inspect: vi.fn(),
  });
  await fireEvent.click(
    within(screen.getByLabelText('Radar layer')).getByRole('button', {
      name: 'Files',
      exact: true,
    }),
  );
  expect(screen.getByRole('status')).toHaveTextContent('No file observations for this agent');
  await fireEvent.click(screen.getByRole('button', { name: 'Show all agents' }));
  expect(screen.getByRole('button', { name: /file-5.ts/ })).toBeInTheDocument();
});

it('shows the endpoint in both the radar and its detail view when DNS is empty', async () => {
  const row = { instanceId: '0:live', domain: '', remoteIp: '192.0.2.8', remotePort: 443 };
  const telemetry = { ...emptyTelemetry(), ready: true, stale: false, agents, network: [row] };
  const inspect = vi.fn();
  const mounted = render(Radar, { telemetry, selected: null, inspect });
  await fireEvent.click(
    within(screen.getByLabelText('Radar layer')).getByRole('button', {
      name: 'Network',
      exact: true,
    }),
  );
  await fireEvent.click(screen.getByRole('button', { name: /192.0.2.8:443/ }));
  expect(inspect).toHaveBeenCalledWith('Network observation', row);
  mounted.unmount();
  render(DetailSummary, { row, telemetry });
  expect(screen.getByText('192.0.2.8:443')).toBeInTheDocument();
});

it('counts a shared resource once while keeping separate agent links and all retained observations', async () => {
  const shared = [
    { ...events[0], file: 'X:/project/shared.ts', timestamp: 1 },
    { ...events[0], file: 'X:\\project\\shared.ts', timestamp: 2 },
    { ...events[0], instanceId: '1:live', file: 'X:/project/shared.ts', timestamp: 3 },
  ];
  const inspect = vi.fn();
  const mounted = render(Radar, {
    telemetry: { ...emptyTelemetry(), ready: true, stale: false, agents, events: shared },
    selected: null,
    inspect,
  });
  await fireEvent.click(
    within(screen.getByLabelText('Radar layer')).getByRole('button', {
      name: 'Files',
      exact: true,
    }),
  );
  expect(screen.getByText(/1 unique file.*2 observation groups/)).toBeInTheDocument();
  const cards = mounted.container.querySelectorAll('.resource-node');
  expect(cards).toHaveLength(2);
  const alpha = [...cards].find((card) => card.dataset.resourceGroup === 'Alpha');
  await fireEvent.click(alpha);
  expect(inspect).toHaveBeenLastCalledWith('File observation', {
    observationGroup: 'shared.ts',
    observations: shared.slice(0, 2),
  });
});

it('opens all current connections represented by an aggregated endpoint marker', async () => {
  const connections = [
    { instanceId: '0:live', domain: '', remoteIp: '192.0.2.8', remotePort: 443, localPort: 1000 },
    { instanceId: '0:live', domain: '', remoteIp: '192.0.2.8', remotePort: 443, localPort: 2000 },
  ];
  const inspect = vi.fn();
  render(Radar, {
    telemetry: { ...emptyTelemetry(), ready: true, stale: false, agents, network: connections },
    selected: null,
    inspect,
  });
  await fireEvent.click(
    within(screen.getByLabelText('Radar layer')).getByRole('button', {
      name: 'Network',
      exact: true,
    }),
  );
  await fireEvent.click(screen.getByRole('button', { name: /192.0.2.8:443/ }));
  expect(inspect).toHaveBeenLastCalledWith('Network observation', {
    observationGroup: '192.0.2.8:443',
    observations: connections,
  });
});
