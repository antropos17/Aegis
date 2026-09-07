/**
 * events-retention.test.ts — the renderer `events` store keeps sensitive rows under cap
 * pressure the same way the main file-access batcher does (ipc-batcher `retain`).
 *
 * The discriminating cases are the ones a plain `slice(-capacity)` passes for the wrong
 * reason: a sensitive row at the HEAD of the store must survive a non-sensitive stream
 * several times the capacity, and the only way a sensitive row leaves is when the store
 * holds nothing else — counted in `retainedEvicted`, never silent.
 */
import { describe, it, expect } from 'vitest';
import {
  appendWithRetention,
  fileEventRetain,
  EVENTS_CAPACITY,
} from '../../src/renderer/lib/stores/events-retention.js';
import type { FileEvent } from '../../src/shared/types';

const NOW = 1_754_380_000_000;

/** One file event as the watcher emits it; `sensitive` defaults to false. */
function fileEvent(over: Partial<FileEvent> & { id?: number } = {}): FileEvent {
  const { id = 0, ...rest } = over;
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
    ...rest,
  };
}

/** `n` non-sensitive events with ids `from .. from+n-1`. */
function noise(n: number, from = 0): FileEvent[] {
  return Array.from({ length: n }, (_, i) => fileEvent({ id: from + i }));
}

function sensitive(id: number): FileEvent {
  return fileEvent({ id, sensitive: true, file: `/home/user/.ssh/id_${id}`, reason: 'SSH key' });
}

describe('fileEventRetain', () => {
  it('retains a sensitive event', () => {
    expect(fileEventRetain(sensitive(1))).toBe(true);
  });

  it('does not retain an ordinary non-sensitive event', () => {
    expect(fileEventRetain(fileEvent())).toBe(false);
  });

  it('reads `sensitive === true` exactly — a truthy non-boolean is not a sensitive event', () => {
    const notReally = fileEvent({ sensitive: 'yes' as unknown as boolean });
    expect(fileEventRetain(notReally)).toBe(false);
  });
});

describe('appendWithRetention', () => {
  it('under capacity: appends unchanged and counts nothing', () => {
    const prev = noise(3);
    const batch = noise(2, 3);
    const r = appendWithRetention(prev, batch, 10, fileEventRetain);
    expect(r.next).toEqual([...prev, ...batch]);
    expect(r).toMatchObject({ evicted: 0, retainedEvicted: 0 });
  });

  it('exactly at capacity is not over it', () => {
    const r = appendWithRetention(noise(4), noise(1, 4), 5, fileEventRetain);
    expect(r.next).toHaveLength(5);
    expect(r).toMatchObject({ evicted: 0, retainedEvicted: 0 });
  });

  it('over capacity: the oldest NON-sensitive rows go, a sensitive row at the head stays', () => {
    const prev = [sensitive(0), ...noise(3, 1)]; // s0 n1 n2 n3
    const batch = noise(2, 4); // n4 n5 → 6 rows into 4 slots
    const r = appendWithRetention(prev, batch, 4, fileEventRetain);
    expect(r.next.map((e) => e.file)).toEqual([
      sensitive(0).file,
      fileEvent({ id: 3 }).file,
      fileEvent({ id: 4 }).file,
      fileEvent({ id: 5 }).file,
    ]);
    expect(r).toMatchObject({ evicted: 2, retainedEvicted: 0 });
  });

  it('a store that is ALL sensitive beyond capacity evicts its oldest, and counts it as retainedEvicted', () => {
    const prev = [sensitive(0), sensitive(1)];
    const r = appendWithRetention(prev, [sensitive(2)], 2, fileEventRetain);
    expect(r.next.map((e) => e.file)).toEqual([sensitive(1).file, sensitive(2).file]);
    expect(r).toMatchObject({ evicted: 1, retainedEvicted: 1 });
  });

  it('mixed shortfall: every non-sensitive row goes first, then the oldest sensitive ones', () => {
    // s0 n1 s2 n3 s4 + batch s5 s6 → 7 rows into 3 slots: 4 evictions, only 2 non-sensitive
    // available, so the two OLDEST sensitive rows (s0, s2) go as well.
    const prev = [sensitive(0), fileEvent({ id: 1 }), sensitive(2), fileEvent({ id: 3 }), sensitive(4)];
    const r = appendWithRetention(prev, [sensitive(5), sensitive(6)], 3, fileEventRetain);
    expect(r.next.map((e) => e.file)).toEqual([sensitive(4).file, sensitive(5).file, sensitive(6).file]);
    expect(r).toMatchObject({ evicted: 4, retainedEvicted: 2 });
  });

  it('ACCEPTANCE: sensitive rows at the head survive a non-sensitive stream three times the capacity', () => {
    // Restore an unconditional `slice(-capacity)` and this case goes red on the first batch
    // that pushes the head out.
    const CAP = 50;
    let store: FileEvent[] = [sensitive(0), sensitive(1)];
    let evicted = 0;
    let retainedEvicted = 0;
    for (let b = 0; b < 15; b += 1) {
      const r = appendWithRetention(store, noise(10, 100 + b * 10), CAP, fileEventRetain);
      store = r.next;
      evicted += r.evicted;
      retainedEvicted += r.retainedEvicted;
    }
    expect(store).toHaveLength(CAP);
    expect(store[0].file).toBe(sensitive(0).file);
    expect(store[1].file).toBe(sensitive(1).file);
    expect(store.filter((e) => e.sensitive)).toHaveLength(2);
    expect(evicted).toBe(2 + 150 - CAP);
    expect(retainedEvicted).toBe(0);
  });

  it('a single batch larger than the capacity leaves exactly `capacity` rows', () => {
    // The previous `[...arr.slice(-499), ...batch]` held 499 + batch.length after a large
    // batch; the cap is the cap.
    const r = appendWithRetention([], [sensitive(0), ...noise(700, 1)], 500, fileEventRetain);
    expect(r.next).toHaveLength(500);
    expect(r.next[0].file).toBe(sensitive(0).file);
    expect(r).toMatchObject({ evicted: 201, retainedEvicted: 0 });
  });

  it('preserves arrival order among the survivors', () => {
    const prev = [fileEvent({ id: 0 }), sensitive(1), fileEvent({ id: 2 })];
    const r = appendWithRetention(prev, [fileEvent({ id: 3 })], 3, fileEventRetain);
    expect(r.next.map((e) => e.timestamp)).toEqual([NOW + 1, NOW + 2, NOW + 3]);
  });

  it('does not mutate its inputs', () => {
    const prev = [sensitive(0), fileEvent({ id: 1 })];
    const batch = [fileEvent({ id: 2 })];
    const prevCopy = [...prev];
    const batchCopy = [...batch];
    appendWithRetention(prev, batch, 2, fileEventRetain);
    expect(prev).toEqual(prevCopy);
    expect(batch).toEqual(batchCopy);
  });

  it('EVENTS_CAPACITY is the 500 the store has always advertised', () => {
    expect(EVENTS_CAPACITY).toBe(500);
  });
});
