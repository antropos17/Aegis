import { afterEach, expect, it, vi } from 'vitest';
import {
  connectHost,
  type Host,
  type HostConnection,
  type Telemetry,
} from '../../frontend/observatory/runtime/host';
import type { FalsePositiveEntry } from '../../src/shared/types';
let connection: HostConnection;
afterEach(() => connection?.());
const entry: FalsePositiveEntry = {
  agentName: 'Claude',
  pattern: '^C:/work/\\.env$',
  timestamp: 1,
};
const invalid = [
  { label: 'denied reply', value: { success: false, error: 'denied' } },
  { label: 'null member', value: [null] },
  { label: 'partial member', value: [{ agentName: 'Claude' }] },
  { label: 'invalid timestamp', value: [{ ...entry, timestamp: '1' }] },
];
function bridge(getFalsePositives: () => Promise<unknown>): Host {
  const subscribe = () => () => {};
  return {
    getFalsePositives,
    getStats: async () => ({}),
    getResourceUsage: async () => ({}),
    onScanBatch: subscribe,
    onStatsUpdate: subscribe,
    onFileAccess: subscribe,
    onNetworkUpdate: subscribe,
    onScanStatus: subscribe,
    onAgentResourceUsage: subscribe,
    onTokenCosts: subscribe,
  } as unknown as Host;
}
it.each(invalid)(
  'simple-exceptions: rejects $label on refresh and retains last accepted exclusions',
  async ({ value }) => {
    let reply: unknown = [entry];
    const published: Telemetry[] = [];
    connection = connectHost(
      bridge(async () => reply),
      (state) => published.push(state),
    );
    await vi.waitFor(() => expect(published.at(-1)?.falsePositives).toEqual([entry]));
    const retained = published.at(-1)?.falsePositives;
    reply = value;
    await expect(connection.refreshFalsePositives()).rejects.toThrow('could not be read');
    expect(published.at(-1)?.falsePositives).toBe(retained);
    expect(published.at(-1)?.falsePositiveReadState).toBe('unavailable');
    reply = [];
    await connection.refreshFalsePositives();
    expect(published.at(-1)?.falsePositives).toEqual([]);
    expect(published.at(-1)?.falsePositiveReadState).toBe('ready');
  },
);
it('simple-exceptions: rejected initial seed reports unknown state without accepting an empty read', async () => {
  const published: Telemetry[] = [];
  connection = connectHost(
    bridge(async () => ({ success: false, error: 'denied' })),
    (state) => published.push(state),
  );
  const unobserved = published[0].falsePositives;
  await vi.waitFor(() => expect(published.at(-1)?.error).toContain('could not be read'));
  expect(published.at(-1)?.falsePositives).toBe(unobserved);
  expect(published.at(-1)?.falsePositiveReadState).toBe('unavailable');
});
