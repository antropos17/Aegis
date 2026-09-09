import { describe, it, expect } from 'vitest';
import {
  radarGroups,
  groupResource,
  groupActivity,
} from '../../frontend/observatory/runtime/radar';
import { emptyTelemetry } from '../../frontend/observatory/runtime/host';
const instance = (id, pid, risk = 0) => ({
  agent: 'Claude Code',
  name: 'Claude Code',
  instanceId: id,
  pid,
  riskScore: risk,
});
describe('Grouped radar observations', () => {
  it('keeps every process accessible and group risk follows the highest observed score', () => {
    const rows = [instance('a', 11, 3), instance('b', 12, 60), instance(null, 13, 0)];
    const groups = radarGroups(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].risk).toBe(60);
    expect(groups[0].members.map((a) => a.instanceId)).toEqual(['b', 'a', null]);
    expect(rows[0].instanceId).toBe('a');
  });
  it('does not sum partial, stale or null-identity measurements into a misleading group total', () => {
    const g = radarGroups([instance('a', 11), instance('b', 12)])[0];
    const state = {
      ...emptyTelemetry(),
      stale: false,
      resources: [
        { instanceId: 'a', cpu: 0 },
        { instanceId: null, cpu: 99 },
      ],
    };
    expect(groupResource(g, state, 'cpu')).toBeNull();
    state.resources.push({ instanceId: 'b', cpu: 2 });
    expect(groupResource(g, state, 'cpu')).toBe(2);
    expect(groupResource(g, { ...state, stale: true }, 'cpu')).toBeNull();
  });
  it('only includes exact stamped group identities in the shared half-open timeline', () => {
    const g = radarGroups([instance('a', 11), instance(null, 12)])[0];
    const state = {
      ...emptyTelemetry(),
      events: [
        { instanceId: 'a', timestamp: 100 },
        { instanceId: null, timestamp: 100 },
        { instanceId: 'old', timestamp: 100 },
        { instanceId: 'a', timestamp: 300000 },
      ],
    };
    expect(groupActivity(g, state, 300000).flatMap((b) => b.events)).toEqual([state.events[0]]);
  });
});
