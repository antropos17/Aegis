import { expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import Agents from '../../../frontend/observatory/components/Agents.svelte';
import { emptyTelemetry, type Telemetry } from '../../../frontend/observatory/runtime/host';
import type { DetectedAgent } from '../../../src/shared/types';

const agent = (pid: number): DetectedAgent => ({
  agent: 'Codex',
  process: 'codex.exe',
  pid,
  status: 'running',
  category: 'coding',
  instanceId: `${pid}:live`,
  instanceIdSource: 'os',
});
const state = (overrides: Partial<Telemetry> = {}): Telemetry => ({
  ...emptyTelemetry(),
  ready: true,
  stale: false,
  agents: [agent(1), agent(2)],
  ...overrides,
});

it.each([
  {
    reason: 'duplicate measurement identities',
    resources: [
      { instanceId: '1:live', cpu: 7, memMb: 10 },
      { instanceId: '1:live', cpu: 83, memMb: 20 },
      { instanceId: '2:live', cpu: 5, memMb: 30 },
    ],
  },
  {
    reason: 'negative measurements',
    resources: [
      { instanceId: '1:live', cpu: -1, memMb: -10 },
      { instanceId: '2:live', cpu: 5, memMb: 30 },
    ],
  },
])(
  'shows unavailable complete group totals for $reason in the active agents table',
  ({ resources }) => {
    render(Agents, { telemetry: state({ resources }), inspect: vi.fn(), advanced: false });
    const row = screen.getByRole('button', { name: /^Codex$/ }).closest('tr');
    expect(row).not.toBeNull();
    const cells = within(row!).getAllByRole('cell');
    expect(cells[3]).toHaveTextContent(/^—$/);
    expect(cells[4]).toHaveTextContent(/^—$/);
  },
);

it('preserves complete group readings, field-specific gaps and measured zero through telemetry updates', async () => {
  const population = state({
    agents: [agent(1), agent(2), { ...agent(3), agent: 'Cursor' }],
    resources: [
      { instanceId: '1:live', cpu: 0, memMb: 0 },
      { instanceId: '2:live', cpu: 12.5, memMb: 64 },
      { instanceId: '2:retired', pid: 2, cpu: 99, memMb: 999 },
      { instanceId: null, cpu: 99, memMb: 999 },
    ],
  });
  const { rerender } = render(Agents, {
    telemetry: population,
    inspect: vi.fn(),
    advanced: false,
  });
  const row = screen.getByRole('button', { name: /^Codex$/ }).closest('tr');
  expect(row).not.toBeNull();
  const cells = within(row!).getAllByRole('cell');
  expect(cells[3]).toHaveTextContent(/^12\.5%$/);
  expect(cells[4]).toHaveTextContent(/^64\.0 MB$/);

  await rerender({
    telemetry: {
      ...population,
      resources: [population.resources[0], { instanceId: '2:live', memMb: 64 }],
    },
  });
  expect(cells[3]).toHaveTextContent(/^—$/);
  expect(cells[4]).toHaveTextContent(/^64\.0 MB$/);

  const zero = {
    ...population,
    resources: population.resources.slice(0, 2).map((row) => ({ ...row, cpu: 0, memMb: 0 })),
  };
  await rerender({ telemetry: zero });
  expect(cells[3]).toHaveTextContent(/^0\.0%$/);
  expect(cells[4]).toHaveTextContent(/^0\.0 MB$/);
  for (const change of [{ stale: true }, { ready: false }]) {
    await rerender({ telemetry: { ...zero, ...change } });
    expect(cells[3]).toHaveTextContent(/^—$/);
    expect(cells[4]).toHaveTextContent(/^—$/);
  }
});
