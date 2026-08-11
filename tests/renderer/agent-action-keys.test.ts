/**
 * IDENTITY-RECON §6 step 10 / C4 — acknowledgement vs watchlist identity split.
 * Ack is stamped instanceId (ephemeral). Watchlist is display name (durable).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import {
  acknowledgementInstanceId,
  watchlistSignature,
} from '../../src/renderer/lib/utils/agent-action-keys.ts';
import {
  acknowledgedAgents,
  toggleAcknowledged,
  isAcknowledged,
  clearAcknowledged,
} from '../../src/renderer/lib/stores/acknowledged.js';

const ID_A = '5511:start-A';
const ID_B = '7720:start-B';
const ID_REUSE_A = '1234:start-A';
const ID_REUSE_B = '1234:start-B';

describe('agent-action-keys — identity split', () => {
  it('acknowledgement key is instanceId only; watchlist key is display name only', () => {
    const agent = {
      name: 'Claude Code',
      agent: 'Claude Code',
      pid: 5511,
      instanceId: ID_A,
    };
    expect(acknowledgementInstanceId(agent)).toBe(ID_A);
    expect(watchlistSignature(agent)).toBe('Claude Code');
    // Keys must never be the same concept under different names.
    expect(acknowledgementInstanceId(agent)).not.toBe(watchlistSignature(agent));
  });

  it('null instanceId cannot fall back to name or pid for acknowledgement', () => {
    const keyless = { name: 'Claude Code', agent: 'Claude Code', pid: 300 };
    expect(acknowledgementInstanceId(keyless)).toBeNull();
    expect(acknowledgementInstanceId({ instanceId: null, name: 'Claude Code' })).toBeNull();
    expect(acknowledgementInstanceId({ instanceId: '', name: 'Claude Code' })).toBeNull();
    // Watchlist still has a durable name.
    expect(watchlistSignature(keyless)).toBe('Claude Code');
  });

  it('watchlist signature never uses instanceId or bare pid', () => {
    expect(watchlistSignature({ instanceId: ID_A, pid: 99 })).toBeNull();
    expect(watchlistSignature({ agent: 'opencode', pid: 1 })).toBe('opencode');
    expect(watchlistSignature({ name: 'Cursor' })).toBe('Cursor');
  });
});

describe('acknowledgement by instance — C4', () => {
  beforeEach(() => clearAcknowledged());
  afterEach(() => clearAcknowledged());

  it('same-name concurrent instances have independent acknowledgement', () => {
    const a = { name: 'Claude Code', instanceId: ID_A, pid: 5511 };
    const b = { name: 'Claude Code', instanceId: ID_B, pid: 7720 };

    const ackA = acknowledgementInstanceId(a)!;
    const ackB = acknowledgementInstanceId(b)!;
    toggleAcknowledged(ackA);

    expect(isAcknowledged(ackA)).toBe(true);
    expect(isAcknowledged(ackB)).toBe(false);
    // Name is NOT a store key — acknowledging via name would be the old bug.
    expect(isAcknowledged('Claude Code')).toBe(false);
  });

  it('PID reuse does not transfer acknowledgement', () => {
    toggleAcknowledged(ID_REUSE_A);
    expect(isAcknowledged(ID_REUSE_A)).toBe(true);
    // Process B: same pid, new birth → new instanceId.
    expect(isAcknowledged(ID_REUSE_B)).toBe(false);
    expect(acknowledgementInstanceId({ pid: 1234, instanceId: ID_REUSE_B })).toBe(ID_REUSE_B);
  });

  it('same instanceId stays acknowledged across re-reads (not frame-local)', () => {
    toggleAcknowledged(ID_A);
    // Simulate a later scan batch re-deriving the same stamped id.
    const again = acknowledgementInstanceId({
      name: 'Claude Code',
      instanceId: ID_A,
      pid: 5511,
    });
    expect(again).toBe(ID_A);
    expect(isAcknowledged(again!)).toBe(true);
    expect(get(acknowledgedAgents).has(ID_A)).toBe(true);
  });

  it('null instance cannot steal a same-name agent acknowledgement', () => {
    toggleAcknowledged(ID_A);
    const keyless = { name: 'Claude Code', pid: 300 };
    expect(acknowledgementInstanceId(keyless)).toBeNull();
    // Store still only has the stamped key.
    expect(isAcknowledged(ID_A)).toBe(true);
    expect(isAcknowledged('Claude Code')).toBe(false);
  });

  it('watchlist separation: same name stays watched intent; new instance is not acknowledged', () => {
    // A was acknowledged and "watched" by name (watchlist lives in main; we only pin
    // the key split here). After A exits, B shares the durable signature but not ack.
    const a = { name: 'Claude Code', instanceId: ID_A, pid: 5511 };
    const b = { name: 'Claude Code', instanceId: ID_B, pid: 7720 };

    toggleAcknowledged(acknowledgementInstanceId(a)!);
    const watchA = watchlistSignature(a);
    const watchB = watchlistSignature(b);

    expect(watchA).toBe('Claude Code');
    expect(watchB).toBe('Claude Code');
    expect(watchA).toBe(watchB); // durable watchlist shares the name
    expect(isAcknowledged(acknowledgementInstanceId(a)!)).toBe(true);
    expect(isAcknowledged(acknowledgementInstanceId(b)!)).toBe(false); // B not ack'd
  });

  it('normal single-instance acknowledge / unacknowledge toggle', () => {
    const id = acknowledgementInstanceId({
      name: 'opencode',
      instanceId: ID_A,
      pid: 42,
    })!;
    expect(toggleAcknowledged(id)).toBe(true);
    expect(isAcknowledged(id)).toBe(true);
    expect(toggleAcknowledged(id)).toBe(false);
    expect(isAcknowledged(id)).toBe(false);
  });

  it('clearing A does not clear B', () => {
    toggleAcknowledged(ID_A);
    toggleAcknowledged(ID_B);
    toggleAcknowledged(ID_A); // unack A
    expect(isAcknowledged(ID_A)).toBe(false);
    expect(isAcknowledged(ID_B)).toBe(true);
  });
});
