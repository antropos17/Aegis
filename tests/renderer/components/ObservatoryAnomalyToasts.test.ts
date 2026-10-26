import { afterEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Notifications from '../../../frontend/observatory/components/Notifications.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';
import type { DetectedAgent } from '../../../src/shared/types';
import { clearAllToasts } from '../../../src/renderer/lib/stores/toast';

afterEach(() => {
  clearAllToasts();
  vi.useRealTimers();
});

const process = (pid: number, birth: number) =>
  ({
    agent: 'Claude',
    pid,
    instanceId: `${pid}:${birth}`,
    instanceIdSource: 'os',
  }) as DetectedAgent & { instanceId: string };

it('reports sequential threshold crossings independently for same-name instances', async () => {
  vi.useFakeTimers();
  const a = process(10, 111);
  const b = process(20, 222);
  const initial = {
    ...emptyTelemetry(),
    stale: false,
    agents: [a, b],
    anomalies: { [a.instanceId]: 0, [b.instanceId]: 0 },
  };
  const view = render(Notifications, { telemetry: initial });
  await view.rerender({
    telemetry: { ...initial, anomalies: { [a.instanceId]: 50, [b.instanceId]: 0 } },
  });
  expect(screen.getByText('Anomaly: Claude (PID 10) score 50')).toBeInTheDocument();
  await view.rerender({
    telemetry: { ...initial, anomalies: { [a.instanceId]: 50, [b.instanceId]: 70 } },
  });
  expect(screen.getByText('Anomaly: Claude (PID 20) score 70')).toBeInTheDocument();
  await view.rerender({
    telemetry: { ...initial, anomalies: { [a.instanceId]: 50, [b.instanceId]: 70 } },
  });
  expect(screen.getAllByText(/Anomaly: Claude/)).toHaveLength(2);
});

it('freezes stale and missing scores and rejects untrusted or duplicate identities', async () => {
  const a = process(10, 111);
  const b = process(20, 222);
  const initial = {
    ...emptyTelemetry(),
    stale: false,
    agents: [a, b],
    anomalies: { [a.instanceId]: 80, [b.instanceId]: 0 },
  };
  const view = render(Notifications, { telemetry: initial });
  await view.rerender({
    telemetry: { ...initial, stale: true, anomalies: { [a.instanceId]: 0, [b.instanceId]: 80 } },
  });
  await view.rerender({ telemetry: { ...initial, anomalies: { [b.instanceId]: 0 } } });
  await view.rerender({ telemetry: initial });
  expect(screen.queryByText(/Anomaly:/)).toBeNull();
  const unknown: DetectedAgent = { ...b, instanceIdSource: 'unknown' };
  await view.rerender({
    telemetry: {
      ...initial,
      agents: [a, unknown],
      anomalies: { [a.instanceId]: 80, [b.instanceId]: 90 },
    },
  });
  await view.rerender({
    telemetry: {
      ...initial,
      agents: [a, b, { ...b, agent: 'Other' }],
      anomalies: { [a.instanceId]: 80, [b.instanceId]: 90 },
    },
  });
  expect(screen.queryByText(/Anomaly:/)).toBeNull();
});

it('quietly seeds an initially unmeasured instance, while a newly arriving measured instance can alert', async () => {
  const a = process(10, 111);
  const b = process(20, 222);
  const c = process(30, 333);
  const initial = {
    ...emptyTelemetry(),
    stale: false,
    agents: [a, b],
    anomalies: { [a.instanceId]: 0 },
  };
  const view = render(Notifications, { telemetry: initial });
  await view.rerender({
    telemetry: { ...initial, anomalies: { [a.instanceId]: 0, [b.instanceId]: 70 } },
  });
  expect(screen.queryByText(/Anomaly:/)).toBeNull();
  await view.rerender({
    telemetry: {
      ...initial,
      agents: [a, b, c],
      anomalies: { [a.instanceId]: 0, [b.instanceId]: 70, [c.instanceId]: 80 },
    },
  });
  expect(screen.getByText('Anomaly: Claude (PID 30) score 80')).toBeInTheDocument();
});
