import { describe, it, expect } from 'vitest';
import {
  formatTimestamp,
  fileEventsToFeed,
  networkToFeed,
  filterFeed,
  typeClass,
} from '../../src/renderer/lib/utils/event-feed-utils.ts';

describe('event-feed-utils', () => {
  describe('formatTimestamp()', () => {
    it('formats midnight', () => {
      const midnight = new Date(2024, 0, 1, 0, 0, 0).getTime();
      expect(formatTimestamp(midnight)).toBe('00:00:00');
    });

    it('pads single digits', () => {
      const ts = new Date(2024, 0, 1, 2, 5, 9).getTime();
      expect(formatTimestamp(ts)).toBe('02:05:09');
    });

    it('formats afternoon time', () => {
      const ts = new Date(2024, 0, 1, 14, 30, 45).getTime();
      expect(formatTimestamp(ts)).toBe('14:30:45');
    });
  });

  describe('fileEventsToFeed()', () => {
    it('converts file events to feed entries', () => {
      const events = [
        { agent: 'Claude', file: '/src/index.js', action: 'modified', timestamp: 1700000000000 },
        { agent: 'Copilot', file: '/README.md', action: 'accessed', timestamp: 1700000001000 },
      ];
      const feed = fileEventsToFeed(events);
      expect(feed).toHaveLength(2);
      expect(feed[0].type).toBe('FILE');
      expect(feed[0].agent).toBe('Claude');
      expect(feed[0].detail).toContain('modified');
      expect(feed[0].detail).toContain('index.js');
    });

    it('handles empty events', () => {
      expect(fileEventsToFeed([])).toEqual([]);
    });

    it('defaults agent to Unknown', () => {
      const feed = fileEventsToFeed([{ file: '/test', timestamp: 1000 }]);
      expect(feed[0].agent).toBe('Unknown');
    });
  });

  describe('networkToFeed()', () => {
    it('converts network connections to feed entries', () => {
      const conns = [
        { agent: 'Claude', domain: 'api.anthropic.com', remotePort: 443, timestamp: 1700000000000 },
      ];
      const feed = networkToFeed(conns);
      expect(feed).toHaveLength(1);
      expect(feed[0].type).toBe('NET');
      expect(feed[0].detail).toContain('api.anthropic.com');
      expect(feed[0].detail).toContain('443');
    });
  });

  describe('filterFeed()', () => {
    const entries = [
      { id: '1', time: '12:00:00', type: 'FILE', agent: 'Claude', detail: 'test', timestamp: 1000 },
      { id: '2', time: '12:00:01', type: 'NET', agent: 'Copilot', detail: 'test', timestamp: 2000 },
      { id: '3', time: '12:00:02', type: 'PROC', agent: 'Claude', detail: 'test', timestamp: 3000 },
      {
        id: '4',
        time: '12:00:03',
        type: 'ANOMALY',
        agent: 'Cursor',
        detail: 'test',
        timestamp: 4000,
      },
    ];

    it('returns all entries when all filters enabled', () => {
      const result = filterFeed(entries, {
        file: true,
        net: true,
        proc: true,
        anomaly: true,
        agent: 'all',
      });
      expect(result).toHaveLength(4);
    });

    it('filters by event type — FILE disabled', () => {
      const result = filterFeed(entries, {
        file: false,
        net: true,
        proc: true,
        anomaly: true,
        agent: 'all',
      });
      expect(result).toHaveLength(3);
      expect(result.every((e) => e.type !== 'FILE')).toBe(true);
    });

    it('filters by event type — NET disabled', () => {
      const result = filterFeed(entries, {
        file: true,
        net: false,
        proc: true,
        anomaly: true,
        agent: 'all',
      });
      expect(result).toHaveLength(3);
      expect(result.every((e) => e.type !== 'NET')).toBe(true);
    });

    it('filters by agent', () => {
      const result = filterFeed(entries, {
        file: true,
        net: true,
        proc: true,
        anomaly: true,
        agent: 'Claude',
      });
      expect(result).toHaveLength(2);
      expect(result.every((e) => e.agent === 'Claude')).toBe(true);
    });

    it('combines type and agent filters', () => {
      const result = filterFeed(entries, {
        file: true,
        net: false,
        proc: false,
        anomaly: false,
        agent: 'Claude',
      });
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('FILE');
      expect(result[0].agent).toBe('Claude');
    });

    it('returns empty when all types disabled', () => {
      const result = filterFeed(entries, {
        file: false,
        net: false,
        proc: false,
        anomaly: false,
        agent: 'all',
      });
      expect(result).toHaveLength(0);
    });
  });

  describe('typeClass()', () => {
    it('returns correct class for FILE', () => {
      expect(typeClass('FILE')).toBe('type-file');
    });

    it('returns correct class for NET', () => {
      expect(typeClass('NET')).toBe('type-net');
    });

    it('returns correct class for PROC', () => {
      expect(typeClass('PROC')).toBe('type-proc');
    });

    it('returns correct class for ANOMALY', () => {
      expect(typeClass('ANOMALY')).toBe('type-anomaly');
    });
  });
});
