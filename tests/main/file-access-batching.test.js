/**
 * The DISPLAY-lane batching policy for the `file-access` channel (file-access-batching.js):
 * the coalesce key, and that key driving the REAL batcher under the REAL production
 * options object.
 *
 * What the wiring block below does and does not prove. It drives
 * `FILE_ACCESS_BATCHER_OPTIONS` — the very object main.js hands to `createBatcher` — so
 * the capacity, the flush window and the key function are the production ones, not a
 * lookalike reassembled here. It does NOT prove main.js passes that object: main.js
 * exports no handle on its batcher, and the only remaining link is the single `require`
 * at its module scope.
 *
 * One more bound worth stating, because it decides how this file has to be written:
 * `scanLoop.dedupFileEvent` sits AHEAD of the batcher on every production push path and
 * suppresses a repeat of the same `instanceId|file` for 30 s. In steady state the same
 * pair therefore cannot reach one 150 ms window twice and the key merges nothing; it
 * earns its place under burst, once `eventDedupMap` passes 1000 entries and is cleared
 * wholesale. So these tests push straight into the batcher, BELOW that layer — which is
 * exactly where the counters they assert on become reachable.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createBatcher } from '../../src/main/ipc-batcher.js';
import {
  FILE_ACCESS_CAPACITY,
  FILE_ACCESS_INTERVAL_MS,
  FILE_ACCESS_BATCHER_OPTIONS,
  KEY_SEP,
  fileAccessCoalesceKey,
  fileAccessRetain,
} from '../../src/main/file-access-batching.js';

/**
 * A benign self-churn event, shaped exactly as file-watcher.js builds one: an agent
 * touching its OWN config dir, so the sensitive rule matched (`reason` non-empty) and
 * the owner's own exemption cleared it (`selfAccess: true`, `sensitive: false`).
 * @param {Object} [over] - field overrides.
 */
function selfChurn(over = {}) {
  return {
    agent: 'Claude Code',
    pid: 4321,
    instanceId: '4321:1699887000000',
    parentEditor: null,
    cwd: 'C:\\work\\proj',
    file: 'C:\\Users\\me\\.claude\\settings.json',
    sensitive: false,
    selfAccess: true,
    reason: 'AI agent config directory',
    action: 'modified',
    timestamp: 1,
    category: 'ai',
    attribution: { status: 'inferred', evidence: ['self-config-path'] },
    repeatCount: 1,
    ...over,
  };
}

/**
 * A sensitive event: a credential file read, attributed from a pid.
 * @param {Object} [over] - field overrides.
 */
function sensitiveEvent(over = {}) {
  return {
    agent: 'Claude Code',
    pid: 4321,
    instanceId: '4321:1699887000000',
    parentEditor: null,
    cwd: 'C:\\work\\proj',
    file: 'C:\\Users\\me\\.aws\\credentials',
    sensitive: true,
    selfAccess: false,
    reason: 'Cloud provider credentials',
    action: 'accessed',
    timestamp: 2,
    category: 'ai',
    attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] },
    repeatCount: 1,
    ...over,
  };
}

