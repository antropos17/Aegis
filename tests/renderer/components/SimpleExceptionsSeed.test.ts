import { afterEach, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import Notifications from '../../../frontend/observatory/components/Notifications.svelte';
import {
  connectHost,
  emptyTelemetry,
  type Host,
  type HostConnection,
  type Telemetry,
} from '../../../frontend/observatory/runtime/host';
import type { FileEvent } from '../../../src/shared/types';
let connection: HostConnection;
afterEach(() => connection?.());
const entry = { agentName: 'Claude', pattern: '^C:/work/\\.env$', timestamp: 1 };
const event: FileEvent = {
  agent: 'Claude',
  file: 'C:/work/.env',
  pid: 42,
  instanceId: '42:start',
  parentEditor: null,
  cwd: 'C:/work',
  sensitive: true,
  selfAccess: false,
  reason: 'Sensitive path',
  action: 'accessed',
  timestamp: 1,
  category: 'ai',
  attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] },
};
async function pendingSeed() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const seed = new Promise<unknown>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  let receive!: (value: unknown) => void;
  const subscribe = () => () => {};
  const host = {
    getFalsePositives: () => seed,
    getStats: async () => ({}),
    getResourceUsage: async () => ({}),
    onFileAccess: (callback: (value: unknown) => void) => {
      receive = callback;
      return () => {};
    },
    onScanBatch: subscribe,
    onStatsUpdate: subscribe,
    onNetworkUpdate: subscribe,
    onScanStatus: subscribe,
    onAgentResourceUsage: subscribe,
    onTokenCosts: subscribe,
  } as unknown as Host;
  let latest = emptyTelemetry();
  let renderState: ((state: Telemetry) => Promise<void>) | undefined;
  let rendered = Promise.resolve();
  connection = connectHost(host, (state) => {
    latest = state;
    if (renderState) rendered = renderState(state);
  });
  const mounted = render(Notifications, { telemetry: latest });
  renderState = async (state) => {
    await mounted.rerender({ telemetry: state });
  };
  await act(async () => {
    receive([event]);
    await rendered;
  });
  return {
    resolve,
    reject,
    current: () => latest,
    settled: async () => {
      await rendered;
    },
    deliver: async (rows: FileEvent[]) => {
      await act(async () => {
        receive(rows);
        await rendered;
      });
    },
    mounted,
  };
}
it('simple-exceptions: delays a fresh banner until saved exceptions arrive and retains muted evidence', async () => {
  const pending = await pendingSeed();
  expect(screen.getByRole('button', { name: /1 need review/ })).toBeInTheDocument();
  expect(screen.queryByText('Sensitive file observed: .env')).toBeNull();
  await act(async () => {
    pending.resolve([entry]);
    await Promise.resolve();
    await pending.settled();
  });
  await waitFor(() => expect(pending.current().falsePositives).toEqual([entry]));
  expect(screen.queryByText('Sensitive file observed: .env')).toBeNull();
  expect(pending.current().events).toEqual([event]);
});

it('simple-exceptions: pending presentation remains bounded while captured observations remain retained', async () => {
  const pending = await pendingSeed();
  await pending.deliver(
    Array.from({ length: 101 }, (_, index) => ({ ...event, timestamp: index + 2 })),
  );
  expect(pending.current().events).toHaveLength(102);
  await act(async () => {
    pending.resolve([]);
    await Promise.resolve();
    await pending.settled();
  });
  expect(await screen.findByText('100 sensitive file observations')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /100 need review/ })).toBeInTheDocument();
  expect(pending.current().events).toHaveLength(102);
});

it('simple-exceptions: unavailable read retains prior accepted exclusions and qualifies unmatched delivery', async () => {
  const initial: Telemetry = {
    ...emptyTelemetry(),
    falsePositives: [entry],
    falsePositiveReadState: 'unavailable',
  };
  const mounted = render(Notifications, { telemetry: initial });
  await mounted.rerender({ telemetry: { ...initial, events: [event] } });
  expect(screen.queryByText('Sensitive file observed: .env')).toBeNull();
  const unmatched = { ...event, timestamp: 2, file: 'C:/work/other.env' };
  await mounted.rerender({ telemetry: { ...initial, events: [event, unmatched] } });
  expect(screen.getByText('Sensitive file observed: other.env')).toBeInTheDocument();
  expect(
    screen.getByText('Saved exceptions could not be checked. Review the evidence.'),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /2 need review/ })).toBeInTheDocument();
});

