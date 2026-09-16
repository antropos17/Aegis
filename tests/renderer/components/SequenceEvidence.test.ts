import { expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import DetailSummary from '../../../frontend/observatory/components/DetailSummary.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';

it('keeps ancestor identities in a closed disclosure without claiming direct parenthood', async () => {
  render(DetailSummary, {
    telemetry: emptyTelemetry(),
    row: {
      type: 'sequence-detection',
      extra: {
        ruleId: 'SEQ003',
        relationship: {
          source: 'fresh-process-table',
          parentPid: 10,
          childPid: 12,
          path: [
            { pid: 10, instanceId: 'ancestor' },
            { pid: 11, instanceId: 'intermediate' },
            { pid: 12, instanceId: 'descendant' },
          ],
        },
        assessment: { policy: 'credential-egress-v1', reasons: ['process-ancestry-only'] },
        steps: [],
      },
    },
  });
  const summary = screen.getByText('Process and assessment details');
  const disclosure = summary.closest('details');
  expect(disclosure?.open).toBe(false);
  await fireEvent.click(summary);
  expect(disclosure?.open).toBe(true);
  expect(
    screen.getByRole('list', { name: 'Observed process path' }).querySelectorAll('li'),
  ).toHaveLength(3);
  expect(screen.getByText('intermediate')).toBeTruthy();
  expect(
    screen.getByText('The observed ancestor path does not establish delegation or data transfer.'),
  ).toBeTruthy();
  expect(screen.queryByText('Observed parent PID 10 → child PID 12.')).toBeNull();
  await fireEvent.click(summary);
  expect(disclosure?.open).toBe(false);
});

it('shows distinct actors and observed relationship without claiming shared ownership', () => {
  render(DetailSummary, {
    telemetry: emptyTelemetry(),
    row: {
      type: 'sequence-detection',
      extra: {
        ruleId: 'SEQ002',
        relationship: {
          source: 'fresh-process-table',
          parentPid: 10,
          childPid: 20,
          fileRelationObservedAt: 10000,
          observedAt: 20000,
        },
        assessment: { policy: 'credential-egress-v1', reasons: ['process-relationship-only'] },
        steps: [
          { agent: 'Parent agent', instanceId: 'p', pid: 10, action: 'file-accessed' },
          { agent: 'Child agent', instanceId: 'c', pid: 20, action: 'network-connection' },
        ],
      },
    },
  });
  expect(screen.getByText('Observed parent PID 10 → child PID 20.')).toBeTruthy();
  expect(screen.getByText('Recorded agent: Parent agent')).toBeTruthy();
  expect(screen.getByText('Recorded agent: Child agent')).toBeTruthy();
  expect(
    screen.getByText(
      'The observed parent relationship does not establish delegation or data transfer.',
    ),
  ).toBeTruthy();
  expect(
    screen.queryByText('These observations are linked to the same recorded process instance.'),
  ).toBeNull();
});

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

it('does not invent an assessment or empty technical details for a legacy record', async () => {
  const { rerender } = render(DetailSummary, {
    telemetry: emptyTelemetry(),
    row: { type: 'sequence-detection', details: { ruleId: 'SEQ001' } },
  });
  expect(screen.getByText('Evidence assessment was not recorded for this rule.')).toBeTruthy();
  expect(screen.getByText('Ordered steps were not recorded.')).toBeTruthy();
  expect(screen.queryByText('Data transfer was not observed.')).toBeNull();
  expect(screen.queryByText('Process and assessment details')).toBeNull();
  await rerender({
    telemetry: emptyTelemetry(),
    row: {
      type: 'sequence-detection',
      details: {
        ruleId: 'SEQ001',
        steps: [{ action: 'file-accessed', attribution: { evidence: [] } }],
      },
    },
  });
  expect(screen.queryByText('Process and assessment details')).toBeNull();
});
