import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';

let FileReadObservations: typeof import('../../../frontend/observatory/components/FileReadObservations.svelte').default;
let render: typeof import('@testing-library/svelte/pure').render;
let cleanup: typeof import('@testing-library/svelte/pure').cleanup;
beforeEach(async () => {
  vi.resetModules();
  ({ render, cleanup } = await import('@testing-library/svelte/pure'));
  FileReadObservations = (await import('../../../frontend/observatory/components/FileReadObservations.svelte')).default;
});
afterEach(() => cleanup());

const captureTelemetry = (canStartObject = true) => ({
  ...emptyTelemetry(),
  stale: false,
  statsAt: 100,
  stats: {
    fileReadDiagnostics: {
      mode: 'ordinary',
      captureMode: 'display',
      phase: 'disabled',
      controls: { canStart: true, canStartObject, canStop: false },
      reads: [],
    },
  },
});

it('requires a separate unchecked opt-in and current readiness before sending start-object', async () => {
  const controlFileReads = vi.fn(async () => ({ success: true }));
  const mounted = render(FileReadObservations, {
    telemetry: captureTelemetry(false),
    host: { controlFileReads },
  });
  const consent = screen.getByRole('checkbox', {
    name: 'Include verified object reads in alerts and risk',
  });
  expect(consent).not.toBeChecked();
  expect(consent).toBeDisabled();
  expect(controlFileReads).not.toHaveBeenCalled();
  await mounted.rerender({ telemetry: captureTelemetry() });
  expect(consent).not.toBeChecked();
  expect(controlFileReads).not.toHaveBeenCalled();
  await fireEvent.input(screen.getByRole('textbox', { name: 'Folder to monitor' }), {
    target: { value: 'X:\\fixture' },
  });
  await fireEvent.click(consent);
  const panel = screen.getByRole('region');
  for (const phrase of [
    'up to 10 seconds',
    'rename or move',
    'actual access path is unknown',
    'remain unverified',
    'may temporarily delay renaming or deleting',
    'cleanup runs on stop or the next two-second sweep',
  ])
    expect(panel).toHaveTextContent(phrase);
  await fireEvent.click(screen.getByRole('button', { name: 'Start verified object monitoring' }));
  await waitFor(() =>
    expect(controlFileReads).toHaveBeenCalledExactlyOnceWith({
      action: 'start-object',
      root: 'X:\\fixture',
    }),
  );
  await mounted.rerender({ telemetry: captureTelemetry(false) });
  await fireEvent.submit(panel.querySelector('form')!);
  expect(controlFileReads).toHaveBeenCalledTimes(1);
});

it('keeps refused object capture visible and does not infer a running capture', async () => {
  render(FileReadObservations, {
    telemetry: captureTelemetry(),
    host: {
      controlFileReads: vi.fn(async () => ({
        success: false,
        error: 'Object verification unavailable',
      })),
    },
  });
  await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'X:\\fixture' } });
  await fireEvent.click(screen.getByRole('checkbox'));
  await fireEvent.click(screen.getByRole('button', { name: 'Start verified object monitoring' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('File read monitoring could not start.');
  expect(screen.queryByText('Object verification unavailable')).toBeNull();
  expect(screen.getByRole('textbox')).toHaveValue('X:\\fixture');
  expect(screen.getByRole('status')).toHaveTextContent('File read monitoring status is unknown.');
  expect(screen.queryByText('Capture running')).toBeNull();
});

it('clears object consent after explicit stop and retains candidate-only diagnostics during object capture', async () => {
  const controlFileReads = vi.fn(async () => ({ success: true }));
  const value = captureTelemetry();
  const mounted = render(FileReadObservations, { telemetry: value, host: { controlFileReads } });
  await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'X:\\fixture' } });
  await fireEvent.click(screen.getByRole('checkbox'));
  await mounted.rerender({
    telemetry: {
      ...value,
      stats: {
        fileReadDiagnostics: {
          ...value.stats.fileReadDiagnostics,
          captureMode: 'object-bound',
          phase: 'running',
          admission: { qualified: true },
          controls: { canStart: false, canStartObject: false, canStop: true },
        },
      },
    },
  });
  expect(screen.getByRole('region')).toHaveTextContent(
    'These observations do not change risk scores or audit history.',
  );
  expect(screen.getByRole('region')).toHaveTextContent(
    'Verified object reads are shown separately in Events',
  );
  expect(controlFileReads).not.toHaveBeenCalled();
  await fireEvent.click(screen.getByRole('button', { name: 'Stop file read monitoring' }));
  await waitFor(() => expect(controlFileReads).toHaveBeenCalledExactlyOnceWith({ action: 'stop' }));
  expect(screen.getByRole('checkbox')).not.toBeChecked();
});

it.each([null, Number.NaN])('does not send object capture without a finite supervisor timestamp: %s', async (statsAt) => {
  const controlFileReads = vi.fn();
  render(FileReadObservations, {
    telemetry: { ...captureTelemetry(), statsAt }, host: { controlFileReads },
  });
  expect(screen.getByRole('checkbox')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Start file read monitoring', exact: true })).toBeDisabled();
  await fireEvent.submit(screen.getByRole('region').querySelector('form')!);
  expect(controlFileReads).not.toHaveBeenCalled();
});