describe('fileAccessCoalesceKey', () => {
  describe('refuses to merge', () => {
    it('a sensitive event — null, whatever else it carries', () => {
      expect(fileAccessCoalesceKey(sensitiveEvent())).toBeNull();
    });

    it('a sensitive event that also claims selfAccess', () => {
      // Unreachable in production (`sensitive: reason !== null && !selfAccess`), and
      // that is the point: the sensitive refusal must not be resting on that coupling.
      // Strip the sensitive guard and this case starts returning a key.
      expect(fileAccessCoalesceKey(selfChurn({ sensitive: true }))).toBeNull();
    });

    it('an event that is not the owning agent own benign self-churn', () => {
      expect(fileAccessCoalesceKey(selfChurn({ selfAccess: false, reason: '' }))).toBeNull();
    });

    it('an event whose selfAccess is merely truthy, not true', () => {
      expect(fileAccessCoalesceKey(selfChurn({ selfAccess: 1 }))).toBeNull();
      expect(fileAccessCoalesceKey(selfChurn({ selfAccess: 'yes' }))).toBeNull();
    });

    it('an unattributed event — instanceId null', () => {
      // Two unattributed events must not pool under one shared key: that is the same
      // collapse dedupFileEvent refuses (scan-loop.js, F-E03).
      expect(fileAccessCoalesceKey(selfChurn({ instanceId: null }))).toBeNull();
    });

    it('an event whose instanceId is an empty string', () => {
      expect(fileAccessCoalesceKey(selfChurn({ instanceId: '' }))).toBeNull();
    });

    it('an event missing file or action', () => {
      expect(fileAccessCoalesceKey(selfChurn({ file: '' }))).toBeNull();
      expect(fileAccessCoalesceKey(selfChurn({ file: undefined }))).toBeNull();
      expect(fileAccessCoalesceKey(selfChurn({ action: '' }))).toBeNull();
      expect(fileAccessCoalesceKey(selfChurn({ action: undefined }))).toBeNull();
    });

    it('anything that is not an object', () => {
      // Total, never throwing: ipc-batcher resolves this on the push path before any
      // counter moves, so a throw would leave the batcher mid-update.
      for (const v of [null, undefined, 0, 1, '', 'x', true, false, Symbol('s'), () => {}]) {
        expect(fileAccessCoalesceKey(v)).toBeNull();
      }
      expect(() => fileAccessCoalesceKey(undefined)).not.toThrow();
    });
  });

  describe('merges benign self-churn', () => {
    it('returns a key built from instance identity + path + action', () => {
      const ev = selfChurn();
      expect(fileAccessCoalesceKey(ev)).toBe(
        `4321:1699887000000${KEY_SEP}C:\\Users\\me\\.claude\\settings.json${KEY_SEP}modified`,
      );
    });

    it('is stable — the same event pushed twice yields the same key', () => {
      const ev = selfChurn();
      expect(fileAccessCoalesceKey(ev)).toBe(fileAccessCoalesceKey(ev));
    });

    it('is stable across two separately built but equal events', () => {
      expect(fileAccessCoalesceKey(selfChurn())).toBe(fileAccessCoalesceKey(selfChurn()));
    });

    it('ignores the fields that are not part of the key', () => {
      // timestamp and repeatCount move on every repeat; the key must not.
      const a = fileAccessCoalesceKey(selfChurn({ timestamp: 1, repeatCount: 1 }));
      const b = fileAccessCoalesceKey(selfChurn({ timestamp: 999, repeatCount: 42 }));
      expect(a).toBe(b);
    });
  });

  describe('separates what must stay separate', () => {
    // Each of these three is a discriminating negative: drop a segment from the key and
    // exactly one of them starts merging two events that are not the same frame. A
    // "the key is stable" test alone passes against a function returning a constant.
    it('a different instanceId is a different key', () => {
      const a = fileAccessCoalesceKey(selfChurn({ instanceId: '4321:1699887000000' }));
      const b = fileAccessCoalesceKey(selfChurn({ instanceId: '4321:1699887000001' }));
      expect(a).not.toBe(b);
    });

    it('a different file is a different key', () => {
      const a = fileAccessCoalesceKey(selfChurn({ file: 'C:\\Users\\me\\.claude\\a.json' }));
      const b = fileAccessCoalesceKey(selfChurn({ file: 'C:\\Users\\me\\.claude\\b.json' }));
      expect(a).not.toBe(b);
    });

    it('a different action is a different key', () => {
      const a = fileAccessCoalesceKey(selfChurn({ action: 'modified' }));
      const b = fileAccessCoalesceKey(selfChurn({ action: 'created' }));
      expect(a).not.toBe(b);
    });

    it('the separator cannot occur inside a segment, so no two field splits collide', () => {
      // A printable delimiter would let `<id>|<file>` and `<id>|<file2>` build one key
      // when a path happens to contain it. NUL is unavailable to every segment.
      const key = fileAccessCoalesceKey(selfChurn());
      expect(KEY_SEP).toBe(String.fromCharCode(0));
      expect(key.split(KEY_SEP)).toEqual([
        '4321:1699887000000',
        'C:\\Users\\me\\.claude\\settings.json',
        'modified',
      ]);
    });
  });
});

describe('fileAccessRetain', () => {
  it('retains a sensitive event', () => {
    expect(fileAccessRetain(sensitiveEvent())).toBe(true);
  });

  it('does not retain benign self-churn', () => {
    expect(fileAccessRetain(selfChurn())).toBe(false);
  });

  it('does not retain an ordinary non-sensitive event either', () => {
    expect(fileAccessRetain(selfChurn({ selfAccess: false, reason: '' }))).toBe(false);
  });

  it('reads `sensitive === true` exactly — a merely truthy value is not a sensitive event', () => {
    expect(fileAccessRetain(sensitiveEvent({ sensitive: 1 }))).toBe(false);
    expect(fileAccessRetain(sensitiveEvent({ sensitive: 'yes' }))).toBe(false);
    expect(fileAccessRetain(sensitiveEvent({ sensitive: 'true' }))).toBe(false);
  });

  it('is total: anything that is not an object answers false and never throws', () => {
    // ipc-batcher resolves this on the push path before any counter moves, so a throw
    // would leave the batcher mid-update — the same contract fileAccessCoalesceKey keeps.
    for (const v of [null, undefined, 0, 1, '', 'x', true, false, Symbol('s'), () => {}]) {
      expect(fileAccessRetain(v)).toBe(false);
    }
    expect(() => fileAccessRetain(undefined)).not.toThrow();
  });
});

