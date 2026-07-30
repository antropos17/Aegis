import { describe, it, expect } from 'vitest';
import {
  groupByAgent,
  UNKNOWN_SOURCE,
  type FeedEvent,
  type EnrichedAgent,
} from '../../src/renderer/lib/utils/grouped-feed-utils';

const NOW = Date.now();

function ev(over: Partial<FeedEvent> = {}): FeedEvent {
  return {
    agent: 'Claude Code',
    timestamp: NOW,
    file: '/home/user/a/src/index.js',
    action: 'modified',
    sensitive: false,
    reason: '',
    _type: 'file',
    ...over,
  };
}

const AGENTS: EnrichedAgent[] = [{ name: 'Claude Code', riskScore: 42, trustGrade: 'C' }];

describe('groupByAgent — unattributed events', () => {
  it('collapses every unattributed event into ONE group named "Unknown source"', () => {
    const groups = groupByAgent(
      [
        ev(),
        ev({
          agent: '',
          file: '/home/user/.ssh/id_rsa',
          sensitive: true,
          reason: 'SSH keys/config',
        }),
        ev({ agent: '', file: '/home/user/.aws/credentials', sensitive: true, reason: 'AWS' }),
      ],
      AGENTS,
    );

    expect(groups).toHaveLength(2);
    const unknown = groups.find((g) => g.name === UNKNOWN_SOURCE);
    expect(unknown).toBeDefined();
    expect(unknown!.count).toBe(2);
    // No agent matches the empty key, so the readout stays honest.
    expect(unknown!.riskScore).toBe(0);
    expect(unknown!.trustGrade).toBe('?');
  });

  it('never emits a group with a blank name', () => {
    const groups = groupByAgent([ev({ agent: '' }), ev()], AGENTS);
    for (const g of groups) {
      expect(g.name).not.toBe('');
      expect(g.name.trim().length).toBeGreaterThan(0);
    }
  });

  it('leaves attributed groups untouched', () => {
    const groups = groupByAgent([ev(), ev({ file: '/home/user/a/b.js' })], AGENTS);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Claude Code');
    expect(groups[0].count).toBe(2);
    expect(groups[0].riskScore).toBe(42);
    expect(groups[0].trustGrade).toBe('C');
  });
});
