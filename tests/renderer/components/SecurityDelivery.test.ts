import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import StatsSensors from '../../../frontend/observatory/components/StatsSensors.svelte';
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
  const mounted = render(StatsSensors, { telemetry: first });
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
