import { describe, expect, it } from 'vitest';
import {
  groupAgentsForPanel,
  groupApplicationInstances,
} from '../../src/renderer/lib/utils/agent-panel-utils.ts';

const row = (pid, root, riskScore = 10) => ({
  name: 'Codex',
  pid,
  instanceId: `${pid}:1000`,
  riskScore,
  fileCount: pid,
  applicationGroup: { id: `app:${root}:1000`, rootPid: root, processCount: 999 },
});

describe('application presentation groups', () => {
  it('shows one named card with two application trees and retains all process metrics', () => {
    const rows = [row(1, 1), row(2, 1, 90), row(3, 3), row(4, 3)];
    const cards = groupAgentsForPanel(rows);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      _applicationCount: 2,
      _processCount: 4,
      pid: 2,
      fileCount: 2,
      riskScore: 90,
    });
    expect(
      groupApplicationInstances(cards[0]._instances).map((g) => g.instances.map((a) => a.pid)),
    ).toEqual([
      [2, 1],
      [3, 4],
    ]);
    expect(rows[0]).not.toHaveProperty('_applicationCount');
  });

  it('does not turn missing metadata into invented application counts', () => {
    const old = { name: 'Codex', pid: 2, instanceId: '2:1000' };
    const cards = groupAgentsForPanel([row(1, 1), old]);
    expect(cards[0]._applicationCount).toBeNull();
    expect(groupApplicationInstances(cards[0]._instances)).toHaveLength(2);
    expect(groupAgentsForPanel([old, old])[0]._applicationCount).toBeNull();
  });
});
