import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Reports from '../../../frontend/observatory/components/Reports.svelte';
import { emptyTelemetry, type Telemetry } from '../../../frontend/observatory/runtime/host';

it('distinguishes unavailable, current empty, and retained agent populations', async () => {
  const mounted = render(Reports, {
    host: null,
    telemetry: emptyTelemetry(),
    inspect: vi.fn(),
    navigate: vi.fn(),
  });

  expect(screen.getByText('Waiting for reliable agent observations.')).toBeVisible();
  expect(screen.queryByText('No observed agents.')).toBeNull();

  await mounted.rerender({ telemetry: { ...emptyTelemetry(), ready: true, stale: false } });
  expect(screen.getByText('No observed agents.')).toBeVisible();
  expect(screen.queryByText('Waiting for reliable agent observations.')).toBeNull();

  await mounted.rerender({ telemetry: { ...emptyTelemetry(), ready: true, stale: true } });
  expect(screen.getByText('No agents in retained population.')).toBeVisible();
  expect(screen.queryByText('No observed agents.')).toBeNull();

  const agents = [
    {
      agent: 'Codex',
      pid: 42,
      instanceId: '42:old',
      process: 'agent.exe',
      instanceIdSource: 'os',
      cwd: null,
    },
  ] as unknown as Telemetry['agents'];
  await mounted.rerender({ telemetry: { ...emptyTelemetry(), ready: true, stale: true, agents } });
  expect(screen.getByRole('button', { name: 'Codex' })).toBeVisible();
  expect(screen.getByText('Last reliable agent population is retained.')).toBeVisible();
  expect(screen.queryByText('No agents in retained population.')).toBeNull();
});
