import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import Events from '../../../frontend/observatory/components/Events.svelte';
import SensorStatus from '../../../frontend/observatory/components/SensorStatus.svelte';
import Notifications from '../../../frontend/observatory/components/Notifications.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';

it('shows network-only observations and filters legacy verdicts as unknown', async () => {
  const network = [
    {
      remoteIp: '192.0.2.1',
      remotePort: 443,
      verdict: 'allowlisted',
      agent: 'Claude',
      instanceId: 'a',
      attribution: { status: 'confirmed' },
    },
    { remoteIp: '192.0.2.2', remotePort: 80, verdict: 'flagged', agent: '', reason: 'test-reason' },
    { remoteIp: '192.0.2.3', remotePort: 22 },
  ];
  const inspect = vi.fn();
  render(Events, { telemetry: { ...emptyTelemetry(), network }, network: true, inspect });
  expect(screen.getByText('192.0.2.1:443')).toBeInTheDocument();
  await fireEvent.change(screen.getByLabelText('Event kind'), { target: { value: 'unknown' } });
  expect(screen.queryByText('192.0.2.1:443')).toBeNull();
  await fireEvent.click(screen.getByText('192.0.2.3:22'));
  expect(inspect.mock.calls[0][1]).toEqual(network[2]);
  await fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
  expect(screen.getByText('192.0.2.1:443')).toBeInTheDocument();
});

it('preserves attribution and skill identity without claiming skill execution', async () => {
  const event = {
    agent: '',
    instanceId: null,
    file: 'X:/skills/review/SKILL.md',
    action: 'created',
    timestamp: Date.now(),
    attribution: { status: 'unattributed', evidence: ['sensor-event'] },
  };
  const inspect = vi.fn();
  render(Events, { telemetry: { ...emptyTelemetry(), ready: true, events: [event] }, inspect });
  expect(screen.getByText('Skill')).toBeInTheDocument();
  expect(screen.getByText('review')).toBeInTheDocument();
  expect(within(screen.getByRole('table')).getByText('Shared skills')).toBeInTheDocument();
  await fireEvent.change(screen.getByLabelText('Event kind'), {
    target: { value: 'unattributed' },
  });
  await fireEvent.click(screen.getByText(event.file));
  expect(inspect.mock.calls[0][1]).toEqual(event);
  expect(screen.getByTitle('sensor-event')).toBeInTheDocument();
});

it('holds the event view while sensor pushes continue and retains grouping after filter reset', async () => {
  const initial = {
    ...emptyTelemetry(),
    ready: true,
    events: [{ agent: 'A', file: '/one', timestamp: Date.now() }],
  };
  const mounted = render(Events, { telemetry: initial, inspect: vi.fn() });
  await fireEvent.change(screen.getByLabelText('Grouping'), { target: { value: 'agent' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Pause view' }));
  await mounted.rerender({
    telemetry: {
      ...initial,
      events: [...initial.events, { agent: 'A', file: '/two', timestamp: Date.now() }],
    },
  });
  expect(screen.queryByText('/two')).toBeNull();
  await fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
  expect(screen.getByLabelText('Grouping')).toHaveValue('agent');
  await fireEvent.click(screen.getByRole('button', { name: 'Resume live view' }));
  expect(screen.getByText('/two')).toBeInTheDocument();
});

it('names only effective unhealthy sensors, ignoring aggregate prose and malformed IDs', async () => {
  const mounted = render(SensorStatus, {
    health: {
      reasons: ['fake sensor failed'],
      sensors: {
        effective: { failedSensorIds: ['etw-file', null, ''], degradedSensorIds: ['network'] },
      },
    },
  });
  expect(screen.getByText(/Failed sensors: etw-file/)).toBeInTheDocument();
  expect(screen.getByText(/Degraded sensors: network/)).toBeInTheDocument();
  expect(mounted.container.textContent).not.toContain('fake');
  await mounted.rerender({ health: {} });
  expect(mounted.container.textContent.trim()).toBe('');
});

it('keeps population churn quiet and alerts only on an anomaly crossing', async () => {
  const initial = {
    ...emptyTelemetry(),
    stale: false,
    agents: [{ agent: 'Claude', instanceId: 'a' }],
    anomalies: { a: 49 },
  };
  const mounted = render(Notifications, { telemetry: initial });
  expect(screen.queryByText(/Anomaly:/)).toBeNull();
  await mounted.rerender({
    telemetry: { ...initial, agents: [...initial.agents, { agent: 'Other', instanceId: 'b' }] },
  });
  expect(screen.queryByText(/Anomaly:/)).toBeNull();
  await mounted.rerender({ telemetry: { ...initial, anomalies: { a: 50 } } });
  expect(screen.getByText('Anomaly: Claude score 50')).toBeInTheDocument();
});