describe('FILE_ACCESS_BATCHER_OPTIONS', () => {
  it('carries the documented bounds and is frozen', () => {
    expect(FILE_ACCESS_CAPACITY).toBe(1000);
    expect(FILE_ACCESS_INTERVAL_MS).toBe(150);
    expect(FILE_ACCESS_BATCHER_OPTIONS).toEqual({
      intervalMs: 150,
      capacity: 1000,
      coalesceKey: fileAccessCoalesceKey,
      retain: fileAccessRetain,
    });
    expect(Object.isFrozen(FILE_ACCESS_BATCHER_OPTIONS)).toBe(true);
  });
});

describe('file-access batcher under the production options', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** @returns {{send: import('vitest').Mock, batcher: ReturnType<typeof createBatcher>}} */
  function makeProductionBatcher() {
    const send = vi.fn();
    return { send, batcher: createBatcher('file-access', send, FILE_ACCESS_BATCHER_OPTIONS) };
  }

  it('a burst of identical self-churn becomes ONE entry, and a sensitive event in the same burst survives un-merged', () => {
    const { send, batcher } = makeProductionBatcher();
    const sensitive = sensitiveEvent();

    for (let i = 1; i <= 25; i += 1) batcher.push(selfChurn({ timestamp: i, repeatCount: i }));
    batcher.push(sensitive);
    for (let i = 26; i <= 50; i += 1) batcher.push(selfChurn({ timestamp: i, repeatCount: i }));

    const before = batcher.getStats();
    expect(before.pushed).toBe(51);
    expect(before.coalesced).toBe(49);
    expect(before.evicted).toBe(0);
    expect(before.buffered).toBe(2);
    expect(before.highWater).toBe(2);

    vi.advanceTimersByTime(FILE_ACCESS_INTERVAL_MS);
    expect(send).toHaveBeenCalledOnce();
    const [channel, payload] = send.mock.calls[0];
    expect(channel).toBe('file-access');
    expect(payload).toHaveLength(2);

    // One displayed entry for 50 identical frames, and it is the LAST one: a merge
    // replaces the buffered entry where it stands, so position is kept and the newest
    // value wins.
    expect(payload[0].file).toBe('C:\\Users\\me\\.claude\\settings.json');
    expect(payload[0].timestamp).toBe(50);
    expect(payload[0].repeatCount).toBe(50);

    // Delivered untouched — same object, every field intact, in its own slot.
    expect(payload[1]).toBe(sensitive);
    expect(payload[1]).toEqual(sensitiveEvent());

    const after = batcher.getStats();
    expect(after.coalesced).toBe(49);
    expect(after.buffered).toBe(0);
    expect(after.evictedSinceFlush).toBe(0);
    batcher.destroy();
  });

  it('two sensitive events in one burst each keep their own slot', () => {
    const { send, batcher } = makeProductionBatcher();
    batcher.push(sensitiveEvent({ file: 'C:\\a\\credentials' }));
    batcher.push(sensitiveEvent({ file: 'C:\\a\\credentials' }));
    vi.advanceTimersByTime(FILE_ACCESS_INTERVAL_MS);
    expect(send.mock.calls[0][1]).toHaveLength(2);
    expect(batcher.getStats().coalesced).toBe(0);
    batcher.destroy();
  });

  it('self-churn from two different instances does not collapse onto one entry', () => {
    const { send, batcher } = makeProductionBatcher();
    for (let i = 0; i < 10; i += 1) {
      batcher.push(selfChurn({ instanceId: '4321:1699887000000' }));
      batcher.push(selfChurn({ instanceId: '9876:1699887000000' }));
    }
    vi.advanceTimersByTime(FILE_ACCESS_INTERVAL_MS);
    const payload = send.mock.calls[0][1];
    expect(payload).toHaveLength(2);
    expect(payload.map((e) => e.instanceId)).toEqual(['4321:1699887000000', '9876:1699887000000']);
    expect(batcher.getStats().coalesced).toBe(18);
    batcher.destroy();
  });

  it('unattributed self-churn never merges — each observation keeps its own slot', () => {
    const { send, batcher } = makeProductionBatcher();
    for (let i = 0; i < 5; i += 1) batcher.push(selfChurn({ instanceId: null }));
    vi.advanceTimersByTime(FILE_ACCESS_INTERVAL_MS);
    expect(send.mock.calls[0][1]).toHaveLength(5);
    expect(batcher.getStats().coalesced).toBe(0);
    batcher.destroy();
  });

  it('bounds the window at FILE_ACCESS_CAPACITY, dropping the oldest frame first', () => {
    const { send, batcher } = makeProductionBatcher();
    // Distinct files → distinct keys → nothing merges, so capacity is what answers.
    for (let i = 0; i < FILE_ACCESS_CAPACITY + 1; i += 1) {
      batcher.push(selfChurn({ file: `C:\\Users\\me\\.claude\\f${i}.json` }));
    }
    const stats = batcher.getStats();
    expect(stats.pushed).toBe(FILE_ACCESS_CAPACITY + 1);
    expect(stats.evicted).toBe(1);
    expect(stats.evictedSinceFlush).toBe(1);
    expect(stats.buffered).toBe(FILE_ACCESS_CAPACITY);
    expect(stats.highWater).toBe(FILE_ACCESS_CAPACITY);

    vi.advanceTimersByTime(FILE_ACCESS_INTERVAL_MS);
    const payload = send.mock.calls[0][1];
    expect(payload).toHaveLength(FILE_ACCESS_CAPACITY);
    // The oldest frame is the one the renderer never sees; the newest always enters.
    expect(payload[0].file).toBe('C:\\Users\\me\\.claude\\f1.json');
    expect(payload[FILE_ACCESS_CAPACITY - 1].file).toBe(
      `C:\\Users\\me\\.claude\\f${FILE_ACCESS_CAPACITY}.json`,
    );
    expect(batcher.getStats().evictedSinceFlush).toBe(0);
    batcher.destroy();
  });

  it('coalescing keeps a sustained self-churn burst from ever reaching capacity', () => {
    const { batcher } = makeProductionBatcher();
    for (let i = 0; i < FILE_ACCESS_CAPACITY * 3; i += 1) batcher.push(selfChurn({ timestamp: i }));
    const stats = batcher.getStats();
    expect(stats.evicted).toBe(0);
    expect(stats.buffered).toBe(1);
    expect(stats.coalesced).toBe(FILE_ACCESS_CAPACITY * 3 - 1);
    batcher.destroy();
  });

  it('ACCEPTANCE: a sensitive event pushed FIRST survives a full-capacity burst of distinct self-churn', () => {
    // The oldest entry is the one plain oldest-first eviction would drop. With the
    // production `retain`, capacity pressure takes the oldest NON-sensitive frame instead,
    // so the sensitive event is delivered and the drop lands on self-churn. Restore an
    // unconditional `buf.shift()` in ipc-batcher and this case goes red.
    const { send, batcher } = makeProductionBatcher();
    const sensitive = sensitiveEvent();
    batcher.push(sensitive);
    // Distinct files → distinct keys → nothing merges, so capacity is what answers.
    for (let i = 0; i < FILE_ACCESS_CAPACITY; i += 1) {
      batcher.push(selfChurn({ file: `C:\\Users\\me\\.claude\\f${i}.json` }));
    }

    const stats = batcher.getStats();
    expect(stats.pushed).toBe(FILE_ACCESS_CAPACITY + 1);
    expect(stats.evicted).toBe(1);
    expect(stats.retainedEvicted).toBe(0);
    expect(stats.buffered).toBe(FILE_ACCESS_CAPACITY);

    vi.advanceTimersByTime(FILE_ACCESS_INTERVAL_MS);
    const payload = send.mock.calls[0][1];
    expect(payload).toHaveLength(FILE_ACCESS_CAPACITY);
    // Same object, still first: retention keeps position as well as presence.
    expect(payload[0]).toBe(sensitive);
    // The frame that went instead is the oldest self-churn, f0; f1 now leads the churn.
    expect(payload[1].file).toBe('C:\\Users\\me\\.claude\\f1.json');
    expect(payload[FILE_ACCESS_CAPACITY - 1].file).toBe(
      `C:\\Users\\me\\.claude\\f${FILE_ACCESS_CAPACITY - 1}.json`,
    );
    batcher.destroy();
  });

  it('the honest bound: a window holding MORE sensitive events than capacity evicts a sensitive one, and counts it', () => {
    const { batcher } = makeProductionBatcher();
    for (let i = 0; i < FILE_ACCESS_CAPACITY + 1; i += 1) {
      batcher.push(sensitiveEvent({ file: `C:\\Users\\me\\.aws\\cred${i}` }));
    }
    const stats = batcher.getStats();
    expect(stats.pushed).toBe(FILE_ACCESS_CAPACITY + 1);
    expect(stats.evicted).toBe(1);
    expect(stats.retainedEvicted).toBe(1);
    expect(stats.buffered).toBe(FILE_ACCESS_CAPACITY);
    batcher.destroy();
  });
});
