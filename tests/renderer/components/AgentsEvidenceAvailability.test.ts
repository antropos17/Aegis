import { expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import Agents from '../../../frontend/observatory/components/Agents.svelte';
import { emptyTelemetry, type Telemetry } from '../../../frontend/observatory/runtime/host';

it('distinguishes unknown, retained and current network evidence and labels estimated usage', async () => {
  const state = {
    ...emptyTelemetry(),
    ready: true,
    stale: false,
    agents: [
      {
        agent: 'Codex',
        process: 'codex.exe',
        pid: 42,
        instanceId: '42:old',
        instanceIdSource: 'os',
      },
    ] as unknown as Telemetry['agents'],
    stats: { appHealth: { sensors: { byId: { network: { state: 'HEALTHY' } } } } },
    tokens: [{ instanceId: '42:old', totalTokens: 12, costUsd: 0.01, estimated: true }],
  };
  const mounted = render(Agents, { telemetry: state, inspect: vi.fn() });
  const row = () => screen.getByRole('row', { name: /Codex/ });
  expect(screen.getByRole('columnheader', { name: 'Estimated cost' })).toBeVisible();
  expect(row()).toHaveTextContent('12Estimated');
  expect(row()).toHaveTextContent('$0.01');
  expect(
    within(row()).getByText('Network observation unavailable').parentElement,
  ).toHaveTextContent('—');

  const connection = {
    instanceId: '42:old',
    remoteIp: '192.0.2.1',
    remotePort: 443,
  } as Telemetry['network'][number];
  await mounted.rerender({
    telemetry: { ...state, network: [connection], networkAt: 10, networkCurrent: false },
  });
  const retained = within(row()).getByText('Retained network snapshot').parentElement;
  expect(retained).toHaveTextContent('1');

  await mounted.rerender({
    telemetry: { ...state, network: [], networkAt: 11, networkCurrent: true },
  });
  expect(within(row()).queryByText('Retained network snapshot')).toBeNull();
  expect(within(row()).queryByText('Network observation unavailable')).toBeNull();
  expect(within(row()).getAllByRole('cell')[8]).toHaveTextContent('0');
});
