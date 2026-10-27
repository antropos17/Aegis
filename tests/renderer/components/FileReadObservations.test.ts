import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';
let FileReadObservations: typeof import('../../../frontend/observatory/components/FileReadObservations.svelte').default;
let render: typeof import('@testing-library/svelte/pure').render;
let act: typeof import('@testing-library/svelte/pure').act;
let cleanup: typeof import('@testing-library/svelte/pure').cleanup;
beforeEach(async () => {
  vi.resetModules();
  ({ render, act, cleanup } = await import('@testing-library/svelte/pure'));
  FileReadObservations = (await import('../../../frontend/observatory/components/FileReadObservations.svelte')).default;
});
afterEach(() => cleanup());
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
const fileStatus = (
  stale: boolean,
  statsAt: number | null,
  phase: string,
  controls: Record<string, boolean>,
) => ({
  ...emptyTelemetry(),
  stale,
  statsAt,
  stats: {
    fileReadDiagnostics: {
      mode: 'ordinary',
      phase,
      controls,
      reads: [],
    },
  },
});
describe('file read observations', () => {
  it.each([
    ['stale running', fileStatus(true, 100, 'running', { canStart: false, canStop: true })],
    ['stale missing controls', fileStatus(true, 100, 'running', {})],
    ['fresh unknown controls', fileStatus(false, 100, 'running', {})],
  ])('allows path-free stop but not start for %s', async (_label, value) => {
    const controlFileReads = vi.fn(async () => ({ success: true }));
    render(FileReadObservations, { telemetry: value, host: { controlFileReads } });
    const start = screen.getByRole('button', { name: 'Start file read monitoring' });
    const stop = screen.getByRole('button', { name: 'Stop file read monitoring' });
    expect(start).toBeDisabled();
    expect(stop).toBeEnabled();
    expect(screen.getByRole('region', { name: 'File read observations' })).toHaveTextContent(
      'File read monitoring status is unknown. The last report is retained.',
    );
    await fireEvent.click(stop);
    await waitFor(() => expect(controlFileReads).toHaveBeenCalledExactlyOnceWith({ action: 'stop' }));
    expect(await screen.findByText('Stop requested. Waiting for a fresh supervisor report.')).toBeVisible();
    expect(start).toBeDisabled();
    expect(screen.queryByText('File read monitoring reported stopped.')).toBeNull();
  });

  it('acknowledges a stop only after a newer fresh stopped supervisor report', async () => {
    const controlFileReads = vi.fn(async () => ({ success: true }));
    const initial = fileStatus(true, 100, 'running', { canStart: false, canStop: true });
    let latest = initial;
    const getStats = vi.fn(async () => latest.stats);
    const mounted = render(FileReadObservations, { telemetry: initial, host: { controlFileReads, getStats } });
    await fireEvent.click(screen.getByRole('button', { name: 'Stop file read monitoring' }));
    await screen.findByText('Stop requested. Waiting for a fresh supervisor report.');
    for (const report of [
      fileStatus(true, 101, 'stopped', { canStart: true, canStop: false }),
      fileStatus(false, null, 'stopped', { canStart: true, canStop: false }),
      fileStatus(false, 100, 'stopped', { canStart: true, canStop: false }),
      fileStatus(false, 101, 'stopped', { canStart: false, canStop: true }),
    ]) {
      latest = report;
      await mounted.rerender({ telemetry: report });
      expect(screen.queryByText('File read monitoring reported stopped.')).toBeNull();
      expect(screen.getByRole('button', { name: 'Start file read monitoring' })).toBeDisabled();
    }
    latest = fileStatus(false, 102, 'stopped', { canStart: true, canStop: false });
    await mounted.rerender({ telemetry: latest });
    expect(await screen.findByText('File read monitoring reported stopped.')).toBeVisible();
    expect(controlFileReads).toHaveBeenCalledExactlyOnceWith({ action: 'stop' });
    expect(getStats).toHaveBeenCalled();
  });

  it.each(['rejection', 'failure response'])(
    'redacts a %s, retains unknown state, and retries the same path-free action', async (failure) => {
    const controlFileReads = vi.fn();
    if (failure === 'rejection') controlFileReads.mockRejectedValueOnce(new Error('PRIVATE_PATH_AND_TOKEN_CANARY'));
    else controlFileReads.mockResolvedValueOnce({ success: false, error: 'PRIVATE_PATH_AND_TOKEN_CANARY' });
    controlFileReads.mockResolvedValueOnce({ success: true });
    render(FileReadObservations, {
      telemetry: fileStatus(true, 100, 'running', { canStop: true }),
      host: { controlFileReads },
    });
    const stop = screen.getByRole('button', { name: 'Stop file read monitoring' });
    await fireEvent.click(stop);
    expect(await screen.findByText('Stop outcome is unknown. You can retry.')).toBeVisible();
    expect(screen.queryByText(/PRIVATE_PATH_AND_TOKEN_CANARY/)).toBeNull();
    expect(stop).toBeEnabled();
    await fireEvent.click(stop);
    expect(await screen.findByText('Stop requested. Waiting for a fresh supervisor report.')).toBeVisible();
    expect(controlFileReads.mock.calls.map(([request]) => request)).toEqual([{ action: 'stop' }, { action: 'stop' }]);
  });

  it('turns a lost stop reply into retryable unknown after the deadline', async () => {
    let finish!: (_value: unknown) => void;
    const controlFileReads = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce({ success: true });
    render(FileReadObservations, {
      telemetry: fileStatus(true, 100, 'running', { canStop: true }),
      host: { controlFileReads },
    });
    const stop = screen.getByRole('button', { name: 'Stop file read monitoring' });
    await fireEvent.click(stop);
    expect(screen.getByText('Requesting stop…')).toBeVisible();
    expect(stop).toBeDisabled();
    expect(screen.queryByText('Stop outcome is unknown. You can retry.')).toBeNull();
    expect(await screen.findByText('Stop outcome is unknown. You can retry.', {}, { timeout: 5000 })).toBeVisible();
    expect(stop).toBeEnabled();
    await fireEvent.click(stop);
    await screen.findByText('Stop requested. Waiting for a fresh supervisor report.');
    await act(() => finish({ success: true }));
    expect(screen.queryByText('File read monitoring reported stopped.')).toBeNull();
    expect(controlFileReads.mock.calls.map(([request]) => request)).toEqual([{ action: 'stop' }, { action: 'stop' }]);
  }, 8000);

  it('ignores a late stop response after unmount and never changes a replacement view', async () => {
    let finish!: (_value: unknown) => void;
    const controlFileReads = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const previous = render(FileReadObservations, {
      telemetry: fileStatus(true, 100, 'running', { canStop: true }), host: { controlFileReads },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Stop file read monitoring' }));
    previous.unmount();
    render(FileReadObservations, {
      telemetry: fileStatus(false, 200, 'disabled', { canStart: true, canStop: false }),
      host: { controlFileReads: vi.fn(async () => ({ success: true })) },
    });
    await act(() => finish({ success: true }));
    expect(screen.queryByText('Stop requested. Waiting for a fresh supervisor report.')).toBeNull();
    expect(screen.queryByText('File read monitoring reported stopped.')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('File read monitoring status is unknown.');
  });

  it('ignores a pending stop reply after the host is replaced', async () => {
    let finish!: (_value: unknown) => void;
    const oldControl = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const newControl = vi.fn(async () => ({ success: true }));
    const value = fileStatus(true, 100, 'running', { canStop: true });
    const mounted = render(FileReadObservations, { telemetry: value, host: { controlFileReads: oldControl } });
    await fireEvent.click(screen.getByRole('button', { name: 'Stop file read monitoring' }));
    await mounted.rerender({ telemetry: value, host: { controlFileReads: newControl } });
    expect(await screen.findByText('Stop outcome is unknown. You can retry.')).toBeVisible();
    await act(() => finish({ success: true }));
    expect(screen.getByText('Stop outcome is unknown. You can retry.')).toBeVisible();
    expect(screen.queryByText('Stop requested. Waiting for a fresh supervisor report.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Stop file read monitoring' })).toBeEnabled();
    expect(newControl).not.toHaveBeenCalled();
  });

  it('clears an earlier stopped confirmation when the host changes until a newer fresh report arrives', async () => {
    let latest = fileStatus(true, 100, 'running', { canStop: true });
    const firstHost = { controlFileReads: vi.fn(async () => ({ success: true })), getStats: vi.fn(async () => latest.stats) };
    const secondHost = { controlFileReads: vi.fn(async () => ({ success: true })), getStats: vi.fn(async () => latest.stats) };
    const initial = fileStatus(true, 100, 'running', { canStop: true });
    const mounted = render(FileReadObservations, { telemetry: initial, host: firstHost });
    await fireEvent.click(screen.getByRole('button', { name: 'Stop file read monitoring' }));
    await screen.findByText('Stop requested. Waiting for a fresh supervisor report.');
    const stopped = fileStatus(false, 101, 'stopped', { canStart: true, canStop: false });
    latest = stopped;
    await mounted.rerender({ telemetry: stopped, host: firstHost });
    expect(await screen.findByText('File read monitoring reported stopped.')).toBeVisible();
    await mounted.rerender({ telemetry: stopped, host: secondHost });
    expect(screen.queryByText('File read monitoring reported stopped.')).toBeNull();
    expect(screen.getByRole('region', { name: 'File read observations' })).toHaveTextContent(
      'File read monitoring status is unknown. The last report is retained.',
    );
    expect(screen.getByRole('button', { name: 'Start file read monitoring' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stop file read monitoring' })).toBeEnabled();
    await mounted.rerender({ telemetry: fileStatus(false, 101, 'stopped', { canStart: true, canStop: false }), host: secondHost });
    expect(screen.getByRole('button', { name: 'Stop file read monitoring' })).toBeEnabled();
    latest = fileStatus(false, 102, 'stopped', { canStart: true, canStop: false });
    await mounted.rerender({ telemetry: latest, host: secondHost });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop file read monitoring' })).toBeNull());
    expect(secondHost.getStats).toHaveBeenCalledOnce();
    await fireEvent.input(screen.getByRole('textbox', { name: 'Folder to monitor' }), { target: { value: 'C:\\fixture' } });
    expect(screen.getByRole('button', { name: 'Start file read monitoring' })).toBeEnabled();
    expect(secondHost.controlFileReads).not.toHaveBeenCalled();
  });

  it('offers only path-free stop when stale diagnostics are absent', async () => {
    const controlFileReads = vi.fn(async () => ({ success: true }));
    render(FileReadObservations, { telemetry: { ...emptyTelemetry(), stale: true }, host: { controlFileReads } });
    expect(screen.getByRole('region', { name: 'File read observations' })).toHaveTextContent(
      'File read monitoring status is unknown. The last report is retained.',
    );
    expect(screen.getByRole('button', { name: 'Start file read monitoring' })).toBeDisabled();
    await fireEvent.click(screen.getByRole('button', { name: 'Stop file read monitoring' }));
    await waitFor(() => expect(controlFileReads).toHaveBeenCalledExactlyOnceWith({ action: 'stop' }));
    expect(await screen.findByText('Stop requested. Waiting for a fresh supervisor report.')).toBeVisible();
  });
  it('hides the panel for fresh missing diagnostics without any previous ordinary report', () => {
    render(FileReadObservations, { telemetry: { ...emptyTelemetry(), stale: false }, host: { controlFileReads: vi.fn() } });
    expect(screen.queryByRole('region', { name: 'File read observations' })).toBeNull();
  });
  it('keeps an unknown path-free Stop when fresh diagnostics disappear after ordinary capture', async () => {
    const controlFileReads = vi.fn(async () => ({ success: true }));
    const mounted = render(FileReadObservations, { telemetry: fileStatus(false, 100, 'running', { canStop: true }), host: { controlFileReads } });
    await mounted.rerender({ telemetry: { ...emptyTelemetry(), stale: false, statsAt: 101 } });
    expect(screen.getByRole('region', { name: 'File read observations' })).toHaveTextContent('status is unknown');
    await fireEvent.click(screen.getByRole('button', { name: 'Stop file read monitoring' }));
    await waitFor(() => expect(controlFileReads).toHaveBeenCalledExactlyOnceWith({ action: 'stop' }));
  });

  it('keeps Start blocked after a timed-out Start until its late reply settles and a newer direct report matches', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let finish!: (_value: unknown) => void;
    const controlFileReads = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    let latest = fileStatus(false, 100, 'disabled', { canStart: true, canStop: false });
    const getStats = vi.fn(async () => latest.stats);
    try {
      const mounted = render(FileReadObservations, { telemetry: latest, host: { controlFileReads, getStats } });
      await fireEvent.input(screen.getByRole('textbox', { name: 'Folder to monitor' }), { target: { value: 'C:\\fixture' } });
      await fireEvent.click(screen.getByRole('button', { name: 'Start file read monitoring' }));
      await act(() => vi.advanceTimersByTimeAsync(3501));
      expect(screen.getByText('Start outcome is unknown. Wait for a fresh supervisor report.')).toBeVisible();
      expect(screen.getByRole('button', { name: 'Start file read monitoring' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Stop file read monitoring' })).toBeEnabled();
      latest = fileStatus(false, 101, 'disabled', { canStart: true, canStop: false });
      await mounted.rerender({ telemetry: latest });
      expect(getStats).not.toHaveBeenCalled();
      await act(() => finish({ success: true }));
      expect(screen.getByRole('button', { name: 'Start file read monitoring' })).toBeDisabled();
      vi.useRealTimers();
      latest = fileStatus(false, 102, 'disabled', { canStart: true, canStop: false });
      await mounted.rerender({ telemetry: latest });
      await waitFor(() => expect(getStats).toHaveBeenCalledOnce());
      await waitFor(() => expect(screen.getByRole('button', { name: 'Start file read monitoring' })).toBeEnabled());
      expect(controlFileReads).toHaveBeenCalledExactlyOnceWith({ action: 'start', root: 'C:\\fixture' });
    } finally { finish?.({ success: true }); vi.useRealTimers(); }
  });

  it('limits two unresolved Stop requests and blocks Start until both settle and a newer direct report matches', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const finish: Array<(_value: unknown) => void> = [];
    const controlFileReads = vi.fn((_request: { action: string }) => new Promise((resolve) => finish.push(resolve)));
    let latest = fileStatus(false, 100, 'running', { canStart: false, canStop: true });
    const getStats = vi.fn(async () => latest.stats);
    try {
      const mounted = render(FileReadObservations, { telemetry: latest, host: { controlFileReads, getStats } });
      const stop = screen.getByRole('button', { name: 'Stop file read monitoring' });
      await fireEvent.click(stop);
      await act(() => vi.advanceTimersByTimeAsync(3501));
      expect(stop).toBeEnabled();
      await fireEvent.click(stop);
      await act(() => vi.advanceTimersByTimeAsync(3501));
      expect(screen.getByText('Control replies are still pending. Their outcome is unknown.')).toBeVisible();
      expect(stop).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Start file read monitoring' })).toBeDisabled();
      expect(controlFileReads.mock.calls.map(([request]) => request)).toEqual([{ action: 'stop' }, { action: 'stop' }]);
      await act(() => finish[0]({ success: true }));
      expect(stop).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Start file read monitoring' })).toBeDisabled();
      latest = fileStatus(false, 101, 'stopped', { canStart: true, canStop: false });
      await mounted.rerender({ telemetry: latest });
      expect(getStats).not.toHaveBeenCalled();
      await act(() => finish[1]({ success: true }));
      vi.useRealTimers();
      expect(screen.queryByText('File read monitoring reported stopped.')).toBeNull();
      latest = fileStatus(false, 102, 'stopped', { canStart: true, canStop: false });
      await mounted.rerender({ telemetry: latest });
      await screen.findByText('File read monitoring reported stopped.');
      expect(getStats).toHaveBeenCalledOnce();
    } finally { for (const settle of finish) settle({ success: true }); vi.useRealTimers(); }
  });

  it('keeps a new view gated across an unresolved earlier Stop and revalidates after settlement', async () => {
    let finish!: (_value: unknown) => void;
    const oldControl = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const old = render(FileReadObservations, { telemetry: fileStatus(true, 100, 'running', { canStop: true }), host: { controlFileReads: oldControl } });
    try {
      await fireEvent.click(screen.getByRole('button', { name: 'Stop file read monitoring' }));
      old.unmount();
      let latest = fileStatus(false, 200, 'disabled', { canStart: true, canStop: false });
      const getStats = vi.fn(async () => latest.stats);
      const mounted = render(FileReadObservations, { telemetry: latest, host: { controlFileReads: vi.fn(), getStats } });
      expect(screen.getByRole('button', { name: 'Start file read monitoring' })).toBeDisabled();
      await act(() => finish({ success: true }));
      expect(screen.getByRole('button', { name: 'Start file read monitoring' })).toBeDisabled();
      latest = fileStatus(false, 201, 'disabled', { canStart: true, canStop: false });
      await mounted.rerender({ telemetry: latest });
      await waitFor(() => expect(getStats).toHaveBeenCalledOnce());
      await fireEvent.input(screen.getByRole('textbox', { name: 'Folder to monitor' }), { target: { value: 'C:\\fixture' } });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Start file read monitoring' })).toBeEnabled());
    } finally { finish?.({ success: true }); }
  });

  it('requires a fresh direct report in a new view when an earlier Stop settled while unmounted', async () => {
    let finish!: (_value: unknown) => void;
    const old = render(FileReadObservations, { telemetry: fileStatus(true, 100, 'running', { canStop: true }), host: { controlFileReads: () => new Promise((resolve) => { finish = resolve; }) } });
    try {
      await fireEvent.click(screen.getByRole('button', { name: 'Stop file read monitoring' }));
      old.unmount();
      await act(() => finish({ success: true }));
      let latest = fileStatus(false, 200, 'disabled', { canStart: true, canStop: false });
      const getStats = vi.fn(async () => latest.stats);
      const mounted = render(FileReadObservations, { telemetry: latest, host: { controlFileReads: vi.fn(), getStats } });
      expect(screen.getByRole('button', { name: 'Start file read monitoring' })).toBeDisabled();
      expect(getStats).not.toHaveBeenCalled();
      latest = fileStatus(false, 201, 'disabled', { canStart: true, canStop: false });
      await mounted.rerender({ telemetry: latest });
      await waitFor(() => expect(getStats).toHaveBeenCalledOnce());
      await fireEvent.input(screen.getByRole('textbox', { name: 'Folder to monitor' }), { target: { value: 'C:\\fixture' } });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Start file read monitoring' })).toBeEnabled());
    } finally { finish?.({ success: true }); }
  });

  it.each(['absent', 'rejected'])(
    'keeps Stop unconfirmed when a fresh candidate has %s direct readback', async (failure) => {
      const controlFileReads = vi.fn(async () => ({ success: true }));
      const getStats = failure === 'absent' ? undefined : vi.fn(async () => { throw Error('PRIVATE_READBACK'); });
      const host: Record<string, (...args: never[]) => unknown> = { controlFileReads };
      if (getStats) host.getStats = getStats;
      const mounted = render(FileReadObservations, { telemetry: fileStatus(true, 100, 'running', { canStop: true }), host });
      await fireEvent.click(screen.getByRole('button', { name: 'Stop file read monitoring' }));
      await screen.findByText('Stop requested. Waiting for a fresh supervisor report.');
      await mounted.rerender({ telemetry: fileStatus(false, 101, 'stopped', { canStart: true, canStop: false }) });
      if (getStats) await waitFor(() => expect(getStats).toHaveBeenCalledOnce());
      expect(screen.queryByText('File read monitoring reported stopped.')).toBeNull();
      expect(screen.queryByText(/PRIVATE_READBACK/)).toBeNull();
      expect(screen.getByRole('button', { name: 'Start file read monitoring' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Stop file read monitoring' })).toBeEnabled();
    },
  );

  it('accepts a fresh disabled readback after an idempotent no-child Stop without claiming cleanup', async () => {
    let latest = fileStatus(true, 100, 'disabled', {});
    const getStats = vi.fn(async () => latest.stats);
    const controlFileReads = vi.fn(async () => ({ success: true }));
    const mounted = render(FileReadObservations, { telemetry: latest, host: { controlFileReads, getStats } });
    await fireEvent.click(screen.getByRole('button', { name: 'Stop file read monitoring' }));
    await screen.findByText('Stop requested. Waiting for a fresh supervisor report.');
    latest = fileStatus(false, 101, 'disabled', { canStart: true, canStop: false });
    await mounted.rerender({ telemetry: latest });
    expect(await screen.findByText('File read monitoring is off.')).toBeVisible();
    expect(screen.queryByText('File read monitoring reported stopped.')).toBeNull();
    await fireEvent.input(screen.getByRole('textbox', { name: 'Folder to monitor' }), { target: { value: 'C:\\fixture' } });
    expect(screen.getByRole('button', { name: 'Start file read monitoring' })).toBeEnabled();
    expect(controlFileReads).toHaveBeenCalledExactlyOnceWith({ action: 'stop' });
  });

  it('clears earlier stopped feedback when a subsequent Start is accepted', async () => {
    let latest = fileStatus(true, 100, 'running', { canStop: true });
    const getStats = vi.fn(async () => latest.stats);
    const controlFileReads = vi.fn(async () => ({ success: true }));
    const mounted = render(FileReadObservations, { telemetry: latest, host: { controlFileReads, getStats } });
    await fireEvent.click(screen.getByRole('button', { name: 'Stop file read monitoring' }));
    await screen.findByText('Stop requested. Waiting for a fresh supervisor report.');
    latest = fileStatus(false, 101, 'stopped', { canStart: true, canStop: false });
    await mounted.rerender({ telemetry: latest });
    await screen.findByText('File read monitoring reported stopped.');
    await fireEvent.input(screen.getByRole('textbox', { name: 'Folder to monitor' }), { target: { value: 'C:\\fixture' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Start file read monitoring' }));
    expect(await screen.findByText('Start requested. Waiting for a fresh supervisor report.')).toBeVisible();
    expect(screen.queryByText('File read monitoring reported stopped.')).toBeNull();
    latest = fileStatus(false, 102, 'running', { canStart: false, canStop: true });
    await mounted.rerender({ telemetry: latest });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Capture running'));
    expect(screen.queryByText('File read monitoring reported stopped.')).toBeNull();
  });

  it('bounds hung getStats readbacks across remounts and ignores their late replies', async () => {
    let finishOne!: (_value: unknown) => void;
    let finishTwo!: (_value: unknown) => void;
    const oldStats = vi.fn(() => new Promise((resolve) => { finishOne = resolve; }));
    const secondStats = vi.fn(() => new Promise((resolve) => { finishTwo = resolve; }));
    const controlFileReads = vi.fn(async () => ({ success: true }));
    const first = render(FileReadObservations, { telemetry: fileStatus(true, 100, 'running', { canStop: true }), host: { controlFileReads, getStats: oldStats } });
    try {
      await fireEvent.click(screen.getByRole('button', { name: 'Stop file read monitoring' }));
      await screen.findByText('Stop requested. Waiting for a fresh supervisor report.');
      await first.rerender({ telemetry: fileStatus(false, 101, 'stopped', { canStart: true, canStop: false }) });
      await waitFor(() => expect(oldStats).toHaveBeenCalledOnce());
      first.unmount();
      const second = render(FileReadObservations, { telemetry: fileStatus(false, 200, 'stopped', { canStart: true, canStop: false }), host: { controlFileReads, getStats: secondStats } });
      await second.rerender({ telemetry: fileStatus(false, 201, 'stopped', { canStart: true, canStop: false }) });
      await waitFor(() => expect(secondStats).toHaveBeenCalledOnce());
      second.unmount();
      let latest = fileStatus(false, 300, 'stopped', { canStart: true, canStop: false });
      const currentStats = vi.fn(async () => latest.stats);
      const third = render(FileReadObservations, { telemetry: latest, host: { controlFileReads, getStats: currentStats } });
      latest = fileStatus(false, 301, 'stopped', { canStart: true, canStop: false });
      await third.rerender({ telemetry: latest });
      expect(currentStats).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Start file read monitoring' })).toBeDisabled();
      await act(() => finishOne(fileStatus(false, 101, 'stopped', { canStart: true, canStop: false }).stats));
      expect(screen.getByRole('button', { name: 'Start file read monitoring' })).toBeDisabled();
      latest = fileStatus(false, 302, 'stopped', { canStart: true, canStop: false });
      await third.rerender({ telemetry: latest });
      await waitFor(() => expect(currentStats).toHaveBeenCalledOnce());
      await fireEvent.input(screen.getByRole('textbox', { name: 'Folder to monitor' }), { target: { value: 'C:\\fixture' } });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Start file read monitoring' })).toBeEnabled());
    } finally {
      finishOne?.(fileStatus(false, 101, 'stopped', { canStart: true, canStop: false }).stats);
      finishTwo?.(fileStatus(false, 201, 'stopped', { canStart: true, canStop: false }).stats);
    }
  });

  it('ignores a late direct readback from the old host after replacement', async () => {
    let finish!: (_value: unknown) => void;
    const oldStats = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const controlFileReads = vi.fn(async () => ({ success: true }));
    let latest = fileStatus(true, 100, 'running', { canStop: true });
    const mounted = render(FileReadObservations, { telemetry: latest, host: { controlFileReads, getStats: oldStats } });
    try {
      await fireEvent.click(screen.getByRole('button', { name: 'Stop file read monitoring' }));
      await screen.findByText('Stop requested. Waiting for a fresh supervisor report.');
      latest = fileStatus(false, 101, 'stopped', { canStart: true, canStop: false });
      await mounted.rerender({ telemetry: latest });
      await waitFor(() => expect(oldStats).toHaveBeenCalledOnce());
      const freshStats = vi.fn(async () => latest.stats);
      const host = { controlFileReads, getStats: freshStats };
      await mounted.rerender({ telemetry: latest, host });
      latest = fileStatus(false, 102, 'stopped', { canStart: true, canStop: false });
      await mounted.rerender({ telemetry: latest, host });
      expect(await screen.findByText('File read monitoring reported stopped.')).toBeVisible();
      await act(() => finish(fileStatus(false, 101, 'running', { canStart: false, canStop: true }).stats));
      expect(screen.getByText('File read monitoring reported stopped.')).toBeVisible();
      expect(freshStats).toHaveBeenCalledOnce();
    } finally { finish?.(fileStatus(false, 101, 'running', { canStart: false, canStop: true }).stats); }
  });
  it('requires explicit scoped start, preserves its draft through permission updates and sends stop without a path', async () => {
    const controlFileReads = vi.fn(async () => ({ success: true }));
    const value = {
      ...emptyTelemetry(),
      stale: false,
      statsAt: 100,
      stats: {
        fileReadDiagnostics: {
          mode: 'ordinary',
          phase: 'disabled',
          controls: { canStart: true, canStop: false },
          reads: [],
        },
      },
    };
    let latestStats = value.stats;
    const mounted = render(FileReadObservations, { telemetry: value, host: { controlFileReads, getStats: async () => latestStats } });
    const input = screen.getByRole('textbox', { name: 'Folder to monitor' });
    const start = screen.getByRole('button', { name: 'Start file read monitoring' });
    expect(start).toBeDisabled();
    expect(controlFileReads).not.toHaveBeenCalled();
    await fireEvent.input(input, { target: { value: 'C:\\fixture' } });
    await fireEvent.click(start);
    await waitFor(() =>
      expect(controlFileReads).toHaveBeenCalledWith({ action: 'start', root: 'C:\\fixture' }),
    );
    const updated = {
        ...value,
        statsAt: 101,
        stats: {
          fileReadDiagnostics: {
            ...value.stats.fileReadDiagnostics,
            phase: 'starting',
            controls: { canStart: false, canStop: true },
          },
        },
      };
    latestStats = updated.stats;
    await mounted.rerender({ telemetry: updated });
    expect(input).toHaveValue('C:\\fixture');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Waiting for Windows permission'));
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
        statsAt: 100,
        stats: {
          fileReadDiagnostics: {
            mode: 'ordinary',
            phase: 'disabled',
            controls: { canStart: true, canStop: false },
            reads: [],
          },
        },
      },
    });
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'C:\\alias' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Start file read monitoring' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('File read monitoring could not start.');
    expect(screen.queryByText('Choose an existing folder without a reparse alias')).toBeNull();
    expect(screen.getByRole('textbox')).toHaveValue('C:\\alias');
    expect(screen.getByRole('status')).toHaveTextContent('status is unknown');
  });
  it('hides the table when the file-read backend is unavailable', () => {
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
    expect(panel).toHaveTextContent('Kernel events lost: Unknown');
    expect(panel).toHaveTextContent('Collector records dropped: Unknown');
  });
  it('displays collector drops separately when kernel loss is zero', () => {
    const value = {
      ...telemetry(),
      stats: {
        fileReadDiagnostics: {
          ...telemetry().stats.fileReadDiagnostics,
          lossCount: 0,
          losses: {
            kernelEvents: '0',
            realtimeBuffers: '1',
            logBuffers: '2',
            collectorDropped: '7',
            mappingResets: '3',
          },
        },
      },
    };
    render(FileReadObservations, { telemetry: value });
    const status = screen.getByRole('status');
    for (const text of [
      'Kernel events lost: 0',
      'Realtime buffers lost: 1',
      'Log buffers lost: 2',
      'Collector records dropped: 7',
      'Mapping resets: 3',
    ])
      expect(status).toHaveTextContent(text);
  });
  it('preserves uncertainty, selected-instance scope and stopped capture state', async () => {
    const value = telemetry();
    value.stats.fileReadDiagnostics.phase = 'stopped';
    Object.assign(value.stats.fileReadDiagnostics, { controls: { canStart: true, canStop: false } });
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
