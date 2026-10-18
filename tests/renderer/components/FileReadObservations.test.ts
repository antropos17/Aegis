import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import FileReadObservations from '../../../frontend/observatory/components/FileReadObservations.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';
const telemetry = () => ({
  ...emptyTelemetry(),
  stale: false,
  stats: {
    fileReadDiagnostics: {
      phase: 'running',
      lossCount: null,
      omitted: 0,
      reads: [
        {
          id: '1',
          agent: 'Claude Code',
          pid: 71,
          instanceId: '71:1000',
          path: 'C:\\fixture\\.env.test',
          pathEvidence: 'candidate-object',
          sensitiveReason: 'Environment variables may contain credentials',
          reads: 1,
          observedAt: 1000,
        },
      ],
    },
  },
});
describe('file read observations', () => {
  it('is absent in a normal package without the opt-in capture', () => {
    render(FileReadObservations, { telemetry: emptyTelemetry() });
    expect(screen.queryByRole('region', { name: 'File read observations' })).toBeNull();
  });
  it('shows action, potential risk and separate path/process evidence without a score claim', () => {
    render(FileReadObservations, { telemetry: telemetry() });
    const panel = screen.getByRole('region', { name: 'File read observations' });
    for (const text of [
      'Claude Code',
      'Read observed',
      'Potential sensitive read',
      'Candidate path',
      'Issuing process verified',
    ])
      expect(panel).toHaveTextContent(text);
    expect(panel).toHaveTextContent('do not change risk scores or audit history');
    expect(panel).toHaveTextContent('Observed loss: Unknown');
  });
  it('preserves uncertainty, selected-instance scope and stopped capture state', async () => {
    const value = telemetry();
    value.stats.fileReadDiagnostics.phase = 'stopped';
    const mounted = render(FileReadObservations, {
      telemetry: value,
      scope: { agent: 'Claude Code', instanceId: '71:1000' },
    });
    expect(screen.getByRole('status')).toHaveTextContent('Capture is not live');
    await mounted.rerender({
      telemetry: value,
      scope: { agent: 'Claude Code', instanceId: '71:2000' },
    });
    expect(screen.getByRole('region')).not.toHaveTextContent(
      'Environment variables may contain credentials',
    );
  });
});
