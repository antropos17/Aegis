import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import ObservationHistory from '../../../frontend/observatory/components/ObservationHistory.svelte';
import Reports from '../../../frontend/observatory/components/Reports.svelte';
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

it('shows one Windows resource row with mixed activities and keeps every original observation', async () => {
  const rows = [
    {
      agent: 'Codex',
      file: 'C:/work/notes.txt',
      action: 'read',
      timestamp: 1000,
      attribution: { status: 'inferred' },
    },
    {
      agent: 'Codex',
      file: 'c:\\WORK\\NOTES.txt',
      action: 'modified',
      timestamp: 2000,
      sensitive: true,
      attribution: { status: 'confirmed' },
    },
  ];
  const inspect = vi.fn();
  const mounted = render(Events, {
    telemetry: { ...emptyTelemetry(), ready: true, events: rows },
    inspect,
  });
  expect(mounted.container.querySelectorAll('.observation-group')).toHaveLength(1);
  expect(screen.getByText('2 activity types')).toBeInTheDocument();
  expect(screen.getByText(/Sensitive.*Mixed attribution/)).toBeInTheDocument();
  await fireEvent.click(screen.getByRole('button', { name: /Open 2 observations/ }));
  expect(inspect.mock.calls[0][1].observations).toEqual(rows);
});

it('distinguishes retained sockets sharing one remote endpoint by their local ports', () => {
  const rows = [52001, 52002].map((localPort) => ({
    remoteIp: '192.0.2.1',
    remotePort: 443,
    localIp: '10.0.0.2',
    localPort,
    pid: 17,
    state: 'Established',
  }));
  render(ObservationHistory, { rows, navigate: vi.fn() });
  expect(screen.getByText(/Local 10.0.0.2:52001/)).toBeInTheDocument();
  expect(screen.getByText(/Local 10.0.0.2:52002/)).toBeInTheDocument();
  expect(screen.getAllByRole('button')).toHaveLength(2);
});

it.each(['details', 'extra'])(
  'opens grouped audit sockets with original %s metadata',
  async (storage) => {
    const entries = [52001, 52002].map((localPort) => ({
      type: 'network-connection',
      path: '192.0.2.1:443',
      pid: 17,
      agent: 'Codex',
      timestamp: '2026-09-09T12:00:00Z',
      [storage]: {
        remoteIp: '192.0.2.1',
        remotePort: 443,
        localIp: '10.0.0.2',
        localPort,
        domain: '',
        state: 'Established',
        verdict: 'allowlisted',
      },
    }));
    const inspect = vi.fn();
    render(Reports, {
      host: { getAuditStats: async () => ({}), getAuditEntriesBefore: async () => entries },
      audit: true,
      inspect,
      telemetry: emptyTelemetry(),
      navigate: vi.fn(),
    });
    await screen.findByText('Allowlisted');
    await fireEvent.click(screen.getByRole('button', { name: /Open 2 observations/ }));
    const rows = inspect.mock.calls[0][1].observations;
    expect(rows.map((row) => row.localPort)).toEqual([52001, 52002]);
    expect(rows[0][storage]).toEqual(entries[0][storage]);
    expect(rows[0][storage].localPort).toBe(52001);
    expect(rows[0].state).toBe('Established');
  },
);
