/**
 * @vitest-environment jsdom
 *
 * ipc-file-access.test.ts — the REAL `file-access` handler in stores/ipc.ts keeps a
 * sensitive row under cap pressure and counts what it dropped on `eventsRetention`.
 *
 * events-retention.test.ts pins the pure policy; this pins the wiring, because a policy
 * module nobody calls protects nothing. Restore `[...arr.slice(-499), ...batch]` in the
 * handler and this file goes red.
 *
 * `window.aegis` must exist BEFORE `stores/ipc` is evaluated, or the module wires nothing
 * (production-no-bridge branch). The stub captures the `file-access` subscriber so the
 * test can deliver batches through the same function preload would call.
 */
import { describe, it, expect } from 'vitest';
import { get } from 'svelte/store';
import type { FileEvent } from '../../src/shared/types';

type FileAccessCb = (data: FileEvent | FileEvent[]) => void;
let deliver: FileAccessCb | null = null;
const noop = () => {};
(window as unknown as { aegis: unknown }).aegis = {
  onScanBatch: noop,
  onFileAccess: (cb: FileAccessCb) => {
    deliver = cb;
  },
  onStatsUpdate: noop,
  onNetworkUpdate: noop,
  onScanStatus: noop,
  onTokenCosts: noop,
  onAgentResourceUsage: noop,
  getStats: () => Promise.resolve({}),
  getResourceUsage: () => Promise.resolve({}),
  getFalsePositives: () => Promise.resolve([]),
};

const { events, eventsRetention } = await import('../../src/renderer/lib/stores/ipc.js');

const NOW = 1_754_380_000_000;

function fileEvent(id: number, over: Partial<FileEvent> = {}): FileEvent {
  return {
    agent: 'Claude Code',
    pid: 100,
    instanceId: '100:1754380000000',
    parentEditor: null,
    cwd: '/home/user/a',
    file: `/home/user/a/src/file-${id}.js`,
    sensitive: false,
    selfAccess: false,
    reason: '',
    action: 'modified',
    timestamp: NOW + id,
    category: 'ai',
    ...over,
  };
}

const SECRET = '/home/user/.aws/credentials';

function send(data: FileEvent | FileEvent[]): void {
  if (deliver === null) throw new Error('stores/ipc did not subscribe to file-access');
  deliver(data);
}

describe('file-access handler — retention under the 500 cap', () => {
  it('subscribed through the bridge', () => {
    expect(deliver).not.toBeNull();
    expect(get(events)).toEqual([]);
    expect(get(eventsRetention)).toEqual({ evicted: 0, retainedEvicted: 0 });
  });

  it('a sensitive row at the head survives 600 non-sensitive rows; the drop is counted', () => {
    send([fileEvent(0, { sensitive: true, file: SECRET, reason: 'AWS credentials' })]);
    for (let b = 0; b < 6; b += 1) {
      send(Array.from({ length: 100 }, (_, i) => fileEvent(1 + b * 100 + i)));
    }
    const stored = get(events);
    expect(stored).toHaveLength(500);
    expect(stored[0].file).toBe(SECRET);
    // The 499 newest non-sensitive rows follow it, in arrival order.
    expect(stored[1].timestamp).toBe(NOW + 102);
    expect(stored[499].timestamp).toBe(NOW + 600);
    expect(get(eventsRetention)).toEqual({ evicted: 101, retainedEvicted: 0 });
  });

  it('a single event (not an array) takes the same path', () => {
    send(fileEvent(601));
    const stored = get(events);
    expect(stored).toHaveLength(500);
    expect(stored[0].file).toBe(SECRET);
    expect(stored[499].timestamp).toBe(NOW + 601);
    expect(get(eventsRetention)).toEqual({ evicted: 102, retainedEvicted: 0 });
  });

  it('counts a sensitive row that had to go, and does not lose the count on the way', () => {
    // 500 sensitive rows on top of the one already there: the store is all-sensitive past
    // the cap, so the oldest sensitive row goes and retainedEvicted moves.
    send(Array.from({ length: 500 }, (_, i) => fileEvent(1000 + i, { sensitive: true })));
    const stored = get(events);
    expect(stored).toHaveLength(500);
    expect(stored.every((e) => e.sensitive)).toBe(true);
    expect(stored.some((e) => e.file === SECRET)).toBe(false);
    // 499 non-sensitive went first, then SECRET (the oldest sensitive) — one retained loss.
    expect(get(eventsRetention)).toEqual({ evicted: 602, retainedEvicted: 1 });
  });
});
