import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
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
  it('requires explicit scoped start, preserves its draft through permission updates and sends stop without a path', async () => {
    const controlFileReads = vi.fn(async () => ({ success: true }));
    const value = {
      ...emptyTelemetry(),
      stale: false,
      stats: {
        fileReadDiagnostics: {
          mode: 'ordinary',
          phase: 'disabled',
          controls: { canStart: true, canStop: false },
          reads: [],
        },
      },
    };
    const mounted = render(FileReadObservations, { telemetry: value, host: { controlFileReads } });
    const input = screen.getByRole('textbox', { name: 'Folder to monitor' });
    const start = screen.getByRole('button', { name: 'Start file read monitoring' });
    expect(start).toBeDisabled();
    expect(controlFileReads).not.toHaveBeenCalled();
    await fireEvent.input(input, { target: { value: 'C:\\fixture' } });
    await fireEvent.click(start);
    await waitFor(() =>
      expect(controlFileReads).toHaveBeenCalledWith({ action: 'start', root: 'C:\\fixture' }),
    );
    await mounted.rerender({
      telemetry: {
        ...value,
        stats: {
          fileReadDiagnostics: {
            ...value.stats.fileReadDiagnostics,
            phase: 'starting',
            controls: { canStart: false, canStop: true },
          },
        },
      },
    });
    expect(input).toHaveValue('C:\\fixture');
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for Windows permission');
    await fireEvent.click(screen.getByRole('button', { name: 'Stop file read monitoring' }));
    await waitFor(() => expect(controlFileReads).toHaveBeenLastCalledWith({ action: 'stop' }));
  });
  it('shows a refused start without claiming capture or discarding the selected folder', async () => {
    const controlFileReads = vi.fn(async () => ({
      success: false,
      error: 'Choose an existing folder without a reparse alias',
    }));
    render(FileReadObservations, {
      host: { controlFileReads },
      telemetry: {
        ...emptyTelemetry(),
        stale: false,
        stats: {
          fileReadDiagnostics: {
            mode: 'ordinary',
            phase: 'disabled',
            controls: { canStart: true },
            reads: [],
          },
        },
      },
    });
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'C:\\alias' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Start file read monitoring' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose an existing folder');
    expect(screen.getByRole('textbox')).toHaveValue('C:\\alias');
    expect(screen.getByRole('status')).toHaveTextContent('File read monitoring is off');
  });
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
