import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import StatsSensors from '../../../frontend/observatory/components/StatsSensors.svelte';
import Statistics from '../../../frontend/observatory/components/Statistics.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';
import { language } from '../../../frontend/observatory/runtime/i18n';

const buckets = ['file-watch', 'file-handle', 'process', 'network', 'other'];
function fixture() {
  return {
    ...emptyTelemetry(),
    ready: true,
    stale: false,
    statsAt: Date.now(),
    stats: {
      ipc: {
        securityEvents: {
          sensors: Object.fromEntries(
            buckets.map((name) => [name, { accepted: 1, delivered: 2, buffered: 0, lost: 0 }]),
          ),
          pendingLoss: 0,
          unknownLoss: false,
          markerDurable: true,
          replayPending: false,
          spill: { records: 0, bytes: 0, blocked: false },
        },
      },
    },
  };
}
afterEach(() => {
  language.set('en');
  vi.restoreAllMocks();
});

it('shows per-bucket admission rates only after a second sample and clears them on stale telemetry', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(10_000);
  const first = fixture();
  Object.assign(first.stats.ipc.securityEvents, {
    sampleGeneration: '11111111-1111-4111-8111-111111111111',
    sampleMonotonicMs: 1000,
  });
  const mounted = render(Statistics, {
    telemetry: first,
    inspect: vi.fn(),
    sectionRequest: { id: 'sensors', revision: 1 },
  });
  await tick();
  const rate = screen.getByRole('region', {
    name: 'Accepted audit-lane records per second between samples',
  });
  expect(rate).toHaveTextContent('Admission rates unavailable');
  clock.mockReturnValue(12_000);
  const second = structuredClone(first);
  second.statsAt = 12_000;
  Object.assign(second.stats.ipc.securityEvents, { sampleMonotonicMs: 3000 });
  second.stats.ipc.securityEvents.sensors.network.accepted = 5;
  await mounted.rerender({ telemetry: second });
  expect(rate).toHaveTextContent('Network');
  expect(rate).toHaveTextContent('2.00');
  expect(rate).toHaveTextContent('Sample interval: 2.00 seconds. Source freshness is unknown.');
  expect(rate).toHaveTextContent('Zero does not mean no activity.');
  await mounted.rerender({ telemetry: { ...second, stale: true } });
  expect(rate).toHaveTextContent('Admission rates unavailable');
  expect(within(rate).queryByText('2.00')).toBeNull();
});

it('keeps retired generation history when the sensor section is unmounted and remounted', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(10_000);
  const first = fixture();
  Object.assign(first.stats.ipc.securityEvents, {
    sampleGeneration: '11111111-1111-4111-8111-111111111111',
    sampleMonotonicMs: 1000,
  });
  const mounted = render(Statistics, {
    telemetry: first,
    inspect: vi.fn(),
    sectionRequest: { id: 'sensors', revision: 1 },
  });
  await tick();
  clock.mockReturnValue(11_000);
  const a2 = structuredClone(first);
  a2.statsAt = 11_000;
  Object.assign(a2.stats.ipc.securityEvents, { sampleMonotonicMs: 2000 });
  a2.stats.ipc.securityEvents.sensors.network.accepted = 2;
  await mounted.rerender({ telemetry: a2 });
  let rate = screen.getByRole('region', {
    name: 'Accepted audit-lane records per second between samples',
  });
  expect(rate).toHaveTextContent('1.00');
  clock.mockReturnValue(12_000);
  const b1 = structuredClone(first);
  b1.statsAt = 12_000;
  Object.assign(b1.stats.ipc.securityEvents, {
    sampleGeneration: '22222222-2222-4222-8222-222222222222',
  });
  await mounted.rerender({ telemetry: b1 });
  await mounted.rerender({ sectionRequest: { id: 'overview', revision: 2 } });
  expect(
    screen.queryByRole('region', {
      name: 'Accepted audit-lane records per second between samples',
    }),
  ).toBeNull();
  clock.mockReturnValue(13_000);
  const replayA1 = structuredClone(first);
  replayA1.statsAt = 13_000;
  await mounted.rerender({ telemetry: replayA1, sectionRequest: { id: 'sensors', revision: 3 } });
  rate = screen.getByRole('region', {
    name: 'Accepted audit-lane records per second between samples',
  });
  expect(rate).toHaveTextContent('Admission rates unavailable');
  clock.mockReturnValue(14_000);
  a2.statsAt = 14_000;
  await mounted.rerender({ telemetry: a2 });
  expect(rate).toHaveTextContent('Admission rates unavailable');
});

it('exposes the bounded audit-lane report and makes source freshness and replay limits explicit', async () => {
  const value = fixture();
  const mounted = render(StatsSensors, { telemetry: value });
  const region = screen.getByRole('region', { name: 'Security event delivery' });
  expect(region).toHaveTextContent('Last received report; source freshness is unknown.');
  expect(region).toHaveTextContent('Accepted in this run');
  expect(region).toHaveTextContent('Audit acknowledgements in this run');
  expect(region).toHaveTextContent('Acknowledgements include replay and can include duplicates.');
  expect(region).toHaveTextContent('does not measure sensor coverage or detection completeness');
  value.stats.ipc.securityEvents.unknownLoss = true;
  value.stats.ipc.securityEvents.markerDurable = false;
  value.stats.ipc.securityEvents.replayPending = true;
  value.stats.ipc.securityEvents.spill.blocked = true;
  await mounted.rerender({ telemetry: structuredClone(value) });
  expect(region).toHaveTextContent('Loss of an unknown count was reported.');
  expect(region).toHaveTextContent('Loss marker reported not durable.');
  expect(region).toHaveTextContent('Startup replay was pending; new observations may be rejected.');
  expect(region).toHaveTextContent('Spill storage was blocked.');
  expect(region).toHaveTextContent('Known loss in pending or in-flight ledger');
  expect(region).toHaveTextContent('Known spill records');
  expect(region).toHaveTextContent(
    'Uninspected spill segments may be excluded from known records.',
  );
  expect(region).not.toHaveTextContent('awaiting acknowledgement');
  language.set('pt');
  await tick();
  expect(screen.getByRole('region', { name: 'Entrega de eventos de segurança' })).toHaveTextContent(
    'a atualidade da fonte é desconhecida',
  );
});

it('removes retained numbers on stale, absent, or malformed telemetry and recovers on a new valid receipt', async () => {
  const value = fixture();
  const mounted = render(StatsSensors, { telemetry: value });
  const region = screen.getByRole('region', { name: 'Security event delivery' });
  expect(within(region).getByText('5')).toBeVisible();
  for (const telemetry of [
    { ...value, stale: true },
    { ...value, stats: {} },
    { ...value, stats: { ipc: { securityEvents: { pendingLoss: 0 } } } },
    { ...value, statsAt: Date.now() - 91_000 },
  ]) {
    await mounted.rerender({ telemetry });
    expect(region).toHaveTextContent('Security event delivery report is unavailable.');
    expect(within(region).queryByText('5')).toBeNull();
  }
  await mounted.rerender({ telemetry: fixture() });
  expect(within(region).getByText('5')).toBeVisible();
});