it('simple-exceptions: accepted preferences remove an unfocused newly matched banner', async () => {
  const initial: Telemetry = { ...emptyTelemetry(), falsePositiveReadState: 'unavailable' };
  const mounted = render(Notifications, { telemetry: initial });
  await mounted.rerender({ telemetry: { ...initial, events: [event] } });
  expect(screen.getByText('Sensitive file observed: .env')).toBeInTheDocument();
  await mounted.rerender({
    telemetry: {
      ...initial,
      events: [event],
      falsePositives: [entry],
      falsePositiveReadState: 'ready',
    },
  });
  expect(screen.queryByText('Sensitive file observed: .env')).toBeNull();
  expect(screen.getByRole('button', { name: /1 need review/ })).toBeInTheDocument();
});

it('simple-exceptions: newly matched focused banner stays until blur without moving focus', async () => {
  const initial: Telemetry = { ...emptyTelemetry(), falsePositiveReadState: 'unavailable' };
  const mounted = render(Notifications, { telemetry: initial });
  await mounted.rerender({ telemetry: { ...initial, events: [event] } });
  const review = screen.getByRole('button', { name: 'Review' });
  await act(() => review.focus());
  await mounted.rerender({
    telemetry: {
      ...initial,
      events: [event],
      falsePositives: [entry],
      falsePositiveReadState: 'ready',
    },
  });
  expect(review).toHaveFocus();
  expect(screen.getByText('Sensitive file observed: .env')).toBeInTheDocument();
  const retained = screen.getByRole('button', { name: /1 need review/ });
  await act(() => retained.focus());
  await waitFor(() => expect(screen.queryByText('Sensitive file observed: .env')).toBeNull());
  expect(retained).toHaveFocus();
});

it('simple-exceptions: internal Review-to-Dismiss focus transfer preserves a newly matched banner', async () => {
  const initial: Telemetry = { ...emptyTelemetry(), falsePositiveReadState: 'unavailable' };
  const mounted = render(Notifications, { telemetry: initial });
  await mounted.rerender({ telemetry: { ...initial, events: [event] } });
  const review = screen.getByRole('button', { name: 'Review' });
  const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });
  await act(() => review.focus());
  await mounted.rerender({
    telemetry: {
      ...initial,
      events: [event],
      falsePositives: [entry],
      falsePositiveReadState: 'ready',
    },
  });
  let focusDuringTransfer: Element | null = null;
  review.addEventListener(
    'focusout',
    () => {
      focusDuringTransfer = document.activeElement;
    },
    { once: true },
  );
  await act(() => dismiss.focus());
  expect(focusDuringTransfer).toBe(document.body);
  expect(dismiss).toHaveFocus();
  expect(screen.getByText('Sensitive file observed: .env')).toBeInTheDocument();
  const retained = screen.getByRole('button', { name: /1 need review/ });
  await act(() => retained.focus());
  await waitFor(() => expect(screen.queryByText('Sensitive file observed: .env')).toBeNull());
  expect(retained).toHaveFocus();
});
it('simple-exceptions: releases a queued unmatched banner once a valid empty seed arrives', async () => {
  const pending = await pendingSeed();
  expect(screen.queryByText('Sensitive file observed: .env')).toBeNull();
  await act(async () => {
    pending.resolve([]);
    await Promise.resolve();
    await pending.settled();
  });
  expect(await screen.findByText('Sensitive file observed: .env')).toBeInTheDocument();
  await fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
  await pending.mounted.rerender({ telemetry: { ...pending.current(), stats: { changed: true } } });
  expect(screen.queryByText('Sensitive file observed: .env')).toBeNull();
});
it('simple-exceptions: failed pending read shows an honest qualification and retains the observation', async () => {
  const pending = await pendingSeed();
  await act(async () => {
    pending.reject(new Error('read unavailable'));
    await Promise.resolve();
    await pending.settled();
  });
  expect(
    await screen.findByText('Saved exceptions could not be checked. Review the evidence.'),
  ).toBeInTheDocument();
  expect(screen.getByText('Sensitive file observed: .env')).toBeInTheDocument();
  expect(pending.current().events).toEqual([event]);
});
