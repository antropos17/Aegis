/**
 * IDENTITY-RECON §6 step 8 — live selection / focus identity is stamped instanceId.
 * PID equality rebinds selection across process death; these tests pin the fix.
 */
import { describe, it, expect } from 'vitest';
import {
  readSelectionInstanceId,
  isAgentSelected,
  resolveSelectedAgent,
  toggleInstanceSelection,
  focusInstanceId,
} from '../../src/renderer/lib/utils/agent-selection.ts';

const ID_A = '1234:start-A';
const ID_B = '1234:start-B';
const ID_OTHER = '9999:start-C';

describe('agent-selection — PID reuse (step 8)', () => {
  it('does not rebind selection when a new process reuses the old pid', () => {
    // Process A was selected by its canonical instance key.
    const selected = toggleInstanceSelection(null, {
      pid: 1234,
      instanceId: ID_A,
      agent: 'Claude Code',
    });
    expect(selected).toBe(ID_A);

    // A is gone; B appears with the same pid, different birth time → different instanceId.
    const live = [{ pid: 1234, instanceId: ID_B, agent: 'Claude Code', name: 'Claude Code' }];

    // Stale selection must not resolve to B through pid equality.
    expect(resolveSelectedAgent(live, selected)).toBeNull();
    expect(isAgentSelected(selected, live[0])).toBe(false);
    // And the store value is still the dead instance — nothing rewrote it to ID_B.
    expect(selected).toBe(ID_A);
  });
});

describe('agent-selection — same name, distinct instances', () => {
  it('selecting one instance leaves the other unselected', () => {
    const a = { pid: 100, instanceId: ID_A, agent: 'Claude Code', name: 'Claude Code' };
    const b = { pid: 200, instanceId: ID_OTHER, agent: 'Claude Code', name: 'Claude Code' };

    const selected = toggleInstanceSelection(null, a);
    expect(selected).toBe(ID_A);
    expect(isAgentSelected(selected, a)).toBe(true);
    expect(isAgentSelected(selected, b)).toBe(false);
    expect(resolveSelectedAgent([a, b], selected)).toBe(a);
    expect(resolveSelectedAgent([a, b], selected)?.instanceId).not.toBe(b.instanceId);
  });
});

describe('agent-selection — null / missing instanceId', () => {
  it('cannot select a keyless agent via pid or name', () => {
    const keyless = { pid: 300, agent: 'Claude Code', name: 'Claude Code' };
    const keyed = { pid: 100, instanceId: ID_A, agent: 'Claude Code', name: 'Claude Code' };

    // Toggle on keyless leaves selection unchanged (no fabrication).
    expect(toggleInstanceSelection(null, keyless)).toBeNull();
    expect(toggleInstanceSelection(ID_A, keyless)).toBe(ID_A);

    expect(readSelectionInstanceId(keyless)).toBeNull();
    expect(readSelectionInstanceId({ instanceId: null })).toBeNull();
    expect(readSelectionInstanceId({ instanceId: '' })).toBeNull();
    expect(isAgentSelected(ID_A, keyless)).toBe(false);
    // Selection of a real instance still resolves only that instance.
    expect(resolveSelectedAgent([keyless, keyed], ID_A)).toBe(keyed);
  });

  it('focusInstanceId refuses pid-only sources', () => {
    expect(focusInstanceId({ pid: 1234 })).toBeNull();
    expect(focusInstanceId({ pid: 1234, instanceId: ID_A })).toBe(ID_A);
    expect(focusInstanceId(null)).toBeNull();
  });
});

describe('agent-selection — normal single-instance select / deselect', () => {
  it('selects then clears the same instance on toggle', () => {
    const agent = { pid: 42, instanceId: ID_A, agent: 'opencode' };
    const selected = toggleInstanceSelection(null, agent);
    expect(selected).toBe(ID_A);
    expect(isAgentSelected(selected, agent)).toBe(true);
    expect(toggleInstanceSelection(selected, agent)).toBeNull();
  });

  it('switching selection moves to the other instance exactly', () => {
    const a = { pid: 1, instanceId: ID_A };
    const b = { pid: 2, instanceId: ID_OTHER };
    const first = toggleInstanceSelection(null, a);
    const second = toggleInstanceSelection(first, b);
    expect(second).toBe(ID_OTHER);
    expect(isAgentSelected(second, a)).toBe(false);
    expect(isAgentSelected(second, b)).toBe(true);
  });
});

describe('agent-selection — focus path is independent of selection', () => {
  it('focus and selection hold separate instance ids without pid coupling', () => {
    const selected = toggleInstanceSelection(null, { instanceId: ID_A, pid: 10 });
    const focused = focusInstanceId({ instanceId: ID_OTHER, pid: 10 });
    // Same pid on both sources would have collapsed them under the old stores.
    expect(selected).toBe(ID_A);
    expect(focused).toBe(ID_OTHER);
    expect(selected).not.toBe(focused);
  });
});
