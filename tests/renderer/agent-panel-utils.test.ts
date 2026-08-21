/**
 * AgentPanel grouping — F-W05 population consistency.
 */
import { describe, it, expect } from 'vitest';
import { groupAgentsForPanel } from '../../src/renderer/lib/utils/agent-panel-utils';

describe('groupAgentsForPanel (F-W05)', () => {
  it('returns empty for no agents', () => {
    expect(groupAgentsForPanel([])).toEqual([]);
  });

  it('uses the highest-risk instance as representative', () => {
    const rows = groupAgentsForPanel([
      {
        name: 'Claude Code',
        instanceId: '1:a',
        riskScore: 10,
        fileCount: 100,
        networkCount: 1,
        pid: 1,
      },
      {
        name: 'Claude Code',
        instanceId: '2:b',
        riskScore: 90,
        fileCount: 2,
        networkCount: 9,
        pid: 2,
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].instanceId).toBe('2:b');
    expect(rows[0].riskScore).toBe(90);
    expect(rows[0].pid).toBe(2);
  });

  it('does not sum fileCount/networkCount across instances onto the rep', () => {
    // Historical bug: card showed rep risk 90 with FILES=102 and NET=10 (group sum).
    const rows = groupAgentsForPanel([
      {
        name: 'Claude Code',
        instanceId: '1:a',
        riskScore: 10,
        fileCount: 100,
        networkCount: 1,
      },
      {
        name: 'Claude Code',
        instanceId: '2:b',
        riskScore: 90,
        fileCount: 2,
        networkCount: 9,
      },
    ]);
    expect(rows[0].fileCount).toBe(2);
    expect(rows[0].networkCount).toBe(9);
    expect(rows[0].fileCount).not.toBe(102);
    expect(rows[0].networkCount).not.toBe(10);
  });

  it('exposes process count and full instance list for multi-process groups', () => {
    const rows = groupAgentsForPanel([
      { name: 'X', instanceId: '1:a', riskScore: 5, fileCount: 1, networkCount: 0 },
      { name: 'X', instanceId: '2:b', riskScore: 50, fileCount: 3, networkCount: 2 },
    ]);
    expect(rows[0]._processCount).toBe(2);
    expect(rows[0]._instances).toHaveLength(2);
    expect(rows[0]._instances[0].riskScore).toBe(50);
  });

  it('keeps distinct display names as separate cards', () => {
    const rows = groupAgentsForPanel([
      { name: 'A', instanceId: '1:a', riskScore: 1, fileCount: 1, networkCount: 0 },
      { name: 'B', instanceId: '2:b', riskScore: 2, fileCount: 2, networkCount: 1 },
    ]);
    expect(rows).toHaveLength(2);
  });
});
