import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import DetailSummary from '../../../frontend/observatory/components/DetailSummary.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';

it('exposes temporal limits and missing ownership through the real detail overview', () => {
  const { container } = render(DetailSummary, {
    telemetry: emptyTelemetry(),
    row: {
      type: 'sequence-detection',
      action: 'SEQ001',
      severity: 'low',
      extra: {
        assessment: {
          policy: 'credential-egress-v1',
          reasons: ['ownership-incomplete', '__proto__', 'constructor'],
        },
        steps: [
          { action: 'file-handle-held', at: 1000, path: '/fixture/.env', attribution: null },
          {
            action: 'network-connection',
            at: 2000,
            attribution: { status: 'confirmed', evidence: [] },
            network: {
              localIp: '2001:db8::1',
              localPort: 50000,
              remoteIp: '2001:db8::2',
              remotePort: 8443,
            },
          },
        ],
        payload: 'DO-NOT-DISPLAY',
      },
    },
  });
  expect(screen.getByText('Data transfer was not observed.')).toBeTruthy();
  expect(screen.getByText('At least one step has no recorded owner evidence.')).toBeTruthy();
  expect(screen.getByText('[2001:db8::2]:8443')).toBeTruthy();
  expect(container.textContent).not.toContain('PID-backed');
  expect(container.textContent).not.toContain('DO-NOT-DISPLAY');
  expect(container.querySelectorAll('.steps > li')).toHaveLength(2);
});

it('does not invent an assessment or ordered steps for a legacy record', () => {
  render(DetailSummary, {
    telemetry: emptyTelemetry(),
    row: { type: 'sequence-detection', details: { ruleId: 'SEQ001' } },
  });
  expect(screen.getByText('Evidence assessment was not recorded for this rule.')).toBeTruthy();
  expect(screen.getByText('Ordered steps were not recorded.')).toBeTruthy();
  expect(screen.queryByText('Data transfer was not observed.')).toBeNull();
});
